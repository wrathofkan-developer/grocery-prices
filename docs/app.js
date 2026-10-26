import {
  CHAINS, chainName, todayIn, todayPT, priceStatus, indexItem, analyzeEntry, estimate, oneStopTrips,
  nearestStore, miles, money, unitLabel, dayLabel, rangeLabel, ago, tokens, matches, compareValue,
  suggest, shortName, dealQtyText, STAPLES, userPriceItem, addDays, USER_PRICE_DAYS,
} from './logic.js';
import * as api from './backend.js';

const DEFAULT_HERE = { lat: 37.6547, lng: -122.4508, label: 'Near South SF' };
const RADIUS_MILES = 15;
const AD_CHAINS = ['safeway', 'traderjoes', 'sprouts', 'costco'];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';

// ---------- saved state (per phone) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const state = {
  list: store.get('gp.list', []),
  here: store.get('gp.here', DEFAULT_HERE),
  open: null,
  tab: 'list',
  dealChain: 'all',
  dealQuery: '',
  dealLimit: 60,
  user: null,
  profileName: null,
};
const saveList = () => store.set('gp.list', state.list);

// ---------- data ----------
// items = ad items + prices friends added + Kroger results for list items
const data = {
  stores: [], storesById: {}, chains: {}, status: {},
  adItems: [], userItems: [], krogerByTerm: new Map(), items: [],
  mode: api.enabled ? 'server' : 'static',
};

function rebuildItems() {
  const seen = new Set();
  data.items = [];
  for (const it of [...data.adItems, ...data.userItems, ...[...data.krogerByTerm.values()].flat()]) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    data.items.push(it);
  }
}

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

function setStores(stores) {
  data.stores = stores;
  data.storesById = Object.fromEntries(stores.map((s) => [s.id, s]));
}

async function loadStatus() {
  const res = await Promise.allSettled(AD_CHAINS.map((c) => getJson(`data/status/${c}.json`)));
  AD_CHAINS.forEach((c, i) => { if (res[i].status === 'fulfilled') data.status[c] = res[i].value; });
}

/** The original way: our stores and this week's data files. */
async function loadStatic() {
  const { stores } = await getJson('data/stores.json');
  setStores(stores);
  const results = await Promise.allSettled(AD_CHAINS.map((c) => getJson(`data/${c}.json`)));
  data.adItems = [];
  AD_CHAINS.forEach((c, i) => {
    if (results[i].status !== 'fulfilled') return;
    data.chains[c] = results[i].value;
    for (const it of results[i].value.items) data.adItems.push(indexItem(it, data.storesById));
  });
  data.userItems = [];
  rebuildItems();
}

/** From the shared database: stores near you (any ZIP), their ads, friends' prices. */
async function loadServer() {
  setStores(await api.nearbyStores(state.here, RADIUS_MILES));
  const ads = await api.adItems(data.stores.map((s) => s.id));
  data.adItems = ads.map((it) => indexItem(it, data.storesById));
  data.krogerByTerm.clear();
  await loadUserPrices();
}

async function loadUserPrices() {
  data.userItems = [];
  if (data.mode === 'server' && state.user) {
    const since = addDays(todayPT(), -USER_PRICE_DAYS.regular);
    const { rows, names } = await api.userPrices(data.stores.map((s) => s.id), since);
    data.userItems = rows.map((r) => indexItem(userPriceItem(r, { store: data.storesById[r.store_id], names, me: state.user.id }), data.storesById));
  }
  rebuildItems();
}

async function load() {
  await loadStatus();
  if (data.mode === 'server') {
    try {
      await loadServer();
      return;
    } catch (e) {
      console.warn('Server unavailable, using saved data files', e);
      toast("Couldn't reach the shared database; showing this area's saved prices.");
      data.mode = 'static';
    }
  }
  await loadStatic();
}

