import { PageHeader } from "@/components/ui/PageHeader";
import { isProduction } from "@/lib/env";
import { SettingsTabs, type SettingsTab } from "./SettingsTabs";

/** Settings: one header, a tab per section (docs/specs/settings-and-custom-fields.md). */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const tabs: SettingsTab[] = [
    { label: "General", href: "/settings", available: true },
    { label: "Custom fields", href: "/settings/fields", available: true },
    { label: "Users and roles", href: "/settings/users", available: false },
    { label: "Security", href: "/settings/security", available: false },
    { label: "Notifications", href: "/settings/notifications", available: false },
    { label: "Integrations", href: "/settings/integrations", available: false },
  ];
  // The style guide is a pre-production page with its own route; it is listed here to find it.
  if (!isProduction()) tabs.push({ label: "Design system", href: "/design", available: true });
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title="Settings"
        description="How DenialDesk is set up for your practice: its profile, the fields on its records, and who can do what."
      />
      <SettingsTabs tabs={tabs} />
      {children}
    </div>
  );
}
