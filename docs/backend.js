// Everything that talks to Supabase. When docs/config.js is empty the app
// runs from the static data files and this module reports `enabled = false`.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const enabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let sb = null;
async function client() {
  if (!enabled) throw new Error('Server not set up');
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  }
  return sb;
}

const fail = (error, what) => { if (error) throw new Error(`${what}: ${error.message}`); };

// ---------- sign-in ----------
export async function session() {
  if (!enabled) return null;
  const { data } = await (await client()).auth.getSession();
  return data.session || null;
}

export async function onAuthChange(cb) {
  if (!enabled) return;
  (await client()).auth.onAuthStateChange((_event, s) => cb(s));
}

/** Emails a one-tap sign-in link that brings you back to this page. */
export async function sendSignInLink(email) {
  const { error } = await (await client()).auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  fail(error, 'Sign-in email');
}

export async function signOut() {
  await (await client()).auth.signOut();
}

export async function myProfile(userId) {
  const { data } = await (await client()).from('profiles').select('display_name').eq('id', userId).maybeSingle();
  return data;
}

export async function saveProfile(userId, displayName) {
  const { error } = await (await client()).from('profiles').upsert({ id: userId, display_name: displayName });
  fail(error, 'Saving your name');
}

// ---------- stores and prices ----------

/** Stores within `miles`, nearest first: our stores plus Kroger-family stores. */
export async function nearbyStores(here, miles = 15) {
  const c = await client();
  const [own, kroger] = await Promise.all([
    c.rpc('stores_near', { p_lat: here.lat, p_lng: here.lng, p_miles: miles }),
    krogerStores(here, Math.min(miles, 25)).catch(() => []), // Kroger is optional
  ]);
  fail(own.error, 'Nearby stores');
  const byId = new Map(own.data.map((s) => [s.id, s]));
  for (const s of kroger) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()];
}

async function krogerStores(here, miles) {
  const r = await callKroger({ action: 'locations', lat: here.lat.toFixed(3), lng: here.lng.toFixed(3), miles });
  return r.stores || [];
}

/** Ad items for these stores. */
export async function adItems(storeIds) {
  if (!storeIds.length) return [];
  const c = await client();
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await c.from('ad_items').select('data').overlaps('stores', storeIds).range(from, from + page - 1);
    fail(error, 'Prices');
    out.push(...data.map((r) => r.data));
    if (data.length < page) break;
  }
  return out;
}

/** Prices friends added at these stores in the last `days` days (signed in only). */
export async function userPrices(storeIds, sinceIso) {
  if (!storeIds.length) return { rows: [], names: {} };
  const c = await client();
  const { data, error } = await c.from('user_prices')
    .select('id, user_id, store_id, item_name, price, per_lb, size_text, is_sale, photo_path, observed_on')
    .in('store_id', storeIds).gte('observed_on', sinceIso).order('observed_on', { ascending: false }).limit(2000);
  fail(error, 'Shared prices');
  const ids = [...new Set(data.map((r) => r.user_id))];
  const names = {};
  if (ids.length) {
    const p = await c.from('profiles').select('id, display_name').in('id', ids);
    for (const x of p.data || []) names[x.id] = x.display_name;
  }
  return { rows: data, names };
}

/** Kroger prices for one search term at up to 5 Kroger stores. */
export async function krogerProducts(term, storeIds) {
  const ids = storeIds.filter((id) => id.startsWith('kroger-')).slice(0, 5);
  if (!ids.length) return [];
  const r = await callKroger({ action: 'products', term, stores: ids.join(',') });
  return r.items || [];
}

async function callKroger(params) {
  const u = new URL(`${SUPABASE_URL}/functions/v1/kroger`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { apikey: SUPABASE_ANON_KEY } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Kroger ${r.status}`);
  return j;
}

// ---------- adding things ----------

export async function addStore({ name, banner, address, lat, lng, tz, userId }) {
  const c = await client();
  const row = {
    id: `user-${crypto.randomUUID()}`, chain: 'other', banner: banner || name, name, address: address || null,
    lat, lng, tz, source: 'user', created_by: userId,
  };
  const { error } = await c.from('stores').insert(row);
  fail(error, 'Adding the store');
  return { ...row, miles: 0 };
}

/** Shrink a phone photo to a reasonable upload (longest side 1600px, JPEG). */
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
    return blob ? { blob, ext: 'jpg', type: 'image/jpeg' } : null;
  } catch {
    return null; // a format the browser can't draw: upload the original
  }
}

export async function addPrice({ userId, storeId, itemName, price, perLb, sizeText, isSale, observedOn, photo }) {
  const c = await client();
  let photoPath = null;
  if (photo) {
    const small = await shrink(photo);
    const ext = small?.ext || (photo.name.split('.').pop() || 'jpg').toLowerCase();
    photoPath = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await c.storage.from('receipts').upload(photoPath, small?.blob || photo, { contentType: small?.type || photo.type || 'image/jpeg' });
    fail(error, 'Uploading the photo');
  }
  const { error } = await c.from('user_prices').insert({
    store_id: storeId, item_name: itemName, price, per_lb: perLb, size_text: sizeText || null,
    is_sale: isSale, observed_on: observedOn, photo_path: photoPath,
  });
  if (error && photoPath) await c.storage.from('receipts').remove([photoPath]);
  fail(error, 'Saving the price');
}

export async function deletePrice(id, photoPath) {
  const c = await client();
  const { error } = await c.from('user_prices').delete().eq('id', id);
  fail(error, 'Deleting');
  if (photoPath) await c.storage.from('receipts').remove([photoPath]);
}

/** A temporary link to a receipt photo (friends only). */
export async function photoUrl(path) {
  const { data, error } = await (await client()).storage.from('receipts').createSignedUrl(path, 3600);
  fail(error, 'Photo');
  return data.signedUrl;
}
