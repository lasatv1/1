import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Vector3 } from 'three';
import { useGlobeStore } from '@/state/globeStore';
import { cameraPositionFor } from '@/lib/geo/globeGeometry';

export const HOME = { lng: 12, lat: 24, distance: 3.75 };
const MIN_D = 1.22;
const MAX_D = 6.5;

/**
 * Orbit controls + scripted camera moves (fly-to, reset, zoom). Moves slerp the camera
 * direction and interpolate distance so the globe never clips or spins unexpectedly.
 */
export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const anim = useRef<{ from: Vector3; to: Vector3; d0: number; d1: number; t: number; dur: number } | null>(null);

  useEffect(() => {
    camera.position.set(...cameraPositionFor(HOME.lng, HOME.lat, HOME.distance));
    camera.lookAt(0, 0, 0);
  }, [camera]);

  useEffect(
    () =>
      useGlobeStore.subscribe((s, p) => {
        const cmd = s.command;
        if (!cmd || cmd === p.command) return;
        const cur = camera.position.clone();
        const d0 = cur.length();
        let dir: Vector3;
        let d1: number;
        if (cmd.type === 'flyTo') {
          dir = new Vector3(...cameraPositionFor(cmd.lng, cmd.lat, 1));
          d1 = cmd.distance ?? Math.min(d0, 2.9);
        } else if (cmd.type === 'reset') {
          dir = new Vector3(...cameraPositionFor(HOME.lng, HOME.lat, 1));
          d1 = HOME.distance;
        } else {
          dir = cur.clone().normalize();
          d1 = Math.max(MIN_D, Math.min(MAX_D, 1 + (d0 - 1) * cmd.factor));
        }
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        anim.current = { from: cur.normalize(), to: dir.normalize(), d0, d1, t: 0, dur: reduce ? 0.001 : cmd.type === 'zoom' ? 0.35 : 1.1 };
      }),
    [camera],
  );

  useFrame((_, dt) => {
    const c = controls.current;
    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + dt / a.dur);
      const k = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2; // easeInOutCubic
      const dir = slerp(a.from, a.to, k);
      camera.position.copy(dir.multiplyScalar(a.d0 + (a.d1 - a.d0) * k));
      camera.lookAt(0, 0, 0);
      if (a.t >= 1) anim.current = null;
    }
    const d = camera.position.length();
    if (c) {
      // Slower rotation when zoomed in so detail stays controllable.
      c.rotateSpeed = Math.max(0.08, Math.min(0.6, (d - 1) * 0.28));
      c.zoomSpeed = 0.6;
      c.update();
    }
    useGlobeStore.getState().setCameraDistance(d);
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.09}
      minDistance={MIN_D}
      maxDistance={MAX_D}
      onStart={() => {
        anim.current = null;
      }}
    />
  );
}

function slerp(a: Vector3, b: Vector3, t: number): Vector3 {
  const dot = Math.max(-1, Math.min(1, a.dot(b)));
  const omega = Math.acos(dot);
  if (omega < 1e-5) return b.clone();
  const s = Math.sin(omega);
  return a
    .clone()
    .multiplyScalar(Math.sin((1 - t) * omega) / s)
    .add(b.clone().multiplyScalar(Math.sin(t * omega) / s));
}
