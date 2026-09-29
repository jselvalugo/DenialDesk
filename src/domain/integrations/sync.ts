import { hostname } from "node:os";
import { and, eq, sql } from "drizzle-orm";
import { canManageIntegrations } from "@/auth/permissions";
import { integrationConnections, integrationSyncRuns } from "@/db/schema";
import { withTenantAsSystem, type TenantTx } from "@/db/tenant";
import { en } from "@/i18n/messages/en";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";
import { discover } from "@/integrations/fhir/discovery";
import { isTransportError } from "@/integrations/fhir/errors";
import { RunBudget, DEFAULT_RUN_BUDGET } from "@/integrations/fhir/limits";
import { clampServerInstant, type MapPatientContext } from "@/integrations/fhir/map-patient";
import { isFhirConnectError, SECURITY_TRANSPORT_CODES } from "@/integrations/fhir/outcomes";
import { SigningKeyStoreError, type SigningKeyStore } from "@/integrations/fhir/keys";
import {
  BASE_BACKOFF_MS,
  createTokenSource,
  defaultSleep,
  FhirClient,
  isSyncFailure,
  MAX_RETRIES,
  PatientSearch,
  SyncFailure,
  type RetryPolicy,
  type SyncFailureCode,
} from "@/integrations/fhir/search";
import { assertSyntheticPage, isNotSyntheticError } from "@/integrations/fhir/synthetic-guard";
import type { Transport } from "@/integrations/fhir/transport";
import { operationOutcomeCodes } from "@/integrations/fhir/types";
import { VENDOR_SANDBOX_HOSTS } from "@/integrations/fhir/vendor-sandboxes";
import { audit, type AuditEvent } from "@/lib/audit";
import { decryptField, encryptField } from "@/lib/crypto/field";
import { syntheticDataOnly } from "@/lib/env";
import { log } from "@/lib/log";
import { hit } from "@/lib/rate-limit";
import {
  assertEnvironmentAllows,
  IntegrationConnectionError,
  type IntegrationActor,
  type TxRunner,
} from "./connections";
import { INTEGRATION_SERVICE_PRINCIPAL_ID } from "./principal";
import { normalizeRunCodes, type SyncStoredCode } from "./sync-codes";
import { abandonStaleRuns, hasActiveRun, insertQueuedRun, isRunAlreadyActive } from "./sync-runs";
import {
  commitPage,
  findRederiveCandidates,
  groupCoverages,
  MAX_ISSUE_ROWS_PER_RUN,
  rederiveCoverage,
  type PageContext,
  type PageOutcome,
} from "./sync-upsert";

// The sync run (docs/specs/patient-integrations.md PI2b; ADR 0010; threat model D1, D4, T4, I9).
// `syncNow` is the administrator's action: it queues a run and executes it in this request (background
// jobs are a later slice). `executeSyncRun` does the work and touches the database **only** through
// `withTenantAsSystem` (the `denialdesk_app` role, the integration service principal as actor, the
// run's tenant, run and connection settings for the read-only trigger), in short transactions: the
// network calls (discovery, token, every page, every Coverage search) run with no transaction open, and
// each page is committed on its own (a killed run keeps its earlier pages; the watermark only moves on
// success). It never writes `claims` or claim versions, never logs a resource, token, URL or
// identifier, and audits every patient write as the service principal with reason `ehr_sync`.

type IntegrationsT = Translator<Messages["integrations"]>;
const englishT: IntegrationsT = createTranslator(en.integrations, "en");

/** The watermark trails the first page's server time by this much (spec PI2b): clock skew, in-flight edits. */
export const WATERMARK_LAG_MS = 5 * 60 * 1000;

export interface SyncDeps {
  /** Chosen from `is_sandbox` alone, never the host. `null`: no transport in this environment. */
  transportFor(connection: { id: string; isSandbox: boolean }): Transport | null;
  keyStore(): SigningKeyStore;
  /** `syntheticDataOnly()` by default: the server's environment, never a client value. */
  syntheticOnly?: () => boolean;
  now?: () => Date;
  /** Backoff waits (tests pass a recorder that doesn't wait). */
  sleep?: (ms: number) => Promise<void>;
  retry?: Partial<Pick<RetryPolicy, "retries" | "baseDelayMs">>;
  budget?: () => RunBudget;
  encrypt?: (plaintext: string) => string;
  decrypt?: (ciphertext: string) => string;
}

