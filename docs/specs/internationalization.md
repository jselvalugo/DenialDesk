# Spec: Internationalization (English, Spanish, Portuguese)

Status: in progress
Roadmap item: owner request 2026-09-27 ("make the entire platform English, Spanish and Portuguese")
Requirement IDs: R-11.1 (new), R-7.5.4 (no PHI in logs: language choice is not PHI), R-7.11.5 unaffected

## Goal
Every screen, menu, message, and export label in DenialDesk reads in the user's chosen language:
English, Spanish, or Portuguese. Each user picks a language from the user menu (the dropdown that
opens from their name in the global header); the choice applies immediately, follows their account
to any device, and is remembered by the browser for the sign-in pages too.

## User stories
- As a biller whose working language is Spanish or Portuguese, I can switch the whole product to
  it from my user menu so that I work in the language I read fastest.
- As a practice administrator, I can leave the product in English while a colleague at the next
  desk uses Portuguese, because the choice is per user, not per practice.
- As the platform operator, I can switch the operator console the same way.
- As a new user, the sign-in page opens in my browser's language (if it is one of the three) before I
  have an account preference.

## Decisions
- **Three languages:** English (`en`, default), U.S. Spanish (`es`, Intl tag `es-US`), Brazilian
  Portuguese (`pt`, Intl tag `pt-BR`). These are the languages of Florida practice staff; European
  Portuguese and other regional variants are out of scope.
- **Where the choice lives:** a `dd_locale` cookie (two-letter code, httpOnly, one year) chosen from
  the user menu, plus `users.locale` on the account. Sign-in copies the account's language to the
  cookie, so the choice follows the user. With no cookie, the `Accept-Language` header decides; with
  nothing usable, English. The choice is a workforce display preference, not PHI; changing it is not
  audited.
- **Where the toggle is:** a "Language / Idioma" group in the user menu with one row per language,
  each named in itself (English, Español, Português) and the current one marked; selecting one
  submits a server action and the page re-renders in that language. The operator console, which has
  no user menu, gets the same picker behind a language button in its header.
- **Own message module, no library** (ADR 0009): `src/i18n/`. Messages are TypeScript dictionaries,
  one file per language per namespace, flat dotted keys, ICU-style `{param}` and
  `{count, plural, one {…} other {…}}` arguments, and `<b>…</b>` rich-text tags. English is the
  typed source; Spanish and Portuguese must have exactly its keys (compile error otherwise) and a
  unit test checks placeholders match.
- **Dates and numbers follow the language** (`31/12/2026` in Spanish and Portuguese, `12/31/2026`
  in English; `1.234` grouping in Portuguese). **Money does not:** amounts are always USD in U.S.
  form (`$1,234.56`) in every language, because they must match payer paperwork and the
  dollars-and-cents entry format, and `1.234,56` beside `1,234.56` invites misreads. Legal clocks
  and time zones are unchanged (America/New_York).
- **What is translated:** UI text (labels, headings, buttons, hints, empty states, validation and
  error messages returned by server actions, page titles, `aria-label`s, module and page names, the
  environment banner, the session-timeout dialog), domain labels (statuses, regimes, denial
  categories, roles, report names, column headers), and the Insight .xlsx export's sheet names,
  headers, and About text.
- **What is not translated:** data the practice entered (names, notes, payer names), codes and
  their official descriptions (CARC/RARC/CPT/ICD summaries stay as sourced, per non-negotiable 9;
  a translated CARC description would be an invented code meaning), statutory citations, audit
  event names and metadata, log lines, email addresses, and the DenialDesk name.
- **Sentence case** and every other DESIGN.md rule apply in all three languages; Spanish and
  Portuguese use their own punctuation ("¿…?" in Spanish questions) and formal address (usted /
  você).
