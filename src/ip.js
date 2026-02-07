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

export function isNonPublicIp(ip) {
  if (ip.includes('.')) {
    const p = parseV4(ip);
    if (!p) return true;

    // RFC1918 + other non-public ranges
    const ranges = [
      [[10,0,0,0], 8],
      [[172,16,0,0], 12],
      [[192,168,0,0], 16],
      [[127,0,0,0], 8],          // loopback
      [[169,254,0,0], 16],       // link-local
      [[100,64,0,0], 10],        // CGNAT
      [[0,0,0,0], 8],            // "this" network
      [[192,0,2,0], 24],         // TEST-NET-1
      [[198,51,100,0], 24],      // TEST-NET-2
      [[203,0,113,0], 24],       // TEST-NET-3
      [[224,0,0,0], 4]           // multicast
    ];

    return ranges.some(([b, pre]) => inCidrV4(p, b, pre));
  }

  // IPv6 checks (string-prefix based; good enough for skipping RDAP)
  const s = ip.toLowerCase();
  return (
    s === '::' ||
    s === '::1' ||
    s.startsWith('fe80:') ||            // link-local
    s.startsWith('fc') || s.startsWith('fd') || // unique local fc00::/7
    s.startsWith('ff') ||               // multicast
    s.startsWith('2001:db8:')           // documentation
  );
}
