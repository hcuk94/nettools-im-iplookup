#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ProxyAgent } from 'undici';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function parseNoProxy() {
  const raw = process.env.NO_PROXY || process.env.no_proxy || '';
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function hostMatchesNoProxy(host, noProxyList) {
  if (!host) return false;
  // NO_PROXY entries can be exact hosts, domains (.example.com), or '*' 
  return noProxyList.some(entry => {
    if (entry === '*') return true;
    if (entry.startsWith('.')) return host.endsWith(entry);
    return host === entry;
  });
}

function proxyForUrl(urlStr) {
  const u = new URL(urlStr);
  const noProxy = parseNoProxy();
  if (hostMatchesNoProxy(u.hostname, noProxy)) return null;

  // Prefer protocol-specific proxy env vars, supporting both cases
  if (u.protocol === 'https:') {
    return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null;
  }
  if (u.protocol === 'http:') {
    return process.env.HTTP_PROXY || process.env.http_proxy || null;
  }
  return null;
}

async function downloadToFile(url, outPath) {
  const proxy = proxyForUrl(url);
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;

  const res = await fetch(url, dispatcher ? { dispatcher } : undefined);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Download failed (${res.status}): ${body.slice(0, 300)}`);
  }

  await new Promise((resolve, reject) => {
    const file = fsSync.createWriteStream(outPath);
    res.body.pipeTo(
      new WritableStream({
        write(chunk) {
          file.write(Buffer.from(chunk));
        },
        close() {
          file.end();
          resolve();
        },
        abort(err) {
          reject(err);
        }
      })
    ).catch(reject);
  });
}

async function untar(tarPath, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  await new Promise((resolve, reject) => {
    const p = spawn('tar', ['-xzf', tarPath, '-C', destDir], { stdio: 'inherit' });
    p.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with ${code}`));
    });
  });
}

async function findMmdbFiles(rootDir) {
  const found = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && p.endsWith('.mmdb')) found.push(p);
    }
  }
  await walk(rootDir);
  return found;
}

async function updateOnce() {
  const licenseKey = mustEnv('MAXMIND_LICENSE_KEY');
  const editionIds = (process.env.MAXMIND_EDITION_IDS || 'GeoLite2-City,GeoLite2-ASN')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const dbDir = process.env.GEOIP_DB_DIR || '/data/geoip';
  await fs.mkdir(dbDir, { recursive: true });

  for (const editionId of editionIds) {
    const url = new URL('https://download.maxmind.com/app/geoip_download');
    url.searchParams.set('edition_id', editionId);
    url.searchParams.set('license_key', licenseKey);
    url.searchParams.set('suffix', 'tar.gz');

    const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'maxmind-'));
    const tarPath = path.join(tmpBase, `${editionId}.tar.gz`);
    const extractDir = path.join(tmpBase, 'extract');

    // eslint-disable-next-line no-console
    console.log(`Downloading ${editionId}...`);
    await downloadToFile(url.toString(), tarPath);

    // eslint-disable-next-line no-console
    console.log(`Extracting ${editionId}...`);
    await untar(tarPath, extractDir);

    const mmdbs = await findMmdbFiles(extractDir);
    if (mmdbs.length === 0) {
      throw new Error(`No .mmdb found in archive for ${editionId}`);
    }

    for (const file of mmdbs) {
      const base = path.basename(file);
      const dest = path.join(dbDir, base);
      await fs.copyFile(file, dest);
      // eslint-disable-next-line no-console
      console.log(`Updated ${dest}`);
    }

    await fs.rm(tmpBase, { recursive: true, force: true });
  }
}

async function main() {
  const loop = process.argv.includes('--loop');
  const intervalSeconds = Number(process.env.MAXMIND_UPDATE_INTERVAL_SECONDS || 86400);

  if (!loop) {
    await updateOnce();
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`Starting update loop; interval=${intervalSeconds}s`);
  // Run immediately, then sleep.
  for (;;) {
    try {
      await updateOnce();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    await sleep(intervalSeconds * 1000);
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
