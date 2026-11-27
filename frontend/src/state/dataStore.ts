import { create } from 'zustand';
import type { DataOrigin, Dataset } from '@/types/intel';
import type { GeoData } from '@/lib/geo/countries';
import { loadGeoData } from '@/lib/geo/countries';
import { generateDemoDataset } from '@/lib/data/demoDataset';
import { checkHealth, checkSnapshot, loadLiveDataset, loadSnapshotDataset } from '@/lib/data/apiClient';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface DataState {
  geo: GeoData | null;
  geoStatus: Status;
  geoError: string | null;
  dataset: Dataset | null;
  datasetStatus: Status;
  datasetError: string | null;
  /** null = not checked yet */
  backendAvailable: boolean | null;
  /** Which live data source exists: the API, a published static snapshot, or none. */
  liveOrigin: DataOrigin | null;
  pendingUpdates: number;
  init: () => Promise<void>;
  useDemo: () => void;
  useLive: () => Promise<void>;
  notifyUpdate: (n: number) => void;
}

let liveAbort: AbortController | null = null;

export const useDataStore = create<DataState>((set, get) => ({
  geo: null,
  geoStatus: 'idle',
  geoError: null,
  dataset: null,
  datasetStatus: 'idle',
  datasetError: null,
  backendAvailable: null,
  liveOrigin: null,
  pendingUpdates: 0,

  async init() {
    if (get().geoStatus === 'loading' || get().geoStatus === 'ready') return;
    set({ geoStatus: 'loading', geoError: null, datasetStatus: 'loading' });
    try {
      const geo = await loadGeoData();
      set({ geo, geoStatus: 'ready' });
    } catch (e) {
      set({ geoStatus: 'error', geoError: e instanceof Error ? e.message : String(e), datasetStatus: 'idle' });
      return;
    }
    // Live data from the API if reachable, else a published snapshot (static hosting),
    // else the clearly labelled demo dataset. VITE_DATA_SOURCE=snapshot skips the API probe.
    const snapshotOnly = import.meta.env.VITE_DATA_SOURCE === 'snapshot';
    const health = snapshotOnly ? null : await checkHealth();
    const origin: DataOrigin | null = health ? 'api' : (await checkSnapshot()) ? 'snapshot' : null;
    set({ backendAvailable: origin !== null, liveOrigin: origin });
    if (origin) await get().useLive();
    else get().useDemo();
  },

  useDemo() {
    liveAbort?.abort();
    const geo = get().geo;
    if (!geo) return;
    set({ dataset: generateDemoDataset(geo.countries), datasetStatus: 'ready', datasetError: null, pendingUpdates: 0 });
  },

  async useLive() {
    liveAbort?.abort();
    liveAbort = new AbortController();
    set({ datasetStatus: 'loading', datasetError: null });
    try {
      const dataset =
        get().liveOrigin === 'snapshot' ? await loadSnapshotDataset(liveAbort.signal) : await loadLiveDataset(liveAbort.signal);
      set({ dataset, datasetStatus: 'ready', backendAvailable: true, pendingUpdates: 0 });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      set({ datasetStatus: 'error', datasetError: e instanceof Error ? e.message : String(e) });
    }
  },

  notifyUpdate(n) {
    set((s) => ({ pendingUpdates: s.pendingUpdates + n }));
  },
}));
