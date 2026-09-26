export function FormAlert({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-body text-danger-fg"
    >
      {message}
    </div>
  );
}
