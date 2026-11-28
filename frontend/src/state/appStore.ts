/**
 * Dashboard / analysis state: filters, selection, inspector, display options, playback.
 * Per-frame globe state (hover, pointer, camera) lives in globeStore so the dashboard
 * does not re-render during globe interaction.
 */
import { create } from 'zustand';
import type { Severity, ThreatCategory } from '@/types/intel';
import type { LayerId } from '@/lib/layers';
import type { Direction } from '@/lib/data/aggregate';
import { applyTheme, type ThemeId } from '@/design/tokens';

export type ViewMode = 'globe' | 'flat';
const PREFS_KEY = 'cta.prefs.v1';
function loadPrefs(): { theme: ThemeId; viewMode: ViewMode } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<{ theme: ThemeId; viewMode: ViewMode }>;
    const theme: ThemeId = p.theme === 'light' || p.theme === 'black' ? p.theme : 'mist';
    return { theme, viewMode: p.viewMode === 'flat' ? 'flat' : 'globe' };
  } catch {
    return { theme: 'mist', viewMode: 'globe' };
  }
}
const savePrefs = (p: { theme: ThemeId; viewMode: ViewMode }) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
};
const prefs = loadPrefs();
if (typeof document !== 'undefined') applyTheme(prefs.theme);

export type TimePreset = '1h' | '24h' | '7d' | '30d' | 'custom';
export const PRESET_MS: Record<Exclude<TimePreset, 'custom'>, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

export type Inspect =
  | { kind: 'country'; id: string }
  | { kind: 'compare' }
  | { kind: 'region'; id: string }
  | { kind: 'connection'; id: string }
  | { kind: 'ip'; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'live'; feed: string; id: string };

export type Overlay = 'none' | 'analytics' | 'investigations' | 'about';

export interface SavedInvestigation {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  target: Inspect;
  datasetMode: 'demo' | 'live';
}

export interface DisplayOptions {
  countryLabels: boolean;
  connectionLabels: boolean;
  disputed: boolean;
  markers: boolean;
  animateFlow: boolean;
  opacity: number;
  /** Max arcs rendered (level of detail). */
  density: number;
  minCount: number;
}

interface AppState {
  layer: LayerId;
  severities: Set<Severity>;
  categories: Set<ThreatCategory>;
  sources: Set<string>;
  direction: Direction;
  region: string | null;
  subregion: string | null;
  time: { preset: TimePreset; from: number; to: number };
  playback: { playing: boolean; speed: number; cursor: number | null };
  selected: string[];
  connectionId: string | null;
  inspect: Inspect | null;
  history: Inspect[];
  display: DisplayOptions;
  overlay: Overlay;
  searchOpen: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  /** Narrow viewport: side panels float over the globe instead of taking width. */
  compact: boolean;
  investigations: SavedInvestigation[];
  /** Visual theme: "mist" (mid-tone gray) is the default; "light" and "black" are optional. */
  theme: ThemeId;
  /** 3D globe or flat 2D map pad. */
  viewMode: ViewMode;
  setTheme: (t: ThemeId) => void;
  setViewMode: (v: ViewMode) => void;

  setLayer: (l: LayerId) => void;
  toggleSeverity: (s: Severity) => void;
  setSeverities: (s: Severity[]) => void;
  toggleCategory: (c: ThreatCategory) => void;
  clearCategories: () => void;
  toggleSource: (id: string) => void;
  clearSources: () => void;
  setDirection: (d: Direction) => void;
  setRegion: (region: string | null, subregion?: string | null) => void;
  setTimePreset: (p: Exclude<TimePreset, 'custom'>, now: number) => void;
  setCustomRange: (from: number, to: number) => void;
  setPlayback: (p: Partial<AppState['playback']>) => void;

  selectCountry: (id: string, additive?: boolean) => void;
  selectCountries: (ids: string[], inspect: Inspect) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;
  selectConnection: (id: string | null) => void;
  openInspector: (i: Inspect) => void;
  back: () => void;
  closeInspector: () => void;

  setDisplay: (d: Partial<DisplayOptions>) => void;
  setOverlay: (o: Overlay) => void;
  setSearchOpen: (o: boolean) => void;
  setLeftOpen: (o: boolean) => void;
  setRightOpen: (o: boolean) => void;
  saveInvestigation: (inv: Omit<SavedInvestigation, 'id' | 'createdAt'>) => void;
  deleteInvestigation: (id: string) => void;
}

const ALL_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const INV_KEY = 'cta.investigations.v1';