// Kroger prices are looked up per list item (they have no weekly ad to download).
const krogerPending = new Set();
function ensureKroger() {
  if (data.mode !== 'server') return;
  const krogerIds = data.stores.filter((s) => s.chain === 'kroger').slice(0, 3).map((s) => s.id);
  if (!krogerIds.length) return;
  for (const e of state.list) {
    const key = e.q.toLowerCase();
    if (data.krogerByTerm.has(key) || krogerPending.has(key)) continue;
    krogerPending.add(key);
    api.krogerProducts(e.q, krogerIds)
      .then((items) => data.krogerByTerm.set(key, items.map((it) => indexItem(it, data.storesById))))
      .catch((err) => { console.warn('Kroger', err); data.krogerByTerm.set(key, []); })
      .finally(() => { krogerPending.delete(key); rebuildItems(); renderList(); });
  }
}

// ---------- shared bits ----------
/** Item name that opens the product (or ad) page at the store, in a new tab. */
const itemLink = (it) => it.url
  ? `<a class="item-link" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.name)}</a>`
  : esc(it.name);

const dot = (chain) => `<span class="chain-dot" style="background:var(--${CHAINS[chain] ? chain : 'other'})" aria-hidden="true"></span>`;

/** "Safeway", or a Kroger banner like "Ralphs", or a friend-added store's name. */
function labelFor(item) {
  const s = nearestStore(item, data.storesById, state.here)?.store;
  return chainName(item.chain, s?.banner);
}

function priceTag(item) {
  if (!item || item.price == null) {
    return `<div class="tag none"><span class="tag-price">${item ? 'See ad' : 'No price'}</span></div>`;
  }
  const user = item.kind === 'user';
  const sale = item.kind === 'sale' || (user && item.is_sale);
  const per = item.price_per === 'lb' ? '<small>/lb</small>' : '';
  const unit = item.price_per === 'lb' ? '' : unitLabel(item.unit_price, item);
  // Deal items show the price after the deal, plus one unit before it.
  let before = '';
  if (item.regular_price) {
    const lb = item.price_per === 'lb' ? '/lb' : '';
    before = item.promo
      ? `<span class="tag-single">${money(item.regular_price)}${lb} for 1</span>`
      : `<span class="tag-before">Was ${money(item.regular_price)}${lb}</span>`;
  }
  const kind = user ? (item.is_sale ? 'Sale, seen in store' : 'Seen in store')
    : item.promo ? esc(item.deal_text)
    : item.regular_price && item.deal_text ? esc(item.deal_text)
    : sale ? (item.member_price ? 'Member sale' : 'Sale') : 'Shelf price';
  return `<div class="tag${sale ? ' sale' : ''}${user ? ' user' : ''}">
    <span class="tag-price">${money(item.price)}${per}</span>
    ${item.promo ? `<span class="tag-unit">each ${dealQtyText(item)}</span>` : unit ? `<span class="tag-unit">${unit}</span>` : ''}
    ${before}
    <span class="tag-kind">${kind}</span>
  </div>`;
}

function whereText(item) {
  const n = nearestStore(item, data.storesById, state.here);
  if (!n) return esc(labelFor(item));
  return `${esc(n.store.name)}, ${n.d.toFixed(1)} mi`;
}

function untilText(item) {
  if (item.kind !== 'sale' || !item.valid_to) return '';
  return ` · through ${dayLabel(item.valid_to)}`;
}

/** "Seen Oct 26 by Mikey · Photo · Delete" for prices people added. */
function seenText(item) {
  if (item.kind !== 'user') return '';
  const photo = item.photo_path ? `<button type="button" data-act="photo" data-path="${esc(item.photo_path)}">Photo</button>` : '';
  const del = item.mine ? `<button type="button" data-act="del-price" data-id="${esc(item.id.slice(5))}" data-path="${esc(item.photo_path || '')}">Delete</button>` : '';
  return `<span class="seen">Seen ${dayLabel(item.seen_on)} by ${esc(item.seen_by)}${photo}${del}</span>`;
}

// ---------- list view ----------
function renderList() {
  ensureKroger();
  const analyses = state.list.map((e) => analyzeEntry(data.items, e));
  $('#listEmpty').hidden = state.list.length > 0;
  $('#list').innerHTML = state.list.map((e, i) => rowHtml(e, analyses[i], i)).join('');
  renderTotal(analyses);
}

