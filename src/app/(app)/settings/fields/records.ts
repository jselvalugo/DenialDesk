import { CUSTOM_FIELD_ENTITY_LABEL_KEYS, type CustomFieldEntity } from "@/domain/settings/custom-fields";

/** The record type from `?records=`; patients when missing or unknown. */
export function recordsParam(value: string | string[] | undefined): CustomFieldEntity {
  return typeof value === "string" && value in CUSTOM_FIELD_ENTITY_LABEL_KEYS
    ? (value as CustomFieldEntity)
    : "patient";
}
