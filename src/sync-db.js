// Copy the fetched data files into Supabase:
//   docs/data/stores.json      -> stores (upsert; Kroger and user-added stores are left alone)
//   docs/data/<chain>.json     -> ad_items (each chain replaced in one transaction)
// Needs SUPABASE_SERVICE_ROLE_KEY. The URL comes from SUPABASE_URL or docs/config.js.
// Usage: node src/sync-db.js [chain ...]

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'docs', 'data');
const CHAINS = ['safeway', 'traderjoes', 'costco', 'sprouts'];

export async function supabaseUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/$/, '');
  const cfg = await readFile(path.join(ROOT, 'docs', 'config.js'), 'utf8');
  return ((cfg.match(/SUPABASE_URL\s*=\s*'([^']*)'/) || [])[1] || '').replace(/\/$/, '');
}

function headers(key) {
  const h = { apikey: key, 'Content-Type': 'application/json' };
  // Legacy service_role keys are JWTs; new "sb_secret_" keys go in apikey only.
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

export function storeRows(stores) {
  return stores.map((s) => ({
    id: s.id,
    chain: s.chain,
    banner: s.banner || null,
    name: s.name,
    address: s.address || null,
    lat: s.lat,
    lng: s.lng,
    tz: s.tz || 'America/Los_Angeles',
    store_code: s.storeCode || null,
    postal: s.postal || null,
    note: s.note || null,
    source: 'seed',
    updated_at: new Date().toISOString(),
  }));
}

async function post(url, key, pathAndQuery, body, extra = {}) {
  const r = await fetch(`${url}${pathAndQuery}`, { method: 'POST', headers: { ...headers(key), ...extra }, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${pathAndQuery} -> HTTP ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = await supabaseUrl();
  if (!key || !url) {
    console.log('Supabase not configured (SUPABASE_SERVICE_ROLE_KEY or URL missing); skipping database sync.');
    return;
  }
  const chains = process.argv.slice(2).length ? process.argv.slice(2) : CHAINS;

  const { stores } = JSON.parse(await readFile(path.join(DATA, 'stores.json'), 'utf8'));
  await post(url, key, '/rest/v1/stores?on_conflict=id', storeRows(stores), { Prefer: 'resolution=merge-duplicates,return=minimal' });
  console.log(`✓ stores: ${stores.length}`);

  let failed = 0;
  for (const chain of chains) {
    let file;
    try { file = JSON.parse(await readFile(path.join(DATA, `${chain}.json`), 'utf8')); } catch { console.log(`- ${chain}: no data file`); continue; }
    try {
      const n = await post(url, key, '/rest/v1/rpc/replace_chain_items', { p_chain: chain, p_items: file.items });
      console.log(`✓ ${chain}: ${n} items`);
    } catch (e) {
      failed++;
      console.error(`✗ ${chain}: ${e.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
