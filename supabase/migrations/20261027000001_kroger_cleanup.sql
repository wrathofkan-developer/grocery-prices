-- Kroger warehouses and delivery hubs were saved as stores (e.g. "Spoke Forecast",
-- IDs like 542FC807). Real stores have 8-digit numeric IDs. Remove the others,
-- unless a friend already added a price there.
delete from public.stores s
where s.source = 'kroger'
  and (s.id !~ '^kroger-[0-9]{8}$' or s.name ~* '\m(spoke|forecast|shed|unused|fulfillment|warehouse|distribution|ocado|cfc)\M')
  and not exists (select 1 from public.user_prices p where p.store_id = s.id);

-- Saved Kroger results were built with the old size reading ("1/2 gal" read as 2 gal)
-- and the old store list; clear them so the next lookup uses the fixes.
delete from public.kroger_cache;
