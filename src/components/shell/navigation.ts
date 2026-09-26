export interface NavItem {
  label: string;
  href: string;
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
      { label: "Overview", href: "/", available: true },
      { label: "Denial queue", href: "/denials", available: false },
      { label: "Appeals", href: "/appeals", available: false },
    ],
  },
  {
    label: "Claims",
    items: [
      { label: "Claims", href: "/claims", available: false },
      { label: "Remittances", href: "/remittances", available: false },
      { label: "Prompt pay", href: "/prompt-pay", available: false },
    ],
  },
  {
    label: "Insight",
    items: [{ label: "Reports", href: "/reports", available: false }],
  },
];
