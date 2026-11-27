const nf = new Intl.NumberFormat('en-US');
const cf = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtInt = (n: number | null | undefined) => (n == null ? '—' : nf.format(n));
export const fmtCompact = (n: number | null | undefined) => (n == null ? '—' : n < 10_000 ? nf.format(n) : cf.format(n));
export const fmtPct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

const pad = (n: number) => String(n).padStart(2, '0');

/** UTC timestamp, analyst style: 2026-11-26 14:05Z */
export function fmtUtc(t: number | string | null | undefined, seconds = false): string {
  if (t == null) return '—';
  const d = typeof t === 'number' ? new Date(t) : new Date(t);
  if (Number.isNaN(d.getTime())) return '—';
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${base}${seconds ? `:${pad(d.getUTCSeconds())}` : ''}Z`;
}

export function fmtUtcDate(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fmtShortDate(t: number): string {
  const d = new Date(t);
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
}

export function fmtHourMinute(t: number): string {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fmtDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 60_000) return `${Math.round(abs / 1000)}s`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m`;
  if (abs < 86_400_000) return `${(abs / 3_600_000).toFixed(abs < 36_000_000 ? 1 : 0)}h`;
  return `${(abs / 86_400_000).toFixed(abs < 864_000_000 ? 1 : 0)}d`;
}

export function fmtRelative(t: number | string | null, now = Date.now()): string {
  if (t == null) return 'never';
  const ms = now - (typeof t === 'number' ? t : Date.parse(t));
  if (Number.isNaN(ms)) return '—';
  if (ms < 45_000) return 'just now';
  return `${fmtDuration(ms)} ago`;
}

/** Local datetime-input value (YYYY-MM-DDTHH:mm) in UTC. */
export function toUtcInput(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
export function fromUtcInput(v: string): number {
  return Date.parse(`${v}:00Z`);
}

export function flagEmoji(iso2: string | null): string {
  if (!iso2 || iso2.length !== 2) return '';
  return String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}
