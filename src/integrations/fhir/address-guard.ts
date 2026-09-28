/**
 * Deny-by-default address guard for outbound FHIR connections (PI2a, threat model I8: SSRF).
 *
 * "Only global unicast passes". IPv4: every range the IANA special-purpose registry marks as
 * non-globally-routable (loopback, private-use, link-local, documentation, multicast, reserved, ...)
 * plus the Azure WireServer address is denied; anything left is global unicast. IPv6: an address
 * must first be inside the global-unicast allocation `2000::/3` (RFC 4291 §2.4 / IANA IPv6 Address
 * Space) — everything else (loopback, mapped, NAT64, unique-local, link-local, site-local, multicast,
 * ...) is denied outright — and then must not fall in any IANA special-purpose range that lies
 * inside `2000::/3` and is not globally reachable (listed below, each cited).
 *
 * The same check runs on every DNS-resolved address (the guarded `lookup` hook) AND on IP-literal
 * hosts, for which Node never calls `lookup` (`transport.ts` checks them before connecting).
 *
 * ⚠️ VERIFY the exact range list against the live registries before relying on it for a real
 * connection — the registries below are the source of truth and do change:
 *   - IANA IPv4 Special-Purpose Address Registry:
 *     https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml
 *   - IANA IPv6 Special-Purpose Address Registry:
 *     https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml
 *
 * IPv6 transition mechanisms tunnel an embedded IPv4 address that can itself be private or
 * internal (spec PI2a bullet 2). Every one of them is denied outright here: mapped / compatible /
 * translated / NAT64 (`64:ff9b::/96`) lie outside `2000::/3`; Teredo (`2001::/32`) lies inside the
 * denied `2001::/23`; 6to4 (`2002::/16`) is denied outright (deprecated, RFC 7526; nothing legitimate
 * hosts an EHR on it). The embedded-IPv4 decode is still run on every address that gets that far, as
 * defense in depth should one of those denials ever be relaxed (a deployment behind DNS64 would need
 * `64:ff9b::/96` allowed deliberately, with sign-off).
 */
import { BlockList, isIPv4 as nodeIsIPv4, isIPv6 as nodeIsIPv6 } from "node:net";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { TransportError } from "./errors";
import { assertTestOnlyOption } from "./test-only";

/** Azure WireServer host address (platform agent / DHCP / DNS endpoint) — never a legitimate FHIR endpoint.
 * Not IMDS: IMDS is 169.254.169.254, which the link-local 169.254.0.0/16 range already blocks. */
export const AZURE_WIRESERVER_ADDRESS = "168.63.129.16";

/** IPv4 ranges from the IANA special-purpose registry (Global: False), plus multicast (RFC 1112). */
export const DENIED_IPV4_SUBNETS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "This host on this network" — RFC 1122 §3.2.1.3
  ["10.0.0.0", 8], // Private-Use — RFC 1918
  ["100.64.0.0", 10], // Shared Address Space (CGNAT) — RFC 6598
  ["127.0.0.0", 8], // Loopback — RFC 1122
  ["169.254.0.0", 16], // Link Local — RFC 3927
  ["172.16.0.0", 12], // Private-Use — RFC 1918
  ["192.0.0.0", 24], // IETF Protocol Assignments — RFC 6890
  ["192.0.2.0", 24], // Documentation (TEST-NET-1) — RFC 5737
  ["192.88.99.0", 24], // 6to4 Relay Anycast (deprecated) — RFC 3068 / RFC 7526
  ["192.168.0.0", 16], // Private-Use — RFC 1918
  ["198.18.0.0", 15], // Benchmarking — RFC 2544
  ["198.51.100.0", 24], // Documentation (TEST-NET-2) — RFC 5737
  ["203.0.113.0", 24], // Documentation (TEST-NET-3) — RFC 5737
  ["224.0.0.0", 4], // Multicast — RFC 1112
  ["240.0.0.0", 4], // Reserved — RFC 1112
  ["255.255.255.255", 32], // Limited Broadcast — RFC 8190 / RFC 919
  [AZURE_WIRESERVER_ADDRESS, 32], // Azure WireServer — explicit, spec PI2a bullet 2
];

/**
 * IPv6 deny list (in addition to the `2000::/3` requirement in `isAddressAllowed`). Entries outside
 * `2000::/3` are redundant with that requirement but kept as defense in depth and so the list mirrors
 * the registry; each has a direct unit test against this list (not only through `isAddressAllowed`).
 *
 * ⚠️ VERIFY every row against the live IANA IPv6 Special-Purpose Address Registry (could not be
 * fetched from the build environment; entries are from the registry as last known, 2025).
 */
