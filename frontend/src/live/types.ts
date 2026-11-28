/** Live (real-time) layer model, separate from the curated intelligence dataset. */
import type { SatRec } from '@/vendor/satellite';
import type { GeoData } from '@/lib/geo/countries';

export type LiveGroup = 'Conflict' | 'Cyber' | 'Air' | 'Sea' | 'Space' | 'Hazards' | 'Infrastructure' | 'History';
export type LiveShape = 'ring' | 'dot' | 'plane' | 'ship' | 'sat' | 'diamond' | 'line';

/** A positioned real-world object or event. */
export interface LiveEntity {
  id: string;
  lng: number;
  lat: number;
  /** Altitude above the surface in km (aircraft, satellites). */
  altKm?: number;
  /** Degrees clockwise from north (aircraft). */
  heading?: number;
  /** Ground speed in knots (aircraft), used for dead reckoning between snapshots. */
  speedKts?: number;
  /** Epoch ms when this position was valid. */
  t?: number;
  label: string;
  sub?: string;
  color?: string;
  /** Relative marker size, 0..1. */
  size?: number;
  props: Array<[string, string]>;
  url?: string;
  /** Satellites: orbit model; position is computed live from it. */
  satrec?: SatRec;
}

export interface LiveLine {
  id: string;
  label: string;
  coords: Array<Array<[number, number]>>;
  props: Array<[string, string]>;
}

export interface FeedResult {
  entities: LiveEntity[];
  lines?: LiveLine[];
  /** Feed-level facts, e.g. a global threat level. */
  meta?: Record<string, string>;
  /** When the upstream data was produced (epoch ms), if known. */
  sourceTime?: number;
}

export interface FeedContext {
  geo: GeoData;
  signal: AbortSignal;
  /** Selected year for the historical-borders layer. */
  histYear: string;
}

export interface LiveFeedDef {
  id: string;
  name: string;
  group: LiveGroup;
  description: string;
  shape: LiveShape;
  color: string;
  /** How often to refresh while the page is visible. */
  intervalMs: number;
  /** 'browser': fetched live from the provider. 'scheduled': published by the GitHub job. */
  transport: 'browser' | 'scheduled';
  defaultOn: boolean;
  /** Hidden from the map (e.g. a status value shown elsewhere). */
  mapless?: boolean;
  attribution: { name: string; url: string; license: string };
  /** Honest caveat shown in tooltips/details (e.g. what a location really means). */
  caveat?: string;
  fetch: (ctx: FeedContext) => Promise<FeedResult>;
}
