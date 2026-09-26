import { serverEnv } from "@/lib/env";

// Runs once when the server starts: refuse to boot with missing or invalid configuration.
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    serverEnv();
  }
}
