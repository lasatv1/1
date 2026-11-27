import { describe, expect, it } from 'vitest';
import type { Severity, ThreatEvent } from '@/types/intel';
import { aggregateConnections, countryStats, filterEvents, histogram, selectVisibleConnections, type EventQuery } from './aggregate';
import { angularDistance, arcPoints, flatProjection, globeProjection, lngLatToVec3, vec3ToLngLat } from '@/lib/geo/sphere';

let n = 0;
function ev(p: Partial<ThreatEvent>): ThreatEvent {
  n++;
  return {
    id: `T-${n}`,
    sourceId: 's1',
    sourceRecordId: `r${n}`,
    category: 'malware',
    severity: 'medium',
    confidence: 50,
    observedAt: '',
    firstSeen: '',
    lastSeen: '',
    collectedAt: '',
    updatedAt: '',
    srcCountry: null,
    dstCountry: null,
    srcIp: null,
    dstIp: null,
    srcAsn: null,
    dstAsn: null,
    srcOrg: null,
    indicators: [],
    basis: 'inferred',
    description: '',
    references: [],
    t: 0,
    isDemo: true,
    ...p,
  };
}

const ALL: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const q = (over: Partial<EventQuery> = {}): EventQuery => ({
  from: 0,
  to: 1000,
  severities: new Set(ALL),
  categories: new Set(),
  sources: new Set(),
  focus: new Set(),
  direction: 'all',
  geography: new Set(),
  ...over,
});

const events = [
  ev({ t: 10, srcCountry: 'US', dstCountry: 'DE', severity: 'low' }),
  ev({ t: 20, srcCountry: 'US', dstCountry: 'DE', severity: 'critical' }),
  ev({ t: 30, srcCountry: 'FR', dstCountry: 'US', category: 'phishing' }),
  ev({ t: 40, srcCountry: 'NL' }), // located only
  ev({ t: 2000, srcCountry: 'US', dstCountry: 'DE' }), // outside window
];

describe('filterEvents', () => {
  it('applies the time window with binary search', () => {
    expect(filterEvents(events, q())).toEqual([0, 1, 2, 3]);
    expect(filterEvents(events, q({ from: 15, to: 35 }))).toEqual([1, 2]);
  });
  it('distinguishes incoming and outgoing for the focus country', () => {
    const focus = new Set(['US']);
    expect(filterEvents(events, q({ focus, direction: 'outgoing' }))).toEqual([0, 1]);
    expect(filterEvents(events, q({ focus, direction: 'incoming' }))).toEqual([2]);
  });
  it('filters severity and category', () => {
    expect(filterEvents(events, q({ severities: new Set(['critical']) }))).toEqual([1]);
    expect(filterEvents(events, q({ categories: new Set(['phishing']) }))).toEqual([2]);
  });
});

describe('aggregation', () => {
  const idx = filterEvents(events, q());
  it('aggregates directed pairs per category with max severity', () => {
    const conns = aggregateConnections(events, idx);
    const usde = conns.find((c) => c.src === 'US' && c.dst === 'DE')!;
    expect(usde.count).toBe(2);
    expect(usde.severity).toBe('critical');
    expect(conns.some((c) => c.src === 'NL')).toBe(false); // no counterpart → no arc
  });
  it('computes country stats from data only', () => {
    const s = countryStats(events, idx);
    expect(s.get('US')).toMatchObject({ outgoing: 2, incoming: 1, total: 3 });
    expect(s.get('NL')).toMatchObject({ hosted: 1, total: 1 });
  });
  it('limits rendered connections, prioritising the focus', () => {
    const conns = aggregateConnections(events, idx);
    const vis = selectVisibleConnections(conns, 1, new Set(['FR']));
    expect(vis).toHaveLength(1);
    expect(vis[0]!.src).toBe('FR');
  });
  it('buckets histogram by severity', () => {
    const h = histogram(events, idx, 0, 40, 4);
    expect(h.reduce((a, b) => a + b.total, 0)).toBe(4);
    expect(h[1]!.bySeverity.low).toBe(1);
  });
});

describe('geometry', () => {
  it('round-trips lng/lat through the sphere', () => {
    const [lng, lat] = vec3ToLngLat(lngLatToVec3(-74, 40.7));
    expect(lng).toBeCloseTo(-74, 6);
    expect(lat).toBeCloseTo(40.7, 6);
  });
  it('arcs stay above the globe surface, including across the antimeridian', () => {
    const pts = arcPoints(globeProjection, [170, -15], [-150, 20], 32, 0.0025, 1);
    for (const p of pts) expect(Math.hypot(...p)).toBeGreaterThanOrEqual(1);
    expect(angularDistance([170, 0], [-170, 0])).toBeCloseTo((20 * Math.PI) / 180, 6);
  });
  it('flat projection maps to the equirectangular plane', () => {
    expect(flatProjection.point(180, 90)).toEqual([Math.PI, Math.PI / 2, 0]);
  });
});
