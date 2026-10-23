// Sprouts runs its ads on an Instacart storefront (shop.sprouts.com).
// The data comes from GraphQL "persisted queries" whose IDs change whenever
// Instacart redeploys, so a plain HTTP fetcher would break often. Instead a
// real browser (Playwright) loads the ad pages and we read the responses the
// page itself receives. This runs on your Windows PC, not on GitHub.
//
// Effective dates: each flyer's startsAt/endsAt are exact instants
// (e.g. 2026-10-21T07:00:00Z = Wed 12:00am Pacific). We convert them to
// Pacific calendar dates.
//
// Each ad tile ("Cuties Mandarins or Organic Rockit Apples") opens a panel of
// the actual products with shelf prices and the deal. We read those panels so
// items get real prices, the deal, and a link to the product page.
//   - "35% off": the listed price already includes the discount; the original
//     price is listed separately (kept as regular_price).
//   - "Buy 1, get 1 50% off": the listed price is the single-unit price; the
//     deal applies when buying 2. price = per-unit price with the deal,
//     regular_price = one unit without it, promo = the deal for exact totals.

import { instantToPTDate } from '../dates.js';
import { parsePrice, parseSize, unitPrice, cleanText, parseMultiBuy, multiBuyCost, round2 } from '../normalize.js';

const BASE = 'https://shop.sprouts.com/store/sprouts/flyers/view';
const PRODUCT = 'https://shop.sprouts.com/store/sprouts/products';
const AD_TAGS = ['weekly', 'monthly'];

function flyerWindow(flyersJson, tag) {
  const flyer = (flyersJson?.data?.flyers || []).find((f) => f.tag === tag) || flyersJson?.data?.flyers?.[0];
  if (!flyer) throw new Error(`Sprouts: no ${tag} flyer in response`);
  const loc = flyer.flyerRetailerLocation || {};
  return {
    flyer,
    loc,
    valid_from: instantToPTDate(loc.startsAt),
    // endsAt is 06:59:59Z = 11:59:59pm Pacific the previous calendar day.
    valid_to: instantToPTDate(loc.endsAt),
    adName: flyer.name || `${tag[0].toUpperCase()}${tag.slice(1)} Ad`,
  };
}

/** Pure parser: Flyers + FlyerActivities JSON -> one record per ad tile. Unit-tested. */
export function parseSproutsFlyer(flyersJson, activitiesJson, { tag, storeIds }) {
  const { flyer, loc, valid_from, valid_to, adName } = flyerWindow(flyersJson, tag);
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
      regular_price: null,
      promo: null,
      price_per: perLb ? 'lb' : 'each',
      unit_price: unitPrice(price, perLb ? null : size, perLb ? 'lb' : null),
      deal_text: price == null ? 'In ad — see Sprouts for deal' : parsed.multi ? `${parsed.qty} for $${(parsed.price * parsed.qty).toFixed(2)}` : null,
      valid_from,
      valid_to,
      ad_id: String(flyer.id),
      ad_name: adName,
      ad_item: name,
      collection_id: a.collectionId || null,
      category: null,
      image: null,
      url: `${BASE}/${tag}/print`,
    });
  }
  return {
    ad: { id: String(flyer.id), name: adName, stores: storeIds, valid_from, valid_to, items: items.length, retailerLocationId: loc.retailerLocationId },
    items,
  };
}

const money = (s) => {
  const m = String(s ?? '').replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
};

/**
 * Pure parser: one ad tile's CollectionProducts response -> one record per product.
 * `tile` is the record from parseSproutsFlyer (supplies dates, ad and stores).
 */
export function parseCollectionProducts(json, tile) {
  const out = [];
  for (const it of json?.data?.collectionProducts?.items || []) {
    const vs = it?.price?.viewSection || {};
    const now = money(vs.priceValueString ?? vs.priceString);
    if (!(now > 0)) continue;
    const label = cleanText(vs.badge?.offerLabelString || vs.itemPromotions?.[0]?.offerLabelString) || null;
    const full = money(vs.fullPriceString ?? vs.itemDetails?.fullPriceString);
    const unitStr = cleanText(vs.itemDetails?.pricingUnitString || vs.itemCard?.pricingUnitString);
    const perLb = /\/\s*lb\b/i.test(`${unitStr} ${vs.priceSuffixString || ''} ${vs.itemCard?.priceSuffixString || ''}`);
    const promo = parseMultiBuy(label);

    let price = now;
    let regular = null;
    if (promo) {
      // Listed price is one unit; the deal needs buy+get units.
      const n = promo.buy + promo.get;
      price = round2(multiBuyCost(now, n, promo) / n);
      regular = now;
    } else if (full && full > now) {
      // "% off" sale: already in the listed price.
      regular = full;
    }

    const size = perLb ? null : parseSize(it.size || unitStr);
    out.push({
      id: `sprouts-${it.productId || it.id}`,
      chain: 'sprouts',
      stores: tile.stores,
      kind: 'sale',
      name: cleanText(it.name),
      brand: cleanText(it.brandName) || null,
      size_text: cleanText(it.size) || null,
      price,
      regular_price: regular && regular > price ? regular : null,
      promo,
      price_per: perLb ? 'lb' : 'each',
      unit_price: unitPrice(price, size, perLb ? 'lb' : null),
      deal_text: label,
      valid_from: tile.valid_from,
      valid_to: tile.valid_to,
      ad_id: tile.ad_id,
      ad_name: tile.ad_name,
      ad_item: tile.ad_item,
      category: null,
      image: null,
      url: it.evergreenUrl ? `${PRODUCT}/${it.evergreenUrl}` : tile.url,
    });
  }
  return out;
}

