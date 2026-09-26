import { z } from "zod";

/**
 * Revenue cycle accounting rules engine (docs/specs/revenue-cycle-accounting.md).
 *
 * Routes one line of the monthly activity file to general-ledger accounts: the first active rule
 * (lowest priority number) whose conditions match wins and picks the line's receivable (AR),
 * revenue, and adjustment accounts. Rules never change amounts: every line's charges, payments,
 * and adjustments post as the practice-management system recorded them, so the ledger always
 * agrees with the file. Rules and routing are per-practice accounting configuration stored in the
 * database, not legal rules. Pure and deterministic: no I/O.
 */

export const RULE_FIELDS = ["status", "payer_class", "cpt", "description", "facility"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

/**
 * The fixed condition vocabulary. Users pick from these; no free-form code or regular expressions.
 * - equals / in: exact, case-sensitive match (the importer trims cells)
 * - contains: case-insensitive substring
 * - starts_with / ends_with: exact prefix/suffix
 * - invalid_cpt: the CPT/HCPCS value isn't exactly 5 letters or digits
 */
export const conditionSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("equals"), field: z.enum(RULE_FIELDS), value: z.string().min(1).max(64) }),
  z.object({
    op: z.literal("in"),
    field: z.enum(RULE_FIELDS),
    values: z.array(z.string().min(1).max(64)).min(1).max(100),
  }),
  z.object({ op: z.literal("contains"), field: z.enum(RULE_FIELDS), value: z.string().min(1).max(64) }),
  z.object({ op: z.literal("starts_with"), field: z.enum(RULE_FIELDS), value: z.string().min(1).max(16) }),
  z.object({ op: z.literal("ends_with"), field: z.enum(RULE_FIELDS), value: z.string().min(1).max(16) }),
  z.object({ op: z.literal("invalid_cpt") }),
]);
export type RuleCondition = z.infer<typeof conditionSchema>;

/** A rule matches when ANY condition matches; `always` matches every line (the fallback rule). */
export const ruleMatchSchema = z.union([
  z.object({ always: z.literal(true) }),
  z.object({ any: z.array(conditionSchema).min(1).max(20) }),
]);
export type RuleMatch = z.infer<typeof ruleMatchSchema>;

export interface EngineRule {
  code: string;
  priority: number;
  active: boolean;
  match: RuleMatch;
  /** GL overrides; null falls back to the payer class, then the AR account's defaults. */
  arGl: string | null;
  revenueGl: string | null;
  adjustmentGl: string | null;
}

export interface EnginePayerClass {
  code: string;
  arGl: string | null;
}

export interface EngineArAccount {
  number: string;
  revenueGl: string;
  adjustmentGl: string;
}

export interface EngineConfig {
  rules: EngineRule[];
  payerClasses: EnginePayerClass[];
  arAccounts: EngineArAccount[];
  defaultArGl: string;
}

export interface LineInput {
  status: string;
  payerClass: string;
  cpt: string;
  description: string;
  facility: string;
}

export interface Classification {
  ruleCode: string;
  arGl: string;
  revenueGl: string;
  adjustmentGl: string;
}

export class EngineConfigError extends Error {}

/** A CPT/HCPCS code is exactly five letters or digits. */
export const CPT_FORMAT = /^[A-Za-z0-9]{5}$/;

function fieldValue(line: LineInput, field: RuleField): string {
  switch (field) {
    case "status":
      return line.status;
    case "payer_class":
      return line.payerClass;
    case "cpt":
      return line.cpt;
    case "description":
      return line.description;
    case "facility":
      return line.facility;
  }
}

export function conditionMatches(condition: RuleCondition, line: LineInput): boolean {
  if (condition.op === "invalid_cpt") return !CPT_FORMAT.test(line.cpt);
  const value = fieldValue(line, condition.field);
  switch (condition.op) {
    case "equals":
      return value === condition.value;
    case "in":
      return condition.values.includes(value);
    case "contains":
      return value.toLowerCase().includes(condition.value.toLowerCase());
    case "starts_with":
      return value.startsWith(condition.value);
    case "ends_with":
      return value.endsWith(condition.value);
  }
}

export function ruleMatches(match: RuleMatch, line: LineInput): boolean {
  return "always" in match || match.any.some((condition) => conditionMatches(condition, line));
}

/** Sorted, validated view of a config; call once per import, then route every line. */
export function prepareEngine(config: EngineConfig) {
  const rules = config.rules
    .filter((rule) => rule.active)
    .sort((a, b) => a.priority - b.priority || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  if (!rules.some((rule) => "always" in rule.match)) {
    throw new EngineConfigError("The active rule set needs a fallback rule that matches every line.");
  }
  const payerClassAr = new Map(config.payerClasses.map((pc) => [pc.code, pc.arGl]));
  const arAccounts = new Map(config.arAccounts.map((account) => [account.number, account]));
  if (!arAccounts.has(config.defaultArGl)) {
    throw new EngineConfigError("The default AR account isn't set up.");
  }
  // Fail before any line is classified, never partway through a file.
  for (const [owner, arGl] of [
    ...rules.map((rule) => [`Rule ${rule.code}`, rule.arGl] as const),
    ...config.payerClasses.map((pc) => [`Payer class ${pc.code}`, pc.arGl] as const),
  ]) {
    if (arGl !== null && !arAccounts.has(arGl)) {
      throw new EngineConfigError(
        `${owner} posts to AR account ${arGl}, which isn't set up as an AR account.`,
      );
    }
  }

  return function classify(line: LineInput): Classification {
    const rule = rules.find((candidate) => ruleMatches(candidate.match, line))!;
    const arGl = rule.arGl ?? payerClassAr.get(line.payerClass) ?? config.defaultArGl;
    const account = arAccounts.get(arGl);
    if (!account) throw new EngineConfigError(`AR account ${arGl} isn't set up.`);
    return {
      ruleCode: rule.code,
      arGl,
      revenueGl: rule.revenueGl ?? account.revenueGl,
      adjustmentGl: rule.adjustmentGl ?? account.adjustmentGl,
    };
  };
}

const fieldLabels: Record<RuleField, string> = {
  status: "Status",
  payer_class: "Payer class",
  cpt: "CPT/HCPCS",
  description: "Description",
  facility: "Facility",
};

/** Plain-English rendering of a rule's conditions for the Rules page. */
export function describeMatch(match: RuleMatch): string[] {
  if ("always" in match) return ["Every line not matched by an earlier rule"];
  return match.any.map((c) => {
    if (c.op === "invalid_cpt") return "CPT/HCPCS isn't exactly 5 letters or digits";
    const label = fieldLabels[c.field];
    switch (c.op) {
      case "equals":
        return `${label} is ${c.value}`;
      case "in":
        return `${label} is one of ${c.values.join(", ")}`;
      case "contains":
        return `${label} contains "${c.value}"`;
      case "starts_with":
        return `${label} starts with ${c.value}`;
      case "ends_with":
        return `${label} ends with ${c.value}`;
    }
  });
}