export const DENIED_IPV6_SUBNETS: ReadonlyArray<readonly [string, number]> = [
  ["::", 128], // Unspecified — RFC 4291 §2.5.2
  ["::1", 128], // Loopback — RFC 4291 §2.5.3
  // IPv4-mapped (::ffff:0:0/96, RFC 4291 §2.5.5.2) and IPv4-translated (::ffff:0:0:0/96, RFC 2765,
  // "IPv4-IPv6 Translat.") are deliberately NOT added as `net.BlockList` subnets: Node's BlockList
  // treats an IPv6 subnet under ::ffff:0:0/96 as also matching every plain IPv4 address (verified on
  // Node v22.22.2; CI and Docker use Node 24 — re-verify there), which would block all IPv4. Both lie
  // outside 2000::/3, so the /3 requirement
  // denies them (tests: `::ffff:127.0.0.1`, `::ffff:0:10.0.0.1`).
  ["::", 96], // IPv4-compatible (deprecated) — RFC 4291 §2.5.5.1
  ["64:ff9b:1::", 48], // NAT64 Local-Use — RFC 8215 (registry Global: False)
  ["100::", 64], // Discard-Only Address Block — RFC 6666
  // 2001::/23 IETF Protocol Assignments — RFC 6890 (registry Global: False). Denied as a whole; the
  // registry's sub-assignments are listed after it, each also denied on its own:
  //   2001::/32 Teredo (RFC 4380), 2001:1::1/128 PCP anycast (RFC 7723), 2001:1::2/128 TURN anycast
  //   (RFC 8155), 2001:3::/32 AMT (RFC 7450), 2001:4:112::/48 AS112-v6 (RFC 7535) are "Global: True"
  //   or N/A in the registry but are protocol infrastructure, never an EHR/PM host: denied by the /23.
  ["2001::", 23],
  ["2001::", 32], // Teredo — RFC 4380 (tunnel; embedded client IPv4 is XOR-obfuscated)
  ["2001:2::", 48], // Benchmarking — RFC 5180 (registry Global: False)
  ["2001:10::", 28], // ORCHID (deprecated) — RFC 4843 (registry Global: False)
  ["2001:20::", 28], // ORCHIDv2 — RFC 7343 (registry Global: True, but identifiers, not routable locators)
  ["2001:30::", 28], // Drone Remote ID Protocol Entity Tags (DETs) — RFC 9374 (identifiers, not routable)
  ["2001:db8::", 32], // Documentation — RFC 3849
  ["2002::", 16], // 6to4 — RFC 3056; deprecated by RFC 7526. Denied outright (not decoded-then-allowed).
  ["2620:4f:8000::", 48], // Direct Delegation AS112 Service — RFC 7534 (anycast DNS infrastructure)
  ["3fff::", 20], // Documentation — RFC 9637 (registry Global: False)
  ["5f00::", 16], // Segment Routing (SRv6) SIDs — RFC 9602 (registry Global: False)
  ["fc00::", 7], // Unique Local — RFC 4193 / RFC 8190
  ["fe80::", 10], // Link-Local Unicast — RFC 4291 §2.5.6
  ["fec0::", 10], // Site-Local (deprecated) — RFC 3879
  ["ff00::", 8], // Multicast — RFC 4291 §2.7
];

let denyList: BlockList | undefined;

function buildDenyList(): BlockList {
  const list = new BlockList();
  for (const [address, prefix] of DENIED_IPV4_SUBNETS) list.addSubnet(address, prefix, "ipv4");
  for (const [address, prefix] of DENIED_IPV6_SUBNETS) list.addSubnet(address, prefix, "ipv6");
  return list;
}

function getDenyList(): BlockList {
  denyList ??= buildDenyList();
  return denyList;
}

/** Strips a zone id (e.g. `fe80::1%eth0`), which `net.isIPv6`/our parser don't need to resolve. */
function stripZone(address: string): string {
  const percent = address.indexOf("%");
  return percent === -1 ? address : address.slice(0, percent);
}

/**
 * Parses an IPv6 text address (accepting a trailing embedded IPv4 dotted-quad, e.g.
 * `::ffff:192.0.2.1`) into its eight 16-bit groups. Returns `null` for anything not a valid,
 * unambiguous IPv6 literal — callers must already know the address is IPv6 (e.g. from DNS).
 */
