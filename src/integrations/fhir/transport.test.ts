import * as crypto from "node:crypto";
import * as https from "node:https";
import type { RequestListener } from "node:http";
import * as net from "node:net";
import tls from "node:tls";
import * as zlib from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTestServer, testCert, type TestServer } from "../../../test/support/https-fixture";
import { TransportError } from "./errors";
import {
  assertTlsVerificationEnabled,
  collapseTransportError,
  DEFAULT_MAX_RESPONSE_BYTES,
  FHIR_JSON,
  HttpsTransport,
  TLS12_CIPHERS,
} from "./transport";

/** Allows the transport to reach our loopback test server; the guard refuses loopback by default. */
const ALLOW_LOOPBACK = (address: string) => address === "127.0.0.1" || address === "::1";

let server: TestServer | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  await server?.close();
  server = undefined;
});

/** A transport that trusts the fixture CA and may reach loopback. */
function loopbackTransport(extra: ConstructorParameters<typeof HttpsTransport>[0] = {}): HttpsTransport {
  return new HttpsTransport({ ca: testCert(), allowAddress: ALLOW_LOOPBACK, ...extra });
}

function fhirGet(transport: HttpsTransport, url: URL, headers?: Record<string, string>) {
  return transport.request({ url, method: "GET", accept: [FHIR_JSON], headers });
}

/** Simulates production: APP_ENV=production and none of the Netlify variables. */
function stubProduction(): void {
  vi.stubEnv("APP_ENV", "production");
  for (const name of ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID"]) vi.stubEnv(name, "");
}

describe("assertTlsVerificationEnabled", () => {
  it("passes when TLS verification is not disabled", () => {
    expect(() => assertTlsVerificationEnabled({ NODE_ENV: "test" })).not.toThrow();
    expect(() =>
      assertTlsVerificationEnabled({ NODE_ENV: "test", NODE_TLS_REJECT_UNAUTHORIZED: "1" }),
    ).not.toThrow();
  });
  it("throws when NODE_TLS_REJECT_UNAUTHORIZED=0", () => {
    expect(() =>
      assertTlsVerificationEnabled({ NODE_ENV: "test", NODE_TLS_REJECT_UNAUTHORIZED: "0" }),
    ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED/);
  });
  it("the HttpsTransport constructor calls the guard (fails at startup)", () => {
    const original = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      expect(() => new HttpsTransport()).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED/);
    } finally {
      if (original === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = original;
    }
  });
});

describe("HttpsTransport — test-only options are refused in production", () => {
  it.each([
    ["ca", { ca: "pem" }],
    ["allowAddress", { allowAddress: () => true }],
    ["totalTimeoutMs", { totalTimeoutMs: 10 }],
    ["maxResponseBytes", { maxResponseBytes: 10 }],
    ["resolve", { resolve: (() => undefined) as never }],
  ])("throws for %s when APP_ENV=production outside Netlify", (name, options) => {
    stubProduction();
    expect(() => new HttpsTransport(options)).toThrow(new RegExp(`"${name}" option is test-only`));
  });

  it("constructs with no options in production", () => {
    stubProduction();
    expect(() => new HttpsTransport()).not.toThrow();
  });

  it("allows the options in a test environment", () => {
    expect(() => loopbackTransport({ totalTimeoutMs: 10, maxResponseBytes: 10 })).not.toThrow();
  });
});

