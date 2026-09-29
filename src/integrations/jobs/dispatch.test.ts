import { describe, expect, it, vi } from "vitest";
import { httpJobSender, isAcceptableWorkerUrl } from "./dispatch";
import { JOB_SIGNATURE_HEADER, JOB_TIMESTAMP_HEADER, jobBodyFor, verifyJob } from "./signature";

// The sender side of a job (PI2b "Jobs", PI3): a signed POST of `{ runId }`. Synthetic values only.

const secret = Buffer.from("synthetic".repeat(5), "utf8");
const runId = "3f2b8a7e-9c1d-4e5f-8a6b-7c8d9e0f1a2b";
const url = "https://deploy-1--denialdesk.netlify.app/.netlify/functions/integration-sync-background";

describe("httpJobSender", () => {
  it("POSTs exactly `{ runId }` with headers the worker's verification accepts, and refuses to follow a redirect", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    const send = httpJobSender({ url, secret, fetch: fetchMock as unknown as typeof fetch });
    expect(await send(runId)).toBe(true);

    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(jobBodyFor(runId));
    expect(init.redirect).toBe("error");
    const headers = init.headers as Record<string, string>;
    expect(headers[JOB_TIMESTAMP_HEADER]).toMatch(/^\d+$/);
    expect(headers[JOB_SIGNATURE_HEADER]).toMatch(/^v1=[0-9a-f]{64}$/);
    const verified = verifyJob(secret, init.body as string, {
      get: (name) => headers[name.toLowerCase()] ?? null,
    });
    expect(verified).toEqual({ ok: true, runId });
  });

  it("says false for a refusal, a server error, and a network failure, logging codes and the run ID only", async () => {
    const lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      for (const fetchMock of [
        vi.fn(async () => new Response(null, { status: 401 })),
        vi.fn(async () => new Response(null, { status: 500 })),
        vi.fn(async () => {
          throw new TypeError(`fetch failed for ${url}`);
        }),
      ]) {
        expect(await httpJobSender({ url, secret, fetch: fetchMock as unknown as typeof fetch })(runId)).toBe(
          false,
        );
      }
    } finally {
      stderr.mockRestore();
    }
    const output = lines.join("");
    expect(output).toContain("http_401");
    expect(output).toContain("http_500");
    expect(output).toContain('"status":"network"');
    expect(output).toContain(runId);
    expect(output).not.toContain("netlify.app");
  });

  it("only accepts an https worker URL (plain http only for this machine), with no credentials or query", () => {
    expect(isAcceptableWorkerUrl(url)).toBe(true);
    expect(isAcceptableWorkerUrl("http://localhost:8888/.netlify/functions/x")).toBe(true);
    expect(isAcceptableWorkerUrl("http://127.0.0.1:8888/x")).toBe(true);
    for (const bad of [
      "http://example.com/x",
      "ftp://example.com/x",
      "https://user:pass@example.com/x",
      "https://example.com/x?a=1",
      "https://example.com/x#f",
      "not a url",
      "",
    ]) {
      expect(isAcceptableWorkerUrl(bad), bad).toBe(false);
    }
    expect(() => httpJobSender({ url: "http://example.com/x", secret })).toThrow();
  });
});
