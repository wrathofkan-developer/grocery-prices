import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { todayPT, instantToPTDate, flippDate, mdyToISO, priceStatus } from '../src/dates.js';
import { parseSize, parsePrice } from '../src/normalize.js';
import { mapItem as safewayItem, extractToken } from '../src/fetchers/safeway.js';
import { mapItem as tjItem } from '../src/fetchers/traderjoes.js';
import { parseValidity, parseTiles } from '../src/fetchers/costco.js';
import { parseSproutsFlyer } from '../src/fetchers/sprouts.js';

// ---------- effective dates (the core requirement) ----------

test('ad posted Tuesday does not take effect until its Wednesday start date', () => {
  // Real Safeway ad seen 2026-10-23: posted (available_from) 10/20, valid 10/21-10/27.
  const item = { valid_from: '2026-10-21', valid_to: '2026-10-27' };
  assert.equal(priceStatus(item, '2026-10-20'), 'upcoming'); // posted day: NOT active yet
  assert.equal(priceStatus(item, '2026-10-21'), 'active');
  assert.equal(priceStatus(item, '2026-10-27'), 'active'); // last day inclusive
  assert.equal(priceStatus(item, '2026-10-28'), 'expired');
});

test('Flipp: use the date field, not the Eastern-midnight timestamp', () => {
  // Midnight Eastern = 9pm Pacific the day before; must not start a day early.
  assert.equal(flippDate('2026-10-21', '2026-10-21T00:00:00-04:00'), '2026-10-21');
  assert.equal(flippDate(null, '2026-10-21T00:00:00-04:00'), '2026-10-21');
  assert.equal(instantToPTDate('2026-10-21T00:00:00-04:00'), '2026-10-20'); // why we don't convert
});

test('Sprouts instants convert to Pacific dates (Wed 12am → Tue 11:59pm)', () => {
  assert.equal(instantToPTDate('2026-10-21T07:00:00Z'), '2026-10-21');
  assert.equal(instantToPTDate('2026-10-28T06:59:59Z'), '2026-10-27');
});

test('Costco book dates', () => {
  assert.equal(mdyToISO('10/19/26'), '2026-10-19');
  assert.equal(mdyToISO('11/15/2026'), '2026-11-15');
});

test('todayPT is Pacific, not UTC', () => {
  // 2026-10-24 03:00 UTC is still Oct 23 in California.
  assert.equal(todayPT(new Date('2026-10-24T03:00:00Z')), '2026-10-23');
});

test('regular prices with no end date stay active', () => {
  assert.equal(priceStatus({ valid_from: '2026-10-23', valid_to: null }, '2027-01-01'), 'active');
});

// ---------- parsing ----------

test('package sizes', () => {
  assert.deepEqual(parseSize('64 fl oz'), { qty: 64, unit: 'fl_oz' });
  assert.deepEqual(parseSize('64 - oz. Selected varieties.'), { qty: 64, unit: 'oz' });
  assert.deepEqual(parseSize('3 lbs'), { qty: 48, unit: 'oz' });
  assert.deepEqual(parseSize('2/16 oz'), { qty: 32, unit: 'oz' });
  assert.deepEqual(parseSize('Cranberry Fizz, 18/12 fl oz'), { qty: 216, unit: 'fl_oz' });
  assert.deepEqual(parseSize('Cottonelle Bath Tissue 18-ct.'), { qty: 18, unit: 'ct' });
});

test('prices', () => {
  assert.deepEqual(parsePrice('4.99'), { price: 4.99, qty: 1, multi: false });
  assert.deepEqual(parsePrice('2/5.00'), { price: 2.5, qty: 2, multi: true });
  assert.deepEqual(parsePrice('2 for $5'), { price: 2.5, qty: 2, multi: true });
  assert.equal(parsePrice(''), null);
});

// ---------- Safeway (Flipp) ----------

const pub = { id: 8187139, name: 'Weekly Ad - Safeway - NorCal' };
const flippBase = { valid_from: '2026-10-21', valid_from_timestamp: '2026-10-21T00:00:00-04:00', valid_to: '2026-10-27', valid_to_timestamp: '2026-10-27T23:59:59-04:00', categories: ['Dairy, Eggs & Cheese'] };

