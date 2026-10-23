import {
  CHAINS, todayPT, priceStatus, indexItem, analyzeEntry, estimate, oneStopTrips,
  nearestStore, miles, money, unitLabel, dayLabel, rangeLabel, ago, tokens, matches, compareValue,
  suggest, shortName, dealQtyText,
} from './logic.js';

const DEFAULT_HERE = { lat: 37.6547, lng: -122.4508, label: 'Near South SF' };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
};
const saveList = () => store.set('gp.list', state.list);

// ---------- data ----------
let data = { stores: [], storesById: {}, items: [], chains: {}, status: {} };
let today = todayPT();

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function load() {
  const { stores } = await getJson('data/stores.json');
  data.stores = stores;
  data.storesById = Object.fromEntries(stores.map((s) => [s.id, s]));
  const chains = Object.keys(CHAINS);
  const results = await Promise.allSettled(chains.map((c) => getJson(`data/${c}.json`)));
  const statuses = await Promise.allSettled(chains.map((c) => getJson(`data/status/${c}.json`)));
  data.items = [];
  chains.forEach((c, i) => {
    if (results[i].status === 'fulfilled') {
      data.chains[c] = results[i].value;
      for (const it of results[i].value.items) data.items.push(indexItem(it));
    }
    if (statuses[i].status === 'fulfilled') data.status[c] = statuses[i].value;
  });
}

// ---------- shared bits ----------
/** Item name that opens the product (or ad) page at the store, in a new tab. */
const itemLink = (it) => it.url
  ? `<a class="item-link" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.name)}</a>`
  : esc(it.name);

const dot = (chain) => `<span class="chain-dot" style="background:var(--${chain})" aria-hidden="true"></span>`;

function priceTag(item) {
  if (!item || item.price == null) {
    return `<div class="tag none"><span class="tag-price">${item ? 'See ad' : 'No price'}</span></div>`;
  }
  const sale = item.kind === 'sale';
  const per = item.price_per === 'lb' ? '<small>/lb</small>' : '';
  const unit = item.price_per === 'lb' ? '' : unitLabel(item.unit_price);
  // Deal items show the price after the deal, plus one unit before it.
  let before = '';
  if (item.regular_price) {
    const lb = item.price_per === 'lb' ? '/lb' : '';
    before = item.promo
      ? `<span class="tag-single">${money(item.regular_price)}${lb} for 1</span>`
      : `<span class="tag-before">Was ${money(item.regular_price)}${lb}</span>`;
  }
  const kind = item.promo ? esc(item.deal_text)
    : item.regular_price && item.deal_text ? `${esc(item.deal_text)}`
    : sale ? (item.member_price ? 'Member sale' : 'Sale') : 'Shelf price';
  return `<div class="tag${sale ? ' sale' : ''}">
    <span class="tag-price">${money(item.price)}${per}</span>
    ${item.promo ? `<span class="tag-unit">each ${dealQtyText(item)}</span>` : unit ? `<span class="tag-unit">${unit}</span>` : ''}
    ${before}
    <span class="tag-kind">${kind}</span>
  </div>`;
}

function whereText(item) {
  const n = nearestStore(item, data.storesById, state.here);
  if (!n) return CHAINS[item.chain].name;
  return `${esc(n.store.name)}, ${n.d.toFixed(1)} mi`;
}

function untilText(item) {
  if (item.kind !== 'sale' || !item.valid_to) return '';
  return ` · through ${dayLabel(item.valid_to)}`;
}

// ---------- list view ----------
function renderList() {
  const analyses = state.list.map((e) => analyzeEntry(data.items, e, today));
  $('#listEmpty').hidden = state.list.length > 0;
  $('#list').innerHTML = state.list.map((e, i) => rowHtml(e, analyses[i], i)).join('');
  renderTotal(analyses);
}

function rowHtml(e, a, i) {
  const c = a.chosen;
  const others = Object.values(a.perChain)
    .filter((it) => it.price != null && (!c || it.chain !== c.chain))
    .sort(compareValue)
    .map((it) => `${dot(it.chain)}${CHAINS[it.chain].name} ${money(it.price)}${it.price_per === 'lb' ? '/lb' : ''}`)
    .join('&ensp; ');
  const open = state.open === e.id;
  const soon = a.soon
    ? `<p class="upcoming-note">${CHAINS[a.soon.chain].name} drops to ${money(a.soon.price)} on ${dayLabel(a.soon.valid_from)}</p>`
    : '';
  const where = c
    ? `<p class="row-where">${dot(c.chain)}<b>${itemLink(c)}</b><br>${whereText(c)}${untilText(c)}${a.pinned ? ' · your pick' : ''}</p>`
    : a.active.length
      ? `<p class="row-where">${a.active.length} ad mention${a.active.length > 1 ? 's' : ''} without a listed price</p>`
      : `<p class="nomatch">No store has a price for ${esc(e.q)} this week.</p>`;

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
      <p class="match-meta">${meta}</p>
      <div class="match-price">
        <strong>${it.price != null ? money(it.price) + (it.price_per === 'lb' ? '/lb' : '') : 'See ad'}</strong>
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
  const trips = oneStopTrips(analyses, state.list);
  $('#tripPanel').innerHTML = trips.length
    ? trips.map((t) => {
        const s = data.stores.filter((x) => x.chain === t.chain).map((x) => ({ x, d: miles(state.here, x) })).sort((a, b) => a.d - b.d)[0];
        return `<div class="trip-row">
          <p>${dot(t.chain)}Only ${CHAINS[t.chain].name}</p>
          <p class="sub">${t.covered} of ${est.count} items${s ? ` · ${esc(s.x.name)}, ${s.d.toFixed(1)} mi` : ''}</p>
          <span class="amt">${money(t.total)}</span>
        </div>`;
      }).join('')
    : '<p class="sub">No single store has priced matches yet.</p>';
}

