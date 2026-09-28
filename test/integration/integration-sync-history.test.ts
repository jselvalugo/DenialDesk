import { randomUUID } from "node:crypto";
import { isValidElement, type ReactElement } from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { integrationSyncIssues } from "@/db/schema";
import {
  getSyncRunIssues,
  listSyncRuns,
  MAX_SYNC_ISSUES_SHOWN,
  SYNC_RUNS_PAGE_SIZE,
} from "@/domain/integrations/sync-history";
import {
  abandonedRuns,
  finishRun,
  issueRow,
  practiceWithActiveConnection,
  runningRun,
  syncedPatient,
  type Ctx,
} from "../support/sync-fixtures";
import { createTestTenant } from "./helpers";

// docs/specs/patient-integrations.md PI2b, "Sync history (/settings/integrations/[id]/runs, admin)":
// counts and codes, issue rows that link to DenialDesk patient IDs, no PHI on the page. R-7.2.4
// (tenant isolation), R-7.5.1. The domain reads and the page, against the real database; only the
// session, request headers, and Next's notFound are faked. The runs and issues are written the way the
// sync engine will write them (another slice), through the practice's role.

type Role = "admin" | "manager" | "specialist" | "compliance";
let auth: { tenantId: string; userId: string; role: Role; mfaVerifiedAt?: Date | null; sessionId?: string };
vi.mock("@/auth/session", () => ({ requireAuth: async () => auth }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": "en" }),
}));
class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("not found");
  },
}));

const { default: SyncHistoryPage } = await import("@/app/(app)/settings/integrations/[id]/runs/page");

afterAll(() => closeDatabase());

/** Three runs, oldest first: succeeded with counts and codes, failed on an HTTP 429, and one still running. */
async function practiceWithRuns() {
  const { ctx, connectionId } = await practiceWithActiveConnection("Sync history");
  const first = await runningRun(ctx, connectionId);
  const patientId = await syncedPatient(ctx, connectionId, first, "Organization/ins-alpha");
  const skipped = await issueRow(ctx, first, "mrn_missing", null);
  const linked = await issueRow(ctx, first, "linked_to_source", patientId);
  await finishRun(ctx, first, {
    created: 5,
    updated: 3,
    linked: 1,
    skipped: 2,
    issueCodes: ["mrn_missing", "linked_to_source"],
    httpStatus: 200,
  });
  const second = await runningRun(ctx, connectionId);
  await finishRun(ctx, second, { status: "failed", issueCodes: ["throttled"], httpStatus: 429 });
  const third = await runningRun(ctx, connectionId);
  return { ctx, connectionId, first, second, third, patientId, skipped, linked };
}

async function runs(ctx: Ctx, connectionId: string, page = 1, size?: number) {
  return withTenant(ctx, (tx) => listSyncRuns(tx, connectionId, page, size));
}

describe("listing a connection's sync runs", () => {
  it("lists runs newest first as counts, codes, status, times, and an HTTP status, and nothing else", async () => {
    const { ctx, connectionId, first, second, third } = await practiceWithRuns();
    const { runs: rows, total } = await runs(ctx, connectionId);
    expect(total).toBe(3);
    expect(rows.map((run) => run.id)).toEqual([third, second, first]);

    expect(rows[2]).toEqual({
      id: first,
      trigger: "manual",
      status: "succeeded",
      queuedAt: expect.any(Date),
      startedAt: expect.any(Date),
      finishedAt: expect.any(Date),
      createdCount: 5,
      updatedCount: 3,
      linkedCount: 1,
      skippedCount: 2,
      issueCodes: ["mrn_missing", "linked_to_source"],
      httpStatus: 200,
      issueCount: 2,
    });
    expect(rows[1]).toMatchObject({
      status: "failed",
      httpStatus: 429,
      issueCodes: ["throttled"],
      issueCount: 0,
    });
    expect(rows[0]).toMatchObject({ status: "running", finishedAt: null, httpStatus: null, issueCodes: [] });

    // What a run row can show is fixed by the query: no user ID (who pressed Sync now), no watermark,
    // no tenant or connection ID, nothing from the EHR.
    expect(Object.keys(rows[2]!).sort()).toEqual(
      [
        "createdCount",
        "finishedAt",
        "httpStatus",
        "id",
        "issueCodes",
        "issueCount",
        "linkedCount",
        "queuedAt",
        "skippedCount",
        "startedAt",
        "status",
        "trigger",
        "updatedCount",
      ].sort(),
    );
  });

  it("pages: the total, the page's runs, and nothing past the end", async () => {
    const { ctx, connectionId, first, second, third } = await practiceWithRuns();
    const one = await runs(ctx, connectionId, 1, 2);
    expect(one.total).toBe(3);
    expect(one.runs.map((run) => run.id)).toEqual([third, second]);
    const two = await runs(ctx, connectionId, 2, 2);
    expect(two.runs.map((run) => run.id)).toEqual([first]);
    expect(one.page).toBe(1);
    expect(two.page).toBe(2);
    // A page past the end is clamped to the last page: runs are never hidden behind an empty page.
    const past = await runs(ctx, connectionId, 9, 2);
    expect(past.page).toBe(2);
    expect(past.runs.map((run) => run.id)).toEqual([first]);
    expect(past.total).toBe(3);
    // Nonsense pages read as the first.
    for (const page of [0, -4]) expect((await runs(ctx, connectionId, page, 2)).page).toBe(1);
  });

  it("is empty for a connection that never synced", async () => {
    const { ctx, connectionId } = await practiceWithActiveConnection("Sync history empty");
    expect(await runs(ctx, connectionId)).toEqual({ runs: [], total: 0, page: 1 });
  });

  it("is tenant-scoped: another practice sees none of a connection's runs, issues, or counts", async () => {
    const { connectionId, first } = await practiceWithRuns();
    const other = await createTestTenant("Sync history other");
    expect(await runs(other, connectionId)).toEqual({ runs: [], total: 0, page: 1 });
    expect(await withTenant(other, (tx) => getSyncRunIssues(tx, connectionId, first))).toBeNull();
  });
});

