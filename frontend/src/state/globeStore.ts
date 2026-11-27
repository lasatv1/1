/**
 * High-frequency globe interaction state. Kept separate from the dashboard store so
 * hover/camera changes never re-render panels. Pointer position is a mutable object
 * read inside animation frames (no React state at all).
 */
import { create } from 'zustand';

export type CameraCommand =
  | { type: 'flyTo'; lng: number; lat: number; distance?: number; nonce: number }
  | { type: 'reset'; nonce: number }
  | { type: 'zoom'; factor: number; nonce: number };

interface GlobeState {
  hoveredCountry: string | null;
  hoveredConnection: string | null;
  command: CameraCommand | null;
  cameraDistance: number;
  setHoveredCountry: (id: string | null) => void;
  setHoveredConnection: (id: string | null) => void;
  flyTo: (lng: number, lat: number, distance?: number) => void;
  resetCamera: () => void;
  zoom: (factor: number) => void;
  setCameraDistance: (d: number) => void;
}

let nonce = 0;

export const useGlobeStore = create<GlobeState>((set, get) => ({
  hoveredCountry: null,
  hoveredConnection: null,
  command: null,
  cameraDistance: 3,
  setHoveredCountry: (id) => {
    if (get().hoveredCountry !== id) set({ hoveredCountry: id });
  },
  setHoveredConnection: (id) => {
    if (get().hoveredConnection !== id) set({ hoveredConnection: id });
  },
  flyTo: (lng, lat, distance) => set({ command: { type: 'flyTo', lng, lat, distance, nonce: ++nonce } }),
  resetCamera: () => set({ command: { type: 'reset', nonce: ++nonce } }),
  zoom: (factor) => set({ command: { type: 'zoom', factor, nonce: ++nonce } }),
  setCameraDistance: (d) => {
    // Only publish coarse changes (label LOD thresholds), not every frame.
    if (Math.abs(get().cameraDistance - d) > 0.05) set({ cameraDistance: d });
  },
}));

/** Client-space pointer position, mutated by pointer handlers and read in rAF loops. */
export const pointer = { x: 0, y: 0 };
