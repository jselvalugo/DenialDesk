import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  JOB_SIGNATURE_HEADER,
  JOB_TIMESTAMP_HEADER,
  JOB_WINDOW_SECONDS,
  jobBodyFor,
  jobSecret,
  JobSecretError,
  MAX_JOB_BODY_BYTES,
  signJob,
  verifyJob,
} from "./signature";

// docs/specs/patient-integrations.md PI2b "Jobs": payload `{ runId }` only, HMAC-SHA256 over body +
// timestamp, 5-minute window, compared in constant time; threat model S5. Synthetic values only.

const secret = Buffer.from("synthetic".repeat(5), "utf8");
const otherSecret = Buffer.from("another".repeat(7), "utf8");
const runId = "3f2b8a7e-9c1d-4e5f-8a6b-7c8d9e0f1a2b";
const now = new Date("2026-09-29T12:00:00Z");
const at = (secondsFromNow: number) => new Date(now.getTime() + secondsFromNow * 1000);
const headersOf = (record: Record<string, string>) => ({
  get: (name: string) => record[name.toLowerCase()] ?? null,
});

describe("signed jobs", () => {
  it("a job signed now verifies, and yields the run ID and nothing else", () => {
    const body = jobBodyFor(runId);
    expect(body).toBe(`{"runId":"${runId}"}`);
    expect(verifyJob(secret, body, headersOf(signJob(secret, body, now)), now)).toEqual({ ok: true, runId });
  });

  it("an unsigned call is refused, whichever header is missing", () => {
    const body = jobBodyFor(runId);
    const signed = signJob(secret, body, now);
    expect(verifyJob(secret, body, headersOf({}), now)).toEqual({ ok: false, refusal: "unsigned" });
    expect(
      verifyJob(secret, body, headersOf({ [JOB_TIMESTAMP_HEADER]: signed[JOB_TIMESTAMP_HEADER]! }), now),
    ).toEqual({ ok: false, refusal: "unsigned" });
    expect(
      verifyJob(secret, body, headersOf({ [JOB_SIGNATURE_HEADER]: signed[JOB_SIGNATURE_HEADER]! }), now),
    ).toEqual({ ok: false, refusal: "unsigned" });
  });

  it("the 5-minute window: the day before, of and after (299 s and 300 s pass, 301 s is stale), either direction", () => {
    const body = jobBodyFor(runId);
    const signedAt = signJob(secret, body, now);
    for (const [seconds, expected] of [
      [JOB_WINDOW_SECONDS - 1, true],
      [JOB_WINDOW_SECONDS, true],
      [JOB_WINDOW_SECONDS + 1, false],
    ] as const) {
      // The receiver's clock is ahead of the sender's (a delayed or replayed job)...
      expect(verifyJob(secret, body, headersOf(signedAt), at(seconds)).ok, `+${seconds}`).toBe(expected);
      // ...or behind it (a sender whose clock runs fast).
      expect(verifyJob(secret, body, headersOf(signedAt), at(-seconds)).ok, `-${seconds}`).toBe(expected);
    }
    expect(verifyJob(secret, body, headersOf(signedAt), at(JOB_WINDOW_SECONDS + 1))).toEqual({
      ok: false,
      refusal: "stale",
    });
  });

  it("a stale timestamp can't be renewed: the timestamp is inside the MAC", () => {
    const body = jobBodyFor(runId);
    const old = signJob(secret, body, at(-3600));
    const renewed = { ...old, [JOB_TIMESTAMP_HEADER]: String(Math.floor(now.getTime() / 1000)) };
    expect(verifyJob(secret, body, headersOf(renewed), now)).toEqual({ ok: false, refusal: "bad_signature" });
  });

  it("a wrong secret, a flipped signature, a changed body and a malformed header are all refused", () => {
    const body = jobBodyFor(runId);
    const signed = signJob(secret, body, now);
    const signature = signed[JOB_SIGNATURE_HEADER]!;
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    const cases: [string, string, Record<string, string>][] = [
      ["wrong secret", body, signJob(otherSecret, body, now)],
      ["flipped signature", body, { ...signed, [JOB_SIGNATURE_HEADER]: flipped }],
      ["another run ID (forged body)", jobBodyFor("00000000-0000-4000-8000-000000000001"), signed],
      ["an extra field on the signed body", `{"runId":"${runId}","x":1}`, signed],
      ["no version prefix", body, { ...signed, [JOB_SIGNATURE_HEADER]: signature.slice(3) }],
      ["short signature", body, { ...signed, [JOB_SIGNATURE_HEADER]: "v1=abcd" }],
      ["upper-case signature", body, { ...signed, [JOB_SIGNATURE_HEADER]: signature.toUpperCase() }],
    ];
    for (const [label, sentBody, headers] of cases) {
      const result = verifyJob(secret, sentBody, headersOf(headers), now);
      expect(result.ok, label).toBe(false);
      expect(result, label).toMatchObject({ refusal: "bad_signature" });
    }
    expect(verifyJob(secret, body, headersOf({ ...signed, [JOB_TIMESTAMP_HEADER]: "12abc" }), now)).toEqual({
      ok: false,
      refusal: "bad_timestamp",
    });
  });

  it("the payload is `{ runId }` and nothing else, checked only after the signature: even a correctly signed extra field, a non-UUID or non-JSON body is refused", () => {
    for (const body of [
      `{"runId":"${runId}","tenantId":"00000000-0000-4000-8000-000000000002"}`,
      `{"runId":"not-a-uuid"}`,
      `{"run":"${runId}"}`,
      `["${runId}"]`,
      `not json`,
      ``,
    ]) {
      expect(verifyJob(secret, body, headersOf(signJob(secret, body, now)), now), body).toEqual({
        ok: false,
        refusal: "bad_payload",
      });
    }
  });

  it("a body over the cap is refused before anything is computed", () => {
    const body = `{"runId":"${runId}","pad":"${"x".repeat(MAX_JOB_BODY_BYTES)}"}`;
    expect(verifyJob(secret, body, headersOf(signJob(secret, body, now)), now)).toEqual({
      ok: false,
      refusal: "too_large",
    });
  });

  it("compares the MAC with timingSafeEqual, never with a string comparison", () => {
    const source = readFileSync(new URL("./signature.ts", import.meta.url), "utf8");
    expect(source).toContain("timingSafeEqual(given, expected)");
    expect(source).not.toMatch(/signature\s*[!=]==\s*expected/);
  });
});

describe("INTEGRATION_JOB_SECRET", () => {
  it("is refused when missing, empty, or shorter than 32 bytes, and never echoed", () => {
    expect(() => jobSecret({})).toThrow(JobSecretError);
    expect(() => jobSecret({ INTEGRATION_JOB_SECRET: "" })).toThrow(JobSecretError);
    const short = "s".repeat(31);
    let thrown: unknown;
    try {
      jobSecret({ INTEGRATION_JOB_SECRET: short });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(JobSecretError);
    expect((thrown as JobSecretError).code).toBe("weak_secret");
    expect((thrown as Error).message).not.toContain(short);
  });

  it("accepts exactly 32 bytes, counting bytes and not characters", () => {
    expect(jobSecret({ INTEGRATION_JOB_SECRET: "k".repeat(32) })).toHaveLength(32);
    // 16 two-byte characters are 32 bytes; 15 are 30 bytes.
    expect(jobSecret({ INTEGRATION_JOB_SECRET: "é".repeat(16) })).toHaveLength(32);
    expect(() => jobSecret({ INTEGRATION_JOB_SECRET: "é".repeat(15) })).toThrow(JobSecretError);
  });
});
