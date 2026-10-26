// Kroger family stores (Ralphs, Fred Meyer, King Soopers, ...) via Kroger's
// free public API. Runs on Supabase so the Kroger client secret never reaches
// the browser or phone.
//
//   GET ?action=locations&lat=34.05&lng=-118.43&miles=10  -> nearby stores (also saved to `stores`)
//   GET ?action=products&term=eggs&stores=kroger-70300022,kroger-70300031  -> priced items
//
// Results are cached in `kroger_cache` (stores 7 days, prices 12 hours) to stay
// well inside Kroger's daily call limits.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import tzlookup from 'npm:tz-lookup@6.1.25';
import { mapLocation, mapProduct } from './normalize.js';

const KROGER = 'https://api.kroger.com/v1';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const HOUR = 3600_000;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

class ApiError extends Error {
  constructor(message: string, public status = 500) { super(message); }
}

let token: string | null = null;
let tokenExpires = 0;
async function krogerToken(): Promise<string> {
  if (token && Date.now() < tokenExpires - 60_000) return token;
  const id = Deno.env.get('KROGER_CLIENT_ID');
  const secret = Deno.env.get('KROGER_CLIENT_SECRET');
  if (!id || !secret) throw new ApiError('Kroger is not set up yet (missing client ID/secret).', 503);
  const r = await fetch(`${KROGER}/connect/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=product.compact',
  });
  if (!r.ok) throw new ApiError(`Kroger sign-in failed (${r.status}). Check the client ID/secret.`, 502);
  const j = await r.json();
  token = j.access_token;
  tokenExpires = Date.now() + (Number(j.expires_in) || 1800) * 1000;
  return token!;
}

async function kroger(path: string, params: Record<string, string | number>) {
  const u = new URL(KROGER + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { Authorization: `Bearer ${await krogerToken()}`, Accept: 'application/json' } });
  if (r.status === 429) throw new ApiError('Kroger daily limit reached; try again later.', 429);
  if (!r.ok) throw new ApiError(`Kroger ${path} failed (${r.status})`, 502);
  return r.json();
}

async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const { data } = await db.from('kroger_cache').select('payload, fetched_at').eq('key', key).maybeSingle();
  if (data && Date.now() - new Date(data.fetched_at).getTime() < ttlMs) return data.payload as T;
  const payload = await fetcher();
  await db.from('kroger_cache').upsert({ key, payload, fetched_at: new Date().toISOString() });
  return payload;
}

function todayIn(tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function locations(p: URLSearchParams) {
  const lat = Number(p.get('lat'));
  const lng = Number(p.get('lng'));
  const miles = Math.min(Math.max(Number(p.get('miles')) || 10, 1), 50);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new ApiError('lat/lng required', 400);
  const key = `loc:${lat.toFixed(2)}:${lng.toFixed(2)}:${miles}`;
  const stores = await cached(key, 7 * 24 * HOUR, async () => {
    const j = await kroger('/locations', { 'filter.lat.near': lat, 'filter.lon.near': lng, 'filter.radiusInMiles': miles, 'filter.limit': 25 });
    const rows = (j.data || []).map((l: unknown) => mapLocation(l, tzlookup)).filter(Boolean);
    if (rows.length) {
      const { error } = await db.from('stores').upsert(rows.map((r: Record<string, unknown>) => ({ ...r, updated_at: new Date().toISOString() })));
      if (error) console.error('store upsert failed', error.message);
    }
    return rows;
  });
  return { stores };
}

async function products(p: URLSearchParams) {
  const term = String(p.get('term') || '').trim().toLowerCase().slice(0, 60);
  if (term.length < 2) throw new ApiError('term required', 400);
  const ids = String(p.get('stores') || '').split(',').map((s) => s.trim()).filter((s) => /^kroger-\d{5,10}$/.test(s)).slice(0, 5);
  if (!ids.length) return { items: [] };
  const { data: rows } = await db.from('stores').select('id, tz').in('id', ids);
  const tzOf = Object.fromEntries((rows || []).map((r) => [r.id, r.tz]));
  const items = [];
  for (const storeId of ids) {
    const loc = storeId.slice('kroger-'.length);
    const list = await cached(`prod:${loc}:${term}`, 12 * HOUR, async () => {
      const j = await kroger('/products', { 'filter.term': term, 'filter.locationId': loc, 'filter.limit': 25 });
      const today = todayIn(tzOf[storeId] || 'America/New_York');
      return (j.data || []).map((x: unknown) => mapProduct(x, { storeId, today })).filter(Boolean);
    });
    items.push(...list);
  }
  return { items };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const params = new URL(req.url).searchParams;
  try {
    const action = params.get('action');
    if (action === 'locations') return json(await locations(params));
    if (action === 'products') return json(await products(params));
    if (action === 'status') return json({ ok: true, kroger: Boolean(Deno.env.get('KROGER_CLIENT_ID')) });
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
