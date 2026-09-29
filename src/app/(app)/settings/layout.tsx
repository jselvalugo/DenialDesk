import { PageHeader } from "@/components/ui/PageHeader";
import { getT } from "@/i18n/server";
import { SettingsTabs, type SettingsTab } from "./SettingsTabs";

/** Settings: one header, a tab per section (docs/specs/settings-and-custom-fields.md). */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = await getT("settings");
  const tabs: SettingsTab[] = [
    { label: t("tabs.general"), href: "/settings", available: true },
    { label: t("tabs.customFields"), href: "/settings/fields", available: true },
    { label: t("tabs.payers"), href: "/settings/payers", available: true },
    { label: t("tabs.appealLetters"), href: "/settings/appeal-templates", available: true },
    { label: t("tabs.usersAndRoles"), href: "/settings/users", available: false },
    { label: t("tabs.security"), href: "/settings/security", available: false },
    { label: t("tabs.notifications"), href: "/settings/notifications", available: false },
    { label: t("tabs.integrations"), href: "/settings/integrations", available: true },
  ];
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader title={t("page.title")} description={t("page.description")} />
      <SettingsTabs tabs={tabs} />
      {children}
    </div>
  );
}
