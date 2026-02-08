import { z } from 'zod';

// Basic IP validation for both v4 and v6.
const ipSchema = z.string().ip();

export function parseIp(ip) {
  try {
    return ipSchema.parse(ip);
  } catch (e) {
    const err = new Error('Invalid IP address. Expected IPv4 or IPv6.');
    err.status = 400;
    err.body = { code: 'invalid_ip' };
    throw err;
  }
}

function parseV4(ip) {
  const parts = ip.split('.').map(n => Number(n));
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

function inCidrV4(parts, baseParts, prefix) {
  const toInt = (p) => ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
  const ipInt = toInt(parts);
  const baseInt = toInt(baseParts);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function classifyIp(ip) {
  // Returns { public: boolean, kind?: string }
  if (ip.includes('.')) {
    const p = parseV4(ip);
    if (!p) return { public: false, kind: 'invalid' };

    const checks = [
      { kind: 'internal_rfc1918', base: [10, 0, 0, 0], prefix: 8 },
      { kind: 'internal_rfc1918', base: [172, 16, 0, 0], prefix: 12 },
      { kind: 'internal_rfc1918', base: [192, 168, 0, 0], prefix: 16 },
      { kind: 'loopback', base: [127, 0, 0, 0], prefix: 8 },
      { kind: 'link_local', base: [169, 254, 0, 0], prefix: 16 },
      { kind: 'cgnat', base: [100, 64, 0, 0], prefix: 10 },
      { kind: 'this_network', base: [0, 0, 0, 0], prefix: 8 },
      { kind: 'documentation', base: [192, 0, 2, 0], prefix: 24 },
      { kind: 'documentation', base: [198, 51, 100, 0], prefix: 24 },
      { kind: 'documentation', base: [203, 0, 113, 0], prefix: 24 },
      { kind: 'multicast', base: [224, 0, 0, 0], prefix: 4 }
    ];

    for (const c of checks) {
      if (inCidrV4(p, c.base, c.prefix)) return { public: false, kind: c.kind };
    }

    return { public: true };
  }

  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return { public: false, kind: 'loopback' };
  if (s.startsWith('fe80:')) return { public: false, kind: 'link_local' };
  if (s.startsWith('fc') || s.startsWith('fd')) return { public: false, kind: 'internal_ula' };
  if (s.startsWith('ff')) return { public: false, kind: 'multicast' };
  if (s.startsWith('2001:db8:')) return { public: false, kind: 'documentation' };

  return { public: true };
}

export function isNonPublicIp(ip) {
  return !classifyIp(ip).public;
}
