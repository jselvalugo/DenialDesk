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
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** False until the feature ships; rendered as a non-link. */
  available: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
  /** Only for roles that can view revenue cycle accounting. */
  revenueCycle?: boolean;
}

export const navigation: NavSection[] = [
  {
    label: "Work",
    items: [
      { label: "Overview", href: "/", icon: LayoutDashboard, available: true },
      { label: "Denial queue", href: "/denials", icon: Inbox, available: true },
      { label: "Appeals", href: "/appeals", icon: Gavel, available: false },
    ],
  },
  {
    label: "Claims",
    items: [
      { label: "Claims", href: "/claims", icon: FileText, available: true },
      { label: "Remittances", href: "/remittances", icon: Receipt, available: false },
      { label: "Prompt pay", href: "/prompt-pay", icon: Scale, available: false },
    ],
  },
  {
    label: "Revenue cycle",
    revenueCycle: true,
    items: [
      { label: "RCM dashboard", href: "/revenue-cycle/dashboard", icon: LineChart, available: true },
      { label: "Monthly files", href: "/revenue-cycle/files", icon: FileSpreadsheet, available: true },
      { label: "Journal vouchers", href: "/revenue-cycle/journal", icon: NotebookPen, available: true },
      { label: "A/R aging", href: "/revenue-cycle/ar-aging", icon: Hourglass, available: true },
      { label: "Deposits", href: "/revenue-cycle/deposits", icon: Landmark, available: true },
      { label: "Statements", href: "/revenue-cycle/statements", icon: PieChart, available: true },
      { label: "Rules and ledger", href: "/revenue-cycle/rules", icon: BookOpenCheck, available: true },
    ],
  },
  {
    label: "Insight",
    items: [{ label: "Reports", href: "/reports", icon: BarChart3, available: false }],
  },
];
