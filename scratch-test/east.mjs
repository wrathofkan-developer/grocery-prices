import fs from 'node:fs';
const R = new URL('../docs/', import.meta.url).pathname;
const L = await import(R + 'logic.js');
const { SUPABASE_URL: U, SUPABASE_ANON_KEY: K } = await import(R + 'config.js');
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };
const zipPt = (z) => { const t = JSON.parse(fs.readFileSync(`${R}data/zip/${z.slice(0,3)}.json`)); const h = t[z]; return h && { lat: h[0], lng: h[1] }; };
const kro = async (p) => { const r = await fetch(`${U}/functions/v1/kroger?${new URLSearchParams(p)}`, { headers: { apikey: K } }); return [r.status, await r.json()]; };
const ZIPS = process.argv.slice(2);
const TERMS = ['eggs', 'milk', 'bananas', 'chicken breast', 'butter', 'bread'];
for (const zip of ZIPS) {
  const here = zipPt(zip); const radius = 15;
  console.log(`\n===== ${zip} ${JSON.stringify(here)}`);
  const own = await (await fetch(`${U}/rest/v1/rpc/stores_near`, { method: 'POST', headers: H, body: JSON.stringify({ p_lat: here.lat, p_lng: here.lng, p_miles: radius }) })).json();
  const [ks, kj] = await kro({ action: 'locations', lat: here.lat.toFixed(3), lng: here.lng.toFixed(3), miles: radius });
  const byId = new Map(own.map((s) => [s.id, s])); for (const s of kj.stores || []) if (!byId.has(s.id)) byId.set(s.id, s);
  const stores = [...byId.values()]; const sById = Object.fromEntries(stores.map((s) => [s.id, s]));
  console.log(`own stores: ${own.length}; kroger status ${ks}: ${(kj.stores||[]).length}`, kj.error || '');
  for (const s of stores.map((s) => ({ s, d: L.miles(here, s) })).sort((a,b)=>a.d-b.d).slice(0,6)) console.log(`  ${s.s.chain}/${s.s.banner||''} ${s.s.name} | ${s.s.address} | tz ${s.s.tz} | ${s.d.toFixed(1)} mi`);
  let ads = [];
  if (own.length) ads = (await (await fetch(`${U}/rest/v1/ad_items?select=data&stores=ov.{${own.map(s=>s.id).join(',')}}`, { headers: H })).json()).map((r) => r.data);
  const kIds = stores.filter((s) => s.chain === 'kroger').map(s=>({s,d:L.miles(here,s)})).sort((a,b)=>a.d-b.d).slice(0, 3).map((x) => x.s.id);
  const items = ads.map((it) => L.indexItem(it, sById));
  for (const t of TERMS) {
    if (!kIds.length) break;
    const [st, j] = await kro({ action: 'products', term: t, stores: kIds.join(',') });
    if (st !== 200) console.log('  products', t, st, j.error);
    for (const it of j.items || []) items.push(L.indexItem(it, sById));
  }
  console.log(`ad items: ${ads.length}; total items: ${items.length}; kroger stores used: ${kIds.join(',')}`);
  for (const t of TERMS) {
    const a = L.analyzeEntry(items, { id: t, q: t, mode: 'generic', qty: 1, pin: null });
    const c = a.chosen;
    if (!c) { console.log(`  ${t}: no price`); continue; }
    const st = L.nearestStore(c, sById, here);
    console.log(`  ${t}: ${L.money(c.price)}${c.price_per==='lb'?'/lb':''} ${c.kind}${c.regular_price?` (reg ${c.regular_price})`:''} | ${c.name} ${c.size_text||''} | ${L.chainName(c.chain, st?.store?.banner)} ${st?.store?.name} | valid ${c.valid_from}..${c.valid_to} tz ${c._tz} status ${L.priceStatus(c)} | ${c.url||''}`);
  }
}
