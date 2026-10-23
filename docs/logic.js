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

// Words that end a name without being the thing itself ("Milk Half gallon", "Thighs Value Pack").
const TAIL_NOISE = new Set(['gallon', 'half', 'oz', 'fl', 'lb', 'ct', 'count', 'pack', 'value', 'family', 'size', 'bag', 'box', 'bottle', 'jar', 'can', 'carton', 'tub', 'clamshell', 'container', 'pouch', 'sleeve', 'tray', 'bunch', 'dozen', 'large', 'small', 'medium', 'organic', 'fresh', 'frozen', 'pk', 'each', 'ea', 'roll', 'mega', 'triple', 'double',
  // Cut/form words: "Walnut Halves & Pieces" is walnuts, "Pineapple Chunks" is pineapple.
  'halve', 'piece', 'slice', 'chunk', 'floret', 'bit', 'wedge', 'sliver', 'spear', 'baking']);

/**
 * Each product named in an item, with its head noun. Ad copy can list several
 * products ("Nature Valley Bars. Lucerne Milk Half gallon. Chex Cereal").
 */
function segments(name) {
  const out = [];
  for (const seg of String(name).split(/[.,;]|\bor\b|\band\b/i)) {
    // The thing comes before "with"/"in": "Greek Yogurt Made with Whole Milk" is yogurt,
    // "Tuna in Olive Oil" is tuna.
    const core = seg.split(/\s(?:made with|with|in|w\/)\s/i)[0]; // spaces: not "Bone-In"
    const t = tokens(core).filter((w) => !/^\d/.test(w));
    while (t.length && TAIL_NOISE.has(t[t.length - 1])) t.pop();
    if (!t.length) continue;
    out.push({
      tok: t,
      head: t[t.length - 1],
      head2: t.length > 1 ? t[t.length - 2] + t[t.length - 1] : null, // "oat milk" -> "oatmilk"
    });
  }
  return out;
}

/** Pre-compute search keys once per item. */
export function indexItem(item) {
  const t = tokens(`${item.name} ${item.brand || ''}`);
  const segs = segments(item.name);
  const heads = new Set();
  for (const s of segs) { heads.add(s.head); if (s.head2) heads.add(s.head2); }
  return { ...item, _tok: t, _joined: t.join(''), _segs: segs, _heads: heads };
}

// ---------- how "basic" a match is ----------
// When someone adds a plain item like "eggs", the basic version (a carton) should
// win over prepared or flavored ones (Jammy Egg), and a different product that
// merely ends in the same word (peanut butter for "butter") should rank last.

// Modifiers that make an item a prepared/flavored version rather than the plain thing.
const PREPARED = new Set([
  'jammy', 'breaded', 'roasted', 'fried', 'crispy', 'crunchy', 'smoked', 'seasoned', 'flavored', 'spicy', 'glazed',
  'marinated', 'cooked', 'grilled', 'baked', 'stuffed', 'herbed', 'mashed', 'pickled', 'riced', 'dried', 'freeze',
  'canned', 'candied', 'covered', 'coated', 'dipped', 'infused', 'sweetened',
  'salad', 'soup', 'sauce', 'dip', 'spread', 'mix', 'bite', 'chip', 'sandwich', 'burrito', 'frittata', 'wrap', 'bar',
  'snack', 'cake', 'pie', 'cookie', 'cracker', 'candy', 'toffee', 'roll', 'dumpling', 'skewer', 'nugget', 'tender',
  'chocolate', 'cocoa', 'caramel', 'vanilla', 'cinnamon', 'pumpkin', 'honey', 'maple', 'mint', 'teriyaki', 'bbq',
  'buffalo', 'ranch', 'nacho', 'jalapeno', 'chile', 'chili', 'garlic', 'herb', 'sesame', 'walnut', 'pecan', 'fig',
  'strawberry', 'blueberry', 'raspberry', 'mango', 'peach', 'cherry', 'berry', 'lemon', 'lime', 'apple', 'coconut',
  'peeled', 'diced', 'crushed', 'paste', 'asado', 'shawarma', 'adobo', 'chimichurri', 'sous', 'vide', 'curry', 'tikka', 'pesto', 'alfredo', 'cheesy',
]);

