import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      // Logging goes through src/lib/log.ts so PHI can't reach logs (CLAUDE.md non-negotiable 4).
      "no-console": "error",
    },
  },
];

export default config;