function rowHtml(e, a, i) {
  const c = a.chosen;
  const others = Object.values(a.perChain)
    .filter((it) => it.price != null && (!c || it.chain !== c.chain))
    .sort(compareValue)
    .map((it) => `${dot(it.chain)}${esc(labelFor(it))} ${money(it.price)}${it.price_per === 'lb' ? '/lb' : ''}`)
    .join('&ensp; ');
  const open = state.open === e.id;
  const soon = a.soon
    ? `<p class="upcoming-note">${esc(labelFor(a.soon))} drops to ${money(a.soon.price)} on ${dayLabel(a.soon.valid_from)}</p>`
    : '';
  const loadingKroger = data.mode === 'server' && krogerPending.has(e.q.toLowerCase());
  const where = c
    ? `<p class="row-where">${dot(c.chain)}<b>${itemLink(c)}</b><br>${whereText(c)}${untilText(c)}${a.pinned ? ' · your pick' : ''}${c.kind === 'user' ? `<br>${seenText(c)}` : ''}</p>`
    : a.active.length
      ? `<p class="row-where">${a.active.length} ad mention${a.active.length > 1 ? 's' : ''} without a listed price</p>`
      : `<p class="nomatch">${loadingKroger ? 'Checking Kroger stores…' : `No store has a price for ${esc(e.q)} this week.`}</p>`;

  return `<li class="row" data-id="${e.id}">
    <div class="row-head">
      <p class="row-name">${esc(e.q)}</p>
      <div class="row-tag">${priceTag(c || (a.active[0] ?? null))}</div>
      ${where}
    </div>
    ${others ? `<p class="others">Also ${others}</p>` : ''}
    ${soon}
    <div class="row-tools">
      <div class="qty" aria-label="Quantity">
        <button type="button" data-act="dec" data-i="${i}" aria-label="Fewer">−</button>
        <span aria-live="polite">${e.qty}</span>
        <button type="button" data-act="inc" data-i="${i}" aria-label="More">+</button>
      </div>
      ${a.active.length > 1 ? `<button type="button" class="link-btn" data-act="toggle" data-i="${i}" aria-expanded="${open}">${open ? 'Hide' : `See all ${a.active.length} matches`}</button>` : ''}
      <button type="button" class="link-btn danger" data-act="remove" data-i="${i}" aria-label="Remove ${esc(e.q)}">Remove</button>
    </div>
    ${open ? matchesHtml(e, a, i) : ''}
  </li>`;
}

function matchesHtml(e, a, i) {
  const rows = a.active.slice(0, 25).map((it) => {
    const pinned = e.pin === it.id;
    const meta = [whereText(it), it.size_text ? esc(it.size_text) : '', it.deal_text ? esc(it.deal_text) : ''].filter(Boolean).join(' · ');
    return `<li class="match">
      <p class="match-name">${dot(it.chain)}${itemLink(it)}</p>
      <p class="match-meta">${meta}${it.kind === 'user' ? `<br>${seenText(it)}` : ''}</p>
      <div class="match-price">
        <strong>${it.price != null ? money(it.price) + (it.price_per === 'lb' ? '/lb' : '') : 'See ad'}</strong>
        ${it.price != null && it.price_per !== 'lb' && unitLabel(it.unit_price, it) ? `<span class="match-unit">${unitLabel(it.unit_price, it)}</span>` : ''}
        ${it.price != null ? `<button type="button" data-act="pin" data-i="${i}" data-item="${esc(it.id)}" aria-pressed="${pinned}">${pinned ? 'Picked' : 'Pick this'}</button>` : ''}
      </div>
    </li>`;
  }).join('');
  return `<ul class="matches">${rows}</ul>`;
}

