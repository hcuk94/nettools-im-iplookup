import { z } from 'zod';

// Basic IP validation for both v4 and v6.
const ipSchema = z.string().ip();

export function parseIp(ip) {
  return ipSchema.parse(ip);
}
