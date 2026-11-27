/**
 * DEMONSTRATION DATASET — SYNTHETIC, NOT INTELLIGENCE.
 *
 * Generates a reproducible dataset that exercises every part of the interface when
 * no live backend is reachable. Safeguards so it can never be mistaken for real data:
 *  - every event, source and network fact carries `isDemo: true`, and the UI shows a
 *    persistent "Demonstration data" banner whenever this dataset is active;
 *  - IP addresses come only from RFC 5737 documentation ranges (192.0.2.0/24,
 *    198.51.100.0/24, 203.0.113.0/24); ASNs only from the RFC 6996 private range
 *    (64512–65534); domains only under the reserved `.example` TLD (RFC 2606);
 *  - countries are drawn with weights proportional to √population, a neutral proxy,
 *    so the synthetic pattern does not encode assumptions about any particular nation;
 *  - IDs are prefixed `DEMO-` and there are no supporting references.
 */
import type {
  CountryNetworkFacts,
  Dataset,
  Indicator,
  IntelSource,
  RelationshipBasis,
  Severity,
  ThreatCategory,
  ThreatEvent,
} from '@/types/intel';
import type { CountryRecord } from '@/lib/geo/countries';
import { hex, mulberry32, pick, randInt, weightedPick, type Rng } from './rng';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SPAN = 30 * DAY;

export const DEMO_SOURCES: IntelSource[] = [
  {
    id: 'demo-sensors',
    name: 'Demo · Sensor grid',
    url: null,
    status: 'demo',
    statusDetail: 'Synthetic records generated in the browser',
    lastSync: null,
    recordCount: 0,
    attributionMethod: 'Synthetic: simulated sensor observation (source IP geolocation → sensor location)',
    categories: ['scanning', 'botnet', 'malware'],
    isDemo: true,
  },
  {
    id: 'demo-sandbox',
    name: 'Demo · Malware sandbox',
    url: null,
    status: 'demo',
    statusDetail: 'Synthetic records generated in the browser',
    lastSync: null,
    recordCount: 0,
    attributionMethod: 'Synthetic: simulated C2/payload host geolocation',
    categories: ['malware', 'c2', 'ransomware'],
    isDemo: true,
  },
  {
    id: 'demo-reports',
    name: 'Demo · Abuse reports',
    url: null,
    status: 'demo',
    statusDetail: 'Synthetic records generated in the browser',
    lastSync: null,
    recordCount: 0,
    attributionMethod: 'Synthetic: simulated third-party reports (hosting country ↔ targeted country)',
    categories: ['phishing', 'ransomware', 'breach'],
    isDemo: true,
  },
  {
    id: 'demo-exposure',
    name: 'Demo · Exposure census',
    url: null,
    status: 'demo',
    statusDetail: 'Synthetic records generated in the browser',
    lastSync: null,
    recordCount: 0,
    attributionMethod: 'Synthetic: simulated exposed-service geolocation',
    categories: ['vulnerability', 'network'],
    isDemo: true,
  },
];

const SEVERITY_WEIGHTS: Record<ThreatCategory, number[]> = {
  // critical, high, medium, low, info — critical is deliberately rare
  ransomware: [10, 30, 35, 18, 7],
  c2: [4, 28, 40, 20, 8],
  malware: [2, 18, 42, 28, 10],
  botnet: [1, 12, 40, 32, 15],
  phishing: [1, 14, 45, 30, 10],
  breach: [8, 30, 37, 18, 7],
  vulnerability: [5, 20, 35, 25, 15],
  scanning: [0.1, 2, 18, 40, 40],
  network: [0, 0, 5, 25, 70],
};
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const CATEGORY_PROFILE: Record<
  Exclude<ThreatCategory, 'network'>,
  { source: string; basis: RelationshipBasis; pairRatio: number; label: string }
