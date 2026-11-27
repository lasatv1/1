import type { ThreatCategory } from '@/types/intel';

export type LayerId =
  | 'global'
  | 'malware'
  | 'ransomware'
  | 'phishing'
  | 'botnet'
  | 'c2'
  | 'breach'
  | 'network'
  | 'vulnerability'
  | 'historical';

/**
 * - arcs: directed country→country relationships, coloured by severity
 * - markers: located observations (no counterpart country), sized by count, coloured by max severity
 * - choropleth: per-country magnitude on a single-hue sequential ramp
 */
export type LayerVisual = 'arcs' | 'markers' | 'choropleth';

export interface LayerDef {
  id: LayerId;
  index: number;
  name: string;
  short: string;
  description: string;
  /** Event categories included. Empty = all. */
  categories: ThreatCategory[];
  visuals: LayerVisual[];
  /** What the choropleth measures, when present. */
  choropleth?: 'events' | 'asn';
  /** What a source must provide for this layer to be populated. */
  requirements: string;
  /** Live adapters that can feed the layer (shown when the layer is empty). */
  feeds: string[];
}

export const LAYERS: LayerDef[] = [
  {
    id: 'global',
    index: 1,
    name: 'Global Threat Activity',
    short: 'Global',
    description: 'All observed threat activity across categories. Arcs show country pairs with a documented relationship; markers show located infrastructure.',
    categories: [],
    visuals: ['arcs', 'markers'],
    requirements: 'Any normalised observation with at least one geolocated country.',
    feeds: ['AlienVault OTX', 'AbuseIPDB', 'abuse.ch Feodo Tracker', 'URLhaus'],
  },
  {
    id: 'malware',
    index: 2,
    name: 'Malware Infrastructure',
    short: 'Malware',
    description: 'Hosts reported as distributing malware payloads, geolocated by IP.',
    categories: ['malware'],
    visuals: ['arcs', 'markers'],
    requirements: 'Payload/distribution URLs or IPs with geolocation.',
    feeds: ['URLhaus', 'AlienVault OTX'],
  },
  {
    id: 'ransomware',
    index: 3,
    name: 'Ransomware Intelligence',
    short: 'Ransomware',
    description: 'Reported ransomware incidents (victim country) and associated infrastructure.',
    categories: ['ransomware'],
    visuals: ['arcs', 'markers'],
    requirements: 'Incident reports with victim country; optional infrastructure indicators.',
    feeds: ['Public ransomware reporting feeds (adapter not yet configured)', 'AlienVault OTX'],
  },
  {
    id: 'phishing',
    index: 4,
    name: 'Phishing Activity',
    short: 'Phishing',
    description: 'Reported phishing domains, URLs and hosting IPs.',
    categories: ['phishing'],
    visuals: ['arcs', 'markers'],
    requirements: 'Phishing URLs/domains resolved to geolocated hosting IPs.',
    feeds: ['AlienVault OTX', 'URLhaus (phishing-tagged)'],
  },
  {
    id: 'botnet',
    index: 5,
    name: 'Botnet Infrastructure',
    short: 'Botnet',
    description: 'Infrastructure reported as part of, or controlling, botnets.',
    categories: ['botnet'],
    visuals: ['arcs', 'markers'],
    requirements: 'Botnet-tagged IP observations with geolocation.',
    feeds: ['AbuseIPDB', 'abuse.ch Feodo Tracker'],
  },
  {
    id: 'c2',
    index: 6,
    name: 'C2 Infrastructure',
    short: 'C2',
    description: 'Reported command-and-control servers. Location is server geolocation, not operator location.',
    categories: ['c2'],
    visuals: ['arcs', 'markers'],
    requirements: 'C2 server IPs with first/last-online timestamps.',
    feeds: ['abuse.ch Feodo Tracker', 'AlienVault OTX'],
  },
  {
    id: 'breach',
    index: 7,
    name: 'Data Breach Intelligence',
    short: 'Breaches',
    description: 'Publicly reported breach incidents, by country of the affected organisation.',
    categories: ['breach'],
    visuals: ['markers'],
    requirements: 'Public breach disclosures with affected-organisation country.',
    feeds: ['Public breach disclosure feed (adapter not yet configured)'],
  },
  {
    id: 'network',
    index: 8,
    name: 'Network Infrastructure',
    short: 'Network',
    description: 'Registered autonomous systems per country. Context for interpreting activity volumes.',
    categories: [],
    visuals: ['choropleth'],
    choropleth: 'asn',
    requirements: 'Per-country ASN / prefix registration statistics.',
    feeds: ['RIPEstat country-resource-stats'],
  },
  {
    id: 'vulnerability',
    index: 9,
    name: 'Vulnerability Intelligence',
    short: 'Vulnerability',
    description: 'Geolocated observations of services matching known-exploited vulnerability signatures.',
    categories: ['vulnerability'],
    visuals: ['markers'],
    requirements: 'Exposure observations with IP geolocation and CVE reference. The CISA KEV catalog itself is not geolocated and is listed, not mapped.',
    feeds: ['CISA KEV (catalog, not mapped)', 'AlienVault OTX (CVE-tagged pulses)'],
  },
  {
    id: 'historical',
    index: 10,
    name: 'Historical Activity',
    short: 'Historical',
    description: 'Total observations per country across the selected observation period. Use the timeline to change the period or play it back.',
    categories: [],
    visuals: ['choropleth'],
    choropleth: 'events',
    requirements: 'Any timestamped observation with country geolocation.',
    feeds: ['All configured sources'],
  },
];

export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<LayerId, LayerDef>;

export const CATEGORY_LABEL: Record<ThreatCategory, string> = {
  malware: 'Malware',
  ransomware: 'Ransomware',
  phishing: 'Phishing',
  botnet: 'Botnet',
  c2: 'Command & control',
  breach: 'Data breach',
  vulnerability: 'Vulnerability',
  scanning: 'Scanning / probing',
  network: 'Network infrastructure',
};

export const ALL_CATEGORIES: ThreatCategory[] = [
  'malware',
  'ransomware',
  'phishing',
  'botnet',
  'c2',
  'breach',
  'vulnerability',
  'scanning',
];
