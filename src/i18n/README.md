# `src/i18n` — how text reaches the screen

Spec: `docs/specs/internationalization.md`. ADR: `docs/decisions/0009-internationalization.md`.
Languages: English (`en`, source), Spanish (`es`), Portuguese (`pt`).

## Rules
1. **No user-visible English literal in code.** Every label, heading, button, hint, placeholder,
   `aria-label`, `title`, empty state, page title, and error message returned to the user is a key in
   `messages/en/<namespace>.ts`, with its Spanish and Portuguese in `messages/es/` and `messages/pt/`.
   Code comments, audit action names, log fields, and route paths stay as they are.
2. **Namespaces** map to areas: `common` (shared words and domain labels), `shell` (chrome), `auth`,
   `welcome`, `denials`, `appeals`, `claims`, `remittances`, `promptPay`, `patients`, `revenue`,
   `insight`, `settings`, `operator`. Each namespace's three files are edited together; TypeScript
   fails the build when `es`/`pt` miss or add a key; `messages.test.ts` checks placeholders match.
3. **Keys** are flat, dotted, camelCase: `queue.title`, `filters.status`, `form.reasonRequired`.
   Group by screen or form, never by the English sentence. A key is never reused for a different
   meaning; two places that say the same thing may share one.
4. **Message syntax:** `{name}` parameters; plurals as
   `{count, plural, one {# day} other {# days}}` (use `=0 {…}` for a zero wording); emphasis or
   links inside a sentence as `<b>…</b>` / `<a>…</a>` rendered with `rich()`.
5. **Codes are not translated.** CARC/RARC/CPT/ICD codes and their sourced summaries, payer names,
   statute citations, NPIs, and anything the practice typed are shown as stored.

## Server components, actions, route handlers
```ts
import { getFormat, getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("denials");
  return { title: t("queue.title") };
}

export default async function Page() {
  const t = await getT("denials");
  const tc = await getT("common");
  const f = await getFormat();
  // t("queue.dueIn", { days: DUE_SOON_DAYS })   f.date("2026-12-31")   f.dateTime(row.createdAt)
  // f.number(total)   f.cents(cents) (same as formatCents)   tc(DENIAL_STATUSES[s].labelKey)
}
```
Server actions that return `{ error }` call `await getT("ns")` too. Zod messages: map issue paths
to keys in the action rather than putting English into the schema.

## Client components
```tsx
"use client";
import { useFormat, useLocale, useT } from "@/i18n/client";
const t = useT("claims");
const f = useFormat();
```
Rich text (either side): `rich(t("hint.mfa"), { b: (c) => <strong>{c}</strong> })` from `@/i18n/rich`.

## Domain code (`src/domain/**`, `rules/`)
Pure modules return **message keys** (`MessageKey<"claims">`) or take a `Translator` parameter; they
never import `@/i18n/server`. Label maps look like `CLAIM_STATUSES[s].labelKey`. Tests build a
translator with `createTranslator(en.claims, "en")`.

## Formatting
Dates and counts follow the language (`f.date`, `f.dateTime`, `f.number`). Money is always
`$1,234.56` (`formatCents`, `<Money>`), see ADR 0009. Never call `toLocaleString("en-US")` or
`formatDate(x)` without the locale in page code; use the formatters.

## Adding a language later
Add the code to `LOCALES`, `LOCALE_NAMES`, `INTL_TAGS` in `config.ts`, a `messages/<code>/` folder
typed `Messages`, and the CHECK constraint on `users.locale` (new migration).
