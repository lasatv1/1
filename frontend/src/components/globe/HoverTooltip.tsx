import { useEffect, useRef } from 'react';
import { useGlobeStore, pointer } from '@/state/globeStore';
import { useDataStore } from '@/state/dataStore';
import { useDerivedStore } from '@/state/derivedStore';
import { CATEGORY_LABEL } from '@/lib/layers';
import { fmtInt, fmtUtc } from '@/lib/format';
import { SeverityBadge, BASIS_LABEL } from '@/components/common/ui';
import { useLiveStore } from '@/live/liveStore';
import { LIVE_FEED_BY_ID } from '@/live/feeds';
import { livePosition } from './LiveLayers';

/** Follows the pointer via rAF (no React re-render per mouse move). */
export function HoverTooltip() {
  const country = useGlobeStore((s) => s.hoveredCountry);
  const connection = useGlobeStore((s) => s.hoveredConnection);
  const live = useLiveStore((s) => s.hovered);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      const host = document.getElementById('globe-viewport');
      if (el && host) {
        const r = host.getBoundingClientRect();
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        let x = pointer.x - r.left + 14;
        let y = pointer.y - r.top + 14;
        if (x + w > r.width - 8) x = pointer.x - r.left - w - 14;
        if (y + h > r.height - 8) y = pointer.y - r.top - h - 14;
        el.style.transform = `translate(${x}px, ${y}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    if (country || connection || live) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [country, connection, live]);

  if (!country && !connection && !live) return null;
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none absolute left-0 top-0 z-20 min-w-[200px] max-w-[300px] rounded-sm border border-line-strong bg-elevated/95 px-3 py-2 shadow-[0_4px_16px_rgba(40,48,58,0.14)]"
    >
      {live ? <LiveTip feed={live.feed} id={live.id} /> : connection ? <ConnectionTip id={connection} /> : country ? <CountryTip id={country} /> : null}
    </div>
  );
}

function CountryTip({ id }: { id: string }) {
  const c = useDataStore((s) => s.geo?.byId.get(id));
  const st = useDerivedStore((s) => s.stats.get(id));
  if (!c) return null;
  return (
    <div className="text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-ink">{c.name}</span>
        <span className="mono text-2xs text-ink-3">{c.iso2 ?? c.adm0}</span>
      </div>
      <div className="text-2xs text-ink-3">{c.subregion}</div>
      {st && st.total > 0 ? (
        <dl className="mt-1.5 grid grid-cols-3 gap-x-3 text-2xs">
          <dt className="text-ink-3">Observations</dt>
          <dt className="text-ink-3">Incoming</dt>
          <dt className="text-ink-3">Outgoing</dt>
          <dd className="tabular text-xs text-ink">{fmtInt(st.total)}</dd>
          <dd className="tabular text-xs text-ink">{fmtInt(st.incoming)}</dd>
          <dd className="tabular text-xs text-ink">{fmtInt(st.outgoing)}</dd>
        </dl>
      ) : (
        <div className="mt-1.5 text-2xs text-ink-3">No observations match the current filters.</div>
      )}
      {st?.maxSeverity && (
        <div className="mt-1.5 flex items-center gap-2 text-2xs text-ink-3">
          Highest severity <SeverityBadge severity={st.maxSeverity} />
        </div>
      )}
      <div className="mt-1.5 text-2xs text-ink-3">Click to open profile · Shift-click to compare</div>
    </div>
  );
}

function ConnectionTip({ id }: { id: string }) {
  const c = useDerivedStore((s) => s.connectionsById.get(id));
  const geo = useDataStore((s) => s.geo);
  const sources = useDataStore((s) => s.dataset?.sources);
  if (!c) return null;
  const name = (cid: string) => geo?.byId.get(cid)?.name ?? cid;
  return (
    <div className="text-sm">
      <div className="font-medium text-ink">
        {name(c.src)} <span className="text-ink-3">→</span> {name(c.dst)}
      </div>
      <dl className="mt-1.5 grid grid-cols-[84px_1fr] gap-y-0.5 text-2xs">
        <dt className="text-ink-3">Category</dt>
        <dd className="text-ink">{CATEGORY_LABEL[c.category]}</dd>
        <dt className="text-ink-3">Severity</dt>
        <dd>
          <SeverityBadge severity={c.severity} long />
        </dd>
        <dt className="text-ink-3">Events</dt>
        <dd className="tabular text-ink">{fmtInt(c.count)}</dd>
        <dt className="text-ink-3">Observed</dt>
        <dd className="mono text-ink">
          {fmtUtc(c.firstSeen)} – {fmtUtc(c.lastSeen)}
        </dd>
        <dt className="text-ink-3">Source</dt>
        <dd className="text-ink">{c.sources.map((s) => sources?.find((x) => x.id === s)?.name ?? s).join(', ')}</dd>
        <dt className="text-ink-3">Basis</dt>
        <dd className="text-ink">{c.bases.map((b) => BASIS_LABEL[b]).join(', ')}</dd>
      </dl>
      <div className="mt-1.5 text-2xs text-ink-3">Click to investigate</div>
    </div>
  );
}

function LiveTip({ feed, id }: { feed: string; id: string }) {
  const def = LIVE_FEED_BY_ID[feed];
  const entity = useLiveStore((s) => s.feeds[feed]?.data?.entities.find((e) => e.id === id));
  const line = useLiveStore((s) => s.feeds[feed]?.data?.lines?.find((l) => l.id === id));
  if (!def || (!entity && !line)) return null;
  const pos = entity ? livePosition(entity, Date.now()) : null;
  return (
    <div className="text-sm">
      <div className="text-2xs uppercase tracking-[0.06em] text-ink-3">{def.name}</div>
      <div className="font-medium text-ink">{entity?.label ?? line?.label}</div>
      {entity?.sub && <div className="text-2xs text-ink-3">{entity.sub}</div>}
      {entity && (
        <dl className="mt-1.5 grid grid-cols-[96px_1fr] gap-y-0.5 text-2xs">
          {entity.props.slice(0, 4).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{k}</dt>
              <dd className="truncate text-ink">{v}</dd>
            </div>
          ))}
          {pos && pos.altKm > 100 && (
            <>
              <dt className="text-ink-3">Altitude now</dt>
              <dd className="tabular text-ink">{Math.round(pos.altKm).toLocaleString()} km</dd>
            </>
          )}
        </dl>
      )}
      {def.caveat && <div className="mt-1.5 text-2xs text-ink-3">{def.caveat}</div>}
      {entity && <div className="mt-1.5 text-2xs text-ink-3">Click for details</div>}
    </div>
  );
}
