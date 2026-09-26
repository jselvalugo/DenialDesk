// Minimal, defensive X12 tokenizer shared by transaction-specific parsers.
// Treats all input as untrusted (R-7.4.6): validates structure before use.

export const MAX_X12_BYTES = 5 * 1024 * 1024; // 5 MB

export interface Segment {
  /** Segment ID, e.g. "ISA", "CLP" */
  id: string;
  /** Elements after the segment ID, split on the element separator. Sub-elements are not split. */
  elements: string[];
  /** 1-based position of this segment within the transmitted file (for error messages). */
  position: number;
}

export interface TokenizeResult {
  segments: Segment[];
  elementSeparator: string;
  segmentTerminator: string;
}

/**
 * Split raw X12 text into segments using the separators declared in the ISA
 * header (or defaults when no ISA is present). Never throws on PHI content;
 * only throws for structural/size problems.
 */
export function tokenize(text: string): TokenizeResult {
  if (typeof text !== "string") {
    throw new Error("X12 input must be a string");
  }
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > MAX_X12_BYTES) {
    throw new Error(`X12 input exceeds maximum size of ${MAX_X12_BYTES} bytes`);
  }

  let elementSeparator = "*";
  let segmentTerminator = "~";

  const trimmed = text.replace(/^﻿/, "");
  if (trimmed.startsWith("ISA")) {
    // ISA is a fixed-width segment: element separator is the character at
    // position 3 (0-indexed), and the segment terminator is the character
    // immediately after ISA16 (position 105, 0-indexed), per the 005010
    // implementation guides.
    if (trimmed.length < 106) {
      throw new Error("ISA segment is too short to determine separators");
    }
    elementSeparator = trimmed[3] as string;
    segmentTerminator = trimmed[105] as string;
  }

  // Split on the segment terminator; tolerate CR/LF immediately around it.
  const rawSegments = trimmed.split(segmentTerminator);

  const segments: Segment[] = [];
  let position = 0;
  for (const raw of rawSegments) {
    const cleaned = raw.replace(/^[\r\n]+/, "").replace(/[\r\n]+$/, "");
    if (cleaned.trim() === "") continue;
    position += 1;
    const parts = cleaned.split(elementSeparator);
    const id = parts[0] ?? "";
    segments.push({ id, elements: parts.slice(1), position });
  }

  return { segments, elementSeparator, segmentTerminator };
}
