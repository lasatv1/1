import { BufferAttribute, BufferGeometry } from 'three';
import type { MultiLineString, Polygon, MultiPolygon, Position } from 'geojson';
import type { CountryRecord, GeoData } from './countries';
import { DEG, lngLatToVec3, vec3ToLngLat, type Projection } from './sphere';

export const GLOBE_RADIUS = 1;
/** Altitudes above the surface (globe radius units / flat z units). */
export const LAND_ALT = 0.0005;
export const BORDER_ALT = 0.0012;
export const OUTLINE_ALT = 0.0022;
const LAND_RADIUS = 1 + LAND_ALT;

export interface CountryMeshData {
  geometry: BufferGeometry;
  /** Country index for every triangle (faceIndex → country). */
  faceCountry: Uint16Array;
  /** [start, count] vertex range per country index, for recolouring. */
  vertexRanges: Array<[number, number]>;
}

function polygonsOf(g: Polygon | MultiPolygon): Position[][][] {
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

/**
 * Expands the pre-triangulated country surfaces (triangulated on the sphere at build
 * time by three-conic-polygon-geometry) into one merged BufferGeometry — one draw call —
 * while keeping per-country identity via faceCountry / vertexRanges.
 */
export function buildCountryMesh(geo: GeoData, proj?: Projection): CountryMeshData {
  if (proj?.kind === 'flat') return buildFlatCountryMesh(geo, proj);
  const { mesh } = geo;
  const order = new Map(geo.countries.map((c, i) => [c.id, i]));
  let V = 0;
  for (const n of mesh.vertexCounts) V += n;
  const positions = new Float32Array(V * 3);
  const s = LAND_RADIUS / 32767;
  for (let i = 0; i < V * 3; i++) positions[i] = mesh.directions[i]! * s;
  // Re-normalise to the exact radius after quantisation.
  for (let v = 0; v < V; v++) {
    const x = positions[v * 3]!, y = positions[v * 3 + 1]!, z = positions[v * 3 + 2]!;
    const k = LAND_RADIUS / (Math.hypot(x, y, z) || 1);
    positions[v * 3] = x * k;
    positions[v * 3 + 1] = y * k;
    positions[v * 3 + 2] = z * k;
  }
  const indices = new Uint32Array(mesh.indices.length);
  const faceCountry = new Uint16Array(mesh.indices.length / 3);
  const vertexRanges: Array<[number, number]> = geo.countries.map(() => [0, 0]);
  let vBase = 0;
  let iBase = 0;
  mesh.ids.forEach((id, k) => {
    const vc = mesh.vertexCounts[k]!;
    const ic = mesh.indexCounts[k]!;
    const ci = order.get(id) ?? 0;
    for (let j = 0; j < ic; j++) indices[iBase + j] = vBase + mesh.indices[iBase + j]!;
    faceCountry.fill(ci, iBase / 3, (iBase + ic) / 3);
    vertexRanges[ci] = [vBase, vc];
    vBase += vc;
    iBase += ic;
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(V * 3), 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return { geometry, faceCountry, vertexRanges };
}

/**
 * Flat (equirectangular) variant: un-indexed so vertices on the antimeridian can be
 * assigned per triangle to the side of the map the triangle lies on, and pole vertices
 * take the longitude of their neighbours instead of an arbitrary value.
 */
function buildFlatCountryMesh(geo: GeoData, proj: Projection): CountryMeshData {
  const sphere = buildCountryMesh(geo);
  const pos = sphere.geometry.getAttribute('position');
  const idx = sphere.geometry.getIndex()!;
  const T = idx.count / 3;
  const out = new Float32Array(T * 9);
  const ll: Array<[number, number]> = [[0, 0], [0, 0], [0, 0]];
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      const v = idx.getX(t * 3 + k);
      ll[k] = vec3ToLngLat([pos.getX(v), pos.getY(v), pos.getZ(v)]);
    }
    const ref = ll.find((p) => Math.abs(p[0]) < 179.5 && Math.abs(p[1]) < 89.99) ?? ll[0]!;
    for (let k = 0; k < 3; k++) {
      const p = ll[k]!;
      if (Math.abs(p[1]) >= 89.99) {
        const others = ll.filter((_, j) => j !== k && Math.abs(ll[j]![1]) < 89.99);
        p[0] = others.length ? others.reduce((a, o) => a + o[0], 0) / others.length : ref[0];
      }
      if (Math.abs(p[0]) >= 179.5 && Math.sign(p[0]) !== Math.sign(ref[0]) && Math.abs(ref[0]) > 90) p[0] = -p[0];
      const [x, y, z] = proj.point(p[0], p[1], LAND_ALT);
      out[t * 9 + k * 3] = x;
      out[t * 9 + k * 3 + 1] = y;
      out[t * 9 + k * 3 + 2] = z;
    }
  }
  const vertexRanges: Array<[number, number]> = geo.countries.map(() => [0, 0]);
  let t = 0;
  while (t < T) {
    const ci = sphere.faceCountry[t]!;
    let e = t;
    while (e < T && sphere.faceCountry[e] === ci) e++;
    vertexRanges[ci] = [t * 3, (e - t) * 3];
    t = e;
  }
  sphere.geometry.dispose();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(out, 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(out.length), 3));
  geometry.computeBoundingSphere();
  return { geometry, faceCountry: sphere.faceCountry, vertexRanges };
}

/**
 * Converts lines into LineSegments vertex pairs on the sphere, densifying long edges
 * along the great circle so borders hug the surface instead of cutting chords.
 */
export function linesToSegments(lines: Position[][], proj: Projection, alt: number, maxStepDeg = 1.5): Float32Array {
  const out: number[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const span = Math.max(Math.abs(b[0]! - a[0]!), Math.abs(b[1]! - a[1]!));
      // Antimeridian seams in the source data are vertical lines at ±180; skip wrap jumps.
      if (span > 180) continue;
      // Artificial seams: polygon edges running along the antimeridian or the south pole.
      if (Math.abs(a[0]!) > 179.99 && Math.abs(b[0]!) > 179.99) continue;
      if (a[1]! < -89.9 && b[1]! < -89.9) continue;
      const steps = Math.max(1, Math.ceil(span / maxStepDeg));
      let prev = proj.point(a[0]!, a[1]!, alt);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const next = proj.point(a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, alt);
        out.push(...prev, ...next);
        prev = next;
      }
    }
  }
  return new Float32Array(out);
}

export function meshToSegments(m: MultiLineString, proj: Projection, alt: number): Float32Array {
  return linesToSegments(m.coordinates, proj, alt);
}

/** Exterior + interior rings of a country as segment pairs (for the selection outline). */
export function countryOutlineSegments(country: CountryRecord, proj: Projection, alt = OUTLINE_ALT): Float32Array {
  const rings: Position[][] = [];
  for (const poly of polygonsOf(country.feature.geometry)) for (const ring of poly) rings.push(ring);
  return linesToSegments(rings, proj, alt, 1);
}

export function ringsOf(g: Polygon | MultiPolygon): Position[][] {
  const rings: Position[][] = [];
  for (const poly of polygonsOf(g)) for (const ring of poly) rings.push(ring);
  return rings;
}

/** Camera position (distance d) looking at lng/lat. */
export function cameraPositionFor(lng: number, lat: number, distance: number): [number, number, number] {
  const clampedLat = Math.max(-70, Math.min(70, lat));
  return lngLatToVec3(lng, clampedLat, distance);
}

export { DEG };