function renderTotal(analyses) {
  const bar = $('#totalBar');
  bar.hidden = state.list.length === 0;
  if (!state.list.length) return;
  const est = estimate(analyses, state.list);
  $('#totalAmount').textContent = money(est.total);
  const missing = est.count - est.priced;
  $('#totalNote').textContent = missing
    ? `Lowest price for ${est.priced} of ${est.count} items. ${missing} ${missing > 1 ? "don't have" : "doesn't have"} a listed price yet.`
    : est.count === 1 ? 'Lowest price nearby.' : `Lowest price for all ${est.count} items, mixing stores.`;
  // A one-stop trip is one chain; friend-added stores are each their own, so they're left out.
  const trips = oneStopTrips(analyses, state.list).filter((t) => t.chain !== 'other');
  $('#tripPanel').innerHTML = trips.length
    ? trips.map((t) => {
        const s = data.stores.filter((x) => x.chain === t.chain).map((x) => ({ x, d: miles(state.here, x) })).sort((a, b) => a.d - b.d)[0];
        return `<div class="trip-row">
          <p>${dot(t.chain)}Only ${esc(chainName(t.chain, s?.x.banner))}</p>
          <p class="sub">${t.covered} of ${est.count} items${s ? ` · ${esc(s.x.name)}, ${s.d.toFixed(1)} mi` : ''}</p>
          <span class="amt">${money(t.total)}</span>
        </div>`;
      }).join('')
    : '<p class="sub">No single store has priced matches yet.</p>';
}

// ---------- deals view ----------
function renderDeals() {
  const sale = data.items.filter((it) => it.kind === 'sale');
  const present = Object.keys(CHAINS).filter((k) => sale.some((it) => it.chain === k));
  const chips = [['all', 'All stores'], ...present.map((k) => [k, CHAINS[k].name])];
  $('#chainFilter').innerHTML = chips
    .map(([k, label]) => `<button type="button" class="chip" data-chain="${k}" aria-pressed="${state.dealChain === k}">${k === 'all' ? '' : dot(k)}${esc(label)}</button>`)
    .join('');

  const q = tokens(state.dealQuery);
  const shown0 = sale.filter((it) => (state.dealChain === 'all' || it.chain === state.dealChain) && (!q.length || matches(it, q)));
  const active = shown0.filter((it) => priceStatus(it) === 'active');
  const upcoming = shown0.filter((it) => priceStatus(it) === 'upcoming');

  if (!data.items.length) {
    $('#deals').innerHTML = '<div class="empty"><p>No ad prices for stores near here yet.</p></div>';
    return;
  }

  const groups = [];
  for (const chain of Object.keys(CHAINS)) {
    const list = active.filter((i) => i.chain === chain);
    if (!list.length) continue;
    const ads = [...new Map(list.filter((i) => i.ad_id).map((i) => [i.ad_id, i])).values()];
    const windows = ads.length
      ? ads.map((i) => `${esc(i.ad_name || 'Ad')}: ${rangeLabel(i.valid_from, i.valid_to)}`).join('<br>')
      : chain === 'kroger' ? 'Sale prices for items on your list' : '';
    list.sort((a, b) => (a.price == null) - (b.price == null) || a.name.localeCompare(b.name));
    groups.push({ chain, title: chainName(chain, list.map(labelFor)[0]), windows, list });
  }
  if (upcoming.length) {
    const starts = [...new Set(upcoming.map((i) => i.valid_from))].sort();
    groups.push({ chain: null, title: 'Starting soon', windows: `Takes effect ${starts.map(dayLabel).join(', ')}. Posted early, not active yet.`, list: upcoming.sort((a, b) => a.chain.localeCompare(b.chain) || a.name.localeCompare(b.name)) });
  }

  let shown = 0;
  const html = groups.map((g) => {
    const rows = [];
    for (const it of g.list) {
      if (shown >= state.dealLimit) break;
      shown++;
      rows.push(`<div class="deal">
        <p class="name">${g.chain ? '' : dot(it.chain)}${itemLink(it)}</p>
        <p class="meta">${[it.size_text, it.deal_text].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</p>
        ${priceTag(it)}
        <button type="button" class="deal-add" data-act="add-deal" data-name="${esc(shortName(it.name))}">Add to list</button>
      </div>`);
    }
    if (!rows.length) return '';
    return `<div class="deal-group"><h2>${g.chain ? dot(g.chain) : ''}${esc(g.title)}</h2><p class="window">${g.windows}</p>${rows.join('')}</div>`;
  }).join('');

  const total = groups.reduce((n, g) => n + g.list.length, 0);
  $('#deals').innerHTML = (html || '<div class="empty"><p>No deals match that search.</p></div>') +
    (total > shown ? `<button type="button" class="more" data-act="more">Show more (${total - shown} left)</button>` : '');
}

