// Trader Joe's has no weekly ad; prices are everyday shelf prices.
// Its product API returns store-specific regular prices, which fills the
// "regular price" gap for TJ's. These records have kind 'regular',
// valid_from = the day we saw the price, and no end date.

import { request, sleep } from '../http.js';
import { todayPT } from '../dates.js';
import { parseSize, toBase, canonicalUnit, unitPrice, cleanText, round2 } from '../normalize.js';

const API = 'https://www.traderjoes.com/api/graphql';
const CATEGORIES = [{ id: '8', name: 'Food' }];
const PAGE_SIZE = 100;

const QUERY = `query Products($storeCode:String,$categoryId:String,$currentPage:Int,$pageSize:Int){
  products(filter:{store_code:{eq:$storeCode},published:{eq:"1"},availability:{match:"1"},category_id:{eq:$categoryId}},
           currentPage:$currentPage,pageSize:$pageSize){
    items{ sku item_title retail_price sales_size sales_uom_description url_key primary_image }
    total_count page_info{ total_pages }
  }}`;

async function page(storeCode, categoryId, currentPage) {
  const j = await request(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', referer: 'https://www.traderjoes.com/home/products', origin: 'https://www.traderjoes.com' },
    body: JSON.stringify({ query: QUERY, variables: { storeCode, categoryId, currentPage, pageSize: PAGE_SIZE } }),
  });
  if (j.errors?.length) throw new Error(`TJ API: ${j.errors[0].message}`);
  return j.data.products;
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');

export function mapItem(p, storeIds, today, category) {
  const price = Number(p.retail_price);
  const unit = canonicalUnit(p.sales_uom_description);
  const size = unit ? toBase(Number(p.sales_size), unit) : parseSize(`${p.sales_size} ${p.sales_uom_description}`);
  const perLb = unit === 'lb' && Number(p.sales_size) === 1 && /pound|lb/i.test(p.sales_uom_description);
  return {
    id: `traderjoes-${p.sku}`,
    chain: 'traderjoes',
    stores: storeIds,
    kind: 'regular',
    name: cleanText(p.item_title),
    brand: "Trader Joe's",
    size_text: `${p.sales_size} ${cleanText(p.sales_uom_description)}`,
    price: Number.isFinite(price) && price > 0 ? round2(price) : null,
    price_per: perLb ? 'lb' : 'each',
    unit_price: unitPrice(price, size),
    deal_text: null,
    valid_from: today,
    valid_to: null,
    category,
    image: p.primary_image ? `https://www.traderjoes.com${p.primary_image}` : null,
    url: `https://www.traderjoes.com/home/products/pdp/${slug(p.item_title)}-${p.sku}`,
  };
}

export async function fetchTraderJoes(stores) {
  const today = todayPT();
  // sku -> price -> Set(storeIds). Same price at several stores collapses to one record.
  const bySku = new Map();
  const raw = new Map();
  for (const s of stores) {
    for (const cat of CATEGORIES) {
      let pageNo = 1;
      let total = 1;
      do {
        const res = await page(s.storeCode, cat.id, pageNo);
        total = res.page_info?.total_pages ?? 1;
        for (const p of res.items) {
          const key = `${p.sku}|${p.retail_price}`;
          if (!bySku.has(key)) bySku.set(key, new Set());
          bySku.get(key).add(s.id);
          raw.set(key, { p, cat: cat.name });
        }
        pageNo++;
        await sleep(250);
      } while (pageNo <= total);
    }
  }
  const items = [];
  for (const [key, storeSet] of bySku) {
    const { p, cat } = raw.get(key);
    const rec = mapItem(p, [...storeSet], today, cat);
    // If one SKU has different prices at different stores, keep them distinct.
    if (items.some((i) => i.id === rec.id)) rec.id = `${rec.id}-${[...storeSet].join('-')}`;
    items.push(rec);
  }
  return { ads: [], items };
}
