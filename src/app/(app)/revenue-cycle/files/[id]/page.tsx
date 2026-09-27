import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
import {
  getFile,
  LINES_PAGE_SIZE,
  maskAccount,
  maskPatientName,
  periodLabel,
  REVIEW_REASON_LABEL_KEYS,
  type ReviewReason,
} from "@/domain/revenue-cycle/imports";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Translator } from "@/i18n/translate";
import type { Messages } from "@/i18n/messages/types";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { formatCents } from "@/lib/format";

// Page title never includes PHI (DESIGN.md §12).
const reasonText = (reasons: string[], t: Translator<Messages["revenue"]>) =>
  reasons
    .map((r) => (r in REVIEW_REASON_LABEL_KEYS ? t(REVIEW_REASON_LABEL_KEYS[r as ReviewReason]) : r))
    .join("; ");

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("revenue");
  return { title: t("file.title") };
}

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
  const t = await getT("revenue");
  const tc = await getT("common");
  const f = await getFormat();
  const { id } = await routeParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const query = params.parse(await searchParams);
  const filters = { ruleCode: query.rule, flagged: query.flagged === "1", page: query.page };
  // Minimum necessary (R-3.3.7): compliance reviews totals and classifications, not accounts.
  const maskIdentifiers = auth.role === "compliance";

  const data = await withTenant(auth, async (tx) => {
    const data = await getFile(tx, id, filters);
    if (data) {
      await audit(tx, {
        action: "rcm.file_viewed",
        actorUserId: auth.userId,
        tenantId: auth.tenantId,
        entityType: "rcm_file",
        entityId: id,
        metadata: {
          // The lines shown carry patient names (PHI): record which rows were viewed, IDs only
          // (R-7.5.1), never the names or account numbers themselves.
          lineIds: data.lines.map((l) => l.id).join(","),
          lines: data.lines.length,
          page: filters.page,
          rule: filters.ruleCode ?? null,
          flagged: filters.flagged,
          masked: maskIdentifiers,
        },
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
  if (filters.page > pages) redirect(href({ rule: filters.ruleCode, flagged: filters.flagged, page: pages }));
  const first = data.total === 0 ? 0 : (filters.page - 1) * LINES_PAGE_SIZE + 1;
  const last = Math.min(filters.page * LINES_PAGE_SIZE, data.total);
  const linesDescription =
    t("file.linesCount", { count: data.total }) +
    (filtered
      ? (filters.ruleCode ? " " + t("file.matchedBy", { rule: filters.ruleCode }) : "") +
        (filters.flagged ? " " + t("file.needingReview") : "")
      : "");

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <p className="text-body text-muted">
        <Link href="/revenue-cycle/files" className="font-medium text-link hover:underline">
          {t("files.title")}
        </Link>{" "}
        / {periodLabel(file.periodYear, file.periodMonth, t.locale)}
      </p>
      <PageHeader
        title={periodLabel(file.periodYear, file.periodMonth, t.locale)}
        description={t("file.headerDescription", {
          filename: file.filename,
          name: data.uploadedBy ?? t("file.unknownUploader"),
          date: f.dateOf(file.createdAt),
        })}
      />

      <section
        aria-label={t("file.controlTotals")}
        className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-7"
      >
        <StatTile label={t("files.col.lines")} value={f.number(file.rowCount)} />
        <StatTile label={t("files.col.charges")} value={formatCents(file.billedCents)} />
        <StatTile label={t("files.col.adjustments")} value={formatCents(file.adjustmentCents)} />
        <StatTile label={t("files.col.netRevenue")} value={formatCents(file.netCents)} />
        <StatTile label={t("files.col.payments")} value={formatCents(file.paymentCents)} />
        <StatTile
          label={t("files.col.openBalance")}
          value={formatCents(file.balanceCents)}
          detail={t("file.atPeriodEnd")}
        />
        <StatTile
          label={t("files.col.needsReview")}
          value={file.flaggedCount}
          detail={file.flaggedCount === 1 ? t("file.lineToCheck") : t("file.linesToCheck")}
          emphasis={file.flaggedCount > 0 ? "warning" : undefined}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr_2fr]">
        <Panel title={t("file.byRule")} description={t("file.selectRuleHint")} flush>
          <Table caption={t("file.tableByRule")}>
            <thead>
              <tr>
                <Th>{t("file.col.rule")}</Th>
                <Th numeric>{t("files.col.lines")}</Th>
                <Th numeric>{t("files.col.adjustments")}</Th>
                <Th numeric>{t("file.col.net")}</Th>
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
                    <Money cents={r.adjustmentCents} />
                  </Td>
                  <Td numeric>
                    <Money cents={r.netCents} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
        <Panel title={t("file.byClass")} flush>
          <Table caption={t("file.tableByClass")}>
            <thead>
              <tr>
                <Th>{t("file.col.class")}</Th>
                <Th numeric>{t("files.col.lines")}</Th>
                <Th numeric>{t("files.col.charges")}</Th>
                <Th numeric>{t("files.col.payments")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.byPayerClass.map((p) => (
                <Tr key={p.key}>
                  <Td>
                    <Code>{p.key || t("file.blank")}</Code>
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
        <Panel title={t("file.bySite")} flush>
          <Table caption={t("file.tableBySite")}>
            <thead>
              <tr>
                <Th>{t("file.col.site")}</Th>
                <Th numeric>{t("files.col.lines")}</Th>
                <Th numeric>{t("files.col.netRevenue")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.bySite.map((s) => (
                <Tr key={s.siteId ?? "none"}>
                  <Td>
                    {s.code ? (
                      `${s.code} · ${s.name}`
                    ) : (
                      <span className="text-subtle">{t("file.noSite")}</span>
                    )}
                  </Td>
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
        title={t("file.linesTitle")}
        description={linesDescription}
        actions={
          <div className="flex items-center gap-3 text-label">
            {filtered && (
              <Link href={href({})} className="font-medium text-link hover:underline">
                {t("file.clearFilter")}
              </Link>
            )}
            {!filters.flagged && file.flaggedCount > 0 && (
              <Link
                href={href({ rule: filters.ruleCode, flagged: true })}
                className="font-medium text-link hover:underline"
              >
                {t("file.showNeedsReview")}
              </Link>
            )}
          </div>
        }
        flush
      >
        {data.total === 0 ? (
          <EmptyState title={t("file.noLinesTitle")} description={t("file.noLinesDescription")} />
        ) : (
          <Table caption={t("file.tableLines")}>
            <thead>
              <tr>
                <Th numeric>{t("file.col.row")}</Th>
                <Th>{tc("word.patient")}</Th>
                <Th>{t("file.col.account")}</Th>
                <Th>{t("import.column.serviceDate")}</Th>
                <Th>{t("file.col.code")}</Th>
                <Th>{t("file.col.class")}</Th>
                <Th>{t("file.col.site")}</Th>
                <Th>{t("file.col.rule")}</Th>
                <Th numeric>{t("files.col.charges")}</Th>
                <Th numeric>{t("files.col.adjustments")}</Th>
                <Th numeric>{t("file.col.net")}</Th>
                <Th numeric>{t("files.col.payments")}</Th>
                <Th numeric>{t("file.col.balance")}</Th>
                <Th>{t("file.col.ar")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <Tr key={l.id}>
                  <Td numeric className="text-muted">
                    {l.rowNumber}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {maskIdentifiers ? maskPatientName(l.patientName) : l.patientName}
                  </Td>
                  <Td className="font-mono text-label">
                    {maskIdentifiers ? maskAccount(l.accountNumber) : l.accountNumber}
                  </Td>
                  <Td className="tabular">{f.date(l.serviceDate)}</Td>
                  <Td>
                    <Code>{l.cpt || "—"}</Code>
                  </Td>
                  <Td className="font-mono text-label">{l.payerClass}</Td>
                  <Td className="font-mono text-label">{l.siteCode ?? "—"}</Td>
                  <Td>
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="font-mono text-label">{l.ruleCode}</span>
                      {l.flagged && (
                        <span title={reasonText(l.reviewReasons, t)}>
                          <Badge tone="warning">{t("file.reviewBadge")}</Badge>
                          <span className="sr-only">: {reasonText(l.reviewReasons, t)}</span>
                        </span>
                      )}
                    </span>
                  </Td>
                  <Td numeric>
                    <Money cents={l.billedCents} />
                  </Td>
                  <Td numeric>
                    <Money cents={l.adjustmentCents} />
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
        )}
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-label text-muted">
          <span>
            {t("file.pageSummary", {
              first: f.number(first),
              last: f.number(last),
              total: f.number(data.total),
              page: filters.page,
              pages,
            })}
          </span>
          <span className="flex gap-3">
            {filters.page > 1 && (
              <Link
                href={href({ rule: filters.ruleCode, flagged: filters.flagged, page: filters.page - 1 })}
                className="font-medium text-link hover:underline"
              >
                {tc("pagination.previous")}
              </Link>
            )}
            {filters.page < pages && (
              <Link
                href={href({ rule: filters.ruleCode, flagged: filters.flagged, page: filters.page + 1 })}
                className="font-medium text-link hover:underline"
              >
                {tc("pagination.next")}
              </Link>
            )}
          </span>
        </div>
      </Panel>
    </div>
  );
}