export interface SyncCounts {
  created: number;
  updated: number;
  linked: number;
  unchanged: number;
  skipped: number;
}

export interface SyncRunResult extends SyncCounts {
  runId: string;
  /** `abandoned`: paused, revoked, or errored by someone else mid-run (nothing more was written). */
  status: "succeeded" | "failed" | "abandoned";
  /** Distinct fixed codes (`[a-z_]`): skips, notes, and the failure. */
  codes: string[];
  failure?: SyncFailureCode;
  connectionErrored?: boolean;
}

const connectionColumns = {
  id: integrationConnections.id,
  status: integrationConnections.status,
  isSandbox: integrationConnections.isSandbox,
  baseUrl: integrationConnections.baseUrl,
  tokenEndpoint: integrationConnections.tokenEndpoint,
  issuer: integrationConnections.issuer,
  clientId: integrationConnections.clientId,
  mrnIdentifierSystem: integrationConnections.mrnIdentifierSystem,
  mrnNineDigitsVerified: integrationConnections.mrnNineDigitsVerified,
  patientWatermark: integrationConnections.patientWatermark,
  hasSynced: integrationConnections.hasSynced,
};

type Started = {
  connection: {
    id: string;
    isSandbox: boolean;
    baseUrl: string;
    tokenEndpoint: string | null;
    issuer: string | null;
    clientId: string;
    mrnIdentifierSystem: string;
    mrnNineDigitsVerified: boolean;
    patientWatermark: Date | null;
  };
  triggeredBy: string | null;
  trigger: string;
};

/** Where the work ran: the runtime function id and host, recorded in every audit event's metadata. */
export function runtimeWhere(): { function: string; host: string } {
  const safe = (value: string | undefined, fallback: string) =>
    value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : fallback;
  let host = "unknown";
  try {
    host = safe(hostname(), "unknown");
  } catch {
    // No hostname: leave it unknown.
  }
  return { function: safe(process.env.AWS_LAMBDA_FUNCTION_NAME, "next-server"), host };
}

function systemAudit(
  tenantId: string,
  action: AuditEvent["action"],
  entityId: string,
  reason: string,
  metadata: NonNullable<AuditEvent["metadata"]>,
): AuditEvent {
  const where = runtimeWhere();
  return {
    action,
    system: true,
    actorUserId: INTEGRATION_SERVICE_PRINCIPAL_ID,
    tenantId,
    entityType: "integration_connection",
    entityId,
    reason,
    metadata: { ...metadata, runtime_function: where.function, runtime_host: where.host },
  };
}

// -- claim ---------------------------------------------------------------------------------------

/**
 * `queued` -> `running`, in its own committed transaction (the read-only trigger looks the run up
 * from other transactions, so it has to be visible as `running` before any patient is written). A run
 * whose connection is no longer `active` is abandoned instead of started (a Pause between queueing
 * and running).
 */
async function claimRun(input: {
  tenantId: string;
  runId: string;
}): Promise<{ kind: "started"; started: Started } | { kind: "abandoned" }> {
  return withTenantAsSystem(input.tenantId, input.runId, async (tx, ctx) => {
    const [connection] = await tx
      .select(connectionColumns)
      .from(integrationConnections)
      .where(eq(integrationConnections.id, ctx.connectionId))
      .for("no key update");
    const [run] = await tx
      .select({
        status: integrationSyncRuns.status,
        trigger: integrationSyncRuns.trigger,
        triggeredBy: integrationSyncRuns.triggeredBy,
      })
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.id, input.runId))
      .for("update");
    if (!connection || !run) throw new Error("sync run or connection not found");
    // Only a queued run can be claimed: a second worker (or a replay) finds it already taken.
    if (run.status !== "queued") throw new Error("sync run is not queued");
    if (connection.status !== "active") {
      await tx
        .update(integrationSyncRuns)
        .set({ status: "abandoned", finishedAt: sql`now()` })
        .where(eq(integrationSyncRuns.id, input.runId));
      return { kind: "abandoned" } as const;
    }
    await tx
      .update(integrationSyncRuns)
      .set({ status: "running", startedAt: sql`now()`, heartbeatAt: sql`now()` })
      .where(eq(integrationSyncRuns.id, input.runId));
    await audit(
      tx,
      systemAudit(input.tenantId, "integration.sync_started", connection.id, "ehr_sync", {
        run_id: input.runId,
        trigger: run.trigger,
        triggered_by: run.triggeredBy,
        sandbox: connection.isSandbox,
      }),
    );
    return {
      kind: "started",
      started: { connection, triggeredBy: run.triggeredBy, trigger: run.trigger },
    } as const;
  });
}