describe("the issues of one run", () => {
  it("lists a run's issue codes with the DenialDesk patient they are about, oldest first, and nothing else", async () => {
    const { ctx, connectionId, first, patientId, skipped, linked } = await practiceWithRuns();
    const result = await withTenant(ctx, (tx) => getSyncRunIssues(tx, connectionId, first));
    expect(result).toEqual({
      truncated: false,
      issues: [
        { id: skipped, code: "mrn_missing", patientId: null, createdAt: expect.any(Date) },
        { id: linked, code: "linked_to_source", patientId, createdAt: expect.any(Date) },
      ],
    });
    // An issue row shows a code and an opaque DenialDesk patient ID, never a resource, an external ID, or a name.
    expect(Object.keys(result!.issues[1]!).sort()).toEqual(["code", "createdAt", "id", "patientId"]);
  });

  it("finds a run only under its own connection and practice: any other run ID is not found", async () => {
    const mine = await practiceWithRuns();
    const theirs = await practiceWithRuns();
    // Another practice's run, asked for through my connection and my session.
    expect(
      await withTenant(mine.ctx, (tx) => getSyncRunIssues(tx, mine.connectionId, theirs.first)),
    ).toBeNull();
    // My run, asked for through another practice's connection.
    expect(
      await withTenant(mine.ctx, (tx) => getSyncRunIssues(tx, theirs.connectionId, mine.first)),
    ).toBeNull();
    // A run that exists nowhere.
    expect(
      await withTenant(mine.ctx, (tx) => getSyncRunIssues(tx, mine.connectionId, randomUUID())),
    ).toBeNull();
    // A run with no issues is a run, with an empty list.
    expect(await withTenant(mine.ctx, (tx) => getSyncRunIssues(tx, mine.connectionId, mine.second))).toEqual({
      issues: [],
      truncated: false,
    });
  });

  it("lists at most a bounded number of issues and says when there were more", async () => {
    const { ctx, connectionId, third } = await practiceWithRuns();
    await withTenant(ctx, (tx) =>
      tx.insert(integrationSyncIssues).values(
        Array.from({ length: MAX_SYNC_ISSUES_SHOWN + 1 }, () => ({
          tenantId: ctx.tenantId,
          runId: third,
          code: "name_incomplete",
        })),
      ),
    );
    const result = await withTenant(ctx, (tx) => getSyncRunIssues(tx, connectionId, third));
    expect(result!.issues).toHaveLength(MAX_SYNC_ISSUES_SHOWN);
    expect(result!.truncated).toBe(true);
  });
});

/** Every element in a tree (the page's own JSX, before any component runs) whose props satisfy `match`. */
function findElements(
  node: unknown,
  match: (props: Record<string, unknown>) => boolean,
  found: ReactElement<Record<string, unknown>>[] = [],
): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, match, found);
  } else if (isValidElement<Record<string, unknown>>(node)) {
    if (match(node.props)) found.push(node);
    for (const value of Object.values(node.props)) findElements(value, match, found);
  }
  return found;
}

