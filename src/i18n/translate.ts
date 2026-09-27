import { INTL_TAGS, type Locale } from "./config";

export type Params = Record<string, string | number>;

/**
 * Message syntax, a small subset of ICU MessageFormat:
 *   - `{name}`: a parameter, inserted as text (numbers are inserted as given, not formatted).
 *   - `{count, plural, =0 {none} one {# day} other {# days}}`: a plural, chosen with
 *     Intl.PluralRules for the locale; `#` inside a branch is the number formatted for the locale.
 *   - `<b>text</b>`-style tags are left in place here; `rich()` (rich.tsx) turns them into elements.
 * A missing parameter is left as `{name}` so a gap is visible on screen rather than silently blank.
 */
export function formatMessage(message: string, params: Params = {}, locale: Locale = "en"): string {
  let out = "";
  let i = 0;
  while (i < message.length) {
    const char = message[i]!;
    if (char !== "{") {
      out += char;
      i += 1;
      continue;
    }
    const end = matchingBrace(message, i);
    if (end < 0) {
      out += message.slice(i);
      break;
    }
    out += resolveArgument(message.slice(i + 1, end), params, locale);
    i = end + 1;
  }
  return out;
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function resolveArgument(inner: string, params: Params, locale: Locale): string {
  const comma = inner.indexOf(",");
  if (comma < 0) {
    const value = params[inner.trim()];
    return value === undefined ? `{${inner}}` : String(value);
  }
  const name = inner.slice(0, comma).trim();
  const rest = inner.slice(comma + 1).trim();
  if (!rest.startsWith("plural,")) return `{${inner}}`;
  const raw = params[name];
  const value = typeof raw === "number" ? raw : Number(raw);
  if (raw === undefined || Number.isNaN(value)) return `{${inner}}`;
  const branches = parseBranches(rest.slice("plural,".length));
  const chosen =
    branches[`=${value}`] ?? branches[new Intl.PluralRules(INTL_TAGS[locale]).select(value)] ?? branches.other;
  if (chosen === undefined) return `{${inner}}`;
  return formatMessage(chosen.replaceAll("#", formatNumber(value, locale)), params, locale);
}

/** `one {…} other {…}` → { one: "…", other: "…" }. Branch bodies may nest braces. */
function parseBranches(text: string): Record<string, string> {
  const branches: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const selector = text.slice(i, open).trim();
    const close = matchingBrace(text, open);
    if (close < 0) break;
    branches[selector] = text.slice(open + 1, close);
    i = close + 1;
  }
  return branches;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** A count or plain number in the locale's digits and grouping (1,234 / 1.234). */
export function formatNumber(value: number, locale: Locale = "en"): string {
  let format = numberFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(INTL_TAGS[locale]);
    numberFormats.set(locale, format);
  }
  return format.format(value);
}

/** Every message of one namespace, for one locale: flat keys, dotted for grouping only. */
export type MessageTable = Record<string, string>;

export interface Translator<T extends MessageTable> {
  (key: keyof T & string, params?: Params): string;
  /** Language the messages are in, for anything else that must match it (formatting, `lang`). */
  readonly locale: Locale;
  /** The raw message for a key, unformatted; for the rare component that formats itself. */
  raw(key: keyof T & string): string;
}

/**
 * `t("key", { params })` for one namespace. A key absent from the table (only possible when the
 * key isn't a literal) comes back as the key itself, so nothing on screen is ever blank.
 */
export function createTranslator<T extends MessageTable>(table: T, locale: Locale): Translator<T> {
  const t = ((key: keyof T & string, params?: Params) => {
    const message = table[key];
    return message === undefined ? key : formatMessage(message, params, locale);
  }) as Translator<T>;
  Object.defineProperty(t, "locale", { value: locale, enumerable: true });
  Object.defineProperty(t, "raw", { value: (key: keyof T & string) => table[key] ?? key, enumerable: true });
  return t;
}
