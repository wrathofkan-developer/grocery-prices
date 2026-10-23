import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexItem, analyzeEntry, estimate, oneStopTrips, nearestStore, tokens, unitLabel, suggest } from '../docs/logic.js';

const mk = (o) => indexItem({ kind: 'sale', brand: null, stores: [], unit_price: null, price_per: 'each', valid_to: '2026-10-27', valid_from: '2026-10-21', ...o });

const items = [
  mk({ id: 'sw-oat', chain: 'safeway', name: 'Oatly Oatmilk', price: 4.99, unit_price: { value: 4.99 / 64, unit: 'fl_oz' }, stores: ['safeway-3116'] }),
  mk({ id: 'tj-oat', chain: 'traderjoes', kind: 'regular', name: 'Oat Milk', price: 2.99, unit_price: { value: 2.99 / 64, unit: 'fl_oz' }, valid_to: null, valid_from: '2026-10-23', stores: ['traderjoes-187'] }),
  mk({ id: 'sw-eggs', chain: 'safeway', name: 'Lucerne Large Eggs', price: 3.49, stores: ['safeway-3116'] }),
  mk({ id: 'sp-eggs-next', chain: 'sprouts', name: 'Sprouts Cage Free Eggs', price: 2.99, valid_from: '2026-10-28', valid_to: '2026-11-03', stores: ['sprouts-276'] }),
  mk({ id: 'sw-old', chain: 'safeway', name: 'Old Week Eggs', price: 0.99, valid_from: '2026-10-14', valid_to: '2026-10-20' }),
  mk({ id: 'sp-cheese', chain: 'sprouts', name: 'Kingston Creamery Blue Cheese', price: null, deal_text: 'In ad' }),
];
const today = '2026-10-23';

test('plain "oat milk" matches "Oatly Oatmilk" and "Oat Milk"; cheaper per fl oz wins', () => {
  const a = analyzeEntry(items, { q: 'oat milk', qty: 1 }, today);
  assert.deepEqual(a.active.map((i) => i.id), ['tj-oat', 'sw-oat']);
  assert.equal(a.best.id, 'tj-oat');
});

test('plain "eggs" means items that ARE eggs', () => {
  const pool = [
    mk({ id: 'nog', chain: 'traderjoes', name: 'Egg Nog', price: 3.99 }),
    mk({ id: 'eggo', chain: 'safeway', name: "Kellogg's Eggo Waffles", price: 4.99 }),
    mk({ id: 'plant', chain: 'traderjoes', name: 'Eggplant Garlic Spread', price: 3.49 }),
    mk({ id: 'salad', chain: 'traderjoes', name: 'Egg Salad', price: 4.99 }),
    mk({ id: 'real', chain: 'safeway', name: 'Lucerne Large Eggs 18-ct.', price: 5.49 }),
    mk({ id: 'yog', chain: 'traderjoes', name: 'Plain Whole Milk Greek Yogurt', price: 0.99 }),
    mk({ id: 'milk', chain: 'safeway', name: 'Nature Valley Bars 5 to 6-ct. Lucerne® Milk Half gallon. Chex Cereal', price: 1.99 }),
  ];
  assert.deepEqual(analyzeEntry(pool, { q: 'eggs', qty: 1 }, today).active.map((i) => i.id), ['real']);
  assert.deepEqual(analyzeEntry(pool, { q: 'milk', qty: 1 }, today).active.map((i) => i.id), ['milk']);
  // Picking the specific product compares that product across stores.
  assert.deepEqual(analyzeEntry(pool, { q: 'Egg Nog', mode: 'product', qty: 1 }, today).active.map((i) => i.id), ['nog']);
});

test('suggestions: plain item first, then products containing the text', () => {
  const pool = [
    mk({ id: 'nog', chain: 'traderjoes', name: 'Egg Nog', price: 3.99 }),
    mk({ id: 'eggo', chain: 'safeway', name: "Kellogg's Eggo Waffles", price: 4.99 }),
    mk({ id: 'real', chain: 'safeway', name: 'Lucerne Large Eggs', price: 5.49 }),
  ];
  const s = suggest(pool, 'egg', today);
  assert.equal(s[0].type, 'generic');
  assert.equal(s[0].q, 'eggs');
  assert.equal(s[0].low, 5.49);
  const products = s.filter((x) => x.type === 'product').map((x) => x.label);
  assert.ok(products.includes('Egg Nog'));
  assert.ok(products.includes("Kellogg's Eggo Waffles"));
  assert.ok(products.indexOf('Egg Nog') < products.indexOf("Kellogg's Eggo Waffles"), 'whole word before partial');
  // Something not in the staples list is still offered as typed.
  assert.equal(suggest(pool, 'gochujang', today)[0].q, 'gochujang');
});

