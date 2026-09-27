import type { en } from "./en";

/** Every namespace of the English source dictionary; the other languages must match its keys exactly. */
export type Messages = { [N in keyof typeof en]: Record<keyof (typeof en)[N] & string, string> };
export type Namespace = keyof Messages;
export type MessageKey<N extends Namespace> = keyof Messages[N] & string;
