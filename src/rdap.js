export async function fetchRdap({ ip, baseUrl, signal }) {
  const url = new URL(encodeURIComponent(ip), baseUrl).toString();
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'accept': 'application/rdap+json, application/json;q=0.9, */*;q=0.1'
    },
    signal
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`RDAP request failed (${res.status})`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export async function getRdapCached({ db, ip, ttlSeconds, baseUrl, nowMs = Date.now() }) {
  const row = await db.get('SELECT response_json, fetched_at FROM rdap_cache WHERE ip = ?', ip);
  if (row) {
    const ageSeconds = (nowMs - row.fetched_at) / 1000;
    if (ageSeconds <= ttlSeconds) {
      return { source: 'cache', rdap: JSON.parse(row.response_json), fetchedAt: row.fetched_at };
    }
  }

  const rdap = await fetchRdap({ ip, baseUrl });
  const fetchedAt = nowMs;
  await db.run(
    'INSERT INTO rdap_cache(ip, response_json, fetched_at) VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET response_json=excluded.response_json, fetched_at=excluded.fetched_at',
    ip,
    JSON.stringify(rdap),
    fetchedAt
  );
  return { source: 'live', rdap, fetchedAt };
}
