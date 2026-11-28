import { create } from 'zustand';
import type { DataOrigin, Dataset } from '@/types/intel';
import type { GeoData } from '@/lib/geo/countries';
import { loadGeoData } from '@/lib/geo/countries';
import { generateDemoDataset } from '@/lib/data/demoDataset';
import { checkHealth, checkSnapshot, isEncrypted, loadLiveDataset, loadSnapshotDataset, snapshotVersion, type EncryptedSnapshotMeta } from '@/lib/data/apiClient';
import { b64ToBytes, bytesToB64, deriveKeyBytes, WrongCredentialsError } from '@/lib/auth/crypto';
import { recordFailedLogin } from '@/lib/counter';

/** 'none' = no login needed; 'locked' = encrypted site, not signed in. */
export type AuthState = 'none' | 'locked' | 'unlocked';
const SESSION_KEY = 'cta.session.key';
const readSessionKey = () => {
  try {
    const v = sessionStorage.getItem(SESSION_KEY);
    return v ? b64ToBytes(v) : null;
  } catch {
    return null;
  }
};

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
  auth: AuthState;
  encryptedMeta: EncryptedSnapshotMeta | null;
  pendingUpdates: number;
  /** When live data was last checked for updates (epoch ms). */
  lastRefresh: number | null;
  /** Silent background refresh: swaps in new data only if it changed. */
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  init: () => Promise<void>;
  useDemo: () => void;
  useLive: () => Promise<void>;
  notifyUpdate: (n: number) => void;
}

let liveAbort: AbortController | null = null;
/** Version (ETag) of the snapshot currently shown, for change detection. */
let snapshotSeen: string | null = null;

export const useDataStore = create<DataState>((set, get) => ({
  geo: null,
  geoStatus: 'idle',
  geoError: null,
  dataset: null,
  datasetStatus: 'idle',
  datasetError: null,
  backendAvailable: null,
  liveOrigin: null,
  auth: 'none',
  encryptedMeta: null,
  pendingUpdates: 0,
  lastRefresh: null,

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
    const meta = health ? null : await checkSnapshot();
    const origin: DataOrigin | null = health ? 'api' : meta ? 'snapshot' : null;
    set({ backendAvailable: origin !== null, liveOrigin: origin });
    if (isEncrypted(meta)) {
      // Login-protected site: show nothing (not even demo data) until signed in.
      set({ auth: 'locked', encryptedMeta: meta, datasetStatus: 'idle' });
      if (readSessionKey()) await get().useLive(); // still signed in from earlier in this tab
      return;
    }
    if (origin) await get().useLive();
    else get().useDemo();
  },

  useDemo() {
    if (get().auth === 'locked') return;
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
        get().liveOrigin === 'snapshot'
          ? await loadSnapshotDataset(liveAbort.signal, get().auth === 'none' ? null : readSessionKey())
          : await loadLiveDataset(liveAbort.signal);
      set({ dataset, datasetStatus: 'ready', backendAvailable: true, pendingUpdates: 0, lastRefresh: Date.now(), auth: get().auth === 'none' ? 'none' : 'unlocked' });
      if (get().liveOrigin === 'snapshot') void snapshotVersion().then((v) => (snapshotSeen = v));
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      if (e instanceof WrongCredentialsError) {
        // Stale session key (e.g. password changed and site republished): sign in again.
        get().logout();
        return;
      }
      set({ datasetStatus: 'error', datasetError: e instanceof Error ? e.message : String(e) });
    }
  },

  async login(username, password) {
    const meta = get().encryptedMeta;
    if (!meta) return;
    const key = await deriveKeyBytes(username.trim(), password, meta.kdf);
    try {
      // Verify by actually decrypting; wrong credentials fail GCM authentication.
      const dataset = await loadSnapshotDataset(undefined, key);
      try {
        sessionStorage.setItem(SESSION_KEY, bytesToB64(key));
      } catch {
        /* private mode: stay signed in until reload */
      }
      set({ dataset, datasetStatus: 'ready', datasetError: null, auth: 'unlocked', lastRefresh: Date.now() });
      void snapshotVersion().then((v) => (snapshotSeen = v));
    } catch (e) {
      if (e instanceof WrongCredentialsError) recordFailedLogin();
      throw e;
    }
  },

  logout() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    liveAbort?.abort();
    set({ dataset: null, datasetStatus: 'idle', auth: get().encryptedMeta ? 'locked' : 'none' });
  },

  async refresh() {
    const { dataset, liveOrigin, auth } = get();
    if (!dataset || dataset.mode !== 'live' || auth === 'locked') return;
    try {
      if (liveOrigin === 'snapshot') {
        const version = await snapshotVersion();
        if (version && version === snapshotSeen) {
          set({ lastRefresh: Date.now() });
          return;
        }
        const next = await loadSnapshotDataset(undefined, auth === 'none' ? null : readSessionKey());
        snapshotSeen = version;
        set({ dataset: next, lastRefresh: Date.now(), pendingUpdates: 0 });
      } else if (liveOrigin === 'api') {
        const next = await loadLiveDataset();
        set({ dataset: next, lastRefresh: Date.now(), pendingUpdates: 0 });
      }
    } catch {
      // Keep showing the current data; the next refresh tries again.
      set({ lastRefresh: Date.now() });
    }
  },

  notifyUpdate(n) {
    set((s) => ({ pendingUpdates: s.pendingUpdates + n }));
  },
}));
