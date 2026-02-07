import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Trust proxy so req.ip reflects X-Forwarded-For when behind a reverse proxy.
  TRUST_PROXY: z.coerce.boolean().default(true),

  // CORS
  CORS_ALLOWLIST: z.string().default('https://nettools.im,https://www.nettools.im'),

  // RDAP caching
  SQLITE_PATH: z.string().default('/data/app.sqlite'),
  RDAP_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  RDAP_BASE_URL: z.string().default('https://rdap.org/ip/'),

  // Rate limit
  RATE_LIMIT_DAILY: z.coerce.number().int().positive().default(24),

  // MaxMind DB
  GEOIP_DB_DIR: z.string().default('/data/geoip'),
  GEOIP_CITY_MMDB: z.string().default('GeoLite2-City.mmdb'),
  GEOIP_ASN_MMDB: z.string().default('GeoLite2-ASN.mmdb')
});

export function getConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${msg}`);
  }
  const cfg = parsed.data;
  cfg.CORS_ALLOWLIST = cfg.CORS_ALLOWLIST.split(',').map(s => s.trim()).filter(Boolean).join(',');
  return cfg;
}