async function openPopups(page) {
  return page.locator('[role="dialog"], [aria-modal="true"]').evaluateAll(
    (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 140)).filter(Boolean),
  ).catch(() => []);
}

/** Confirm the shop-mode popup if it shows our store; otherwise close it. */
async function confirmStorePopup(page, storeCode) {
  const start = page.getByRole('button', { name: /^start shopping$/i }).first();
  if (!(await start.isVisible().catch(() => false))) return;
  const text = (await openPopups(page)).join(' ');
  if (storeCode && new RegExp(`Store #${storeCode}\\b`).test(text)) {
    await start.click({ timeout: 5000 }).catch(() => start.evaluate((el) => el.click()).catch(() => {}));
  } else {
    const shown = (text.match(/Store #(\d+)/) || [])[1];
    console.warn(`Sprouts: store popup shows Store #${shown ?? '?'}, not #${storeCode}; closing it without confirming.`);
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(800);
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
      let collectionUrl = null;
      const onResp = async (r) => {
        const u = r.url();
        if (!u.includes('/graphql')) return;
        const op = (u.match(/operationName=([A-Za-z]+)/) || [])[1];
        if (op === 'CollectionProducts') { collectionUrl = u; return; }
        if (op === 'Flyers' || op === 'FlyerActivities') {
          try { captured[op] = await r.json(); } catch { /* ignore */ }
        }
      };
      page.on('response', onResp);
      // The storefront never goes network-idle (analytics keep polling), so load the
      // page and then wait only for the two responses we need.
      await page.goto(`${BASE}/${tag}/print`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      for (let i = 0; i < 90 && !(captured.Flyers && captured.FlyerActivities); i++) await page.waitForTimeout(500);

      // Confirm the storefront picked our store (it geolocates by IP).
      const body = await page.innerText('body').catch(() => '');
      const storeNo = (body.match(/Store #(\d+)/) || [])[1];
      if (expected && storeNo && storeNo !== expected) {
        console.warn(`Sprouts: page shows Store #${storeNo}, expected #${expected}. Prices may be for another store.`);
      }
      if (!captured.Flyers || !captured.FlyerActivities) {
        page.off('response', onResp);
        console.warn(`Sprouts: ${tag} ad data not captured`);
        continue;
      }
      const res = parseSproutsFlyer(captured.Flyers, captured.FlyerActivities, { tag, storeIds });
      res.ad.storeShown = storeNo || null;

      // Open one tile to learn the product-panel request, then load every tile's products.
      const tiles = res.items.filter((t) => t.collection_id);
      // A fresh browser gets a "How would you like to shop?" popup that covers the page.
      // It already shows the store picked from the PC's location; confirm it only if
      // it's our store, otherwise close it and warn.
      if (tiles.length) await confirmStorePopup(page, expected);

      for (const t of tiles.slice(0, 3)) {
        if (collectionUrl) break;
        const btn = page.getByRole('button', { name: t.name, exact: true }).first();
        try {
          await btn.click({ timeout: 10000 });
        } catch (e) {
          // Something still covers the tile: click it directly in the page instead.
          console.warn(`Sprouts: normal click on "${t.name}" blocked (${e.message.split('\n')[0]}); clicking directly`);
          await btn.evaluate((el) => el.click()).catch(() => {});
        }
        for (let i = 0; i < 30 && !collectionUrl; i++) await page.waitForTimeout(500);
        if (!collectionUrl) {
          const popups = await openPopups(page);
          console.warn(`Sprouts: ad tile "${t.name}" didn't open its products. Popups: ${popups.join(' | ') || 'none'}`);
        }
      }
      page.off('response', onResp);

      let expanded = 0;
      if (collectionUrl) {
        const panels = await page.evaluate(async ({ tmpl, ids }) => {
          const out = {};
          for (const id of ids) {
            const u = new URL(tmpl);
            const v = JSON.parse(u.searchParams.get('variables'));
            v.id = id;
            v.first = 40;
            u.searchParams.set('variables', JSON.stringify(v));
            try { out[id] = await (await fetch(u.toString())).json(); } catch { out[id] = null; }
            await new Promise((r) => setTimeout(r, 250));
          }
          return out;
        }, { tmpl: collectionUrl, ids: tiles.map((t) => t.collection_id) });

        const seen = new Set();
        for (const tile of res.items) {
          const products = tile.collection_id && panels[tile.collection_id]
            ? parseCollectionProducts(panels[tile.collection_id], tile).filter((p) => !seen.has(p.id))
            : [];
          if (products.length) {
            products.forEach((p) => seen.add(p.id));
            items.push(...products);
            expanded++;
          } else {
            items.push(tile); // keep the ad tile if its products couldn't be read
          }
        }
      } else {
        if (tiles.length) console.warn('Sprouts: product panels not captured; keeping ad tiles only');
        items.push(...res.items);
      }
      res.ad.tiles_expanded = expanded;
      ads.push(res.ad);
    }
  } finally {
    await browser.close();
  }
  if (!items.length) throw new Error('Sprouts: no ad items captured');
  return { ads, items };
}
