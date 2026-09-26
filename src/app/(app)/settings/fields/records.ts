import { CUSTOM_FIELD_ENTITIES, type CustomFieldEntity } from "@/domain/settings/custom-fields";

/** The record type from `?records=`; patients when missing or unknown. */
export function recordsParam(value: string | string[] | undefined): CustomFieldEntity {
  return typeof value === "string" && value in CUSTOM_FIELD_ENTITIES
    ? (value as CustomFieldEntity)
    : "patient";
}
