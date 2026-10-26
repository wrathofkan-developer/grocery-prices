import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mapLocation, mapProduct, bannerName } from '../supabase/functions/kroger/normalize.js';
import { indexItem, analyzeEntry, unitLabel } from '../docs/logic.js';

// Shapes follow Kroger's public Locations and Products API responses (trimmed).
const location = {
  locationId: '70300022', storeNumber: '00022', divisionNumber: '703', chain: 'RALPHS', name: 'Ralphs - Pico',
  address: { addressLine1: '10861 W Pico Blvd', city: 'Los Angeles', state: 'CA', zipCode: '90064' },
  geolocation: { latitude: 34.0441, longitude: -118.4214 },
  hours: { timezone: 'America/Los_Angeles' },
};
const product = (o) => ({
  productId: o.id, upc: o.upc || '0001111060903', brand: o.brand || 'Kroger', description: o.name, categories: ['Dairy'],
  items: [{ itemId: o.id, size: o.size, soldBy: o.soldBy || 'UNIT', price: { regular: o.regular, promo: o.promo ?? 0 } }],
});

test('the shared parser copy matches src/normalize.js', async () => {
  const a = await readFile(new URL('../src/normalize.js', import.meta.url), 'utf8');
  const b = await readFile(new URL('../supabase/functions/_shared/normalize.js', import.meta.url), 'utf8');
  assert.equal(b, a, 'run: cp src/normalize.js supabase/functions/_shared/normalize.js');
});

test('Kroger location -> store row with banner, address, time zone', () => {
  const s = mapLocation(location, () => 'should-not-be-used');
  assert.deepEqual(s, {
    id: 'kroger-70300022', chain: 'kroger', banner: 'Ralphs', name: 'Ralphs - Pico',
    address: '10861 W Pico Blvd, Los Angeles, CA 90064', lat: 34.0441, lng: -118.4214,
    tz: 'America/Los_Angeles', store_code: '70300022', postal: '90064', source: 'kroger',
  });
  const noTz = mapLocation({ ...location, hours: {} }, () => 'America/Denver');
  assert.equal(noTz.tz, 'America/Denver', 'falls back to looking up the zone from coordinates');
  assert.equal(bannerName('KINGSOOPERS'), 'King Soopers');
  assert.equal(bannerName('FRED MEYER'), 'Fred Meyer');
  assert.equal(bannerName('SOMENEWBANNER'), 'Somenewbanner');
});

test('Kroger product: regular, sale, per-lb, no price', () => {
  const ctx = { storeId: 'kroger-70300022', today: '2026-10-26' };
  const eggs = mapProduct(product({ id: '0001111060903', name: 'Kroger® Grade A Large White Eggs', size: '1 dozen', regular: 3.49 }), ctx);
  assert.equal(eggs.kind, 'regular');
  assert.equal(eggs.price, 3.49);
  assert.deepEqual(eggs.stores, ['kroger-70300022']);
  assert.equal(eggs.valid_from, '2026-10-26');
  const egg = indexItem(eggs);
  assert.equal(unitLabel(egg.unit_price, egg), '$3.49/doz');

  const milk = mapProduct(product({ id: '2', name: 'Kroger® 2% Reduced Fat Milk', size: '1 gal', regular: 3.99, promo: 2.99 }), ctx);
  assert.equal(milk.kind, 'sale');
  assert.equal(milk.price, 2.99);
  assert.equal(milk.regular_price, 3.99);
  assert.equal(milk.unit_price.unit, 'fl_oz');

  const bananas = mapProduct(product({ id: '3', name: 'Banana', size: '1 lb', soldBy: 'WEIGHT', regular: 0.59 }), ctx);
  assert.equal(bananas.price_per, 'lb');

  assert.equal(mapProduct({ productId: '4', description: 'X', items: [{ price: { regular: 0, promo: 0 } }] }, ctx), null);
  assert.equal(mapProduct({ productId: '5', description: 'X', items: [{}] }, ctx), null);
});

test('Kroger items flow through the same matching as other stores', () => {
  const ctx = { storeId: 'kroger-70300022', today: '2026-10-26' };
  const stores = { 'kroger-70300022': { tz: 'America/Los_Angeles' } };
  const items = [
    product({ id: 'a', name: 'Kroger® Grade A Large White Eggs', size: '1 dozen', regular: 3.49 }),
    product({ id: 'b', name: 'Kroger® Egg Nog', size: '1 qt', regular: 2.99 }),
    product({ id: 'c', name: 'Simple Truth Organic® Cage Free Large Brown Eggs', size: '12 ct', regular: 5.49 }),
  ].map((p) => indexItem(mapProduct(p, ctx), stores));
  const a = analyzeEntry(items, { q: 'eggs', qty: 1 }, '2026-10-26');
  assert.deepEqual(a.active.map((i) => i.id).sort(), ['kroger-70300022-a', 'kroger-70300022-c']);
  assert.equal(a.chosen.id, 'kroger-70300022-a');
});

test('the app\'s parser copy matches src/normalize.js', async () => {
  const a = await readFile(new URL('../src/normalize.js', import.meta.url), 'utf8');
  const b = await readFile(new URL('../docs/normalize.js', import.meta.url), 'utf8');
  assert.equal(b, a, 'run: cp src/normalize.js docs/normalize.js');
});

test('"and" inside one product name is not two products ("Apple and Walnut Oatmeal" is oatmeal)', () => {
  const ctx = { storeId: 'kroger-70400351', today: '2026-10-26' };
  const items = [
    product({ id: 'o', name: 'Kroger® Raisin Apple and Walnut High Fiber Instant Oatmeal', size: '8 ct', regular: 2.19, promo: 1.79 }),
    product({ id: 'g', name: 'Gala Apples', size: '3 lb', regular: 4.99 }),
  ].map((p) => indexItem(mapProduct(p, ctx)));
  const a = analyzeEntry(items, { q: 'apples', qty: 1 }, '2026-10-26');
  assert.deepEqual(a.active.map((i) => i.id), ['kroger-70400351-g']);
  assert.equal(analyzeEntry(items, { q: 'oatmeal', qty: 1 }, '2026-10-26').chosen.id, 'kroger-70400351-o');
});
