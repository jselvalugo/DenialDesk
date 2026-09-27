"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./config";
import { createFormatters, type Formatters } from "./format";
import { en } from "./messages/en";
import type { Messages, Namespace } from "./messages/types";
import { createTranslator, type Translator } from "./translate";

interface LocaleContextValue {
  locale: Locale;
  messages: Messages;
}

// Outside a provider (tests, isolated renders) client components read English.
const LocaleContext = createContext<LocaleContextValue>({ locale: DEFAULT_LOCALE, messages: en });

/** Hands the request's language and dictionary to every client component below it (root layout). */
export function LocaleProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

/** `t` for one namespace in client components. */
export function useT<N extends Namespace>(namespace: N): Translator<Messages[N]> {
  const { locale, messages } = useContext(LocaleContext);
  return useMemo(() => createTranslator(messages[namespace], locale), [messages, namespace, locale]);
}

/** Locale-aware date, date-time, and number formatting for client components. */
export function useFormat(): Formatters {
  const locale = useLocale();
  return useMemo(() => createFormatters(locale), [locale]);
}
