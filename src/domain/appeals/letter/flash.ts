// The "letter saved" flash: a saved letter redirects to the plain letter URL plus `?saved=1`, so the page
// can confirm the save after the redirect. The flag carries no PHI and no record data (SC-B5).

/** Where the save action sends the browser: no `?template=`, only the flash flag. */
export function letterSavedPath(appealId: string): string {
  return `/appeals/${appealId}/letter?saved=1`;
}

/** True only for the exact flag value the save action sets; anything else in the URL is ignored. */
export function isSavedFlash(value: string | string[] | undefined): boolean {
  return value === "1";
}
