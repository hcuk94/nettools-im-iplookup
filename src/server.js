import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { getConfig } from './config.js';
import { openDb } from './db.js';
import { parseIp } from './ip.js';
import { getRdapCached } from './rdap.js';
import { rateLimitDaily } from './rateLimit.js';
import { openGeoIpReaders, lookupGeo } from './geoip.js';

const cfg = getConfig();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', cfg.TRUST_PROXY);

const allowlist = new Set(cfg.CORS_ALLOWLIST.split(',').map(s => s.trim()).filter(Boolean));
app.use(
  cors({
    origin(origin, callback) {
      // allow non-browser or same-origin requests (no Origin header)
      if (!origin) return callback(null, true);
      if (allowlist.has(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    }
  })
);

app.use(morgan('combined'));

const db = await openDb(cfg.SQLITE_PATH);
const geoReaders = await openGeoIpReaders({
  dir: cfg.GEOIP_DB_DIR,
  cityMmdb: cfg.GEOIP_CITY_MMDB,
  asnMmdb: cfg.GEOIP_ASN_MMDB
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/lookup', rateLimitDaily({ db, limit: cfg.RATE_LIMIT_DAILY }), async (req, res, next) => {
  try {
    const ip = parseIp(req.query.ip);

    const rdapResult = await getRdapCached({
      db,
      ip,
      ttlSeconds: cfg.RDAP_CACHE_TTL_SECONDS,
      baseUrl: cfg.RDAP_BASE_URL
    });

    const geo = lookupGeo({ readers: geoReaders, ip });

    res.json({
      ip,
      rdap: rdapResult.rdap,
      rdapSource: rdapResult.source,
      rdapFetchedAt: rdapResult.fetchedAt,
      geo,
      maxmind: {
        cityDbPath: geoReaders.paths.cityPath,
        asnDbPath: geoReaders.paths.asnPath,
        cityLoaded: Boolean(geoReaders.city),
        asnLoaded: Boolean(geoReaders.asn)
      }
    });
  } catch (err) {
    next(err);
  }
});

// Error handler
app.use((err, req, res, _next) => {
  let status = err?.status && Number.isInteger(err.status) ? err.status : 500;

  // CORS middleware throws a generic Error.
  if (err?.message === 'Not allowed by CORS') status = 403;

  // Log full error server-side for debugging (keeps client response generic)
  // eslint-disable-next-line no-console
  console.error('[error]', {
    path: req.path,
    status,
    message: err?.message,
    stack: err?.stack,
    body: err?.body
  });

  const message = status === 500 ? 'Internal Server Error' : err.message;
  res.status(status).json({
    error: status === 500 ? 'internal_error' : 'request_failed',
    message,
    details: status === 500 ? undefined : err.body
  });
});

app.listen(cfg.PORT, cfg.HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`iplookup listening on http://${cfg.HOST}:${cfg.PORT}`);
});
