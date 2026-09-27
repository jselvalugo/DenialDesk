import { describe, expect, it } from "vitest";
import {
  headings,
  inlineNodes,
  isSafeHref,
  linkHrefs,
  parseInline,
  parseMarkdown,
  plainText,
  ruleIds,
  slugify,
} from "./markdown";

describe("parseInline", () => {
  it("parses bold, code, links, and rule tokens around plain text", () => {
    expect(parseInline("A **bold** `code` [link](/denials) and {{rule:fl.timely_filing.initial}}.")).toEqual([
      { type: "text", text: "A " },
      { type: "strong", children: [{ type: "text", text: "bold" }] },
      { type: "text", text: " " },
      { type: "code", text: "code" },
      { type: "text", text: " " },
      { type: "link", href: "/denials", children: [{ type: "text", text: "link" }] },
      { type: "text", text: " and " },
      { type: "rule", id: "fl.timely_filing.initial" },
      { type: "text", text: "." },
    ]);
  });

  it("keeps an unsafe link's text but drops the link", () => {
    expect(parseInline("[x](javascript:alert)")).toEqual([{ type: "text", text: "x" }]);
    expect(parseInline("[x](http://insecure.example)")).toEqual([{ type: "text", text: "x" }]);
    expect(parseInline("[x](//evil.example)")).toEqual([{ type: "text", text: "x" }]);
    expect(parseInline("[x](/\\evil.example)")).toEqual([{ type: "text", text: "x" }]);
    expect(isSafeHref("https://x12.org/codes")).toBe(true);
    expect(isSafeHref("/university/wiki")).toBe(true);
  });

  it("never produces HTML: angle brackets stay text", () => {
    expect(parseInline("<script>alert(1)</script>")).toEqual([
      { type: "text", text: "<script>alert(1)</script>" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("parses headings with anchors, paragraphs, lists, notes, and tables", () => {
    const blocks = parseMarkdown(`
## First section
Line one
line two.

- a
- b

1. one
2. two

> note
> continues

| H1 | H2 |
| --- | --- |
| c1 | c2 |

### Sub
`);
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "note",
      "table",
      "heading",
    ]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2, id: "first-section" });
    const paragraph = blocks[1]!;
    expect(paragraph.type === "paragraph" && plainText(paragraph.children)).toBe("Line one line two.");
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[3]).toMatchObject({ type: "list", ordered: true });
    const note = blocks[4]!;
    expect(note.type === "note" && plainText(note.children)).toBe("note continues");
    expect(blocks[5]).toMatchObject({
      type: "table",
      header: [[{ type: "text", text: "H1" }], [{ type: "text", text: "H2" }]],
      rows: [[[{ type: "text", text: "c1" }], [{ type: "text", text: "c2" }]]],
    });
    expect(blocks[6]).toMatchObject({ type: "heading", level: 3, id: "sub" });
  });

  it("gives repeated headings distinct anchors", () => {
    const ids = headings(parseMarkdown("## Notes\n\n## Notes\n\n## Notes")).map((heading) => heading.id);
    expect(ids).toEqual(["notes", "notes-2", "notes-3"]);
  });

  it("collects rule ids and link hrefs from every block type", () => {
    const blocks = parseMarkdown(`
## {{rule:a.b}} [h](/one)
para {{rule:c.d}} [p](https://example.org)
- {{rule:a.b}} [l](/two)
> [n](/three)
| [t](/four) |
| --- |
| {{rule:e.f}} |
`);
    expect(ruleIds(blocks)).toEqual(["a.b", "c.d", "e.f"]);
    expect(linkHrefs(blocks)).toEqual(["/one", "https://example.org", "/two", "/three", "/four"]);
    expect(inlineNodes(blocks).some((node) => node.type === "strong")).toBe(false);
  });

  it("slugifies heading text", () => {
    expect(slugify("The three kinds of code!")).toBe("the-three-kinds-of-code");
  });
});
