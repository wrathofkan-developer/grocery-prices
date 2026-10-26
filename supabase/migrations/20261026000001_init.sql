-- Grocery Prices: shared database.
-- Ads and stores are readable by anyone (the app works signed out).
-- Prices people add are shared among signed-in users only.

-- ---------- stores ----------
create table if not exists public.stores (
  id          text primary key,                 -- 'safeway-3116', 'kroger-70300022', 'user-<uuid>'
  chain       text not null,                    -- safeway | traderjoes | sprouts | costco | kroger | other
  banner      text,                             -- 'Ralphs', 'Fred Meyer' (Kroger family), or a store's own chain name
  name        text not null,
  address     text,
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  tz          text not null default 'America/Los_Angeles',  -- ads switch at this store's local midnight
  store_code  text,
  postal      text,
  note        text,
  source      text not null default 'seed' check (source in ('seed', 'kroger', 'user')),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index if not exists stores_lat_lng on public.stores (lat, lng);
create index if not exists stores_chain on public.stores (chain);

-- Stores within `miles` of a point, nearest first.
create or replace function public.stores_near(p_lat double precision, p_lng double precision, p_miles double precision default 15)
returns table (
  id text, chain text, banner text, name text, address text, lat double precision, lng double precision,
  tz text, store_code text, postal text, note text, source text, miles double precision
)
language sql stable
set search_path = public
as $$
  select s.id, s.chain, s.banner, s.name, s.address, s.lat, s.lng, s.tz, s.store_code, s.postal, s.note, s.source,
         d.miles
  from public.stores s
  cross join lateral (
    select 3958.8 * 2 * asin(sqrt(
      power(sin(radians(s.lat - p_lat) / 2), 2) +
      cos(radians(p_lat)) * cos(radians(s.lat)) * power(sin(radians(s.lng - p_lng) / 2), 2)
    )) as miles
  ) d
  -- Cheap bounding box first (1 degree latitude ~ 69 miles).
  where s.lat between p_lat - p_miles / 69.0 and p_lat + p_miles / 69.0
    and s.lng between p_lng - p_miles / (69.0 * greatest(cos(radians(p_lat)), 0.01))
                  and p_lng + p_miles / (69.0 * greatest(cos(radians(p_lat)), 0.01))
    and d.miles <= p_miles
  order by d.miles
  limit 60;
$$;

-- ---------- ad items (from the store fetchers) ----------
create table if not exists public.ad_items (
  id          text primary key,
  chain       text not null,
  stores      text[] not null,
  valid_from  date,
  valid_to    date,
  data        jsonb not null,        -- the full normalized record the app uses
  fetched_at  timestamptz not null default now()
);
create index if not exists ad_items_stores on public.ad_items using gin (stores);
create index if not exists ad_items_chain on public.ad_items (chain);

-- Replace one chain's items in a single transaction (called by the sync job).
create or replace function public.replace_chain_items(p_chain text, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.ad_items where chain = p_chain;
  -- One row per id (a bad feed with a repeated id keeps its last copy instead of failing).
  insert into public.ad_items (id, chain, stores, valid_from, valid_to, data)
  select distinct on (x->>'id')
         x->>'id',
         p_chain,
         array(select jsonb_array_elements_text(coalesce(x->'stores', '[]'::jsonb))),
         nullif(x->>'valid_from', '')::date,
         nullif(x->>'valid_to', '')::date,
         x
  from jsonb_array_elements(p_items) with ordinality as e(x, ord)
  where x->>'id' is not null
  order by x->>'id', ord desc
  on conflict (id) do update set stores = excluded.stores, valid_from = excluded.valid_from,
    valid_to = excluded.valid_to, data = excluded.data, fetched_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.replace_chain_items(text, jsonb) from public, anon, authenticated;

-- ---------- people ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  created_at    timestamptz not null default now()
);

-- ---------- prices people add ----------
create table if not exists public.user_prices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  store_id     text not null references public.stores (id) on delete cascade,
  item_name    text not null check (char_length(item_name) between 1 and 120),
  price        numeric(10, 2) not null check (price > 0 and price < 10000),
  per_lb       boolean not null default false,
  size_text    text check (size_text is null or char_length(size_text) <= 40),
  is_sale      boolean not null default false,
  photo_path   text,
  observed_on  date not null,
  created_at   timestamptz not null default now()
);
create index if not exists user_prices_store on public.user_prices (store_id, observed_on desc);

-- ---------- Kroger cache (edge function only) ----------
create table if not exists public.kroger_cache (
  key         text primary key,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now()
);

-- ---------- row-level security ----------
alter table public.stores       enable row level security;
alter table public.ad_items     enable row level security;
alter table public.profiles     enable row level security;
alter table public.user_prices  enable row level security;
alter table public.kroger_cache enable row level security;   -- no policies: service role only

drop policy if exists "stores readable by all" on public.stores;
create policy "stores readable by all" on public.stores for select using (true);

drop policy if exists "signed-in users add stores" on public.stores;
create policy "signed-in users add stores" on public.stores for insert to authenticated
  with check (source = 'user' and created_by = auth.uid() and id like 'user-%');

drop policy if exists "ads readable by all" on public.ad_items;
create policy "ads readable by all" on public.ad_items for select using (true);

drop policy if exists "profiles readable when signed in" on public.profiles;
create policy "profiles readable when signed in" on public.profiles for select to authenticated using (true);

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "prices readable when signed in" on public.user_prices;
create policy "prices readable when signed in" on public.user_prices for select to authenticated using (true);

drop policy if exists "own prices insert" on public.user_prices;
create policy "own prices insert" on public.user_prices for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "own prices delete" on public.user_prices;
create policy "own prices delete" on public.user_prices for delete to authenticated using (user_id = auth.uid());

grant select on public.stores, public.ad_items to anon, authenticated;
grant insert on public.stores to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.user_prices to authenticated;
grant execute on function public.stores_near(double precision, double precision, double precision) to anon, authenticated;
