import { useEffect, useMemo, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, MeshBasicMaterial, type Mesh } from 'three';
import { Line } from '@react-three/drei';
import type { GeoData } from '@/lib/geo/countries';
import { buildCountryMesh, countryOutlineSegments, meshToSegments, BORDER_ALT } from '@/lib/geo/globeGeometry';
import type { Projection } from '@/lib/geo/sphere';
import { colors, sequentialRamp } from '@/design/tokens';
import { useAppStore } from '@/state/appStore';
import { useDerivedStore } from '@/state/derivedStore';
import { useDataStore } from '@/state/dataStore';
import { pointer, useGlobeStore } from '@/state/globeStore';
import { LAYER_BY_ID } from '@/lib/layers';

const CLICK_TOLERANCE_PX = 5;

function rampColor(t: number, out: Color) {
  const x = Math.max(0, Math.min(1, t)) * (sequentialRamp.length - 1);
  const i = Math.floor(x);
  const a = new Color(sequentialRamp[i]!);
  const b = new Color(sequentialRamp[Math.min(i + 1, sequentialRamp.length - 1)]!);
  return out.copy(a).lerp(b, x - i);
}

export function Countries({ geo, proj }: { geo: GeoData; proj: Projection }) {
  const mesh = useMemo(() => buildCountryMesh(geo, proj), [geo, proj]);
  const material = useMemo(
    () => new MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    [],
  );
  const meshRef = useRef<Mesh>(null);

  const selected = useAppStore((s) => s.selected);
  const layer = useAppStore((s) => s.layer);
  const region = useAppStore((s) => s.region);
  const subregion = useAppStore((s) => s.subregion);
  const stats = useDerivedStore((s) => s.stats);
  const maxTotal = useDerivedStore((s) => s.maxCountryTotal);
  const network = useDataStore((s) => s.dataset?.network);
  const hovered = useGlobeStore((s) => s.hoveredCountry);

  // Base fill per country (layer encoding + geographic filter), recomputed on data change.
  const baseColors = useMemo(() => {
    const def = LAYER_BY_ID[layer];
    const out: Color[] = [];
    let maxAsn = 1;
    if (def.choropleth === 'asn' && network) for (const f of Object.values(network)) maxAsn = Math.max(maxAsn, f.asnCount ?? 0);
    for (const c of geo.countries) {
      const col = new Color(colors.land);
      if (region && (c.region !== region || (subregion && c.subregion !== subregion))) col.set(colors.dimmedLand);
      else if (def.choropleth === 'events') {
        const total = stats.get(c.id)?.total ?? 0;
        if (total) rampColor(0.15 + 0.85 * (Math.log1p(total) / Math.log1p(Math.max(1, maxTotal))), col);
      } else if (def.choropleth === 'asn') {
        const n = network?.[c.id]?.asnCount ?? 0;
        if (n) rampColor(0.15 + 0.85 * (Math.log1p(n) / Math.log1p(maxAsn)), col);
      }
      out.push(col);
    }
    return out;
  }, [geo, layer, region, subregion, stats, maxTotal, network]);

  const indexOf = useMemo(() => new Map(geo.countries.map((c, i) => [c.id, i])), [geo]);

  useEffect(() => {
    const attr = mesh.geometry.getAttribute('color') as BufferAttribute;
    const arr = attr.array as Float32Array;
    const sel = new Set(selected);
    const tmp = new Color();
    geo.countries.forEach((c, ci) => {
      if (sel.has(c.id)) tmp.set(colors.selected);
      else if (hovered === c.id) tmp.set(colors.hovered);
      else tmp.copy(baseColors[ci]!);
      if (sel.size && !sel.has(c.id) && hovered !== c.id) tmp.lerp(new Color(colors.bg), 0.18);
      const [start, count] = mesh.vertexRanges[ci]!;
      for (let v = start; v < start + count; v++) {
        arr[v * 3] = tmp.r;
        arr[v * 3 + 1] = tmp.g;
        arr[v * 3 + 2] = tmp.b;
      }
    });
    attr.needsUpdate = true;
  }, [mesh, geo, selected, hovered, baseColors]);

  const borders = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(meshToSegments(geo.borders, proj, BORDER_ALT), 3));
    return g;
  }, [geo, proj]);
  const coast = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(meshToSegments(geo.coastlines, proj, BORDER_ALT), 3));
    return g;
  }, [geo, proj]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      borders.dispose();
      coast.dispose();
    },
    [mesh, borders, coast],
  );

  const countryAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (e.faceIndex == null) return null;
    const ci = mesh.faceCountry[e.faceIndex];
    return ci == null ? null : geo.countries[ci]!;
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    pointer.x = e.nativeEvent.clientX;
    pointer.y = e.nativeEvent.clientY;
    const c = countryAt(e);
    useGlobeStore.getState().setHoveredCountry(c?.id ?? null);
    useGlobeStore.getState().setHoveredConnection(null);
    document.body.style.cursor = c ? 'pointer' : '';
  };
  const onOut = () => {
    useGlobeStore.getState().setHoveredCountry(null);
    document.body.style.cursor = '';
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > CLICK_TOLERANCE_PX) return;
    e.stopPropagation();
    const c = countryAt(e);
    if (!c) return;
    const additive = e.nativeEvent.shiftKey || e.nativeEvent.metaKey || e.nativeEvent.ctrlKey;
    useAppStore.getState().selectCountry(c.id, additive);
    if (!additive) useGlobeStore.getState().flyTo(c.anchor[0], c.anchor[1]);
  };

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={mesh.geometry}
        material={material}
        renderOrder={2}
        onPointerMove={onMove}
        onPointerOut={onOut}
        onClick={onClick}
      />
      <lineSegments geometry={coast} renderOrder={3}>
        <lineBasicMaterial color={colors.border} transparent opacity={0.85} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={borders} renderOrder={3}>
        <lineBasicMaterial color={colors.border} transparent opacity={0.85} depthWrite={false} />
      </lineSegments>
      <SelectionOutlines geo={geo} proj={proj} selected={selected} hovered={hovered} indexOf={indexOf} />
    </group>
  );
}