test('Safeway: member price item', () => {
  const r = safewayItem({ ...flippBase, id: 1047397018, name: 'Oatly Oatmilk', description: '64 - oz. Selected varieties.', price_text: '4.99', pre_price_text: '', post_price_text: 'member price', brand: 'Oatly' }, pub, ['safeway-3116']);
  assert.equal(r.price, 4.99);
  assert.equal(r.valid_from, '2026-10-21');
  assert.equal(r.valid_to, '2026-10-27');
  assert.equal(r.member_price, true);
  assert.equal(r.unit_price.unit, 'oz');
  assert.ok(Math.abs(r.unit_price.value - 4.99 / 64) < 1e-9);
});

test('Safeway: BOGO with no price keeps the deal text', () => {
  const r = safewayItem({ ...flippBase, id: 1, name: 'Stonefire Naan or Pizza Crust', description: 'Mix & MATCH', price_text: '', sale_story: 'BUY 1 GET 1 FREE Member Price When you Buy 2' }, pub, []);
  assert.equal(r.price, null);
  assert.match(r.deal_text, /BUY 1 GET 1/);
});

test('Safeway: per-lb pricing', () => {
  const r = safewayItem({ ...flippBase, id: 2, name: 'Chicken Thighs Value Pack', description: '', price_text: '1.99', post_price_text: 'lb member price' }, pub, []);
  assert.equal(r.price_per, 'lb');
  assert.deepEqual(r.unit_price, { value: 1.99 / 16, unit: 'oz' });
});

test('Safeway: token extraction from bundle', () => {
  const js = 'x={randalls:{url:"a",accessToken:"aaaa"},safeway:{url:"https://aq.flippenterprise.net/5667/iframe.js",accessToken:"0123456789abcdef0123"}}';
  assert.equal(extractToken(js), '0123456789abcdef0123');
});

// ---------- Trader Joe's ----------

test("TJ's: regular price, unit price, per-lb, product link", () => {
  const egg = tjItem({ sku: '047904', item_title: 'Egg Nog', retail_price: '3.99', sales_size: 32, sales_uom_description: 'Fl Oz' }, ['traderjoes-187'], '2026-10-23', 'Food');
  assert.equal(egg.kind, 'regular');
  assert.equal(egg.valid_to, null);
  assert.deepEqual(egg.unit_price, { value: 3.99 / 32, unit: 'fl_oz' });
  assert.equal(egg.url, 'https://www.traderjoes.com/home/products/pdp/egg-nog-047904');
  const cheese = tjItem({ sku: '050036', item_title: 'Huntsman Cheese', retail_price: '12.99', sales_size: 1, sales_uom_description: 'Lb' }, [], '2026-10-23', 'Food');
  assert.equal(cheese.price_per, 'lb');
  assert.equal(cheese.url, 'https://www.traderjoes.com/home/products/pdp/huntsman-cheese-050036');
});

// ---------- Costco ----------

test('Costco: validity and tiles', async () => {
  const html = await readFile(new URL('./fixtures/costco-savings.html', import.meta.url), 'utf8');
  const v = parseValidity(html);
  assert.deepEqual(v, { valid_from: '2026-10-19', valid_to: '2026-11-15' });
  const items = parseTiles(html, { validity: v, storeIds: ['costco-422'] });
  const by = Object.fromEntries(items.map((i) => [i.name, i]));
  assert.equal(items.length, 5, 'online-only item excluded');
  assert.equal(by["Hellmann's OR Best Foods Real Mayonnaise"].price, 6.99);
  assert.match(by["Hellmann's OR Best Foods Real Mayonnaise"].deal_text, /After \$3 OFF/);
  assert.equal(by['Columbus Reduced Sodium Italian Dry Sliced Salame'].unit_price.unit, 'oz');
  assert.equal(by['Tyson Crispy Chicken Strips'].price, null);
  assert.equal(by['Tyson Crispy Chicken Strips'].deal_text, 'Save $4.60');
  assert.match(by['Kirkland Signature Freezer Storage Bags'].deal_text, /Save \$2\.80–\$3\.00/);
  assert.equal(by['Tyson Crispy Chicken Strips'].availability, 'Warehouse Only');
  assert.equal(by['Poppi Prebiotic Soda'].availability, 'Warehouse & Online');
  assert.equal(by['Tyson Crispy Chicken Strips'].id, 'costco-755383');
});

