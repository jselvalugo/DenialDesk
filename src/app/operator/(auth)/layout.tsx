import { AuthCard } from "@/components/auth/AuthCard";

/** The platform console's own sign-in pages, separate from practice sign-in. */
export default function OperatorAuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthCard label="Platform console">{children}</AuthCard>;
}
