import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, ShaderMaterial, Vector3, type LineSegments } from 'three';
import { Line } from '@react-three/drei';
import type { GeoData } from '@/lib/geo/countries';
import type { Connection } from '@/types/intel';
import { arcPoints, type Projection, type Vec3 } from '@/lib/geo/sphere';
import { colors, severityColor } from '@/design/tokens';
import { useAppStore } from '@/state/appStore';
import { useDerivedStore } from '@/state/derivedStore';
import { pointer, useGlobeStore } from '@/state/globeStore';
import { ALL_CATEGORIES } from '@/lib/layers';

const SEGMENTS = 48;
const ARC_BASE = 0.0025;

export function arcPointsFor(geo: GeoData, c: Connection, proj: Projection): Vec3[] | null {
  const a = geo.byId.get(c.src);
  const b = geo.byId.get(c.dst);
  if (!a || !b) return null;
  // Separate parallel categories between the same pair by a small altitude offset.
  const catOffset = 1 + ALL_CATEGORIES.indexOf(c.category) * 0.035;
  return arcPoints(proj, a.anchor, b.anchor, SEGMENTS, ARC_BASE, catOffset);
}

const vertexShader = /* glsl */ `
  attribute float aT;
  attribute float aConn;
  attribute float aFocus;
  attribute vec3 aColor;
  varying float vT;
  varying float vConn;
  varying float vFocus;
  varying vec3 vColor;
  varying float vFacing;
  uniform vec3 uCamDir;
  void main() {
    vT = aT; vConn = aConn; vFocus = aFocus; vColor = aColor;
    vFacing = dot(normalize(position), uCamDir);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uAnimate;
  uniform float uHover;
  uniform float uSelected;
  uniform float uHasFocus;
  uniform float uFlat;
  uniform vec3 uInk;
  varying float vT;
  varying float vConn;
  varying float vFocus;
  varying vec3 vColor;
  varying float vFacing;
  void main() {
    // Direction cue: faint at the source, solid towards the destination.
    float a = mix(0.32, 0.95, smoothstep(0.0, 1.0, vT));
    // Travelling pulse (src → dst); a single subtle highlight per arc.
    float phase = fract(uTime * 0.18 + fract(vConn * 0.618));
    float d = vT - phase;
    float pulse = uAnimate * smoothstep(0.12, 0.0, abs(d)) * 0.4;
    a = min(1.0, a + pulse);
    float isHover = 1.0 - step(0.5, abs(vConn - uHover));
    float isSel = 1.0 - step(0.5, abs(vConn - uSelected));
    float dim = mix(1.0, mix(0.18, 1.0, vFocus), uHasFocus);
    if (uSelected >= 0.0) dim *= mix(0.35, 1.0, isSel);
    // Highlight towards the theme's ink colour (darker on light themes, lighter on black).
    vec3 col = mix(vColor, uInk, max(isHover, isSel) * 0.3);
    // Fade segments over the far hemisphere so the limb is not ringed by back-side arcs.
    float side = mix(smoothstep(-0.25, 0.2, vFacing), 1.0, uFlat);
    gl_FragColor = vec4(col, a * uOpacity * max(dim, isHover) * side);
  }`;

