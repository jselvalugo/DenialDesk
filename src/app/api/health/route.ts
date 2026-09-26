import { pingDatabase } from "@/db/client";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbUp = await pingDatabase();
  return Response.json(
    { status: dbUp ? "ok" : "degraded", appEnv: serverEnv().APP_ENV, db: dbUp ? "up" : "down" },
    { status: dbUp ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