export function parseIPv6Groups(input: string): number[] | null {
  let address = stripZone(input);
  if (!nodeIsIPv6(address)) return null;
  if ((address.match(/::/g) ?? []).length > 1) return null;

  // Fold a trailing IPv4 dotted-quad into two hex groups before the usual `::` expansion.
  const lastColon = address.lastIndexOf(":");
  const tail = address.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = tail.split(".");
    if (octets.length !== 4) return null;
    const bytes = octets.map((octet) => Number(octet));
    if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null;
    const hi = ((bytes[0]! << 8) | bytes[1]!).toString(16);
    const lo = ((bytes[2]! << 8) | bytes[3]!).toString(16);
    address = `${address.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  let left: string;
  let right: string;
  if (address.includes("::")) {
    [left, right] = address.split("::") as [string, string];
  } else {
    left = address;
    right = "";
  }
  const leftGroups = left === "" ? [] : left.split(":");
  const rightGroups = right === "" ? [] : right.split(":");
  const missing = 8 - leftGroups.length - rightGroups.length;
  if (missing < 0 || (missing > 0 && !address.includes("::"))) return null;

  const allGroups = [...leftGroups, ...Array<string>(Math.max(missing, 0)).fill("0"), ...rightGroups];
  if (allGroups.length !== 8) return null;

  const groups = allGroups.map((group) => parseInt(group, 16));
  if (groups.some((value) => Number.isNaN(value) || value < 0 || value > 0xffff)) return null;
  return groups;
}

function groupsToIPv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * Decodes every embedded-IPv4 form the spec names (PI2a bullet 2) out of a parsed IPv6 address:
 * IPv4-mapped and IPv4-compatible (RFC 4291), NAT64 well-known and local-use prefixes (RFC 6052,
 * RFC 8215), 6to4 (RFC 3056), and Teredo's *obfuscated client* IPv4 (RFC 4380 §4 — the last 32
 * bits, XORed with 0xffffffff). Returns every form that matches; usually at most one does.
 */
export function embeddedIPv4Candidates(groups: readonly number[]): string[] {
  if (groups.length !== 8) return [];
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const candidates: string[] = [];

  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96 (excluding :: and ::1 themselves).
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    if (g5 === 0xffff) {
      candidates.push(groupsToIPv4(g6, g7)); // IPv4-mapped
    } else if (g5 === 0 && !(g6 === 0 && (g7 === 0 || g7 === 1))) {
      candidates.push(groupsToIPv4(g6, g7)); // IPv4-compatible (deprecated)
    }
  }

  // NAT64 well-known prefix 64:ff9b::/96 (RFC 6052 §2.1).
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    candidates.push(groupsToIPv4(g6, g7));
  }

  // NAT64 local-use prefix 64:ff9b:1::/48 (RFC 8215; RFC 6052 §2.2 embedding for a /48 prefix:
  // 16 bits of IPv4 after the prefix, an 8-bit "u" byte that must be 0, then the remaining 16 bits).
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0x0001) {
    const uByte = (g4 >> 8) & 0xff;
    if (uByte === 0) {
      const hi = g3;
      const lo = ((g4 & 0xff) << 8) | ((g5 >> 8) & 0xff);
      candidates.push(groupsToIPv4(hi, lo));
    }
  }

  // 6to4 2002::/16 (RFC 3056 §2): the next 32 bits are the IPv4 address.
  if (g0 === 0x2002) {
    candidates.push(groupsToIPv4(g1, g2));
  }

  // Teredo 2001:0000::/32 (RFC 4380 §4): the last 32 bits are the client's IPv4, obfuscated by
  // XOR with 0xffffffff.
  if (g0 === 0x2001 && g1 === 0) {
    candidates.push(groupsToIPv4(g6 ^ 0xffff, g7 ^ 0xffff));
  }

  return candidates;
}

/** True if `groups` is inside the global-unicast allocation `2000::/3` (top three bits `001`). */
export function isInGlobalUnicastSpace(groups: readonly number[]): boolean {
  return ((groups[0] ?? 0) & 0xe000) === 0x2000;
}

/** True if the address is in a denied IPv6 range (the list only; no `2000::/3` requirement). */
export function matchesDeniedIPv6Range(address: string): boolean {
  return getDenyList().check(stripZone(address), "ipv6");
}

/**
 * True only for a global-unicast address. IPv4: not in the deny list. IPv6: inside `2000::/3`, not
 * in the deny list, and not tunneling a denied IPv4 address. Anything unparseable is refused. This
 * is the single choke point every resolved address and IP-literal host must pass.
 */
export function isAddressAllowed(address: string, family: 4 | 6): boolean {
  const list = getDenyList();
  if (family === 4) return nodeIsIPv4(address) && !list.check(address, "ipv4");
  const groups = parseIPv6Groups(address); // unparseable IPv6 text is refused, not guessed at
  if (!groups) return false;
  if (!isInGlobalUnicastSpace(groups)) return false;
  if (matchesDeniedIPv6Range(address)) return false;
  for (const embedded of embeddedIPv4Candidates(groups)) {
    if (list.check(embedded, "ipv4")) return false;
  }
  return true;
}

/**
 * `isAddressAllowed`, or the test-only `allowAddress` hook (OR'd) — one function so the DNS path and
 * the IP-literal path can't drift apart.
 */
export function isAddressPermitted(
  address: string,
  family: 4 | 6,
  allowAddress?: (address: string, family: 4 | 6) => boolean,
): boolean {
  return isAddressAllowed(address, family) || allowAddress?.(address, family) === true;
}

/** DNS resolution timeout for the guarded lookup (spec PI2a bullet 3: "5 s DNS timeout"). */
export const DNS_TIMEOUT_MS = 5_000;

export type DnsLookupFn = typeof dnsLookup;

export interface GuardedLookupOptions {
  /**
   * Test-only escape hatch: an extra predicate OR'd with `isAddressAllowed`, so a test can permit
   * loopback (refused by default) without disabling the guard for every other address. Never set
   * outside a test.
   */
  allowAddress?: (address: string, family: 4 | 6) => boolean;
  /** Test-only override of DNS_TIMEOUT_MS. */
  timeoutMs?: number;
  /**
   * Test-only replacement for the underlying `dns.lookup` call, so a test can hand back
   * deterministic addresses (including simulated multi-A-record / rebinding attempts) without
   * depending on real DNS. Never set outside a test. (Not `vi.spyOn(dns, "lookup")`: Node's ESM
   * build of `node:dns` doesn't allow redefining its exports.)
   */
  resolve?: DnsLookupFn;
}

function refusalError(): NodeJS.ErrnoException {
  const error = new Error("Address refused by the outbound address guard") as NodeJS.ErrnoException;
  error.code = "EADDRESSREFUSED";
  return error;
}

function timeoutErrnoError(): NodeJS.ErrnoException {
  const error = new Error("DNS lookup timed out") as NodeJS.ErrnoException;
  error.code = "ETIMEOUT";
  return error;
}

/**
 * Builds a `lookup` function for `https.request`/`Agent` options that checks EVERY address DNS
 * returns for the hostname — not just the one Node happens to connect with — against the address
 * guard, at connect time, so a rebind between "test" and "use" can't slip a blocked address through
 * (threat model I8: "checked on every resolved address at connect (no rebinding)"). Refuses the
 * whole resolution if any candidate address is blocked, rather than silently filtering it out.
 */
export function createGuardedLookup(
  options: GuardedLookupOptions = {},
): (
  hostname: string,
  lookupOptions: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) => void {
  if (options.allowAddress) assertTestOnlyOption("allowAddress");
  if (options.timeoutMs !== undefined) assertTestOnlyOption("timeoutMs");
  if (options.resolve) assertTestOnlyOption("resolve");
  const timeoutMs = options.timeoutMs ?? DNS_TIMEOUT_MS;
  const resolve = options.resolve ?? dnsLookup;
  return function guardedLookup(hostname, lookupOptions, callback) {
    const wantsAll = lookupOptions?.all === true;
    const family = lookupOptions?.family ?? 0;
    let settled = false;

    // `dns.lookup` runs getaddrinfo on libuv's thread pool and cannot be cancelled: on timeout we
    // stop WAITING (the callback is answered and any later result is discarded via `settled`), but
    // the underlying lookup keeps occupying a pool thread until the resolver gives up.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      callback(timeoutErrnoError(), "", 0);
    }, timeoutMs);
    timer.unref?.();

    resolve(hostname, { all: true, family, verbatim: true }, (err, result) => {
      if (settled) return; // the timeout already answered
      settled = true;
      clearTimeout(timer);
      if (err) {
        callback(err, "", 0);
        return;
      }
      const addresses = result as LookupAddress[];
      if (addresses.length === 0) {
        const notFound = new Error("No address found") as NodeJS.ErrnoException;
        notFound.code = "ENOTFOUND";
        callback(notFound, "", 0);
        return;
      }
      const blocked = addresses.some(
        (candidate) =>
          !isAddressPermitted(candidate.address, candidate.family === 6 ? 6 : 4, options.allowAddress),
      );
      if (blocked) {
        callback(refusalError(), "", 0);
        return;
      }
      if (wantsAll) {
        callback(null, addresses);
        return;
      }
      const first = addresses[0]!;
      callback(null, first.address, first.family);
    });
  };
}

/** Maps the guarded lookup's own refusal/timeout errors to the collapsed transport codes. */
export function isAddressGuardError(error: unknown): TransportError | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EADDRESSREFUSED") return new TransportError("address_refused");
  if (code === "ETIMEOUT") return new TransportError("timeout");
  return undefined;
}
