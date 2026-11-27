import { useEffect, useMemo, useRef } from 'react';
import { Color, InstancedMesh, Matrix4, Quaternion, RingGeometry, Vector3, MeshBasicMaterial, DoubleSide } from 'three';
import type { GeoData } from '@/lib/geo/countries';
import type { Projection } from '@/lib/geo/sphere';
import { severityColor } from '@/design/tokens';
import { useAppStore } from '@/state/appStore';
import { useDerivedStore } from '@/state/derivedStore';
import { LAYER_BY_ID } from '@/lib/layers';

const MAX = 260;

/**
 * Located observations (infrastructure or affected-country reports without a
 * counterpart country). Ring size ∝ √count, colour = highest severity present.
 */
export function ActivityMarkers({ geo, proj }: { geo: GeoData; proj: Projection }) {
  const layer = useAppStore((s) => s.layer);
  const stats = useDerivedStore((s) => s.stats);
  const ref = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new RingGeometry(0.62, 1, 32), []);
  const material = useMemo(
    () => new MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide, toneMapped: false }),
    [],
  );

  const items = useMemo(() => {
    const def = LAYER_BY_ID[layer];
    const markersOnly = !def.visuals.includes('arcs');
    const list: Array<{ id: string; value: number; color: string }> = [];
    for (const s of stats.values()) {
      const value = markersOnly ? s.total : s.hosted;
      if (!value || !s.maxSeverity) continue;
      list.push({ id: s.id, value, color: severityColor[s.maxSeverity] });
    }
    return list.sort((a, b) => b.value - a.value).slice(0, MAX);
  }, [stats, layer]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const max = Math.max(1, ...items.map((i) => i.value));
    const m = new Matrix4();
    const q = new Quaternion();
    const z = new Vector3(0, 0, 1);
    const col = new Color();
    let n = 0;
    const hadColor = !!mesh.instanceColor;
    for (const it of items) {
      const c = geo.byId.get(it.id);
      if (!c) continue;
      const p = new Vector3(...proj.point(c.anchor[0], c.anchor[1], 0.003));
      q.setFromUnitVectors(z, new Vector3(...proj.normal(c.anchor[0], c.anchor[1])));
      const s = 0.006 + 0.022 * Math.sqrt(it.value / max);
      m.compose(p, q, new Vector3(s, s, s));
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, col.set(it.color));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (!hadColor && mesh.instanceColor) material.needsUpdate = true;
  }, [items, geo, material, proj]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <instancedMesh ref={ref} args={[geometry, material, MAX]} renderOrder={5} raycast={() => null} />;
}
