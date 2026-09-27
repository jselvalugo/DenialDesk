import { addCalendarDays } from "@rules/calendar";

/**
 * Explains a stored payer-contract appeal deadline (review F7) on the denial and appeal pages. The
 * deadline is computed once, when the denial or appeal is recorded; the payer's window can change or be cleared afterwards. The current window
 * is quoted only when it still produces the stored date, so the text never contradicts the date and
 * never renders "null days".
 */
export function payerContractBasisText(
  noticeDate: string,
  storedDeadline: string,
  windowDays: number | null,
  windowSource: string | null,
): string {
  if (windowDays !== null && addCalendarDays(noticeDate, windowDays) === storedDeadline) {
    return `From the payer contract: ${windowDays} days after the notice date${windowSource ? ` (${windowSource})` : ""}.`;
  }
  return "From the payer contract window used when this deadline was computed. It no longer matches the payer's current appeal window; confirm this date against the current contract.";
}