// Compounds that are a different product from their last word.
const DISTINCT = [
  'peanut butter', 'almond butter', 'cookie butter', 'apple butter', 'cashew butter', 'sunflower butter',
  'granola butter', 'seed butter', 'fig butter',
  'cream cheese', 'cottage cheese', 'macaroni and cheese', 'mac and cheese', 'mac n cheese', 'string cheese',
  'ice cream', 'sour cream', 'whipped cream', 'chocolate milk', 'coconut milk', 'oat milk', 'almond milk', 'soy milk',
  'sweet potatoes', 'green onions', 'green beans', 'hot dogs', 'corn dogs', 'tortilla chips', 'potato chips',
  'chicken broth', 'vegetable broth', 'coffee cake', 'corn bread', 'banana bread', 'pita bread', 'garlic bread',
].map((s) => tokens(s));

const sameTokens = (a, b) => a.length === b.length && a.every((w, i) => w === b[i]);

/** The product segment within an item that the plain term refers to. */
function matchingSegment(item, termTokens) {
  const joined = termTokens.join('');
  const last = termTokens[termTokens.length - 1];
  return item._segs.find((s) => s.head2 === joined || s.head === joined) ||
    item._segs.find((s) => s.head === last) || null;
}

/**
 * 0 = the plain thing, 1 = a prepared/flavored version, 2 = a different product
 * that ends in the same word. Lower ranks first.
 */
export function basicTier(item, termTokens) {
  const seg = matchingSegment(item, termTokens);
  if (!seg) return 2;
  const last = termTokens[termTokens.length - 1];
  for (const d of DISTINCT) {
    // Skip compounds that are the search itself or part of it ("cheddar cheese" isn't excluded by "cheese").
    if (d[d.length - 1] !== last || d.every((w) => termTokens.includes(w))) continue;
    // "Peanut Butter" for "butter", "Macaroni & Cheese" for "cheddar cheese".
    if (seg.tok.length >= d.length && sameTokens(seg.tok.slice(seg.tok.length - d.length), d)) return 2;
  }
  // Matched only as a later item in ad copy or an ingredient list ("…Bark, Almonds, Sea Salt").
  if (item._segs.indexOf(seg) > 0) return 1;
  const extra = seg.tok.filter((w) => !termTokens.includes(w));
  return extra.some((w) => PREPARED.has(w)) ? 1 : 0;
}

/** "No Salt", "Salt-Free" are not salt. */
function negated(item, termTokens) {
  const last = termTokens[termTokens.length - 1];
  const t = item._tok;
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== last) continue;
    if (t[i - 1] === 'no' || t[i - 1] === 'without' || t[i + 1] === 'free') return true;
  }
  return false;
}

/** Loose prefix match, used only while typing to build suggestions. */
export function matches(item, qTokens) {
  if (!qTokens.length) return false;
  const allWords = qTokens.every((q) => item._tok.some((w) => w.startsWith(q)));
  if (allWords) return true;
  return qTokens.length > 1 && item._joined.includes(qTokens.join(''));
}

/**
 * Plain item ("eggs", "milk", "oat milk"): the item must BE that thing — the
 * term's last word is a product's head noun. Egg Nog (head: nog), Eggplant,
 * Eggo and Whole Milk Yogurt (head: yogurt) don't count.
 */
export function matchesGeneric(item, termTokens) {
  if (!termTokens.length) return false;
  const joined = termTokens.join('');
  const last = termTokens[termTokens.length - 1];
  if (negated(item, termTokens)) return false;
  if (item._heads.has(joined)) return true; // "oatmilk" head for "oat milk"
  if (!item._heads.has(last)) return false;
  return termTokens.every((w) => item._tok.includes(w));
}

