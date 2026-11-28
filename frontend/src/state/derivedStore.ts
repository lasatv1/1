/**
 * Derived analysis state, recomputed (rAF-throttled) whenever the dataset or filters
 * change. Computing once here keeps the globe and every panel consistent and avoids
 * repeated aggregation inside components.
 */
import { create } from 'zustand';
import type { Connection, CountryStats, Severity, ThreatCategory } from '@/types/intel';
import {
  aggregateConnections,
  countryStats,
  filterEvents,
  selectVisibleConnections,
  uniqueIndicatorCount,
  type EventQuery,
} from '@/lib/data/aggregate';
import { LAYER_BY_ID } from '@/lib/layers';
import { useAppStore } from './appStore';
import { useDataStore } from './dataStore';

export interface Totals {
  events: number;
  countries: number;
  indicators: number;
  activeSources: number;
  critical: number;
  connections: number;
}

interface DerivedState {
  version: number;
  /** Events after all filters except the direction scope. */
  baseIdx: number[];
  /** Events after all filters including direction. */
  idx: number[];
  connections: Connection[];
  connectionsById: Map<string, Connection>;
  visibleConnections: Connection[];
  stats: Map<string, CountryStats>;
  maxCountryTotal: number;
  totals: Totals;
  window: [number, number];
  effectiveCategories: ThreatCategory[];
  /** Counts in the time window ignoring the category/layer filter (for filter UI). */
  categoryCounts: Partial<Record<ThreatCategory, number>>;
  /** Counts in the time window ignoring the severity filter. */
  severityCounts: Record<Severity, number>;
  /** Events matching all filters across the whole dataset extent (timeline histogram). */
  timelineIdx: number[];
}

const EMPTY_TOTALS: Totals = { events: 0, countries: 0, indicators: 0, activeSources: 0, critical: 0, connections: 0 };

export const useDerivedStore = create<DerivedState>(() => ({
  version: 0,
  baseIdx: [],
  idx: [],
  connections: [],
  connectionsById: new Map(),
  visibleConnections: [],
  stats: new Map(),
  maxCountryTotal: 0,
  totals: EMPTY_TOTALS,
  window: [0, 0],
  effectiveCategories: [],
  categoryCounts: {},
  severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  timelineIdx: [],
}));

const ALL_SEV: ReadonlySet<Severity> = new Set<Severity>(['critical', 'high', 'medium', 'low', 'info']);

function geographySet(): Set<string> {
  const { region, subregion } = useAppStore.getState();
  const geo = useDataStore.getState().geo;
  if (!region || !geo) return new Set();
  return new Set(geo.countries.filter((c) => c.region === region && (!subregion || c.subregion === subregion)).map((c) => c.id));
}

function recompute() {
  const dataset = useDataStore.getState().dataset;
  const app = useAppStore.getState();
  if (!dataset) {
    useDerivedStore.setState({ ...useDerivedStore.getInitialState(), version: useDerivedStore.getState().version + 1 });
    return;
  }
  const layer = LAYER_BY_ID[app.layer];
  let cats: Set<ThreatCategory>;
  if (layer.categories.length && app.categories.size) cats = new Set(layer.categories.filter((c) => app.categories.has(c)));
  else if (layer.categories.length) cats = new Set(layer.categories);
  else cats = new Set(app.categories);
  // A layer whose categories are all filtered out should show nothing, not everything.
  const impossible = layer.categories.length > 0 && cats.size === 0;

  const to = app.playback.cursor ?? app.time.to;
  const base: EventQuery = {
    from: app.time.from,
    to,
    severities: app.severities,
    categories: cats,
    sources: app.sources,
    focus: new Set(app.selected),
    direction: 'all',
    geography: geographySet(),
  };
  const events = dataset.events;
  const baseIdx = impossible ? [] : filterEvents(events, base);
  const idx = app.direction === 'all' || !app.selected.length ? baseIdx : filterEvents(events, { ...base, direction: app.direction });

  const categoryCounts: Partial<Record<ThreatCategory, number>> = {};
  for (const i of filterEvents(events, { ...base, categories: new Set() })) {
    const c = events[i]!.category;
    categoryCounts[c] = (categoryCounts[c] ?? 0) + 1;
  }
  const severityCounts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  if (!impossible) for (const i of filterEvents(events, { ...base, severities: ALL_SEV })) severityCounts[events[i]!.severity]++;
  const timelineIdx = impossible ? [] : filterEvents(events, { ...base, from: dataset.extent[0], to: dataset.extent[1] });

  const connections = aggregateConnections(events, idx);
  const connectionsById = new Map(connections.map((c) => [c.id, c]));
  const visibleConnections = selectVisibleConnections(connections, app.display.density, base.focus, app.display.minCount);
  const stats = countryStats(events, baseIdx);
  let maxCountryTotal = 0;
  for (const s of stats.values()) maxCountryTotal = Math.max(maxCountryTotal, s.total);
  const srcs = new Set<string>();
  let critical = 0;
  for (const i of baseIdx) {
    const e = events[i]!;
    srcs.add(e.sourceId);
    if (e.severity === 'critical') critical++;
  }
  useDerivedStore.setState((s) => ({
    version: s.version + 1,
    baseIdx,
    idx,
    connections,
    connectionsById,
    visibleConnections,
    stats,
    maxCountryTotal,
    window: [app.time.from, to],
    effectiveCategories: [...cats],
    categoryCounts,
    severityCounts,
    timelineIdx,
    totals: {
      events: baseIdx.length,
      countries: stats.size,
      indicators: uniqueIndicatorCount(events, baseIdx),
      activeSources: srcs.size,
      critical,
      connections: connections.length,
    },
  }));
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    recompute();
  });
}

let started = false;
export function startDerivedPipeline() {
  if (started) return;
  started = true;
  useDataStore.subscribe((s, prev) => {
    if (s.dataset !== prev.dataset) {
      const sameSource = !!s.dataset && !!prev.dataset && s.dataset.mode === prev.dataset.mode && s.dataset.origin === prev.dataset.origin;
      if (s.dataset && !sameSource) {
        const { time, setTimePreset } = useAppStore.getState();
        setTimePreset(time.preset === 'custom' ? '7d' : time.preset, Date.now());
        useAppStore.setState({ sources: new Set(), connectionId: null });
      }
      schedule();
    }
    if (s.geo !== prev.geo) schedule();
  });
  useAppStore.subscribe((s, p) => {
    if (
      s.layer !== p.layer ||
      s.severities !== p.severities ||
      s.categories !== p.categories ||
      s.sources !== p.sources ||
      s.direction !== p.direction ||
      s.region !== p.region ||
      s.subregion !== p.subregion ||
      s.time !== p.time ||
      s.playback.cursor !== p.playback.cursor ||
      s.selected !== p.selected ||
      s.display.density !== p.display.density ||
      s.display.minCount !== p.display.minCount
    )
      schedule();
  });
  schedule();
}
