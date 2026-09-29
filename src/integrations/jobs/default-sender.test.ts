import { afterEach, describe, expect, it, vi } from "vitest";
import { netlifyWorkerUrl, NETLIFY_WORKER_PATH } from "@/platform/netlify/jobs";
import { scheduledSender, syncNowSender } from "./default-sender";

// Which way Sync now sends a job in an environment (ADR 0012): in the request when no secret is set (local
// development, tests), to the worker when one is, and refused when it is set but weak. Synthetic values only.

const secret = "synthetic".repeat(5);
const netlify = {
  NETLIFY: "true",
  DEPLOY_URL: "https://deploy-1--denialdesk.netlify.app",
  URL: "https://denialdesk.netlify.app",
};

afterEach(() => vi.restoreAllMocks());

describe("the worker URL on Netlify", () => {
  it("is this deploy's own URL (a preview talks to its own worker), not the site URL, and comes from the environment only", () => {
    expect(netlifyWorkerUrl(netlify)).toBe(`https://deploy-1--denialdesk.netlify.app${NETLIFY_WORKER_PATH}`);
    expect(netlifyWorkerUrl({ NETLIFY: "true", URL: "https://denialdesk.netlify.app/" })).toBe(
      `https://denialdesk.netlify.app${NETLIFY_WORKER_PATH}`,
    );
  });

  it("is none off Netlify, without a URL, or for an unacceptable one", () => {
    expect(netlifyWorkerUrl({ DEPLOY_URL: "https://x.netlify.app" })).toBeNull();
    expect(netlifyWorkerUrl({ NETLIFY: "true" })).toBeNull();
    expect(netlifyWorkerUrl({ NETLIFY: "true", DEPLOY_URL: "http://x.example.com" })).toBeNull();
  });

  it("INTEGRATION_JOB_URL overrides it (netlify dev), when acceptable", () => {
    expect(netlifyWorkerUrl({ INTEGRATION_JOB_URL: "http://localhost:8888/.netlify/functions/w" })).toBe(
      "http://localhost:8888/.netlify/functions/w",
    );
    expect(netlifyWorkerUrl({ ...netlify, INTEGRATION_JOB_URL: "http://example.com/w" })).toBeNull();
  });
});

describe("syncNowSender", () => {
  it("is none without a secret: Sync now runs in the request (local development, tests)", () => {
    expect(syncNowSender({})).toBeNull();
    expect(syncNowSender({ ...netlify })).toBeNull();
  });

  it("is none with a secret but no worker URL (a developer's machine)", () => {
    expect(syncNowSender({ INTEGRATION_JOB_SECRET: secret })).toBeNull();
  });

  it("is a sender with a secret and a worker URL", () => {
    expect(typeof syncNowSender({ ...netlify, INTEGRATION_JOB_SECRET: secret })).toBe("function");
  });

  it("with a secret that is too short is a sender that sends nothing: never quietly in the request", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const send = syncNowSender({ ...netlify, INTEGRATION_JOB_SECRET: "short" });
    expect(send).not.toBeNull();
    expect(await send!("3f2b8a7e-9c1d-4e5f-8a6b-7c8d9e0f1a2b")).toBe(false);
  });
});

describe("scheduledSender", () => {
  it("needs a worker URL", () => {
    expect(scheduledSender(Buffer.from(secret), {})).toBeNull();
    expect(typeof scheduledSender(Buffer.from(secret), netlify)).toBe("function");
  });
});
