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
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  MAX_FIELDS_PER_ENTITY,
} from "@/domain/settings/custom-fields";
import { listCustomFields } from "@/domain/settings/queries";
import { cn } from "@/lib/cn";
import { recordsParam } from "./records";
import { ToggleFieldButton } from "./ToggleFieldButton";

export const metadata: Metadata = { title: "Custom fields" };

export default async function CustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const entity = recordsParam((await searchParams).records);
  const canEdit = canConfigureSettings(auth.role);
  const all = await withTenant(auth, (tx) => listCustomFields(tx));
  const fields = all.filter((field) => field.entity === entity);
  const entityName = CUSTOM_FIELD_ENTITIES[entity];

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Record types">
        <p className="mb-2 text-label font-semibold tracking-wide text-muted uppercase">Records</p>
        <ul className="flex flex-col gap-0.5">
          {Object.entries(CUSTOM_FIELD_ENTITIES).map(([value, name]) => {
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
        title={`${entityName} fields`}
        description={`Fields your practice adds to ${entityName.toLowerCase()}, in form order. Deactivated fields are hidden from forms and keep their history.`}
        actions={
          canEdit && fields.length < MAX_FIELDS_PER_ENTITY ? (
            <Link
              href={`/settings/fields/new?records=${entity}`}
              className="inline-flex h-8 items-center rounded-control border border-primary bg-primary px-3 text-body font-medium text-white hover:bg-primary-hover"
            >
              Add field
            </Link>
          ) : undefined
        }
        flush
      >
        {fields.length === 0 ? (
          <EmptyState
            title={`No custom fields on ${entityName.toLowerCase()} yet`}
            description={
              canEdit
                ? "Add a field to capture something DenialDesk doesn't track out of the box, such as a referring clinic or an internal account tier."
                : "An administrator can add fields to capture what your practice tracks beyond the standard record."
            }
          />
        ) : (
          <Table caption={`${entityName} custom fields`}>
            <thead>
              <tr>
                <Th>Label</Th>
                <Th>Key</Th>
                <Th>Type</Th>
                <Th>Required</Th>
                <Th>Status</Th>
                {canEdit && <Th className="text-right">Actions</Th>}
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
                    {CUSTOM_FIELD_TYPES[field.fieldType]}
                    {field.fieldType === "select" && (
                      <span className="text-label text-muted"> · {field.options.length} choices</span>
                    )}
                  </Td>
                  <Td>{field.required ? "Yes" : "No"}</Td>
                  <Td>
                    {field.active ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Inactive</Badge>
                    )}
                  </Td>
                  {canEdit && (
                    <Td className="text-right">
                      <div className="flex items-start justify-end gap-2">
                        <Link
                          href={`/settings/fields/${field.id}`}
                          className="inline-flex h-7 items-center text-label font-medium text-link hover:underline"
                          aria-label={`Edit ${field.label}`}
                        >
                          Edit
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
