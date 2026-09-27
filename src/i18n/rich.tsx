import { Fragment, type ReactNode } from "react";

export type RichTags = Record<string, (chunks: ReactNode) => ReactNode>;

/**
 * Turns `<b>bold</b>` style tags in an already-formatted message into elements, so a sentence can
 * be translated whole while a part of it is emphasized or linked. Tags never nest; an unknown tag
 * is shown as plain text.
 */
export function rich(message: string, tags: RichTags): ReactNode {
  const pattern = /<(\w+)>(.*?)<\/\1>/gs;
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of message.matchAll(pattern)) {
    const [whole, tag, inner] = match as unknown as [string, string, string];
    if (match.index > last) nodes.push(message.slice(last, match.index));
    const render = tags[tag];
    nodes.push(<Fragment key={index++}>{render ? render(inner) : whole}</Fragment>);
    last = match.index + whole.length;
  }
  if (last < message.length) nodes.push(message.slice(last));
  return nodes.length === 1 ? nodes[0] : nodes;
}
