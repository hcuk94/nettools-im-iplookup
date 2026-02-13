import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let BASE_URL = process.env.BASE_URL;
let child;

async function getJson(path, { headers } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

async function waitForHealthy(url, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.status === 200) return;
    } catch {
      // ignore
    }
    await delay(250);
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms at ${url}`);
}

test.before(async () => {
  if (BASE_URL) return;

  // Local test mode: spin up the server for the duration of the test run.
  const port = process.env.PORT || '31337';
  BASE_URL = `http://127.0.0.1:${port}`;

  const sqlitePath = join(tmpdir(), `nettools-iplookup-test-${Date.now()}.sqlite`);

  child = spawn(process.execPath, ['src/server.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      SQLITE_PATH: sqlitePath,
      TRUST_PROXY: 'false',
      // Keep defaults for CORS allowlist; tests cover behaviour.
    },
    stdio: 'inherit'
  });

  await waitForHealthy(BASE_URL);
});

test.after(() => {
  if (child) child.kill('SIGTERM');
});

test('GET /health returns ok:true', async () => {
  const { res, json, text } = await getJson('/health');
  assert.equal(res.status, 200, text);
  assert.deepEqual(json, { ok: true });
});

test('GET /me returns an ip field (string or null)', async () => {
  const { res, json, text } = await getJson('/me');
  assert.equal(res.status, 200, text);
  assert.ok(json && Object.hasOwn(json, 'ip'));
  assert.ok(json.ip === null || typeof json.ip === 'string');
});

test('GET /lookup with no ip uses caller ip and returns rate limit headers', async () => {
  const { res, json, text } = await getJson('/lookup');
  assert.equal(res.status, 200, text);
  assert.ok(json && typeof json.ip === 'string');
  assert.ok(res.headers.get('x-ratelimit-limit'));
  assert.ok(res.headers.get('x-ratelimit-remaining'));
  assert.ok(res.headers.get('x-ratelimit-reset'));
});

test('GET /lookup for private IP skips RDAP (deterministic)', async () => {
  const ip = '192.168.0.1';
  const { res, json, text } = await getJson(`/lookup?ip=${encodeURIComponent(ip)}`);
  assert.equal(res.status, 200, text);

  assert.equal(json.ip, ip);
  assert.ok(json.ipClassification);
  assert.equal(json.ipClassification.public, false);

  // For non-public IPs we should not hit RDAP
  assert.equal(json.rdap, null);
  assert.equal(json.rdapSource, 'skipped');
});

test('GET /lookup for a real public IP returns RDAP', async () => {
  const ip = '1.1.1.1';
  const { res, json, text } = await getJson(`/lookup?ip=${encodeURIComponent(ip)}`);
  assert.equal(res.status, 200, text);

  assert.equal(json.ip, ip);
  assert.ok(json.ipClassification);
  assert.equal(json.ipClassification.public, true);

  // For public IPs we expect RDAP to be present (cache or live)
  assert.ok(json.rdap && typeof json.rdap === 'object');
  assert.ok(['cache', 'live'].includes(json.rdapSource), `rdapSource=${json.rdapSource}`);
});

test('GET /lookup rejects invalid ip with 400', async () => {
  const { res, json } = await getJson('/lookup?ip=not-an-ip');
  assert.equal(res.status, 400);
  assert.equal(json.error, 'request_failed');
  assert.match(json.message, /invalid/i);
});

test('CORS: request without Origin is allowed', async () => {
  const { res } = await getJson('/health');
  assert.equal(res.status, 200);
});

test('CORS: disallowed Origin gets 403', async () => {
  const { res, json } = await getJson('/health', {
    headers: {
      Origin: 'https://evil.example'
    }
  });
  assert.equal(res.status, 403);
  assert.equal(json.error, 'request_failed');
});
