import type { Metadata } from "next";
import { Inter, Playfair_Display, Space_Mono } from "next/font/google";
import { connection } from "next/server";
import { PreviewBanner } from "@/components/shell/PreviewBanner";
import { appEnv, isProduction } from "@/lib/env";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-playfair",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

// Page titles never contain PHI (DESIGN.md §12).
export const metadata: Metadata = {
  title: { default: "DenialDesk", template: "%s · DenialDesk" },
  description: "Claims and denial management for Florida physician practices.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request so APP_ENV is read at runtime, not baked in at build time: one container
  // image must behave correctly when promoted from preview to production.
  await connection();
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable} ${spaceMono.variable}`}>
      <body className="flex h-dvh flex-col">
        {!isProduction() && <PreviewBanner appEnv={appEnv()} />}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
