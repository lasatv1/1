import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ThreatEvent } from '@/types/intel';
import { useAppStore } from '@/state/appStore';
import { useDataStore } from '@/state/dataStore';
import { CATEGORY_LABEL } from '@/lib/layers';
import { fmtUtc } from '@/lib/format';
import { SeveritySwatch } from '@/components/common/ui';

/** Virtualised event table — handles tens of thousands of rows. Newest first. */
export function EventList({ idx, height = 280, empty = 'No events match.' }: { idx: number[]; height?: number; empty?: string }) {
  const events = useDataStore((s) => s.dataset?.events ?? []);
  const geo = useDataStore((s) => s.geo);
  const open = useAppStore((s) => s.openInspector);
  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: idx.length, getScrollElement: () => parent.current, estimateSize: () => 40, overscan: 8 });

  if (!idx.length) return <p className="text-xs text-ink-3">{empty}</p>;
  const iso = (id: string | null) => (id ? (geo?.byId.get(id)?.iso2 ?? id) : '—');

  return (
    <div ref={parent} className="overflow-y-auto rounded-xs border border-line" style={{ height: Math.min(height, idx.length * 40 + 2) }} role="list" aria-label={`${idx.length} events`}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((row) => {
          const e: ThreatEvent | undefined = events[idx[idx.length - 1 - row.index]!];
          if (!e) return null;
          return (
            <button
              type="button"
              role="listitem"
              key={row.key}
              onClick={() => open({ kind: 'event', id: e.id })}
              className="absolute left-0 top-0 grid h-10 w-full grid-cols-[10px_1fr_auto] items-center gap-x-2 border-b border-line px-2 text-left hover:bg-elevated"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <SeveritySwatch severity={e.severity} />
              <span className="min-w-0">
                <span className="block truncate text-xs text-ink">
                  {CATEGORY_LABEL[e.category]} <span className="text-ink-3">·</span>{' '}
                  <span className="mono text-ink-2">
                    {iso(e.srcCountry)} → {iso(e.dstCountry)}
                  </span>
                </span>
                <span className="mono block truncate text-2xs text-ink-3">
                  {e.id} · {e.srcIp ?? e.indicators[0]?.value ?? '—'}
                </span>
              </span>
              <span className="mono text-2xs text-ink-3">{fmtUtc(e.t)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
