// Shared parsing: package sizes, prices, and unit prices.

const UNIT_ALIASES = [
  [/^(fl\.?\s*oz|fluid\s*ounces?)$/i, 'fl_oz'],
  [/^(oz|ounces?)$/i, 'oz'],
  [/^(lbs?|pounds?)$/i, 'lb'],
  [/^(ct|count|pk|pack|ea|each|pcs?)$/i, 'ct'],
  [/^(doz|dozen)$/i, 'doz'],
  [/^(gal|gallons?)$/i, 'gal'],
  [/^(qt|quarts?)$/i, 'qt'],
  [/^(pt|pints?)$/i, 'pt'],
  [/^(l|liters?|litres?)$/i, 'l'],
  [/^(ml)$/i, 'ml'],
  [/^(g|grams?)$/i, 'g'],
  [/^(kg)$/i, 'kg'],
];

export function canonicalUnit(u) {
  if (!u) return null;
  const s = String(u).trim().replace(/\.$/, '');
  for (const [re, name] of UNIT_ALIASES) if (re.test(s)) return name;
  return null;
}

// Convert to a base unit so different package sizes compare fairly.
// Weight -> oz, volume -> fl_oz, count -> ct.
const TO_BASE = {
  oz: ['oz', 1], lb: ['oz', 16], g: ['oz', 1 / 28.3495], kg: ['oz', 35.274],
  fl_oz: ['fl_oz', 1], gal: ['fl_oz', 128], qt: ['fl_oz', 32], pt: ['fl_oz', 16], l: ['fl_oz', 33.814], ml: ['fl_oz', 1 / 29.5735],
  ct: ['ct', 1], doz: ['ct', 12],
};

export function toBase(qty, unit) {
  const c = TO_BASE[unit];
  if (!c || !(qty > 0)) return null;
  return { qty: qty * c[1], unit: c[0] };
}

/**
 * Pull a package size out of free text.
 * Handles "64 fl oz", "64 - oz.", "3 lbs", "2/16 oz" (2 packs of 16 oz),
 * "18/12 fl oz", "120 ct", "6/32 oz".
 * Returns { qty, unit } in base units, or null.
 */
export function parseSize(text) {
  if (!text) return null;
  const s = String(text).replace(/ /g, ' ');
  const re = /(?:(\d+)\s*\/\s*)?(\d+(?:\.\d+)?)\s*-?\s*(fl\.?\s*oz|fluid\s*ounces?|oz|ounces?|lbs?|pounds?|ct|count|pk|doz(?:en)?|gal(?:lons?)?|qt|quarts?|ml|kg|g|l|liters?)\.?\b/i;
  const m = s.match(re);
  if (!m) return null;
  const packs = m[1] ? Number(m[1]) : 1;
  const unit = canonicalUnit(m[3]);
  const base = toBase(packs * Number(m[2]), unit);
  return base;
}

/**
 * Parse a price string into a per-item price.
 * "4.99" -> 4.99, "$4.99" -> 4.99, "2/5.00" or "2 for $5" -> 2.50 each.
 * Returns { price, qty } where price is per single item, or null.
 */
export function parsePrice(text) {
  if (text == null) return null;
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  let m = s.match(/^(\d+)\s*(?:\/|for)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
  if (m) {
    const n = Number(m[1]);
    return { price: round2(Number(m[2]) / n), qty: n, multi: true };
  }
  m = s.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (m) return { price: round2(Number(m[1])), qty: 1, multi: false };
  // "99¢"
  m = s.match(/(\d+)\s*¢/);
  if (m) return { price: round2(Number(m[1]) / 100), qty: 1, multi: false };
  return null;
}

/**
 * Multi-buy deals from a label: "Buy 1, get 1 free", "Buy 1, get 1 50% off",
 * "Buy 2 get 1 free". Returns { buy, get, pct } (pct = % off the "get" units)
 * or null for anything else (e.g. "35% off", which is already in the price).
 */
export function parseMultiBuy(label) {
  const m = String(label || '').match(/buy\s*(\d+),?\s*get\s*(\d+)\s*(free|(\d+)\s*%\s*off)/i);
  if (!m) return null;
  return { buy: Number(m[1]), get: Number(m[2]), pct: m[3].toLowerCase() === 'free' ? 100 : Number(m[4]) };
}

/** Exact cost of `qty` units under a multi-buy deal, at single-unit price `unit`. */
export function multiBuyCost(unit, qty, promo) {
  if (!promo) return unit * qty;
  const group = promo.buy + promo.get;
  const groups = Math.floor(qty / group);
  const rest = qty - groups * group;
  return groups * (promo.buy * unit + promo.get * unit * (1 - promo.pct / 100)) + rest * unit;
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Unit price in base units, e.g. { value: 0.078, unit: 'fl_oz' } */
export function unitPrice(price, size, perUnit) {
  if (!(price > 0)) return null;
  if (perUnit) {
    const base = toBase(1, perUnit);
    return base ? { value: price / base.qty, unit: base.unit } : null;
  }
  if (!size) return null;
  return { value: price / size.qty, unit: size.unit };
}

export function cleanText(s) {
  return String(s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}