// ---------- stores view ----------
function freshness(chain) {
  const st = data.status[chain];
  let html;
  if (st?.ok || (st?.at && !st?.last_error)) {
    html = `<p class="fresh">Updated ${ago(st.at)}${st.ads?.length ? ` · ${st.ads.map((a) => rangeLabel(a.valid_from, a.valid_to)).join(', ')}` : ''}</p>`;
  } else if (data.chains[chain]) {
    html = `<p class="fresh">Updated ${ago(data.chains[chain].fetched_at)}</p>`;
  } else {
    html = '<p class="fresh">Not fetched yet</p>';
  }
  if (st?.last_error) html += `<p class="fresh bad">Last update failed ${ago(st.last_error.at)}: ${esc(st.last_error.error)}</p>`;
  return html;
}

function renderStores() {
  const groups = new Map();
  for (const s of data.stores) {
    const key = s.chain === 'kroger' || s.chain === 'other' ? `${s.chain}:${s.banner || s.name}` : s.chain;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ s, d: miles(state.here, s) });
  }
  const parts = [...groups.entries()]
    .map(([key, list]) => ({ key, list: list.sort((a, b) => a.d - b.d) }))
    .sort((a, b) => a.list[0].d - b.list[0].d)
    .map(({ list }) => {
      const s0 = list[0].s;
      const fresh = AD_CHAINS.includes(s0.chain) ? freshness(s0.chain)
        : s0.chain === 'kroger' ? '<p class="fresh">Live prices from Kroger, checked when you add an item</p>'
        : '<p class="fresh">Added by a friend · prices come from what people add</p>';
      const stores = list.map(({ s, d }) => `<div class="store">
        <p class="name">${esc(s.name)}</p>
        <span class="dist">${d.toFixed(1)} mi</span>
        <p class="addr">${esc(s.address || '')}</p>
        ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
      </div>`).join('');
      return `<div class="store-group"><h2>${dot(s0.chain)}${esc(chainName(s0.chain, s0.banner))}</h2>${fresh}${stores}</div>`;
    });
  $('#stores').innerHTML = parts.join('') || `<div class="empty"><p>No stores we know of within ${RADIUS_MILES} miles. ${api.enabled ? 'Sign in and add a price to add a store.' : ''}</p></div>`;
}

// ---------- rendering ----------
function render() {
  if (state.tab === 'list') renderList();
  if (state.tab === 'deals') { renderDeals(); renderList(); }
  if (state.tab === 'stores') { renderStores(); renderList(); }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------- add box with suggestions ----------
// The person picks what they mean before anything is added:
// a plain item ("eggs" = things that ARE eggs) or a specific product ("Egg Nog").
const input = $('#addInput');
const box = $('#suggestBox');
let opts = [];
let activeOpt = 0;

function renderSuggest() {
  const text = input.value.trim();
  opts = text ? suggest(data.items, text) : [];
  activeOpt = 0;
  if (!opts.length) return closeSuggest();
  const firstProduct = opts.findIndex((o) => o.type === 'product');
  box.innerHTML = opts.map((o, i) => {
    const sep = i === firstProduct && i > 0 ? '<li class="opt-sep" role="presentation"></li>' : '';
    let meta;
    if (o.type === 'generic') {
      meta = o.count ? `${o.count} match${o.count > 1 ? 'es' : ''} at ${o.chains.map((c) => esc(CHAINS[c]?.name || c)).join(', ')}`
        : o.count === 0 ? 'No store has a price this week' : 'Add as typed';
    } else {
      meta = o.chains.map((c) => `${dot(c)}${esc(CHAINS[c]?.name || c)}`).join('&ensp;');
    }
    const price = o.low != null ? `<span class="opt-price">${money(o.low)}</span>` : '';
    return `${sep}<li id="opt-${i}" class="opt ${o.type}" role="option" aria-selected="${i === activeOpt}" data-i="${i}">
      <span class="opt-name">${esc(o.label)}</span>${price}<span class="opt-meta">${meta}</span></li>`;
  }).join('');
  box.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-activedescendant', `opt-${activeOpt}`);
}

function closeSuggest() {
  box.hidden = true;
  box.innerHTML = '';
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
}

function moveActive(d) {
  if (!opts.length) return;
  activeOpt = (activeOpt + d + opts.length) % opts.length;
  for (const el of box.querySelectorAll('.opt')) el.setAttribute('aria-selected', String(Number(el.dataset.i) === activeOpt));
  box.querySelector(`#opt-${activeOpt}`)?.scrollIntoView({ block: 'nearest' });
  input.setAttribute('aria-activedescendant', `opt-${activeOpt}`);
}

function choose(o) {
  addItem(o.q, o.type === 'product' ? 'product' : 'generic');
  input.value = '';
  closeSuggest();
}

let typeTimer;
input.addEventListener('input', () => { clearTimeout(typeTimer); typeTimer = setTimeout(renderSuggest, 80); });
input.addEventListener('focus', () => { if (input.value.trim()) renderSuggest(); });
input.addEventListener('blur', () => setTimeout(closeSuggest, 150));
input.addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowDown') { ev.preventDefault(); if (box.hidden) renderSuggest(); else moveActive(1); }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); moveActive(-1); }
  else if (ev.key === 'Escape') closeSuggest();
});
// pointerdown so the pick lands before the input's blur closes the list.
box.addEventListener('pointerdown', (ev) => {
  const li = ev.target.closest('.opt');
  if (!li) return;
  ev.preventDefault();
  choose(opts[Number(li.dataset.i)]);
});