/** Specific product ("Egg Nog"): the words appear together, in order, at any store. */
export function matchesPhrase(item, phraseTokens) {
  const n = phraseTokens.length;
  if (!n) return false;
  for (let i = 0; i + n <= item._tok.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) if (item._tok[i + j] !== phraseTokens[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

export function entryMatcher(entry) {
  const t = tokens(entry.q);
  return entry.mode === 'product' ? (it) => matchesPhrase(it, t) : (it) => matchesGeneric(it, t);
}

// Common things people put on a grocery list. These are offered first as plain
// choices, even when no store has a price for them yet.
export const STAPLES = [
  'eggs', 'milk', 'whole milk', 'oat milk', 'almond milk', 'soy milk', 'coconut milk', 'chocolate milk', 'half and half',
  'heavy cream', 'butter', 'cheese', 'cheddar cheese', 'mozzarella', 'parmesan', 'cream cheese', 'sour cream', 'yogurt',
  'greek yogurt', 'cottage cheese', 'macaroni and cheese', 'almond butter', 'cookie butter', 'green onions',
  'bread', 'bagels', 'tortillas', 'english muffins', 'buns', 'croissants',
  'bananas', 'apples', 'oranges', 'lemons', 'limes', 'grapes', 'strawberries', 'blueberries', 'raspberries', 'avocados',
  'tomatoes', 'potatoes', 'sweet potatoes', 'onions', 'garlic', 'carrots', 'celery', 'broccoli', 'cauliflower', 'spinach',
  'lettuce', 'kale', 'cucumbers', 'bell peppers', 'mushrooms', 'zucchini', 'corn', 'green beans', 'asparagus', 'cilantro',
  'chicken breast', 'chicken thighs', 'whole chicken', 'ground beef', 'steak', 'pork chops', 'bacon', 'sausage', 'ham',
  'turkey', 'ground turkey', 'salmon', 'shrimp', 'tuna', 'tofu', 'hot dogs', 'deli meat',
  'rice', 'pasta', 'spaghetti', 'noodles', 'ramen', 'oats', 'oatmeal', 'cereal', 'granola', 'flour', 'sugar', 'brown sugar',
  'salt', 'pepper', 'olive oil', 'vegetable oil', 'vinegar', 'soy sauce', 'ketchup', 'mustard', 'mayonnaise', 'hot sauce',
  'salsa', 'hummus', 'peanut butter', 'jam', 'honey', 'maple syrup', 'beans', 'black beans', 'chickpeas', 'canned tomatoes',
  'tomato sauce', 'pasta sauce', 'broth', 'chicken broth', 'soup', 'crackers', 'chips', 'tortilla chips', 'pretzels',
  'popcorn', 'cookies', 'nuts', 'almonds', 'walnuts', 'pecans', 'cashews', 'trail mix', 'granola bars', 'chocolate',
  'coffee', 'tea', 'orange juice', 'apple juice', 'sparkling water', 'water', 'soda', 'kombucha', 'beer', 'wine',
  'ice cream', 'frozen pizza', 'frozen vegetables', 'frozen fruit', 'waffles', 'dumplings',
  'paper towels', 'toilet paper', 'trash bags', 'dish soap', 'laundry detergent', 'aluminum foil', 'zip bags', 'napkins',
  'diapers', 'wipes', 'toothpaste', 'shampoo', 'body wash', 'dog food', 'cat food',
];
const STAPLE_TOKENS = STAPLES.map((s) => ({ label: s, t: tokens(s) }));

/** Short display name for a product: first clause of ad copy, a few words. */
export function shortName(name) {
  const first = String(name).split(/[.,(]/)[0].replace(/[®™]/g, '').trim();
  return first.split(/\s+/).slice(0, 9).join(' ');
}

/**
 * Suggestions while typing. Plain staples first ("eggs"), then specific
 * products containing the text ("Egg Nog", "Eggo Waffles"), each with its
 * lowest current price and how many store chains carry it.
 */
export function suggest(items, text, today, { maxStaples = 3, maxProducts = 7 } = {}) {
  const q = tokens(text);
  if (!q.length) return [];
  const raw = String(text).trim().toLowerCase();
  const prefixAll = (t) => q.every((w) => t.some((x) => x.startsWith(w)));

  const live = items.filter((i) => priceStatus(i, today) === 'active');
  const generic = STAPLE_TOKENS
    .filter((s) => prefixAll(s.t))
    .sort((a, b) => (b.label.startsWith(raw) - a.label.startsWith(raw)) || a.t.length - b.t.length || a.label.localeCompare(b.label))
    .slice(0, maxStaples)
    .map((s) => {
      const cmp = ranker({ q: s.label, mode: 'generic' });
      const hits = live.filter((i) => matchesGeneric(i, s.t) && i.price != null).sort(cmp);
      // Price shown is the basic pick's, the same one the list will use.
      const low = hits.length ? hits[0].price : null;
      return { type: 'generic', q: s.label, label: s.label, count: hits.length, low, chains: [...new Set(hits.map((i) => i.chain))] };
    });

  // Group products by their short name so the same product at 3 stores is one row.
  const groups = new Map();
  for (const it of live) {
    if (!matches(it, q)) continue;
    const name = shortName(it.name);
    const key = tokens(name).join(' ');
    if (!key || generic.some((g) => tokens(g.q).join(' ') === key)) continue;
    if (!groups.has(key)) groups.set(key, { type: 'product', q: name, label: name, items: [] });
    groups.get(key).items.push(it);
  }
  const products = [...groups.values()].map((g) => {
    const priced = g.items.filter((i) => i.price != null);
    const nameTok = tokens(g.label);
    return {
      ...g,
      low: priced.reduce((m, i) => (m == null || i.price < m ? i.price : m), null),
      chains: [...new Set(g.items.map((i) => i.chain))],
      // Whole word ("Egg Nog") before partial ("Eggplant"); earlier position first.
      whole: q.every((w) => nameTok.includes(w)) ? 1 : 0,
      pos: nameTok.findIndex((x) => x.startsWith(q[0])),
    };
  });
  products.sort((a, b) => b.whole - a.whole || a.pos - b.pos || b.chains.length - a.chains.length || a.label.localeCompare(b.label));

  const out = [...generic, ...products.slice(0, maxProducts)];
  // Nothing in the staples list: still offer exactly what was typed as a plain item.
  if (!generic.length) out.unshift({ type: 'generic', q: String(text).trim(), label: String(text).trim(), count: null, low: null, chains: [] });
  return out;
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

export function findMatches(items, entry, today) {
  const test = entryMatcher(entry);
  const out = [];
  for (const it of items) {
    if (priceStatus(it, today) === 'expired') continue;
    if (test(it)) out.push(it);
  }
  return out;
}

/**
 * For one list entry: active matches ranked, best per chain, overall best,
 * and any upcoming ad price that beats today's best.
 */
/** Plain items rank the basic version first, then by value; products rank by value. */
export function ranker(entry) {
  if (entry.mode === 'product') return compareValue;
  const t = tokens(entry.q);
  const tier = new Map();
  const tierOf = (i) => { if (!tier.has(i)) tier.set(i, basicTier(i, t)); return tier.get(i); };
  return (a, b) => {
    // A priced item beats an unpriced one; otherwise basic beats prepared, then value.
    if ((a.price == null) !== (b.price == null)) return a.price == null ? 1 : -1;
    return tierOf(a) - tierOf(b) || compareValue(a, b);
  };
}

export function analyzeEntry(items, entry, today) {
  const all = findMatches(items, entry, today);
  const cmp = ranker(entry);
  const active = all.filter((i) => priceStatus(i, today) === 'active').sort(cmp);
  const upcoming = all.filter((i) => priceStatus(i, today) === 'upcoming').sort(cmp);
  const perChain = {};
  for (const it of active) if (!perChain[it.chain] || cmp(it, perChain[it.chain]) < 0) perChain[it.chain] = it;
  const pinned = entry.pin ? active.find((i) => i.id === entry.pin) || null : null;
  const best = active.find((i) => i.price != null) || null;
  const chosen = pinned || best;
  const soon = upcoming.find((u) => u.price != null && (!chosen || cmp(u, chosen) < 0)) || null;
  return { active, upcoming, perChain, best, pinned, chosen, soon };
}

/**
 * What `qty` units actually cost. Multi-buy deals ("Buy 1, get 1 50% off") only
 * kick in for full groups: 1 unit pays the single price, 2 get the deal.
 */
export function lineCost(item, qty) {
  if (!item || item.price == null) return null;
  const p = item.promo;
  if (p && item.regular_price) {
    const unit = item.regular_price;
    const group = p.buy + p.get;
    const groups = Math.floor(qty / group);
    const rest = qty - groups * group;
    const cost = groups * (p.buy * unit + p.get * unit * (1 - p.pct / 100)) + rest * unit;
    return Math.round(cost * 100) / 100;
  }
  return Math.round(item.price * qty * 100) / 100;
}

/** Short text for a multi-buy deal's requirement, e.g. "when you buy 2". */
export function dealQtyText(item) {
  return item?.promo ? `when you buy ${item.promo.buy + item.promo.get}` : '';
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

/** Things people price by the dozen. */
const BY_DOZEN = new Set(['egg']);

/** Unit price label. Eggs show per dozen ("$5.99/doz") so 12- and 18-packs compare at a glance. */
export function unitLabel(up, item) {
  if (!up) return '';
  const v = up.value;
  if (up.unit === 'ct' && item?._heads && [...BY_DOZEN].some((h) => item._heads.has(h))) {
    const perDoz = `$${(v * 12).toFixed(2)}/doz`;
    // A non-dozen pack says so: "18-pack · $4.66/doz".
    const n = item.price > 0 ? Math.round(item.price / v) : 12;
    return n && n !== 12 ? `${n}-pack · ${perDoz}` : perDoz;
  }
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
