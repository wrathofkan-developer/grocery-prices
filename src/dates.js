// All "effective date" logic lives here. Prices are keyed on the AD's own
// validity window, expressed as Pacific-time calendar dates (YYYY-MM-DD).
// Never on when the ad was posted (Flipp `available_from`) or when we fetched it.

export const TZ = 'America/Los_Angeles';

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today's date in Pacific time, e.g. "2026-10-23". */
export function todayPT(now = new Date()) {
  return ymd.format(now);
}

/** Convert an absolute instant (ISO string with Z or offset) to a Pacific calendar date. */
export function instantToPTDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return ymd.format(d);
}

/**
 * Flipp gives both a date field ("2026-10-21") and a timestamp
 * ("2026-10-21T00:00:00-04:00"). The timestamp is midnight EASTERN, which is
 * 9pm Pacific the night before — converting it would start the ad a day early.
 * The plain date field is the ad's intended local start date, so use that.
 */
export function flippDate(dateField, timestamp) {
  if (dateField && /^\d{4}-\d{2}-\d{2}$/.test(dateField)) return dateField;
  if (timestamp) return timestamp.slice(0, 10); // calendar part, not instant conversion
  return null;
}

/** "10/19/26" or "10/19/2026" -> "2026-10-19" */
export function mdyToISO(s) {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/**
 * Status of a price on a given Pacific date.
 * valid_to null = ongoing (regular shelf price).
 */
export function priceStatus(item, today = todayPT()) {
  if (!item.valid_from) return 'unknown';
  if (today < item.valid_from) return 'upcoming';
  if (item.valid_to && today > item.valid_to) return 'expired';
  return 'active';
}