$('#addForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  if (!opts.length) opts = suggest(data.items, text);
  // Enter (or Add) takes the highlighted suggestion; top one is the plain item.
  choose(opts[activeOpt] || { type: 'generic', q: text });
});

function addItem(q, mode = 'generic') {
  state.list.push({ id: Math.random().toString(36).slice(2, 9), q, mode, qty: 1, pin: null });
  saveList();
  render();
}

// ---------- clicks ----------
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.matches('[data-close]')) return b.closest('dialog')?.close();
  if (b.dataset.tab) return switchTab(b.dataset.tab);
  if (b.dataset.chain) { state.dealChain = b.dataset.chain; state.dealLimit = 60; return renderDeals(); }
  const act = b.dataset.act;
  if (act === 'photo') return openPhoto(b.dataset.path);
  if (act === 'del-price') return deleteMyPrice(b.dataset.id, b.dataset.path);
  const i = Number(b.dataset.i);
  const e = state.list[i];
  if (act === 'inc') e.qty = Math.min(99, e.qty + 1);
  else if (act === 'dec') e.qty = Math.max(1, e.qty - 1);
  else if (act === 'remove') { state.list.splice(i, 1); }
  else if (act === 'toggle') { state.open = state.open === e.id ? null : e.id; }
  else if (act === 'pin') { e.pin = e.pin === b.dataset.item ? null : b.dataset.item; }
  else if (act === 'add-deal') { addItem(b.dataset.name, 'product'); b.textContent = 'Added'; return; }
  else if (act === 'more') { state.dealLimit += 60; return renderDeals(); }
  else return;
  saveList();
  renderList();
});

async function openPhoto(path) {
  // Open the tab right away (phones block pop-ups opened after a wait), then point it at the photo.
  const w = window.open('', '_blank');
  try {
    const url = await api.photoUrl(path);
    if (w) w.location = url; else location.href = url;
  } catch (err) {
    w?.close();
    toast(err.message);
  }
}

async function deleteMyPrice(id, path) {
  if (!window.confirm('Delete this price for everyone?')) return;
  try {
    await api.deletePrice(id, path || null);
    await loadUserPrices();
    render();
    toast('Price deleted');
  } catch (err) { toast(err.message); }
}

$('#tripBtn').addEventListener('click', () => {
  const p = $('#tripPanel');
  p.hidden = !p.hidden;
  $('#tripBtn').setAttribute('aria-expanded', String(!p.hidden));
  $('#tripBtn').textContent = p.hidden ? 'Compare one-stop trips' : 'Hide one-stop trips';
});

let searchTimer;
$('#dealSearch').addEventListener('input', (ev) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.dealQuery = ev.target.value; state.dealLimit = 60; renderDeals(); }, 150);
});

