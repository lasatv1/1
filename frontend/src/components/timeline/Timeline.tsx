import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Radio } from 'lucide-react';
import { useAppStore } from '@/state/appStore';
import { useDerivedStore } from '@/state/derivedStore';
import { useDataStore } from '@/state/dataStore';
import { histogram } from '@/lib/data/aggregate';
import { TimeHistogram } from '@/components/charts/charts';
import { fmtInt, fmtRelative, fmtUtc } from '@/lib/format';
import { Button, cx, Segmented } from '@/components/common/ui';

const pad = (n: number) => String(n).padStart(2, '0');

/** Ticking UTC clock (1 Hz). */
function UtcClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const d = new Date(now);
  return (
    <span className="mono tabular text-[15px] text-ink">
      {pad(d.getUTCHours())}:{pad(d.getUTCMinutes())}:{pad(d.getUTCSeconds())}
      <span className="ml-1 text-2xs text-ink-3">UTC</span>
    </span>
  );
}

/**
 * Always-live activity strip. The observation window rolls forward with the clock
 * (see useLiveClock); there is no playback. Picking a custom range pins the window until
 * "Back to live" is pressed.
 */
export function Timeline() {
  const time = useAppStore((s) => s.time);
  const setCustomRange = useAppStore((s) => s.setCustomRange);
  const setTimePreset = useAppStore((s) => s.setTimePreset);
  const timelineIdx = useDerivedStore((s) => s.timelineIdx);
  const visibleCount = useDerivedStore((s) => s.totals.events);
  const dataset = useDataStore((s) => s.dataset);
  const lastRefresh = useDataStore((s) => s.lastRefresh);
  const events = dataset?.events;
  const extent = dataset?.extent;
  const live = time.preset !== 'custom';

  const detail = useMemo(
    () => (events ? histogram(events, timelineIdx, time.from, time.to, time.to - time.from <= 3_600_000 ? 60 : 120) : []),
    [events, timelineIdx, time.from, time.to],
  );
  const overview = useMemo(
    () => (events && extent ? histogram(events, timelineIdx, extent[0], Math.max(extent[1], Date.now()), 180) : []),
    [events, timelineIdx, extent],
  );

  const sources = dataset?.sources ?? [];
  const lastSync = sources.reduce<string | null>((a, s) => (s.lastSync && (!a || s.lastSync > a) ? s.lastSync : a), null);
  const stale = sources.filter((s) => s.status === 'degraded' || s.status === 'unavailable').length;

  return (
    <footer className="flex h-[112px] shrink-0 border-t border-line bg-bg-2" aria-label="Live activity timeline">
      <div className="flex w-[256px] shrink-0 flex-col justify-between border-r border-line px-3 py-2.5">
        <div className="flex items-center justify-between">
          {live ? (
            <span className="flex items-center gap-2 text-xs font-medium text-ink" title="The window rolls forward with the clock; data refreshes automatically">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sev-low opacity-50 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-sev-low" />
              </span>
              LIVE
            </span>
          ) : (
            <Button variant="default" onClick={() => setTimePreset('24h', Date.now())} title="Return to a rolling window that follows the clock">
              <Radio size={12} /> Back to live
            </Button>
          )}
          <UtcClock />
        </div>
        <div className="text-2xs leading-4">
          <div className="text-ink-3">{live ? 'Rolling window' : 'Pinned range'}</div>
          <div className="mono text-ink">{fmtUtc(time.from)}</div>
          <div className="mono text-ink-3">→ {live ? 'now' : fmtUtc(time.to)}</div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col px-3 pb-1.5 pt-2">
        <div className="flex items-center justify-between gap-3 whitespace-nowrap pb-1 text-2xs">
          <span className="label-caps">
            Activity · <span className="tabular normal-case tracking-normal text-ink-2">{fmtInt(visibleCount)} in view</span>
          </span>
          <span className="hidden truncate text-ink-3 xl:inline">Drag across the lower strip to pin a range</span>
        </div>
        <div className="min-h-0 flex-1">
          <TimeHistogram buckets={detail} height={56} cursor={live ? Date.now() : null} />
        </div>
        <div className="h-[18px]">
          <TimeHistogram buckets={overview} height={18} showAxis={false} highlight={[time.from, time.to]} onBrush={(a, b) => setCustomRange(a, b)} />
        </div>
      </div>

      <div className="flex w-[256px] shrink-0 flex-col justify-between border-l border-line px-3 py-2.5">
        <Segmented
          size="xs"
          label="Rolling window"
          value={time.preset}
          onChange={(p) => p !== 'custom' && setTimePreset(p, Date.now())}
          options={[
            { value: '1h', label: '1h' },
            { value: '24h', label: '24h' },
            { value: '7d', label: '7d' },
            { value: '30d', label: '30d' },
            { value: 'custom', label: 'Pinned', title: 'Drag across the lower strip, or set dates in the left panel' },
          ]}
        />
        <div className="text-2xs leading-4">
          <div className="text-ink-3">Data freshness</div>
          {dataset?.mode === 'demo' ? (
            <div className="flex items-center gap-1.5 text-demo">
              <FlaskConical size={11} /> Synthetic dataset · not live
            </div>
          ) : (
            <div className={cx('text-ink', stale > 0 && 'text-sev-medium')}>
              Sources synced {fmtRelative(lastSync)}
              {stale ? ` · ${stale} degraded` : ''}
            </div>
          )}
          <div className="text-ink-3">Checked {fmtRelative(lastRefresh)} · auto-refresh on</div>
        </div>
      </div>
    </footer>
  );
}
