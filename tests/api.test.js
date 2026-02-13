import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Node 22 has fetch built-in.

function startStubRdapServer() {
  const server = http.createServer((req, res) => {
    // We just need to return *some* JSON for /ip/{ip}
    const url = new URL(req.url || '/', 'http://localhost');
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        objectClassName: 'ip network',
        path: url.pathname,
        handle: 'TEST-HANDLE',
        name: 'TEST-NET'
      })
    );
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}/ip/`,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}

function startApiServer({ port, rdapBaseUrl }) {
  const repoRoot = process.cwd();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'nettools-iplookup-test-'));

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      TRUST_PROXY: 'false',
      // Avoid CORS blocking in case we add Origin headers later.
      CORS_ALLOWLIST: 'https://nettools.im,https://www.nettools.im,http://127.0.0.1',
      SQLITE_PATH: path.join(dataDir, 'app.sqlite'),
      GEOIP_DB_DIR: path.join(dataDir, 'geoip'),
      RDAP_BASE_URL: rdapBaseUrl,
      RDAP_CACHE_TTL_SECONDS: '3600',
      RATE_LIMIT_DAILY: '24'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d.toString('utf-8')));
  child.stderr.on('data', (d) => (stderr += d.toString('utf-8')));

  async function waitReady() {
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      if (stdout.includes('iplookup listening on')) return;
      if (child.exitCode !== null) {
        throw new Error(`API exited early: code=${child.exitCode}\nstdout=${stdout}\nstderr=${stderr}`);
      }
      await delay(50);
    }
    throw new Error(`Timed out waiting for API to start.\nstdout=${stdout}\nstderr=${stderr}`);
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    waitReady,
    stop: async () => {
      child.kill('SIGTERM');
      await delay(50);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  };
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, json, text };
}

const externalBaseUrl = process.env.IPLOOKUP_BASE_URL;

if (externalBaseUrl) {
  // Smoke tests against a deployed environment (Jenkins post-deploy)
  test('deployed /health returns ok:true', async () => {
    const { res, json, text } = await getJson(`${externalBaseUrl.replace(/\/$/, '')}/health`);
    assert.equal(res.status, 200, text);
    assert.equal(json?.ok, true);
  });

  test('deployed /lookup returns an ip field and rate limit headers', async () => {
    const { res, json, text } = await getJson(`${externalBaseUrl.replace(/\/$/, '')}/lookup?ip=1.1.1.1`);
    assert.equal(res.status, 200, text);
    assert.equal(json?.ip, '1.1.1.1');

    assert.ok(res.headers.get('x-ratelimit-limit'));
    assert.ok(res.headers.get('x-ratelimit-remaining'));
    assert.ok(res.headers.get('x-ratelimit-reset'));
  });

  test('deployed /lookup rejects invalid ip', async () => {
    const { res, json } = await getJson(`${externalBaseUrl.replace(/\/$/, '')}/lookup?ip=not-an-ip`);
    assert.equal(res.status, 400);
    assert.equal(json?.error, 'request_failed');
  });
} else {
  // Local unit/integration tests (start the API server under test)
  test('local API basic behaviors', async (t) => {
    const rdap = await startStubRdapServer();

    // Pick a fixed port because our server.js doesn’t support PORT=0.
    // (We keep it simple and just use an unlikely local port.)
    const port = 43123;
    const api = startApiServer({ port, rdapBaseUrl: rdap.baseUrl });

    await api.waitReady();

    await t.test('/health returns ok:true', async () => {
      const { res, json, text } = await getJson(`${api.baseUrl}/health`);
      assert.equal(res.status, 200, text);
      assert.equal(json?.ok, true);
    });

    await t.test('/me returns an ip', async () => {
      const { res, json, text } = await getJson(`${api.baseUrl}/me`);
      assert.equal(res.status, 200, text);
      assert.ok(typeof json?.ip === 'string' || json?.ip === null);
    });

    await t.test('/lookup with ip=1.1.1.1 returns expected shape + headers', async () => {
      const { res, json, text } = await getJson(`${api.baseUrl}/lookup?ip=1.1.1.1`);
      assert.equal(res.status, 200, text);
      assert.equal(json?.ip, '1.1.1.1');
      assert.equal(json?.ipClassification?.public, true);

      assert.ok(['live', 'cache', 'skipped'].includes(json?.rdapSource));

      // Rate limit headers should always exist on /lookup
      assert.ok(res.headers.get('x-ratelimit-limit'));
      assert.ok(res.headers.get('x-ratelimit-remaining'));
      assert.ok(res.headers.get('x-ratelimit-reset'));
    });

    await t.test('/lookup with private ip skips rdap', async () => {
      const { res, json, text } = await getJson(`${api.baseUrl}/lookup?ip=192.168.1.1`);
      assert.equal(res.status, 200, text);
      assert.equal(json?.ip, '192.168.1.1');
      assert.equal(json?.ipClassification?.public, false);
      assert.equal(json?.rdapSource, 'skipped');
      assert.equal(json?.rdap, null);
    });

    await t.test('/lookup rejects invalid ip', async () => {
      const { res, json } = await getJson(`${api.baseUrl}/lookup?ip=not-an-ip`);
      assert.equal(res.status, 400);
      assert.equal(json?.error, 'request_failed');
    });

    await api.stop();
    await rdap.close();
  });
}
