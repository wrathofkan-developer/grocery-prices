// Small fetch wrapper: browser-like headers, timeout, one retry, clear errors.

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(url, status, bodySnippet) {
    super(`HTTP ${status} for ${redact(url)}${bodySnippet ? ` — ${bodySnippet}` : ''}`);
    this.status = status;
    this.blocked = status === 403 || status === 429 || status === 401;
  }
}

export function redact(url) {
  return String(url).replace(/access_token=[^&]+/g, 'access_token=***');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 30000, retries = 1, as = 'json' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9', ...headers },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new HttpError(url, res.status, text.slice(0, 120).replace(/\s+/g, ' '));
      }
      return as === 'text' ? await res.text() : await res.json();
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && e.blocked) break; // don't hammer a block
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
