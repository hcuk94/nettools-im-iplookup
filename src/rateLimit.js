import { dayKey } from './db.js';

export function rateLimitDaily({ db, limit }) {
  return async function rateLimitMiddleware(req, res, next) {
    try {
      const client = req.ip || 'unknown';
      const day = dayKey();

      // transaction-like: read then write with upsert.
      const row = await db.get('SELECT count FROM rate_limit WHERE client = ? AND day = ?', client, day);
      const current = row?.count ?? 0;
      if (current >= limit) {
        res.status(429).json({
          error: 'rate_limited',
          message: `Daily rate limit exceeded (${limit}/day).`,
          limit,
          remaining: 0,
          resetDay: day
        });
        return;
      }

      const nextCount = current + 1;
      await db.run(
        'INSERT INTO rate_limit(client, day, count) VALUES(?,?,?) ON CONFLICT(client, day) DO UPDATE SET count = excluded.count',
        client,
        day,
        nextCount
      );

      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - nextCount)));
      res.setHeader('X-RateLimit-Reset', day);

      next();
    } catch (err) {
      next(err);
    }
  };
}