// -- failure -------------------------------------------------------------------------------------

/** Anything a run can throw, collapsed to a fixed code. Never carries a message, URL, or value. */
export function toSyncFailure(error: unknown): SyncFailure {
  if (isSyncFailure(error)) return error;
  if (isFhirConnectError(error)) {
    if (error.outcome === "auth_refused") {
      return new SyncFailure("auth_refused", { connectionError: true });
    }
    // A refused address or redirect keeps its own code; other transport trouble reads as `unreachable`.
    if (error.outcome === "unreachable") return new SyncFailure(error.transportCode ?? "unreachable");
    // `not_fhir_r4` has a digit, which the `issue_codes` CHECK (`^[a-z_]{1,64}$`) refuses: stored as `not_fhir`.
    return new SyncFailure(error.outcome === "not_fhir_r4" ? "not_fhir" : error.outcome);
  }
  if (isTransportError(error)) return new SyncFailure(error.code);
  if (isNotSyntheticError(error)) return new SyncFailure("not_synthetic");
  if (error instanceof SigningKeyStoreError) return new SyncFailure("signing_key_unavailable");
  return new SyncFailure("internal_error");
}

async function finishFailed(
  input: { tenantId: string; runId: string },
  failure: SyncFailure,
  state: RunState,
): Promise<"failed" | "abandoned"> {
  return withTenantAsSystem(input.tenantId, input.runId, async (tx, ctx) => {
    const [connection] = await tx
      .select({ status: integrationConnections.status })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, ctx.connectionId))
      .for("no key update");
    const [run] = await tx
      .select({ status: integrationSyncRuns.status, triggeredBy: integrationSyncRuns.triggeredBy })
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.id, input.runId))
      .for("update");
    // Paused, revoked, or errored by someone else meanwhile: the database already abandoned the run.
    if (!run || run.status !== "running") return "abandoned";

    const codes = normalizeRunCodes([failure.code, ...state.codes]);
    await tx
      .update(integrationSyncRuns)
      .set({
        status: "failed",
        finishedAt: sql`now()`,
        issueCodes: codes,
        ...(failure.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
      })
      .where(eq(integrationSyncRuns.id, input.runId));
    const events: AuditEvent[] = [
      systemAudit(input.tenantId, "integration.sync_failed", ctx.connectionId, "ehr_sync", {
        run_id: input.runId,
        triggered_by: run.triggeredBy,
        code: failure.code,
        http_status: failure.httpStatus ?? null,
        created: state.counts.created,
        updated: state.counts.updated,
        linked: state.counts.linked,
        skipped: state.counts.skipped,
      }),
    ];
    if (SECURITY_TRANSPORT_CODES.some((code) => code === failure.code)) {
      events.push(
        systemAudit(input.tenantId, "integration.transport_refused", ctx.connectionId, "ehr_sync", {
          code: failure.code,
        }),
      );
    }
    // 401/403, `invalid_client`, or a changed token endpoint: the connection goes to `error`. The run
    // was finished above first, so the abandon trigger (0043) finds nothing to overwrite, and this is
    // the last write to the connection in the transaction: the database stamps the transition itself
    // (clock_timestamp(), 0043), so Resume can tell a later Test connection pass from an earlier one.
    if (failure.connectionError && connection?.status === "active") {
      await tx
        .update(integrationConnections)
        .set({
          status: "error",
          statusReason: failure.code,
          updatedBy: INTEGRATION_SERVICE_PRINCIPAL_ID,
          updatedAt: sql`now()`,
        })
        .where(eq(integrationConnections.id, ctx.connectionId));
      events.push(
        systemAudit(input.tenantId, "integration.connection_errored", ctx.connectionId, failure.code, {
          run_id: input.runId,
          reason_code: failure.code,
          previous_status: "active",
        }),
      );
    }
    for (const event of events) await audit(tx, event);
    return "failed";
  });
}

