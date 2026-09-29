/**
 * Shared setup for the PI2b sync-engine integration tests (docs/specs/patient-integrations.md PI2b):
 * a signing key generated at test time, the real in-process `SandboxTransport` (optionally wrapped so a
 * test can fail, alter, or pause a request), an active built-in-sandbox connection made the way an
 * administrator makes one (create, Test connection, Submit), and readers for what a run left behind.
 * Everything is synthetic; no key material is committed.
 */
import { generateKeyPairSync } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import {
  auditEvents,
  integrationConnections,
  integrationPayerMappings,
  integrationSyncIssues,
  integrationSyncRuns,
  patients,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  createSandboxConnection,
  getConnection,
  submitConnection,
  type IntegrationActor,
} from "@/domain/integrations/connections";
import { executeSyncRun, type SyncDeps, type SyncRunResult } from "@/domain/integrations/sync";
import { insertQueuedRun } from "@/domain/integrations/sync-runs";
import {
  testConnection,
  type TestConnectionDeps,
  type TxRunner,
} from "@/domain/integrations/test-connection";
import { EnvSharedKeyStore } from "@/integrations/fhir/keys";
import { SandboxDataset } from "@/integrations/fhir/sandbox/dataset";
import { SandboxState, SandboxTransport } from "@/integrations/fhir/sandbox/transport";
import type { Transport, TransportRequestInit, TransportResponse } from "@/integrations/fhir/transport";

export type Ctx = { tenantId: string; userId: string };

const privateKey = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey;
export const signingKeyStore = new EnvSharedKeyStore(
  () => true,
  privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
);

/** An administrator of the practice, in an environment where only synthetic data is allowed. */
export const adminActor = (ctx: Ctx, options: { synthetic?: boolean } = {}): IntegrationActor => ({
  ...ctx,
  role: "admin",
  syntheticOnly: options.synthetic ?? true,
  recentMfa: true,
  stepUpVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
});

export const runnerFor =
  (ctx: Ctx): TxRunner =>
  (fn) =>
    withTenant(ctx, fn);

/** Wraps a request: call `next()` for the real answer, or answer/throw instead. `n` counts requests from 1. */
export type Intercept = (
  init: TransportRequestInit,
  next: () => Promise<TransportResponse>,
  n: number,
) => Promise<TransportResponse>;

/** Records every request and lets a test interfere with any of them. */
export class InterceptingTransport implements Transport {
  readonly requests: TransportRequestInit[] = [];
  intercept: Intercept | undefined;

  constructor(private readonly inner: Transport) {}

  request(init: TransportRequestInit): Promise<TransportResponse> {
    this.requests.push(init);
    const next = () => this.inner.request(init);
    return this.intercept ? this.intercept(init, next, this.requests.length) : next();
  }

  /** Requests to the FHIR base URL's `resource` (e.g. "Patient"), method and full URL. */
  to(resource: string): TransportRequestInit[] {
    return this.requests.filter((request) => new URL(request.url).pathname.endsWith(`/${resource}`));
  }
}

export interface Harness {
  dataset: SandboxDataset;
  transport: InterceptingTransport;
  /** Both `TestConnectionDeps` and `SyncDeps`: the same wiring the application uses. */
  deps: TestConnectionDeps & SyncDeps;
  /** The clock the sandbox and the engine both read; move it to model time passing. */
  clock: { current: Date };
  /** Backoff waits the engine asked for (nothing actually waits). */
  sleeps: number[];
}

