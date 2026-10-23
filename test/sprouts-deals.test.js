import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMultiBuy, multiBuyCost } from '../src/normalize.js';
import { parseCollectionProducts } from '../src/fetchers/sprouts.js';
import { lineCost, indexItem, estimate, analyzeEntry } from '../docs/logic.js';

// Shapes copied from Sprouts' CollectionProducts response (trimmed to the fields we read).
const item = (o) => ({
  id: `items_19462-${o.productId}`, productId: o.productId, name: o.name, size: o.size, brandName: o.brand || '',
  evergreenUrl: o.url,
  price: { viewSection: {
    priceString: `$${o.price}`, priceValueString: String(o.price), fullPriceString: o.full ? `$${o.full}` : null,
    badge: o.offer ? { offerLabelString: o.offer } : null,
    itemDetails: { pricingUnitString: o.unit || o.size, fullPriceString: o.full ? `$${o.full}` : null },
  } },
});
const panel = (...items) => ({ data: { collectionProducts: { items } } });
const tile = { stores: ['sprouts-276'], valid_from: '2026-10-21', valid_to: '2026-10-27', ad_id: 'w', ad_name: 'Weekly Ad', ad_item: 'Cuties Seedless Mandarins 3lb. Bag or Organic Rockit Apples 3lb. Tub', url: 'x' };

test('deal labels', () => {
  assert.deepEqual(parseMultiBuy('Buy 1, get 1 50% off'), { buy: 1, get: 1, pct: 50 });
  assert.deepEqual(parseMultiBuy('Buy 1, get 1 free'), { buy: 1, get: 1, pct: 100 });
  assert.deepEqual(parseMultiBuy('Buy 2 get 1 free'), { buy: 2, get: 1, pct: 100 });
  assert.equal(parseMultiBuy('35% off'), null);
  assert.equal(multiBuyCost(9.99, 2, { buy: 1, get: 1, pct: 50 }), 9.99 + 4.995);
});

test('buy 1 get 1 50% off: price after deal, plus one unit before it', () => {
  const [r] = parseCollectionProducts(panel(item({ productId: '23021684', name: 'Organic Rockit Apples Tub', size: '3 lb', price: 9.99, offer: 'Buy 1, get 1 50% off', url: '23021684-organic-rockit-apples' })), tile);
  assert.equal(r.price, 7.49, 'per unit when buying 2: (9.99 + 4.995) / 2 = 7.4925');
  assert.equal(r.regular_price, 9.99, 'one unit before the deal');
  assert.deepEqual(r.promo, { buy: 1, get: 1, pct: 50 });
  assert.equal(r.deal_text, 'Buy 1, get 1 50% off');
  assert.equal(r.url, 'https://shop.sprouts.com/store/sprouts/products/23021684-organic-rockit-apples');
  assert.equal(r.valid_from, '2026-10-21');
  assert.equal(r.unit_price.unit, 'oz');
  // Totals follow the deal exactly.
  const it = indexItem(r);
  assert.equal(lineCost(it, 1), 9.99, '1 unit does not qualify');
  assert.equal(lineCost(it, 2), 14.99, '9.99 + 4.995');
  assert.equal(lineCost(it, 3), 24.98, 'one pair + one single');
});

test('buy 1 get 1 free', () => {
  const [r] = parseCollectionProducts(panel(item({ productId: '1', name: 'Katz Gluten Free Glazed Donut Holes', size: '6 oz', price: 5.79, offer: 'Buy 1, get 1 free' })), tile);
  assert.equal(r.price, 2.9);
  assert.equal(lineCost(indexItem(r), 2), 5.79);
});

test('% off: listed price already includes the discount', () => {
  const [r] = parseCollectionProducts(panel(item({ productId: '2', name: 'Applegate Naturals Chicken Breast Nuggets', size: '16 oz', price: 10.99, full: 16.99, offer: '35% off' })), tile);
  assert.equal(r.price, 10.99);
  assert.equal(r.regular_price, 16.99);
  assert.equal(r.promo, null);
  assert.equal(lineCost(indexItem(r), 2), 21.98);
});

test('per-lb product', () => {
  const [r] = parseCollectionProducts(panel(item({ productId: '3', name: 'Lucy Glo Apples', size: '1 lb', unit: '$3.98 / lb', price: 3.98 })), tile);
  assert.equal(r.price_per, 'lb');
  assert.equal(r.regular_price, null);
});

test('products from a tile are matchable by plain item', () => {
  const recs = parseCollectionProducts(panel(
    item({ productId: '16724414', name: 'Mandarins Bag', size: '3 lb', price: 5.99, offer: 'Buy 1, get 1 50% off' }),
    item({ productId: '23021684', name: 'Organic Rockit Apples Tub', size: '3 lb', price: 9.99, offer: 'Buy 1, get 1 50% off' }),
  ), tile).map(indexItem);
  const a = analyzeEntry(recs, { q: 'apples', qty: 2 }, '2026-10-23');
  assert.equal(a.chosen.id, 'sprouts-23021684');
  assert.equal(estimate([a], [{ q: 'apples', qty: 2 }]).total, 14.99);
});
