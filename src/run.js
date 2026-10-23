// Usage: node src/run.js [safeway] [traderjoes] [costco] [sprouts]
// Writes docs/data/<chain>.json and docs/data/status/<chain>.json.
// If a store fails, its previous data file is left untouched, so the app keeps
// working on the last good fetch (and already-fetched upcoming ads still
// switch on by date).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { todayPT, priceStatus } from './dates.js';
import { redact } from './http.js';
import { fetchSafeway } from './fetchers/safeway.js';
import { fetchTraderJoes } from './fetchers/traderjoes.js';
import { fetchCostco } from './fetchers/costco.js';
import { fetchSprouts } from './fetchers/sprouts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'docs', 'data');
const FETCHERS = { safeway: fetchSafeway, traderjoes: fetchTraderJoes, costco: fetchCostco, sprouts: fetchSprouts };

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

export async function runChain(chain, allStores, runner = process.env.FETCH_RUNNER || 'local') {
  const stores = allStores.filter((s) => s.chain === chain);
  const started = new Date().toISOString();
  try {
    const { ads, items } = await FETCHERS[chain](stores);
    const today = todayPT();
    // Drop anything already over; keep active and upcoming.
    const kept = items.filter((i) => priceStatus(i, today) !== 'expired');
    const out = { chain, fetched_at: started, fetched_on_pt: today, runner, ads, items: kept };
    await writeFile(path.join(DATA, `${chain}.json`), JSON.stringify(out) + '\n');
    const counts = {
      active: kept.filter((i) => priceStatus(i, today) === 'active').length,
      upcoming: kept.filter((i) => priceStatus(i, today) === 'upcoming').length,
      priced: kept.filter((i) => i.price != null).length,
    };
    return { chain, ok: true, at: started, runner, items: kept.length, ...counts, ads: ads.map(({ id, name, valid_from, valid_to, posted }) => ({ id, name, valid_from, valid_to, posted })) };
  } catch (e) {
    return { chain, ok: false, at: started, runner, error: redact(e.message), blocked: Boolean(e.blocked) };
  }
}

async function main() {
  const chains = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FETCHERS);
  const { stores } = await readJson(path.join(DATA, 'stores.json'), { stores: [] });
  await mkdir(path.join(DATA, 'status'), { recursive: true });
  let failed = 0;
  for (const chain of chains) {
    if (!FETCHERS[chain]) { console.error(`Unknown chain: ${chain}`); failed++; continue; }
    const r = await runChain(chain, stores);
    // One status file per chain, so GitHub and the Windows PC never edit the same file.
    const statusFile = path.join(DATA, 'status', `${chain}.json`);
    const prev = await readJson(statusFile, {});
    const next = r.ok ? { ...r, last_error: null } : { ...prev, chain, last_error: r };
    await writeFile(statusFile, JSON.stringify(next, null, 2) + '\n');
    console.log(r.ok ? `✓ ${chain}: ${r.items} items (${r.active} active, ${r.upcoming} upcoming)` : `✗ ${chain}: ${r.error}`);
    if (!r.ok) failed++;
  }
  if (failed === chains.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
