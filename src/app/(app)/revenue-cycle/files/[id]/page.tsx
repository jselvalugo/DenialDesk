import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { getFile, LINES_PAGE_SIZE, periodLabel } from "@/domain/revenue-cycle/imports";
import { audit } from "@/lib/audit";
import { formatCents, formatDate } from "@/lib/format";

// Page title never includes PHI (DESIGN.md §12).
export const metadata: Metadata = { title: "Monthly file" };

const params = z.object({
  rule: z
    .string()
    .regex(/^[A-Z0-9_]{1,40}$/)
    .optional()
    .catch(undefined),
  flagged: z.literal("1").optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export default async function FilePage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const { id } = await routeParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const query = params.parse(await searchParams);
  const filters = { ruleCode: query.rule, flagged: query.flagged === "1", page: query.page };

  const data = await withTenant(auth, async (tx) => {
    const data = await getFile(tx, id, filters);
    if (data) {
      await audit(tx, {
        action: "rcm.file_viewed",
        actorUserId: auth.userId,
        tenantId: auth.tenantId,
        entityType: "rcm_file",
        entityId: id,
        metadata: { lines: data.lines.length, page: filters.page },
      });
    }
    return data;
  });
  if (!data) notFound();
  const { file } = data;
  const pages = Math.max(1, Math.ceil(data.total / LINES_PAGE_SIZE));
  const href = (next: { rule?: string; flagged?: boolean; page?: number }) => {
    const search = new URLSearchParams();
    if (next.rule) search.set("rule", next.rule);
    if (next.flagged) search.set("flagged", "1");
    if (next.page && next.page > 1) search.set("page", String(next.page));
    const text = search.toString();
    return `/revenue-cycle/files/${id}${text ? `?${text}` : ""}`;
  };
  const filtered = Boolean(filters.ruleCode || filters.flagged);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <p className="text-body text-muted">
        <Link href="/revenue-cycle/files" className="font-medium text-link hover:underline">
          Monthly files
        </Link>{" "}
        / {periodLabel(file.periodYear, file.periodMonth)}
      </p>
      <PageHeader
        title={periodLabel(file.periodYear, file.periodMonth)}
        description={`${file.filename} · imported by ${data.uploadedBy ?? "unknown"} on ${file.createdAt.toLocaleDateString("en-US", { timeZone: "America/New_York" })}`}
      />

      <section
        aria-label="File control totals"
        className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6"
      >
        <StatTile label="Lines" value={file.rowCount.toLocaleString("en-US")} />
        <StatTile label="Gross charges" value={formatCents(file.billedCents)} />
        <StatTile label="Contra" value={formatCents(file.contraCents)} />
        <StatTile label="Net revenue" value={formatCents(file.netCents)} />
        <StatTile label="Payments" value={formatCents(file.paymentCents)} />
        <StatTile
          label="Needs review"
          value={file.flaggedCount}
          detail={`${file.excludedCount} excluded from AR`}
          emphasis={file.flaggedCount > 0 ? "warning" : undefined}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr_2fr]">
        <Panel title="By rule" description="Select a rule to see its lines" flush>
          <Table caption="Totals by rule">
            <thead>
              <tr>
                <Th>Rule</Th>
                <Th numeric>Lines</Th>
                <Th numeric>Contra</Th>
                <Th numeric>Net</Th>
              </tr>
            </thead>
            <tbody>
              {data.byRule.map((r) => (
                <Tr key={r.key} selected={filters.ruleCode === r.key}>
                  <Td>
                    <Link
                      href={href({ rule: r.key })}
                      className="font-mono text-label text-link hover:underline"
                    >
                      {r.key}
                    </Link>
                  </Td>
                  <Td numeric>{r.lines}</Td>
                  <Td numeric>
                    <Money cents={r.contraCents} />
                  </Td>
                  <Td numeric>
                    <Money cents={r.netCents} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
        <Panel title="By payer class" flush>
          <Table caption="Totals by payer class">
            <thead>
              <tr>
                <Th>Class</Th>
                <Th numeric>Lines</Th>
                <Th numeric>Gross</Th>
                <Th numeric>Payments</Th>
              </tr>
            </thead>
            <tbody>
              {data.byPayerClass.map((p) => (
                <Tr key={p.key}>
                  <Td>
                    <Code>{p.key || "(blank)"}</Code>
                  </Td>
                  <Td numeric>{p.lines}</Td>
                  <Td numeric>
                    <Money cents={p.billedCents} />
                  </Td>
                  <Td numeric>
                    <Money cents={p.paymentCents} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
        <Panel title="By site" flush>
          <Table caption="Totals by site">
            <thead>
              <tr>
                <Th>Site</Th>
                <Th numeric>Lines</Th>
                <Th numeric>Net revenue</Th>
              </tr>
            </thead>
            <tbody>
              {data.bySite.map((s) => (
                <Tr key={s.siteId ?? "none"}>
                  <Td>{s.code ? `${s.code} · ${s.name}` : <span className="text-subtle">No site</span>}</Td>
                  <Td numeric>{s.lines}</Td>
                  <Td numeric>
                    <Money cents={s.netCents} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>

      <Panel
        title="Lines"
        description={
          filtered
            ? `${data.total} lines${filters.ruleCode ? ` matched by ${filters.ruleCode}` : ""}${filters.flagged ? " needing review" : ""}`
            : `${data.total} lines`
        }
        actions={
          <div className="flex items-center gap-3 text-label">
            {filtered && (
              <Link href={href({})} className="font-medium text-link hover:underline">
                Clear filter
              </Link>
            )}
            {!filters.flagged && file.flaggedCount > 0 && (
              <Link
                href={href({ rule: filters.ruleCode, flagged: true })}
                className="font-medium text-link hover:underline"
              >
                Show lines needing review
              </Link>
            )}
          </div>
        }
        flush
      >
        <Table caption="Classified lines">
          <thead>
            <tr>
              <Th numeric>Row</Th>
              <Th>Patient</Th>
              <Th>Account</Th>
              <Th>Svc date</Th>
              <Th>CPT</Th>
              <Th>Class</Th>
              <Th>Site</Th>
              <Th>Rule</Th>
              <Th numeric>Billed</Th>
              <Th numeric>Contra</Th>
              <Th numeric>Net</Th>
              <Th numeric>Paid</Th>
              <Th numeric>Balance</Th>
              <Th>AR</Th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <Tr key={l.id}>
                <Td numeric className="text-muted">
                  {l.rowNumber}
                </Td>
                <Td className="whitespace-nowrap">{l.patientName}</Td>
                <Td className="font-mono text-label">{l.accountNumber}</Td>
                <Td className="tabular">{formatDate(l.serviceDate)}</Td>
                <Td>
                  <Code>{l.cpt || "—"}</Code>
                </Td>
                <Td className="font-mono text-label">{l.payerClass}</Td>
                <Td className="font-mono text-label">{l.siteCode ?? "—"}</Td>
                <Td>
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="font-mono text-label">{l.ruleCode}</span>
                    {l.flagged && <Badge tone="warning">Review</Badge>}
                  </span>
                </Td>
                <Td numeric>
                  <Money cents={l.billedCents} />
                </Td>
                <Td numeric>
                  <Money cents={l.contraCents} />
                </Td>
                <Td numeric className="font-medium">
                  <Money cents={l.netCents} />
                </Td>
                <Td numeric>
                  <Money cents={l.paymentCents} />
                </Td>
                <Td numeric>
                  <Money cents={l.balanceCents} />
                </Td>
                <Td>
                  <Code>{l.arGl}</Code>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-label text-muted">
          <span>
            Page {Math.min(filters.page, pages)} of {pages}
          </span>
          <span className="flex gap-3">
            {filters.page > 1 && (
              <Link
                href={href({ rule: filters.ruleCode, flagged: filters.flagged, page: filters.page - 1 })}
                className="font-medium text-link hover:underline"
              >
                Previous
              </Link>
            )}
            {filters.page < pages && (
              <Link
                href={href({ rule: filters.ruleCode, flagged: filters.flagged, page: filters.page + 1 })}
                className="font-medium text-link hover:underline"
              >
                Next
              </Link>
            )}
          </span>
        </div>
      </Panel>
    </div>
  );
}