> = {
  scanning: { source: 'demo-sensors', basis: 'observed_traffic', pairRatio: 1, label: 'Scanning activity recorded by sensor' },
  botnet: { source: 'demo-sensors', basis: 'observed_traffic', pairRatio: 0.9, label: 'Botnet-pattern traffic recorded by sensor' },
  malware: { source: 'demo-sandbox', basis: 'infrastructure_geolocation', pairRatio: 0.6, label: 'Malware payload host observed' },
  c2: { source: 'demo-sandbox', basis: 'infrastructure_geolocation', pairRatio: 0.55, label: 'Sample contacted command-and-control host' },
  ransomware: { source: 'demo-reports', basis: 'inferred', pairRatio: 0.45, label: 'Ransomware incident report' },
  phishing: { source: 'demo-reports', basis: 'inferred', pairRatio: 0.7, label: 'Phishing page hosting report' },
  breach: { source: 'demo-reports', basis: 'inferred', pairRatio: 0, label: 'Publicly reported data breach' },
  vulnerability: { source: 'demo-exposure', basis: 'infrastructure_geolocation', pairRatio: 0, label: 'Exposed service matching vulnerability signature' },
};
type EventCategory = keyof typeof CATEGORY_PROFILE;
const CATEGORIES = Object.keys(CATEGORY_PROFILE) as EventCategory[];
const CATEGORY_WEIGHTS = [16, 10, 14, 10, 6, 10, 4, 6]; // matches CATEGORIES order

const DOC_V4 = ['192.0.2.', '198.51.100.', '203.0.113.'];

function docIp(countryIdx: number, k: number): string {
  const n = (countryIdx * 3 + k) % 762; // 3 × 254 usable host addresses
  return `${DOC_V4[Math.floor(n / 254)]}${(n % 254) + 1}`;
}
const demoAsn = (countryIdx: number, k: number) => 64512 + ((countryIdx * 4 + k) % 1022);

function diurnal(rng: Rng, start: number, end: number): number {
  // Rejection-sample a mild 24h cycle so the timeline has realistic texture.
  for (;;) {
    const t = start + rng() * (end - start);
    const h = (t / HOUR) % 24;
    if (rng() < 0.65 + 0.35 * Math.sin((h / 24) * 2 * Math.PI)) return t;
  }
}

