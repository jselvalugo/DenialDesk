import Link from "next/link";

/** DataTable pagination footer (DESIGN.md §9): counts on the left, previous / next on the right. */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between border-t border-border px-4 py-2.5 text-label text-muted"
    >
      <span className="tabular">
        {total === 0 ? "No results" : `Showing ${first}–${last} of ${total.toLocaleString("en-US")}`}
      </span>
      <span className="flex items-center gap-2">
        <PageLink disabled={page <= 1} href={hrefFor(page - 1)}>
          Previous
        </PageLink>
        <span className="tabular">
          Page {page} of {pages}
        </span>
        <PageLink disabled={page >= pages} href={hrefFor(page + 1)}>
          Next
        </PageLink>
      </span>
    </nav>
  );
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className = "inline-flex h-7 items-center rounded-control border px-2.5 font-medium";
  if (disabled) {
    return (
      <span aria-disabled="true" className={`${className} border-border text-subtle`}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`${className} border-border-strong bg-surface text-text hover:bg-surface-muted`}
    >
      {children}
    </Link>
  );
}
