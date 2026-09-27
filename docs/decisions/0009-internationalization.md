# ADR 0009: Own message module for English, Spanish, and Portuguese

Date: 2026-09-27
Status: accepted
Spec: `docs/specs/internationalization.md`

## Context
The owner asked for the whole platform in English, Spanish, and Portuguese with a language toggle
in the user menu. The app is Next.js App Router with mostly server components, server actions that
return user-facing error strings, a client-side shell, and an .xlsx export built on the server.
Options: `next-intl` (the common library, adds `next-intl` + `use-intl`, wants its own request
config and either routed locales or a cookie setup), `react-i18next` (client-first; awkward in
server components and actions), or a small in-house module.

## Decision
Build a small module in `src/i18n/` and add no dependency:
- `config.ts`: the locale list, cookie name, Intl tags, `Accept-Language` negotiation.
- `translate.ts`: `formatMessage` (ICU-subset: `{param}`, `{n, plural, …}`), `createTranslator`.
- `messages/{en,es,pt}/<namespace>.ts`: typed dictionaries; English is the source type, the other
  two are `Messages["<namespace>"]`, so a missing or extra key fails `pnpm typecheck`. A unit test
  checks placeholders and plural branches match.
- `server.ts` (`getLocale`, `getT`, `getFormat`, `getMessages`; reads the cookie once per request),
  `client.tsx` (`LocaleProvider`, `useT`, `useFormat`, `useLocale`), `actions.ts` (`setLocale`).
- The root layout reads the language, sets `<html lang>`, and hands the one dictionary the request
  needs to client components. Server components, actions, and the export call `getT`.
- The choice is stored in a cookie and on `users.locale`; sign-in copies the account's language to
  the browser.
- Dates and counts follow the language (Intl); money stays USD in U.S. form in every language.

## Consequences
- No new packages to vet (CLAUDE.md non-negotiable 10); ~200 lines of code we own and test.
- Every user-facing string becomes a key; domain label maps hold keys, not English, and take a
  translator where they render. Page titles move from static `metadata` to `generateMetadata`.
- Client components receive the whole dictionary for one language (tens of KB, cached per
  navigation); if it grows large, split by namespace at the provider.
- Translations are authored in the repo, reviewed like code, and covered by the parity test; a
  native-speaker terminology review is an owner action item before launch.
- If we ever need locale routing (`/es/...`) for public pages, `next-intl` can be introduced then;
  the message format chosen here is a subset of ICU, so dictionaries would carry over.
