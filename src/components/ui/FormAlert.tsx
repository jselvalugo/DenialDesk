/** `id` lets a control point at the message with `aria-describedby`. */
export function FormAlert({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <div
      id={id}
      role="alert"
      className="rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-body text-danger-fg"
    >
      {message}
    </div>
  );
}
