import type { NextConfig } from "next";
import { STATIC_ASSET_CSP } from "./src/lib/csp";

// Security headers for every response (REQUIREMENTS §7.3.1, §7.4.1).
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Monthly revenue cycle files upload through a server action (5 MB cap enforced in code).
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  reactStrictMode: true,
  // Container builds for Azure set BUILD_STANDALONE=1; Netlify builds use its own adapter (ADR 0003).
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  async headers() {
    // Pages get a per-request nonce CSP from src/proxy.ts; the paths it skips get this one.
    const staticCsp = [{ key: "Content-Security-Policy", value: STATIC_ASSET_CSP }];
    return [
      { source: "/:path*", headers: securityHeaders },
      ...["/_next/static/:path*", "/_next/image", "/icon.png", "/brand/:path*"].map((source) => ({
        source,
        headers: staticCsp,
      })),
    ];
  },
};

export default nextConfig;
