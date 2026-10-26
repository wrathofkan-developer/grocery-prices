// Costco runs a monthly member savings book, not a weekly ad.
// The warehouse-savings page is server-rendered HTML; the validity window is
// printed on the page ("Valid 10/19/26 - 11/15/26") and that window is the
// effective date — not when the book is mailed or posted.
// Not valid at Costco Business Centers, so only regular warehouses are mapped.

import { parse } from 'node-html-parser';
import { request } from '../http.js';
import { mdyToISO } from '../dates.js';
import { parseSize, unitPrice, cleanText, round2 } from '../normalize.js';

const URL_SAVINGS = 'https://www.costco.com/warehouse-savings.html';

export function parseValidity(html) {
  const m = html.match(/Valid\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (!m) return null;
  return { valid_from: mdyToISO(m[1]), valid_to: mdyToISO(m[2]) };
}

const money = (el) => {
  // Prices are split across spans: "$" "6" "." "99"
  const t = cleanText(el.textContent).replace(/\s/g, '');
  const m = t.match(/\$?(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
};

export function parseTiles(html, { validity, storeIds }) {
  const root = parse(html);
  const tiles = root
    .querySelectorAll('[data-testid="Grid"]')
    .filter((g) => g.childNodes.some((c) => c.tagName === 'A' && c.getAttribute('data-testid') === 'Link'));

  const items = [];
  for (const t of tiles) {
    const link = t.childNodes.find((c) => c.tagName === 'A');
    const name = cleanText(link.textContent);
    if (!name) continue;
    const texts = t.querySelectorAll('[data-testid="Text"]').map((e) => cleanText(e.textContent));
    const availability =
      texts.find((x) => /^(Warehouse Only|Online Only|Warehouse\s*&\s*Online)$/i.test(x)) ||
      (texts.some((x) => x === 'Warehouse') && texts.some((x) => x === 'Online') ? 'Warehouse & Online' : null);
    if (/^Online Only$/i.test(availability || '')) continue; // not in-store

    const md = t.querySelectorAll('[data-testid="MarkdownRenderer"]').map((e) => cleanText(e.textContent));
    const sizeText = md.find((x) => x && x !== name) || null;
    const itemNo = texts.find((x) => /^Item\s/.test(x)) || null;
    const limit = texts.find((x) => /^Limit\b/.test(x)) || null;

    // Only elements whose nearest tile is this one (guards against nested grids).
    const own = (sel) => t.querySelectorAll(sel).filter((e) => e.closest('[data-testid="Grid"]') === t);
    const prepend = cleanText(own('[data-testid="Text_prices_and_percentages_prepend_text"]')[0]?.textContent);
    const append = cleanText(own('[data-testid="Text_prices_and_percentages_append_text"]')[0]?.textContent);
    const priceEls = own('[data-testid="Text_prices_and_percentages_prices"]');
    const amounts = priceEls.map(money).filter((n) => n != null);

    let price = null;
    let deal = null;
    if (/^save$/i.test(prepend)) {
      // Book lists only the discount; shelf price isn't on the page.
      deal = amounts.length > 1 ? `Save $${amounts[0].toFixed(2)}–$${amounts[1].toFixed(2)}` : amounts.length ? `Save $${amounts[0].toFixed(2)}` : 'Save';
    } else if (amounts.length) {
      price = round2(amounts[0]);
      deal = append || null;
    }
    const size = parseSize(sizeText);
    // "Item 755383" -> 755383. Some tiles say "Item numbers vary."; use the name then.
    const num = (itemNo || '').match(/^Item\s+(\d+)/);
    const sku = num ? num[1] : name.toLowerCase().replace(/\W+/g, '-').replace(/^-|-$/g, '');

    items.push({
      id: `costco-${sku}`,
      chain: 'costco',
      stores: storeIds,
      kind: 'sale',
      name,
      brand: null,
      size_text: sizeText,
      price,
      price_per: 'each',
      unit_price: unitPrice(price, size),
      deal_text: [deal, limit].filter(Boolean).join(' · ') || null,
      availability,
      valid_from: validity.valid_from,
      valid_to: validity.valid_to,
      ad_id: `book-${validity.valid_from}`,
      ad_name: 'Member-Only Savings',
      category: null,
      image: t.querySelector('img')?.getAttribute('src') || null,
      url: link.getAttribute('href') || URL_SAVINGS,
    });
  }
  return items;
}

export async function fetchCostco(stores) {
  const html = await request(URL_SAVINGS, { as: 'text', headers: { accept: 'text/html' } });
  const validity = parseValidity(html);
  if (!validity) throw new Error('Costco: validity dates not found on savings page');
  const storeIds = stores.map((s) => s.id);
  const items = parseTiles(html, { validity, storeIds });
  if (!items.length) throw new Error('Costco: no items parsed (page layout may have changed)');
  return {
    ads: [{ id: `book-${validity.valid_from}`, name: 'Member-Only Savings', stores: storeIds, ...validity, items: items.length }],
    items,
  };
}
