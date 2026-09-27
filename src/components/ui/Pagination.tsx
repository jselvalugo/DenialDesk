import Link from "next/link";
import { getFormat, getT } from "@/i18n/server";

/**
 * DataTable pagination footer (DESIGN.md §9): counts on the left, previous / next on the right.
 * A server component (it takes an `hrefFor` function), rendered from server pages only.
 */
export async function Pagination({
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
  const t = await getT("common");
  const f = await getFormat();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav
      aria-label={t("pagination.label")}
      className="flex items-center justify-between border-t border-border px-4 py-2.5 text-label text-muted"
    >
      <span className="tabular">
        {total === 0
          ? t("pagination.noResults")
          : t("pagination.showing", { first: f.number(first), last: f.number(last), total: f.number(total) })}
      </span>
      <span className="flex items-center gap-2">
        <PageLink disabled={page <= 1} href={hrefFor(page - 1)}>
          {t("pagination.previous")}
        </PageLink>
        <span className="tabular">
          {t("pagination.page", { page: f.number(page), pages: f.number(pages) })}
        </span>
        <PageLink disabled={page >= pages} href={hrefFor(page + 1)}>
          {t("pagination.next")}
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
