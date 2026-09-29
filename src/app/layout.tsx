import type { Metadata } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";
import { PreviewBanner } from "@/components/shell/PreviewBanner";
import { LocaleProvider } from "@/i18n/client";
import { getMessages, getT } from "@/i18n/server";
import { appEnv, isProduction } from "@/lib/env";
import "./globals.css";

// Fonts are bundled in ./fonts (SIL OFL 1.1) so builds need no network access (fonts/README.md).
const inter = localFont({
  src: "./fonts/inter-latin-wght.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

const playfair = localFont({
  src: "./fonts/playfair-display-latin-wght.woff2",
  weight: "400 900",
  variable: "--font-playfair",
  display: "swap",
});

const spaceMono = localFont({
  src: [
    { path: "./fonts/space-mono-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/space-mono-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-space-mono",
  display: "swap",
});

// Page titles never contain PHI (DESIGN.md §12).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("shell");
  return {
    title: { default: "DenialDesk", template: "%s · DenialDesk" },
    description: t("meta.description"),
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request so APP_ENV is read at runtime, not baked in at build time: one container
  // image must behave correctly when promoted from preview to production.
  await connection();
  // The language comes from the user's choice (cookie) or the browser; the dictionary for that one
  // language is handed to client components once, here (spec: internationalization).
  const { locale, messages } = await getMessages();
  return (
    <html lang={locale} className={`${inter.variable} ${playfair.variable} ${spaceMono.variable}`}>
      <body className="flex h-dvh flex-col print:block print:h-auto">
        <LocaleProvider locale={locale} messages={messages}>
          {!isProduction() && (
            <div className="print:hidden">
              <PreviewBanner appEnv={appEnv()} />
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col print:block">{children}</div>
        </LocaleProvider>
      </body>
    </html>
  );
}
