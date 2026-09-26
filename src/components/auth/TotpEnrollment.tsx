import QRCode from "qrcode";
import type { FormState } from "@/auth/credentials";
import { otpauthUri } from "@/auth/totp";
import { CodeForm } from "@/app/login/mfa/CodeForm";

/**
 * Two-step enrollment: QR code, manual key, and the confirmation form. Shared by practice and
 * operator sign-in; the operator passes its own server action.
 */
export async function TotpEnrollment({
  secret,
  email,
  submit,
}: {
  secret: string;
  email: string;
  submit?: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const svg = await QRCode.toString(otpauthUri(secret, email), {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#0B1A33", light: "#FFFFFF" },
  });
  const grouped = secret.match(/.{1,4}/g)?.join(" ");

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
      <CodeForm mode="enroll" submit={submit} />
    </>
  );
}
