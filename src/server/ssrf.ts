import "server-only";
import { lookup } from "node:dns/promises";

/**
 * SSRF guard for outbound link unfurls. The ONLY thing standing between an
 * attacker-supplied URL and our internal network, so it is deliberately strict
 * and deny-by-default:
 *
 *  - https only (http/data/file/etc. rejected outright).
 *  - The host is DNS-resolved and EVERY resolved address is checked against a
 *    blocklist of private / loopback / link-local / unique-local / metadata
 *    ranges (IPv4 + IPv6, incl. IPv4-mapped IPv6). One bad address fails.
 *  - Redirects are followed manually (max 3) and the destination of each hop is
 *    re-validated, so a public URL can't 30x into 169.254.169.254.
 *  - Optional host allowlist (env UNFURL_ALLOWED_HOSTS) — when set, only those
 *    registrable hosts unfurl at all.
 *
 * Pure IP/host predicates are exported for unit testing; DNS + redirect logic
 * is exercised by the fetcher's integration tests.
 */

/** Parses a dotted-quad IPv4 string to its four octets, or null. */
function parseIpv4(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const;
  if (o.some((n) => n > 255)) return null;
  return [o[0], o[1], o[2], o[3]];
}

/** True when an IPv4 address is in a private / loopback / link-local / reserved range. */
export function isPrivateIpv4(ip: string): boolean {
  const o = parseIpv4(ip);
  if (!o) return true; // unparseable → treat as unsafe
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 — "this host"
  if (a === 10) return true; // 10.0.0.0/8 — private
  if (a === 127) return true; // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 — link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 — private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 — private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 — CGNAT
  if (a === 192 && b === 0 && o[2] === 0) return true; // 192.0.0.0/24 — IETF protocol
  if (a === 192 && b === 0 && o[2] === 2) return true; // 192.0.2.0/24 — TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 — benchmarking
  if (a === 198 && b === 51 && o[2] === 100) return true; // 198.51.100.0/24 — TEST-NET-2
  if (a === 203 && b === 0 && o[2] === 113) return true; // 203.0.113.0/24 — TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
  return false;
}

/** Expands an IPv6 string to its eight 16-bit hextet values, or null. */
function parseIpv6(ip: string): number[] | null {
  let s = ip.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  // Strip a zone id (fe80::1%eth0).
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  if (!s.includes(":")) return null;

  // Handle an embedded IPv4 tail (e.g. ::ffff:127.0.0.1).
  let v4tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    v4tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = s.slice(0, lastColon + 1) + "0:0"; // placeholder hextets, replaced below
  }

  const parts = s.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const back = parts.length === 2 && parts[1] ? parts[1].split(":").filter(Boolean) : [];

  const toNums = (arr: string[]): number[] | null => {
    const out: number[] = [];
    for (const h of arr) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const headN = toNums(head);
  let backN = toNums(back);
  if (headN === null || backN === null) return null;
  if (v4tail.length) backN = backN.slice(0, -2).concat(v4tail);

  let full: number[];
  if (parts.length === 2) {
    const fill = 8 - headN.length - backN.length;
    if (fill < 0) return null;
    full = [...headN, ...Array(fill).fill(0), ...backN];
  } else {
    full = headN;
  }
  return full.length === 8 ? full : null;
}

/** True when an IPv6 address is loopback / link-local / unique-local / mapped-private. */
export function isPrivateIpv6(ip: string): boolean {
  const h = parseIpv6(ip);
  if (!h) return true; // unparseable → unsafe
  const [h0, h1, , , , , , h7] = h;
  // Unspecified ::
  if (h.every((x) => x === 0)) return true;
  // Loopback ::1
  if (h7 === 1 && h.slice(0, 7).every((x) => x === 0)) return true;
  // IPv4-mapped ::ffff:a.b.c.d (and ::ffff:0:a.b.c.d) — validate the embedded v4.
  if (h0 === 0 && h1 === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    const a = (h[6]! >> 8) & 0xff;
    const b = h[6]! & 0xff;
    const c = (h[7]! >> 8) & 0xff;
    const d = h[7]! & 0xff;
    return isPrivateIpv4(`${a}.${b}.${c}.${d}`);
  }
  // Unique-local fc00::/7  (fc00..fdff)
  if ((h0! & 0xfe00) === 0xfc00) return true;
  // Link-local fe80::/10
  if ((h0! & 0xffc0) === 0xfe80) return true;
  // Multicast ff00::/8
  if ((h0! & 0xff00) === 0xff00) return true;
  return false;
}

/** True for ANY address (v4 or v6) we must never connect to. */
export function isBlockedAddress(ip: string): boolean {
  return ip.includes(":") ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

/** Parses the optional host allowlist from the environment (comma-separated). */
function allowedHosts(): Set<string> | null {
  const raw = process.env.UNFURL_ALLOWED_HOSTS;
  if (!raw || !raw.trim()) return null;
  return new Set(
    raw
      .split(",")
      .map((h) =>
        h
          .trim()
          .toLowerCase()
          .replace(/^www\./, "")
      )
      .filter(Boolean)
  );
}

/** True when the allowlist is unset (anything allowed) or the host is on it. */
export function isHostAllowed(host: string, list: Set<string> | null = allowedHosts()): boolean {
  if (!list) return true;
  const h = host.toLowerCase().replace(/^www\./, "");
  if (list.has(h)) return true;
  // Allow subdomains of an allowlisted registrable host.
  return [...list].some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/**
 * Validates a URL and resolves its host, returning the safe target on success
 * or a reason string on rejection. Performs the full https + allowlist + DNS +
 * per-address blocklist check. Hostnames that are already literal IPs are
 * checked directly (no DNS).
 */
export async function assertSafeUrl(
  rawUrl: string
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not-https" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, reason: "no-host" };
  if (!isHostAllowed(url.hostname)) return { ok: false, reason: "host-not-allowed" };

  // A literal IP host bypasses DNS — check it directly.
  if (parseIpv4(host) || host.includes(":")) {
    if (isBlockedAddress(host)) return { ok: false, reason: "private-ip" };
    return { ok: true, url };
  }

  // Resolve ALL addresses; reject if any is private (a host could round-robin
  // a public and a private A record — block the whole host then).
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: "dns-failure" };
  }
  if (addrs.length === 0) return { ok: false, reason: "dns-empty" };
  for (const a of addrs) {
    if (isBlockedAddress(a.address)) return { ok: false, reason: "private-ip" };
  }
  return { ok: true, url };
}
