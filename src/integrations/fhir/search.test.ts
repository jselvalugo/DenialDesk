import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signerForPrivateKey } from "@/lib/crypto/jwt-sign";
import {
  FAKE_TOKEN_ENDPOINT,
  FakeFhirTransport,
  jsonResponse,
  statusOnly,
} from "../../../test/support/fake-fhir-transport";
import { AccessToken } from "./auth";
import { FhirConnectError } from "./outcomes";
import { TransportError } from "./errors";
import { RunBudget } from "./limits";
import {
  backoffDelayMs,
  BASE_BACKOFF_MS,
  createTokenSource,
  FhirClient,
  MAX_COVERAGE_PAGES_PER_CHUNK,
  isSyncFailure,
  PatientSearch,
  RETRY_AFTER_CAP_SECONDS,
  SyncFailure,
  type RetryPolicy,
  type TokenSource,
} from "./search";
import type { Transport, TransportRequestInit, TransportResponse } from "./transport";

// docs/specs/patient-integrations.md PI2b "Search", "Retries", and the run-level limits (M1): paging
// with a same-origin `next`, the paging-loop guard, the run budget, the 1,000-entry Bundle cap, retries
// with backoff and `Retry-After`, one re-authentication on a 401. Everything here is synthetic.

const BASE = "https://ehr.example.test/r4";

function bundle(overrides: Record<string, unknown> = {}, entries: unknown[] = []) {
  return {
    resourceType: "Bundle",
    type: "searchset",
    entry: entries.map((resource) => ({ resource })),
    ...overrides,
  };
}
/** A Coverage for `patient`, as a search returns it. */
const cov = (id: string, patient: string) => ({
  resourceType: "Coverage",
  id,
  beneficiary: { reference: `Patient/${patient}` },
});
const ok = (body: unknown): TransportResponse => ({
  status: 200,
  contentType: "application/fhir+json",
  body: JSON.stringify(body),
});
const status = (code: number, retryAfterSeconds?: number): TransportResponse => ({
  status: code,
  contentType: "text/html",
  body: "",
  ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
});

/** Answers each request from a script (a function or a queue); records what was asked. */
class Scripted implements Transport {
  readonly requests: TransportRequestInit[] = [];
  constructor(
    private readonly answer: (init: TransportRequestInit, n: number) => TransportResponse | Error,
  ) {}
  async request(init: TransportRequestInit): Promise<TransportResponse> {
    this.requests.push(init);
    const result = this.answer(init, this.requests.length);
    if (result instanceof Error) throw result;
    return result;
  }
}
const queue = (...answers: (TransportResponse | Error)[]) =>
  new Scripted((_init, n) => answers[Math.min(n - 1, answers.length - 1)]!);

function tokens() {
  const state = { issued: [] as string[], invalidations: 0 };
  const source: TokenSource = {
    invalidate: () => {
      state.invalidations += 1;
    },
    get: async () => {
      const value = `token-${state.issued.length + 1}`;
      state.issued.push(value);
      return new AccessToken(value);
    },
  };
  return { state, source };
}

