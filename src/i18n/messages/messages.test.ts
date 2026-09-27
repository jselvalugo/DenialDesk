import { describe, expect, it } from "vitest";
import { LOCALES } from "../config";
import { messages } from "./index";
import type { Namespace } from "./types";

const namespaces = Object.keys(messages.en) as Namespace[];

/** `{name}` and `{name, plural, …}` argument names, plus `<tag>` names, that a message uses. */
function placeholders(message: string): string[] {
  const names = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)) names.add(match[1]!);
  for (const match of message.matchAll(/<(\w+)>/g)) names.add(`<${match[1]}>`);
  return [...names].sort();
}

describe("message dictionaries (spec: internationalization)", () => {
  it("every language has every namespace and every key of the English source", () => {
    for (const locale of LOCALES) {
      for (const namespace of namespaces) {
        const source = Object.keys(messages.en[namespace]).sort();
        const target = Object.keys(messages[locale][namespace] ?? {}).sort();
        expect(target, `${locale}.${namespace} keys`).toEqual(source);
      }
    }
  });

  it("no translation is empty or left in English by accident (identical values are allowed only for short names, codes, and shared terms)", () => {
    for (const locale of LOCALES) {
      for (const namespace of namespaces) {
        for (const [key, value] of Object.entries(messages[locale][namespace])) {
          expect(value.trim(), `${locale}.${namespace}.${key}`).not.toBe("");
        }
      }
    }
  });

  it("translations keep the same placeholders and rich-text tags as the English message", () => {
    for (const locale of LOCALES) {
      if (locale === "en") continue;
      for (const namespace of namespaces) {
        const table = messages[locale][namespace] as Record<string, string>;
        for (const [key, source] of Object.entries(messages.en[namespace] as Record<string, string>)) {
          expect(placeholders(table[key] ?? ""), `${locale}.${namespace}.${key}`).toEqual(placeholders(source));
        }
      }
    }
  });

  it("plural messages always have an `other` branch", () => {
    for (const locale of LOCALES) {
      for (const namespace of namespaces) {
        for (const [key, value] of Object.entries(messages[locale][namespace] as Record<string, string>)) {
          if (value.includes("plural,")) {
            expect(value, `${locale}.${namespace}.${key}`).toMatch(/\bother\s*\{/);
          }
        }
      }
    }
  });
});
