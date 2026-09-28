import { randomUUID } from "node:crypto";
import { isValidElement } from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { integrationSyncIssues } from "@/db/schema";
import { getSyncRunIssues, listSyncRuns, MAX_SYNC_ISSUES_SHOWN } from "@/domain/integrations/sync-history";
import {
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
let auth: { tenantId: string; userId: string; role: Role; mfaVerifiedAt?: Date | null };
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
  await finishRun(ctx, second, { status: "failed", issueCodes: ["rate_limited"], httpStatus: 429 });
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
      issueCodes: ["rate_limited"],
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
    expect((await runs(ctx, connectionId, 3, 2)).runs).toEqual([]);
  });

  it("is empty for a connection that never synced", async () => {
    const { ctx, connectionId } = await practiceWithActiveConnection("Sync history empty");
    expect(await runs(ctx, connectionId)).toEqual({ runs: [], total: 0 });
  });

  it("is tenant-scoped: another practice sees none of a connection's runs, issues, or counts", async () => {
    const { connectionId, first } = await practiceWithRuns();
    const other = await createTestTenant("Sync history other");
    expect(await runs(other, connectionId)).toEqual({ runs: [], total: 0 });
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
      "mrn_missing",
      "linked_to_source",
      "rate_limited",
      "Succeeded",
      "Failed",
      "Running",
    ]) {
      expect(text).toContain(expected);
    }
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

  it("says what is missing and what happens next when nothing has synced yet", async () => {
    const { ctx, connectionId } = await practiceWithActiveConnection("Sync history page empty");
    auth = { ...ctx, role: "admin" };
    const shown = { text: [] as string[], hrefs: [] as string[] };
    collect(await SyncHistoryPage(params(connectionId)), shown);
    expect(shown.text).toContain("No sync has run yet");
  });
});
