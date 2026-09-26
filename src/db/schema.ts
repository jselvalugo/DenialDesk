import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Every table with tenant_id has row-level security (drizzle/0002_security.sql) and an isolation
// test (test/integration/tenancy.test.ts). Money is integer cents. Calendar dates are `date`.

const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const cents = (name: string) => bigint(name, { mode: "number" });

// ---------------------------------------------------------------------------------------------
// Identity and tenancy (no RLS: read before a tenant is chosen; never exposed to tenant queries)
// ---------------------------------------------------------------------------------------------

export const roleEnum = pgEnum("member_role", ["admin", "manager", "specialist", "compliance"]);

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    totpSecretEnc: text("totp_secret_enc"),
    mfaEnrolledAt: timestamp("mfa_enrolled_at", { withTimezone: true }),
    totpLastStep: bigint("totp_last_step", { mode: "number" }),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(sql`lower(${t.email})`)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_tenant_user_key").on(t.tenantId, t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sessions_token_hash_key").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------------------------
// Practice setup (REQUIREMENTS §8.1)
// ---------------------------------------------------------------------------------------------

export const regimeEnum = pgEnum("regulatory_regime", [
  "fl_insurer",
  "fl_hmo",
  "erisa_self_funded",
  "medicare",
  "medicare_advantage",
  "medicaid_ffs",
  "smmc",
  "workers_comp",
  "pip",
]);

export const locations = pgTable("locations", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  timeZone: text("time_zone").notNull().default("America/New_York"),
  createdAt: createdAt(),
});

export const providers = pgTable(
  "providers",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    npi: text("npi").notNull(),
    taxonomy: text("taxonomy").notNull(),
    flLicense: text("fl_license"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("providers_tenant_npi_key").on(t.tenantId, t.npi)],
);

export const payers = pgTable("payers", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  ediPayerId: text("edi_payer_id").notNull(),
  regime: regimeEnum("regime").notNull(),
  /** Appeal window from the payer contract (not statute). Null = not configured. */
  appealWindowDays: integer("appeal_window_days"),
  appealWindowSource: text("appeal_window_source"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Patients and claims (Restricted PHI, REQUIREMENTS §9.1)
// ---------------------------------------------------------------------------------------------

export const patients = pgTable(
  "patients",
  {
    id: id(),
    tenantId: tenantId(),
    mrn: text("mrn").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    birthDate: date("birth_date", { mode: "string" }).notNull(),
    /** Field-level encrypted (R-7.3.3). Never select into logs. */
    memberIdEnc: text("member_id_enc").notNull(),
    memberIdLast4: text("member_id_last4").notNull(),
    sensitivityTags: text("sensitivity_tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("patients_tenant_mrn_key").on(t.tenantId, t.mrn)],
);

export const claimStatusEnum = pgEnum("claim_status", [
  "draft",
  "submitted",
  "acknowledged",
  "rejected",
  "paid",
  "partially_paid",
  "denied",
  "closed",
]);

export const claims = pgTable(
  "claims",
  {
    id: id(),
    tenantId: tenantId(),
    claimNumber: text("claim_number").notNull(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    payerId: uuid("payer_id")
      .notNull()
      .references(() => payers.id),
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    diagnosisCodes: text("diagnosis_codes").array().notNull(),
    billedCents: cents("billed_cents").notNull(),
    paidCents: cents("paid_cents").notNull().default(0),
    status: claimStatusEnum("status").notNull(),
    electronic: boolean("electronic").notNull().default(true),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Payer receipt date from the 277CA; starts the Florida prompt-pay clock (R-3.1.1). */
    payerReceivedDate: date("payer_received_date", { mode: "string" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("claims_tenant_number_key").on(t.tenantId, t.claimNumber),
    index("claims_tenant_payer_idx").on(t.tenantId, t.payerId),
  ],
);

export const claimLines = pgTable(
  "claim_lines",
  {
    id: id(),
    tenantId: tenantId(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id),
    lineNumber: integer("line_number").notNull(),
    procedureCode: text("procedure_code").notNull(),
    modifiers: text("modifiers")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    units: integer("units").notNull(),
    chargeCents: cents("charge_cents").notNull(),
  },
  (t) => [uniqueIndex("claim_lines_claim_line_key").on(t.claimId, t.lineNumber)],
);

// ---------------------------------------------------------------------------------------------
// Denials (REQUIREMENTS §8.3)
// ---------------------------------------------------------------------------------------------

export const groupCodeEnum = pgEnum("adjustment_group", ["CO", "PR", "OA", "PI"]);

export const denialCategoryEnum = pgEnum("denial_category", [
  "eligibility",
  "authorization",
  "coding",
  "medical_necessity",
  "timely_filing",
  "duplicate",
  "bundling",
  "coordination_of_benefits",
  "missing_information",
  "credentialing",
  "other",
]);

export const denialStatusEnum = pgEnum("denial_status", [
  "new",
  "in_review",
  "needs_records",
  "appeal_drafted",
  "appeal_submitted",
  "overturned",
  "upheld",
  "written_off",
  "closed",
]);

export const denials = pgTable(
  "denials",
  {
    id: id(),
    tenantId: tenantId(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id),
    claimLineId: uuid("claim_line_id").references(() => claimLines.id),
    groupCode: groupCodeEnum("group_code").notNull(),
    carc: text("carc").notNull(),
    rarcs: text("rarcs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    category: denialCategoryEnum("category").notNull(),
    deniedCents: cents("denied_cents").notNull(),
    /** Date on the remittance / denial notice. */
    noticeDate: date("notice_date", { mode: "string" }).notNull(),
    appealDeadline: date("appeal_deadline", { mode: "string" }),
    /** Rule ID from rules/ or "payer_contract"; explains where the deadline came from. */
    appealDeadlineBasis: text("appeal_deadline_basis"),
    status: denialStatusEnum("status").notNull().default("new"),
    assigneeId: uuid("assignee_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("denials_queue_deadline_idx").on(t.tenantId, t.status, t.appealDeadline),
    index("denials_queue_amount_idx").on(t.tenantId, t.status, t.deniedCents),
    index("denials_claim_idx").on(t.claimId),
  ],
);

export const denialNotes = pgTable(
  "denial_notes",
  {
    id: id(),
    tenantId: tenantId(),
    denialId: uuid("denial_id")
      .notNull()
      .references(() => denials.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("denial_notes_denial_idx").on(t.denialId, t.createdAt)],
);

// ---------------------------------------------------------------------------------------------
// Audit log (R-7.5.1): append-only, enforced by trigger and grants in drizzle/0002_security.sql
// ---------------------------------------------------------------------------------------------

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    reason: text("reason"),
    ipAddress: text("ip_address"),
    /** IDs and enum values only — never PHI. */
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_tenant_time_idx").on(t.tenantId, t.occurredAt),
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
  ],
);
