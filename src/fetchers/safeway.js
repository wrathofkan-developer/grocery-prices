// Safeway weekly ad via Flipp, the ad provider behind safeway.com/weeklyad.
// Effective dates come from each item's valid_from/valid_to DATE fields.
// The publication's available_from (when the ad is posted, usually the day
// before) is recorded for reference only and never used for pricing.

import { request, sleep } from '../http.js';
import { flippDate } from '../dates.js';
import { parsePrice, parseSize, unitPrice, canonicalUnit, cleanText } from '../normalize.js';

const SITE = 'https://www.safeway.com';
const DAM = 'https://dam.flippenterprise.net/hosted';
const HEADERS = { referer: `${SITE}/`, origin: SITE };

/** The Flipp access token is embedded in Safeway's weekly-ad app bundle. */
export async function getToken() {
  if (process.env.SAFEWAY_FLIPP_TOKEN) return process.env.SAFEWAY_FLIPP_TOKEN;
  const html = await request(`${SITE}/weeklyad`, { as: 'text' });
  const main = html.match(/weeklyad\/dist\/weeklyad\/main\.[a-f0-9]+\.js/);
  if (!main) throw new Error('Safeway: weekly-ad app bundle not found on page');
  const js = await request(`${SITE}/${main[0]}`, { as: 'text' });
  return extractToken(js);
}

export function extractToken(js) {
  const m = js.match(/safeway:\{url:"[^"]*",accessToken:"([a-f0-9]{16,})"/);
  if (!m) throw new Error('Safeway: Flipp access token not found in bundle');
  return m[1];
}

/** Turn one Flipp product into our normalized record. */
export function mapItem(p, pub, storeIds) {
  const name = cleanText(p.name);
  const desc = cleanText(p.description);
  const priceText = cleanText(p.price_text);
  const post = cleanText(p.post_price_text);
  const pre = cleanText(p.pre_price_text);
  const story = cleanText(p.sale_story);

  const parsed = parsePrice(priceText);
  const perLb = /\blb\b/i.test(post) || /\/\s*lb/i.test(priceText);
  const size = parseSize(`${name} ${desc}`);
  const price = parsed?.price ?? null;

  const dealBits = [pre, parsed?.multi ? `${parsed.qty} for $${(parsed.price * parsed.qty).toFixed(2)}` : '', post, story]
    .filter(Boolean);

  return {
    id: `safeway-${p.id}`,
    chain: 'safeway',
    stores: storeIds,
    kind: 'sale',
    name,
    brand: cleanText(p.brand) || null,
    size_text: desc || null,
    price,
    price_per: perLb ? 'lb' : 'each',
    unit_price: unitPrice(price, perLb ? null : size, perLb ? canonicalUnit('lb') : null),
    deal_text: dealBits.join(' · ') || null,
    member_price: /member/i.test(`${post} ${story}`),
    valid_from: flippDate(p.valid_from, p.valid_from_timestamp),
    valid_to: flippDate(p.valid_to, p.valid_to_timestamp),
    ad_id: String(pub.id),
    ad_name: pub.name,
    category: Array.isArray(p.categories) ? p.categories.filter((c) => c !== 'Coupon')[0] || null : null,
    image: p.image_url || null,
    url: `${SITE}/weeklyad`,
  };
}

export async function fetchSafeway(stores) {
  const token = await getToken();
  const q = (extra) => `locale=en&access_token=${token}${extra}`;

  // 1) Which ads apply to each store (current + any already-posted upcoming ad).
  const pubs = new Map(); // pubId -> { pub, storeIds:Set }
  for (const s of stores) {
    const list = await request(
      `${DAM}/publications/safeway?languages%5B%5D=en&${q(`&show_storefronts=true&postal_code=${s.postal}&store_code=${s.storeCode}`)}`,
      { headers: HEADERS },
    );
    for (const pub of list) {
      if (!pubs.has(pub.id)) pubs.set(pub.id, { pub, storeIds: new Set() });
      pubs.get(pub.id).storeIds.add(s.id);
    }
    await sleep(400);
  }

  // 2) Items in each ad.
  const items = [];
  const ads = [];
  for (const { pub, storeIds } of pubs.values()) {
    const prods = await request(`${DAM}/publication/${pub.id}/products?display_type=all&${q('')}`, { headers: HEADERS });
    const ids = [...storeIds];
    for (const p of prods) if (p.name) items.push(mapItem(p, pub, ids));
    ads.push({
      id: String(pub.id),
      name: pub.name,
      stores: ids,
      valid_from: flippDate(null, pub.valid_from),
      valid_to: flippDate(null, pub.valid_to),
      posted: flippDate(null, pub.available_from), // reference only
      items: prods.length,
    });
    await sleep(400);
  }
  return { ads, items };
}
