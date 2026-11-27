import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, type LineSegments } from 'three';
import type { Position } from 'geojson';
import type { GeoData } from '@/lib/geo/countries';
import { linesToSegments, ringsOf } from '@/lib/geo/globeGeometry';
import { colors } from '@/design/tokens';
import type { Projection } from '@/lib/geo/sphere';

const ALT = 0.0018;

/**
 * Disputed / breakaway areas and disputed boundary lines from Natural Earth, drawn
 * dashed so they are never confused with recognised international boundaries.
 */
export function Disputed({ geo, proj }: { geo: GeoData; proj: Projection }) {
  const ref = useRef<LineSegments>(null);
  const geometry = useMemo(() => {
    const lines: Position[][] = [];
    for (const d of geo.disputed) lines.push(...ringsOf(d.feature.geometry));
    for (const f of geo.disputedLines.features) {
      const g = f.geometry;
      if (g.type === 'LineString') lines.push(g.coordinates);
      else if (g.type === 'MultiLineString') lines.push(...g.coordinates);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(linesToSegments(lines, proj, ALT, 0.5), 3));
    return g;
  }, [geo, proj]);

  useEffect(() => {
    ref.current?.computeLineDistances();
    return () => geometry.dispose();
  }, [geometry]);

  return (
    <lineSegments ref={ref} geometry={geometry} renderOrder={4}>
      <lineDashedMaterial color={colors.disputed} dashSize={0.004} gapSize={0.004} transparent opacity={0.9} depthWrite={false} />
    </lineSegments>
  );
}
