import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { GeoData } from '@/lib/geo/countries';
import type { Projection } from '@/lib/geo/sphere';
import { useAppStore } from '@/state/appStore';
import { useGlobeStore } from '@/state/globeStore';
import { useDerivedStore } from '@/state/derivedStore';
import { arcPointsFor } from './ConnectionArcs';

interface LabelItem {
  key: string;
  text: string;
  pos: Vector3;
  normal: Vector3;
  priority: number;
  emph: boolean;
  el?: HTMLDivElement;
}

/** Natural Earth LABELRANK threshold for the current camera distance. */
function rankLimit(d: number): number {
  if (d > 3.9) return 2;
  if (d > 3.0) return 3;
  if (d > 2.3) return 4;
  if (d > 1.7) return 5;
  if (d > 1.45) return 6;
  return 8;
}

/**
 * DOM labels positioned imperatively each frame (no React re-render). Back-facing labels
 * are hidden, and a greedy pass drops labels that would overlap higher-priority ones.
 */
export function Labels({ geo, container, proj }: { geo: GeoData; container: HTMLDivElement | null; proj: Projection }) {
  const showCountries = useAppStore((s) => s.display.countryLabels);
  const showConnections = useAppStore((s) => s.display.connectionLabels);
  const selected = useAppStore((s) => s.selected);
  const distance = useGlobeStore((s) => s.cameraDistance);
  const hovered = useGlobeStore((s) => s.hoveredCountry);
  const conns = useDerivedStore((s) => s.visibleConnections);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const items = useRef<LabelItem[]>([]);

  const limit = rankLimit(distance);

  const list = useMemo(() => {
    const out: LabelItem[] = [];
    if (showCountries) {
      for (const c of geo.countries) {
        const emph = selected.includes(c.id) || hovered === c.id;
        if (!emph && (c.labelRank > limit || c.region === 'Antarctica')) continue;
        const v = new Vector3(...proj.point(c.anchor[0], c.anchor[1], 0.004));
        out.push({ key: `c:${c.id}`, text: c.name, pos: v, normal: new Vector3(...proj.normal(c.anchor[0], c.anchor[1])), priority: emph ? -10 : c.labelRank, emph });
      }
    }
    if (showConnections) {
      [...conns]
        .sort((a, b) => b.count - a.count)
        .slice(0, 14)
        .forEach((c) => {
          const pts = arcPointsFor(geo, c, proj);
          const mid = pts?.[Math.floor(pts.length / 2)];
          if (!mid) return;
          const v = new Vector3(...mid);
          out.push({ key: `x:${c.id}`, text: `${c.src} → ${c.dst} · ${c.count}`, pos: v, normal: proj.kind === 'flat' ? new Vector3(0, 0, 1) : v.clone().normalize(), priority: 1, emph: false });
        });
    }
    return out;
  }, [geo, proj, showCountries, showConnections, selected, hovered, limit, conns]);

  useEffect(() => {
    if (!container) return;
    container.replaceChildren();
    for (const it of list) {
      const el = document.createElement('div');
      el.className = it.key.startsWith('x:') ? 'country-label mono' : 'country-label';
      el.textContent = it.text;
      if (it.emph) el.dataset.emph = '1';
      el.style.opacity = '0';
      container.appendChild(el);
      it.el = el;
    }
    items.current = [...list].sort((a, b) => a.priority - b.priority);
    return () => container.replaceChildren();
  }, [list, container]);

  const tmp = useMemo(() => new Vector3(), []);
  const camDir = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const placed: Array<[number, number, number, number]> = [];
    camDir.copy(camera.position).normalize();
    const flat = proj.kind === 'flat';
    for (const it of items.current) {
      const el = it.el;
      if (!el) continue;
      const facing = flat ? 1 : it.normal.dot(camDir);
      if (facing < 0.25) {
        el.style.opacity = '0';
        continue;
      }
      tmp.copy(it.pos).project(camera);
      const x = (tmp.x * 0.5 + 0.5) * size.width;
      const y = (-tmp.y * 0.5 + 0.5) * size.height;
      const w = it.text.length * 6.2;
      const box: [number, number, number, number] = [x - w / 2, y - 7, x + w / 2, y + 7];
      const overlaps = !it.emph && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      if (overlaps) {
        el.style.opacity = '0';
        continue;
      }
      placed.push(box);
      el.style.opacity = String(Math.min(1, (facing - 0.25) * 4));
      el.style.transform = `translate(${(x - w / 2).toFixed(1)}px, ${(y - 7).toFixed(1)}px)`;
    }
  });

  return null;
}
