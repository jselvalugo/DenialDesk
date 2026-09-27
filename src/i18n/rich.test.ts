import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { rich } from "./rich";

const strong = (chunks: ReactNode) => createElement("strong", null, chunks);

function findType(node: ReactNode, type: string): ReactElement | undefined {
  if (Array.isArray(node)) return node.map((n) => findType(n, type)).find(Boolean);
  if (!isValidElement(node)) return undefined;
  if (node.type === type) return node;
  return findType((node as ReactElement<{ children?: ReactNode }>).props.children, type);
}

function texts(node: ReactNode): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (isValidElement(node)) return texts((node as ReactElement<{ children?: ReactNode }>).props.children);
  return [];
}

describe("rich", () => {
  it("turns a tag into the caller's element and keeps the surrounding text", () => {
    const out = rich("Use <b>an authenticator app</b> to sign in.", { b: strong });
    expect(Array.isArray(out)).toBe(true);
    expect(texts(out)).toEqual(["Use ", "an authenticator app", " to sign in."]);
    expect(findType(out, "strong")).toBeDefined();
  });

  it("returns plain text untouched and shows unknown tags as text", () => {
    expect(rich("No tags here", { b: strong })).toBe("No tags here");
    expect(texts(rich("Keep <i>this</i>", { b: strong }))).toEqual(["Keep ", "<i>this</i>"]);
  });
});
