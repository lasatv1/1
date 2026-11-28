import { create } from 'zustand';
import type { DataOrigin, Dataset } from '@/types/intel';
import type { GeoData } from '@/lib/geo/countries';
import { loadGeoData } from '@/lib/geo/countries';
import { generateDemoDataset } from '@/lib/data/demoDataset';
import { checkHealth, checkSnapshot, isEncrypted, loadLiveDataset, loadSnapshotDataset, snapshotVersion, type EncryptedSnapshotMeta } from '@/lib/data/apiClient';
import { b64ToBytes, bytesToB64, deriveKeyBytes, WrongCredentialsError } from '@/lib/auth/crypto';
import { recordFailedLogin } from '@/lib/counter';

/**
 * 'checking' = not decided yet (nothing but a blank screen may render);
 * 'none' = no login needed; 'locked' = sign-in required; 'unlocked' = signed in.
 */
export type AuthState = 'checking' | 'none' | 'locked' | 'unlocked';
/** Set at build time for protected deployments: the app must never render without sign-in. */
const REQUIRE_LOGIN = import.meta.env.VITE_REQUIRE_LOGIN === 'true';
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
  auth: 'checking',
  encryptedMeta: null,
  pendingUpdates: 0,
  lastRefresh: null,

  async init() {
    if (get().geoStatus === 'loading' || get().geoStatus === 'ready') return;
    set({ geoStatus: 'loading', geoError: null, datasetStatus: 'loading' });
    // Decide whether sign-in is required FIRST (in parallel with the map data), so the app
    // never renders, not even for a frame, before that is known.
    // Live data from the API if reachable, else a published snapshot (static hosting),
    // else the clearly labelled demo dataset. VITE_DATA_SOURCE=snapshot skips the API probe.
    const snapshotOnly = import.meta.env.VITE_DATA_SOURCE === 'snapshot';
    const geoP = loadGeoData().then(
      (geo) => set({ geo, geoStatus: 'ready' }),
      (e: unknown) => set({ geoStatus: 'error', geoError: e instanceof Error ? e.message : String(e), datasetStatus: 'idle' }),
    );
    const [health, meta] = await Promise.all([snapshotOnly ? Promise.resolve(null) : checkHealth(), checkSnapshot()]);
    const origin: DataOrigin | null = health ? 'api' : meta ? 'snapshot' : null;
    set({ backendAvailable: origin !== null, liveOrigin: origin });

    if (isEncrypted(meta) || REQUIRE_LOGIN) {
      // Protected site: nothing (not even demo data) until signed in.
      const encryptedMeta = isEncrypted(meta) ? meta : null;
      set({
        encryptedMeta,
        datasetStatus: 'idle',
        datasetError: encryptedMeta ? null : 'The protected data could not be reached. Check your connection and retry.',
      });
      if (encryptedMeta && readSessionKey()) {
        // Still signed in from earlier in this tab: stay on the blank screen while decrypting.
        await geoP;
        await get().useLive();
        if (get().auth !== 'unlocked') set({ auth: 'locked' });
        return;
      }
      set({ auth: 'locked' });
      return;
    }
    set({ auth: 'none' });
    await geoP;
    if (get().geoStatus !== 'ready') return;
    if (origin) await get().useLive();
    else get().useDemo();
  },

  useDemo() {
    if (get().auth === 'locked' || get().auth === 'checking') return;
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
          ? await loadSnapshotDataset(liveAbort.signal, get().encryptedMeta ? readSessionKey() : null)
          : await loadLiveDataset(liveAbort.signal);
      set({ dataset, datasetStatus: 'ready', backendAvailable: true, pendingUpdates: 0, lastRefresh: Date.now(), auth: get().encryptedMeta ? 'unlocked' : 'none' });
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
    set({ dataset: null, datasetStatus: 'idle', auth: get().encryptedMeta || REQUIRE_LOGIN ? 'locked' : 'none' });
  },

  async refresh() {
    const { dataset, liveOrigin, auth } = get();
    if (!dataset || dataset.mode !== 'live' || auth === 'locked' || auth === 'checking') return;
    try {
      if (liveOrigin === 'snapshot') {
        const version = await snapshotVersion();
        if (version && version === snapshotSeen) {
          set({ lastRefresh: Date.now() });
          return;
        }
        const next = await loadSnapshotDataset(undefined, get().encryptedMeta ? readSessionKey() : null);
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
