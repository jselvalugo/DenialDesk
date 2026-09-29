"use client";

import { Button } from "@/components/ui/Button";
import { useT } from "@/i18n/client";

/** Opens the browser's print dialog, where "Save as PDF" makes the PDF. No PDF library, no script from elsewhere. */
export function PrintButton() {
  const t = useT("appeals");
  return (
    <Button variant="primary" onClick={() => window.print()}>
      {t("letter.print.print")}
    </Button>
  );
}
