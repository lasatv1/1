/**
 * Pure filtering / aggregation functions. All statistics in the UI are computed here
 * from the active dataset — nothing is hard-coded.
 */
import type { Connection, CountryStats, Severity, ThreatCategory, ThreatEvent, RelationshipBasis } from '@/types/intel';
import { severityOrder } from '@/design/tokens';

export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export type Direction = 'all' | 'incoming' | 'outgoing';

export interface EventQuery {
  from: number;
  to: number;
  severities: ReadonlySet<Severity>;
  /** Empty = all categories. */
  categories: ReadonlySet<ThreatCategory>;
  /** Empty = all sources. */
  sources: ReadonlySet<string>;
  /** Countries that scope the direction filter (selection). Empty = no scoping. */
  focus: ReadonlySet<string>;
  direction: Direction;
  /** Geographic filter: event must touch one of these countries. Empty = global. */
  geography: ReadonlySet<string>;
}

/** Index of the first event with t >= value (events sorted by t). */
export function lowerBound(events: readonly ThreatEvent[], value: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid]!.t < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function filterEvents(events: readonly ThreatEvent[], q: EventQuery): number[] {
  const out: number[] = [];
  const start = lowerBound(events, q.from);
  const end = lowerBound(events, q.to + 1);
  const scoped = q.focus.size > 0 && q.direction !== 'all';
  for (let i = start; i < end; i++) {
    const e = events[i]!;
    if (!q.severities.has(e.severity)) continue;
    if (q.categories.size && !q.categories.has(e.category)) continue;
    if (q.sources.size && !q.sources.has(e.sourceId)) continue;
    if (q.geography.size) {
      const touches = (e.srcCountry && q.geography.has(e.srcCountry)) || (e.dstCountry && q.geography.has(e.dstCountry));
      if (!touches) continue;
    }
    if (scoped) {
      if (q.direction === 'incoming' && !(e.dstCountry && q.focus.has(e.dstCountry))) continue;
      if (q.direction === 'outgoing' && !(e.srcCountry && q.focus.has(e.srcCountry))) continue;
    }
    out.push(i);
  }
  return out;
}

export const connectionKey = (src: string, dst: string, cat: ThreatCategory) => `${src}>${dst}>${cat}`;

/** Aggregates directed country pairs per category. Events without both ends are excluded. */
export function aggregateConnections(events: readonly ThreatEvent[], idx: readonly number[]): Connection[] {
  const map = new Map<string, Connection & { _conf: number; _src: Set<string>; _bas: Set<RelationshipBasis> }>();
  for (const i of idx) {
    const e = events[i]!;
    if (!e.srcCountry || !e.dstCountry || e.srcCountry === e.dstCountry) continue;
    const key = connectionKey(e.srcCountry, e.dstCountry, e.category);
    let c = map.get(key);
    if (!c) {
      c = {
        id: key,
        src: e.srcCountry,
        dst: e.dstCountry,
        category: e.category,
        severity: e.severity,
        count: 0,
        firstSeen: e.t,
        lastSeen: e.t,
        sources: [],
        bases: [],
        meanConfidence: 0,
        eventIdx: [],
        _conf: 0,
        _src: new Set(),
        _bas: new Set(),
      };
      map.set(key, c);
    }
    c.count++;
    c._conf += e.confidence;
    c._src.add(e.sourceId);
    c._bas.add(e.basis);
    c.eventIdx.push(i);
    if (SEVERITY_RANK[e.severity] > SEVERITY_RANK[c.severity]) c.severity = e.severity;
    if (e.t < c.firstSeen) c.firstSeen = e.t;
    if (e.t > c.lastSeen) c.lastSeen = e.t;
  }
  const out: Connection[] = [];
  for (const c of map.values()) {
    const { _conf, _src, _bas, ...rest } = c;
    out.push({ ...rest, meanConfidence: Math.round(_conf / c.count), sources: [..._src], bases: [..._bas] });
  }
  return out;
}

const emptySeverity = (): Record<Severity, number> => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });

export function emptyStats(id: string): CountryStats {
  return { id, total: 0, incoming: 0, outgoing: 0, hosted: 0, bySeverity: emptySeverity(), byCategory: {}, maxSeverity: null };
}

/**
 * Per-country statistics. An event counts once for each distinct country it touches.
 *  - outgoing: country is the source side of a pair
 *  - incoming: country is the destination side of a pair (or the affected country of a report)
 *  - hosted:   infrastructure located in the country with no counterpart country
 */