function client(
  transport: Transport,
  options: { budget?: RunBudget; retries?: number; source?: TokenSource } = {},
) {
  const sleeps: number[] = [];
  const policy: RetryPolicy = {
    retries: options.retries ?? 3,
    baseDelayMs: BASE_BACKOFF_MS,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
  const source = options.source ?? tokens().source;
  return {
    sleeps,
    source,
    client: new FhirClient({
      transport,
      base: new URL(BASE),
      tokens: source,
      budget: options.budget ?? new RunBudget(),
      policy,
    }),
  };
}
const first = (path = "Patient") => ({ method: "GET" as const, url: new URL(`${BASE}/${path}?_count=100`) });

async function failureOf(promise: Promise<unknown>): Promise<SyncFailure> {
  try {
    await promise;
  } catch (error) {
    if (isSyncFailure(error)) return error;
    throw error;
  }
  throw new Error("expected a SyncFailure");
}

describe("FhirClient — requests", () => {
  it("sends the bearer token in the Authorization header only, asks for FHIR JSON, and returns the Bundle", async () => {
    const transport = queue(ok(bundle({}, [{ resourceType: "Patient", id: "p1" }])));
    const { client: c } = client(transport);
    const result = await c.bundle(first());
    expect("bundle" in result && result.bundle.entry).toHaveLength(1);
    const [request] = transport.requests;
    expect(request!.headers).toEqual({ authorization: "Bearer token-1" });
    expect(request!.accept).toEqual(["application/fhir+json"]);
    expect(request!.url.href).not.toContain("token-1");
  });

  it("an unparsable or non-Bundle answer is bad_response", async () => {
    expect((await failureOf(client(queue(ok("not json"))).client.bundle(first()))).code).toBe("bad_response");
    expect(
      (await failureOf(client(queue(ok({ resourceType: "Patient" }))).client.bundle(first()))).code,
    ).toBe("bad_response");
    const raw: TransportResponse = { status: 200, contentType: "application/fhir+json", body: "{" };
    expect((await failureOf(client(queue(raw)).client.bundle(first()))).code).toBe("bad_response");
  });

  it("refuses a Bundle over the entry cap as too_large (MAX_BUNDLE_ENTRIES)", async () => {
    const entries = Array.from({ length: 1001 }, (_, i) => ({ resourceType: "Patient", id: `p${i}` }));
    await expect(client(queue(ok(bundle({}, entries)))).client.bundle(first())).rejects.toMatchObject({
      code: "too_large",
    });
    const exactly = Array.from({ length: 1000 }, (_, i) => ({ resourceType: "Patient", id: `p${i}` }));
    await expect(client(queue(ok(bundle({}, exactly)))).client.bundle(first())).resolves.toHaveProperty(
      "bundle",
    );
  });
});

describe("FhirClient — retries and backoff", () => {
  it("retries a 5xx up to three times with exponential backoff, then succeeds", async () => {
    const transport = queue(status(503), status(500), status(502), ok(bundle()));
    const { client: c, sleeps } = client(transport);
    await expect(c.bundle(first())).resolves.toHaveProperty("bundle");
    expect(transport.requests).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("fails after the third retry with the last status, `unreachable`, and no body", async () => {
    const transport = queue(status(500));
    const { client: c, sleeps } = client(transport);
    const failure = await failureOf(c.bundle(first()));
    expect(failure).toMatchObject({ code: "unreachable" });
    expect(failure.httpStatus).toBe(500);
    expect(failure.connectionError).toBe(false);
    expect(transport.requests).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("honors Retry-After, capped at 60 seconds", async () => {
    const short = client(queue(status(429, 5), ok(bundle())));
    await short.client.bundle(first());
    expect(short.sleeps).toEqual([5000]);
    const long = client(queue(status(429, 3600), ok(bundle())));
    await long.client.bundle(first());
    expect(long.sleeps).toEqual([RETRY_AFTER_CAP_SECONDS * 1000]);
    expect(RETRY_AFTER_CAP_SECONDS).toBe(60);
  });

  it("retries 408, 425 and 429 too", async () => {
    for (const code of [408, 425, 429]) {
      const transport = queue(status(code), ok(bundle()));
      await client(transport).client.bundle(first());
      expect(transport.requests).toHaveLength(2);
    }
  });

  it("retries a timeout or an unreachable server, but never an address, TLS or redirect refusal", async () => {
    for (const code of ["timeout", "unreachable"] as const) {
      const transport = queue(new TransportError(code), ok(bundle()));
      await client(transport).client.bundle(first());
      expect(transport.requests).toHaveLength(2);
    }
    for (const code of [
      "address_refused",
      "tls_failed",
      "redirect_refused",
      "content_type_refused",
      "too_large",
    ] as const) {
      const transport = queue(new TransportError(code), ok(bundle()));
      await expect(client(transport).client.bundle(first())).rejects.toMatchObject({ code });
      expect(transport.requests).toHaveLength(1);
    }
  });

  it("does not retry another 4xx: bad_response with the status", async () => {
    const transport = queue(status(404), ok(bundle()));
    const failure = await failureOf(client(transport).client.bundle(first()));
    expect(failure).toMatchObject({ code: "bad_response" });
    expect(failure.httpStatus).toBe(404);
    expect(transport.requests).toHaveLength(1);
  });

  it("backoff doubles from one second and stops at thirty", () => {
    const policy = { baseDelayMs: 1000 };
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => backoffDelayMs(n, policy))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });
});

describe("FhirClient — authorization failures", () => {
  it("one 401 drops the token and tries once more with a new one", async () => {
    const { state, source } = tokens();
    const transport = queue(status(401), ok(bundle()));
    const { client: c, sleeps } = client(transport, { source });
    await expect(c.bundle(first())).resolves.toHaveProperty("bundle");
    expect(state.invalidations).toBe(1);
    expect(transport.requests.map((r) => r.headers?.authorization)).toEqual([
      "Bearer token-1",
      "Bearer token-2",
    ]);
    expect(sleeps).toEqual([]);
  });

  it("a second 401 is auth_refused and puts the connection in error", async () => {
    const failure = await failureOf(client(queue(status(401))).client.bundle(first()));
    expect(failure).toMatchObject({ code: "auth_refused" });
    expect(failure.connectionError).toBe(true);
    expect(failure.httpStatus).toBe(401);
  });

  it("a 403 is auth_refused at once, with no retry", async () => {
    const transport = queue(status(403), ok(bundle()));
    const failure = await failureOf(client(transport).client.bundle(first()));
    expect(failure).toMatchObject({ code: "auth_refused" });
    expect(failure.connectionError).toBe(true);
    expect(transport.requests).toHaveLength(1);
  });
});

describe("FhirClient — the run budget", () => {
  it("counts every request, retries included, and refuses to start one past the cap", async () => {
    const budget = new RunBudget({ wallClockMs: 60_000, maxRequests: 2, maxBytes: 1_000_000 });
    const transport = queue(ok(bundle()));
    const { client: c } = client(transport, { budget });
    await c.bundle(first());
    await c.bundle(first());
    await expect(c.bundle(first())).rejects.toMatchObject({ code: "too_large" });
    expect(transport.requests).toHaveLength(2);
  });

  it("stops at the wall-clock budget as `timeout`", async () => {
    let now = 0;
    const budget = new RunBudget({ wallClockMs: 1000, maxRequests: 100, maxBytes: 1_000_000 }, () => now);
    const { client: c } = client(queue(ok(bundle())), { budget });
    await c.bundle(first());
    now = 1001;
    await expect(c.bundle(first())).rejects.toMatchObject({ code: "timeout" });
  });

  it("stops at the byte budget", async () => {
    const budget = new RunBudget({ wallClockMs: 60_000, maxRequests: 100, maxBytes: 10 });
    const { client: c } = client(queue(ok(bundle())), { budget });
    await c.bundle(first());
    await expect(c.bundle(first())).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("FhirClient.pages", () => {
  const page = (next?: string) =>
    ok(
      bundle({
        link: next ? [{ relation: "next", url: next }] : [{ relation: "self", url: `${BASE}/Patient` }],
      }),
    );

  async function drain(c: FhirClient) {
    const seen: number[] = [];
    for await (const b of c.pages(first())) seen.push(b.entry?.length ?? 0);
    return seen;
  }

  it("follows same-origin next links until there is none", async () => {
    const transport = queue(page(`${BASE}/Patient?_offset=100`), page(`${BASE}/Patient?_offset=200`), page());
    expect(await drain(client(transport).client)).toEqual([0, 0, 0]);
    expect(transport.requests.map((r) => r.url.searchParams.get("_offset"))).toEqual([null, "100", "200"]);
  });

  it("resolves a relative next against the current URL", async () => {
    const transport = queue(page("Patient?_offset=100"), page());
    await drain(client(transport).client);
    expect(transport.requests[1]!.url.href).toBe(`${BASE}/Patient?_offset=100`);
  });

  it("refuses a next link on another origin, without requesting it", async () => {
    const transport = queue(page("https://evil.example.test/r4/Patient?_offset=100"));
    await expect(drain(client(transport).client)).rejects.toMatchObject({ code: "address_refused" });
    expect(transport.requests).toHaveLength(1);
  });

  it("refuses a next link on another scheme or port", async () => {
    await expect(
      drain(client(queue(page("http://ehr.example.test/r4/Patient"))).client),
    ).rejects.toMatchObject({
      code: "address_refused",
    });
    await expect(
      drain(client(queue(page("https://ehr.example.test:8443/r4/Patient"))).client),
    ).rejects.toMatchObject({
      code: "address_refused",
    });
  });

  it("stops a repeated next URL as paging_loop, and one that points back at the first page", async () => {
    const same = `${BASE}/Patient?_offset=100`;
    await expect(drain(client(queue(page(same))).client)).rejects.toMatchObject({ code: "paging_loop" });
    const back = queue(page(first().url.href));
    await expect(drain(client(back).client)).rejects.toMatchObject({ code: "paging_loop" });
  });

  it("an unusable next link is bad_response", async () => {
    await expect(drain(client(queue(page("http://[bad"))).client)).rejects.toMatchObject({
      code: "bad_response",
    });
  });
});

describe("PatientSearch", () => {
  const p = (transport: Transport) => {
    const made = client(transport);
    return { ...made, search: new PatientSearch(made.client, BASE) };
  };

  it("builds Patient?_lastUpdated=ge<watermark>&_count=100, and no _lastUpdated on the initial load", () => {
    const { search } = p(queue(ok(bundle())));
    expect(
      search.patientUrl(new Date("2026-09-28T10:00:00.000Z"), 100).searchParams.get("_lastUpdated"),
    ).toBe("ge2026-09-28T10:00:00.000Z");
    const initial = search.patientUrl(null, 100);
    expect(initial.searchParams.has("_lastUpdated")).toBe(false);
    expect(initial.searchParams.get("_count")).toBe("100");
    expect(initial.pathname).toBe("/r4/Patient");
  });

  it("searches Coverage by POST _search, keeping FHIR ids out of the URL", async () => {
    const transport = queue(ok(bundle({}, [cov("c1", "pat-a")])));
    const { search } = p(transport);
    const found = await search.coverageFor(["pat-a", "pat-b"]);
    expect(found).toEqual([cov("c1", "pat-a")]);
    const [request] = transport.requests;
    expect(request!.method).toBe("POST");
    expect(request!.url.href).toBe(`${BASE}/Coverage/_search`);
    expect(request!.contentType).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(request!.body).get("patient")).toBe("pat-a,pat-b");
    expect(request!.url.href).not.toContain("pat-a");
  });

  it("chunks the POST at 50 ids", async () => {
    const transport = queue(ok(bundle()));
    const { search } = p(transport);
    await search.coverageFor(Array.from({ length: 120 }, (_, i) => `pat-${i}`));
    expect(transport.requests).toHaveLength(3);
    expect(
      transport.requests.map((r) => new URLSearchParams(r.body).get("patient")!.split(",").length),
    ).toEqual([50, 50, 20]);
  });

  it("falls back to GET (shorter chunks) for a server that doesn't support POST search, and remembers it", async () => {
    const transport = new Scripted((init) =>
      init.method === "POST"
        ? status(405)
        : ok(bundle({}, [cov("c", new URL(init.url).searchParams.get("patient")!.split(",")[0]!)])),
    );
    const { search } = p(transport);
    const found = await search.coverageFor(Array.from({ length: 25 }, (_, i) => `pat-${i}`));
    expect(found).toHaveLength(2);
    const gets = transport.requests.filter((r) => r.method === "GET");
    expect(gets).toHaveLength(2);
    expect(gets.map((r) => r.url.searchParams.get("patient")!.split(",").length)).toEqual([20, 5]);
    // The next call goes straight to GET: one POST in all.
    await search.coverageFor(["pat-x"]);
    expect(transport.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("follows a Coverage result's next link, refusing a cross-origin one", async () => {
    const transport = queue(
      ok(
        bundle({ link: [{ relation: "next", url: `${BASE}/Coverage?patient=pat-a&_offset=100` }] }, [
          cov("c1", "pat-a"),
        ]),
      ),
      ok(bundle({}, [cov("c2", "pat-a")])),
    );
    const { search } = p(transport);
    expect(await search.coverageFor(["pat-a"])).toHaveLength(2);
    expect(transport.requests.map((r) => r.method)).toEqual(["POST", "GET"]);

    const evil = queue(
      ok(bundle({ link: [{ relation: "next", url: "https://evil.example.test/Coverage" }] })),
    );
    await expect(p(evil).search.coverageFor(["pat-a"])).rejects.toMatchObject({ code: "address_refused" });
  });

  it("skips OperationOutcome entries in a Coverage search rather than treating them as coverage", async () => {
    const transport = queue(
      ok({
        resourceType: "Bundle",
        entry: [
          { resource: { resourceType: "OperationOutcome" }, search: { mode: "outcome" } },
          { resource: cov("c1", "pat-a"), search: { mode: "match" } },
        ],
      }),
    );
    expect(await p(transport).search.coverageFor(["pat-a"])).toEqual([cov("c1", "pat-a")]);
  });

  it("drops Coverage whose beneficiary isn't one of the patients asked for in that chunk", async () => {
    const transport = queue(
      ok(
        bundle({}, [
          cov("mine", "pat-a"),
          cov("stranger", "pat-z"),
          { resourceType: "Coverage", id: "no-beneficiary" },
          { resourceType: "Coverage", id: "org", beneficiary: { reference: "Organization/pat-a" } },
          { resourceType: "Patient", id: "pat-a" },
          "junk",
        ]),
      ),
    );
    expect(await p(transport).search.coverageFor(["pat-a", "pat-b"])).toEqual([cov("mine", "pat-a")]);
  });

  it("stops a chunk that keeps returning pages: at most 20, then too_large", async () => {
    let n = 0;
    const endless = new Scripted(() =>
      ok(bundle({ link: [{ relation: "next", url: `${BASE}/Coverage?page=${++n}` }] }, [cov("c", "pat-a")])),
    );
    await expect(p(endless).search.coverageFor(["pat-a"])).rejects.toMatchObject({ code: "too_large" });
    expect(endless.requests).toHaveLength(MAX_COVERAGE_PAGES_PER_CHUNK);

    // The same by GET (a server without POST search).
    let m = 0;
    const getOnly = new Scripted((init) =>
      init.method === "POST"
        ? status(405)
        : ok(
            bundle({ link: [{ relation: "next", url: `${BASE}/Coverage?page=${++m}` }] }, [
              cov("c", "pat-a"),
            ]),
          ),
    );
    await expect(p(getOnly).search.coverageFor(["pat-a"])).rejects.toMatchObject({ code: "too_large" });
    expect(getOnly.requests.filter((r) => r.method === "GET")).toHaveLength(MAX_COVERAGE_PAGES_PER_CHUNK);
  });

  it("19 pages is fine", async () => {
    let n = 0;
    const nearly = new Scripted(() =>
      ok(
        bundle(n++ < 18 ? { link: [{ relation: "next", url: `${BASE}/Coverage?page=${n}` }] } : {}, [
          cov("c", "pat-a"),
        ]),
      ),
    );
    expect(await p(nearly).search.coverageFor(["pat-a"])).toHaveLength(19);
  });
});

describe("createTokenSource", () => {
  const signer = signerForPrivateKey(
    generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey,
    "kid-1",
  );
  const discovery = {
    tokenEndpointAdvertised: FAKE_TOKEN_ENDPOINT,
    scopes: "system/Patient.rs system/Coverage.rs",
  };
  const build = (transport: Transport) => {
    const sleeps: number[] = [];
    const source = createTokenSource({
      transport,
      connectionId: "3f0a5a5e-6f43-4d62-8f0a-000000000001",
      clientId: "client-synthetic-1",
      signer,
      discovery,
      policy: { retries: 3, baseDelayMs: 1000, sleep: async (ms) => void sleeps.push(ms) },
    });
    return { source, sleeps };
  };
  const tokenResponse = (scope = discovery.scopes) =>
    jsonResponse({ access_token: "SYN-TOKEN-1", token_type: "bearer", expires_in: 300, scope });

  it("asks once and caches the token, and asks again after a 401 invalidated it", async () => {
    const transport = new FakeFhirTransport({ [`POST ${FAKE_TOKEN_ENDPOINT}`]: tokenResponse() });
    const { source } = build(transport);
    expect((await source.get()).reveal()).toBe("SYN-TOKEN-1");
    await source.get();
    expect(transport.requests).toHaveLength(1);
    source.invalidate();
    await source.get();
    expect(transport.requests).toHaveLength(2);
  });

  it("retries a transient failure of the token endpoint, with backoff", async () => {
    let calls = 0;
    const transport = new FakeFhirTransport({
      [`POST ${FAKE_TOKEN_ENDPOINT}`]: () => (++calls < 3 ? statusOnly(503) : tokenResponse()),
    });
    const { source, sleeps } = build(transport);
    await source.get();
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("does not retry a refusal: wrong credentials are not a network problem", async () => {
    const transport = new FakeFhirTransport({ [`POST ${FAKE_TOKEN_ENDPOINT}`]: statusOnly(401) });
    const { source, sleeps } = build(transport);
    await expect(source.get()).rejects.toMatchObject({ outcome: "auth_refused" });
    await expect(source.get()).rejects.toBeInstanceOf(FhirConnectError);
    expect(sleeps).toEqual([]);
  });

  it("gives up after three retries", async () => {
    const transport = new FakeFhirTransport({ [`POST ${FAKE_TOKEN_ENDPOINT}`]: statusOnly(500) });
    const { source, sleeps } = build(transport);
    await expect(source.get()).rejects.toMatchObject({ outcome: "unreachable" });
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("honors Retry-After on a throttled token endpoint, capped at 60 seconds (PR #98 review)", async () => {
    const answers = [
      { ...statusOnly(429), retryAfterSeconds: 7 },
      { ...statusOnly(429), retryAfterSeconds: 3600 },
    ];
    let calls = 0;
    const transport = new FakeFhirTransport({
      [`POST ${FAKE_TOKEN_ENDPOINT}`]: () => answers[calls++] ?? tokenResponse(),
    });
    const { source, sleeps } = build(transport);
    await source.get();
    expect(sleeps).toEqual([7000, 60_000]);
  });

  it("carries the HTTP status of a refused or failed token request, and no body", async () => {
    const refused = build(new FakeFhirTransport({ [`POST ${FAKE_TOKEN_ENDPOINT}`]: statusOnly(403) }));
    await expect(refused.source.get()).rejects.toMatchObject({
      outcome: "auth_refused",
      response: { httpStatus: 403 },
    });
    const down = build(new FakeFhirTransport({ [`POST ${FAKE_TOKEN_ENDPOINT}`]: statusOnly(503) }));
    await expect(down.source.get()).rejects.toMatchObject({
      outcome: "unreachable",
      response: { httpStatus: 503 },
    });
  });
});
