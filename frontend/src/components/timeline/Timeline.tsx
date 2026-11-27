import { useEffect, useMemo, useRef } from 'react';
import { Pause, Play, SkipBack, FlaskConical } from 'lucide-react';
import { useAppStore } from '@/state/appStore';
import { useDerivedStore } from '@/state/derivedStore';
import { useDataStore } from '@/state/dataStore';
import { histogram } from '@/lib/data/aggregate';
import { TimeHistogram } from '@/components/charts/charts';
import { fmtDuration, fmtInt, fmtRelative, fmtUtc } from '@/lib/format';
import { cx, IconButton, Segmented } from '@/components/common/ui';

/** Seconds to play through the full observation period at 1×. */
const BASE_PLAY_SECONDS = 60;
const SPEEDS = [0.5, 1, 2, 4, 8];

export function Timeline() {
  const time = useAppStore((s) => s.time);
  const playback = useAppStore((s) => s.playback);
  const setPlayback = useAppStore((s) => s.setPlayback);
  const setCustomRange = useAppStore((s) => s.setCustomRange);
  const setTimePreset = useAppStore((s) => s.setTimePreset);
  const timelineIdx = useDerivedStore((s) => s.timelineIdx);
  const visibleCount = useDerivedStore((s) => s.totals.events);
  const dataset = useDataStore((s) => s.dataset);
  const events = dataset?.events;
  const extent = dataset?.extent;

  const detail = useMemo(
    () => (events ? histogram(events, timelineIdx, time.from, time.to, time.to - time.from <= 3_600_000 ? 60 : 120) : []),
    [events, timelineIdx, time.from, time.to],
  );
  const overview = useMemo(
    () => (events && extent ? histogram(events, timelineIdx, extent[0], extent[1], 180) : []),
    [events, timelineIdx, extent],
  );

  // Playback loop: advances the cursor through the window using real event timestamps.
  const last = useRef(0);
  const cursorRef = useRef<number | null>(null);
  cursorRef.current = playback.cursor;
  useEffect(() => {
    if (!playback.playing) return;
    let raf = 0;
    let acc = 0;
    last.current = performance.now();
    let cur = cursorRef.current ?? time.from;
    const span = time.to - time.from;
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      cur += (span / BASE_PLAY_SECONDS) * playback.speed * dt;
      acc += dt;
      if (cur >= time.to) {
        setPlayback({ playing: false, cursor: null });
        return;
      }
      // Publish at ~12 Hz: enough for smooth arcs/counters without re-rendering every frame.
      if (acc > 0.08) {
        acc = 0;
        setPlayback({ cursor: cur });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playback.playing, playback.speed, time.from, time.to, setPlayback]);

  const togglePlay = () => {
    if (playback.playing) setPlayback({ playing: false });
    else setPlayback({ playing: true, cursor: playback.cursor ?? time.from });
  };

  const sources = dataset?.sources ?? [];
  const lastSync = sources.reduce<string | null>((a, s) => (s.lastSync && (!a || s.lastSync > a) ? s.lastSync : a), null);
  const stale = sources.filter((s) => s.status === 'degraded' || s.status === 'unavailable').length;

  return (
    <footer className="flex h-[112px] shrink-0 border-t border-line bg-bg-2" aria-label="Global activity timeline">
      <div className="flex w-[256px] shrink-0 flex-col justify-between border-r border-line px-3 py-2.5">
        <div className="flex items-center gap-1">
          <IconButton label={playback.playing ? 'Pause playback' : 'Play observation period'} onClick={togglePlay} className="shrink-0 border border-line-strong">
            {playback.playing ? <Pause size={14} /> : <Play size={14} />}
          </IconButton>
          <IconButton label="Return to full period" onClick={() => setPlayback({ playing: false, cursor: null })} disabled={playback.cursor == null}>
            <SkipBack size={13} />
          </IconButton>
          <div className="ml-1 min-w-0 flex-1">
            <Segmented
              size="xs"
              label="Playback speed"
              value={String(playback.speed)}
              onChange={(v) => setPlayback({ speed: Number(v) })}
              options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
            />
          </div>
        </div>
        <div className="text-2xs leading-4">
          <div className="text-ink-3">{playback.cursor != null ? 'Playback position' : 'Observation period'}</div>
          <div className="mono text-ink">{playback.cursor != null ? fmtUtc(playback.cursor) : `${fmtUtc(time.from)}`}</div>
          <div className="mono text-ink-3">
            {playback.cursor != null ? `${fmtDuration(playback.cursor - time.from)} into ${fmtDuration(time.to - time.from)}` : `→ ${fmtUtc(time.to)}`}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col px-3 pb-1.5 pt-2">
        <div className="flex items-center justify-between gap-3 whitespace-nowrap pb-1 text-2xs">
          <span className="label-caps">
            Activity · <span className="tabular normal-case tracking-normal text-ink-2">{fmtInt(visibleCount)} in view</span>
          </span>
          <span className="hidden truncate text-ink-3 xl:inline">Drag the lower strip to set a range · click the chart to scrub</span>
        </div>
        <div className="min-h-0 flex-1">
          <TimeHistogram
            buckets={detail}
            height={56}
            cursor={playback.cursor}
            onScrub={(t) => setPlayback({ cursor: t, playing: false })}
          />
        </div>
        <div className="h-[18px]">
          <TimeHistogram
            buckets={overview}
            height={18}
            showAxis={false}
            highlight={[time.from, time.to]}
            onBrush={(a, b) => setCustomRange(a, b)}
          />
        </div>
      </div>

      <div className="flex w-[256px] shrink-0 flex-col justify-between border-l border-line px-3 py-2.5">
        <Segmented
          size="xs"
          label="Observation period"
          value={time.preset}
          onChange={(p) => p !== 'custom' && setTimePreset(p, extent?.[1] ?? Date.now())}
          options={[
            { value: '1h', label: '1h' },
            { value: '24h', label: '24h' },
            { value: '7d', label: '7d' },
            { value: '30d', label: '30d' },
            { value: 'custom', label: 'Custom', title: 'Drag across the overview strip, or set dates in the left panel' },
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
              Last sync {fmtRelative(lastSync)}
              {stale ? ` · ${stale} source${stale > 1 ? 's' : ''} degraded` : ''}
            </div>
          )}
          <div className="mono text-ink-3">{lastSync ? fmtUtc(lastSync) : '—'}</div>
        </div>
      </div>
    </footer>
  );
}