export function countryStats(events: readonly ThreatEvent[], idx: readonly number[]): Map<string, CountryStats> {
  const map = new Map<string, CountryStats>();
  const get = (id: string) => {
    let s = map.get(id);
    if (!s) map.set(id, (s = emptyStats(id)));
    return s;
  };
  const bump = (s: CountryStats, e: ThreatEvent) => {
    s.total++;
    s.bySeverity[e.severity]++;
    s.byCategory[e.category] = (s.byCategory[e.category] ?? 0) + 1;
    if (!s.maxSeverity || SEVERITY_RANK[e.severity] > SEVERITY_RANK[s.maxSeverity]) s.maxSeverity = e.severity;
  };
  for (const i of idx) {
    const e = events[i]!;
    const { srcCountry: s, dstCountry: d } = e;
    if (s && d && s !== d) {
      const a = get(s);
      a.outgoing++;
      bump(a, e);
      const b = get(d);
      b.incoming++;
      bump(b, e);
    } else if (s) {
      const a = get(s);
      a.hosted++;
      bump(a, e);
    } else if (d) {
      const b = get(d);
      b.incoming++;
      bump(b, e);
    }
  }
  return map;
}

/**
 * Level-of-detail selection: never render every connection. Connections touching
 * the focus set are prioritised, then by severity and volume, capped at `limit`.
 */
export function selectVisibleConnections(
  conns: readonly Connection[],
  limit: number,
  focus: ReadonlySet<string>,
  minCount = 1,
): Connection[] {
  // Volume weighted by severity, so a busy medium-severity corridor can outrank a single
  // critical event while critical activity still surfaces first at equal volume.
  const score = (c: Connection) =>
    (focus.size && (focus.has(c.src) || focus.has(c.dst)) ? 1e9 : 0) + c.count * (1 + SEVERITY_RANK[c.severity] * 0.6);
  return conns
    .filter((c) => c.count >= minCount)
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
}

export interface HistogramBucket {
  t0: number;
  t1: number;
  total: number;
  bySeverity: Record<Severity, number>;
}

export function histogram(
  events: readonly ThreatEvent[],
  idx: readonly number[],
  from: number,
  to: number,
  buckets: number,
): HistogramBucket[] {
  const width = Math.max(1, (to - from) / buckets);
  const out: HistogramBucket[] = Array.from({ length: buckets }, (_, i) => ({
    t0: from + i * width,
    t1: from + (i + 1) * width,
    total: 0,
    bySeverity: emptySeverity(),
  }));
  for (const i of idx) {
    const e = events[i]!;
    // The window end is inclusive: an event at exactly `to` belongs to the last bucket.
    const b = e.t === to ? buckets - 1 : Math.floor((e.t - from) / width);
    const bucket = out[b];
    if (!bucket) continue;
    bucket.total++;
    bucket.bySeverity[e.severity]++;
  }
  return out;
}

export function topCounterparts(
  events: readonly ThreatEvent[],
  idx: readonly number[],
  country: string,
  side: 'sources' | 'destinations',
  n = 6,
): Array<{ id: string; count: number }> {
  const m = new Map<string, number>();
  for (const i of idx) {
    const e = events[i]!;
    if (side === 'sources' && e.dstCountry === country && e.srcCountry && e.srcCountry !== country)
      m.set(e.srcCountry, (m.get(e.srcCountry) ?? 0) + 1);
    if (side === 'destinations' && e.srcCountry === country && e.dstCountry && e.dstCountry !== country)
      m.set(e.dstCountry, (m.get(e.dstCountry) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

export function maxSeverityOf(counts: Record<Severity, number>): Severity | null {
  for (const s of severityOrder) if (counts[s] > 0) return s;
  return null;
}

export function uniqueIndicatorCount(events: readonly ThreatEvent[], idx: readonly number[]): number {
  const set = new Set<string>();
  for (const i of idx) for (const ind of events[i]!.indicators) set.add(`${ind.type}:${ind.value}`);
  return set.size;
}

/** Relative activity level for a country, from its share of the max country total. */
export function activityLevel(total: number, maxTotal: number): 'none' | 'low' | 'moderate' | 'elevated' | 'high' {
  if (!total) return 'none';
  const r = total / Math.max(1, maxTotal);
  if (r > 0.6) return 'high';
  if (r > 0.3) return 'elevated';
  if (r > 0.1) return 'moderate';
  return 'low';
}