function loadInvestigations(): SavedInvestigation[] {
  try {
    const raw = localStorage.getItem(INV_KEY);
    return raw ? (JSON.parse(raw) as SavedInvestigation[]) : [];
  } catch {
    return [];
  }
}
const persist = (list: SavedInvestigation[]) => {
  try {
    localStorage.setItem(INV_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
};

const toggle = <T,>(set: Set<T>, v: T) => {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
};

const prefersReducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const useAppStore = create<AppState>((set, get) => ({
  layer: 'global',
  severities: new Set(ALL_SEVERITIES),
  categories: new Set(),
  sources: new Set(),
  direction: 'all',
  region: null,
  subregion: null,
  time: { preset: '7d', from: 0, to: 0 },
  playback: { playing: false, speed: 1, cursor: null },
  selected: [],
  connectionId: null,
  inspect: null,
  history: [],
  display: {
    countryLabels: true,
    connectionLabels: false,
    disputed: true,
    markers: true,
    animateFlow: !prefersReducedMotion,
    opacity: 0.85,
    density: 90,
    minCount: 1,
  },
  overlay: 'none',
  searchOpen: false,
  leftOpen: true,
  rightOpen: true,
  compact: false,
  investigations: loadInvestigations(),
  theme: prefs.theme,
  viewMode: prefs.viewMode,
  setTheme: (theme) => {
    savePrefs({ theme, viewMode: get().viewMode });
    applyTheme(theme); // update WebGL palette before the scene remounts
    set({ theme });
  },
  setViewMode: (viewMode) => {
    savePrefs({ theme: get().theme, viewMode });
    set({ viewMode });
  },

  setLayer: (layer) => set({ layer, categories: new Set(), connectionId: null }),
  toggleSeverity: (s) => set((st) => ({ severities: toggle(st.severities, s) })),
  setSeverities: (s) => set({ severities: new Set(s) }),
  toggleCategory: (c) => set((st) => ({ categories: toggle(st.categories, c) })),
  clearCategories: () => set({ categories: new Set() }),
  toggleSource: (id) => set((st) => ({ sources: toggle(st.sources, id) })),
  clearSources: () => set({ sources: new Set() }),
  setDirection: (direction) => set({ direction }),
  setRegion: (region, subregion = null) => set({ region, subregion }),
  setTimePreset: (preset, now) =>
    set({ time: { preset, from: now - PRESET_MS[preset], to: now }, playback: { ...get().playback, playing: false, cursor: null } }),
  setCustomRange: (from, to) =>
    set({
      time: { preset: 'custom', from: Math.min(from, to), to: Math.max(from, to) },
      playback: { ...get().playback, playing: false, cursor: null },
    }),
  setPlayback: (p) => set((st) => ({ playback: { ...st.playback, ...p } })),

  selectCountry: (id, additive = false) =>
    set((st) => {
      if (additive) {
        const selected = st.selected.includes(id) ? st.selected.filter((x) => x !== id) : [...st.selected, id];
        const inspect: Inspect | null =
          selected.length > 1 ? { kind: 'compare' } : selected[0] ? { kind: 'country', id: selected[0] } : null;
        return { selected, inspect, connectionId: null, history: [], rightOpen: true };
      }
      return { selected: [id], inspect: { kind: 'country', id }, connectionId: null, history: [], rightOpen: true };
    }),
  selectCountries: (ids, inspect) => set({ selected: ids, inspect, connectionId: null, history: [], rightOpen: true }),
  removeFromSelection: (id) =>
    set((st) => {
      const selected = st.selected.filter((x) => x !== id);
      const inspect: Inspect | null =
        selected.length > 1 ? { kind: 'compare' } : selected[0] ? { kind: 'country', id: selected[0] } : null;
      return { selected, inspect };
    }),
  clearSelection: () => set({ selected: [], connectionId: null, inspect: null, history: [] }),
  selectConnection: (id) =>
    set((st) => {
      if (!id) return { connectionId: null };
      const history = st.inspect && st.inspect.kind !== 'connection' ? [...st.history, st.inspect] : st.history;
      return { connectionId: id, inspect: { kind: 'connection', id }, history, rightOpen: true };
    }),
  openInspector: (i) =>
    set((st) => ({
      inspect: i,
      history: st.inspect ? [...st.history, st.inspect] : st.history,
      connectionId: i.kind === 'connection' ? i.id : st.connectionId,
      rightOpen: true,
    })),
  back: () =>
    set((st) => {
      const history = [...st.history];
      const prev = history.pop() ?? null;
      return { inspect: prev, history, connectionId: prev?.kind === 'connection' ? prev.id : null };
    }),
  closeInspector: () => {
    const st = get();
    if (st.history.length) st.back();
    else if (st.inspect?.kind === 'connection') set({ inspect: st.selected[0] ? restoreFor(st.selected) : null, connectionId: null });
    else set({ inspect: null, selected: [], connectionId: null });
  },

  setDisplay: (d) => set((st) => ({ display: { ...st.display, ...d } })),
  setOverlay: (overlay) => set({ overlay }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setLeftOpen: (leftOpen) => set({ leftOpen }),
  setRightOpen: (rightOpen) => set({ rightOpen }),
  saveInvestigation: (inv) =>
    set((st) => {
      const list = [{ ...inv, id: `INV-${Date.now().toString(36).toUpperCase()}`, createdAt: new Date().toISOString() }, ...st.investigations];
      persist(list);
      return { investigations: list };
    }),
  deleteInvestigation: (id) =>
    set((st) => {
      const list = st.investigations.filter((i) => i.id !== id);
      persist(list);
      return { investigations: list };
    }),
}));

function restoreFor(selected: string[]): Inspect {
  return selected.length > 1 ? { kind: 'compare' } : { kind: 'country', id: selected[0]! };
}
