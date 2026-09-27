/**
 * The "Module · Page" line above a page title. A record page names itself (`page`); a list page
 * whose tab carries the module's own name shows the module alone, never "Patients · Patients".
 */
export function eyebrowText(
  appLabel: string,
  itemLabel: string | undefined,
  title: string | undefined,
  page?: string,
): string {
  if (page) return `${appLabel} · ${page}`;
  if (itemLabel && itemLabel !== title && itemLabel !== appLabel) return `${appLabel} · ${itemLabel}`;
  return appLabel;
}