// -- the run -------------------------------------------------------------------------------------

interface RunState {
  counts: SyncCounts & { conflicts: number };
  /** Everything stored on the run passes through `normalizeRunCodes` (the allow-list, `other` for the rest). */
  codes: Set<SyncStoredCode>;
}

const newState = (): RunState => ({
  counts: { created: 0, updated: 0, linked: 0, unchanged: 0, skipped: 0, conflicts: 0 },
  codes: new Set(),
});

/** Raw entries of a page, split into Patient resources and the codes of any OperationOutcome. */
function splitEntries(
  bundle: { entry?: { resource?: unknown; search?: { mode?: string } }[] },
  state: RunState,
) {
  const rawPatients: Record<string, unknown>[] = [];
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (typeof resource !== "object" || resource === null) continue;
    const type = (resource as { resourceType?: unknown }).resourceType;
    if (type === "OperationOutcome" || entry.search?.mode === "outcome") {
      // Only R4 IssueType codes are kept; `diagnostics` is never read (spec PI2b "Mapping").
      for (const code of normalizeRunCodes(operationOutcomeCodes(resource))) state.codes.add(code);
      continue;
    }
    if (type === "Patient") rawPatients.push(resource as Record<string, unknown>);
  }
  return rawPatients;
}

const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

/** The environment rule for a run: a sandbox only where synthetic data is the only kind allowed, a real host only where it isn't. */
function assertRunEnvironment(connection: Started["connection"], synthetic: boolean): void {
  if (connection.isSandbox) {
    if (!synthetic) throw new SyncFailure("environment_refused");
    return;
  }
  if (synthetic && !VENDOR_SANDBOX_HOSTS.includes(new URL(connection.baseUrl).hostname)) {
    throw new SyncFailure("environment_refused");
  }
}

type CommitResult = { stopped: true } | { stopped: false };

/** At most this many re-derive batches per run (10,000 patients); the rest waits for the next run. */
const MAX_REDERIVE_ROUNDS = 100;

/**
 * Re-derives coverage for patients whose payer mapping is newer than their `synced_at` (see
 * `findRederiveCandidates`): finds a batch, fetches those patients' Coverage (through the same guarded,
 * budgeted client), applies the raw `SYN` guard where it applies, and commits the batch in its own
 * transaction under the same active-connection re-check as a page. Every patient in a batch leaves the
 * candidate set (its `synced_at` is refreshed), so the loop ends; `MAX_REDERIVE_ROUNDS` only bounds a
 * run's time.
 */
async function rederivePass(
  input: { tenantId: string; runId: string },
  state: RunState,
  pageContext: () => PageContext,
  search: PatientSearch,
  synthetic: boolean,
  mrnSystem: string,
): Promise<CommitResult> {
  for (let round = 0; round < MAX_REDERIVE_ROUNDS; round += 1) {
    const candidates = await withTenantAsSystem(input.tenantId, input.runId, (tx, ctx) =>
      findRederiveCandidates(tx, { tenantId: input.tenantId, connectionId: ctx.connectionId }),
    );
    if (candidates.length === 0) return { stopped: false };
    const rawCoverage = await search.coverageFor(candidates.map((candidate) => candidate.externalId));
    if (synthetic) assertSyntheticPage([], rawCoverage, mrnSystem);
    const coverage = groupCoverages(rawCoverage);
    const page = pageContext();
    const committed = await commitChecked(input, state, (tx) =>
      rederiveCoverage(
        tx,
        page,
        candidates.map((candidate) => candidate.id),
        coverage,
      ),
    );
    if (committed.stopped) return committed;
  }
  return { stopped: false };
}