function switchTab(tab) {
  state.tab = tab;
  for (const t of document.querySelectorAll('[role="tab"]')) {
    const on = t.dataset.tab === tab;
    t.setAttribute('aria-selected', String(on));
    $(`#view-${t.dataset.tab}`).hidden = !on;
  }
  render();
  window.scrollTo(0, 0);
}

// ---------- location: ZIP or GPS ----------
async function zipToPoint(zip) {
  const table = await getJson(`data/zip/${zip.slice(0, 3)}.json`).catch(() => ({}));
  const hit = table[zip];
  return hit ? { lat: hit[0], lng: hit[1] } : null;
}

async function setHere(here) {
  state.here = here;
  store.set('gp.here', here);
  $('#locLabel').textContent = here.label;
  if (data.mode === 'server') {
    try { await loadServer(); } catch (e) { toast(`Couldn't load stores: ${e.message}`); }
  }
  render();
}

$('#locBtn').addEventListener('click', () => {
  $('#locError').hidden = true;
  $('#zipInput').value = state.here.zip || '';
  $('#locDialog').showModal();
});

$('#locForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const zip = $('#zipInput').value.trim();
  const err = $('#locError');
  if (!/^\d{5}$/.test(zip)) { err.textContent = 'Enter a 5-digit ZIP code.'; err.hidden = false; return; }
  const pt = await zipToPoint(zip);
  if (!pt) { err.textContent = `We don't have a location for ZIP ${zip}. Try a nearby ZIP.`; err.hidden = false; return; }
  $('#locDialog').close();
  await setHere({ ...pt, label: `Near ${zip}`, zip });
});

function currentPosition(timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error('Location permission was denied or timed out.')),
      { enableHighAccuracy: false, timeout, maximumAge: 600000 },
    );
  });
}

$('#gpsBtn').addEventListener('click', async () => {
  const err = $('#locError');
  $('#gpsBtn').textContent = 'Locating…';
  try {
    const pt = await currentPosition();
    $('#locDialog').close();
    await setHere({ ...pt, label: 'Near you' });
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    $('#gpsBtn').textContent = 'Use my location';
  }
});

// ---------- account ----------
function refreshAccount() {
  if (!api.enabled) return;
  $('#acctBtn').hidden = false;
  $('#addPriceBtn').hidden = false;
  $('#acctLabel').textContent = state.user ? (state.profileName || 'You') : 'Sign in';
  $('#signInForm').hidden = Boolean(state.user);
  $('#profileForm').hidden = !state.user;
  if (state.user) {
    $('#signedInAs').textContent = `Signed in as ${state.user.email}.`;
    $('#nameInput').value = state.profileName || '';
  }
}

async function onSignedIn(user) {
  state.user = user;
  state.profileName = user ? (await api.myProfile(user.id).catch(() => null))?.display_name || null : null;
  refreshAccount();
  await loadUserPrices().catch((e) => toast(e.message));
  render();
  // First sign-in: ask for the name friends will see.
  if (user && !state.profileName) $('#acctDialog').showModal();
}

$('#acctBtn').addEventListener('click', () => { $('#signInMsg').hidden = true; $('#acctDialog').showModal(); });

$('#signInForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('#signInMsg');
  const btn = ev.submitter;
  btn.disabled = true;
  try {
    await api.sendSignInLink($('#emailInput').value.trim());
    msg.textContent = 'Check your email and tap the link. It brings you back here signed in.';
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    msg.hidden = false;
    btn.disabled = false;
  }
});

$('#profileForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $('#nameInput').value.trim();
  if (!name) return;
  try {
    await api.saveProfile(state.user.id, name);
    state.profileName = name;
    refreshAccount();
    $('#acctDialog').close();
    toast('Name saved');
  } catch (e) { toast(e.message); }
});

$('#signOutBtn').addEventListener('click', async () => {
  await api.signOut();
  $('#acctDialog').close();
  await onSignedIn(null);
  toast('Signed out');
});

// ---------- add a price you saw ----------
const NEW_STORE = '__new';

