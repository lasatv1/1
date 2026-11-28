import { create } from 'zustand';
import { LIVE_FEEDS } from './feeds';
import type { FeedResult } from './types';

export type FeedStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface FeedState {
  status: FeedStatus;
  /** When we last received data successfully (epoch ms). */
  updatedAt: number | null;
  error: string | null;
  data: FeedResult | null;
}

interface LiveState {
  enabled: Set<string>;
  feeds: Record<string, FeedState>;
  hovered: { feed: string; id: string } | null;
  /** Historical map period (file key in the historical-basemaps collection). */
  histYear: string;
  /** Route drawn for the selected aircraft (origin → destination). */
  route: { from: [number, number]; to: [number, number]; at?: [number, number] } | null;
  toggle: (id: string) => void;
  setHistYear: (y: string) => void;
  setRoute: (r: LiveState['route']) => void;
  setFeed: (id: string, s: Partial<FeedState>) => void;
  setHovered: (h: { feed: string; id: string } | null) => void;
}

const KEY = 'cta.live.enabled.v2';

function loadEnabled(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return new Set((JSON.parse(raw) as string[]).filter((id) => LIVE_FEEDS.some((f) => f.id === id)));
  } catch {
    /* ignore */
  }
  return new Set(LIVE_FEEDS.filter((f) => f.defaultOn).map((f) => f.id));
}

const empty = (): FeedState => ({ status: 'idle', updatedAt: null, error: null, data: null });

export const useLiveStore = create<LiveState>((set, get) => ({
  enabled: loadEnabled(),
  feeds: Object.fromEntries(LIVE_FEEDS.map((f) => [f.id, empty()])),
  hovered: null,
  histYear: (() => {
    try {
      return localStorage.getItem('cta.live.histYear') ?? '1914';
    } catch {
      return '1914';
    }
  })(),
  route: null,
  setHistYear: (histYear) => {
    try {
      localStorage.setItem('cta.live.histYear', histYear);
    } catch {
      /* ignore */
    }
    set({ histYear });
  },
  setRoute: (route) => set({ route }),
  toggle: (id) => {
    const enabled = new Set(get().enabled);
    if (enabled.has(id)) enabled.delete(id);
    else enabled.add(id);
    try {
      localStorage.setItem(KEY, JSON.stringify([...enabled]));
    } catch {
      /* ignore */
    }
    set({ enabled });
  },
  setFeed: (id, s) => set((st) => ({ feeds: { ...st.feeds, [id]: { ...(st.feeds[id] ?? empty()), ...s } } })),
  setHovered: (hovered) => {
    const cur = get().hovered;
    if (cur?.feed === hovered?.feed && cur?.id === hovered?.id) return;
    set({ hovered });
  },
}));