export function ConnectionArcs({ geo, proj }: { geo: GeoData; proj: Projection }) {
  const conns = useDerivedStore((s) => s.visibleConnections);
  const selected = useAppStore((s) => s.selected);
  const connectionId = useAppStore((s) => s.connectionId);
  const opacity = useAppStore((s) => s.display.opacity);
  const animate = useAppStore((s) => s.display.animateFlow);
  const hovered = useGlobeStore((s) => s.hoveredConnection);
  const ref = useRef<LineSegments>(null);
  const raycaster = useThree((s) => s.raycaster);
  const camera = useThree((s) => s.camera);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0.85 },
          uAnimate: { value: 1 },
          uHover: { value: -1 },
          uSelected: { value: -1 },
          uHasFocus: { value: 0 },
          uCamDir: { value: new Vector3(0, 0, 1) },
          uFlat: { value: 0 },
          uInk: { value: new Color(colors.ink) },
        },
      }),
    [],
  );

  const { geometry, ids } = useMemo(() => {
    const focus = new Set(selected);
    const pos: number[] = [];
    const t: number[] = [];
    const conn: number[] = [];
    const foc: number[] = [];
    const col: number[] = [];
    const index: number[] = [];
    const ids: string[] = [];
    const color = new Color();
    conns.forEach((c) => {
      const pts = arcPointsFor(geo, c, proj);
      if (!pts) return;
      const ci = ids.length;
      ids.push(c.id);
      color.set(severityColor[c.severity]);
      const isFocus = focus.has(c.src) || focus.has(c.dst) ? 1 : 0;
      const base = pos.length / 3;
      pts.forEach((p, i) => {
        pos.push(p[0], p[1], p[2]);
        t.push(i / SEGMENTS);
        conn.push(ci);
        foc.push(isFocus);
        col.push(color.r, color.g, color.b);
        if (i < pts.length - 1) index.push(base + i, base + i + 1);
      });
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('aT', new BufferAttribute(new Float32Array(t), 1));
    g.setAttribute('aConn', new BufferAttribute(new Float32Array(conn), 1));
    g.setAttribute('aFocus', new BufferAttribute(new Float32Array(foc), 1));
    g.setAttribute('aColor', new BufferAttribute(new Float32Array(col), 3));
    g.setIndex(index);
    g.computeBoundingSphere();
    return { geometry: g, ids };
  }, [conns, geo, selected, proj]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const u = material.uniforms;
    u.uOpacity!.value = opacity;
    u.uAnimate!.value = animate ? 1 : 0;
    u.uHover!.value = hovered ? ids.indexOf(hovered) : -1;
    u.uSelected!.value = connectionId ? ids.indexOf(connectionId) : -1;
    u.uHasFocus!.value = selected.length ? 1 : 0;
    u.uFlat!.value = proj.kind === 'flat' ? 1 : 0;
  }, [material, opacity, animate, hovered, connectionId, selected, ids, proj]);

  useFrame((_, dt) => {
    if (animate) material.uniforms.uTime!.value += dt;
    (material.uniforms.uCamDir!.value as Vector3).copy(camera.position).normalize();
    // Keep the pick tolerance roughly constant in screen space.
    const dist = proj.kind === 'flat' ? camera.position.z : camera.position.length();
    raycaster.params.Line = { threshold: 0.0032 * dist };
  });

  const idAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const vi = e.index;
    if (vi == null) return null;
    const ci = (geometry.getAttribute('aConn') as BufferAttribute).getX(vi);
    return ids[ci] ?? null;
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    pointer.x = e.nativeEvent.clientX;
    pointer.y = e.nativeEvent.clientY;
    const id = idAt(e);
    useGlobeStore.getState().setHoveredConnection(id);
    useGlobeStore.getState().setHoveredCountry(null);
    document.body.style.cursor = id ? 'pointer' : '';
  };
  const onOut = () => {
    useGlobeStore.getState().setHoveredConnection(null);
    document.body.style.cursor = '';
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    const id = idAt(e);
    if (id) useAppStore.getState().selectConnection(id);
  };

  return (
    <group>
      <lineSegments
        ref={ref}
        geometry={geometry}
        material={material}
        renderOrder={6}
        onPointerMove={onMove}
        onPointerOut={onOut}
        onClick={onClick}
      />
      <DestinationMarkers geo={geo} conns={conns} proj={proj} />
      <SelectedArc geo={geo} proj={proj} />
    </group>
  );
}

/** Small terminal points at each destination — a second, static direction cue. */
function DestinationMarkers({ geo, conns, proj }: { geo: GeoData; conns: Connection[]; proj: Projection }) {
  const geometry = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    const color = new Color();
    for (const c of conns) {
      const pts = arcPointsFor(geo, c, proj);
      const end = pts?.[pts.length - 1];
      if (!end) continue;
      color.set(severityColor[c.severity]);
      pos.push(end[0], end[1], end[2]);
      col.push(color.r, color.g, color.b);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    return g;
  }, [geo, conns, proj]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <points geometry={geometry} renderOrder={7}>
      <pointsMaterial size={3.5} sizeAttenuation={false} vertexColors transparent opacity={0.95} depthWrite={false} />
    </points>
  );
}

function SelectedArc({ geo, proj }: { geo: GeoData; proj: Projection }) {
  const id = useAppStore((s) => s.connectionId);
  const conn = useDerivedStore((s) => (id ? s.connectionsById.get(id) : undefined));
  const pts = useMemo(() => (conn ? arcPointsFor(geo, conn, proj) : null), [geo, conn, proj]);
  if (!conn || !pts) return null;
  return (
    <Line
      points={pts}
      color={severityColor[conn.severity]}
      lineWidth={2.4}
      transparent
      opacity={1}
      depthWrite={false}
      renderOrder={8}
    />
  );
}