// ---------- Sprouts ----------

test('Sprouts: flyer window and items', () => {
  const flyers = { data: { flyers: [
    { id: '21432087034009936', name: 'Weekly Ad', tag: 'weekly', flyerRetailerLocation: { startsAt: '2026-10-21T07:00:00Z', endsAt: '2026-10-28T06:59:59Z', retailerLocationId: '19462' } },
    { id: '999', name: 'Monthly Ad', tag: 'monthly', flyerRetailerLocation: { startsAt: '2026-09-23T07:00:00Z', endsAt: '2026-10-28T06:59:59Z' } },
  ] } };
  const acts = { data: { flyerActivities: [
    { id: 'a', extActivityId: '20261021_96225', title: '3.98', description: 'Lucy™ Glo or Lucy™ Rose Apples' },
    { id: 'b', extActivityId: '20261021_96224', title: '', description: 'Kingston Creamery Blue Cheese' },
    { id: 'c', extActivityId: '20261021_1', title: '2/5', description: 'Sprouts Organic Beans 15 oz' },
  ] } };
  const { ad, items } = parseSproutsFlyer(flyers, acts, { tag: 'weekly', storeIds: ['sprouts-276'] });
  assert.equal(ad.valid_from, '2026-10-21');
  assert.equal(ad.valid_to, '2026-10-27');
  assert.equal(items[0].price, 3.98);
  assert.equal(items[1].price, null);
  assert.match(items[1].deal_text, /see Sprouts/);
  assert.equal(items[2].price, 2.5);
  const monthly = parseSproutsFlyer(flyers, acts, { tag: 'monthly', storeIds: [] });
  assert.equal(monthly.ad.valid_from, '2026-09-23');
});

test('Costco: "Item numbers vary" tiles get distinct ids', () => {
  const tile = (name) => `<div data-testid="Grid"><a data-testid="Link" href="x"><span>${name}</span></a><div><div data-testid="Text">Warehouse Only</div><div data-testid="Text">Item numbers vary.</div><div data-testid="Text_prices_and_percentages_prepend_text">Save</div><p data-testid="Text_prices_and_percentages_prices"><span data-testid="Text">$80</span></p></div></div>`;
  const html = `<p>Valid 10/19/26 - 11/15/26</p>${tile('ON ANY SET OF 4 Bridgestone Tires')}${tile('BUY ONE PAIR of prescription eyeglasses')}`;
  const items = parseTiles(html, { validity: parseValidity(html), storeIds: [] });
  assert.equal(new Set(items.map((i) => i.id)).size, 2);
  assert.equal(items[0].id, 'costco-on-any-set-of-4-bridgestone-tires');
});

test('sizes: fractions, pints, and packs', () => {
  assert.deepEqual(parseSize('1/2 gal'), { qty: 64, unit: 'fl_oz' });
  assert.deepEqual(parseSize('1/2 gallon'), { qty: 64, unit: 'fl_oz' });
  assert.deepEqual(parseSize('3/4 lb'), { qty: 12, unit: 'oz' });
  assert.deepEqual(parseSize('1 1/2 lb'), { qty: 24, unit: 'oz' });
  assert.deepEqual(parseSize('1 pt'), { qty: 16, unit: 'fl_oz' });
  assert.deepEqual(parseSize('1 Pint'), { qty: 16, unit: 'fl_oz' });
  assert.deepEqual(parseSize('6/32 oz'), { qty: 192, unit: 'oz' }, '6 packs of 32 oz');
  assert.deepEqual(parseSize('8/10 oz'), { qty: 80, unit: 'oz' }, '8 packs of 10 oz');
  assert.deepEqual(parseSize('18/12 fl oz'), { qty: 216, unit: 'fl_oz' });
  assert.deepEqual(parseSize('2/3 fl oz'), { qty: 6, unit: 'fl_oz' }, 'Costco 2-pack of 3 fl oz');
});
