import { AuthCard } from "@/components/auth/AuthCard";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthCard hero>{children}</AuthCard>;
}