async function pipeline(
  input: { tenantId: string; runId: string },
  started: Started,
  deps: SyncDeps,
  state: RunState,
): Promise<{ status: "done"; watermark: Date } | { status: "stopped" }> {
  const now = deps.now ?? (() => new Date());
  const synthetic = (deps.syntheticOnly ?? syntheticDataOnly)();
  const { connection } = started;
  const startedAt = now();

  assertRunEnvironment(connection, synthetic);
  const transport = deps.transportFor({ id: connection.id, isSandbox: connection.isSandbox });
  if (!transport) throw new SyncFailure("environment_refused");
  const signer = await deps.keyStore().signer(connection.id);

  // "Every run first checks the connection's issuer against discovery" (spec PI2b): before any token
  // is requested for patient data and before any upsert. A changed token endpoint is the more serious
  // change (the assertion would go somewhere new): the connection goes to `error`. Past draft both are
  // pinned, and a missing pin counts as a change (fail closed), as in Test connection.
  const discovery = await discover(transport, connection.baseUrl, { sandbox: connection.isSandbox });
  if (!discovery.algs.includes(signer.alg)) throw new SyncFailure("smart_config_invalid");
  if (
    synthetic &&
    !connection.isSandbox &&
    !VENDOR_SANDBOX_HOSTS.includes(new URL(discovery.tokenEndpoint).hostname)
  ) {
    throw new SyncFailure("environment_refused");
  }
  if (connection.tokenEndpoint !== discovery.tokenEndpoint) {
    throw new SyncFailure("token_endpoint_changed", { connectionError: true });
  }
  if (connection.issuer !== discovery.issuer) throw new SyncFailure("issuer_mismatch");

  const policy: RetryPolicy = {
    retries: deps.retry?.retries ?? MAX_RETRIES,
    baseDelayMs: deps.retry?.baseDelayMs ?? BASE_BACKOFF_MS,
    sleep: deps.sleep ?? defaultSleep,
  };
  const budget = deps.budget?.() ?? new RunBudget(DEFAULT_RUN_BUDGET, () => now().getTime());
  const tokens = createTokenSource({
    transport,
    connectionId: connection.id,
    clientId: connection.clientId,
    signer,
    discovery,
    policy,
    now,
  });
  const client = new FhirClient({ transport, base: new URL(connection.baseUrl), tokens, budget, policy });
  const search = new PatientSearch(client, connection.baseUrl);

  const mapping: MapPatientContext = {
    mrnSystem: connection.mrnIdentifierSystem,
    nineDigitsVerified: connection.mrnNineDigitsVerified,
    now: startedAt,
  };

  // Where only synthetic data is allowed, the first page is requested with `_count=1` and every raw
  // MRN and member ID must start with `SYN` before anything is transformed (spec "Synthetic guard").
  // A record that fails fails the run, and nothing has been stored yet.
  if (synthetic) {
    for await (const probe of search.patientPages(connection.patientWatermark, 1)) {
      const raw = splitEntries(probe, newState());
      const ids = raw
        .map((patient) => patient.id)
        .filter((id): id is string => typeof id === "string" && FHIR_ID.test(id));
      assertSyntheticPage(raw, await search.coverageFor(ids), mapping.mrnSystem);
      break;
    }
  }

  const issueRows = { remaining: MAX_ISSUE_ROWS_PER_RUN };
  const pageContext = (): PageContext => ({
    tenantId: input.tenantId,
    runId: input.runId,
    connectionId: connection.id,
    triggeredBy: started.triggeredBy,
    mrnSystem: mapping.mrnSystem,
    nineDigitsVerified: mapping.nineDigitsVerified,
    now: now(),
    encrypt: deps.encrypt ?? ((plaintext) => encryptField(plaintext)),
    decrypt: deps.decrypt ?? ((ciphertext) => decryptField(ciphertext)),
    runtime: runtimeWhere(),
    issueRows,
  });

  // A payer mapping saved after a patient's coverage was derived applies now, even to a patient that
  // hasn't changed at the EHR/PM (spec PI2b "Payer mapping"): before the patient pages, so it doesn't
  // wait on them.
  const rederived = await rederivePass(input, state, pageContext, search, synthetic, mapping.mrnSystem);
  if (rederived.stopped) return { status: "stopped" };

  let firstServerTime: Date | null = null;
  for await (const bundle of search.patientPages(connection.patientWatermark)) {
    firstServerTime ??= clampServerInstant(bundle.meta?.lastUpdated, startedAt) ?? startedAt;
    const rawPatients = splitEntries(bundle, state);
    const ids = [
      ...new Set(
        rawPatients
          .map((patient) => patient.id)
          .filter((id): id is string => typeof id === "string" && FHIR_ID.test(id)),
      ),
    ];
    const rawCoverage = ids.length > 0 ? await search.coverageFor(ids) : [];
    if (synthetic) assertSyntheticPage(rawPatients, rawCoverage, mapping.mrnSystem);
    const coverage = groupCoverages(rawCoverage);

    const page = pageContext();
    const committed = await commitChecked(input, state, (tx) => commitPage(tx, page, rawPatients, coverage));
    if (committed.stopped) return { status: "stopped" };
  }

  // Server timestamps are clamped (a future one beyond the skew allowance is our own now), so the
  // watermark never runs ahead of our clock; it trails the first page's server time by five minutes,
  // and never moves backwards.
  const serverTime = firstServerTime ?? startedAt;
  const ceiling = new Date(Math.min(serverTime.getTime(), now().getTime()));
  const candidate = new Date(ceiling.getTime() - WATERMARK_LAG_MS);
  const previous = connection.patientWatermark;
  return {
    status: "done",
    watermark: previous && previous.getTime() > candidate.getTime() ? previous : candidate,
  };
}

