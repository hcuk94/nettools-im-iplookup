import { dayKey } from './db.js';

export async function getRateLimitState({ db, client, limit, day = dayKey() }) {
  const row = await db.get('SELECT count FROM rate_limit WHERE client = ? AND day = ?', client, day);
  const current = row?.count ?? 0;
  const remaining = Math.max(0, limit - current);
  return { day, current, limit, remaining };
}

export async function incrementRateLimit({ db, client, day = dayKey() }) {
  const row = await db.get('SELECT count FROM rate_limit WHERE client = ? AND day = ?', client, day);
  const current = row?.count ?? 0;
  const nextCount = current + 1;
  await db.run(
    'INSERT INTO rate_limit(client, day, count) VALUES(?,?,?) ON CONFLICT(client, day) DO UPDATE SET count = excluded.count',
    client,
    day,
    nextCount
  );
  return nextCount;
}

export function rateLimitDaily({ db, limit }) {
  // Legacy middleware: increments on every request.
  return async function rateLimitMiddleware(req, res, next) {
    try {
      const client = req.ip || 'unknown';
      const state = await getRateLimitState({ db, client, limit });
      if (state.current >= limit) {
        res.status(429).json({
          error: 'rate_limited',
          message: `Daily rate limit exceeded (${limit}/day).`,
          limit,
          remaining: 0,
          resetDay: state.day
        });
        return;
      }

      const nextCount = await incrementRateLimit({ db, client, day: state.day });

      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - nextCount)));
      res.setHeader('X-RateLimit-Reset', state.day);

      next();
    } catch (err) {
      next(err);
    }
  };
}
