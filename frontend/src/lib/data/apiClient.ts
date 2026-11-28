/**
 * Thin client for the Ruster Ball backend. The frontend never talks to
 * third-party intelligence APIs directly — keys stay server-side.
 */
import type { CountryNetworkFacts, Dataset, IntelSource, ThreatEvent } from '@/types/intel';
import { decryptSnapshot, type KdfParams } from '@/lib/auth/crypto';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
const MAX_EVENTS = 60_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new ApiError(`Backend responded ${res.status} for ${path}`, res.status);
  return (await res.json()) as T;
}

export interface Health {
  status: 'ok';
  version: string;
  store: string;
}

export async function checkHealth(signal?: AbortSignal): Promise<Health | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    signal?.addEventListener('abort', () => ctrl.abort());
    const h = await get<Health>('/health', ctrl.signal);
    clearTimeout(timer);
    return h;
  } catch {
    return null;
  }
}

interface EventPage {
  items: Omit<ThreatEvent, 't' | 'isDemo'>[];
  nextCursor: string | null;
  total: number;
}

/** Live mode loads up to a year so older (but real) observations stay reachable via the timeline. */
export async function loadLiveDataset(signal?: AbortSignal, days = 365): Promise<Dataset> {
  // Round up to the minute so repeated loads share backend (Redis) cache entries.
  const to = Math.ceil(Date.now() / 60_000) * 60_000;
  const from = to - days * 86_400_000;
  const sources = await get<IntelSource[]>('/sources', signal);
  const events: ThreatEvent[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), limit: '5000' });
    if (cursor) qs.set('cursor', cursor);
    const page: EventPage = await get<EventPage>(`/events?${qs}`, signal);
    for (const e of page.items) events.push({ ...e, t: Date.parse(e.observedAt), isDemo: false });
    cursor = page.nextCursor;
  } while (cursor && events.length < MAX_EVENTS);
  events.sort((a, b) => a.t - b.t);
  const network = await get<Record<string, CountryNetworkFacts>>('/network', signal).catch(() => ({}));
  return {
    mode: 'live',
    origin: 'api',
    events,
    sources,
    network,
    generatedAt: new Date(to).toISOString(),
    extent: [from, to],
  };
}

/* ---------------------------------------------------------------------------
 * Static snapshot (no API server): files published by `python -m app.export`,
 * e.g. on GitHub Pages. Same JSON shapes as the API.
 * ------------------------------------------------------------------------- */

export interface SnapshotMeta {
  schema: number;
  generatedAt: string;
  windowStart: string;
  windowDays: number;
  events: number;
}

/** Public meta.json of a login-protected snapshot: only key-derivation parameters. */
export interface EncryptedSnapshotMeta {
  schema: 2;
  encrypted: true;
  file: string;
  cipher: 'AES-GCM';
  kdf: KdfParams;
}

export type AnySnapshotMeta = SnapshotMeta | EncryptedSnapshotMeta;
export const isEncrypted = (m: AnySnapshotMeta | null): m is EncryptedSnapshotMeta => !!m && 'encrypted' in m && m.encrypted === true;

interface SnapshotBundle {
  meta: SnapshotMeta;
  sources: IntelSource[];
  events: EventPage;
  network: Record<string, CountryNetworkFacts>;
}

const SNAPSHOT = `${import.meta.env.BASE_URL}snapshot/`;

async function getStatic<T>(file: string, signal?: AbortSignal): Promise<T> {
  // Bypass HTTP caches so a fresh deploy is picked up immediately.
  const res = await fetch(`${SNAPSHOT}${file}`, { signal, cache: 'no-cache' });
  if (!res.ok) throw new ApiError(`Snapshot file ${file} not available (${res.status})`, res.status);
  return (await res.json()) as T;
}

/**
 * Cheap change check for the published snapshot (HEAD request): the ETag / Last-Modified
 * of the data file. Lets the page refresh silently only when a new snapshot was deployed.
 */
export async function snapshotVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    const meta = await getStatic<AnySnapshotMeta>('meta.json', signal);
    const file = isEncrypted(meta) ? meta.file : 'events.json';
    const res = await fetch(`${SNAPSHOT}${file}`, { method: 'HEAD', signal, cache: 'no-cache' });
    return res.headers.get('etag') ?? res.headers.get('last-modified') ?? ('generatedAt' in meta ? meta.generatedAt : null);
  } catch {
    return null;
  }
}

export async function checkSnapshot(signal?: AbortSignal): Promise<AnySnapshotMeta | null> {
  try {
    const meta = await getStatic<AnySnapshotMeta>('meta.json', signal);
    if (isEncrypted(meta)) return meta.kdf?.salt ? meta : null;
    return meta.schema === 1 && meta.generatedAt ? meta : null;
  } catch {
    return null;
  }
}

/** Plain snapshot, or an encrypted one when the session key is supplied. */
export async function loadSnapshotDataset(signal?: AbortSignal, keyBytes?: Uint8Array | null): Promise<Dataset> {
  const pub = await getStatic<AnySnapshotMeta>('meta.json', signal);
  if (isEncrypted(pub)) {
    if (!keyBytes) throw new Error('Sign-in required');
    const res = await fetch(`${SNAPSHOT}${pub.file}`, { signal, cache: 'no-cache' });
    if (!res.ok) throw new ApiError(`Encrypted snapshot not available (${res.status})`, res.status);
    const b = await decryptSnapshot<SnapshotBundle>(keyBytes, await res.arrayBuffer());
    return buildSnapshotDataset(b.meta, b.sources, b.events, b.network);
  }
  const [meta, sources, page, network] = await Promise.all([
    getStatic<SnapshotMeta>('meta.json', signal),
    getStatic<IntelSource[]>('sources.json', signal),
    getStatic<EventPage>('events.json', signal),
    getStatic<Record<string, CountryNetworkFacts>>('network.json', signal).catch(() => ({})),
  ]);
  return buildSnapshotDataset(meta, sources, page, network);
}

function buildSnapshotDataset(
  meta: SnapshotMeta,
  sources: IntelSource[],
  page: EventPage,
  network: Record<string, CountryNetworkFacts>,
): Dataset {
  const events: ThreatEvent[] = page.items.map((e) => ({ ...e, t: Date.parse(e.observedAt), isDemo: false }));
  events.sort((a, b) => a.t - b.t);
  const to = Date.parse(meta.generatedAt);
  return {
    mode: 'live',
    origin: 'snapshot',
    events,
    sources,
    network,
    generatedAt: meta.generatedAt,
    extent: [Date.parse(meta.windowStart), to],
  };
}

export function fetchCountryNetwork(iso2: string, signal?: AbortSignal): Promise<CountryNetworkFacts> {
  return get<CountryNetworkFacts>(`/network/${encodeURIComponent(iso2)}`, signal);
}

/** Server-sent events: the backend announces when a source sync stores new observations. */
export function subscribeToUpdates(onSync: (msg: { sourceId: string; newRecords: number }) => void): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const es = new EventSource(`${BASE}/stream`);
  es.addEventListener('sync', (ev) => {
    try {
      onSync(JSON.parse((ev as MessageEvent<string>).data));
    } catch {
      /* ignore malformed message */
    }
  });
  return () => es.close();
}
