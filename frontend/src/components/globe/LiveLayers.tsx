import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
  type LineSegments,
} from 'three';
import { eciToGeodetic, gstime, propagate, degreesLat, degreesLong } from '@/vendor/satellite';
import { arcPoints, type Projection } from '@/lib/geo/sphere';
import { linesToSegments } from '@/lib/geo/globeGeometry';
import { LIVE_FEEDS } from '@/live/feeds';
import { useLiveStore } from '@/live/liveStore';
import type { LiveEntity, LiveFeedDef, LiveShape } from '@/live/types';
import { pointer, useGlobeStore } from '@/state/globeStore';
import { useAppStore } from '@/state/appStore';

const EARTH_KM = 6371;
const DEAD_RECKON_MAX_MS = 20 * 60 * 1000; // never extrapolate beyond 20 minutes

function shapeGeometry(shape: LiveShape) {
  switch (shape) {
    case 'ring':
      return new RingGeometry(0.62, 1, 28);
    case 'diamond':
      return new CircleGeometry(1, 4);
    case 'sat':
      return new CircleGeometry(1, 10);
    case 'ship': {
      // Hull outline, bow pointing along the heading.
      const s = new Shape();
      s.moveTo(0, 1);
      s.lineTo(0.42, 0.25);
      s.lineTo(0.42, -0.9);
      s.lineTo(-0.42, -0.9);
      s.lineTo(-0.42, 0.25);
      s.closePath();
      return new ShapeGeometry(s);
    }
    case 'plane': {
      const s = new Shape();
      s.moveTo(0, 1);
      s.lineTo(0.62, -0.75);
      s.lineTo(0, -0.38);
      s.lineTo(-0.62, -0.75);
      s.closePath();
      return new ShapeGeometry(s);
    }
    default:
      return new CircleGeometry(1, 16);
  }
}

/** Moves a lng/lat along a great circle by `distKm` on `headingDeg`. */
function destination(lng: number, lat: number, headingDeg: number, distKm: number): [number, number] {
  const d = distKm / EARTH_KM;
  const h = (headingDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lng * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(h));
  const l2 = l1 + Math.atan2(Math.sin(h) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((((l2 * 180) / Math.PI + 540) % 360) - 180), (p2 * 180) / Math.PI];
}

/** Current position of an entity (satellite propagation / aircraft dead reckoning). */
export function livePosition(e: LiveEntity, now: number): { lng: number; lat: number; altKm: number } | null {
  if (e.satrec) {
    const date = new Date(now);
    const pv = propagate(e.satrec, date);
    if (!pv || typeof pv.position === 'boolean' || !pv.position) return null;
    const g = eciToGeodetic(pv.position, gstime(date));
    return { lng: degreesLong(g.longitude), lat: degreesLat(g.latitude), altKm: g.height };
  }
  if (e.speedKts && e.heading != null && e.t) {
    const dt = Math.min(DEAD_RECKON_MAX_MS, Math.max(0, now - e.t));
    const [lng, lat] = destination(e.lng, e.lat, e.heading, e.speedKts * 1.852 * (dt / 3_600_000));
    return { lng, lat, altKm: e.altKm ?? 0 };
  }
  return { lng: e.lng, lat: e.lat, altKm: e.altKm ?? 0 };
}

function altitudeFor(def: LiveFeedDef, proj: Projection, altKm: number) {
  if (def.shape === 'sat') return proj.kind === 'flat' ? 0.012 : altKm / EARTH_KM; // true orbital altitude
  if (def.shape === 'plane') return 0.004 + Math.min(altKm, 15) * 0.0004; // slightly exaggerated cruise height
  if (def.shape === 'ship') return 0.0028;
  return 0.0035;
}

const tmpM = new Matrix4();
const v0 = new Vector3();
const vE = new Vector3();
const vN = new Vector3();
const vF = new Vector3();
const vR = new Vector3();

export function LiveLayers({ proj }: { proj: Projection }) {
  const enabled = useLiveStore((s) => s.enabled);
  return (
    <group>
      {LIVE_FEEDS.filter((f) => enabled.has(f.id) && !f.mapless).map((f) =>
        f.shape === 'line' ? (
          <LiveLines key={f.id} def={f} proj={proj} />
        ) : (
          <group key={f.id}>
            <LivePoints def={f} proj={proj} />
            {/* Track trails (e.g. ships' recent path) when the feed provides them. */}
            <LiveLines def={f} proj={proj} trail />
          </group>
        ),
      )}
      <LiveRoute proj={proj} />
    </group>
  );
}

