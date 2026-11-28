/**
 * Live feeds. Every source here is keyless.
 *  - transport 'browser'  : the browser calls the provider directly (CORS-enabled), so the
 *                           layer is genuinely live (refresh interval per feed).
 *  - transport 'scheduled': the provider blocks browser calls, so the GitHub job fetches it
 *                           every 15 minutes and publishes a static file next to the site.
 */
import { json2satrec } from '@/vendor/satellite';
import { severityColor } from '@/design/tokens';
import type { FeedContext, FeedResult, LiveEntity, LiveFeedDef, LiveLine } from './types';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

async function getJson<T>(url: string, signal: AbortSignal, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { signal, ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

const fmtTime = (t: number | string) => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
};

/* --------------------------------------------------------------- Cyber: SANS ISC */

interface IscSource {
  ip: string;
  attacks: number;
  count: number;
  firstseen: string;
  lastseen: string;
}
interface IscIp {
  ip: { as?: number; asname?: string; ascountry?: string; network?: string; threatfeeds?: Record<string, { lastseen: string }> };
}
const IP_CACHE = 'cta.isc.ipcache.v1';
type IpInfo = { as?: number; asname?: string; cc?: string; network?: string; feeds?: string[]; at: number };

function readIpCache(): Record<string, IpInfo> {
  try {
    return JSON.parse(localStorage.getItem(IP_CACHE) ?? '{}') as Record<string, IpInfo>;
  } catch {
    return {};
  }
}

async function iscIpInfo(ip: string, signal: AbortSignal, cache: Record<string, IpInfo>): Promise<IpInfo | null> {
  const hit = cache[ip];
  if (hit && Date.now() - hit.at < 24 * HOUR) return hit;
  try {
    const d = await getJson<IscIp>(`https://isc.sans.edu/api/ip/${encodeURIComponent(ip)}?json`, signal);
    const info: IpInfo = {
      as: d.ip.as,
      asname: d.ip.asname,
      cc: d.ip.ascountry?.toUpperCase(),
      network: d.ip.network?.replace('\\/', '/'),
      feeds: Object.keys(d.ip.threatfeeds ?? {}).slice(0, 6),
      at: Date.now(),
    };
    cache[ip] = info;
    return info;
  } catch {
    return hit ?? null;
  }
}

async function fetchDshield({ geo, signal }: FeedContext): Promise<FeedResult> {
  const top = await getJson<IscSource[]>('https://isc.sans.edu/api/sources/attacks/30?json', signal);
  const cache = readIpCache();
  const infos: Array<IpInfo | null> = [];
  // Small concurrency: be polite to a free community service.
  for (let i = 0; i < top.length; i += 4) infos.push(...(await Promise.all(top.slice(i, i + 4).map((s) => iscIpInfo(s.ip, signal, cache)))));
  try {
    localStorage.setItem(IP_CACHE, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
  const maxAttacks = Math.max(1, ...top.map((s) => s.attacks));
  const entities: LiveEntity[] = [];
  top.forEach((s, i) => {
    const info = infos[i];
    const c = info?.cc ? geo.byId.get(info.cc) : undefined;
    if (!c) return; // no registration country → cannot place honestly
    const rank = i + 1;
    const sev = rank <= 3 ? 'critical' : rank <= 10 ? 'high' : 'medium';
    entities.push({
      id: s.ip,
      // Spread attackers registered in the same country so they don't overlap.
      lng: c.anchor[0] + (hash(s.ip) - 0.5) * 3,
      lat: c.anchor[1] + (hash(s.ip + 'y') - 0.5) * 2,
      label: s.ip,
      sub: `#${rank} attacker · ${info?.asname ?? 'unknown network'}`,
      color: severityColor[sev],
      size: Math.sqrt(s.attacks / maxAttacks),
      props: [
        ['Rank (attacks)', `#${rank}`],
        ['Targets attacked', s.attacks.toLocaleString()],
        ['Reports', s.count.toLocaleString()],
        ['First seen', s.firstseen],
        ['Last seen', s.lastseen],
        ['Network (AS)', info?.as ? `AS${info.as} ${info.asname ?? ''}` : '—'],
        ['Network block', info?.network ?? '—'],
        ['AS registered in', c.name],
        ['Also listed by', info?.feeds?.length ? info.feeds.join(', ') : '—'],
      ],
      url: `https://isc.sans.edu/ipinfo/${s.ip}`,
    });
  });
  return { entities };
}

async function fetchInfocon({ signal }: FeedContext): Promise<FeedResult> {
  const d = await getJson<{ status: string }>('https://isc.sans.edu/api/infocon?json', signal);
  return { entities: [], meta: { status: d.status } };
}

/* ------------------------------------------------------------ Hazards: USGS / EONET */

interface UsgsFC {
  metadata: { generated: number };
  features: Array<{
    id: string;
    properties: { mag: number; place: string; time: number; url: string; tsunami: number; alert: string | null; sig: number };
    geometry: { coordinates: [number, number, number] };
  }>;
}

async function fetchQuakes({ signal }: FeedContext): Promise<FeedResult> {
  const d = await getJson<UsgsFC>('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', signal);
  const entities = d.features.map((f): LiveEntity => {
    const m = f.properties.mag ?? 0;
    const sev = m >= 6 ? 'critical' : m >= 5 ? 'high' : m >= 4 ? 'medium' : 'low';
    return {
      id: f.id,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      t: f.properties.time,
      label: `M${m.toFixed(1)} earthquake`,
      sub: f.properties.place,
      color: severityColor[sev],
      size: Math.min(1, Math.max(0.15, (m - 2) / 5)),
      props: [
        ['Magnitude', m.toFixed(1)],
        ['Depth', `${f.geometry.coordinates[2].toFixed(0)} km`],
        ['Location', f.properties.place],
        ['Time', fmtTime(f.properties.time)],
        ['Tsunami flag', f.properties.tsunami ? 'Yes' : 'No'],
        ['PAGER alert', f.properties.alert ?? '—'],
      ],
      url: f.properties.url,
    };
  });
  return { entities, sourceTime: d.metadata.generated };
}

interface EonetResp {
  events: Array<{
    id: string;
    title: string;
    link: string;
    categories: Array<{ id: string; title: string }>;
    sources: Array<{ url: string }>;
    geometry: Array<{ date: string; type: string; coordinates: [number, number] | number[][][] }>;
  }>;
}
const EONET_COLOR: Record<string, string> = {
  wildfires: '#AC4A44',
  severeStorms: '#537493',
  volcanoes: '#A68A3A',
  floods: '#4F7FA0',
  seaLakeIce: '#8AA3B8',
  dustHaze: '#9A8466',
};

async function fetchEonet({ signal }: FeedContext): Promise<FeedResult> {
  const d = await getJson<EonetResp>('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=400', signal);
  const entities: LiveEntity[] = [];
  for (const e of d.events) {
    const g = e.geometry[e.geometry.length - 1];
    if (!g || g.type !== 'Point') continue;
    const [lng, lat] = g.coordinates as [number, number];
    const cat = e.categories[0];
    entities.push({
      id: e.id,
      lng,
      lat,
      t: Date.parse(g.date),
      label: e.title,
      sub: cat?.title,
      color: EONET_COLOR[cat?.id ?? ''] ?? '#7A8592',
      size: 0.35,
      props: [
        ['Category', cat?.title ?? '—'],
        ['Last update', fmtTime(g.date)],
        ['Track points', String(e.geometry.length)],
      ],
      url: e.sources[0]?.url ?? e.link,
    });
  }
  return { entities };
}

/* ---------------------------------------------------------------- Space: launches / satellites */

interface LaunchResp {
  results: Array<{
    id: string;
    name: string;
    net: string;
    status?: { abbrev: string; name: string };
    launch_service_provider?: { name: string };
    pad?: { name: string; latitude: string | number; longitude: string | number; location?: { name: string } };
    url?: string;
  }>;
}

async function fetchLaunches({ signal }: FeedContext): Promise<FeedResult> {
  const d = await getJson<LaunchResp>('https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=15&mode=normal', signal);
  const entities: LiveEntity[] = [];
  for (const l of d.results) {
    const lat = Number(l.pad?.latitude);
    const lng = Number(l.pad?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    entities.push({
      id: l.id,
      lng,
      lat,
      t: Date.parse(l.net),
      label: l.name,
      sub: `${l.status?.abbrev ?? ''} · NET ${fmtTime(l.net)}`,
      color: '#528270',
      size: 0.45,
      props: [
        ['Provider', l.launch_service_provider?.name ?? '—'],
        ['No earlier than', fmtTime(l.net)],
        ['Status', l.status?.name ?? '—'],
        ['Pad', l.pad?.name ?? '—'],
        ['Site', l.pad?.location?.name ?? '—'],
      ],
    });
  }
  return { entities };
}

interface Omm {
  OBJECT_NAME: string;
  NORAD_CAT_ID: number;
  EPOCH: string;
  INCLINATION: number;
  MEAN_MOTION: number;
  OBJECT_ID: string;
}

function satFeed(group: string): (ctx: FeedContext) => Promise<FeedResult> {
  return async ({ signal }) => {
    const omm = await getJson<Omm[]>(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`, signal);
    const entities: LiveEntity[] = [];
    for (const o of omm) {
      try {
        const satrec = json2satrec(o as never);
        entities.push({
          id: String(o.NORAD_CAT_ID),
          lng: 0,
          lat: 0,
          label: o.OBJECT_NAME,
          sub: `NORAD ${o.NORAD_CAT_ID}`,
          satrec,
          props: [
            ['NORAD ID', String(o.NORAD_CAT_ID)],
            ['International ID', o.OBJECT_ID],
            ['Inclination', `${o.INCLINATION.toFixed(1)}°`],
            ['Orbital period', `${(1440 / o.MEAN_MOTION).toFixed(1)} min`],
            ['Elements epoch', fmtTime(o.EPOCH + 'Z')],
          ],
          url: `https://celestrak.org/satcat/table-satcat.php?CATNR=${o.NORAD_CAT_ID}`,
        });
      } catch {
        /* skip malformed elements */
      }
    }
    return { entities };
  };
}

/* ------------------------------------------------- Scheduled (published by the GitHub job) */

const LIVE_BASE = `${import.meta.env.BASE_URL}live/`;

async function scheduled<T>(file: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(`${LIVE_BASE}${file}`, { signal, cache: 'no-cache' });
  if (res.status === 404 || (res.headers.get('content-type') ?? '').includes('text/html')) {
    throw new Error('Published by the scheduled job; not available in this build');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** [icao24, callsign, lng, lat, altM, speedMs, headingDeg, country, aircraftType] */
type FlightRow = [string, string, number, number, number | null, number | null, number | null, string, string?];
interface FlightsFile {
  time: number;
  source: string;
  rows: FlightRow[];
}

function flightsFeed(file: string, military: boolean): (ctx: FeedContext) => Promise<FeedResult> {
  return async ({ signal }) => {
    const d = await scheduled<FlightsFile>(file, signal);
    const t = d.time * 1000;
    const entities = d.rows.map(([hex, cs, lng, lat, alt, spd, hdg, country, type]): LiveEntity => ({
      id: hex,
      lng,
      lat,
      altKm: alt != null ? alt / 1000 : undefined,
      heading: hdg ?? undefined,
      speedKts: spd != null ? spd * 1.94384 : undefined,
      t,
      label: cs.trim() || hex.toUpperCase(),
      sub: military ? `Military aircraft${type ? ` · ${type}` : ''}` : country,
      color: military ? '#B37036' : undefined,
      size: 0.4,
      props: [
        ['Callsign', cs.trim() || '—'],
        ['ICAO hex', hex.toUpperCase()],
        ...(type ? ([['Aircraft type', type]] as Array<[string, string]>) : []),
        ...(military ? [] : ([['Registered in', country || '—']] as Array<[string, string]>)),
        ['Altitude', alt != null ? `${Math.round(alt * 3.28084).toLocaleString()} ft` : '—'],
        ['Ground speed', spd != null ? `${Math.round(spd * 1.94384)} kt` : '—'],
        ['Heading', hdg != null ? `${Math.round(hdg)}°` : '—'],
        ['Position time', fmtTime(t)],
      ],
      url: `https://globe.adsb.lol/?icao=${hex}`,
    }));
    return { entities, sourceTime: t };
  };
}

interface CablesFile {
  time: number;
  cables: Array<{ id: string; name: string; coords: Array<Array<[number, number]>> }>;
}

async function fetchCables({ signal }: FeedContext): Promise<FeedResult> {
  const d = await scheduled<CablesFile>('cables.json', signal);
  const lines: LiveLine[] = d.cables.map((c) => ({ id: c.id, label: c.name, coords: c.coords, props: [['Cable', c.name]] }));
  return { entities: [], lines, sourceTime: d.time * 1000 };
}

/* ----------------------------------------------------------- Conflict: GDELT events */

/** [id, unix, root, code, actor1, actor2, place, lng, lat, goldstein, mentions, url] */
type ConflictRow = [string, number, string, string, string, string, string, number, number, number, number, string];
const CONFLICT_KIND: Record<string, { label: string; rank: number; sev: 'critical' | 'high' | 'medium' | 'info' }> = {
  '20': { label: 'Mass violence', rank: 4, sev: 'critical' },
  '19': { label: 'Fighting', rank: 3, sev: 'high' },
  '18': { label: 'Assault', rank: 2, sev: 'medium' },
  '14': { label: 'Protest', rank: 1, sev: 'info' },
};

async function fetchConflict({ signal }: FeedContext): Promise<FeedResult> {
  const d = await scheduled<{ time: number; events: ConflictRow[] }>('conflict.json', signal);
  // GDELT geocodes to place centroids, so many reports share a point: aggregate per place.
  const byPlace = new Map<string, { rows: ConflictRow[]; top: ConflictRow }>();
  for (const r of d.events) {
    const k = `${r[7]},${r[8]}`;
    const g = byPlace.get(k);
    if (!g) byPlace.set(k, { rows: [r], top: r });
    else {
      g.rows.push(r);
      const a = CONFLICT_KIND[r[2]]?.rank ?? 0;
      const b = CONFLICT_KIND[g.top[2]]?.rank ?? 0;
      if (a > b || (a === b && r[10] > g.top[10])) g.top = r;
    }
  }
  const maxN = Math.max(1, ...[...byPlace.values()].map((g) => g.rows.length));
  const entities: LiveEntity[] = [...byPlace.values()].map(({ rows, top }) => {
    const kind = CONFLICT_KIND[top[2]] ?? CONFLICT_KIND['18']!;
    const counts = Object.entries(CONFLICT_KIND)
      .map(([code, k]) => [k.label, rows.filter((r) => r[2] === code).length] as const)
      .filter(([, n]) => n > 0);
    const latest = rows.reduce((a, r) => (r[1] > a[1] ? r : a), rows[0]!);
    const actors = [top[4], top[5]].filter(Boolean).join(' → ');
    return {
      id: `${top[7]},${top[8]}`,
      lng: top[7],
      lat: top[8],
      t: latest[1] * 1000,
      label: top[6] || 'Unnamed location',
      sub: `${kind.label} · ${rows.length} report${rows.length > 1 ? 's' : ''} in 24 h`,
      color: severityColor[kind.sev],
      size: Math.sqrt(rows.length / maxN),
      props: [
        ['Most severe type', kind.label],
        ...counts.map(([l, n]) => [l, `${n} report${n > 1 ? 's' : ''}`] as [string, string]),
        ['Actors (top report)', actors || '—'],
        ['Latest report', fmtTime(latest[1] * 1000)],
        ['Media mentions (top)', String(top[10])],
      ],
      url: latest[11],
    };
  });
  return { entities, sourceTime: d.time * 1000 };
}

/* ----------------------------------------------------------------------- Sea: ships */

const shipCategory = (type: number | null | undefined): { name: string; color: string } => {
  const t = type ?? 0;
  if (t >= 70 && t <= 79) return { name: 'Cargo', color: '#537493' };
  if (t >= 80 && t <= 89) return { name: 'Tanker', color: '#A68A3A' };
  if (t >= 60 && t <= 69) return { name: 'Passenger', color: '#528270' };
  if (t === 30) return { name: 'Fishing', color: '#7A8592' };
  if (t === 35 || t === 55) return { name: t === 35 ? 'Military' : 'Law enforcement', color: '#B37036' };
  if (t === 52 || t === 31 || t === 32) return { name: 'Tug / towing', color: '#8B7A99' };
  if (t === 36 || t === 37) return { name: t === 36 ? 'Sailing' : 'Pleasure craft', color: '#8FA9C2' };
  if (t >= 40 && t <= 49) return { name: 'High-speed craft', color: '#6F9E8E' };
  return { name: 'Other / unknown', color: '#8B949E' };
};

/** [mmsi, name, lng, lat, sog_kn, cog, heading, type, dest, trail[[lng,lat,t]], t] */
type ShipRow = [number, string, number, number, number | null, number | null, number | null, number | null, string, Array<[number, number, number]>, number];

async function fetchShipsGlobal({ signal }: FeedContext): Promise<FeedResult> {
  const d = await scheduled<{ time: number; rows: ShipRow[] }>('ships.json', signal);
  const entities: LiveEntity[] = [];
  const lines: LiveLine[] = [];
  for (const [mmsi, name, lng, lat, sog, cog, hdg, type, dest, trail, t] of d.rows) {
    const cat = shipCategory(type);
    const label = name || `MMSI ${mmsi}`;
    entities.push({
      id: String(mmsi),
      lng,
      lat,
      heading: hdg ?? cog ?? undefined,
      speedKts: sog != null && sog < 60 ? sog : undefined,
      t: t * 1000,
      label,
      sub: `${cat.name}${dest ? ` → ${dest}` : ''}`,
      color: cat.color,
      size: 0.4,
      props: [
        ['Vessel type', cat.name],
        ['MMSI', String(mmsi)],
        ['Destination (reported)', dest || '—'],
        ['Speed', sog != null ? `${sog.toFixed(1)} kn` : '—'],
        ['Course', cog != null ? `${Math.round(cog)}°` : '—'],
        ['Position time', fmtTime(t * 1000)],
      ],
      url: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}`,
    });
    if (trail.length) lines.push({ id: String(mmsi), label: `${label} — track`, coords: [[...trail.map((p) => [p[0], p[1]] as [number, number]), [lng, lat]]], props: [] });
  }
  return { entities, lines, sourceTime: d.time * 1000 };
}

interface DtFC {
  features: Array<{ properties: { mmsi: number; sog: number; cog: number; heading: number; navStat: number; timestampExternal: number }; geometry: { coordinates: [number, number] } }>;
}
interface DtVessel {
  mmsi: number;
  name: string;
  destination: string;
  shipType: number;
  callSign: string;
}
let dtVessels: { at: number; byMmsi: Map<number, DtVessel> } | null = null;
const DT_HEADERS = { 'Digitraffic-User': 'cyberthreat-atlas' };

async function fetchShipsBaltic({ signal }: FeedContext): Promise<FeedResult> {
  const [locs] = await Promise.all([
    getJson<DtFC>('https://meri.digitraffic.fi/api/ais/v1/locations', signal, { headers: DT_HEADERS }),
    (async () => {
      if (dtVessels && Date.now() - dtVessels.at < 30 * MIN) return;
      const v = await getJson<DtVessel[]>('https://meri.digitraffic.fi/api/ais/v1/vessels', signal, { headers: DT_HEADERS }).catch(() => []);
      dtVessels = { at: Date.now(), byMmsi: new Map(v.map((x) => [x.mmsi, x])) };
    })(),
  ]);
  const entities: LiveEntity[] = [];
  for (const f of locs.features) {
    const p = f.properties;
    const v = dtVessels?.byMmsi.get(p.mmsi);
    const cat = shipCategory(v?.shipType);
    const moving = p.sog > 0.5 && p.sog < 60;
    entities.push({
      id: String(p.mmsi),
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      heading: p.heading < 360 ? p.heading : p.cog < 360 ? p.cog : undefined,
      speedKts: moving ? p.sog : undefined,
      t: p.timestampExternal,
      label: v?.name || `MMSI ${p.mmsi}`,
      sub: `${cat.name}${v?.destination ? ` → ${v.destination}` : ''}`,
      color: cat.color,
      size: 0.35,
      props: [
        ['Vessel type', cat.name],
        ['MMSI', String(p.mmsi)],
        ['Call sign', v?.callSign || '—'],
        ['Destination (reported)', v?.destination || '—'],
        ['Speed', `${p.sog.toFixed(1)} kn`],
        ['Course', p.cog < 360 ? `${Math.round(p.cog)}°` : '—'],
        ['Position time', fmtTime(p.timestampExternal)],
      ],
    });
  }
  return { entities };
}

/* --------------------------------------------------- History: borders through time */

/** Periods available in aourednik/historical-basemaps (GPL-3.0). */
export const HIST_YEARS: Array<{ key: string; label: string }> = [
  'bc10000', 'bc5000', 'bc3000', 'bc2000', 'bc1500', 'bc1000', 'bc700', 'bc500', 'bc323', 'bc200', 'bc1',
  '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000', '1100', '1200', '1279', '1300', '1400',
  '1492', '1500', '1530', '1600', '1650', '1700', '1715', '1783', '1800', '1815', '1878', '1880', '1900', '1914',
  '1920', '1930', '1938', '1945', '1960', '1994', '2000', '2010',
].map((key) => ({ key, label: key.startsWith('bc') ? `${Number(key.slice(2)).toLocaleString()} BC` : `${key} AD` }));

interface HistFC {
  features: Array<{ properties: Record<string, string | number | null>; geometry: { type: string; coordinates: unknown } | null }>;
}

async function fetchHistory({ signal, histYear }: FeedContext): Promise<FeedResult> {
  const d = await getJson<HistFC>(`https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_${histYear}.geojson`, signal);
  const lines: LiveLine[] = [];
  d.features.forEach((f, i) => {
    const g = f.geometry;
    if (!g) return;
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as Array<Array<Array<[number, number]>>>;
    const name = String(f.properties.NAME ?? f.properties.name ?? f.properties.ABBREVN ?? 'Unnamed');
    const subject = f.properties.SUBJECTO ? String(f.properties.SUBJECTO) : '';
    lines.push({
      id: `${i}`,
      label: name,
      coords: polys.flatMap((p) => p),
      props: [
        ['Entity', name],
        ...(subject && subject !== name ? ([['Part of / subject to', subject]] as Array<[string, string]>) : []),
        ['Border precision', String(f.properties.BORDERPRECISION ?? '—')],
      ],
    });
  });
  return { entities: [], lines };
}

/* ------------------------------------------------------------------------ registry */

export const LIVE_FEEDS: LiveFeedDef[] = [
  {
    id: 'conflict',
    name: 'Conflict & unrest (24 h)',
    group: 'Conflict',
    description: 'Fighting, assaults, mass violence and protests reported in world news, coded by GDELT every 15 minutes.',
    shape: 'ring',
    color: '#AC4A44',
    intervalMs: 3 * MIN,
    transport: 'scheduled',
    defaultOn: true,
    attribution: { name: 'The GDELT Project', url: 'https://www.gdeltproject.org', license: 'Free and open, with attribution' },
    caveat: 'Machine-coded from news reports: event types and places can be wrong, and one incident may be reported many times.',
    fetch: fetchConflict,
  },
  {
    id: 'dshield',
    name: 'Live attackers (DShield)',
    group: 'Cyber',
    description: 'Top 30 IPs attacking SANS DShield sensors right now, by number of targets.',
    shape: 'diamond',
    color: '#AC4A44',
    intervalMs: 10 * MIN,
    transport: 'browser',
    defaultOn: true,
    attribution: { name: 'SANS Internet Storm Center / DShield', url: 'https://isc.sans.edu', license: 'Free for non-commercial use with attribution' },
    caveat: 'Placed in the country where the attacking network (AS) is registered — not where the operator is.',
    fetch: fetchDshield,
  },
  {
    id: 'infocon',
    name: 'Global threat level (ISC InfoCon)',
    group: 'Cyber',
    description: 'SANS Internet Storm Center overall Internet threat level.',
    shape: 'dot',
    color: '#528270',
    intervalMs: 5 * MIN,
    transport: 'browser',
    defaultOn: true,
    mapless: true,
    attribution: { name: 'SANS Internet Storm Center', url: 'https://isc.sans.edu/infocon.html', license: 'Free with attribution' },
    fetch: fetchInfocon,
  },
  {
    id: 'cables',
    name: 'Submarine internet cables',
    group: 'Infrastructure',
    description: 'Undersea fibre cables carrying intercontinental internet traffic.',
    shape: 'line',
    color: '#6F8AA3',
    intervalMs: 6 * HOUR,
    transport: 'scheduled',
    defaultOn: false,
    attribution: { name: 'TeleGeography Submarine Cable Map', url: 'https://www.submarinecablemap.com', license: 'CC BY-NC-SA 3.0 (non-commercial)' },
    fetch: fetchCables,
  },
  {
    id: 'ships',
    name: 'Ships worldwide (AIS)',
    group: 'Sea',
    description: 'Vessel positions with recent tracks, collected every 15 minutes from AISStream.',
    shape: 'ship',
    color: '#537493',
    intervalMs: 3 * MIN,
    transport: 'scheduled',
    defaultOn: true,
    attribution: { name: 'AISStream.io', url: 'https://aisstream.io', license: 'Free (beta); AIS is a public broadcast' },
    caveat: 'Positions between updates are estimated from speed and course. Destinations are typed in by crews and often abbreviated.',
    fetch: fetchShipsGlobal,
  },
  {
    id: 'ships-baltic',
    name: 'Ships — Baltic Sea (real-time)',
    group: 'Sea',
    description: 'Live AIS from the Finnish Transport Infrastructure Agency (Digitraffic), refreshed every minute.',
    shape: 'ship',
    color: '#537493',
    intervalMs: 1 * MIN,
    transport: 'browser',
    defaultOn: false,
    attribution: { name: 'Fintraffic / Digitraffic', url: 'https://www.digitraffic.fi/en/marine-traffic/', license: 'CC BY 4.0' },
    fetch: fetchShipsBaltic,
  },
  {
    id: 'history',
    name: 'Historical borders',
    group: 'History',
    description: 'World political borders at a chosen point in history (pick the period below).',
    shape: 'line',
    color: '#8A6430',
    intervalMs: 24 * HOUR,
    transport: 'browser',
    defaultOn: false,
    attribution: { name: 'historical-basemaps (A. Ourednik)', url: 'https://github.com/aourednik/historical-basemaps', license: 'GPL-3.0' },
    caveat: 'Historical borders are approximate; precision varies by period and region.',
    fetch: fetchHistory,
  },
  {
    id: 'quakes',
    name: 'Earthquakes (M2.5+, 24 h)',
    group: 'Hazards',
    description: 'USGS real-time earthquake feed, updated every minute.',
    shape: 'ring',
    color: '#A68A3A',
    intervalMs: 1 * MIN,
    transport: 'browser',
    defaultOn: true,
    attribution: { name: 'USGS Earthquake Hazards Program', url: 'https://earthquake.usgs.gov', license: 'U.S. public domain' },
    fetch: fetchQuakes,
  },
  {
    id: 'eonet',
    name: 'Natural events (fires, storms, volcanoes)',
    group: 'Hazards',
    description: 'Open natural events tracked by NASA EONET.',
    shape: 'dot',
    color: '#AC4A44',
    intervalMs: 10 * MIN,
    transport: 'browser',
    defaultOn: false,
    attribution: { name: 'NASA EONET', url: 'https://eonet.gsfc.nasa.gov', license: 'NASA open data' },
    fetch: fetchEonet,
  },
  {
    id: 'flights',
    name: 'Flights (worldwide)',
    group: 'Air',
    description: 'Airborne aircraft from OpenSky, moved by speed and heading between 15-minute snapshots.',
    shape: 'plane',
    color: '#5A6E82',
    intervalMs: 2 * MIN,
    transport: 'scheduled',
    defaultOn: false,
    attribution: { name: 'The OpenSky Network', url: 'https://opensky-network.org', license: 'Non-commercial research/education' },
    caveat: 'Positions between snapshots are estimated from speed and heading.',
    fetch: flightsFeed('flights.json', false),
  },
  {
    id: 'military',
    name: 'Military aircraft',
    group: 'Air',
    description: 'Aircraft flagged military by adsb.lol, refreshed every 15 minutes.',
    shape: 'plane',
    color: '#B37036',
    intervalMs: 2 * MIN,
    transport: 'scheduled',
    defaultOn: true,
    attribution: { name: 'adsb.lol', url: 'https://adsb.lol', license: 'ODbL 1.0' },
    caveat: 'Positions between snapshots are estimated from speed and heading.',
    fetch: flightsFeed('military.json', true),
  },
  {
    id: 'stations',
    name: 'Space stations (ISS, Tiangong)',
    group: 'Space',
    description: 'Crewed stations, positions computed live from CelesTrak orbital elements.',
    shape: 'sat',
    color: '#D2D6DA',
    intervalMs: 6 * HOUR,
    transport: 'browser',
    defaultOn: true,
    attribution: { name: 'CelesTrak', url: 'https://celestrak.org', license: 'Free with attribution' },
    fetch: satFeed('stations'),
  },
  {
    id: 'gps',
    name: 'GPS constellation',
    group: 'Space',
    description: 'Operational GPS satellites (medium Earth orbit, ~20,200 km).',
    shape: 'sat',
    color: '#8FA9C2',
    intervalMs: 12 * HOUR,
    transport: 'browser',
    defaultOn: false,
    attribution: { name: 'CelesTrak', url: 'https://celestrak.org', license: 'Free with attribution' },
    fetch: satFeed('gps-ops'),
  },
  {
    id: 'visual',
    name: 'Brightest satellites',
    group: 'Space',
    description: 'The ~150 most visible satellites in low Earth orbit.',
    shape: 'sat',
    color: '#A7B4C1',
    intervalMs: 12 * HOUR,
    transport: 'browser',
    defaultOn: false,
    attribution: { name: 'CelesTrak', url: 'https://celestrak.org', license: 'Free with attribution' },
    fetch: satFeed('visual'),
  },
  {
    id: 'starlink',
    name: 'Starlink',
    group: 'Space',
    description: 'All Starlink satellites (~9,000). Heavier: about 1.5 MB to load.',
    shape: 'sat',
    color: '#6E7F90',
    intervalMs: 12 * HOUR,
    transport: 'browser',
    defaultOn: false,
    attribution: { name: 'CelesTrak', url: 'https://celestrak.org', license: 'Free with attribution' },
    fetch: satFeed('starlink'),
  },
  {
    id: 'launches',
    name: 'Upcoming rocket launches',
    group: 'Space',
    description: 'Next launches at their pads, from The Space Devs Launch Library.',
    shape: 'diamond',
    color: '#528270',
    intervalMs: 30 * MIN,
    transport: 'browser',
    defaultOn: false,
    attribution: { name: 'The Space Devs — Launch Library 2', url: 'https://thespacedevs.com', license: 'Free (rate-limited)' },
    fetch: fetchLaunches,
  },
];

export const LIVE_FEED_BY_ID = Object.fromEntries(LIVE_FEEDS.map((f) => [f.id, f])) as Record<string, LiveFeedDef>;
export const LIVE_GROUPS = ['Conflict', 'Cyber', 'Air', 'Sea', 'Space', 'Hazards', 'Infrastructure', 'History'] as const;
