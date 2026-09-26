import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { auditEvents, rcmFiles, rcmJournalLines, rcmJournalVouchers } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { listFiles } from "@/domain/revenue-cycle/imports";
import { allPassed } from "@/domain/revenue-cycle/journal";
import { periodFiles } from "@/domain/revenue-cycle/periods";
import {
  approveVoucher,
  exportVoucher,
  getVoucher,
  prepareVoucher,
  voidVoucher,
  VoucherError,
  type Actor,
} from "@/domain/revenue-cycle/vouchers";
import { generateDataset } from "@/domain/synthetic/generator";
import { parseCsv } from "@/lib/csv/parse";
import { expectDbError } from "./helpers";

interface Practice {
  tenantId: string;
  manager: Actor;
  admin: Actor;
  compliance: Actor;
}
let a: Practice;
let b: Practice;

async function practice(label: string, seed: number): Promise<Practice> {
  const suffix = `${label}-${Date.now()}-${seed}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `RCM vouchers ${suffix} (synthetic)`,
    asOf: todayIn(),
    users: [
      { email: `jv-mgr-${suffix}@synthetic.test`, displayName: "RCM Manager", role: "manager" },
      { email: `jv-admin-${suffix}@synthetic.test`, displayName: "Practice Admin", role: "admin" },
      { email: `jv-comp-${suffix}@synthetic.test`, displayName: "Compliance", role: "compliance" },
    ],
    dataset: generateDataset({ asOf: todayIn(), seed, patients: 3, claims: 6 }),
  });
  const actor = (i: number, role: Actor["role"]): Actor => ({ tenantId, userId: userIds[i]!, role });
  return {
    tenantId,
    manager: actor(0, "manager"),
    admin: actor(1, "admin"),
    compliance: actor(2, "compliance"),
  };
}

beforeAll(async () => {
  a = await practice("alpha", 41);
  b = await practice("beta", 42);
});

afterAll(() => closeDatabase());

const files = (p: Practice) => withTenant(p.manager, (tx) => periodFiles(tx));

describe("preparing a voucher", () => {
  it("builds a balanced draft whose five checks pass, and audits it", async () => {
    const [, , latest] = await files(a);
    const id = await withTenant(a.manager, (tx) => prepareVoucher(tx, a.manager, latest!.fileId));
    const detail = (await withTenant(a.manager, (tx) => getVoucher(tx, id)))!;
    expect(detail.voucher).toMatchObject({ status: "draft", version: 1 });
    expect(detail.voucher.number).toMatch(/^RCM-\d{4}-\d{2}-v1$/);
    expect(detail.voucher.debitCents).toBe(detail.voucher.creditCents);
    expect(detail.checks.map((c) => [c.id, c.passed])).toEqual([
      ["balanced", true],
      ["ties_to_file", true],
      ["receivables_tie", true],
      ["accounts_valid", true],
      ["not_posted_twice", true],
    ]);
    // The simulation moves open patient shares to self-pay, so receivables are reclassified.
    expect(detail.lines.some((l) => l.role === "reclass")).toBe(true);
    const events = await withTenant(a.manager, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.entityId, id)),
    );
    expect(events.map((e) => e.action)).toEqual(["rcm.voucher_prepared"]);
  });

  it("uses the practice's GL for the first imported month's opening balances", async () => {
    const [oldest] = await files(a);
    const id = await withTenant(a.manager, (tx) => prepareVoucher(tx, a.manager, oldest!.fileId));
    const detail = (await withTenant(a.manager, (tx) => getVoucher(tx, id)))!;
    expect(detail.lines.some((l) => l.role === "reclass")).toBe(false);
    expect(detail.checks.find((c) => c.id === "receivables_tie")!.detail).toMatch(/First imported month/);
    expect(allPassed(detail.checks)).toBe(true);
  });

  it("supersedes the earlier draft when prepared again", async () => {
    const [, , latest] = await files(a);
    const id = await withTenant(a.manager, (tx) => prepareVoucher(tx, a.manager, latest!.fileId));
    const vouchers = await withTenant(a.manager, (tx) =>
      tx
        .select({
          id: rcmJournalVouchers.id,
          status: rcmJournalVouchers.status,
          version: rcmJournalVouchers.version,
        })
        .from(rcmJournalVouchers)
        .where(
          and(
            eq(rcmJournalVouchers.periodYear, latest!.periodYear),
            eq(rcmJournalVouchers.periodMonth, latest!.periodMonth),
          ),
        )
        .orderBy(rcmJournalVouchers.version),
    );
    expect(vouchers.map((v) => [v.status, v.version])).toEqual([
      ["superseded", 1],
      ["draft", 2],
    ]);
    expect(vouchers[1]!.id).toBe(id);
  });

  it("refuses roles that don't run month-end and files in the earlier layout", async () => {
    const [, , latest] = await files(a);
    await expect(
      withTenant(a.compliance, (tx) => prepareVoucher(tx, a.compliance, latest!.fileId)),
    ).rejects.toThrow(VoucherError);
    const legacy = await withTenant(a.admin, async (tx) => {
      const [row] = await tx
        .insert(rcmFiles)
        .values({
          tenantId: a.tenantId,
          uploadedBy: a.admin.userId,
          filename: "legacy.csv",
          periodYear: 2020,
          periodMonth: 1,
          rowCount: 0,
          billedCents: 0,
          paymentCents: 0,
          balanceCents: 0,
          netCents: 0,
          flaggedCount: 0,
          formatVersion: 1,
        })
        .returning({ id: rcmFiles.id });
      return row!.id;
    });
    await expect(withTenant(a.admin, (tx) => prepareVoucher(tx, a.admin, legacy))).rejects.toThrow(
      /earlier layout/,
    );
  });

  it("can't use another practice's file", async () => {
    const [, , bLatest] = await files(b);
    await expect(
      withTenant(a.manager, (tx) => prepareVoucher(tx, a.manager, bLatest!.fileId)),
    ).rejects.toThrow(/doesn't exist/);
  });
});

describe("approval, export, and void", () => {
  let voucherId: string;

  beforeAll(async () => {
    const [, latest] = await files(a);
    voucherId = await withTenant(a.manager, (tx) => prepareVoucher(tx, a.manager, latest!.fileId));
  });

  it("keeps the preparer from approving their own voucher", async () => {
    await expect(withTenant(a.manager, (tx) => approveVoucher(tx, a.manager, voucherId))).rejects.toThrow(
      /other than the preparer/,
    );
    await expectDbError(
      withTenant(a.manager, (tx) =>
        tx
          .update(rcmJournalVouchers)
          .set({ status: "approved", approvedBy: a.manager.userId, approvedAt: new Date() })
          .where(eq(rcmJournalVouchers.id, voucherId)),
      ),
      /approver_not_preparer/,
    );
  });

  it("can't be exported before approval", async () => {
    await expect(withTenant(a.admin, (tx) => exportVoucher(tx, a.admin, voucherId))).rejects.toThrow(
      /Only approved/,
    );
  });

  it("is approved by someone else, then exported as a GL file, every download audited", async () => {
    await withTenant(a.admin, (tx) => approveVoucher(tx, a.admin, voucherId));
    const first = await withTenant(a.admin, (tx) => exportVoucher(tx, a.admin, voucherId));
    const detail = (await withTenant(a.admin, (tx) => getVoucher(tx, voucherId)))!;
    expect(detail.voucher).toMatchObject({ status: "exported", exportedBy: a.admin.userId });
    expect(first.filename).toBe(`${detail.voucher.number}.csv`);
    const rows = parseCsv(first.csv, { maxRows: 10_000, maxColumns: 10, headerRows: 1 }).map((r) => r.cells);
    expect(rows[0]).toEqual(["Journal", "Date", "Account", "Site", "Debit", "Credit", "Memo"]);
    expect(rows).toHaveLength(detail.lines.length + 1);
    const cents = (text: string) => (text === "" ? 0 : Math.round(Number(text) * 100));
    const debits = rows.slice(1).reduce((t, r) => t + cents(r[4]!), 0);
    const credits = rows.slice(1).reduce((t, r) => t + cents(r[5]!), 0);
    expect(debits).toBe(credits);
    expect(first.csv).not.toMatch(/SYN-/); // no account numbers or patient data in the GL file

    await withTenant(a.manager, (tx) => exportVoucher(tx, a.manager, voucherId));
    const events = await withTenant(a.admin, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.entityId, voucherId)).orderBy(auditEvents.id),
    );
    expect(events.map((e) => e.action)).toEqual([
      "rcm.voucher_prepared",
      "rcm.voucher_approved",
      "rcm.voucher_exported",
      "rcm.voucher_exported",
    ]);
  });

  it("blocks a second posting of the month until the voucher is voided", async () => {
    const detail = (await withTenant(a.admin, (tx) => getVoucher(tx, voucherId)))!;
    await expect(
      withTenant(a.manager, (tx) => prepareVoucher(tx, a.manager, detail.voucher.fileId)),
    ).rejects.toThrow(/Void it first/);
    await expect(
      withTenant(a.manager, (tx) => voidVoucher(tx, a.manager, voucherId, "Wrong file used")),
    ).rejects.toThrow(/Only administrators/);
    await expect(withTenant(a.admin, (tx) => voidVoucher(tx, a.admin, voucherId, "short"))).rejects.toThrow(
      /10 to 500/,
    );
    await withTenant(a.admin, (tx) => voidVoucher(tx, a.admin, voucherId, "Imported the wrong month's file"));
    const again = await withTenant(a.manager, (tx) => prepareVoucher(tx, a.manager, detail.voucher.fileId));
    const redo = (await withTenant(a.manager, (tx) => getVoucher(tx, again)))!;
    expect(redo.voucher.version).toBe(detail.voucher.version + 1);
    expect(allPassed(redo.checks)).toBe(true);
  });

  it("makes the posted voucher's file the one that counts for the month", async () => {
    const [, , latest] = await files(a);
    const id = await withTenant(a.manager, (tx) => prepareVoucher(tx, a.manager, latest!.fileId));
    await withTenant(a.admin, (tx) => approveVoucher(tx, a.admin, id));
    const after = await files(a);
    expect(after[2]!.postedVoucherId).toBe(id);
  });
});

describe("voucher records", () => {
  it("never change amounts or lines, and are never deleted", async () => {
    const [voucher] = await withTenant(a.admin, (tx) => tx.select().from(rcmJournalVouchers).limit(1));
    await expectDbError(
      withTenant(a.admin, (tx) =>
        tx.update(rcmJournalVouchers).set({ debitCents: 1 }).where(eq(rcmJournalVouchers.id, voucher!.id)),
      ),
      /permission denied/,
    );
    await expectDbError(
      withTenant(a.admin, (tx) =>
        tx.update(rcmJournalLines).set({ debitCents: 1 }).where(eq(rcmJournalLines.voucherId, voucher!.id)),
      ),
      /permission denied/,
    );
    for (const table of [rcmJournalVouchers, rcmJournalLines]) {
      await expectDbError(
        withTenant(a.admin, (tx) => tx.delete(table)),
        /permission denied/,
      );
    }
  });

  it("are isolated per practice", async () => {
    for (const table of [rcmJournalVouchers, rcmJournalLines]) {
      const rows = await withTenant(b.admin, (tx) => tx.select({ tenantId: table.tenantId }).from(table));
      expect(rows.every((r) => r.tenantId === b.tenantId)).toBe(true);
      const theirs = await withTenant(b.admin, (tx) =>
        tx.select({ id: table.id }).from(table).where(eq(table.tenantId, a.tenantId)),
      );
      expect(theirs).toHaveLength(0);
    }
    const [aVoucher] = await withTenant(a.admin, (tx) => tx.select().from(rcmJournalVouchers).limit(1));
    expect(await withTenant(b.admin, (tx) => getVoucher(tx, aVoucher!.id))).toBeNull();
    const bFiles = await withTenant(b.admin, (tx) => listFiles(tx));
    await expectDbError(
      withTenant(a.admin, (tx) =>
        tx.insert(rcmJournalVouchers).values({
          tenantId: b.tenantId,
          fileId: bFiles[0]!.id,
          periodYear: 2026,
          periodMonth: 1,
          version: 99,
          number: "RCM-2026-01-v99",
          debitCents: 0,
          creditCents: 0,
          preparedBy: a.admin.userId,
        }),
      ),
      /row-level security/,
    );
  });
});