export function generateDemoDataset(countries: CountryRecord[], now = Date.now(), seed = 20261126): Dataset {
  const rng = mulberry32(seed);
  const anchor = Math.floor(now / 60_000) * 60_000;
  const t0 = anchor - SPAN;

  const pool = countries.filter((c) => c.iso2 && c.population && c.population > 50_000 && c.region !== 'Antarctica');
  const weights = pool.map((c) => Math.sqrt(c.population ?? 0));
  const idxOf = new Map(pool.map((c, i) => [c.id, i]));
  const pickCountry = () => weightedPick(rng, pool, weights);

  const events: ThreatEvent[] = [];
  let seq = 0;

  const emit = (category: EventCategory, src: CountryRecord | null, dst: CountryRecord | null, t: number, sevBias = 0) => {
    const prof = CATEGORY_PROFILE[category];
    const sw = SEVERITY_WEIGHTS[category].map((w, i) => (i < 2 ? w * (1 + sevBias) : w));
    // sevBias > 0 lets individual campaigns run hotter than background noise.
    const severity = weightedPick(rng, SEVERITIES, sw);
    const si = src ? idxOf.get(src.id)! : -1;
    const di = dst ? idxOf.get(dst.id)! : -1;
    const k = randInt(rng, 0, 2);
    const indicators: Indicator[] = [];
    const srcIp = src ? docIp(si, k) : null;
    if (srcIp) indicators.push({ type: 'ipv4', value: srcIp });
    if (category === 'phishing') indicators.push({ type: 'domain', value: `signin-${hex(rng, 6)}.example` });
    if (category === 'malware' || category === 'c2' || category === 'ransomware')
      indicators.push({ type: 'sha256', value: hex(rng, 64) });
    if (category === 'vulnerability') indicators.push({ type: 'cve', value: `DEMO-VULN-${String(randInt(rng, 1, 60)).padStart(4, '0')}` });
    const firstSeen = t - rng() * 6 * HOUR;
    const lastSeen = Math.min(anchor, t + rng() * 4 * HOUR);
    const basis: RelationshipBasis =
      category === 'ransomware' && src && dst && rng() < 0.15 ? 'attribution_claim' : prof.basis;
    seq++;
    events.push({
      id: `DEMO-EVT-${String(seq).padStart(6, '0')}`,
      sourceId: prof.source,
      sourceRecordId: `demo-${hex(rng, 12)}`,
      category,
      severity,
      confidence: Math.round(30 + rng() * 65),
      observedAt: new Date(t).toISOString(),
      firstSeen: new Date(firstSeen).toISOString(),
      lastSeen: new Date(lastSeen).toISOString(),
      collectedAt: new Date(Math.min(anchor, t + 10 * 60_000)).toISOString(),
      updatedAt: new Date(lastSeen).toISOString(),
      srcCountry: src?.id ?? null,
      dstCountry: dst?.id ?? null,
      srcIp,
      dstIp: dst && prof.basis === 'observed_traffic' ? docIp(di, (k + 1) % 3) : null,
      srcAsn: src ? demoAsn(si, k) : null,
      dstAsn: dst && prof.basis === 'observed_traffic' ? demoAsn(di, 3) : null,
      srcOrg: src ? `DEMO-NET-${src.iso2}-${k + 1}` : null,
      indicators,
      basis,
      description: `${prof.label}. Synthetic demonstration record — not an observation.`,
      references: [],
      t,
      isDemo: true,
    });
  };

  const pairFor = (category: EventCategory, infra: CountryRecord, target: CountryRecord | null) => {
    const ratio = CATEGORY_PROFILE[category].pairRatio;
    if (category === 'breach') return [null, target ?? pickCountry()] as const;
    if (rng() >= ratio || !target || target.id === infra.id) return [infra, null] as const;
    return [infra, target] as const;
  };

  // Campaign-like clusters give the timeline and arcs coherent structure.
  for (let c = 0; c < 46; c++) {
    const category = weightedPick(rng, CATEGORIES, CATEGORY_WEIGHTS);
    const infra = Array.from({ length: randInt(rng, 1, 3) }, pickCountry);
    const targets = Array.from({ length: randInt(rng, 2, 7) }, pickCountry);
    const duration = (6 + rng() * 230) * HOUR;
    const start = t0 + rng() * (SPAN - duration * 0.5);
    const end = Math.min(anchor, start + duration);
    const n = randInt(rng, 30, 260);
    const sevBias = rng() * 0.6;
    for (let i = 0; i < n; i++) {
      const [s, d] = pairFor(category, pick(rng, infra), pick(rng, targets));
      emit(category, s, d, diurnal(rng, start, end), sevBias);
    }
  }
  // Diffuse background activity.
  for (let i = 0; i < 2600; i++) {
    const category = weightedPick(rng, CATEGORIES, CATEGORY_WEIGHTS);
    const [s, d] = pairFor(category, pickCountry(), pickCountry());
    emit(category, s, d, diurnal(rng, t0, anchor));
  }

  events.sort((a, b) => a.t - b.t);

  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.sourceId, (counts.get(e.sourceId) ?? 0) + 1);
  const sources = DEMO_SOURCES.map((s) => ({ ...s, recordCount: counts.get(s.id) ?? 0, lastSync: new Date(anchor).toISOString() }));

  const network: Record<string, CountryNetworkFacts> = {};
  for (const c of pool) {
    const scale = Math.sqrt(c.population ?? 0) / 40;
    network[c.id] = {
      country: c.id,
      asnCount: Math.max(1, Math.round(scale * (0.4 + rng()))),
      ipv4Prefixes: Math.max(1, Math.round(scale * 6 * (0.4 + rng()))),
      ipv6Prefixes: Math.max(0, Math.round(scale * 2 * rng())),
      source: 'Demo · Exposure census',
      observedAt: new Date(anchor).toISOString(),
      isDemo: true,
    };
  }

  return { mode: 'demo', events, sources, network, generatedAt: new Date(anchor).toISOString(), extent: [t0, anchor] };
}
