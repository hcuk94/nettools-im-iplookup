import { DatabaseSync } from 'node:sqlite';

// Minimal async-compatible wrapper around the synchronous node:sqlite API.
function wrapDb(db) {
  return {
    exec(sql) {
      db.exec(sql);
    },

    async get(sql, ...params) {
      const stmt = db.prepare(sql);
      return stmt.get(...params);
    },

    async run(sql, ...params) {
      const stmt = db.prepare(sql);
      return stmt.run(...params);
    },

    close() {
      db.close();
    }
  };
}

export async function openDb(sqlitePath) {
  const raw = new DatabaseSync(sqlitePath);
  const db = wrapDb(raw);

  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;

    CREATE TABLE IF NOT EXISTS rdap_cache (
      ip TEXT PRIMARY KEY,
      response_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limit (
      client TEXT NOT NULL,
      day TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (client, day)
    );
  `);

  return db;
}

export function dayKey(d = new Date()) {
  // UTC day key: YYYY-MM-DD
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
