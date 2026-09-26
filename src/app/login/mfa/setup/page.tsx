import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { pendingEnrollmentSecret } from "@/auth/enrollment";
import { getSession } from "@/auth/session";
import { otpauthUri } from "@/auth/totp";
import { CodeForm } from "../CodeForm";

export const metadata: Metadata = { title: "Set up two-step verification" };

export default async function MfaSetupPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mfaVerified) redirect("/");
  if (session.mustChangePassword) redirect("/login/password");
  if (session.mfaEnrolled) redirect("/login/mfa");

  const pending = await pendingEnrollmentSecret();
  if (!pending) redirect("/login");
  const svg = await QRCode.toString(otpauthUri(pending.secret, pending.email), {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#0B1A33", light: "#FFFFFF" },
  });
  const grouped = pending.secret.match(/.{1,4}/g)?.join(" ");

  return (
    <>
      <h1 className="font-serif text-[1.375rem] leading-8 font-bold text-primary">
        Set up two-step verification
      </h1>
      <p className="mt-1 mb-6 text-body text-muted">
        Required for every account. Scan this code with an authenticator app such as Microsoft Authenticator,
        then enter the 6-digit code it shows.
      </p>
      <div className="mb-6 flex items-center gap-5">
        <div
          className="size-36 shrink-0 rounded-control border border-border p-2"
          role="img"
          aria-label="QR code for your authenticator app"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="min-w-0">
          <p className="text-label font-medium text-muted">Can&apos;t scan? Enter this key</p>
          <p className="mt-1 font-mono text-label break-all text-text">{grouped}</p>
        </div>
      </div>
      <CodeForm mode="enroll" />
    </>
  );
}