/**
 * Commits one page in its own transaction, first re-checking that the connection is still `active`
 * and the run still `running` (spec PI2b: "re-checks status = 'active' before each page commit"), under
 * a row lock that a concurrent Pause, revoke, or error must wait for. A run that started before a Pause
 * stops here, at its next page, instead of finishing.
 */
async function commitChecked(
  input: { tenantId: string; runId: string },
  state: RunState,
  work: (tx: TenantTx) => Promise<PageOutcome>,
): Promise<CommitResult> {
  return withTenantAsSystem(input.tenantId, input.runId, async (tx: TenantTx, ctx) => {
    const [connection] = await tx
      .select({ status: integrationConnections.status, hasSynced: integrationConnections.hasSynced })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, ctx.connectionId))
      .for("no key update");
    const [run] = await tx
      .select({ status: integrationSyncRuns.status })
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.id, input.runId))
      .for("update");
    if (!connection || connection.status !== "active" || !run || run.status !== "running") {
      return { stopped: true } as const;
    }

    const outcome = await work(tx);
    await tx
      .update(integrationSyncRuns)
      .set({
        createdCount: sql`${integrationSyncRuns.createdCount} + ${outcome.created}`,
        updatedCount: sql`${integrationSyncRuns.updatedCount} + ${outcome.updated}`,
        linkedCount: sql`${integrationSyncRuns.linkedCount} + ${outcome.linked}`,
        skippedCount: sql`${integrationSyncRuns.skippedCount} + ${outcome.skipped}`,
        heartbeatAt: sql`now()`,
      })
      .where(and(eq(integrationSyncRuns.tenantId, input.tenantId), eq(integrationSyncRuns.id, input.runId)));
    // "Has synced" locks the endpoint for good: set as soon as a page has stored a patient, so a run
    // that fails later still locks it (spec "Editability"). Not set by a page that stored nothing.
    if (outcome.storedAny && !connection.hasSynced) {
      await tx
        .update(integrationConnections)
        .set({ hasSynced: true, updatedBy: INTEGRATION_SERVICE_PRINCIPAL_ID, updatedAt: sql`now()` })
        .where(eq(integrationConnections.id, ctx.connectionId));
    }
    // Only after the page is safely in the transaction: memory follows the database.
    state.counts.created += outcome.created;
    state.counts.updated += outcome.updated;
    state.counts.linked += outcome.linked;
    state.counts.unchanged += outcome.unchanged;
    state.counts.skipped += outcome.skipped;
    state.counts.conflicts += outcome.conflicts;
    for (const code of outcome.codes) state.codes.add(code);
    return { stopped: false } as const;
  });
}