describe("HttpsTransport — address guard applied by default", () => {
  it("refuses a loopback hostname when no allow-hook is given (deny by default)", async () => {
    let hits = 0;
    server = await startTestServer((_req, res) => {
      hits++;
      res.writeHead(200, { "content-type": FHIR_JSON });
      res.end("{}");
    });
    const transport = new HttpsTransport({ ca: testCert() }); // CA injected, but no allowAddress
    await expect(fhirGet(transport, server.url)).rejects.toMatchObject({ code: "address_refused" });
    expect(hits).toBe(0);
  });

  // Node never calls `lookup` for an IP literal, so these exercise the explicit literal check. A live
  // server is listening on the port, so a missing check would produce HTTP 200 and a handler hit.
  it.each([
    ["127.0.0.1", (port: number) => `https://127.0.0.1:${port}/`],
    ["decimal 2130706433 (= 127.0.0.1)", (port: number) => `https://2130706433:${port}/`],
    ["hex 0x7f.1 (= 127.0.0.1)", (port: number) => `https://0x7f.1:${port}/`],
    ["169.254.169.254 (IMDS)", (port: number) => `https://169.254.169.254:${port}/`],
    ["168.63.129.16 (WireServer)", (port: number) => `https://168.63.129.16:${port}/`],
    ["[::1]", (port: number) => `https://[::1]:${port}/`],
    ["[::ffff:127.0.0.1]", (port: number) => `https://[::ffff:127.0.0.1]:${port}/`],
  ])("refuses the IP-literal host %s without the test hook", async (_label, build) => {
    let hits = 0;
    server = await startTestServer((_req, res) => {
      hits++;
      res.writeHead(200, { "content-type": FHIR_JSON });
      res.end("{}");
    });
    const transport = new HttpsTransport({ ca: testCert() });
    await expect(fhirGet(transport, new URL(build(server.port)))).rejects.toMatchObject({
      code: "address_refused",
    });
    expect(hits).toBe(0);
  });

  it("checks a normalized IP literal against the test hook too (0x7f.1 reaches loopback only when allowed)", async () => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON });
      res.end("{}");
    });
    const response = await fhirGet(loopbackTransport(), new URL(`https://0x7f.1:${server.port}/`));
    expect(response.status).toBe(200);
  });

  it("connects to an allowed IP literal and verifies the certificate's IP SAN", async () => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON });
      res.end("{}");
    });
    const response = await fhirGet(loopbackTransport(), server.ipUrl);
    expect(response.status).toBe(200);
  });

  it("refuses a URL that carries a username or password (never sent as Basic auth)", async () => {
    let hits = 0;
    server = await startTestServer((_req, res) => {
      hits++;
      res.writeHead(200, { "content-type": FHIR_JSON });
      res.end("{}");
    });
    for (const credentials of ["user:secret@", "user@", ":secret@"]) {
      const url = new URL(`https://${credentials}localhost:${server.port}/`);
      await expect(fhirGet(loopbackTransport(), url)).rejects.toBeInstanceOf(TransportError);
    }
    expect(hits).toBe(0);
  });
});

describe("HttpsTransport — request headers", () => {
  it.each(["Host", "content-length", "Transfer-Encoding", "CONNECTION"])(
    "refuses a caller-supplied %s header",
    async (name) => {
      let hits = 0;
      server = await startTestServer((_req, res) => {
        hits++;
        res.writeHead(200, { "content-type": FHIR_JSON });
        res.end("{}");
      });
      await expect(fhirGet(loopbackTransport(), server.url, { [name]: "x" })).rejects.toBeInstanceOf(
        TransportError,
      );
      expect(hits).toBe(0);
    },
  );

  it("sends other headers, with the real Host header", async () => {
    let seen: Record<string, string | string[] | undefined> = {};
    server = await startTestServer((req, res) => {
      seen = req.headers;
      res.writeHead(200, { "content-type": FHIR_JSON });
      res.end("{}");
    });
    await fhirGet(loopbackTransport(), server.url, { Authorization: "Bearer synthetic" });
    expect(seen.authorization).toBe("Bearer synthetic");
    expect(seen.host).toBe(`localhost:${server.port}`);
  });

  it("wraps a synchronous throw from https.request (invalid header value) in a TransportError", async () => {
    server = await startTestServer((_req, res) => res.end("{}"));
    const rejection = fhirGet(loopbackTransport(), server.url, { "x-test": "a\r\nb" });
    await expect(rejection).rejects.toBeInstanceOf(TransportError);
    await expect(rejection).rejects.toMatchObject({ code: "unreachable" });
  });
});

