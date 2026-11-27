/**
 * Public visit counters via Abacus (abacus.jasoncameron.dev): free, no account, CORS, and
 * a server-sent-events stream for live updates. Only aggregate numbers are stored; no
 * IPs, cookies or identities are sent by this code.
 *
 * Counters: "opens" (every page load), "visitors" (first load per browser),
 * "failed-logins" (wrong username/password attempts).
 * Disabled unless VITE_COUNTER_NAMESPACE is set at build time; never counts localhost.
 */
const BASE = 'https://abacus.jasoncameron.dev';
const NS = (import.meta.env.VITE_COUNTER_NAMESPACE as string | undefined)?.trim() || '';

export type CounterKey = 'opens' | 'visitors' | 'failed-logins';
export const counterEnabled = NS.length > 0;

const isLocal = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

function hit(key: CounterKey) {
  if (!counterEnabled || isLocal()) return;
  // keepalive: the count is recorded even if the page navigates away immediately.
  void fetch(`${BASE}/hit/${encodeURIComponent(NS)}/${key}`, { keepalive: true, mode: 'cors' }).catch(() => {});
}

let recorded = false;
/** Called once per page load. */
export function recordVisit() {
  if (recorded) return;
  recorded = true;
  hit('opens');
  try {
    if (!localStorage.getItem('cta.visited')) {
      localStorage.setItem('cta.visited', '1');
      hit('visitors');
    }
  } catch {
    /* storage blocked: skip unique count */
  }
}

export const recordFailedLogin = () => hit('failed-logins');

/** Live value: initial fetch, then server-sent updates. Returns an unsubscribe function. */
export function subscribeCounter(key: CounterKey, onValue: (n: number) => void): () => void {
  if (!counterEnabled) return () => {};
  const url = `${BASE}/%s/${encodeURIComponent(NS)}/${key}`;
  let closed = false;
  fetch(url.replace('%s', 'get'))
    .then((r) => (r.ok ? r.json() : r.status === 404 ? { value: 0 } : null))
    .then((d: { value?: number } | null) => {
      if (!closed && d && typeof d.value === 'number') onValue(d.value);
    })
    .catch(() => {});
  if (typeof EventSource === 'undefined') return () => void (closed = true);
  const es = new EventSource(url.replace('%s', 'stream'));
  es.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data as string) as { value?: number };
      if (typeof d.value === 'number') onValue(d.value);
    } catch {
      /* ignore */
    }
  };
  return () => {
    closed = true;
    es.close();
  };
}