function LivePoints({ def, proj }: { def: LiveFeedDef; proj: Projection }) {
  const entities = useLiveStore((s) => s.feeds[def.id]?.data?.entities);
  const camDist = useGlobeStore((s) => s.cameraDistance);
  const ref = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => shapeGeometry(def.shape), [def.shape]);
  const material = useMemo(
    () => new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.92, side: DoubleSide, depthWrite: false, toneMapped: false }),
    [],
  );
  const list = entities ?? [];
  const capacity = Math.max(1, list.length);
  const moving = def.shape === 'sat' || def.shape === 'plane' || def.shape === 'ship';
  const elapsed = useRef(0);

  const layout = () => {
    const mesh = ref.current;
    if (!mesh) return;
    const now = Date.now();
    // Shrink markers as the camera approaches the surface, so close-ups stay readable.
    const scaleBase = 0.0095 * Math.max(0.12, Math.min(1.6, (camDist - 1) / 2.2));
    const col = new Color();
    let n = 0;
    for (const e of list) {
      const p = livePosition(e, now);
      if (!p) continue;
      const alt = altitudeFor(def, proj, p.altKm);
      v0.set(...proj.point(p.lng, p.lat, alt));
      // Local tangent frame (east, north, up) derived numerically, so it matches any projection.
      vE.set(...proj.point(p.lng + 0.01, p.lat, alt)).sub(v0).normalize();
      vN.set(...proj.point(p.lng, Math.min(89.99, p.lat + 0.01), alt)).sub(v0).normalize();
      const up = new Vector3().crossVectors(vE, vN).normalize();
      if ((def.shape === 'plane' || def.shape === 'ship') && e.heading != null) {
        const h = (e.heading * Math.PI) / 180;
        vF.copy(vN).multiplyScalar(Math.cos(h)).addScaledVector(vE, Math.sin(h)).normalize();
        vR.crossVectors(vF, up).normalize();
      } else {
        vF.copy(vN);
        vR.copy(vE);
      }
      const s =
        scaleBase *
        (def.shape === 'sat' ? 0.7 : def.shape === 'plane' ? 1 : def.shape === 'ship' ? 0.85 : 0.8 + 1.4 * (e.size ?? 0.4));
      tmpM.makeBasis(vR.multiplyScalar(s), vF.multiplyScalar(s), up.multiplyScalar(s)).setPosition(v0);
      mesh.setMatrixAt(n, tmpM);
      mesh.setColorAt(n, col.set(e.color ?? def.color));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  useEffect(() => {
    layout();
    material.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, proj, camDist]);

  // Moving objects: recompute positions once per second (satellites, aircraft).
  useFrame((_, dt) => {
    if (!moving) return;
    elapsed.current += dt;
    const period = list.length > 2000 ? 3 : 1;
    if (elapsed.current >= period) {
      elapsed.current = 0;
      layout();
    }
  });

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const idAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId != null ? list[e.instanceId]?.id : undefined);

  return (
    <instancedMesh
      key={capacity}
      ref={ref}
      args={[geometry, material, capacity]}
      renderOrder={9}
      onPointerMove={(e) => {
        e.stopPropagation();
        pointer.x = e.nativeEvent.clientX;
        pointer.y = e.nativeEvent.clientY;
        const id = idAt(e);
        useLiveStore.getState().setHovered(id ? { feed: def.id, id } : null);
        useGlobeStore.getState().setHoveredCountry(null);
        useGlobeStore.getState().setHoveredConnection(null);
        document.body.style.cursor = id ? 'pointer' : '';
      }}
      onPointerOut={() => {
        useLiveStore.getState().setHovered(null);
        document.body.style.cursor = '';
      }}
      onClick={(e) => {
        if (e.delta > 5) return;
        e.stopPropagation();
        const id = idAt(e);
        if (id) useAppStore.getState().openInspector({ kind: 'live', feed: def.id, id });
      }}
    />
  );
}

function LiveLines({ def, proj, trail = false }: { def: LiveFeedDef; proj: Projection; trail?: boolean }) {
  const lines = useLiveStore((s) => s.feeds[def.id]?.data?.lines);
  const ref = useRef<LineSegments>(null);
  const { geometry, segOwner } = useMemo(() => {
    const parts: Float32Array[] = [];
    const owner: number[] = [];
    (lines ?? []).forEach((l, li) => {
      const seg = linesToSegments(l.coords as unknown as number[][][], proj, trail ? 0.0026 : 0.0016, 2);
      parts.push(seg);
      for (let i = 0; i < seg.length / 6; i++) owner.push(li);
    });
    const total = parts.reduce((a, p) => a + p.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const p of parts) all.set(p, (o += p.length) - p.length);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(all, 3));
    return { geometry: g, segOwner: owner };
  }, [lines, proj]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const idAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.index != null ? lines?.[segOwner[Math.floor(e.index / 2)] ?? -1]?.id : undefined);

  return (
    <lineSegments
      ref={ref}
      geometry={geometry}
      renderOrder={3}
      onPointerMove={(e) => {
        const id = idAt(e);
        if (!id) return;
        e.stopPropagation();
        pointer.x = e.nativeEvent.clientX;
        pointer.y = e.nativeEvent.clientY;
        useLiveStore.getState().setHovered({ feed: def.id, id });
        useGlobeStore.getState().setHoveredCountry(null);
      }}
      onPointerOut={() => useLiveStore.getState().setHovered(null)}
    >
      <lineBasicMaterial color={def.color} transparent opacity={trail ? 0.45 : 0.95} depthWrite={false} />
    </lineSegments>
  );
}

/** Great-circle route for the selected aircraft: origin → destination, current position marked. */
function LiveRoute({ proj }: { proj: Projection }) {
  const route = useLiveStore((s) => s.route);
  const geometry = useMemo(() => {
    if (!route) return null;
    const pts = arcPoints(proj, route.from, route.to, 96, 0.004, 0.6);
    const flat: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) flat.push(...pts[i]!, ...pts[i + 1]!);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(flat), 3));
    return g;
  }, [route, proj]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry} renderOrder={10} ref={(o) => o?.computeLineDistances()}>
      <lineDashedMaterial color="#B37036" dashSize={0.01} gapSize={0.006} transparent opacity={0.95} depthWrite={false} />
    </lineSegments>
  );
}
