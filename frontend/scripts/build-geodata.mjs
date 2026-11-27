#!/usr/bin/env node
/**
 * Builds the geographic dataset used by the globe.
 *
 * Source: Natural Earth 1:50m Admin-0 (public domain) — https://www.naturalearthdata.com/
 *   - ne_50m_admin_0_countries                       (country polygons + metadata)
 *   - ne_50m_admin_0_breakaway_disputed_areas        (disputed / breakaway polygons)
 *   - ne_50m_admin_0_boundary_lines_disputed_areas   (disputed boundary lines)
 * Capitals: `world-countries` (mledoze/countries, ODbL) joined on ISO 3166-1 alpha-3.
 *
 * Outputs:
 *  - public/data/world.topo.json  TopoJSON, quantized only (no extra simplification) so
 *    boundaries stay faithful to the Natural Earth 50m generalisation.
 *  - public/data/world.mesh.bin   Pre-triangulated country surfaces on the unit sphere.
 *    Spherical triangulation is expensive (Antarctica alone takes seconds), so it is done
 *    once here instead of on every page load. Layout (little endian):
 *      'CTA2' | u32 jsonLen | json(ids[]) | pad4 | u32[2n] (vertexCount, indexCount)
 *      | i16[3·V] unit-sphere directions × 32767 (≈0.2 km precision; NE 50m is ≈1 km)
 *      | u16[I] per-country local indices
 *
 * Usage: npm run geodata   (downloads sources into scripts/.cache on first run)
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { topology } from 'topojson-server';
import { createRequire } from 'node:module';

// three-conic-polygon-geometry probes `window.THREE`; provide an empty window in Node.
globalThis.window ??= {};
const { default: ConicPolygonGeometry } = await import('three-conic-polygon-geometry');

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, '.cache');
const outFile = join(here, '..', 'public', 'data', 'world.topo.json');
const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/';
const SOURCES = [
  'ne_50m_admin_0_countries',
  'ne_50m_admin_0_breakaway_disputed_areas',
  'ne_50m_admin_0_boundary_lines_disputed_areas',
];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function load(name) {
  const file = join(cacheDir, `${name}.geojson`);
  if (!(await exists(file))) {
    await mkdir(cacheDir, { recursive: true });
    const res = await fetch(`${NE_BASE}${name}.geojson`);
    if (!res.ok) throw new Error(`Failed to download ${name}: HTTP ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${name}`);
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

const LAND_RADIUS = 1.0005; // keep in sync with src/lib/geo/globeGeometry.ts
const CURVATURE_RESOLUTION = 2.5;
const meshFile = join(here, '..', 'public', 'data', 'world.mesh.bin');

function triangulate(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const pos = [];
  const idx = [];
  for (const poly of polys) {
    const g = new ConicPolygonGeometry(poly, LAND_RADIUS, LAND_RADIUS, false, true, false, CURVATURE_RESOLUTION);
    const p = g.getAttribute('position');
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  }
  if (pos.length / 3 > 65535) throw new Error('country mesh exceeds u16 index range');
  return { pos, idx };
}

const round = (n, d = 4) => (typeof n === 'number' ? Number(n.toFixed(d)) : null);
const clean = (v) => (v === '-99' || v === -99 || v === '' || v == null ? null : v);

const capitals = new Map(
  require('world-countries/countries.json').map((c) => [c.cca3, c.capital?.[0] ?? null]),
);

const [countries, disputedAreas, disputedLines] = await Promise.all(SOURCES.map(load));

const seen = new Set();
const countryFeatures = countries.features.map((f) => {
  const p = f.properties;
  const iso2 = clean(p.ISO_A2_EH) ?? clean(p.ISO_A2);
  const iso3 = clean(p.ISO_A3_EH) ?? clean(p.ISO_A3);
  // Stable id: ISO alpha-2 where assigned, otherwise Natural Earth ADM0_A3.
  let id = iso2 ?? p.ADM0_A3;
  if (seen.has(id)) id = p.ADM0_A3; // e.g. Australian external territories share "AU"
  seen.add(id);
  return {
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      id,
      iso2: id === iso2 ? iso2 : null,
      iso3,
      adm0: p.ADM0_A3,
      name: p.NAME,
      nameLong: p.NAME_LONG,
      sovereign: p.SOVEREIGNT,
      type: p.TYPE,
      continent: p.CONTINENT,
      region: p.REGION_UN,
      subregion: p.SUBREGION,
      population: clean(p.POP_EST),
      populationYear: clean(p.POP_YEAR),
      capital: iso3 ? capitals.get(iso3) ?? null : null,
      labelLng: round(p.LABEL_X),
      labelLat: round(p.LABEL_Y),
      labelRank: p.LABELRANK,
      tiny: clean(p.TINY),
      note: clean(p.NOTE_ADM0),
      wikidata: clean(p.WIKIDATAID),
    },
  };
});

const disputedFeatures = disputedAreas.features.map((f, i) => ({
  type: 'Feature',
  geometry: f.geometry,
  properties: {
    id: `disputed-${i}`,
    name: f.properties.BRK_NAME ?? f.properties.NAME,
    administeredBy: f.properties.ADMIN ?? f.properties.SOVEREIGNT,
    note: clean(f.properties.NOTE_BRK),
  },
}));

const disputedLineFeatures = disputedLines.features.map((f) => ({
  type: 'Feature',
  geometry: f.geometry,
  properties: { name: f.properties.BRK_NAME ?? f.properties.NAME, note: clean(f.properties.NOTE) },
}));

const topo = topology(
  {
    countries: { type: 'FeatureCollection', features: countryFeatures },
    disputed: { type: 'FeatureCollection', features: disputedFeatures },
    disputedLines: { type: 'FeatureCollection', features: disputedLineFeatures },
  },
  1e5,
);
topo.metadata = {
  source: 'Natural Earth 1:50m Admin-0 v5.1.2 (public domain); capitals from mledoze/countries (ODbL)',
  generatedAt: new Date().toISOString(),
};

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(topo));

const t0 = Date.now();
const meshes = countryFeatures.map((f) => triangulate(f.geometry));
const ids = new TextEncoder().encode(JSON.stringify(countryFeatures.map((f) => f.properties.id)));
const headerLen = 8 + ids.length;
const pad = (4 - (headerLen % 4)) % 4;
const V = meshes.reduce((a, m) => a + m.pos.length / 3, 0);
const I = meshes.reduce((a, m) => a + m.idx.length, 0);
const buf = new ArrayBuffer(headerLen + pad + meshes.length * 8 + V * 6 + I * 2);
const dv = new DataView(buf);
new Uint8Array(buf, 0, 4).set(new TextEncoder().encode('CTA2'));
dv.setUint32(4, ids.length, true);
new Uint8Array(buf, 8, ids.length).set(ids);
let o = headerLen + pad;
for (const m of meshes) {
  dv.setUint32(o, m.pos.length / 3, true);
  dv.setUint32(o + 4, m.idx.length, true);
  o += 8;
}
const posArr = new Int16Array(buf, o, V * 3);
let pv = 0;
for (const m of meshes) {
  for (let i = 0; i < m.pos.length; i += 3) {
    const n = Math.hypot(m.pos[i], m.pos[i + 1], m.pos[i + 2]);
    posArr[pv++] = Math.round((m.pos[i] / n) * 32767);
    posArr[pv++] = Math.round((m.pos[i + 1] / n) * 32767);
    posArr[pv++] = Math.round((m.pos[i + 2] / n) * 32767);
  }
}
o += V * 6;
const idxArr = new Uint16Array(buf, o, I);
let pi = 0;
for (const m of meshes) for (const v of m.idx) idxArr[pi++] = v; // per-country local indices
await writeFile(meshFile, Buffer.from(buf));
console.log(`wrote ${meshFile}: ${V} vertices, ${I / 3} triangles in ${Date.now() - t0} ms`);
console.log(
  `wrote ${outFile}: ${countryFeatures.length} countries, ${disputedFeatures.length} disputed areas, ${disputedLineFeatures.length} disputed lines`,
);
