import {
  BarChart3,
  BookOpenCheck,
  FileSpreadsheet,
  FileText,
  Gavel,
  Hourglass,
  Inbox,
  Landmark,
  LayoutDashboard,
  LineChart,
  NotebookPen,
  PieChart,
  Receipt,
  Scale,
  Settings2,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { en } from "@/i18n/messages/en";
import type { MessageKey } from "@/i18n/messages/types";
import { createTranslator } from "@/i18n/translate";

type ShellKey = MessageKey<"shell">;
/** Resolves a shell message key to text in the user's language; English when none is given (tests). */
export type NavLabels = (key: ShellKey) => string;
const englishLabels: NavLabels = createTranslator(en.shell, "en");

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** False until the feature ships; listed in the module switcher as "Planned", never a link. */
  available: boolean;
  /**
   * Marks a tab with its own data-source menu in the tab bar (docs/specs/erp-shell.md
   * "Data-source drop-down"; docs/specs/patient-integrations.md). Only Patients sets this today;
   * other tables opt in later by setting it too, with no shell redesign.
   */
  dataSource?: { table: "patients" };
}

/** A module ("app" in code) groups related pages: switched from the module switcher, its pages are tabs. */
export interface NavApp {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Tile tint in the switcher and page headers (DESIGN.md §4). */
  tone: "teal" | "navy" | "blue" | "amber" | "slate";
  items: NavItem[];
}

export interface NavVisibility {
  showRevenueCycle: boolean;
  /** Signed-in practice users: the practice Settings pages. */
  showSettings?: boolean;
}

/**
 * What the menus show, in the user's language (`t` from the shell namespace; English by default).
 * Not access control: every page still enforces its own permission on the server.
 */
export function navApps(
  { showRevenueCycle, showSettings = false }: NavVisibility,
  t: NavLabels = englishLabels,
): NavApp[] {
  const apps: NavApp[] = [
    {
      id: "denials",
      label: t("module.denials"),
      description: t("module.denials.description"),
      icon: ShieldAlert,
      tone: "teal",
      items: [
        { label: t("page.overview"), href: "/overview", icon: LayoutDashboard, available: true },
        { label: t("page.denialQueue"), href: "/denials", icon: Inbox, available: true },
        { label: t("page.appeals"), href: "/appeals", icon: Gavel, available: true },
      ],
    },
    {
      id: "patients",
      label: t("module.patients"),
      description: t("module.patients.description"),
      icon: Users,
      tone: "slate",
      items: [
        {
          label: t("page.patients"),
          href: "/patients",
          icon: Users,
          available: true,
          dataSource: { table: "patients" },
        },
      ],
    },
    {
      id: "claims",
      label: t("module.claims"),
      description: t("module.claims.description"),
      icon: FileText,
      tone: "blue",
      items: [
        { label: t("page.claims"), href: "/claims", icon: FileText, available: true },
        { label: t("page.remittances"), href: "/remittances", icon: Receipt, available: true },
        { label: t("page.promptPay"), href: "/prompt-pay", icon: Scale, available: true },
      ],
    },
  ];
  if (showRevenueCycle) {
    apps.push({
      id: "revenue-cycle",
      label: t("module.revenueCycle"),
      description: t("module.revenueCycle.description"),
      icon: Landmark,
      tone: "navy",
      items: [
        {
          label: t("page.monthlyFiles"),
          href: "/revenue-cycle/files",
          icon: FileSpreadsheet,
          available: true,
        },
        {
          label: t("page.journalVouchers"),
          href: "/revenue-cycle/journal",
          icon: NotebookPen,
          available: true,
        },
        { label: t("page.arAging"), href: "/revenue-cycle/ar-aging", icon: Hourglass, available: true },
        { label: t("page.deposits"), href: "/revenue-cycle/deposits", icon: Landmark, available: true },
        {
          label: t("page.rulesAndLedger"),
          href: "/revenue-cycle/rules",
          icon: BookOpenCheck,
          available: true,
        },
        { label: t("page.rcmDashboard"), href: "/revenue-cycle/dashboard", icon: LineChart, available: true },
        { label: t("page.statements"), href: "/revenue-cycle/statements", icon: PieChart, available: true },
      ],
    });
  }
  apps.push({
    id: "insight",
    label: t("module.insight"),
    description: t("module.insight.description"),
    icon: BarChart3,
    tone: "amber",
    items: [{ label: t("page.reports"), href: "/insight", icon: BarChart3, available: true }],
  });
  const settings: NavItem[] = [];
  // The platform console isn't linked from practices: it has its own sign-in (/operator/login).
  if (showSettings) {
    settings.push({ label: t("page.settings"), href: "/settings", icon: Settings2, available: true });
  }
  if (settings.length > 0) {
    apps.push({
      id: "settings",
      label: t("module.settings"),
      description: t("module.settings.description"),
      icon: Settings2,
      tone: "slate",
      items: settings,
    });
  }
  return apps;
}

function matches(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The app and page a path belongs to; detail pages resolve to their list page. */
export function locate(apps: NavApp[], pathname: string): { app: NavApp; item: NavItem | null } {
  let best: { app: NavApp; item: NavItem } | null = null;
  for (const app of apps) {
    for (const item of app.items) {
      if (
        item.available &&
        matches(item.href, pathname) &&
        (!best || item.href.length > best.item.href.length)
      ) {
        best = { app, item };
      }
    }
  }
  return best ?? { app: apps[0]!, item: null };
}

function includes(text: string, query: string) {
  return text.toLowerCase().includes(query);
}

/**
 * Module switcher search: modules whose name, description, or pages match the query. A matching
 * module keeps all of its pages; otherwise only the matching pages are listed under it.
 */
export function filterModules(apps: NavApp[], query: string): { app: NavApp; items: NavItem[] }[] {
  const q = query.trim().toLowerCase();
  if (!q) return apps.map((app) => ({ app, items: app.items }));
  return apps
    .map((app) => {
      const moduleMatches = includes(app.label, q) || includes(app.description, q);
      const items = moduleMatches ? app.items : app.items.filter((item) => includes(item.label, q));
      return { app, items };
    })
    .filter((group) => group.items.length > 0);
}

/** First page of a module: where its switcher link goes. */
export function appHome(app: NavApp): string | null {
  return app.items.find((item) => item.available)?.href ?? null;
}