describe("HttpsTransport — happy path", () => {
  it("GETs a FHIR JSON response through the injectable CA and allow-hook", async () => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/fhir+json; charset=utf-8" });
      res.end(JSON.stringify({ resourceType: "Bundle" }));
    });
    const response = await fhirGet(loopbackTransport(), server.url);
    expect(response.status).toBe(200);
    expect(response.contentType).toBe(FHIR_JSON);
    expect(JSON.parse(response.body)).toEqual({ resourceType: "Bundle" });
  });

  it("POSTs a form-encoded body", async () => {
    let receivedBody = "";
    let receivedContentType = "";
    server = await startTestServer((req, res) => {
      receivedContentType = req.headers["content-type"] ?? "";
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "synthetic-token" }));
      });
    });
    const response = await loopbackTransport().request({
      url: server.url,
      method: "POST",
      body: "grant_type=client_credentials",
      contentType: "application/x-www-form-urlencoded",
      accept: ["application/json"],
    });
    expect(response.status).toBe(200);
    expect(receivedContentType).toBe("application/x-www-form-urlencoded");
    expect(receivedBody).toBe("grant_type=client_credentials");
  });

  it.each([
    ["gzip", (b: Buffer) => zlib.gzipSync(b)],
    ["deflate", (b: Buffer) => zlib.deflateSync(b)],
    ["br", (b: Buffer) => zlib.brotliCompressSync(b)],
  ])("decompresses a %s response", async (encoding, compress) => {
    const payload = JSON.stringify({ resourceType: "Bundle", entry: [] });
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON, "content-encoding": encoding });
      res.end(compress(Buffer.from(payload)));
    });
    const response = await fhirGet(loopbackTransport(), server.url);
    expect(response.body).toBe(payload);
  });

  it("accepts an explicit identity Content-Encoding", async () => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON, "content-encoding": "identity" });
      res.end("{}");
    });
    expect((await fhirGet(loopbackTransport(), server.url)).body).toBe("{}");
  });
});

describe("HttpsTransport — unsupported Content-Encoding", () => {
  it.each(["zstd", "compress", "gzip, br", "bogus"])("refuses Content-Encoding %s", async (encoding) => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON, "content-encoding": encoding });
      res.end("{}");
    });
    await expect(fhirGet(loopbackTransport(), server.url)).rejects.toMatchObject({
      code: "content_type_refused",
    });
  });
});

describe("HttpsTransport — redirect refused", () => {
  it("treats a 3xx response as an error rather than following it", async () => {
    let followed = false;
    server = await startTestServer((req, res) => {
      if (req.url === "/steal") followed = true;
      res.writeHead(302, { location: `https://localhost:${server?.port}/steal` });
      res.end();
    });
    await expect(fhirGet(loopbackTransport(), server.url)).rejects.toMatchObject({
      code: "redirect_refused",
    });
    expect(followed).toBe(false);
  });
});

describe("HttpsTransport — content type refused", () => {
  it("refuses a response whose Content-Type isn't in the accept list", async () => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>not FHIR</html>");
    });
    await expect(fhirGet(loopbackTransport(), server.url)).rejects.toMatchObject({
      code: "content_type_refused",
    });
  });

  it("accepts application/json when the caller lists it (token / smart-configuration)", async () => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const response = await loopbackTransport().request({
      url: server.url,
      method: "GET",
      accept: [FHIR_JSON, "application/json"],
    });
    expect(response.status).toBe(200);
  });

  it("refuses application/json when the caller lists only application/fhir+json", async () => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    await expect(fhirGet(loopbackTransport(), server.url)).rejects.toMatchObject({
      code: "content_type_refused",
    });
  });
});

