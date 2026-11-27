/**
 * Spherical coordinate helpers. The convention matches three-conic-polygon-geometry
 * (phi measured from +Y, theta = 90° − lng) so polygons, borders and arcs line up exactly.
 */
export const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];

export function lngLatToVec3(lng: number, lat: number, r = 1): Vec3 {
  const phi = (90 - lat) * DEG;
  const theta = (90 - lng) * DEG;
  return [r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

export function vec3ToLngLat([x, y, z]: Vec3): [number, number] {
  const r = Math.hypot(x, y, z);
  const lat = 90 - Math.acos(y / r) / DEG;
  const lng = 90 - Math.atan2(z, x) / DEG;
  return [((((lng + 180) % 360) + 360) % 360) - 180, lat];
}

/** Central angle (radians) between two lng/lat points. */
export function angularDistance(a: [number, number], b: [number, number]): number {
  const [l1, p1] = [a[0] * DEG, a[1] * DEG];
  const [l2, p2] = [b[0] * DEG, b[1] * DEG];
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Points along the great circle from a to b lifted above the surface by a sine profile.
 * Interpolating on the unit sphere (slerp) means arcs never cut through the Earth and
 * handle the antimeridian naturally.
 */
export function greatCircleArc(
  a: [number, number],
  b: [number, number],
  segments: number,
  baseRadius: number,
  lift: number,
): Vec3[] {
  const va = lngLatToVec3(a[0], a[1], 1);
  const vb = lngLatToVec3(b[0], b[1], 1);
  const omega = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  const sinO = Math.sin(omega);
  const out: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let p: Vec3;
    if (sinO < 1e-6) {
      p = va;
    } else {
      const k1 = Math.sin((1 - t) * omega) / sinO;
      const k2 = Math.sin(t * omega) / sinO;
      p = [va[0] * k1 + vb[0] * k2, va[1] * k1 + vb[1] * k2, va[2] * k1 + vb[2] * k2];
    }
    const r = baseRadius + lift * Math.sin(Math.PI * t);
    const n = Math.hypot(p[0], p[1], p[2]) || 1;
    out.push([(p[0] / n) * r, (p[1] / n) * r, (p[2] / n) * r]);
  }
  return out;
}

/** Arc apex height as a function of angular distance: short hops stay low. */
export function arcLift(angle: number): number {
  return Math.min(0.15, Math.max(0.012, angle * 0.085));
}

/**
 * Rendering projection. "globe" places points on the unit sphere; "flat" is an
 * equirectangular plane (x = λ, y = φ in radians, z = altitude) used by the 2D map pad.
 * Every geometry builder takes a projection so both views share one code path.
 */
export interface Projection {
  kind: 'globe' | 'flat';
  point(lng: number, lat: number, alt?: number): Vec3;
  normal(lng: number, lat: number): Vec3;
}

export const globeProjection: Projection = {
  kind: 'globe',
  point: (lng, lat, alt = 0) => lngLatToVec3(lng, lat, 1 + alt),
  normal: (lng, lat) => lngLatToVec3(lng, lat, 1),
};

export const flatProjection: Projection = {
  kind: 'flat',
  point: (lng, lat, alt = 0) => [lng * DEG, lat * DEG, alt],
  normal: () => [0, 0, 1],
};

export const projectionFor = (kind: 'globe' | 'flat') => (kind === 'flat' ? flatProjection : globeProjection);

/** Arc between two lng/lat points for either projection. */
export function arcPoints(proj: Projection, a: [number, number], b: [number, number], segments: number, base: number, liftScale: number): Vec3[] {
  const angle = angularDistance(a, b);
  const lift = arcLift(angle) * liftScale;
  if (proj.kind === 'globe') return greatCircleArc(a, b, segments, 1 + base, lift);
  // Flat: a planar curve bulging perpendicular to the chord (no antimeridian wrap).
  const [x0, y0] = [a[0] * DEG, a[1] * DEG];
  const [x1, y1] = [b[0] * DEG, b[1] * DEG];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const bulge = Math.min(0.5, len * 0.16) * liftScale;
  const out: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const s = Math.sin(Math.PI * t);
    out.push([x0 + dx * t + (-dy / len) * bulge * s, y0 + dy * t + (dx / len) * bulge * s, base + 0.002 + lift * 0.05 * s]);
  }
  return out;
}
