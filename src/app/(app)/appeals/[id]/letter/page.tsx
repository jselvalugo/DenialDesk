import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canWorkAppeals } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SelectField } from "@/components/ui/SelectField";
import { secondaryLinkButtonClass } from "@/components/ui/linkButton";
import { denialCategoryEnum } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isSavedFlash } from "@/domain/appeals/letter/flash";
import {
  MERGE_FIELDS,
  MERGE_FIELD_KEYS,
  hasUnresolvedPlaceholder,
  letterDigest,
  missingFields,
  renderLetter,
} from "@/domain/appeals/letter/merge-fields";
import {
  getLetterState,
  getLetterTarget,
  getTemplateBody,
  loadMergeValues,
} from "@/domain/appeals/letter/queries";
import { recordLetterViewed } from "@/domain/appeals/letter/service";
import { templateCategoryToLoad } from "@/domain/appeals/letter/starter-templates";
import { CATEGORY_LABEL_KEYS, CATEGORY_ORDER, type DenialCategory } from "@/domain/carc";
import { getFormat, getT } from "@/i18n/server";
import { AttestForm, LetterEditor } from "./LetterForms";

export async function generateMetadata(): Promise<Metadata> {
  // Generic on purpose: a page title never carries PHI (DESIGN.md §12).
  const t = await getT("appeals");
  return { title: t("letter.page.title") };
}

const EDITABLE = ["draft", "in_review", "ready"];