describe("HttpsTransport — size limit", () => {
  it("aborts once an uncompressed response exceeds the cap", async () => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON });
      const chunk = Buffer.alloc(64 * 1024, "a");
      // Keep writing past the (small, test-configured) cap; the client should abort long before
      // this loop finishes rather than buffering it all.
      let i = 0;
      const interval = setInterval(() => {
        if (res.destroyed || i++ > 40) {
          clearInterval(interval);
          res.end();
          return;
        }
        res.write(chunk);
      }, 1);
      res.on("close", () => clearInterval(interval));
    });
    const transport = loopbackTransport({ maxResponseBytes: 128 * 1024 });
    await expect(fhirGet(transport, server.url)).rejects.toMatchObject({ code: "too_large" });
  });

  // A small compressed body that expands well past the cap: proves the DECOMPRESSED size is counted.
  it.each([
    ["gzip", (b: Buffer) => zlib.gzipSync(b)],
    ["deflate", (b: Buffer) => zlib.deflateSync(b)],
    ["br", (b: Buffer) => zlib.brotliCompressSync(b)],
  ])("aborts a %s body whose decompressed size exceeds the cap", async (encoding, compress) => {
    const cap = 64 * 1024;
    const compressed = compress(Buffer.alloc(4 * 1024 * 1024, "a"));
    expect(compressed.byteLength).toBeLessThan(cap); // under the cap on the wire, far over once inflated
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON, "content-encoding": encoding });
      res.end(compressed);
    });
    const transport = loopbackTransport({ maxResponseBytes: cap });
    await expect(fhirGet(transport, server.url)).rejects.toMatchObject({ code: "too_large" });
  });

  it("a compressed body that stays under the cap once decompressed is accepted", async () => {
    const compressed = zlib.gzipSync(Buffer.alloc(32 * 1024, "a"));
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON, "content-encoding": "gzip" });
      res.end(compressed);
    });
    const response = await fhirGet(loopbackTransport({ maxResponseBytes: 64 * 1024 }), server.url);
    expect(response.body).toHaveLength(32 * 1024);
  });

  it("DEFAULT_MAX_RESPONSE_BYTES matches the spec's 10 MB", () => {
    expect(DEFAULT_MAX_RESPONSE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("HttpsTransport — truncated and stalled responses", () => {
  const random = crypto.randomBytes(4096).toString("hex");
  const gz = zlib.gzipSync(Buffer.from(random));

  it("rejects quickly when a gzip response is cut off mid-stream (connection closed early)", async () => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON, "content-encoding": "gzip" });
      res.write(gz.subarray(0, Math.floor(gz.byteLength / 2)));
      setTimeout(() => res.destroy(), 20);
    });
    const started = Date.now();
    await expect(fhirGet(loopbackTransport(), server.url)).rejects.toBeInstanceOf(TransportError);
    // Well inside the 30 s default total timeout: the premature close itself rejects.
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 5_000);

  it("rejects when the server ends cleanly but the gzip stream is incomplete", async () => {
    const truncated = gz.subarray(0, Math.floor(gz.byteLength / 2));
    server = await startTestServer((_req, res) => {
      res.writeHead(200, {
        "content-type": FHIR_JSON,
        "content-encoding": "gzip",
        "content-length": String(truncated.byteLength),
      });
      res.end(truncated);
    });
    const started = Date.now();
    await expect(fhirGet(loopbackTransport(), server.url)).rejects.toBeInstanceOf(TransportError);
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 5_000);

  it("rejects when an uncompressed response is cut off mid-stream", async () => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON, "content-length": "100000" });
      res.write("{");
      setTimeout(() => res.destroy(), 20);
    });
    await expect(fhirGet(loopbackTransport(), server.url)).rejects.toBeInstanceOf(TransportError);
  }, 5_000);

  it.each([
    ["uncompressed", undefined],
    ["gzip", "gzip"],
  ])(
    "stops a slow %s trickle at the total timeout",
    async (_label, encoding) => {
      server = await startTestServer((_req, res) => {
        res.writeHead(200, {
          "content-type": FHIR_JSON,
          ...(encoding ? { "content-encoding": encoding } : {}),
        });
        // One byte every 10 ms, never finishing: an idle timeout would reset on every byte.
        const body = encoding ? gz : Buffer.from(random);
        let i = 0;
        const interval = setInterval(() => {
          if (res.destroyed || i >= body.byteLength) {
            clearInterval(interval);
            return;
          }
          res.write(body.subarray(i, i + 1));
          i++;
        }, 10);
        res.on("close", () => clearInterval(interval));
      });
      const started = Date.now();
      const transport = loopbackTransport({ totalTimeoutMs: 300 });
      await expect(fhirGet(transport, server.url)).rejects.toMatchObject({ code: "timeout" });
      expect(Date.now() - started).toBeLessThan(3_000);
    },
    10_000,
  );

  it("aborts a request that runs longer than the total timeout before any response", async () => {
    server = await startTestServer((_req, res) => {
      // Never respond — hold the connection open past the client's total timeout.
      void res;
    });
    await expect(fhirGet(loopbackTransport({ totalTimeoutMs: 50 }), server.url)).rejects.toMatchObject({
      code: "timeout",
    });
  }, 10_000);
});

