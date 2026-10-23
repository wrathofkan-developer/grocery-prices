// Pure logic shared by the app and the tests. No DOM here.

export const CHAINS = {
  safeway: { name: 'Safeway' },
  traderjoes: { name: "Trader Joe's" },
  sprouts: { name: 'Sprouts' },
  costco: { name: 'Costco' },
};

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
export const todayPT = (now = new Date()) => ymd.format(now);

/** Same rule as the fetchers: keyed on the ad's own start/end dates. */
export function priceStatus(item, today) {
  if (!item.valid_from) return 'unknown';
  if (today < item.valid_from) return 'upcoming';
  if (item.valid_to && today > item.valid_to) return 'expired';
  return 'active';
}

// ---------- search ----------

const STOP = new Set(['or', 'and', 'the', 'a', 'of', 'with', 'select', 'selected', 'varieties', 'variety']);
function singular(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ches|shes|xes|oes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
export function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map(singular);
}

/** Pre-compute search keys once per item. */
export function indexItem(item) {
  const t = tokens(`${item.name} ${item.brand || ''}`);
  return { ...item, _tok: t, _joined: t.join('') };
}

/** Every query word must start some word in the item ("oat milk" also matches "oatmilk"). */
export function matches(item, qTokens) {
  if (!qTokens.length) return false;
  const allWords = qTokens.every((q) => item._tok.some((w) => w.startsWith(q)));
  if (allWords) return true;
  return qTokens.length > 1 && item._joined.includes(qTokens.join(''));
}

/** Lower is better: unit price when two items share a unit, else shelf price. */
export function compareValue(a, b) {
  if (a.price == null && b.price == null) return 0;
  if (a.price == null) return 1;
  if (b.price == null) return -1;
  if (a.unit_price && b.unit_price && a.unit_price.unit === b.unit_price.unit) {
    return a.unit_price.value - b.unit_price.value;
  }
  return a.price - b.price;
}

export function findMatches(items, query, today) {
  const q = tokens(query);
  const out = [];
  for (const it of items) {
    if (priceStatus(it, today) === 'expired') continue;
    if (matches(it, q)) out.push(it);
  }
  return out;
}

/**
 * For one list entry: active matches ranked, best per chain, overall best,
 * and any upcoming ad price that beats today's best.
 */
export function analyzeEntry(items, entry, today) {
  const all = findMatches(items, entry.q, today);
  const active = all.filter((i) => priceStatus(i, today) === 'active').sort(compareValue);
  const upcoming = all.filter((i) => priceStatus(i, today) === 'upcoming').sort(compareValue);
  const perChain = {};
  for (const it of active) if (!perChain[it.chain] || compareValue(it, perChain[it.chain]) < 0) perChain[it.chain] = it;
  const pinned = entry.pin ? active.find((i) => i.id === entry.pin) || null : null;
  const best = active.find((i) => i.price != null) || null;
  const chosen = pinned || best;
  const soon = upcoming.find((u) => u.price != null && (!chosen || compareValue(u, chosen) < 0)) || null;
  return { active, upcoming, perChain, best, pinned, chosen, soon };
}

export function lineCost(item, qty) {
  if (!item || item.price == null) return null;
  return Math.round(item.price * qty * 100) / 100;
}

/** Total of the cheapest choice for each entry. */
export function estimate(analyses, list) {
  let total = 0, priced = 0;
  list.forEach((e, i) => {
    const c = lineCost(analyses[i].chosen, e.qty);
    if (c != null) { total += c; priced++; }
  });
  return { total: Math.round(total * 100) / 100, priced, count: list.length };
}

/** If you only went to one chain: cost of what it carries and how much of the list that covers. */
export function oneStopTrips(analyses, list) {
  const res = {};
  for (const chain of Object.keys(CHAINS)) {
    let total = 0, covered = 0;
    list.forEach((e, i) => {
      const it = analyses[i].perChain[chain];
      const c = lineCost(it, e.qty);
      if (c != null) { total += c; covered++; }
    });
    res[chain] = { chain, total: Math.round(total * 100) / 100, covered };
  }
  return Object.values(res).filter((r) => r.covered > 0).sort((a, b) => b.covered - a.covered || a.total - b.total);
}

// ---------- distance ----------

export function miles(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest store that the price applies to. */
export function nearestStore(item, storesById, here) {
  let best = null;
  for (const id of item.stores || []) {
    const s = storesById[id];
    if (!s) continue;
    const d = miles(here, s);
    if (!best || d < best.d) best = { store: s, d };
  }
  return best;
}

// ---------- formatting ----------

export const money = (n) => `$${n.toFixed(2)}`;

const UNIT_LABEL = { oz: 'oz', fl_oz: 'fl oz', ct: 'ea' };
export function unitLabel(up) {
  if (!up) return '';
  const v = up.value;
  return v >= 0.995 ? `$${v.toFixed(2)}/${UNIT_LABEL[up.unit]}` : `${(v * 100).toFixed(1)}¢/${UNIT_LABEL[up.unit]}`;
}

const fmtDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
export function dayLabel(iso) {
  return iso ? fmtDay.format(new Date(`${iso}T12:00:00Z`)) : '';
}
const fmtShort = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
export function rangeLabel(from, to) {
  if (!from) return '';
  const a = fmtShort.format(new Date(`${from}T12:00:00Z`));
  return to ? `${a} to ${fmtShort.format(new Date(`${to}T12:00:00Z`))}` : `since ${a}`;
}

export function ago(iso, now = Date.now()) {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}
