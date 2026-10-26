// Kroger API responses -> the app's store and item records. Pure functions,
// shared by the edge function (Deno) and the Node tests.
import { parseSize, unitPrice, cleanText, round2 } from '../_shared/normalize.js';

// Kroger's `chain` codes -> the name on the store sign.
const BANNERS = {
  KROGER: 'Kroger', RALPHS: 'Ralphs', FREDMEYER: 'Fred Meyer', 'FRED MEYER': 'Fred Meyer', KINGSOOPERS: 'King Soopers',
  SMITHS: "Smith's", FRYS: "Fry's", QFC: 'QFC', HART: 'Harris Teeter', HARRISTEETER: 'Harris Teeter', DILLONS: 'Dillons',
  BAKERS: "Baker's", CITYMARKET: 'City Market', GERBES: 'Gerbes', JAYC: 'Jay C', MARIANOS: "Mariano's",
  METROMARKET: 'Metro Market', PICKNSAVE: "Pick 'n Save", PAYLESS: 'Pay Less', FOOD4LESS: 'Food 4 Less',
  FOODSCO: 'Foods Co', COPPS: 'Copps', RULER: 'Ruler', VITACOST: 'Vitacost',
};

export function bannerName(code) {
  const key = String(code || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '');
  if (BANNERS[key]) return BANNERS[key];
  if (BANNERS[key.replace(/ /g, '')]) return BANNERS[key.replace(/ /g, '')];
  return key ? key.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : 'Kroger';
}

/** One Kroger location -> a row for the stores table. */
export function mapLocation(l, tzLookup) {
  const a = l.address || {};
  const lat = Number(l.geolocation?.latitude);
  const lng = Number(l.geolocation?.longitude);
  if (!l.locationId || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const banner = bannerName(l.chain);
  let tz = l.hours?.timezone || l.hours?.timeZone || null;
  if (!tz && tzLookup) { try { tz = tzLookup(lat, lng); } catch { /* ignore */ } }
  return {
    id: `kroger-${l.locationId}`,
    chain: 'kroger',
    banner,
    name: cleanText(l.name) || `${banner} ${a.city || ''}`.trim(),
    address: [a.addressLine1, a.city, [a.state, a.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
    lat,
    lng,
    tz: tz || 'America/New_York',
    store_code: String(l.locationId),
    postal: a.zipCode || null,
    source: 'kroger',
  };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';

/** One Kroger product (searched at one store) -> an item record, or null if it has no price there. */
export function mapProduct(p, { storeId, today }) {
  const it = (p.items || []).find((x) => x?.price && Number(x.price.regular) > 0);
  if (!it) return null;
  const regular = Number(it.price.regular);
  const promo = Number(it.price.promo) || 0;
  const onSale = promo > 0 && promo < regular;
  const price = round2(onSale ? promo : regular);
  const perLb = String(it.soldBy || '').toUpperCase() === 'WEIGHT';
  const size = perLb ? null : parseSize(it.size);
  const name = cleanText(p.description);
  return {
    id: `${storeId}-${p.productId}`,
    chain: 'kroger',
    stores: [storeId],
    kind: onSale ? 'sale' : 'regular',
    name,
    brand: cleanText(p.brand) || null,
    size_text: cleanText(it.size) || null,
    price,
    regular_price: onSale ? round2(regular) : null,
    promo: null,
    price_per: perLb ? 'lb' : 'each',
    unit_price: unitPrice(price, size, perLb ? 'lb' : null),
    deal_text: onSale ? 'Sale' : null,
    valid_from: today,
    valid_to: null,
    upc: p.upc || null,
    category: (p.categories || [])[0] || null,
    image: null,
    url: `https://www.kroger.com/p/${slug(name)}/${p.productId}`,
  };
}
