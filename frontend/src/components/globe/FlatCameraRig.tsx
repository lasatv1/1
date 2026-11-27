import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { MOUSE, TOUCH, Vector3 } from 'three';
import { useGlobeStore } from '@/state/globeStore';
import { DEG } from '@/lib/geo/sphere';

export const FLAT_HOME = { x: 0.25, y: 0.2, distance: 4.4 };
const MIN_D = 0.45;
const MAX_D = 6;

/**
 * Camera for the 2D map pad: top-down, drag to pan, wheel/pinch to zoom, no rotation.
 * The view is clamped so the map can never be dragged out of sight.
 */
export function FlatCameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const anim = useRef<{ from: Vector3; to: Vector3; d0: number; d1: number; t: number; dur: number } | null>(null);

  useEffect(() => {
    camera.up.set(0, 1, 0);
    camera.position.set(FLAT_HOME.x, FLAT_HOME.y, FLAT_HOME.distance);
    camera.lookAt(FLAT_HOME.x, FLAT_HOME.y, 0);
    controls.current?.target.set(FLAT_HOME.x, FLAT_HOME.y, 0);
  }, [camera]);

  useEffect(
    () =>
      useGlobeStore.subscribe((s, p) => {
        const cmd = s.command;
        const c = controls.current;
        if (!cmd || cmd === p.command || !c) return;
        const from = c.target.clone();
        const d0 = camera.position.z;
        let to = from.clone();
        let d1 = d0;
        if (cmd.type === 'flyTo') {
          to = new Vector3(cmd.lng * DEG, cmd.lat * DEG, 0);
          d1 = Math.min(d0, cmd.distance ? cmd.distance + 0.4 : 2.6);
        } else if (cmd.type === 'reset') {
          to = new Vector3(FLAT_HOME.x, FLAT_HOME.y, 0);
          d1 = FLAT_HOME.distance;
        } else {
          d1 = Math.max(MIN_D, Math.min(MAX_D, d0 * cmd.factor));
        }
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        anim.current = { from, to, d0, d1, t: 0, dur: reduce ? 0.001 : cmd.type === 'zoom' ? 0.3 : 0.9 };
      }),
    [camera],
  );

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + dt / a.dur);
      const k = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      c.target.lerpVectors(a.from, a.to, k);
      camera.position.set(c.target.x, c.target.y, a.d0 + (a.d1 - a.d0) * k);
      if (a.t >= 1) anim.current = null;
    }
    // Clamp pan to the map extent.
    const tx = Math.max(-Math.PI, Math.min(Math.PI, c.target.x));
    const ty = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, c.target.y));
    if (tx !== c.target.x || ty !== c.target.y) {
      camera.position.x += tx - c.target.x;
      camera.position.y += ty - c.target.y;
      c.target.set(tx, ty, 0);
    }
    c.update();
    // Labels use globe-equivalent distance thresholds.
    useGlobeStore.getState().setCameraDistance(1 + camera.position.z * 0.62);
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableRotate={false}
      enablePan
      screenSpacePanning
      enableDamping
      dampingFactor={0.12}
      minDistance={MIN_D}
      maxDistance={MAX_D}
      zoomToCursor
      mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }}
      onStart={() => {
        anim.current = null;
      }}
    />
  );
}
