import { Suspense, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useDataStore } from '@/state/dataStore';
import { useAppStore } from '@/state/appStore';
import { useGlobeStore } from '@/state/globeStore';
import { LAYER_BY_ID } from '@/lib/layers';
import { Earth } from './Earth';
import { Countries } from './Countries';
import { Disputed } from './Disputed';
import { ConnectionArcs } from './ConnectionArcs';
import { ActivityMarkers } from './ActivityMarkers';
import { CameraRig } from './CameraRig';
import { LiveLayers } from './LiveLayers';
import { FlatCameraRig } from './FlatCameraRig';
import { projectionFor } from '@/lib/geo/sphere';
import { Labels } from './Labels';
import { HoverTooltip } from './HoverTooltip';
import { GlobeControls } from './GlobeControls';
import { GlobeLegend } from './GlobeLegend';

/** The primary interface: interactive 3D globe plus its in-viewport controls. */
export default function GlobeView() {
  const geo = useDataStore((s) => s.geo);
  const layer = useAppStore((s) => s.layer);
  const display = useAppStore((s) => s.display);
  const viewMode = useAppStore((s) => s.viewMode);
  const theme = useAppStore((s) => s.theme);
  const proj = projectionFor(viewMode);
  const [labelLayer, setLabelLayer] = useState<HTMLDivElement | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const def = LAYER_BY_ID[layer];

  return (
    <div ref={wrap} id="globe-viewport" className="relative h-full w-full overflow-hidden bg-bg" aria-label={viewMode === 'flat' ? 'Interactive 2D map' : 'Interactive globe'}>
      {geo && (
        <Canvas
          camera={{ fov: 38, near: 0.01, far: 50, position: [0, 0, 3] }}
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
          onCreated={(state) => {
            // Dev-only handle for debugging and automated interaction tests.
            if (import.meta.env.DEV) (window as unknown as { __cta?: unknown }).__cta = state;
          }}
          onPointerMissed={() => {
            useGlobeStore.getState().setHoveredCountry(null);
          }}
          raycaster={{ params: { Line: { threshold: 0.02 }, Points: { threshold: 0 }, Mesh: {}, LOD: {}, Sprite: {} } }}
        >
          {/* Remount on theme/view change so geometry and materials rebuild for the new palette/projection. */}
          <Suspense fallback={null} key={`${theme}:${viewMode}`}>
            <Earth proj={proj} />
            <Countries geo={geo} proj={proj} />
            {display.disputed && <Disputed geo={geo} proj={proj} />}
            {def.visuals.includes('arcs') && <ConnectionArcs geo={geo} proj={proj} />}
            {display.markers && !def.visuals.every((v) => v === 'choropleth') && <ActivityMarkers geo={geo} proj={proj} />}
            <LiveLayers proj={proj} />
            <Labels geo={geo} container={labelLayer} proj={proj} />
            {viewMode === 'flat' ? <FlatCameraRig /> : <CameraRig />}
          </Suspense>
        </Canvas>
      )}
      <div ref={setLabelLayer} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
      <HoverTooltip />
      <GlobeControls target={wrap} />
      <GlobeLegend />
    </div>
  );
}
