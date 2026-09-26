import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { connection } from "next/server";
import { AppShell } from "@/components/shell/AppShell";
import { appEnv } from "@/lib/env";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
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
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <AppShell appEnv={appEnv()}>{children}</AppShell>
      </body>
    </html>
  );
}
