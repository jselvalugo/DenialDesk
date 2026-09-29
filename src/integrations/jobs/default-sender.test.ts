import { afterEach, describe, expect, it, vi } from "vitest";
import { netlifyWorkerUrl, NETLIFY_WORKER_PATH } from "@/platform/netlify/jobs";
import { jobsConfigProblem, logJobsConfigAtBoot, scheduledSender, syncNowJobs } from "./default-sender";

// Which way Sync now sends a job in an environment (ADR 0012): in the request when jobs aren't set up and only
// synthetic data is allowed (local development, tests), to the worker when they are, and refused when the secret
// is set but weak or, where real data is allowed, when anything is missing. Synthetic values only.

const secret = "synthetic".repeat(5);
const netlify = {
  NETLIFY: "true",
  DEPLOY_URL: "https://deploy-1--denialdesk.netlify.app",
  URL: "https://denialdesk.netlify.app",
};
const synthetic = () => true;
const realDataAllowed = () => false;

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

describe("jobsConfigProblem", () => {
  it("names what is wrong, never a value", () => {
    expect(jobsConfigProblem({})).toBe("missing_secret");
    expect(jobsConfigProblem({ INTEGRATION_JOB_SECRET: "short" })).toBe("weak_secret");
    expect(jobsConfigProblem({ INTEGRATION_JOB_SECRET: secret })).toBe("no_worker_url");
    expect(jobsConfigProblem({ ...netlify, INTEGRATION_JOB_SECRET: secret })).toBeNull();
  });
});

describe("syncNowJobs where only synthetic data is allowed (tests, local development, pre-production)", () => {
  it("runs in the request (undefined) without a secret, or with a secret but no worker URL", () => {
    expect(syncNowJobs({}, synthetic)).toBeUndefined();
    expect(syncNowJobs({ ...netlify }, synthetic)).toBeUndefined();
    expect(syncNowJobs({ INTEGRATION_JOB_SECRET: secret }, synthetic)).toBeUndefined();
  });

  it("sends a job when the secret and a worker URL are set", () => {
    expect(syncNowJobs({ ...netlify, INTEGRATION_JOB_SECRET: secret }, synthetic)).toMatchObject({
      kind: "send",
    });
  });

  it("refuses, never quietly running in the request, when the secret is set but too short", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(syncNowJobs({ ...netlify, INTEGRATION_JOB_SECRET: "short" }, synthetic)).toEqual({
      kind: "refused",
    });
  });
});

describe("syncNowJobs where real data is allowed (security review L4)", () => {
  it("refuses instead of running in the request whenever jobs are not fully configured", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(syncNowJobs({}, realDataAllowed)).toEqual({ kind: "refused" });
    expect(syncNowJobs({ INTEGRATION_JOB_SECRET: secret }, realDataAllowed)).toEqual({ kind: "refused" });
    expect(syncNowJobs({ ...netlify, INTEGRATION_JOB_SECRET: "short" }, realDataAllowed)).toEqual({
      kind: "refused",
    });
  });

  it("sends a job when fully configured", () => {
    expect(syncNowJobs({ ...netlify, INTEGRATION_JOB_SECRET: secret }, realDataAllowed)).toMatchObject({
      kind: "send",
    });
  });
});

describe("logJobsConfigAtBoot", () => {
  function lines() {
    const out: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
    return out;
  }

  it("logs a code once where real data is allowed and jobs are not configured, and for a weak secret anywhere", () => {
    const out = lines();
    logJobsConfigAtBoot({}, realDataAllowed);
    logJobsConfigAtBoot({ INTEGRATION_JOB_SECRET: "short" }, synthetic);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('"event":"integrations.jobs_not_configured"');
    expect(out[0]).toContain('"status":"missing_secret"');
    expect(out[1]).toContain('"status":"weak_secret"');
    expect(out.join("")).not.toContain("short");
  });

  it("is quiet for a synthetic-only environment that simply isn't set up, and for a complete setup", () => {
    const out = lines();
    logJobsConfigAtBoot({}, synthetic);
    logJobsConfigAtBoot({ ...netlify, INTEGRATION_JOB_SECRET: secret }, realDataAllowed);
    expect(out).toEqual([]);
  });
});

describe("scheduledSender", () => {
  it("needs a worker URL", () => {
    expect(scheduledSender(Buffer.from(secret), {})).toBeNull();
    expect(typeof scheduledSender(Buffer.from(secret), netlify)).toBe("function");
  });
});
