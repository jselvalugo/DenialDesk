import { daysBetween } from "@rules/calendar";
import { evaluatePromptPay, type PayerResponse, type PromptPayClock } from "@rules/prompt-pay";
import type { Regime } from "@rules/types";
import type { Tone } from "@/components/ui/Badge";

export type ClockState = PromptPayClock["state"];

export const CLOCK_STATES: Record<ClockState, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "info" },
  met: { label: "Met", tone: "success" },
  late: { label: "Payer late", tone: "warning" },
  uncontestable: { label: "Uncontestable", tone: "danger" },
};

export const RESPONSE_KIND_LABELS = {
  payment: "Payment",
  denial: "Denial",
  contest: "Contest or request for information",
} as const;

/** "Milestone due soon" highlight: a display setting, not a legal value. */
export const PROMPT_PAY_DUE_SOON_DAYS = 5;

/**
 * Clock days that raise an alert while a claim is unanswered (R-3.1.2). Product settings, not legal
 * values: the legal milestones come from rules/ and are shown separately.
 */
export const PROMPT_PAY_ALERT_DAYS = [15, 20, 60, 90, 120] as const;

export interface StoredResponse {
  id: string;
  kind: PayerResponse["kind"];
  responseDate: string;
  cents: number;
  voidsResponseId: string | null;
}

/** Responses that count: originals not marked recorded in error. Correction rows never count. */
export function effectiveResponses(rows: StoredResponse[]): PayerResponse[] {
  const voided = new Set(rows.flatMap((r) => (r.voidsResponseId ? [r.voidsResponseId] : [])));
  return rows
    .filter((r) => !r.voidsResponseId && !voided.has(r.id))
    .map((r) => ({
      kind: r.kind,
      date: r.responseDate,
      ...(r.kind === "payment" ? { cents: r.cents } : {}),
    }));
}

export function clockFor(input: {
  regime: Regime;
  electronic: boolean;
  receivedDate: string;
  responses: StoredResponse[];
  today: string;
}): PromptPayClock {
  return evaluatePromptPay({
    regime: input.regime,
    electronic: input.electronic,
    receivedDate: input.receivedDate,
    responses: effectiveResponses(input.responses),
    today: input.today,
  });
}

/** Days since the payer received the claim, and the latest alert day reached while still open. */
export function clockDay(receivedDate: string, today: string, open: boolean) {
  const day = daysBetween(receivedDate, today);
  const alert = open ? ([...PROMPT_PAY_ALERT_DAYS].reverse().find((d) => day >= d) ?? null) : null;
  return { day, alert };
}
