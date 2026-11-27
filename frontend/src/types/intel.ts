/**
 * Core intelligence domain types. These mirror the backend's Pydantic models
 * (backend/app/models.py) so the API and the demonstration dataset are interchangeable.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ThreatCategory =
  | 'malware'
  | 'ransomware'
  | 'phishing'
  | 'botnet'
  | 'c2'
  | 'breach'
  | 'vulnerability'
  | 'scanning'
  | 'network';

/**
 * Why two countries (or a country and an indicator) are associated. This is shown
 * everywhere a relationship is displayed so geolocation is never presented as attribution.
 */
export type RelationshipBasis =
  /** A sensor recorded traffic from an IP geolocated in A towards a sensor/asset in B. */
  | 'observed_traffic'
  /** Infrastructure (IP/domain) is geolocated to the country; says nothing about operators. */
  | 'infrastructure_geolocation'
  /** A third party published an attribution claim. Displayed as a claim, never as fact. */
  | 'attribution_claim'
  /** Derived by correlation (e.g. pulse "targeted countries" + indicator geolocation). */
  | 'inferred';

export type IndicatorType = 'ipv4' | 'ipv6' | 'domain' | 'url' | 'sha256' | 'md5' | 'cve' | 'asn';

export interface Indicator {
  type: IndicatorType;
  value: string;
}

export interface ThreatEvent {
  id: string;
  sourceId: string;
  sourceRecordId: string;
  category: ThreatCategory;
  severity: Severity;
  /** 0–100, as reported by the source or derived by the normaliser. */
  confidence: number;
  /** ISO-8601 timestamps. */
  observedAt: string;
  firstSeen: string;
  lastSeen: string;
  collectedAt: string;
  updatedAt: string;
  /** Country where the source-side infrastructure is geolocated (ISO alpha-2 or NE id). */
  srcCountry: string | null;
  /** Country of the observing sensor / affected asset, if known. */
  dstCountry: string | null;
  srcIp: string | null;
  dstIp: string | null;
  srcAsn: number | null;
  dstAsn: number | null;
  srcOrg: string | null;
  indicators: Indicator[];
  basis: RelationshipBasis;
  description: string;
  references: string[];
  /** Pre-parsed epoch ms of observedAt, filled in on ingest for fast filtering. */
  t: number;
  isDemo: boolean;
}

export type SourceStatus = 'ok' | 'degraded' | 'unavailable' | 'not_configured' | 'demo';

export interface IntelSource {
  id: string;
  name: string;
  url: string | null;
  status: SourceStatus;
  statusDetail: string | null;
  lastSync: string | null;
  recordCount: number;
  attributionMethod: string;
  categories: ThreatCategory[];
  isDemo: boolean;
}

/** Per-country network infrastructure facts (e.g. RIPEstat), if available. */
export interface CountryNetworkFacts {
  country: string;
  asnCount: number | null;
  ipv4Prefixes: number | null;
  ipv6Prefixes: number | null;
  source: string;
  observedAt: string;
  isDemo: boolean;
}

export type DataMode = 'demo' | 'live';

/** Where live data came from: the backend API, or a published static snapshot. */
export type DataOrigin = 'api' | 'snapshot';

export interface Dataset {
  mode: DataMode;
  /** Set for live data. */
  origin?: DataOrigin;
  events: ThreatEvent[];
  sources: IntelSource[];
  network: Record<string, CountryNetworkFacts>;
  generatedAt: string;
  /** Data extent, epoch ms. */
  extent: [number, number];
}

/** A directed, aggregated relationship drawn as one arc. */
export interface Connection {
  id: string;
  src: string;
  dst: string;
  category: ThreatCategory;
  severity: Severity;
  count: number;
  firstSeen: number;
  lastSeen: number;
  sources: string[];
  bases: RelationshipBasis[];
  meanConfidence: number;
  eventIdx: number[];
}

export interface CountryStats {
  id: string;
  total: number;
  incoming: number;
  outgoing: number;
  /** Observations of infrastructure located in the country with no counterpart country. */
  hosted: number;
  bySeverity: Record<Severity, number>;
  byCategory: Partial<Record<ThreatCategory, number>>;
  maxSeverity: Severity | null;
}
