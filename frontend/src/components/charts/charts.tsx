/**
 * Small, purpose-built SVG charts. Thin marks, recessive axes, text in ink tokens,
 * per-mark hover via <title> + hover state, and identity never encoded by colour alone.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Severity } from '@/types/intel';
import { severityCode, severityColor, severityLabel, severityOrder } from '@/design/tokens';
import type { HistogramBucket } from '@/lib/data/aggregate';
import { fmtInt, fmtShortDate, fmtUtc, fmtHourMinute } from '@/lib/format';
import { cx } from '@/components/common/ui';

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
  color?: string;
  hint?: string;
  onClick?: () => void;
}

/** Horizontal bar list — magnitude by length, labels left, values right. */
export function BarList({ items, max, empty = 'No data', unit }: { items: BarItem[]; max?: number; empty?: string; unit?: string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-xs text-ink-3">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((it) => {
        const Comp = it.onClick ? 'button' : 'div';
        return (
          <li key={it.key}>
            <Comp
              type={it.onClick ? 'button' : undefined}
              onClick={it.onClick}
              title={it.hint ?? `${fmtInt(it.value)}${unit ? ` ${unit}` : ''}`}
              className={cx('group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-left text-sm', it.onClick && 'cursor-pointer')}
            >
              <span className={cx('truncate text-ink-2', it.onClick && 'group-hover:text-ink')} title={typeof it.label === 'string' ? it.label : undefined}>{it.label}</span>
              <span className="tabular text-xs text-ink">{fmtInt(it.value)}</span>
              <span className="col-span-2 mt-0.5 h-[3px] rounded-[2px] bg-bg-2">
                <span
                  className="block h-full rounded-[2px] transition-[width] duration-300"
                  style={{ width: `${(it.value / m) * 100}%`, background: it.color ?? '#7D93A8' }}
                />
              </span>
            </Comp>
          </li>
        );
      })}
    </ul>
  );
}