function openPriceDialog() {
  if (!state.user) {
    $('#signInMsg').textContent = 'Sign in first to add prices your friends can see.';
    $('#signInMsg').hidden = false;
    $('#acctDialog').showModal();
    return;
  }
  const f = $('#priceForm');
  f.reset();
  $('#photoPreview').hidden = true;
  $('#photoPrompt').hidden = false;
  $('#priceError').hidden = true;
  $('#newStore').hidden = true;
  $('#dateInput').value = todayIn(localTz());
  $('#dateInput').max = todayIn(localTz());
  const near = [...data.stores].map((s) => ({ s, d: miles(state.here, s) })).sort((a, b) => a.d - b.d);
  $('#storeSelect').innerHTML = '<option value="" disabled selected>Choose the store</option>' +
    near.map(({ s, d }) => `<option value="${esc(s.id)}">${esc(s.name)} · ${d.toFixed(1)} mi</option>`).join('') +
    `<option value="${NEW_STORE}">A store that's not listed…</option>`;
  const names = [...new Set([...state.list.map((e) => e.q), ...STAPLES])];
  $('#itemList').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
  $('#priceDialog').showModal();
}

$('#addPriceBtn').addEventListener('click', openPriceDialog);

$('#storeSelect').addEventListener('change', (ev) => {
  const isNew = ev.target.value === NEW_STORE;
  $('#newStore').hidden = !isNew;
  $('#newStoreName').required = isNew;
});

$('#photoInput').addEventListener('change', (ev) => {
  const file = ev.target.files?.[0];
  const img = $('#photoPreview');
  if (!file) { img.hidden = true; $('#photoPrompt').hidden = false; return; }
  img.src = URL.createObjectURL(file);
  img.hidden = false;
  $('#photoPrompt').hidden = true;
});

function parseMoney(s) {
  const m = String(s).replace(/[$,\s]/g, '').match(/^(\d{1,4})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const v = Number(`${m[1]}.${(m[2] || '0').padEnd(2, '0')}`);
  return v > 0 ? v : null;
}

$('#priceForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = $('#priceError');
  const btn = $('#savePriceBtn');
  err.hidden = true;
  const price = parseMoney($('#priceInput').value);
  if (price == null) { err.textContent = 'Enter the price, like 5.99.'; err.hidden = false; return; }
  let storeId = $('#storeSelect').value;
  if (!storeId) { err.textContent = 'Choose the store.'; err.hidden = false; return; }
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    if (storeId === NEW_STORE) {
      const name = $('#newStoreName').value.trim();
      // Where the new store is: your phone's location if you allow it, else your ZIP's center.
      const pt = await currentPosition(8000).catch(() => ({ lat: state.here.lat, lng: state.here.lng }));
      const s = await api.addStore({ name, banner: name, address: $('#newStoreAddr').value.trim(), ...pt, tz: localTz(), userId: state.user.id });
      setStores([...data.stores, s]);
      storeId = s.id;
    }
    const itemName = $('#itemInput').value.trim();
    await api.addPrice({
      userId: state.user.id,
      storeId,
      itemName,
      price,
      perLb: $('#perLbInput').checked,
      sizeText: $('#sizeInput').value.trim(),
      isSale: $('#saleInput').checked,
      observedOn: $('#dateInput').value,
      photo: $('#photoInput').files?.[0] || null,
    });
    $('#priceDialog').close();
    await loadUserPrices();
    render();
    toast(`Saved ${itemName} at ${money(price)}. Friends can see it now.`);
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save price';
  }
});

// Re-check what's active when the app comes back (a new ad may have started at midnight).
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

(async function start() {
  $('#locLabel').textContent = state.here.label;
  try {
    await load();
  } catch (e) {
    const el = $('#loadError');
    el.hidden = false;
    el.textContent = `Couldn't load store data (${e.message}). Check your connection and reload.`;
  }
  render();
  if (api.enabled) {
    refreshAccount();
    const s = await api.session().catch(() => null);
    if (s?.user) await onSignedIn(s.user);
    api.onAuthChange((sess) => {
      const u = sess?.user || null;
      if ((u?.id || null) !== (state.user?.id || null)) onSignedIn(u);
    });
  }
})();