describe("HttpsTransport — environment proxies are ignored", () => {
  /** A TCP listener that counts connections; stands in for an HTTP(S) proxy. */
  async function startFakeProxy(): Promise<{ url: string; connections: () => number; close(): void }> {
    let count = 0;
    const proxy = net.createServer((socket) => {
      count++;
      socket.on("error", () => undefined);
      socket.destroy();
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const port = (proxy.address() as net.AddressInfo).port;
    return { url: `http://127.0.0.1:${port}`, connections: () => count, close: () => proxy.close() };
  }

  it("connects directly while an agent built from the same environment WOULD use the proxy", async () => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON });
      res.end("{}");
    });
    const proxy = await startFakeProxy();
    try {
      vi.stubEnv("HTTPS_PROXY", proxy.url);
      vi.stubEnv("https_proxy", proxy.url);
      vi.stubEnv("NODE_USE_ENV_PROXY", "1");
      // A developer's or CI's own NO_PROXY (often listing localhost) must not mask the control.
      vi.stubEnv("NO_PROXY", "");
      vi.stubEnv("no_proxy", "");

      // Control: on this Node, an agent constructed with `proxyEnv` honors the variables — so the
      // assertion below is not vacuous. (A transport switched to such an agent would fail it.)
      const controlAgent = new https.Agent({ proxyEnv: { ...process.env } });
      await new Promise<void>((resolve) => {
        const request = https.request(server!.url, { agent: controlAgent }, () => undefined);
        request.on("error", () => resolve());
        request.end();
      });
      expect(proxy.connections()).toBeGreaterThan(0);
      const controlConnections = proxy.connections();

      const response = await fhirGet(loopbackTransport(), server.url);
      expect(response.status).toBe(200);
      expect(proxy.connections()).toBe(controlConnections); // the transport never touched the proxy
    } finally {
      proxy.close();
    }
  });
});

