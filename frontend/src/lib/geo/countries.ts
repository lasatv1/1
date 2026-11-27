import { feature, mesh as topoMesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import { geoArea, geoCentroid } from 'd3-geo';

export interface CountryProps {
  id: string;
  iso2: string | null;
  iso3: string | null;
  adm0: string;
  name: string;
  nameLong: string;
  sovereign: string;
  type: string;
  continent: string;
  region: string;
  subregion: string;
  population: number | null;
  populationYear: number | null;
  capital: string | null;
  labelLng: number | null;
  labelLat: number | null;
  labelRank: number;
  tiny: number | null;
  note: string | null;
  wikidata: string | null;
}

export interface CountryRecord extends CountryProps {
  /** [lng, lat] inside the country; used for labels and arc endpoints. */
  anchor: [number, number];
  /** Steradian area on the unit sphere (d3 geoArea). */
  area: number;
  feature: Feature<Polygon | MultiPolygon, CountryProps>;
}

export interface DisputedArea {
  id: string;
  name: string;
  administeredBy: string | null;
  note: string | null;
  feature: Feature<Polygon | MultiPolygon>;
}

/** Pre-triangulated country surfaces (see scripts/build-geodata.mjs for the format). */
export interface PackedMesh {
  ids: string[];
  vertexCounts: Uint32Array;
  indexCounts: Uint32Array;
  /** Unit-sphere directions quantised to int16 (× 32767). */
  directions: Int16Array;
  /** Per-country local indices. */
  indices: Uint16Array;
}

export function parsePackedMesh(buf: ArrayBuffer): PackedMesh {
  const dv = new DataView(buf);
  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
  if (magic !== 'CTA2') throw new Error(`Unexpected mesh format "${magic}"`);
  const jsonLen = dv.getUint32(4, true);
  const ids = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jsonLen))) as string[];
  let o = 8 + jsonLen;
  o += (4 - (o % 4)) % 4;
  const n = ids.length;
  const vertexCounts = new Uint32Array(n);
  const indexCounts = new Uint32Array(n);
  let V = 0;
  let I = 0;
  for (let i = 0; i < n; i++) {
    vertexCounts[i] = dv.getUint32(o, true);
    indexCounts[i] = dv.getUint32(o + 4, true);
    V += vertexCounts[i]!;
    I += indexCounts[i]!;
    o += 8;
  }
  const directions = new Int16Array(buf, o, V * 3);
  o += V * 6;
  const indices = new Uint16Array(buf, o, I);
  return { ids, vertexCounts, indexCounts, directions, indices };
}

export interface GeoData {
  mesh: PackedMesh;
  countries: CountryRecord[];
  byId: Map<string, CountryRecord>;
  /** Shared borders between two countries (drawn once). */
  borders: MultiLineString;
  /** Coastlines / exterior rings. */
  coastlines: MultiLineString;
  disputed: DisputedArea[];
  disputedLines: FeatureCollection;
  regions: string[];
  subregions: Map<string, string[]>;
  source: string;
}

type WorldTopo = Topology<{
  countries: GeometryCollection<CountryProps>;
  disputed: GeometryCollection<{ id: string; name: string; administeredBy: string | null; note: string | null }>;
  disputedLines: GeometryCollection;
}>;

export function parseWorld(topo: WorldTopo, mesh: PackedMesh): GeoData {
  const fc = feature(topo, topo.objects.countries) as FeatureCollection<Polygon | MultiPolygon, CountryProps>;
  const countries: CountryRecord[] = fc.features
    .filter((f) => f.geometry)
    .map((f) => {
      const p = f.properties;
      const anchor: [number, number] =
        p.labelLng != null && p.labelLat != null ? [p.labelLng, p.labelLat] : (geoCentroid(f) as [number, number]);
      return { ...p, anchor, area: geoArea(f), feature: f };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const byId = new Map(countries.map((c) => [c.id, c]));
  const borders = topoMesh(topo, topo.objects.countries, (a, b) => a !== b) as MultiLineString;
  const coastlines = topoMesh(topo, topo.objects.countries, (a, b) => a === b) as MultiLineString;

  const disputedFc = feature(topo, topo.objects.disputed) as FeatureCollection<Polygon | MultiPolygon>;
  const disputed: DisputedArea[] = disputedFc.features.map((f) => {
    const p = f.properties as { id: string; name: string; administeredBy: string | null; note: string | null };
    return { id: p.id, name: p.name, administeredBy: p.administeredBy, note: p.note, feature: f };
  });

  const subregions = new Map<string, string[]>();
  for (const c of countries) {
    if (!c.region || c.region === 'Antarctica') continue;
    const list = subregions.get(c.region) ?? [];
    if (!list.includes(c.subregion)) list.push(c.subregion);
    subregions.set(c.region, list);
  }
  for (const list of subregions.values()) list.sort();

  return {
    mesh,
    countries,
    byId,
    borders,
    coastlines,
    disputed,
    disputedLines: feature(topo, topo.objects.disputedLines) as FeatureCollection,
    regions: [...subregions.keys()].sort(),
    subregions,
    source: (topo as unknown as { metadata?: { source?: string } }).metadata?.source ?? 'Natural Earth',
  };
}

let cache: Promise<GeoData> | null = null;

export function loadGeoData(signal?: AbortSignal): Promise<GeoData> {
  if (!cache) {
    const base = `${import.meta.env.BASE_URL}data/`;
    const ok = (r: Response) => {
      if (!r.ok) throw new Error(`Boundary dataset failed to load: ${r.url} (HTTP ${r.status})`);
      return r;
    };
    cache = Promise.all([
      fetch(`${base}world.topo.json`, { signal }).then(ok).then((r) => r.json() as Promise<WorldTopo>),
      fetch(`${base}world.mesh.bin`, { signal }).then(ok).then((r) => r.arrayBuffer()).then(parsePackedMesh),
    ])
      .then(([topo, mesh]) => parseWorld(topo, mesh))
      .catch((e: unknown) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}