// ---------- deals view ----------
function renderDeals() {
  const chips = [['all', 'All stores'], ...Object.entries(CHAINS).map(([k, v]) => [k, v.name])];
  $('#chainFilter').innerHTML = chips
    .map(([k, label]) => `<button type="button" class="chip" data-chain="${k}" aria-pressed="${state.dealChain === k}">${k === 'all' ? '' : dot(k)}${esc(label)}</button>`)
    .join('');

  const q = tokens(state.dealQuery);
  const sale = data.items.filter((it) => it.kind === 'sale' && (state.dealChain === 'all' || it.chain === state.dealChain) && (!q.length || matches(it, q)));
  const active = sale.filter((it) => priceStatus(it, today) === 'active');
  const upcoming = sale.filter((it) => priceStatus(it, today) === 'upcoming');

  if (!data.items.length) {
    $('#deals').innerHTML = '<div class="empty"><p>No ad prices yet. They appear after the first daily update runs.</p></div>';
    return;
  }

  const groups = [];
  for (const chain of Object.keys(CHAINS)) {
    const list = active.filter((i) => i.chain === chain);
    if (!list.length) continue;
    const ads = [...new Map(list.map((i) => [i.ad_id, i])).values()];
    const windows = ads.map((i) => `${esc(i.ad_name || 'Ad')}: ${rangeLabel(i.valid_from, i.valid_to)}`).join('<br>');
    list.sort((a, b) => (a.price == null) - (b.price == null) || a.name.localeCompare(b.name));
    groups.push({ chain, title: CHAINS[chain].name, windows, list });
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
function renderStores() {
  const parts = [];
  for (const [chain, meta] of Object.entries(CHAINS)) {
    const st = data.status[chain];
    const file = data.chains[chain];
    let fresh;
    if (st?.ok || (st?.at && !st?.last_error)) {
      fresh = `<p class="fresh">Updated ${ago(st.at)}${st.ads?.length ? ` · ${st.ads.map((a) => rangeLabel(a.valid_from, a.valid_to)).join(', ')}` : ''}</p>`;
    } else if (file) {
      fresh = `<p class="fresh">Updated ${ago(file.fetched_at)}</p>`;
    } else {
      fresh = '<p class="fresh">Not fetched yet</p>';
    }
    if (st?.last_error) fresh += `<p class="fresh bad">Last update failed ${ago(st.last_error.at)}: ${esc(st.last_error.error)}</p>`;
    const stores = data.stores
      .filter((s) => s.chain === chain)
      .map((s) => ({ s, d: miles(state.here, s) }))
      .sort((a, b) => a.d - b.d)
      .map(({ s, d }) => `<div class="store">
        <p class="name">${esc(s.name)}</p>
        <span class="dist">${d.toFixed(1)} mi</span>
        <p class="addr">${esc(s.address)}</p>
        ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
      </div>`).join('');
    parts.push(`<div class="store-group"><h2>${dot(chain)}${meta.name}</h2>${fresh}${stores}</div>`);
  }
  $('#stores').innerHTML = parts.join('');
}

// ---------- events ----------
function render() {
  today = todayPT();
  if (state.tab === 'list') renderList();
  if (state.tab === 'deals') { renderDeals(); renderList(); }
  if (state.tab === 'stores') { renderStores(); renderList(); }
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
  opts = text ? suggest(data.items, text, today) : [];
  activeOpt = 0;
  if (!opts.length) return closeSuggest();
  const firstProduct = opts.findIndex((o) => o.type === 'product');
  box.innerHTML = opts.map((o, i) => {
    const sep = i === firstProduct && i > 0 ? '<li class="opt-sep" role="presentation"></li>' : '';
    let meta;
    if (o.type === 'generic') {
      meta = o.count ? `${o.count} match${o.count > 1 ? 'es' : ''} at ${o.chains.map((c) => CHAINS[c].name).join(', ')}`
        : o.count === 0 ? 'No store has a price this week' : 'Add as typed';
    } else {
      meta = o.chains.map((c) => `${dot(c)}${CHAINS[c].name}`).join('&ensp;');
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
  if (!opts.length) opts = suggest(data.items, text, today);
  // Enter (or Add) takes the highlighted suggestion; top one is the plain item.
  choose(opts[activeOpt] || { type: 'generic', q: text });
});

function addItem(q, mode = 'generic') {
  state.list.push({ id: Math.random().toString(36).slice(2, 9), q, mode, qty: 1, pin: null });
  saveList();
  render();
}

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.tab) return switchTab(b.dataset.tab);
  if (b.dataset.chain) { state.dealChain = b.dataset.chain; state.dealLimit = 60; return renderDeals(); }
  const act = b.dataset.act;
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

$('#locBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  $('#locLabel').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (p) => {
      state.here = { lat: p.coords.latitude, lng: p.coords.longitude, label: 'Near you' };
      store.set('gp.here', state.here);
      $('#locLabel').textContent = state.here.label;
      render();
    },
    () => { $('#locLabel').textContent = state.here.label; },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
  );
});

// Re-evaluate prices when the app comes back to the foreground (e.g. after midnight Tuesday).
document.addEventListener('visibilitychange', () => { if (!document.hidden && todayPT() !== today) render(); });

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
})();