- **Terminology** (kept consistent across namespaces; billing vocabulary as used by U.S. practices):

  | English | Spanish | Portuguese |
  |---|---|---|
  | claim | reclamación | reivindicação |
  | denial | denegación | negativa |
  | appeal | apelación | recurso |
  | payer | pagador | pagador |
  | remittance (835) | remesa | remessa |
  | prompt pay | pago puntual | pagamento pontual |
  | timely filing | presentación oportuna | prazo de envio |
  | write-off | baja (dar de baja) | baixa |
  | practice | consultorio | clínica |
  | patient chart | expediente del paciente | prontuário do paciente |
  | revenue cycle | ciclo de ingresos | ciclo de receita |
  | A/R aging | antigüedad de cuentas por cobrar | antiguidade de contas a receber |
  | journal voucher | comprobante de diario | lançamento de diário |
  | Insight (module) | Análisis | Análises |
  | Settings | Configuración | Configurações |

## Acceptance criteria
- [x] `src/i18n/` provides `getT(namespace)` / `getFormat()` for server code and `useT(namespace)` /
      `useFormat()` / `useLocale()` for client components; `formatMessage` supports parameters and
      plurals; unit tests cover them.
- [x] The user menu shows a language group with English, Español, Português; the current language
      is marked; choosing one re-renders the page in that language and stores it on the account.
- [x] The operator console header offers the same picker.
- [x] `<html lang>` matches the language.
- [x] The cookie is httpOnly, secure, SameSite=Lax, one year; an unsupported value is ignored.
- [x] Sign-in applies the account's stored language to the browser (practice and operator).
- [x] With no cookie, `Accept-Language` picks the language (`pt-BR` → Portuguese, unknown → English).
- [x] Migration 0033 adds `users.locale` (nullable, CHECK in `en|es|pt`).
- [x] Spanish and Portuguese dictionaries have exactly the English keys (type-checked) and the same
      placeholders (unit test); no plural message lacks an `other` branch.
- [x] Shared domain labels (denial statuses, claim statuses, regimes, denial categories, roles) come
      from the `common` namespace via message keys, never from English literals in domain code.
- [ ] Every page under `src/app/` (practice app, sign-in, operator console) and every component under
      `src/components/` shows no hard-coded English when the language is Spanish or Portuguese,
      including page titles (`generateMetadata`), `aria-label`s, empty states, and server-action
      error messages.
- [ ] Dates on screen use the language's order; money stays `$1,234.56`.
- [ ] The Insight .xlsx export's sheet names, column headers, About sheet, and "Suppressed (<11)"
      marker are in the language of the user who exported it.
- [ ] Existing e2e tests (English default) pass unchanged; a shell e2e test switches to Spanish from
      the user menu and sees the tab bar in Spanish, then back.
- [ ] `docs/DESIGN.md` §8 mentions the language row in the user menu; `PROJECT_STATE.md` updated.

## Data / API changes
- `users.locale text NULL CHECK (locale IN ('en','es','pt'))` (migration `0033_users_locale.sql`).
  Classification: workforce preference (REQUIREMENTS §9.1, internal), not PHI.
- Cookie `dd_locale` (see Decisions). No new endpoints; one server action `setLocale(formData)`.
- No audit event: a display preference is not a PHI read or write. (Sign-in and session events are
  unchanged.)

## Legal rules used
None. No deadline, rate, or threshold is computed or displayed differently; only the words and the
date order change. Rule IDs and citations shown on screen stay as cited.

## Out of scope
- Translating official code descriptions (CARC/RARC/CPT/ICD), payer names, statutes, or user data.
- Right-to-left languages, per-practice default language, translating outbound documents (appeal
  letters, statements sent to patients) — a later spec when those documents exist.
- Locale-aware money formatting (decided against, above) and number entry in other decimal styles.
- Machine translation at runtime; every string is authored and reviewed.

## Open questions
- Owner: should a practice administrator be able to set a practice-wide default language for new
  users (today: browser language until the user picks)? Added to `docs/owner/OWNER_ACTION_ITEMS.xlsx`
  as OA-034.
- Owner: a native-speaker review of the Spanish and Portuguese billing terminology before launch
  (OA-035). The glossary above is what the product uses until then.
