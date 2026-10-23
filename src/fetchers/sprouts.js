// Sprouts runs its ads on an Instacart storefront (shop.sprouts.com).
// The data comes from GraphQL "persisted queries" whose IDs change whenever
// Instacart redeploys, so a plain HTTP fetcher would break often. Instead a
// real browser (Playwright) loads the ad pages and we read the responses the
// page itself receives. This runs on your Windows PC, not on GitHub.
//
// Effective dates: each flyer's startsAt/endsAt are exact instants
// (e.g. 2026-10-21T07:00:00Z = Wed 12:00am Pacific). We convert them to
// Pacific calendar dates. The weekly ad and the monthly ad overlap; both are
// kept and the app picks the lower active price.

import { instantToPTDate } from '../dates.js';
import { parsePrice, parseSize, unitPrice, cleanText } from '../normalize.js';

const BASE = 'https://shop.sprouts.com/store/sprouts/flyers/view';
const AD_TAGS = ['weekly', 'monthly'];

/** Pure parser: Flyers + FlyerActivities JSON -> normalized records. Unit-tested. */
export function parseSproutsFlyer(flyersJson, activitiesJson, { tag, storeIds }) {
  const flyer = (flyersJson?.data?.flyers || []).find((f) => f.tag === tag) || flyersJson?.data?.flyers?.[0];
  if (!flyer) throw new Error(`Sprouts: no ${tag} flyer in response`);
  const loc = flyer.flyerRetailerLocation || {};
  const valid_from = instantToPTDate(loc.startsAt);
  // endsAt is 06:59:59Z = 11:59:59pm Pacific the previous calendar day.
  const valid_to = instantToPTDate(loc.endsAt);

  const acts = activitiesJson?.data?.flyerActivities || [];
  const items = [];
  for (const a of acts) {
    const name = cleanText(a.description);
    if (!name) continue;
    const titleText = cleanText(a.title);
    const parsed = parsePrice(titleText);
    const perLb = /\blb\b|\/\s*lb|per\s+pound/i.test(`${titleText} ${name}`);
    const size = parseSize(name);
    const price = parsed?.price ?? null;
    items.push({
      id: `sprouts-${a.extActivityId || a.id}`,
      chain: 'sprouts',
      stores: storeIds,
      kind: 'sale',
      name,
      brand: null,
      size_text: null,
      price,
      price_per: perLb ? 'lb' : 'each',
      unit_price: unitPrice(price, perLb ? null : size, perLb ? 'lb' : null),
      // ~half of Sprouts ad items are % off / BOGO shown only in the ad image.
      deal_text: price == null ? 'In ad — see Sprouts for deal' : parsed.multi ? `${parsed.qty} for $${(parsed.price * parsed.qty).toFixed(2)}` : null,
      valid_from,
      valid_to,
      ad_id: String(flyer.id),
      ad_name: `${flyer.name || 'Ad'} (${tag})`,
      category: null,
      image: null,
      url: `${BASE}/${tag}/print`,
    });
  }
  return {
    ad: { id: String(flyer.id), name: `${flyer.name} (${tag})`, stores: storeIds, valid_from, valid_to, items: items.length, retailerLocationId: loc.retailerLocationId },
    items,
  };
}

/** Browser-driven fetch. Requires `npm i playwright` + `npx playwright install chromium` (Windows setup does this). */
export async function fetchSprouts(stores) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Sprouts needs Playwright (run windows\\setup.ps1). Skipping on this machine.');
  }
  const storeIds = stores.map((s) => s.id);
  const expected = stores[0]?.storeCode;
  const browser = await chromium.launch({ headless: true });
  const ads = [];
  const items = [];
  try {
    const ctx = await browser.newContext({ locale: 'en-US', timezoneId: 'America/Los_Angeles' });
    const page = await ctx.newPage();
    for (const tag of AD_TAGS) {
      const captured = {};
      const onResp = async (r) => {
        const u = r.url();
        if (!u.includes('/graphql')) return;
        const op = (u.match(/operationName=([A-Za-z]+)/) || [])[1];
        if (op === 'Flyers' || op === 'FlyerActivities') {
          try { captured[op] = await r.json(); } catch { /* ignore */ }
        }
      };
      page.on('response', onResp);
      // The storefront never goes network-idle (analytics keep polling), so load the
      // page and then wait only for the two responses we need.
      await page.goto(`${BASE}/${tag}/print`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      for (let i = 0; i < 90 && !(captured.Flyers && captured.FlyerActivities); i++) await page.waitForTimeout(500);
      page.off('response', onResp);

      // Confirm the storefront picked our store (it geolocates by IP).
      const body = await page.innerText('body').catch(() => '');
      const storeNo = (body.match(/Store #(\d+)/) || [])[1];
      if (expected && storeNo && storeNo !== expected) {
        console.warn(`Sprouts: page shows Store #${storeNo}, expected #${expected}. Prices may be for another store.`);
      }
      if (!captured.Flyers || !captured.FlyerActivities) {
        console.warn(`Sprouts: ${tag} ad data not captured`);
        continue;
      }
      const res = parseSproutsFlyer(captured.Flyers, captured.FlyerActivities, { tag, storeIds });
      res.ad.storeShown = storeNo || null;
      ads.push(res.ad);
      items.push(...res.items);
    }
  } finally {
    await browser.close();
  }
  if (!items.length) throw new Error('Sprouts: no ad items captured');
  return { ads, items };
}
