import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { HIST_YEARS, LIVE_FEED_BY_ID, LIVE_FEEDS, LIVE_GROUPS } from '@/live/feeds';
import { useLiveStore } from '@/live/liveStore';
import { livePosition } from '@/components/globe/LiveLayers';
import { useGlobeStore } from '@/state/globeStore';
import { fmtRelative } from '@/lib/format';
import { cx, EmptyState, Field, SectionTitle } from '@/components/common/ui';
import type { LiveShape } from '@/live/types';

/** Re-render every few seconds so "updated 12s ago" stays truthful. */
export function useTicker(ms = 5000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function ShapeSwatch({ shape, color }: { shape: LiveShape; color: string }) {
  const common = { fill: shape === 'ring' || shape === 'line' ? 'none' : color, stroke: color, strokeWidth: 1.6 };
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0">
      {shape === 'ring' && <circle cx="6" cy="6" r="4" {...common} />}
      {shape === 'dot' && <circle cx="6" cy="6" r="3.5" {...common} />}
      {shape === 'sat' && <circle cx="6" cy="6" r="2.6" {...common} />}
      {shape === 'diamond' && <path d="M6 1.5 L10.5 6 L6 10.5 L1.5 6 Z" {...common} />}
      {shape === 'plane' && <path d="M6 1 L9.5 10 L6 8 L2.5 10 Z" {...common} />}
      {shape === 'ship' && <path d="M6 1 L8.5 4.5 L8.5 11 L3.5 11 L3.5 4.5 Z" {...common} />}
      {shape === 'line' && <path d="M1 8 Q6 2 11 6" {...common} />}
    </svg>
  );
}

function statusOf(id: string) {
  const s = useLiveStore.getState().feeds[id];
  return s;
}

/** Left-panel section: toggle live layers, with per-feed health and freshness. */
export function LiveLayersSection() {
  const enabled = useLiveStore((s) => s.enabled);
  const feeds = useLiveStore((s) => s.feeds);
  const toggle = useLiveStore((s) => s.toggle);
  const histYear = useLiveStore((s) => s.histYear);
  const setHistYear = useLiveStore((s) => s.setHistYear);
  useTicker();
  return (
    <div className="flex flex-col gap-2">
      {LIVE_GROUPS.map((g) => {
        const defs = LIVE_FEEDS.filter((f) => f.group === g && !f.mapless);
        if (!defs.length) return null;
        return (
          <div key={g}>
            <div className="mb-0.5 px-1 text-2xs uppercase tracking-[0.06em] text-ink-3">{g}</div>
            {defs.map((f) => {
              const st = feeds[f.id];
              const on = enabled.has(f.id);
              const n = (st?.data?.entities.length ?? 0) + (st?.data?.lines?.length ?? 0);
              const dot = !on ? '#9AA3AD' : st?.status === 'ok' ? '#528270' : st?.status === 'error' ? '#AC4A44' : '#A68A3A';
              return (
                <div key={f.id}>
                <label
                  className="flex h-[26px] cursor-pointer items-center gap-2 rounded-xs px-1 text-sm hover:bg-elevated/60"
                  title={`${f.description}\nSource: ${f.attribution.name} (${f.attribution.license})${st?.error ? `\nLast error: ${st.error}` : ''}`}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(f.id)} className="h-3 w-3 accent-accent" />
                  <ShapeSwatch shape={f.shape} color={f.color} />
                  <span className={cx('min-w-0 flex-1 truncate', on ? 'text-ink-2' : 'text-ink-3')}>{f.name}</span>
                  {on && (
                    <span className="tabular flex items-center gap-1.5 text-2xs text-ink-3">
                      {st?.status === 'ok' && n > 0 && n.toLocaleString()}
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
                    </span>
                  )}
                </label>
                {f.id === 'history' && on && (
                  <select
                    aria-label="Historical period"
                    value={histYear}
                    onChange={(e) => setHistYear(e.target.value)}
                    className="mb-1 ml-6 h-7 w-[calc(100%-1.5rem)] rounded-xs border border-line bg-bg-2 px-2 text-sm"
                  >
                    {HIST_YEARS.map((y) => (
                      <option key={y.key} value={y.key}>
                        {y.label}
                      </option>
                    ))}
                  </select>
                )}
                </div>
              );
            })}
          </div>
        );
      })}
      <p className="px-1 text-2xs leading-4 text-ink-3">
        Live feeds refresh on their own while this page is open. Flights, ships, conflict and cables are republished every 15 minutes by the scheduled job.
      </p>
    </div>
  );
}

/** Global threat level badge (SANS ISC InfoCon). */
export function InfoconBadge() {
  const st = useLiveStore((s) => s.feeds.infocon);
  const on = useLiveStore((s) => s.enabled.has('infocon'));
  if (!on || !st?.data?.meta?.status) return null;
  const level = st.data.meta.status.toLowerCase();
  const color = { green: '#528270', yellow: '#A68A3A', orange: '#B37036', red: '#AC4A44' }[level] ?? '#7A8592';
  return (
    <a
      href="https://isc.sans.edu/infocon.html"
      target="_blank"
      rel="noopener noreferrer"
      className="hidden h-7 items-center gap-1.5 whitespace-nowrap rounded-sm border border-line px-2 text-xs text-ink-2 hover:text-ink lg:flex"
      title="SANS Internet Storm Center global threat level (InfoCon), checked every 5 minutes"
    >
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      InfoCon <span className="font-medium capitalize text-ink">{level}</span>
    </a>
  );
}

