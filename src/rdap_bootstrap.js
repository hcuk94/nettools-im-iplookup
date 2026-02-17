import net from 'node:net';
import { ProxyAgent } from 'undici';

// IANA RDAP bootstrap data
// Ref: https://data.iana.org/rdap/
const IANA_IPV4_URL = 'https://data.iana.org/rdap/ipv4.json';
const IANA_IPV6_URL = 'https://data.iana.org/rdap/ipv6.json';

let cacheV4 = { fetchedAtMs: 0, data: null };
let cacheV6 = { fetchedAtMs: 0, data: null };

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function isFresh(cache, ttlMs) {
  return cache.data && (Date.now() - cache.fetchedAtMs) < ttlMs;
}

function parseNoProxy() {
  const raw = process.env.NO_PROXY || process.env.no_proxy || '';
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function hostMatchesNoProxy(host, noProxyList) {
  if (!host) return false;
  return noProxyList.some(entry => {
    if (entry === '*') return true;
    if (entry.startsWith('.')) return host.endsWith(entry);
    return host === entry;
  });
}

function proxyForUrl(urlStr) {
  const u = new URL(urlStr);
  const noProxy = parseNoProxy();
  if (hostMatchesNoProxy(u.hostname, noProxy)) return null;

  if (u.protocol === 'https:') {
    return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null;
  }
  if (u.protocol === 'http:') {
    return process.env.HTTP_PROXY || process.env.http_proxy || null;
  }
  return null;
}

async function fetchBootstrap(url) {
  const proxy = proxyForUrl(url);
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;

  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json' },
      ...(dispatcher ? { dispatcher } : {})
    });
  } catch (e) {
    const err = new Error('RDAP bootstrap fetch failed');
    err.status = 502;
    err.body = {
      code: 'rdap_bootstrap_fetch_failed',
      url,
      cause: String(e?.cause?.message || e?.message || e)
    };
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`RDAP bootstrap fetch failed (${res.status})`);
    err.status = 502;
    err.body = {
      code: 'rdap_bootstrap_http_error',
      url,
      status: res.status
    };
    throw err;
  }

  return await res.json();
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(n => Number(n));
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inCidrV4(ip, cidr) {
  const [baseStr, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(baseStr);
  if (ipInt === null || baseInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function ipv6ToBigInt(ip) {
  // Expand and parse IPv6 into 8 hextets.
  // Handles :: compression and IPv4-mapped suffix.
  let s = ip.toLowerCase();
  // IPv4-mapped (e.g. ::ffff:192.0.2.1)
  const v4Index = s.lastIndexOf('.');
  if (v4Index !== -1) {
    const lastColon = s.lastIndexOf(':');
    const v4 = s.slice(lastColon + 1);
    const v4Int = ipv4ToInt(v4);
    if (v4Int === null) return null;
    const hi = ((v4Int >>> 16) & 0xffff).toString(16);
    const lo = (v4Int & 0xffff).toString(16);
    s = s.slice(0, lastColon + 1) + hi + ':' + lo;
  }

  const parts = s.split('::');
  if (parts.length > 2) return null;

  const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':').filter(Boolean) : [];

  if (left.some(p => p.length > 4) || right.some(p => p.length > 4)) return null;

  const missing = 8 - (left.length + right.length);
  if (missing < 0) return null;

  const hextets = [...left, ...Array(missing).fill('0'), ...right];
  if (hextets.length !== 8) return null;

  let out = 0n;
  for (const h of hextets) {
    const v = BigInt(parseInt(h || '0', 16));
    if (v < 0n || v > 0xffffn) return null;
    out = (out << 16n) + v;
  }
  return out;
}

function inCidrV6(ip, cidr) {
  const [baseStr, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return false;

  const ipBig = ipv6ToBigInt(ip);
  const baseBig = ipv6ToBigInt(baseStr);
  if (ipBig === null || baseBig === null) return false;

  if (prefix === 0) return true;
  const shift = 128n - BigInt(prefix);
  return (ipBig >> shift) === (baseBig >> shift);
}

function pickService(bootstrapJson, ip, family) {
  const services = bootstrapJson?.services;
  if (!Array.isArray(services)) return null;

  for (const entry of services) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const ranges = entry[0];
    const urls = entry[1];
    if (!Array.isArray(ranges) || !Array.isArray(urls) || urls.length === 0) continue;

    const match = ranges.some((cidr) => {
      if (typeof cidr !== 'string') return false;
      return family === 4 ? inCidrV4(ip, cidr) : inCidrV6(ip, cidr);
    });

    if (match) {
      const url = urls.find(u => typeof u === 'string' && u.startsWith('http'));
      return url || null;
    }
  }

  return null;
}

export async function resolveRdapBaseUrlForIp(ip, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const fam = net.isIP(ip);
  if (fam !== 4 && fam !== 6) return null;

  if (fam === 4) {
    if (!isFresh(cacheV4, ttlMs)) {
      cacheV4 = { fetchedAtMs: Date.now(), data: await fetchBootstrap(IANA_IPV4_URL) };
    }
    return pickService(cacheV4.data, ip, 4);
  }

  if (!isFresh(cacheV6, ttlMs)) {
    cacheV6 = { fetchedAtMs: Date.now(), data: await fetchBootstrap(IANA_IPV6_URL) };
  }
  return pickService(cacheV6.data, ip, 6);
}
