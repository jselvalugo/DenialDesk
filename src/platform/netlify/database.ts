import { getConnectionString, MissingDatabaseConnectionError } from "@netlify/database";

/**
 * Netlify Database connection string (pre-production only, ADR 0003), or null when not running on
 * Netlify. Netlify provisions the database automatically and gives each deploy preview its own
 * isolated branch of it.
 */
export function netlifyDatabaseUrl(): string | null {
  try {
    return getConnectionString();
  } catch (error) {
    if (error instanceof MissingDatabaseConnectionError) return null;
    throw error;
  }
}