function toTuples(arr: Float32Array): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < arr.length; i += 3) out.push([arr[i]!, arr[i + 1]!, arr[i + 2]!]);
  return out;
}

function SelectionOutlines({
  geo,
  proj,
  selected,
  hovered,
  indexOf,
}: {
  geo: GeoData;
  proj: Projection;
  selected: string[];
  hovered: string | null;
  indexOf: Map<string, number>;
}) {
  const selPoints = useMemo(() => {
    const parts: Array<[number, number, number]> = [];
    for (const id of selected) {
      const c = geo.countries[indexOf.get(id) ?? -1];
      if (c) parts.push(...toTuples(countryOutlineSegments(c, proj)));
    }
    return parts;
  }, [geo, proj, selected, indexOf]);

  const hoverGeom = useMemo(() => {
    if (!hovered || selected.includes(hovered)) return null;
    const c = geo.countries[indexOf.get(hovered) ?? -1];
    if (!c) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(countryOutlineSegments(c, proj), 3));
    return g;
  }, [geo, proj, hovered, selected, indexOf]);

  useEffect(() => () => hoverGeom?.dispose(), [hoverGeom]);

  return (
    <>
      {selPoints.length > 1 && (
        <Line points={selPoints} segments color={colors.ink} lineWidth={1.6} transparent opacity={1} depthWrite={false} renderOrder={5} />
      )}
      {hoverGeom && (
        <lineSegments geometry={hoverGeom} renderOrder={4}>
          <lineBasicMaterial color={colors.ink} transparent opacity={0.9} depthWrite={false} />
        </lineSegments>
      )}
    </>
  );
}
