import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { getConfig } from './config.js';
import { openDb } from './db.js';
import { parseIp, isNonPublicIp } from './ip.js';
import { getRdapCached } from './rdap.js';
import { getRateLimitState, incrementRateLimit } from './rateLimit.js';
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
    },
    // Allow frontend to read rate limit headers
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']
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

app.get('/me', (req, res) => {
  // Helpful for the frontend to prefill the user's current IP.
  res.json({ ip: req.ip || null });
});

app.get('/lookup', async (req, res, next) => {
  try {
    // If no ip provided, look up the caller.
    const ip = req.query.ip ? parseIp(req.query.ip) : (req.ip || '');
    if (!ip) {
      const err = new Error('Missing IP address');
      err.status = 400;
      throw err;
    }

    // Rate limit should only count "live" external lookups.
    const client = req.ip || 'unknown';
    const state = await getRateLimitState({ db, client, limit: cfg.RATE_LIMIT_DAILY });
    if (state.current >= state.limit) {
      res.status(429).json({
        error: 'rate_limited',
        message: `Daily rate limit exceeded (${state.limit}/day).`,
        limit: state.limit,
        remaining: 0,
        resetDay: state.day
      });
      return;
    }

    let rdapResult = { source: 'skipped', rdap: null, fetchedAt: null };
    if (!isNonPublicIp(ip)) {
      rdapResult = await getRdapCached({
        db,
        ip,
        ttlSeconds: cfg.RDAP_CACHE_TTL_SECONDS,
        baseUrl: cfg.RDAP_BASE_URL
      });
    }

    // Only count against rate limit when we actually hit RDAP live.
    const shouldCount = rdapResult.source === 'live';
    let current = state.current;
    if (shouldCount) {
      current = await incrementRateLimit({ db, client, day: state.day });
    }

    res.setHeader('X-RateLimit-Limit', String(state.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, state.limit - current)));
    res.setHeader('X-RateLimit-Reset', state.day);

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
