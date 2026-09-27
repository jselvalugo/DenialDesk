import type { Metadata } from "next";
import Link from "next/link";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { sensitivityTagLabel, type SensitivityTag } from "@/domain/patients/record";
import {
  CUSTOM_FIELD_ENTITY_LABEL_KEYS,
  customFieldEntityLabel,
  customFieldTypeLabel,
  MAX_FIELDS_PER_ENTITY,
  type CustomFieldEntity,
} from "@/domain/settings/custom-fields";
import { listCustomFields } from "@/domain/settings/queries";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/cn";
import { recordsParam } from "./records";
import { ToggleFieldButton } from "./ToggleFieldButton";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("fields.metaTitle") };
}

export default async function CustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const t = await getT("settings");
  const tp = await getT("patients");
  const tc = await getT("common");
  const entity = recordsParam((await searchParams).records);
  const canEdit = canConfigureSettings(auth.role);
  const all = await withTenant(auth, (tx) => listCustomFields(tx));
  const fields = all.filter((field) => field.entity === entity);
  const entityName = customFieldEntityLabel(entity, t);

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav aria-label={t("fields.recordTypesLabel")}>
        <p className="mb-2 text-label font-semibold tracking-wide text-muted uppercase">
          {t("fields.recordsHeading")}
        </p>
        <ul className="flex flex-col gap-0.5">
          {(Object.keys(CUSTOM_FIELD_ENTITY_LABEL_KEYS) as CustomFieldEntity[]).map((value) => {
            const name = customFieldEntityLabel(value, t);
            const active = all.filter((f) => f.entity === value && f.active).length;
            const current = value === entity;
            return (
              <li key={value}>
                <Link
                  href={`/settings/fields?records=${value}`}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center justify-between rounded-control px-3 text-body",
                    current ? "bg-selected font-semibold text-primary" : "text-text hover:bg-surface-muted",
                  )}
                >
                  {name}
                  <span className="text-label text-muted tabular-nums">{active}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Panel
        title={t("fields.panelTitle", { entity: entityName })}
        description={t("fields.panelDescription", { entity: entityName.toLowerCase() })}
        actions={
          canEdit && fields.filter((f) => f.active).length < MAX_FIELDS_PER_ENTITY ? (
            <Link
              href={`/settings/fields/new?records=${entity}`}
              className="inline-flex h-8 items-center rounded-control border border-primary bg-primary px-3 text-body font-medium text-white hover:bg-primary-hover"
            >
              {t("fields.addField")}
            </Link>
          ) : undefined
        }
        flush
      >
        {fields.length === 0 ? (
          <EmptyState
            title={t("fields.emptyTitle", { entity: entityName.toLowerCase() })}
            description={canEdit ? t("fields.emptyDescriptionCanEdit") : t("fields.emptyDescriptionReadOnly")}
          />
        ) : (
          <Table caption={t("fields.tableCaption", { entity: entityName })}>
            <thead>
              <tr>
                <Th>{t("fields.label")}</Th>
                <Th>{t("fields.key")}</Th>
                <Th>{tc("word.type")}</Th>
                <Th>{tc("word.required")}</Th>
                <Th>{t("fields.sensitivity")}</Th>
                <Th>{tc("word.status")}</Th>
                {canEdit && <Th className="text-right">{tc("word.actions")}</Th>}
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <Tr key={field.id}>
                  <Td>
                    <p className="font-medium text-text">{field.label}</p>
                    {field.helpText && <p className="mt-0.5 text-label text-muted">{field.helpText}</p>}
                  </Td>
                  <Td>
                    <Code>{field.key}</Code>
                  </Td>
                  <Td>
                    {customFieldTypeLabel(field.fieldType, t)}
                    {field.fieldType === "select" && (
                      <span className="text-label text-muted">
                        {" "}
                        · {t("fields.choicesCount", { count: field.options.length })}
                      </span>
                    )}
                  </Td>
                  <Td>{field.required ? tc("word.yes") : tc("word.no")}</Td>
                  <Td>
                    {field.sensitivity ? (
                      <Badge tone="warning">
                        {t("fields.locked", {
                          category: sensitivityTagLabel(field.sensitivity as SensitivityTag, tp),
                        })}
                      </Badge>
                    ) : (
                      <span className="text-label text-muted">{t("fields.notSensitive")}</span>
                    )}
                  </Td>
                  <Td>
                    {field.active ? (
                      <Badge tone="success">{t("fields.active")}</Badge>
                    ) : (
                      <Badge tone="neutral">{t("fields.inactive")}</Badge>
                    )}
                  </Td>
                  {canEdit && (
                    <Td className="text-right">
                      <div className="flex items-start justify-end gap-2">
                        <Link
                          href={`/settings/fields/${field.id}`}
                          className="inline-flex h-7 items-center text-label font-medium text-link hover:underline"
                          aria-label={t("fields.editAria", { label: field.label })}
                        >
                          {tc("action.edit")}
                        </Link>
                        <ToggleFieldButton
                          id={field.id}
                          updatedAt={field.updatedAt.toISOString()}
                          active={field.active}
                          label={field.label}
                        />
                      </div>
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