export default async function AppealLetterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  const t = await getT("appeals");
  const tc = await getT("common");
  const f = await getFormat();
  const query = await searchParams;
  const requested = z.enum(denialCategoryEnum.enumValues).safeParse(query.template);
  const justSaved = isSavedFlash(query.saved);

  const data = await withTenant(auth, async (tx) => {
    const target = await getLetterTarget(tx, id);
    if (!target) return null;
    const state = await getLetterState(tx, id);
    const editable = canWorkAppeals(auth.role) && EDITABLE.includes(target.status);
    // `?template=` only counts while the letter can be edited (a stale link cannot swap the text shown).
    const templateCategory: DenialCategory | null = templateCategoryToLoad({
      editable,
      requested: requested.success ? requested.data : null,
      hasSavedLetter: state.latest !== null,
      denialCategory: target.category,
    });
    const template = templateCategory ? await getTemplateBody(tx, templateCategory) : null;
    const context = state.latest
      ? await loadMergeValues(tx, id, todayIn(undefined, state.latest.createdAt))
      : null;
    await recordLetterViewed(tx, auth, id, state.latest?.version ?? null);
    return { target, state, templateCategory, template, context, editable };
  });
  if (!data) notFound();

  const { target, state, templateCategory, template, context, editable } = data;
  const canWork = canWorkAppeals(auth.role);
  const latest = state.latest;
  const baseVersion = latest?.version ?? 0;
  const body = template?.body ?? latest?.body ?? "";
  const rendered = latest && context ? renderLetter(latest.body, context.values) : null;
  const missing = latest && context ? missingFields(latest.body, context.values) : [];
  const attestation = state.attestation;
  // The attestation counts only while today's rendering still matches what was reviewed.
  const attestationCurrent =
    attestation !== null && rendered !== null && letterDigest(rendered) === attestation.renderedSha256;
  const sensitive = context?.sensitive ?? false;
  const categoryOptions = CATEGORY_ORDER.map((category) => ({
    value: category,
    label: tc(CATEGORY_LABEL_KEYS[category]),
  }));

  return (
    // print:hidden: only /letter/print produces a printable letter, and only after review.
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6 print:hidden">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[
          { label: t("queue.title"), href: "/appeals" },
          { label: target.claimNumber, href: `/appeals/${id}`, mono: true },
          { label: t("letter.page.title") },
        ]}
      />
      <header className="rounded-panel border border-border bg-surface px-5 py-4 shadow-xs">
        <h1 className="font-serif text-display font-bold text-primary">{t("letter.page.title")}</h1>
        <p className="mt-0.5 max-w-3xl text-body text-muted">{t("letter.page.description")}</p>
      </header>
      {justSaved && (
        <p
          role="status"
          className="rounded-control border border-success-border bg-success-bg px-3 py-2 text-body text-success-fg"
        >
          {t("letter.editor.saved")}
        </p>
      )}
      {!canWork && (
        <p
          role="note"
          className="rounded-control border border-info-border bg-info-bg px-3 py-2 text-body text-info-fg"
        >
          {t("detail.readOnlyNotice")}
        </p>
      )}
      {canWork && !EDITABLE.includes(target.status) && (
        <p
          role="note"
          className="rounded-control border border-info-border bg-info-bg px-3 py-2 text-body text-info-fg"
        >
          {t("letter.editor.readOnly")}
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start gap-6 max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={t("letter.editor.title")}>
            <div className="flex flex-col gap-4">
              {editable && (
                <form method="get" className="flex flex-wrap items-end gap-3">
                  <SelectField
                    label={t("letter.editor.templateLabel")}
                    name="template"
                    defaultValue={templateCategory ?? target.category}
                    options={categoryOptions}
                    hint={t("letter.editor.loadWarning")}
                  />
                  <Button type="submit">{t("letter.editor.loadTemplate")}</Button>
                </form>
              )}
              {template && templateCategory && (
                <p className="text-label text-muted">
                  {t(
                    template.source === "practice"
                      ? "letter.editor.startedFromPractice"
                      : "letter.editor.startedFromStarter",
                    { category: tc(CATEGORY_LABEL_KEYS[templateCategory]) },
                  )}
                </p>
              )}
              {hasUnresolvedPlaceholder(body) && editable && (
                <p role="note" className="text-label font-medium text-warning-fg">
                  {t("letter.editor.placeholdersLeft")}
                </p>
              )}
              <LetterEditor
                key={`${baseVersion}:${template ? templateCategory : "saved"}`}
                appealId={id}
                defaultBody={body}
                baseVersion={baseVersion}
                sourceCategory={template && templateCategory ? templateCategory : ""}
                editable={editable}
              />
            </div>
          </Panel>

          {rendered !== null && (
            <Panel title={t("letter.preview.title")} description={t("letter.preview.description")}>
              {missing.length > 0 && (
                <p role="note" className="mb-3 text-label font-medium text-warning-fg">
                  {t("letter.preview.missing", {
                    fields: missing.map((key) => t(MERGE_FIELDS[key].labelKey)).join(", "),
                  })}
                </p>
              )}
              <div className="rounded-control border border-border bg-surface-muted px-4 py-3 text-body whitespace-pre-wrap text-text">
                {rendered}
              </div>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Panel title={t("letter.review.title")} description={t("letter.review.description")}>
            {!latest ? (
              <p className="text-body text-muted">{t("letter.review.saveFirst")}</p>
            ) : sensitive ? (
              <p role="note" className="text-body font-medium text-warning-fg">
                {t("letter.review.sensitive")}
              </p>
            ) : attestation && attestationCurrent ? (
              <div className="flex flex-col gap-3">
                <Badge tone="success">{t("letter.panel.reviewed")}</Badge>
                <p className="text-body text-text">
                  {t("letter.review.attested", {
                    version: latest.version,
                    name: attestation.attestedBy,
                    when: f.dateTime(attestation.attestedAt),
                  })}
                </p>
                {canWork && (
                  <div className="flex flex-col gap-1">
                    <a href={`/appeals/${id}/letter/print`} className={secondaryLinkButtonClass}>
                      {t("letter.export.button")}
                    </a>
                    <p className="text-label text-muted">{t("letter.export.hint")}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-body text-muted">
                  {t(attestation ? "letter.review.changed" : "letter.review.needed", {
                    version: latest.version,
                  })}
                </p>
                {canWork && <AttestForm appealId={id} version={latest.version} />}
              </div>
            )}
          </Panel>

          <Panel title={t("letter.fields.title")} description={t("letter.fields.description")}>
            <ul className="flex flex-col gap-1.5">
              {MERGE_FIELD_KEYS.map((key) => (
                <li key={key} className="flex items-baseline justify-between gap-3 text-label">
                  <span className="text-text">{t(MERGE_FIELDS[key].labelKey)}</span>
                  <code className="font-mono text-muted">{`{{${key}}}`}</code>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-label text-muted">{t("letter.fields.memberIdNote")}</p>
          </Panel>

          <Panel title={t("letter.history.title")}>
            {state.history.length === 0 ? (
              <p className="text-body text-muted">{t("letter.history.empty")}</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {state.history.map((row) => (
                  <li key={row.version} className="text-label text-text">
                    {t("letter.history.row", {
                      version: row.version,
                      author: row.author,
                      when: f.dateTime(row.createdAt),
                    })}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