/** Two-part proportion bar with direct labels (incoming vs outgoing etc.). */
export function SplitBar({ a, b, aLabel, bLabel, c, cLabel }: { a: number; b: number; aLabel: string; bLabel: string; c?: number; cLabel?: string }) {
  const total = a + b + (c ?? 0) || 1;
  const parts = [
    { v: a, l: aLabel, col: 'var(--color-accent)' },
    { v: b, l: bLabel, col: '#8A9DB0' },
    ...(c != null && cLabel ? [{ v: c, l: cLabel, col: 'var(--color-line-strong)' }] : []),
  ];
  return (
    <div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-[2px]" role="img" aria-label={parts.map((p) => `${p.l} ${p.v}`).join(', ')}>
        {parts.map((p) =>
          p.v > 0 ? <span key={p.l} title={`${p.l}: ${fmtInt(p.v)}`} style={{ width: `${(p.v / total) * 100}%`, background: p.col }} /> : null,
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((p) => (
          <span key={p.l} className="flex items-center gap-1.5 text-ink-3">
            <span className="h-2 w-2 rounded-[1px]" style={{ background: p.col }} />
            {p.l} <span className="tabular text-ink">{fmtInt(p.v)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Severity distribution as a single stacked bar plus a legend row with counts. */
export function SeverityBar({ counts }: { counts: Record<Severity, number> }) {
  const total = severityOrder.reduce((a, s) => a + counts[s], 0);
  if (!total) return <p className="text-xs text-ink-3">No observations.</p>;
  return (
    <div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-[2px]" role="img" aria-label="Severity distribution">
        {severityOrder.map((s) =>
          counts[s] ? <span key={s} title={`${severityLabel[s]}: ${fmtInt(counts[s])}`} style={{ width: `${(counts[s] / total) * 100}%`, background: severityColor[s] }} /> : null,
        )}
      </div>
      <div className="mt-1.5 grid grid-cols-5 gap-1 text-2xs">
        {severityOrder.map((s) => (
          <div key={s} className="flex flex-col" title={severityLabel[s]}>
            <span className="mono flex items-center gap-1 text-ink-3">
              <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: severityColor[s] }} />
              {severityCode[s]}
            </span>
            <span className="tabular text-xs text-ink">{fmtInt(counts[s])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Stacked severity histogram over time with a hover crosshair + tooltip.
 * Optional cursor (playback position) and brush selection callbacks.
 */
export function TimeHistogram({
  buckets,
  height = 64,
  cursor,
  onBrush,
  onScrub,
  showAxis = true,
  highlight,
}: {
  buckets: HistogramBucket[];
  height?: number;
  cursor?: number | null;
  onBrush?: (from: number, to: number) => void;
  onScrub?: (t: number) => void;
  showAxis?: boolean;
  highlight?: [number, number] | null;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const W = 1000;
  const axisH = showAxis ? 14 : 0;
  const H = height - axisH;
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const from = buckets[0]?.t0 ?? 0;
  const to = buckets[buckets.length - 1]?.t1 ?? 1;
  const x = (t: number) => ((t - from) / (to - from || 1)) * W;
  const bw = W / Math.max(1, buckets.length);
  const gap = buckets.length > 160 ? 0 : 1;

  const ticks = useMemo(() => {
    const span = to - from;
    const out: number[] = [];
    if (!span) return out;
    const step = span > 10 * 86_400_000 ? 5 * 86_400_000 : span > 2 * 86_400_000 ? 86_400_000 : span > 12 * 3_600_000 ? 6 * 3_600_000 : span > 3 * 3_600_000 ? 3_600_000 : 15 * 60_000;
    for (let t = Math.ceil(from / step) * step; t < to; t += step) out.push(t);
    return out;
  }, [from, to]);
  const daily = to - from > 2 * 86_400_000;

  const tAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return from + ((clientX - r.left) / r.width) * (to - from);
  };

  return (
    <div className="relative h-full w-full select-none">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className={cx('h-full w-full', (onBrush || onScrub) && 'cursor-crosshair')}
        role="img"
        aria-label="Observations over time by severity"
        onPointerMove={(e) => {
          const t = tAt(e.clientX);
          setHover(Math.max(0, Math.min(buckets.length - 1, Math.floor(((t - from) / (to - from)) * buckets.length))));
          if (drag) setDrag([drag[0], t]);
          if (e.buttons === 1 && onScrub && !onBrush) onScrub(Math.max(from, Math.min(to, t)));
        }}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const t = tAt(e.clientX);
          if (onBrush) setDrag([t, t]);
          else if (onScrub) onScrub(t);
        }}
        onPointerUp={() => {
          if (drag && onBrush) {
            const [a, b] = drag;
            if (Math.abs(b - a) > (to - from) / 200) onBrush(Math.max(from, Math.min(a, b)), Math.min(to, Math.max(a, b)));
          }
          setDrag(null);
        }}
      >
        {highlight && <rect x={x(highlight[0])} width={Math.max(1, x(highlight[1]) - x(highlight[0]))} y={0} height={H} fill="var(--color-elevated)" />}
        {buckets.map((b, i) => {
          let y = H;
          return (
            <g key={i} opacity={cursor != null && b.t0 > cursor ? 0.25 : 1}>
              {[...severityOrder].reverse().map((s) => {
                const v = b.bySeverity[s];
                if (!v) return null;
                const h = (v / max) * (H - 2);
                y -= h;
                return <rect key={s} x={i * bw + gap / 2} y={y} width={Math.max(0.5, bw - gap)} height={h} fill={severityColor[s]} />;
              })}
            </g>
          );
        })}
        {hover != null && buckets[hover] && <rect x={hover * bw} y={0} width={bw} height={H} fill="var(--color-ink)" opacity={0.06} />}
        {drag && <rect x={x(Math.min(...drag))} width={Math.abs(x(drag[1]) - x(drag[0]))} y={0} height={H} fill="var(--color-accent)" opacity={0.18} />}
        {cursor != null && <line x1={x(cursor)} x2={x(cursor)} y1={0} y2={H} stroke="var(--color-ink)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        <line x1={0} x2={W} y1={H + 0.5} y2={H + 0.5} stroke="var(--color-line-strong)" vectorEffect="non-scaling-stroke" />
        {showAxis &&
          ticks.map((t) => (
            <line key={t} x1={x(t)} x2={x(t)} y1={H} y2={H + 3} stroke="var(--color-ink-3)" vectorEffect="non-scaling-stroke" />
          ))}
      </svg>
      {showAxis && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[12px]">
          {ticks.map((t) => (
            <span key={t} className="mono absolute -translate-x-1/2 text-[9.5px] leading-[12px] text-ink-3" style={{ left: `${(x(t) / W) * 100}%` }}>
              {daily ? fmtShortDate(t) : fmtHourMinute(t)}
            </span>
          ))}
        </div>
      )}
      {hover != null && buckets[hover] && !drag && (
        <div
          className="pointer-events-none absolute bottom-full z-30 mb-1 w-[176px] -translate-x-1/2 rounded-sm border border-line-strong bg-elevated px-2.5 py-1.5 text-2xs shadow-[0_4px_16px_rgba(40,48,58,0.14)]"
          style={{ left: `${Math.min(92, Math.max(8, ((hover + 0.5) / buckets.length) * 100))}%` }}
        >
          <div className="mono text-ink-2">{fmtUtc(buckets[hover].t0)}</div>
          <div className="mb-1 flex justify-between text-ink">
            <span>Observations</span>
            <span className="tabular">{fmtInt(buckets[hover].total)}</span>
          </div>
          {severityOrder.map((s) =>
            buckets[hover]!.bySeverity[s] ? (
              <div key={s} className="flex items-center justify-between text-ink-3">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: severityColor[s] }} />
                  {severityLabel[s]}
                </span>
                <span className="tabular text-ink-2">{fmtInt(buckets[hover]!.bySeverity[s])}</span>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
