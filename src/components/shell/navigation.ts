import {
  BarChart3,
  BookOpenCheck,
  Building2,
  FileSpreadsheet,
  FileText,
  Gavel,
  Hourglass,
  Inbox,
  Landmark,
  LayoutDashboard,
  LineChart,
  NotebookPen,
  Palette,
  PieChart,
  Receipt,
  Scale,
  Settings2,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** False until the feature ships; listed in the app launcher as "Planned", never a link. */
  available: boolean;
}

/** An app groups related pages, like an ERP module: switched in the app launcher, its pages are tabs. */
export interface NavApp {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Tile color in the launcher and page headers (a chart-series token, DESIGN.md §5). */
  tone: "teal" | "navy" | "blue" | "amber" | "slate";
  items: NavItem[];
}

export interface NavVisibility {
  showRevenueCycle: boolean;
  showOperatorConsole: boolean;
  showDesignSystem: boolean;
}

/** What the menus show. Not access control: every page still enforces its own permission on the server. */
export function navApps({
  showRevenueCycle,
  showOperatorConsole,
  showDesignSystem,
}: NavVisibility): NavApp[] {
  const apps: NavApp[] = [
    {
      id: "denials",
      label: "Denials",
      description: "Open denials, appeal deadlines, and the work queue.",
      icon: ShieldAlert,
      tone: "teal",
      items: [
        { label: "Overview", href: "/", icon: LayoutDashboard, available: true },
        { label: "Denial queue", href: "/denials", icon: Inbox, available: true },
        { label: "Appeals", href: "/appeals", icon: Gavel, available: false },
      ],
    },
    {
      id: "claims",
      label: "Claims",
      description: "Claims, corrections, remittances, and prompt-pay tracking.",
      icon: FileText,
      tone: "blue",
      items: [
        { label: "Claims", href: "/claims", icon: FileText, available: true },
        { label: "Remittances", href: "/remittances", icon: Receipt, available: false },
        { label: "Prompt pay", href: "/prompt-pay", icon: Scale, available: false },
      ],
    },
  ];
  if (showRevenueCycle) {
    apps.push({
      id: "revenue-cycle",
      label: "Revenue cycle",
      description: "Monthly files, journal vouchers, A/R aging, deposits, and the ledger.",
      icon: Landmark,
      tone: "navy",
      items: [
        { label: "Monthly files", href: "/revenue-cycle/files", icon: FileSpreadsheet, available: true },
        { label: "Journal vouchers", href: "/revenue-cycle/journal", icon: NotebookPen, available: true },
        { label: "A/R aging", href: "/revenue-cycle/ar-aging", icon: Hourglass, available: true },
        { label: "Deposits", href: "/revenue-cycle/deposits", icon: Landmark, available: true },
        { label: "Rules and ledger", href: "/revenue-cycle/rules", icon: BookOpenCheck, available: true },
        { label: "RCM dashboard", href: "/revenue-cycle/dashboard", icon: LineChart, available: false },
        { label: "Statements", href: "/revenue-cycle/statements", icon: PieChart, available: false },
      ],
    });
  }
  apps.push({
    id: "insight",
    label: "Insight",
    description: "Reports on denial trends, recovery, and payer performance.",
    icon: BarChart3,
    tone: "amber",
    items: [{ label: "Reports", href: "/reports", icon: BarChart3, available: false }],
  });
  const setup: NavItem[] = [];
  if (showOperatorConsole) {
    setup.push({ label: "Platform console", href: "/operator", icon: Building2, available: true });
  }
  if (showDesignSystem) {
    setup.push({ label: "Design system", href: "/design", icon: Palette, available: true });
  }
  if (setup.length > 0) {
    apps.push({
      id: "setup",
      label: "Setup",
      description: "Platform administration and the design style guide.",
      icon: Settings2,
      tone: "slate",
      items: setup,
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

/** First page of an app: where its launcher tile goes. */
export function appHome(app: NavApp): string | null {
  return app.items.find((item) => item.available)?.href ?? null;
}
