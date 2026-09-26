import {
  BarChart3,
  FileText,
  Gavel,
  Inbox,
  LayoutDashboard,
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
      { label: "Claims", href: "/claims", icon: FileText, available: false },
      { label: "Remittances", href: "/remittances", icon: Receipt, available: false },
      { label: "Prompt pay", href: "/prompt-pay", icon: Scale, available: false },
    ],
  },
  {
    label: "Insight",
    items: [{ label: "Reports", href: "/reports", icon: BarChart3, available: false }],
  },
];
