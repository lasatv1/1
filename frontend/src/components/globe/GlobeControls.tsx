import type { RefObject } from 'react';
import { Globe2, Maximize2, Minus, Plus, RotateCcw, Tags, Spline } from 'lucide-react';
import { IconButton, Segmented } from '@/components/common/ui';
import { useGlobeStore } from '@/state/globeStore';
import { useAppStore } from '@/state/appStore';

export function toggleFullscreen(el: HTMLElement | null) {
  if (!el) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void el.requestFullscreen?.();
}

export function goGlobal() {
  useAppStore.getState().clearSelection();
  useAppStore.getState().setRegion(null);
  useGlobeStore.getState().resetCamera();
}

export function GlobeControls({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const labels = useAppStore((s) => s.display.countryLabels);
  const connLabels = useAppStore((s) => s.display.connectionLabels);
  const setDisplay = useAppStore((s) => s.setDisplay);
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const g = useGlobeStore.getState;
  return (
    <>
    <div className="absolute left-1/2 top-3 z-10 w-[168px] -translate-x-1/2 rounded-sm bg-panel/90">
      <Segmented
        label="Map view"
        value={viewMode}
        onChange={setViewMode}
        options={[
          { value: 'globe', label: '3D globe', title: 'Rotatable 3D globe' },
          { value: 'flat', label: '2D map', title: 'Flat map pad — drag to pan, scroll to zoom' },
        ]}
      />
    </div>
    <div className="absolute right-3 top-3 z-10 flex flex-col gap-px rounded-sm border border-line bg-panel/90 p-0.5" role="toolbar" aria-label="Globe controls">
      <IconButton label="Zoom in" onClick={() => g().zoom(0.7)}>
        <Plus size={14} />
      </IconButton>
      <IconButton label="Zoom out" onClick={() => g().zoom(1.4)}>
        <Minus size={14} />
      </IconButton>
      <div className="mx-1 my-0.5 h-px bg-line" />
      <IconButton label="Reset globe (R)" onClick={() => g().resetCamera()}>
        <RotateCcw size={13} />
      </IconButton>
      <IconButton label="Global view — clear selection (G)" onClick={goGlobal}>
        <Globe2 size={14} />
      </IconButton>
      <IconButton label="Fullscreen (F)" onClick={() => toggleFullscreen(target.current)}>
        <Maximize2 size={13} />
      </IconButton>
      <div className="mx-1 my-0.5 h-px bg-line" />
      <IconButton label="Toggle country labels" active={labels} onClick={() => setDisplay({ countryLabels: !labels })}>
        <Tags size={13} />
      </IconButton>
      <IconButton label="Toggle connection labels" active={connLabels} onClick={() => setDisplay({ connectionLabels: !connLabels })}>
        <Spline size={13} />
      </IconButton>
    </div>
    </>
  );
}
