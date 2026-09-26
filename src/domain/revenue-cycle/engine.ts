import { z } from "zod";

/**
 * Revenue cycle accounting rules engine (docs/specs/revenue-cycle-accounting.md).
 *
 * Classifies one line of the monthly practice-management export: the first active rule (lowest
 * priority number) whose conditions match wins, sets the contractual-adjustment ("contra")
 * percentage, and routes the line to AR, revenue, and adjustment GL accounts. Rules and routing
 * are per-practice accounting configuration stored in the database, not legal rules. Pure and
 * deterministic: no I/O, integer cents only.
 */

export const RULE_FIELDS = ["status", "payer_class", "cpt", "description", "facility"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

/**
 * The fixed condition vocabulary. Users pick from these; no free-form code or regular expressions.
 * - equals / in: exact match after trimming (codes are case-sensitive, as in the source export)
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
  /** Contractual adjustment in basis points: 0 = none, 10000 = 100% of the charge. */
  contraBps: number;
  /** Excluded from standard AR (e.g. fully adjusted lines). */
  excluded: boolean;
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
  billedCents: number;
}

export interface Classification {
  ruleCode: string;
  contraBps: number;
  excluded: boolean;
  grossCents: number;
  contraCents: number;
  netCents: number;
  arGl: string;
  revenueGl: string;
  adjustmentGl: string;
}

export class EngineConfigError extends Error {}

const CPT_FORMAT = /^[A-Za-z0-9]{5}$/;

function fieldValue(line: LineInput, field: RuleField): string {
  switch (field) {
    case "status":
      return line.status.trim();
    case "payer_class":
      return line.payerClass.trim();
    case "cpt":
      return line.cpt.trim();
    case "description":
      return line.description;
    case "facility":
      return line.facility;
  }
}

export function conditionMatches(condition: RuleCondition, line: LineInput): boolean {
  if (condition.op === "invalid_cpt") return !CPT_FORMAT.test(line.cpt.trim());
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

/** Contra amount for a charge: basis points, rounded half away from zero to the cent. */
export function contraCents(grossCents: number, bps: number): number {
  const exact = (Math.abs(grossCents) * bps) / 10_000;
  return Math.sign(grossCents) * Math.round(exact);
}

/** Sorted, validated view of a config; call once per import, then classify every line. */
export function prepareEngine(config: EngineConfig) {
  const rules = config.rules
    .filter((rule) => rule.active)
    .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
  if (!rules.some((rule) => "always" in rule.match)) {
    throw new EngineConfigError("The active rule set needs a fallback rule that matches every line.");
  }
  for (const rule of rules) {
    if (!Number.isInteger(rule.contraBps) || rule.contraBps < 0 || rule.contraBps > 10_000) {
      throw new EngineConfigError(`Rule ${rule.code} has an invalid contra percentage.`);
    }
  }
  const payerClassAr = new Map(config.payerClasses.map((pc) => [pc.code, pc.arGl]));
  const arAccounts = new Map(config.arAccounts.map((account) => [account.number, account]));
  if (!arAccounts.has(config.defaultArGl)) {
    throw new EngineConfigError("The default AR account isn't set up.");
  }

  return function classify(line: LineInput): Classification {
    if (!Number.isInteger(line.billedCents)) throw new EngineConfigError("Charges must be integer cents.");
    const rule = rules.find((candidate) => ruleMatches(candidate.match, line))!;
    const arGl = rule.arGl ?? payerClassAr.get(line.payerClass.trim()) ?? config.defaultArGl;
    const account = arAccounts.get(arGl);
    if (!account) throw new EngineConfigError(`AR account ${arGl} isn't set up.`);
    const contra = contraCents(line.billedCents, rule.contraBps);
    return {
      ruleCode: rule.code,
      contraBps: rule.contraBps,
      excluded: rule.excluded,
      grossCents: line.billedCents,
      contraCents: contra,
      netCents: line.billedCents - contra,
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
