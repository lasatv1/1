/**
 * Design tokens shared with WebGL code. CSS equivalents live in styles/index.css
 * (`:root` = Mist, `[data-theme='light']`, `[data-theme='black']`). Restrained, no neon:
 *   - mist  (default): mid-tone gray-slate surfaces
 *   - light (option) : paler stone surfaces
 *   - black (option) : true-black surfaces with neutral graphite land
 */
import type { Severity } from '@/types/intel';

export type ThemeId = 'mist' | 'light' | 'black';

interface Palette {
  bg: string;
  bg2: string;
  panel: string;
  elevated: string;
  ink: string;
  ink2: string;
  ink3: string;
  ocean: string;
  oceanEdge: string;
  graticule: string;
  land: string;
  border: string;
  selected: string;
  hovered: string;
  compared: string;
  dimmedLand: string;
  disputed: string;
  ramp: string[];
}

const PALETTES: Record<ThemeId, Palette> = {
  mist: {
    bg: '#C3C9CF',
    bg2: '#CBD0D5',
    panel: '#D2D6DA',
    elevated: '#C4CACF',
    ink: '#1B2128',
    ink2: '#3F4955',
    ink3: '#66717D',
    ocean: '#B3C0CC',
    oceanEdge: '#9DACBA',
    graticule: '#9AAAB9',
    land: '#DCD8CF',
    border: '#8B949E',
    selected: '#2F4052',
    hovered: '#B3BFCA',
    compared: '#4A6681',
    dimmedLand: '#CDC9C0',
    disputed: '#56606B',
    ramp: ['#D8D4CB', '#C4C8C8', '#AAB7BF', '#8EA2B2', '#728DA3', '#587690'],
  },
  light: {
    bg: '#E4E7EB',
    bg2: '#ECEEF1',
    panel: '#F2F3F5',
    elevated: '#E3E7EB',
    ink: '#1D242C',
    ink2: '#4A5563',
    ink3: '#7A8592',
    ocean: '#C9D4DE',
    oceanEdge: '#AEBBC7',
    graticule: '#B9C5D0',
    land: '#EBE8E2',
    border: '#A3ACB6',
    selected: '#34475A',
    hovered: '#C8D2DC',
    compared: '#4F6D88',
    dimmedLand: '#DDDAD3',
    disputed: '#6B7580',
    ramp: ['#E6E3DC', '#D2D6D6', '#B9C4CB', '#9DAFBD', '#8199AD', '#66839B'],
  },
  black: {
    bg: '#000000',
    bg2: '#070707',
    panel: '#0C0C0C',
    elevated: '#1A1A1A',
    ink: '#E8E8E6',
    ink2: '#A6A6A2',
    ink3: '#6E6E6A',
    ocean: '#050505',
    oceanEdge: '#000000',
    graticule: '#141414',
    land: '#1E1E1E',
    border: '#4A4A4A',
    selected: '#D9D9D6',
    hovered: '#5A5A58',
    compared: '#BDBDB9',
    dimmedLand: '#141414',
    disputed: '#8A8A86',
    ramp: ['#1E1E1E', '#2A2D30', '#363D44', '#434E59', '#52616F', '#637587'],
  },
};

/** Active palette. Mutated by applyTheme(); the WebGL scene remounts on theme change. */
export const colors: Omit<Palette, 'ramp'> = { ...PALETTES.mist };
/** Sequential single-hue ramp (magnitude) for choropleth layers, from land colour to slate. */
export const sequentialRamp: string[] = [...PALETTES.mist.ramp];

export function applyTheme(theme: ThemeId) {
  const { ramp, ...rest } = PALETTES[theme];
  Object.assign(colors, rest);
  sequentialRamp.splice(0, sequentialRamp.length, ...ramp);
  document.documentElement.dataset.theme = theme;
}

/** Muted severity scale (works on both themes); always paired with a text code. */
export const severityColor: Record<Severity, string> = {
  critical: '#AC4A44',
  high: '#B37036',
  medium: '#A68A3A',
  low: '#528270',
  info: '#537493',
};

export const severityOrder: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const severityLabel: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Informational',
};

/** Short code used as secondary (non-colour) encoding next to every severity swatch. */
export const severityCode: Record<Severity, string> = {
  critical: 'CRIT',
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
  info: 'INFO',
};