test('expired ad prices are ignored; upcoming ones are flagged, not used', () => {
  const a = analyzeEntry(items, { q: 'eggs', qty: 2 }, today);
  assert.deepEqual(a.active.map((i) => i.id), ['sw-eggs']);
  assert.equal(a.chosen.id, 'sw-eggs');
  assert.equal(a.soon.id, 'sp-eggs-next');
  // On the start date the upcoming price becomes active automatically.
  const later = analyzeEntry(items, { q: 'eggs', qty: 2 }, '2026-10-28');
  assert.equal(later.chosen.id, 'sp-eggs-next');
});

test('estimate and one-stop trips', () => {
  const list = [{ q: 'oat milk', qty: 1 }, { q: 'eggs', qty: 2 }, { q: 'blue cheese', qty: 1 }];
  const an = list.map((e) => analyzeEntry(items, e, today));
  const est = estimate(an, list);
  assert.equal(est.total, 2.99 + 2 * 3.49);
  assert.equal(est.priced, 2);
  const trips = oneStopTrips(an, list);
  assert.equal(trips[0].chain, 'safeway');
  assert.equal(trips[0].covered, 2);
  assert.equal(trips[0].total, 4.99 + 6.98);
});

test('pinned choice overrides cheapest', () => {
  const a = analyzeEntry(items, { q: 'oat milk', qty: 1, pin: 'sw-oat' }, today);
  assert.equal(a.chosen.id, 'sw-oat');
});

test('nearest store and labels', () => {
  const byId = { a: { id: 'a', lat: 37.70, lng: -122.48 }, b: { id: 'b', lat: 37.65, lng: -122.45 } };
  assert.equal(nearestStore({ stores: ['a', 'b'] }, byId, { lat: 37.655, lng: -122.45 }).store.id, 'b');
  assert.deepEqual(tokens("Trader Joe's Eggs"), ['trader', 'joe', 'egg']);
  assert.equal(unitLabel({ value: 0.078, unit: 'fl_oz' }), '7.8¢/fl oz');
});

test('plain items pick the basic version first', () => {
  const pool = [
    mk({ id: 'jammy', chain: 'traderjoes', name: 'Chino Valley Ranchers The Jammy Egg', price: 3.99 }),
    mk({ id: 'carton', chain: 'traderjoes', name: 'Pasture Raised Large Brown Eggs', price: 5.99 }),
    mk({ id: 'pb', chain: 'traderjoes', name: 'Peanut Butter with Honey', price: 2.99 }),
    mk({ id: 'butter', chain: 'traderjoes', name: 'Danish Creamery Butter', price: 3.99 }),
    mk({ id: 'nosalt', chain: 'traderjoes', name: 'Almond Butter Creamy No Salt', price: 6.49 }),
    mk({ id: 'salt', chain: 'traderjoes', name: 'Sea Salt', price: 1.99 }),
    mk({ id: 'thigh', chain: 'traderjoes', name: 'All Natural Bone-In Skin-On Chicken Thighs', price: 2.29, price_per: 'lb' }),
    mk({ id: 'asado', chain: 'traderjoes', name: 'Pollo Asado Chicken Thighs', price: 1.99, price_per: 'lb' }),
    mk({ id: 'tuna', chain: 'safeway', name: 'Tuna in Olive Oil', price: 2.49 }),
    mk({ id: 'oil', chain: 'safeway', name: 'Extra Virgin Olive Oil', price: 8.99 }),
  ];
  const first = (q) => analyzeEntry(pool, { q, qty: 1 }, today).chosen?.id;
  assert.equal(first('eggs'), 'carton', 'carton beats cheaper Jammy Egg');
  assert.equal(first('butter'), 'butter', 'peanut butter is a different product');
  assert.equal(first('salt'), 'salt');
  assert.ok(!analyzeEntry(pool, { q: 'salt', qty: 1 }, today).active.some((i) => i.id === 'nosalt'), '"No Salt" is not salt');
  assert.equal(first('chicken thighs'), 'thigh', '"Bone-In" is not a split point; plain beats seasoned');
  assert.equal(first('olive oil'), 'oil', '"Tuna in Olive Oil" is tuna');
  assert.equal(first('peanut butter'), 'pb');
});

test('cut/form words: "Walnut Halves & Pieces" is walnuts', () => {
  const pool = [
    mk({ id: 'wh', chain: 'sprouts', name: 'Walnut Halves & Pieces', price: 5.99 }),
    mk({ id: 'wb', chain: 'traderjoes', name: 'California Walnut Baking Pieces', price: 6.49 }),
    mk({ id: 'ws', chain: 'traderjoes', name: 'Honey Walnut Shrimp', price: 6.99 }),
  ];
  assert.deepEqual(analyzeEntry(pool, { q: 'walnuts', qty: 1 }, today).active.map((i) => i.id).sort(), ['wb', 'wh']);
});
