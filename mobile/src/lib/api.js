// Talks to the shared Supabase database and the Kroger function.
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, PAGES_BASE } from './shared';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

const fail = (error, what) => { if (error) throw new Error(`${what}: ${error.message}`); };

async function callKroger(params) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  const r = await fetch(`${SUPABASE_URL}/functions/v1/kroger?${qs}`, { headers: { apikey: SUPABASE_ANON_KEY } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Kroger ${r.status}`);
  return j;
}

/** Stores within `miles`, nearest first: our stores plus Kroger-family stores. */
export async function nearbyStores(here, miles = 15) {
  const [own, kroger] = await Promise.all([
    supabase.rpc('stores_near', { p_lat: here.lat, p_lng: here.lng, p_miles: miles }),
    callKroger({ action: 'locations', lat: here.lat.toFixed(3), lng: here.lng.toFixed(3), miles: Math.min(miles, 15) })
      .then((r) => r.stores || []).catch(() => []), // Kroger is optional
  ]);
  fail(own.error, 'Nearby stores');
  const byId = new Map(own.data.map((s) => [s.id, s]));
  for (const s of kroger) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()];
}

/** This week's ad and shelf items for these stores. */
export async function adItems(storeIds) {
  if (!storeIds.length) return [];
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.from('ad_items').select('data').overlaps('stores', storeIds).range(from, from + page - 1);
    fail(error, 'Prices');
    out.push(...data.map((r) => r.data));
    if (data.length < page) break;
  }
  return out;
}

/** Kroger prices for one search term at up to 5 Kroger stores. */
export async function krogerProducts(term, storeIds) {
  const ids = storeIds.filter((id) => id.startsWith('kroger-')).slice(0, 5);
  if (!ids.length) return [];
  const r = await callKroger({ action: 'products', term, stores: ids.join(',') });
  return r.items || [];
}

/** ZIP -> map point, from the files published with the web app. */
export async function zipToPoint(zip) {
  const r = await fetch(`${PAGES_BASE}/data/zip/${zip.slice(0, 3)}.json`);
  if (!r.ok) return null;
  const hit = (await r.json())[zip];
  return hit ? { lat: hit[0], lng: hit[1] } : null;
}

/** When each store's prices were last updated. */
export async function updateStatus(chains) {
  const res = await Promise.allSettled(chains.map((c) => fetch(`${PAGES_BASE}/data/status/${c}.json`).then((r) => (r.ok ? r.json() : null))));
  return Object.fromEntries(chains.map((c, i) => [c, res[i].status === 'fulfilled' ? res[i].value : null]));
}
