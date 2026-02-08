import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function openDb(sqlitePath) {
  const db = await open({
    filename: sqlitePath,
    driver: sqlite3.Database
  });

  await db.exec(`
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
