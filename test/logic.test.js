import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexItem, analyzeEntry, estimate, oneStopTrips, nearestStore, tokens, unitLabel } from '../docs/logic.js';

const mk = (o) => indexItem({ kind: 'sale', brand: null, stores: [], unit_price: null, price_per: 'each', valid_to: '2026-10-27', valid_from: '2026-10-21', ...o });

const items = [
  mk({ id: 'sw-oat', chain: 'safeway', name: 'Oatly Oatmilk', price: 4.99, unit_price: { value: 4.99 / 64, unit: 'fl_oz' }, stores: ['safeway-3116'] }),
  mk({ id: 'tj-oat', chain: 'traderjoes', kind: 'regular', name: 'Oat Beverage', price: 2.99, unit_price: { value: 2.99 / 64, unit: 'fl_oz' }, valid_to: null, valid_from: '2026-10-23', stores: ['traderjoes-187'] }),
  mk({ id: 'sw-eggs', chain: 'safeway', name: 'Lucerne Large Eggs', price: 3.49, stores: ['safeway-3116'] }),
  mk({ id: 'sp-eggs-next', chain: 'sprouts', name: 'Sprouts Cage Free Eggs', price: 2.99, valid_from: '2026-10-28', valid_to: '2026-11-03', stores: ['sprouts-276'] }),
  mk({ id: 'sw-old', chain: 'safeway', name: 'Old Week Eggs', price: 0.99, valid_from: '2026-10-14', valid_to: '2026-10-20' }),
  mk({ id: 'sp-cheese', chain: 'sprouts', name: 'Kingston Creamery Blue Cheese', price: null, deal_text: 'In ad' }),
];
const today = '2026-10-23';

test('oat milk matches "Oatmilk" and "Oat Beverage"? only words that match', () => {
  const a = analyzeEntry(items, { q: 'oat milk', qty: 1 }, today);
  assert.deepEqual(a.active.map((i) => i.id), ['sw-oat']); // "Oat Beverage" lacks "milk"
  const b = analyzeEntry(items, { q: 'oat', qty: 1 }, today);
  assert.equal(b.best.id, 'tj-oat', 'cheaper per fl oz wins');
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
  const list = [{ q: 'oat', qty: 1 }, { q: 'eggs', qty: 2 }, { q: 'blue cheese', qty: 1 }];
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
  const a = analyzeEntry(items, { q: 'oat', qty: 1, pin: 'sw-oat' }, today);
  assert.equal(a.chosen.id, 'sw-oat');
});

test('nearest store and labels', () => {
  const byId = { a: { id: 'a', lat: 37.70, lng: -122.48 }, b: { id: 'b', lat: 37.65, lng: -122.45 } };
  assert.equal(nearestStore({ stores: ['a', 'b'] }, byId, { lat: 37.655, lng: -122.45 }).store.id, 'b');
  assert.deepEqual(tokens("Trader Joe's Eggs"), ['trader', 'joe', 'egg']);
  assert.equal(unitLabel({ value: 0.078, unit: 'fl_oz' }), '7.8¢/fl oz');
});
