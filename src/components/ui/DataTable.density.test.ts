import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Table, Td } from "./DataTable";

/**
 * `Table`/`Td` are plain functions (no hooks, no "use client"), so they render fine with
 * `react-dom/server` outside of Next — no new test dependency, and no need for `SortableHeader`
 * (which uses `next/link`) since density is a `Table`/`Td` concern only.
 */
function renderRow(density?: "default" | "compact"): string {
  const body = createElement("tbody", null, createElement("tr", null, createElement(Td, null, "x")));
  // `createElement`'s children-less overload doesn't match `Table`'s props type (it declares
  // `children` as its own required prop, not the usual `PropsWithChildren` shape React's typings
  // special-case); passing the child as a normal `createElement` argument instead of a `children`
  // prop needs one narrow `as never` for the props object as a result.
  return renderToStaticMarkup(createElement(Table, { caption: "Density test", density } as never, body));
}

describe("Table density (P4)", () => {
  it("renders with no style attribute on <table> when density is omitted (Td keeps its default sizing via the fallback in its class)", () => {
    const html = renderRow();
    expect(html).toMatch(/<table class="[^"]*"><caption/);
    expect(html).not.toContain("style=");
  });

  it("sets the compact row-height custom property on <table> when density is compact", () => {
    const html = renderRow("compact");
    expect(html).toMatch(/<table class="[^"]*" style="--dd-row-h:2rem;--dd-row-px:0\.5rem">/);
  });
});