describe("HttpsTransport — TLS protocol and cipher enforcement", () => {
  function respondJson(): RequestListener {
    return (_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON });
      res.end("{}");
    };
  }

  it("negotiates TLS 1.3 when the server offers it", async () => {
    let protocol: string | null = null;
    server = await startTestServer((req, res) => {
      protocol = (req.socket as tls.TLSSocket).getProtocol();
      respondJson()(req, res);
    });
    await fhirGet(loopbackTransport(), server.url);
    expect(protocol).toBe("TLSv1.3");
  });

  it("negotiates TLS 1.2 with an ECDHE + AEAD suite when the server is capped at 1.2", async () => {
    let cipher = "";
    let protocol: string | null = null;
    server = await startTestServer(
      (req, res) => {
        const socket = req.socket as tls.TLSSocket;
        protocol = socket.getProtocol();
        cipher = socket.getCipher().name;
        respondJson()(req, res);
      },
      { maxVersion: "TLSv1.2" },
    );
    await fhirGet(loopbackTransport(), server.url);
    expect(protocol).toBe("TLSv1.2");
    expect(TLS12_CIPHERS.split(":")).toContain(cipher);
  });

  it("refuses a TLS 1.2 server that only offers a CBC suite (control: a default client accepts it)", async () => {
    server = await startTestServer(respondJson(), {
      maxVersion: "TLSv1.2",
      ciphers: "ECDHE-ECDSA-AES128-SHA",
    });
    // Control: without our cipher list, the same server is reachable, so the refusal below is due to it.
    const controlProtocol = await new Promise<string | null>((resolve, reject) => {
      const request = https.request(
        { agent: false, ca: testCert(), servername: "localhost", host: "127.0.0.1", port: server!.port },
        (res) => {
          resolve((res.socket as tls.TLSSocket).getProtocol());
          res.resume();
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(controlProtocol).toBe("TLSv1.2");
    await expect(fhirGet(loopbackTransport(), server.url)).rejects.toMatchObject({ code: "tls_failed" });
  });

  it("refuses a server that only offers TLS 1.1, even with the process default minimum lowered", async () => {
    const legacy = {
      minVersion: "TLSv1",
      maxVersion: "TLSv1.1",
      ciphers: "DEFAULT:@SECLEVEL=0",
    } as const;
    server = await startTestServer(respondJson(), legacy);

    // Control: a permissive raw client does complete a TLS 1.1 handshake with this server, so the
    // refusal below is the transport's doing and not a server that can't speak 1.1.
    const controlProtocol = await new Promise<string | null>((resolve, reject) => {
      const socket = tls.connect(
        {
          host: "127.0.0.1",
          port: server!.port,
          ca: testCert(),
          servername: "localhost",
          minVersion: "TLSv1",
          ciphers: "DEFAULT:@SECLEVEL=0",
        },
        () => {
          resolve(socket.getProtocol());
          socket.destroy();
        },
      );
      socket.on("error", reject);
    });
    expect(controlProtocol).toBe("TLSv1.1");

    const originalMin = tls.DEFAULT_MIN_VERSION;
    tls.DEFAULT_MIN_VERSION = "TLSv1";
    try {
      await expect(fhirGet(loopbackTransport(), server.url)).rejects.toMatchObject({ code: "tls_failed" });
    } finally {
      tls.DEFAULT_MIN_VERSION = originalMin;
    }
  });
});

describe("HttpsTransport — TLS failure without the injectable CA", () => {
  it("refuses the self-signed test server when no CA override is given", async () => {
    server = await startTestServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON });
      res.end("{}");
    });
    const transport = new HttpsTransport({ allowAddress: ALLOW_LOOPBACK }); // no ca
    await expect(fhirGet(transport, server.url)).rejects.toMatchObject({ code: "tls_failed" });
  });
});

describe("collapseTransportError", () => {
  it("passes an existing TransportError through unchanged", () => {
    const error = new TransportError("timeout");
    expect(collapseTransportError(error)).toBe(error);
  });
  it("maps common connection failures to unreachable", () => {
    expect(collapseTransportError(Object.assign(new Error("x"), { code: "ECONNREFUSED" })).code).toBe(
      "unreachable",
    );
    expect(collapseTransportError(Object.assign(new Error("x"), { code: "ENOTFOUND" })).code).toBe(
      "unreachable",
    );
  });
  it("maps certificate failures to tls_failed", () => {
    expect(
      collapseTransportError(Object.assign(new Error("x"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" })).code,
    ).toBe("tls_failed");
    expect(
      collapseTransportError(Object.assign(new Error("x"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" })).code,
    ).toBe("tls_failed");
  });
  it("maps an AbortError to timeout", () => {
    const abortError = Object.assign(new Error("x"), { name: "AbortError" });
    expect(collapseTransportError(abortError).code).toBe("timeout");
  });
});