async function finishSucceeded(
  input: { tenantId: string; runId: string },
  watermark: Date,
  state: RunState,
): Promise<"succeeded" | "abandoned"> {
  return withTenantAsSystem(input.tenantId, input.runId, async (tx, ctx) => {
    const [connection] = await tx
      .select({ status: integrationConnections.status })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, ctx.connectionId))
      .for("no key update");
    const [run] = await tx
      .select({ status: integrationSyncRuns.status, triggeredBy: integrationSyncRuns.triggeredBy })
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.id, input.runId))
      .for("update");
    if (!connection || connection.status !== "active" || !run || run.status !== "running") return "abandoned";

    await tx
      .update(integrationSyncRuns)
      .set({
        status: "succeeded",
        finishedAt: sql`now()`,
        patientWatermark: watermark,
        issueCodes: normalizeRunCodes(state.codes),
      })
      .where(eq(integrationSyncRuns.id, input.runId));
    // The watermark advances only now, on success.
    await tx
      .update(integrationConnections)
      .set({
        patientWatermark: watermark,
        lastSuccessAt: sql`now()`,
        updatedBy: INTEGRATION_SERVICE_PRINCIPAL_ID,
        updatedAt: sql`now()`,
      })
      .where(eq(integrationConnections.id, ctx.connectionId));
    // The run-level record of receipt, including what was unchanged or skipped (spec "Audit events").
    await audit(
      tx,
      systemAudit(input.tenantId, "integration.sync_completed", ctx.connectionId, "ehr_sync", {
        run_id: input.runId,
        triggered_by: run.triggeredBy,
        created: state.counts.created,
        updated: state.counts.updated,
        linked: state.counts.linked,
        unchanged: state.counts.unchanged,
        skipped: state.counts.skipped,
        conflicts: state.counts.conflicts,
      }),
    );
    return "succeeded";
  });
}

function resultOf(
  runId: string,
  status: SyncRunResult["status"],
  state: RunState,
  failure?: SyncFailure,
): SyncRunResult {
  const { created, updated, linked, unchanged, skipped } = state.counts;
  return {
    runId,
    status,
    created,
    updated,
    linked,
    unchanged,
    skipped,
    codes: normalizeRunCodes([...(failure ? [failure.code] : []), ...state.codes]),
    ...(failure ? { failure: failure.code } : {}),
    ...(failure?.connectionError && status === "failed" ? { connectionErrored: true } : {}),
  };
}

/**
 * Executes one queued run to its end. Everything is through `withTenantAsSystem`; the network calls
 * run with no transaction open. Never throws for a run-level failure (it is recorded on the run and
 * returned); throws only if the run can't be claimed (not queued: someone else has it) or if even the
 * failure can't be recorded.
 */
export async function executeSyncRun(
  input: { tenantId: string; runId: string },
  deps: SyncDeps,
): Promise<SyncRunResult> {
  const claimed = await claimRun(input);
  const state = newState();
  if (claimed.kind === "abandoned") return resultOf(input.runId, "abandoned", state);

  const finish = (result: SyncRunResult): SyncRunResult => {
    log.info("integration.sync_finished", {
      runId: input.runId,
      tenantId: input.tenantId,
      connectionId: claimed.started.connection.id,
      status: result.status,
      count: result.created + result.updated + result.linked,
    });
    return result;
  };

  let failure: SyncFailure;
  try {
    const done = await pipeline(input, claimed.started, deps, state);
    if (done.status === "stopped") return finish(resultOf(input.runId, "abandoned", state));
    const status = await finishSucceeded(input, done.watermark, state);
    return finish(resultOf(input.runId, status, state));
  } catch (error) {
    failure = toSyncFailure(error);
    if (failure.code === "internal_error") {
      // The class name only: a message can carry a value. `errorName` is a code-shaped log key.
      log.error("integration.sync_internal_error", {
        runId: input.runId,
        connectionId: claimed.started.connection.id,
        errorName:
          error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : "Error",
      });
    }
  }
  const status = await finishFailed(input, failure, state);
  return finish(resultOf(input.runId, status, state, status === "failed" ? failure : undefined));
}

// -- Sync now ------------------------------------------------------------------------------------

function refuse(t: IntegrationsT, key: MessageKey<"integrations">): never {
  throw new IntegrationConnectionError(t(key));
}

/**
 * "Sync now" (administrator): queues a run and executes it in this request. Admin only, re-checked
 * here; the environment rule (a sandbox only where only synthetic data is allowed, and the reverse);
 * the connection must be `active` (and not revoked); once a minute per connection
 * (bucket `integration_sync_now`); one run at a time (a stale one is abandoned first, the 20 minute
 * lease). Returns the run's result; a run-level failure is a result, not an exception.
 */
