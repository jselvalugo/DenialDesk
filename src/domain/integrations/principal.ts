// The constant lives in the data layer (`src/db/integration-principal.ts`), which `withTenantAsSystem`
// needs and which must not import from the domain. Re-exported here for the engine and the tests.
export { INTEGRATION_SERVICE_PRINCIPAL_ID } from "@/db/integration-principal";
