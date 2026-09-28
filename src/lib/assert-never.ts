/**
 * Exhaustiveness guard for a `switch` over a union: TypeScript refuses to compile a call site whose
 * argument isn't narrowed to `never` (i.e. a branch is missing), and a value that reaches it at
 * runtime despite that (bad data, a schema drifted from its allow-list) throws instead of silently
 * falling through.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