/** The text and links of an element tree as the page built it (its children as literal JSX). */
function collect(node: unknown, out: { text: string[]; hrefs: string[] }): void {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    out.text.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return;
  }
  if (!isValidElement(node)) return;
  for (const [name, value] of Object.entries(node.props as Record<string, unknown>)) {
    if (name === "href" && typeof value === "string") out.hrefs.push(value);
    else if (name === "className") continue;
    else if (typeof value === "string" || typeof value === "number") out.text.push(String(value));
    else collect(value, out);
  }
}

const params = (id: string, search: { page?: string; run?: string } = {}) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(search),
});

describe("the sync history page", () => {
  it("is administrators only: any other role, and any invalid, foreign, or unknown connection, is a 404", async () => {
    const mine = await practiceWithRuns();
    const theirs = await practiceWithRuns();
    for (const role of ["manager", "specialist", "compliance"] as const) {
      auth = { ...mine.ctx, role };
      await expect(SyncHistoryPage(params(mine.connectionId))).rejects.toBeInstanceOf(NotFound);
    }
    auth = { ...mine.ctx, role: "admin" };
    await expect(SyncHistoryPage(params("not-a-uuid"))).rejects.toBeInstanceOf(NotFound);
    await expect(SyncHistoryPage(params(theirs.connectionId))).rejects.toBeInstanceOf(NotFound);
    await expect(SyncHistoryPage(params(randomUUID()))).rejects.toBeInstanceOf(NotFound);
  });

  it("shows counts and codes, links an issue to the DenialDesk patient, and carries no PHI", async () => {
    const { ctx, connectionId, first, patientId } = await practiceWithRuns();
    auth = { ...ctx, role: "admin" };
    const shown = { text: [] as string[], hrefs: [] as string[] };
    collect(await SyncHistoryPage(params(connectionId, { run: first })), shown);
    const text = shown.text.join(" | ");

    // The counts and codes of the runs, and the issue codes of the selected one.
    for (const expected of [
      "No medical record number",
      "Linked to an existing patient",
      "The EHR/PM limited the request rate",
      "Succeeded",
      "Failed",
      "Running",
    ]) {
      expect(text).toContain(expected);
    }
    // Codes are shown as their translated labels, never as the stored strings.
    for (const raw of ["mrn_missing", "linked_to_source", "throttled"]) expect(text).not.toContain(raw);
    expect(shown.text).toContain("5");
    expect(shown.text).toContain("429");
    // An issue row links to the DenialDesk patient by its own ID, and to nothing else outside settings.
    expect(shown.hrefs).toContain(`/patients/${patientId}`);
    for (const href of shown.hrefs) {
      expect(href).toMatch(
        new RegExp(`^(/settings/integrations(/${connectionId}(/runs.*)?)?|/patients/${patientId})$`),
      );
    }
    // No PHI anywhere on the page: not the synced patient's name, MRN, or external ID, and no payor key.
    const phi = /Synthia|Testpatient|SYN-[0-9a-f]{8}|ext-[0-9a-f]{8}|Organization\//;
    expect(text).not.toMatch(phi);
    expect(shown.hrefs.join(" ")).not.toMatch(phi);
  });

  it("shows a message, not another practice's issues, for a run that isn't this connection's", async () => {
    const mine = await practiceWithRuns();
    const theirs = await practiceWithRuns();
    auth = { ...mine.ctx, role: "admin" };
    const shown = { text: [] as string[], hrefs: [] as string[] };
    collect(await SyncHistoryPage(params(mine.connectionId, { run: theirs.first })), shown);
    expect(shown.text.join(" | ")).toContain("That run isn't part of this connection.");
    expect(shown.hrefs.some((href) => href.includes(theirs.patientId))).toBe(false);
  });

  it('shows a stored code that isn\'t on the allow-list as "Other", never the raw string', async () => {
    const { ctx, connectionId } = await practiceWithActiveConnection("Sync history unknown code");
    const run = await runningRun(ctx, connectionId);
    const patientId = await syncedPatient(ctx, connectionId, run, "Organization/ins-alpha");
    // Shapes the database accepts (`^[a-z_]{1,64}$`) but that the page must never echo: a sensitivity
    // word on a patient-linked issue, and unlisted run-level codes next to a listed one.
    await issueRow(ctx, run, "hiv_positive_flag", patientId);
    await issueRow(ctx, run, "needs_review", patientId);
    await finishRun(ctx, run, {
      issueCodes: ["zz_unlisted_code", "part2_program_patient", "throttled"],
    });
    auth = { ...ctx, role: "admin" };
    const shown = { text: [] as string[], hrefs: [] as string[] };
    collect(await SyncHistoryPage(params(connectionId, { run })), shown);
    const text = shown.text.join(" | ");

    expect(text).not.toMatch(/hiv_positive_flag|zz_unlisted_code|part2_program_patient/);
    // The unlisted issue code, and the unlisted run codes (once), read "Other"; listed codes keep their label.
    expect(shown.text.filter((entry) => entry === "Other")).toHaveLength(2);
    expect(text).toContain("The EHR/PM limited the request rate");
    expect(text).toContain("Coverage needs review");
  });

  it("audits opening one run's issue rows with the run ID and row count, and nothing else opens it", async () => {
    const { ctx, connectionId, first, second } = await practiceWithRuns();
    auth = { ...ctx, role: "admin", sessionId: randomUUID() };
    const events = async (runId: string) =>
      systemDb()
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, "integration.sync_run_viewed"), eq(auditEvents.entityId, runId)));

    // The run list alone (counts and codes) is not a read of per-patient rows.
    await SyncHistoryPage(params(connectionId));
    expect(await events(first)).toEqual([]);

    await SyncHistoryPage(params(connectionId, { run: first }));
    const recorded = await events(first);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actorUserId: ctx.userId,
      tenantId: ctx.tenantId,
      entityType: "integration_sync_run",
      entityId: first,
      reason: "sync_history",
    });
    // IDs and a count only: no codes, no patient ID.
    expect(recorded[0]!.metadata).toEqual({
      connection_id: connectionId,
      row_count: 2,
      session_id: auth.sessionId,
    });
    expect(JSON.stringify(recorded[0])).not.toMatch(/mrn_missing|patients\//);

    // A run with no issues is opened with a count of zero; a run that isn't this connection's is not audited.
    await SyncHistoryPage(params(connectionId, { run: second }));
    expect((await events(second))[0]!.metadata).toMatchObject({ row_count: 0 });
    const other = await practiceWithRuns();
    await SyncHistoryPage(params(connectionId, { run: other.first }));
    expect(await events(other.first)).toEqual([]);
  });

  it("pages past the default page size: page 2 holds the rest, and a page past the end keeps the table and the pager", async () => {
    const { ctx, connectionId } = await practiceWithActiveConnection("Sync history pages");
    const all = await abandonedRuns(ctx, connectionId, SYNC_RUNS_PAGE_SIZE + 1);
    auth = { ...ctx, role: "admin" };

    const rowsOf = (page: unknown) =>
      findElements(
        page,
        (props) => typeof props.caption === "string" && props.caption === "Sync runs, newest first",
      ).flatMap((table) => findElements(table.props.children, (props) => "selected" in props)).length;
    const pageOne = await SyncHistoryPage(params(connectionId));
    const pageTwo = await SyncHistoryPage(params(connectionId, { page: "2" }));
    expect(rowsOf(pageOne)).toBe(SYNC_RUNS_PAGE_SIZE);
    expect(rowsOf(pageTwo)).toBe(1);
    expect(all).toHaveLength(SYNC_RUNS_PAGE_SIZE + 1);

    // A stale or hand-edited page number shows the last page, not the "nothing has synced" message.
    for (const page of ["3", "999", "0", "abc"]) {
      const shown = { text: [] as string[], hrefs: [] as string[] };
      const past = await SyncHistoryPage(params(connectionId, { page }));
      collect(past, shown);
      expect(shown.text).not.toContain("No sync has run yet");
      expect(rowsOf(past)).toBeGreaterThan(0);
      const [pager] = findElements(past, (props) => "hrefFor" in props && "total" in props);
      expect(pager!.props.total).toBe(SYNC_RUNS_PAGE_SIZE + 1);
      expect(pager!.props.page).toBe(page === "0" || page === "abc" ? 1 : 2);
    }
  });

  it("says what is missing and what happens next when nothing has synced yet", async () => {
    const { ctx, connectionId } = await practiceWithActiveConnection("Sync history page empty");
    auth = { ...ctx, role: "admin" };
    const shown = { text: [] as string[], hrefs: [] as string[] };
    collect(await SyncHistoryPage(params(connectionId)), shown);
    expect(shown.text).toContain("No sync has run yet");
  });
});