/** A sandbox harness: the real `SandboxTransport` over a fresh dataset, in a synthetic-only environment. */
export function harness(options: { dataset?: SandboxDataset; serverClock?: () => Date } = {}): Harness {
  const clock = { current: new Date() };
  const dataset = options.dataset ?? new SandboxDataset();
  const sandbox = new SandboxTransport({
    publicKeys: () => signingKeyStore.publicJwks(),
    synthetic: () => true,
    dataset,
    now: options.serverClock ?? (() => clock.current),
    state: new SandboxState(),
  });
  const transport = new InterceptingTransport(sandbox);
  const sleeps: number[] = [];
  return {
    dataset,
    transport,
    clock,
    sleeps,
    deps: {
      transportFor: () => transport,
      keyStore: () => signingKeyStore,
      syntheticOnly: () => true,
      now: () => clock.current,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  };
}

export async function stampOf(ctx: Ctx, id: string): Promise<string> {
  return (await withTenant(ctx, (tx) => getConnection(tx, id)))!.updatedAt.toISOString();
}

/**
 * An `active` built-in sandbox connection, made the way an administrator makes one: create, a real
 * Test connection against the in-process sandbox (which pins the token endpoint and issuer), Submit.
 */
export async function activeSandbox(ctx: Ctx, h: Harness): Promise<string> {
  const { id } = await withTenant(ctx, (tx) =>
    createSandboxConnection(tx, adminActor(ctx), { displayName: "Synthetic sandbox" }),
  );
  const tested = await testConnection(runnerFor(ctx), adminActor(ctx), id, h.deps);
  if (tested.outcome !== "ok") throw new Error(`the sandbox test failed: ${tested.outcome}`);
  await submitConnection(
    runnerFor(ctx),
    adminActor(ctx),
    id,
    await stampOf(ctx, id),
    { attested: false, locale: "en" },
    h.deps,
  );
  return id;
}

/**
 * An `active` connection to a (synthetic, `.test`) real-style EHR, inserted directly as the table owner:
 * the approval flow that produces one in production is covered elsewhere, and PI2b must refuse to sync it
 * until the population scope can be applied (PI4). Nothing here is ever dialed.
 */
export async function activeRealConnection(ctx: Ctx): Promise<string> {
  const host = `real-ehr-${Math.random().toString(36).slice(2, 10)}.example.test`;
  const [row] = await systemDb()
    .insert(integrationConnections)
    .values({
      tenantId: ctx.tenantId,
      displayName: "Synthetic real-style EHR",
      baseUrl: `https://${host}/r4`,
      endpointKey: `https://${host}/r4`,
      tokenEndpoint: `https://${host}/token`,
      tokenEndpointKey: `https://${host}/token`,
      issuer: `https://${host}/r4`,
      clientId: "client-synthetic-real",
      mrnIdentifierSystem: `https://${host}/mrn`,
      status: "active",
      // integration_connections_approved_when_live (0039): a live real connection carries the operator's
      // approval, its method and the population scope, together.
      approvedBy: ctx.userId,
      approvedAt: new Date(),
      approvalMethod: "video_call",
      populationScope: "group_export",
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: integrationConnections.id });
  return row!.id;
}

export async function queueRun(ctx: Ctx, connectionId: string): Promise<string> {
  return withTenant(ctx, (tx) =>
    insertQueuedRun(tx, { tenantId: ctx.tenantId, connectionId, trigger: "manual", triggeredBy: ctx.userId }),
  );
}

/** Queues and executes one run, returning its id and result. */
export async function runSync(
  ctx: Ctx,
  connectionId: string,
  h: Harness,
  deps: SyncDeps = h.deps,
): Promise<{ runId: string; result: SyncRunResult }> {
  const runId = await queueRun(ctx, connectionId);
  const result = await executeSyncRun({ tenantId: ctx.tenantId, runId }, deps);
  return { runId, result };
}

// -- readers (as the table owner: the test database's superuser, like the other integration tests) ------

export async function connectionRow(id: string) {
  const [row] = await systemDb()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  return row!;
}

export async function runRow(runId: string) {
  const [row] = await systemDb().select().from(integrationSyncRuns).where(eq(integrationSyncRuns.id, runId));
  return row!;
}

export async function patientRows(ctx: Ctx) {
  return systemDb()
    .select()
    .from(patients)
    .where(eq(patients.tenantId, ctx.tenantId))
    .orderBy(asc(patients.externalId));
}

export async function issueRows(runId: string) {
  return systemDb().select().from(integrationSyncIssues).where(eq(integrationSyncIssues.runId, runId));
}

export async function mappingRows(connectionId: string) {
  return systemDb()
    .select()
    .from(integrationPayerMappings)
    .where(eq(integrationPayerMappings.connectionId, connectionId))
    .orderBy(asc(integrationPayerMappings.payorKey));
}

export async function auditRows(tenantId: string) {
  return await systemDb()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, tenantId))
    .orderBy(asc(auditEvents.id));
}
