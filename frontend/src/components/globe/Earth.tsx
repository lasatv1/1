import { useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three';
import { colors } from '@/design/tokens';
import { useGlobeStore } from '@/state/globeStore';
import { GLOBE_RADIUS, linesToSegments } from '@/lib/geo/globeGeometry';
import type { Projection } from '@/lib/geo/sphere';

const clearHover = (e: ThreeEvent<PointerEvent>) => {
  // Handlers make the ocean occlude picking of arcs/markers behind it.
  e.stopPropagation();
  useGlobeStore.getState().setHoveredCountry(null);
  useGlobeStore.getState().setHoveredConnection(null);
  document.body.style.cursor = '';
};

/**
 * Ocean surface + faint graticule. Globe: sphere with restrained limb shading (depth
 * cue, no glow). Flat: an equirectangular "pad" (2π × π) with a hairline frame.
 */
export function Earth({ proj }: { proj: Projection }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(colors.ocean) },
          uEdge: { value: new Color(colors.oceanEdge) },
          uFlat: { value: proj.kind === 'flat' ? 1 : 0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform vec3 uEdge; uniform float uFlat;
          varying vec3 vN; varying vec3 vV;
          void main() {
            float f = clamp(dot(vN, vV), 0.0, 1.0);
            vec3 c = mix(uEdge, uColor, smoothstep(0.0, 0.55, f));
            gl_FragColor = vec4(mix(c, uColor, uFlat), 1.0);
          }`,
      }),
    [proj],
  );

  const graticule = useMemo(() => {
    const lines: number[][][] = [];
    for (let lng = -180; lng <= 180; lng += 30) {
      const l: number[][] = [];
      for (let lat = -80; lat <= 80; lat += 2) l.push([lng, lat]);
      lines.push(l);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const l: number[][] = [];
      for (let lng = -180; lng <= 180; lng += 2) l.push([lng, lat]);
      lines.push(l);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(linesToSegments(lines, proj, 0.0002, 2), 3));
    return g;
  }, [proj]);

  const frame = useMemo(() => {
    if (proj.kind !== 'flat') return null;
    const g = new BufferGeometry();
    const [w, h] = [Math.PI, Math.PI / 2];
    g.setAttribute('position', new BufferAttribute(new Float32Array([-w, -h, 0.0003, w, -h, 0.0003, w, h, 0.0003, -w, h, 0.0003]), 3));
    return g;
  }, [proj]);

  useEffect(
    () => () => {
      material.dispose();
      graticule.dispose();
      frame?.dispose();
    },
    [material, graticule, frame],
  );

  return (
    <group>
      {proj.kind === 'globe' ? (
        <mesh material={material} renderOrder={0} onPointerMove={clearHover}>
          <sphereGeometry args={[GLOBE_RADIUS, 96, 64]} />
        </mesh>
      ) : (
        <mesh material={material} renderOrder={0} onPointerMove={clearHover}>
          <planeGeometry args={[Math.PI * 2, Math.PI]} />
        </mesh>
      )}
      <lineSegments geometry={graticule} renderOrder={1}>
        <lineBasicMaterial color={colors.graticule} transparent opacity={0.9} depthWrite={false} />
      </lineSegments>
      {frame && (
        <lineLoop geometry={frame} renderOrder={1}>
          <lineBasicMaterial color={colors.border} transparent opacity={0.8} depthWrite={false} />
        </lineLoop>
      )}
    </group>
  );
}
