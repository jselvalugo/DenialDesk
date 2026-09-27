import { AuthCard } from "@/components/auth/AuthCard";
import { getT } from "@/i18n/server";

/** The platform console's own sign-in pages, separate from practice sign-in. */
export default async function OperatorAuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getT("auth");
  return <AuthCard label={t("operator.consoleLabel")}>{children}</AuthCard>;
}
