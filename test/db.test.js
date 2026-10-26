// Runs the Supabase migrations in PGlite (real Postgres compiled to WASM) with
// small stand-ins for Supabase's auth and storage schemas, then checks the
// functions and the row-level security rules.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();

const SUPABASE_STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant usage on schema public to anon, authenticated, service_role;
`;

const MIKEY = '11111111-1111-1111-1111-111111111111';
const FRIEND = '22222222-2222-2222-2222-222222222222';

async function as(role, uid, fn) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid || ''}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

before(async () => {
  await db.exec(SUPABASE_STUBS);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(f, dir), 'utf8'));
  }
  await db.exec(`
    insert into auth.users values ('${MIKEY}', 'm@example.com'), ('${FRIEND}', 'f@example.com');
    insert into public.stores (id, chain, name, lat, lng, tz) values
      ('safeway-3116', 'safeway', 'Safeway Gellert', 37.64659, -122.45203, 'America/Los_Angeles'),
      ('sprouts-276',  'sprouts', 'Sprouts Daly City', 37.66884, -122.46696, 'America/Los_Angeles'),
      ('costco-422',   'costco',  'Costco South SF', 37.64221, -122.40102, 'America/Los_Angeles'),
      ('kroger-1',     'kroger',  'Ralphs Pico', 34.0450, -118.4300, 'America/Los_Angeles');
  `);
});

test('stores_near finds nearby stores, nearest first, and skips far ones', async () => {
  const { rows } = await db.query(`select id, round(miles::numeric, 1) as mi from public.stores_near(37.6547, -122.4508, 5)`);
  assert.deepEqual(rows.map((r) => r.id), ['safeway-3116', 'sprouts-276', 'costco-422']);
  assert.ok(Number(rows[0].mi) < 1);
  const la = await db.query(`select id from public.stores_near(34.05, -118.43, 5)`);
  assert.deepEqual(la.rows.map((r) => r.id), ['kroger-1']);
});

test('replace_chain_items swaps a chain atomically and anon can read', async () => {
  const items = [
    { id: 'safeway-1', chain: 'safeway', stores: ['safeway-3116'], valid_from: '2026-10-21', valid_to: '2026-10-27', name: 'Oatly Oatmilk', price: 4.99 },
    { id: 'safeway-2', chain: 'safeway', stores: ['safeway-3116'], valid_from: '2026-10-21', valid_to: '2026-10-27', name: 'Bananas', price: 0.59 },
  ];
  const r = await db.query(`select public.replace_chain_items('safeway', $1::jsonb) as n`, [JSON.stringify(items)]);
  assert.equal(r.rows[0].n, 2);
  await db.query(`select public.replace_chain_items('safeway', $1::jsonb)`, [JSON.stringify(items.slice(0, 1))]);
  const anonRead = await as('anon', null, () => db.query(`select id from public.ad_items where stores && array['safeway-3116']`));
  assert.deepEqual(anonRead.rows.map((x) => x.id), ['safeway-1']);
  // Only the sync job (service role) may replace items.
  await assert.rejects(as('anon', null, () => db.query(`select public.replace_chain_items('safeway', '[]'::jsonb)`)));
});

test('shared prices: signed-in friends see them, signed-out visitors do not', async () => {
  await as('authenticated', MIKEY, () => db.query(
    `insert into public.user_prices (store_id, item_name, price, observed_on, photo_path) values ('sprouts-276', 'eggs', 5.49, '2026-10-26', '${MIKEY}/a.jpg')`));
  const friend = await as('authenticated', FRIEND, () => db.query(`select item_name, price, user_id from public.user_prices`));
  assert.equal(friend.rows.length, 1);
  assert.equal(friend.rows[0].user_id, MIKEY, 'user_id defaults to the signed-in user');
  const anon = await as('anon', null, () => db.query(`select * from public.user_prices`).catch(() => ({ rows: 'denied' })));
  assert.ok(anon.rows === 'denied' || anon.rows.length === 0);
});

test('nobody can post a price as someone else, or delete a friend\'s price', async () => {
  await assert.rejects(as('authenticated', FRIEND, () => db.query(
    `insert into public.user_prices (user_id, store_id, item_name, price, observed_on) values ('${MIKEY}', 'sprouts-276', 'milk', 3.99, '2026-10-26')`)));
  const del = await as('authenticated', FRIEND, () => db.query(`delete from public.user_prices where user_id = '${MIKEY}' returning id`));
  assert.equal(del.rows.length, 0);
  const own = await as('authenticated', MIKEY, () => db.query(`delete from public.user_prices where user_id = '${MIKEY}' returning id`));
  assert.equal(own.rows.length, 1);
});

test('signed-in users can add a store; only as a user store, credited to themselves', async () => {
  await as('authenticated', MIKEY, () => db.query(
    `insert into public.stores (id, chain, banner, name, lat, lng, source, created_by) values ('user-abc', 'other', 'Grocery Outlet', 'Grocery Outlet Daly City', 37.70, -122.47, 'user', '${MIKEY}')`));
  await assert.rejects(as('authenticated', MIKEY, () => db.query(
    `insert into public.stores (id, chain, name, lat, lng, source, created_by) values ('safeway-999', 'safeway', 'Fake', 37.7, -122.4, 'seed', '${MIKEY}')`)));
  await assert.rejects(as('anon', null, () => db.query(
    `insert into public.stores (id, chain, name, lat, lng, source) values ('user-x', 'other', 'X', 37.7, -122.4, 'user')`)));
});

test('receipt photos: upload only into your own folder', async () => {
  await as('authenticated', MIKEY, () => db.query(`insert into storage.objects (bucket_id, name) values ('receipts', '${MIKEY}/r1.jpg')`));
  await assert.rejects(as('authenticated', MIKEY, () => db.query(`insert into storage.objects (bucket_id, name) values ('receipts', '${FRIEND}/r2.jpg')`)));
  const seen = await as('authenticated', FRIEND, () => db.query(`select name from storage.objects where bucket_id = 'receipts'`));
  assert.equal(seen.rows.length, 1, 'friends can view receipt photos');
});

test('profiles: set your own name only', async () => {
  await as('authenticated', MIKEY, () => db.query(`insert into public.profiles (id, display_name) values ('${MIKEY}', 'Mikey')`));
  await assert.rejects(as('authenticated', MIKEY, () => db.query(`insert into public.profiles (id, display_name) values ('${FRIEND}', 'Imposter')`)));
});

test('kroger cache is not readable by the app', async () => {
  await db.exec(`insert into public.kroger_cache (key, payload) values ('k', '{}')`);
  const r = await as('anon', null, () => db.query(`select * from public.kroger_cache`).catch(() => ({ rows: 'denied' })));
  assert.ok(r.rows === 'denied' || r.rows.length === 0);
});

test('this week\'s real data files load into the database', async () => {
  const { storeRows } = await import('../src/sync-db.js');
  const { stores } = JSON.parse(await readFile(new URL('../docs/data/stores.json', import.meta.url), 'utf8'));
  for (const r of storeRows(stores)) {
    await db.query(
      `insert into public.stores (id, chain, banner, name, address, lat, lng, tz, store_code, postal, note, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (id) do update set name = excluded.name`,
      [r.id, r.chain, r.banner, r.name, r.address, r.lat, r.lng, r.tz, r.store_code, r.postal, r.note, r.source]);
  }
  for (const chain of ['safeway', 'traderjoes', 'costco', 'sprouts']) {
    const file = JSON.parse(await readFile(new URL(`../docs/data/${chain}.json`, import.meta.url), 'utf8'));
    const { rows } = await db.query(`select public.replace_chain_items($1, $2::jsonb) as n`, [chain, JSON.stringify(file.items)]);
    const ids = new Set(file.items.map((i) => i.id));
    assert.equal(rows[0].n, ids.size, `${chain}: every item stored`);
  }
  const near = await db.query(`select s.id from public.stores_near(37.6547, -122.4508, 15) s`);
  const ids = near.rows.map((r) => r.id);
  const { rows } = await db.query(`select count(*)::int as n from public.ad_items where stores && $1::text[]`, [ids]);
  assert.ok(rows[0].n > 1500, `nearby stores have ${rows[0].n} priced items`);
});