export async function syncNow(
  run: TxRunner,
  actor: IntegrationActor,
  connectionId: string,
  deps: SyncDeps,
  t: IntegrationsT = englishT,
): Promise<SyncRunResult> {
  if (!canManageIntegrations(actor.role)) refuse(t, "error.notAdmin");
  const connection = await run(async (tx) => {
    const [row] = await tx
      .select({
        status: integrationConnections.status,
        isSandbox: integrationConnections.isSandbox,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connectionId));
    if (!row) refuse(t, "error.notFound");
    if (row.status === "revoked") refuse(t, "error.revoked");
    return row;
  });
  assertEnvironmentAllows(connection.isSandbox, actor, t);
  if (connection.status !== "active") refuse(t, "sync.error.notActive");

  const limited = await hit("integration_sync_now", `connection:${connectionId}`, deps.now?.());
  if (!limited.allowed) {
    await run((tx) =>
      audit(tx, {
        action: "security.rate_limited",
        actorUserId: actor.userId,
        tenantId: actor.tenantId,
        entityType: "integration_connection",
        entityId: connectionId,
        reason: "sync_now",
        metadata: { bucket: "integration_sync_now" },
      }),
    );
    refuse(t, "sync.error.rateLimited");
  }

  let runId: string;
  try {
    runId = await run(async (tx) => {
      // Re-read under a lock so a Pause between the read above and this insert is seen.
      const [locked] = await tx
        .select({ status: integrationConnections.status })
        .from(integrationConnections)
        .where(eq(integrationConnections.id, connectionId))
        .for("share");
      if (locked?.status !== "active") refuse(t, "sync.error.notActive");
      await abandonStaleRuns(tx, actor.tenantId, connectionId);
      if (await hasActiveRun(tx, actor.tenantId, connectionId)) refuse(t, "sync.error.alreadyRunning");
      return insertQueuedRun(tx, {
        tenantId: actor.tenantId,
        connectionId,
        trigger: "manual",
        triggeredBy: actor.userId,
      });
    });
  } catch (error) {
    if (isRunAlreadyActive(error)) refuse(t, "sync.error.alreadyRunning");
    throw error;
  }
  return executeSyncRun({ tenantId: actor.tenantId, runId }, deps);
}

/** The message key for why a run failed (used by the action; never contains remote text). */
export const SYNC_FAILURE_MESSAGE_KEYS = {
  auth_refused: "sync.failure.auth_refused",
  token_endpoint_changed: "sync.failure.token_endpoint_changed",
  issuer_mismatch: "sync.failure.issuer_mismatch",
  not_synthetic: "sync.failure.not_synthetic",
  environment_refused: "sync.failure.environment_refused",
  signing_key_unavailable: "sync.failure.signing_key_unavailable",
  unreachable: "sync.failure.unreachable",
  timeout: "sync.failure.unreachable",
  tls_failed: "sync.failure.unreachable",
  address_refused: "sync.failure.unreachable",
  redirect_refused: "sync.failure.unreachable",
  content_type_refused: "sync.failure.bad_response",
  bad_response: "sync.failure.bad_response",
  not_fhir: "sync.failure.bad_response",
  smart_config_invalid: "sync.failure.bad_response",
  capability_missing: "sync.failure.capability_missing",
  too_large: "sync.failure.too_large",
  paging_loop: "sync.failure.too_large",
  connection_not_active: "sync.failure.other",
  internal_error: "sync.failure.other",
} as const satisfies Record<SyncFailureCode, MessageKey<"integrations">>;

/** One translated sentence for a run's result: the counts, or the reason it stopped. */
export function syncResultMessage(result: SyncRunResult, t: IntegrationsT = englishT): string {
  if (result.status === "failed" && result.failure) return t(SYNC_FAILURE_MESSAGE_KEYS[result.failure]);
  if (result.status === "abandoned") return t("sync.result.abandoned");
  return t("sync.result.succeeded", {
    created: result.created,
    updated: result.updated,
    linked: result.linked,
    skipped: result.skipped,
  });
}