/** Right-panel detail view for a live entity. */
export function LiveEntityView({ feed, id }: { feed: string; id: string }) {
  const def = LIVE_FEED_BY_ID[feed];
  const st = useLiveStore((s) => s.feeds[feed]);
  useTicker(1000);
  const entity = st?.data?.entities.find((e) => e.id === id);
  const line = st?.data?.lines?.find((l) => l.id === id);
  if (!def || (!entity && !line)) {
    return <EmptyState title="No longer in the live feed">This object dropped out of the latest update (for example, an aircraft that landed).</EmptyState>;
  }
  const pos = entity ? livePosition(entity, Date.now()) : null;
  const props = entity?.props ?? line?.props ?? [];
  const isAircraft = def.shape === 'plane' && !!entity;
  return (
    <div className="flex flex-col gap-5">
      {isAircraft && entity && <FlightRoute callsign={entity.label} at={pos ? [pos.lng, pos.lat] : undefined} />}
      <header>
        <p className="label-caps flex items-center gap-1.5">
          <ShapeSwatch shape={def.shape} color={entity?.color ?? def.color} /> {def.name}
        </p>
        <h2 className="mt-1 text-[17px] font-semibold leading-6 text-ink">{entity?.label ?? line?.label}</h2>
        {entity?.sub && <p className="text-xs text-ink-3">{entity.sub}</p>}
      </header>
      {pos && (
        <section>
          <SectionTitle>Position · live</SectionTitle>
          <dl>
            <Field label="Latitude" mono>
              {pos.lat.toFixed(3)}°
            </Field>
            <Field label="Longitude" mono>
              {pos.lng.toFixed(3)}°
            </Field>
            {pos.altKm > 0.5 && (
              <Field label="Altitude" mono>
                {pos.altKm >= 100 ? `${Math.round(pos.altKm).toLocaleString()} km` : `${pos.altKm.toFixed(1)} km`}
              </Field>
            )}
          </dl>
          <button
            type="button"
            className="mt-2 text-xs text-accent hover:underline"
            onClick={() => useGlobeStore.getState().flyTo(pos.lng, pos.lat, entity?.satrec && pos.altKm > 2000 ? 4.5 : 2.4)}
          >
            Fly to current position
          </button>
        </section>
      )}
      <section>
        <SectionTitle>Details</SectionTitle>
        <dl>
          {props.map(([k, v]) => (
            <Field key={k} label={k}>
              {v}
            </Field>
          ))}
        </dl>
        {def.caveat && <p className="mt-2 text-xs text-ink-3">{def.caveat}</p>}
        {entity?.url && (
          <a href={entity.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline">
            Open at source <ExternalLink size={11} />
          </a>
        )}
      </section>
      <section className="border-t border-line pt-3 text-xs text-ink-3">
        <SectionTitle>Source</SectionTitle>
        <p>
          <a href={def.attribution.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {def.attribution.name}
          </a>{' '}
          · {def.attribution.license}
        </p>
        <p className="mt-1">
          {def.transport === 'browser' ? 'Fetched live from the provider' : 'Published by the scheduled job'} · updated{' '}
          {fmtRelative(statusOf(feed)?.updatedAt ?? null)}
        </p>
      </section>
    </div>
  );
}

interface AdsbdbRoute {
  response?: {
    flightroute?: {
      callsign: string;
      airline?: { name: string } | null;
      origin: { iata_code: string; icao_code: string; name: string; municipality: string; country_name: string; latitude: number; longitude: number };
      destination: { iata_code: string; icao_code: string; name: string; municipality: string; country_name: string; latitude: number; longitude: number };
    };
  };
}

/** Looks up and draws the scheduled route for a flight's callsign (adsbdb, keyless, CORS). */
function FlightRoute({ callsign, at }: { callsign: string; at?: [number, number] }) {
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'none'; route?: NonNullable<NonNullable<AdsbdbRoute['response']>['flightroute']> }>({ status: 'loading' });
  useEffect(() => {
    const cs = callsign.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,8}$/.test(cs)) {
      setState({ status: 'none' });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<AdsbdbRoute>) : null))
      .then((d) => {
        const route = d?.response?.flightroute;
        if (!route) return setState({ status: 'none' });
        setState({ status: 'ok', route });
        useLiveStore.getState().setRoute({ from: [route.origin.longitude, route.origin.latitude], to: [route.destination.longitude, route.destination.latitude], at });
      })
      .catch(() => setState({ status: 'none' }));
    return () => {
      ctrl.abort();
      useLiveStore.getState().setRoute(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callsign]);

  if (state.status === 'loading') return <p className="text-xs text-ink-3">Looking up route…</p>;
  if (state.status === 'none' || !state.route) return <p className="text-xs text-ink-3">No published route for this callsign (common for military, private and cargo flights).</p>;
  const r = state.route;
  const ap = (a: typeof r.origin) => `${a.iata_code || a.icao_code} · ${a.municipality}, ${a.country_name}`;
  return (
    <section className="rounded-xs border border-line bg-bg-2 px-3 py-2.5">
      <SectionTitle>Route{r.airline?.name ? ` · ${r.airline.name}` : ''}</SectionTitle>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
        <div className="min-w-0">
          <div className="mono text-[15px] font-medium text-ink">{r.origin.iata_code || r.origin.icao_code}</div>
          <div className="truncate text-2xs text-ink-3" title={ap(r.origin)}>{r.origin.municipality}</div>
        </div>
        <span className="text-ink-3">→</span>
        <div className="min-w-0 text-right">
          <div className="mono text-[15px] font-medium text-ink">{r.destination.iata_code || r.destination.icao_code}</div>
          <div className="truncate text-2xs text-ink-3" title={ap(r.destination)}>{r.destination.municipality}</div>
        </div>
      </div>
      <p className="mt-2 text-2xs text-ink-3">Scheduled route for this callsign from adsbdb (route data © David Taylor & Jim Mason); the dashed arc on the map shows it.</p>
    </section>
  );
}
