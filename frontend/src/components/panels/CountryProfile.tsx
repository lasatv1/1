import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, BookmarkPlus, ChevronDown, GitCompare } from 'lucide-react';
import { useDataStore } from '@/state/dataStore';
import { useDerivedStore } from '@/state/derivedStore';
import { useAppStore } from '@/state/appStore';
import { activityLevel, emptyStats, histogram, topCounterparts } from '@/lib/data/aggregate';
import { CATEGORY_LABEL } from '@/lib/layers';
import { fetchCountryNetwork } from '@/lib/data/apiClient';
import { fmtInt, fmtUtcDate } from '@/lib/format';
import { BarList, SeverityBar, SplitBar, TimeHistogram } from '@/components/charts/charts';
import { Button, EmptyState, Field, SectionTitle, SeverityBadge, cx } from '@/components/common/ui';
import { EventList } from './EventList';
import type { CountryNetworkFacts, ThreatCategory } from '@/types/intel';

const LEVEL_LABEL = { none: 'No observations', low: 'Low', moderate: 'Moderate', elevated: 'Elevated', high: 'High' } as const;

/** Intelligence-profile rows: category → what the row represents. Only rows with data are shown. */
const INTEL_ROWS: Array<{ cat: ThreatCategory; label: string }> = [
  { cat: 'malware', label: 'Reported malware activity' },
  { cat: 'phishing', label: 'Phishing infrastructure' },
  { cat: 'ransomware', label: 'Ransomware observations' },
  { cat: 'breach', label: 'Reported data breaches' },
  { cat: 'botnet', label: 'Botnet-related infrastructure' },
  { cat: 'c2', label: 'Known C2 infrastructure' },
  { cat: 'vulnerability', label: 'Vulnerability-related observations' },
  { cat: 'scanning', label: 'Scanning / probing traffic' },
];

export function CountryProfile({ id }: { id: string }) {
  const geo = useDataStore((s) => s.geo);
  const dataset = useDataStore((s) => s.dataset);
  const country = geo?.byId.get(id);
  const stats = useDerivedStore((s) => s.stats.get(id)) ?? emptyStats(id);
  const maxTotal = useDerivedStore((s) => s.maxCountryTotal);
  const baseIdx = useDerivedStore((s) => s.baseIdx);
  const win = useDerivedStore((s) => s.window);
  const setDirection = useAppStore((s) => s.setDirection);
  const direction = useAppStore((s) => s.direction);
  const selectCountry = useAppStore((s) => s.selectCountry);
  const save = useAppStore((s) => s.saveInvestigation);
  const [expanded, setExpanded] = useState(false);

  const events = dataset?.events ?? [];
  const countryIdx = useMemo(
    () => baseIdx.filter((i) => events[i]!.srcCountry === id || events[i]!.dstCountry === id),
    [baseIdx, events, id],
  );
  const buckets = useMemo(() => histogram(events, countryIdx, win[0], win[1], 48), [events, countryIdx, win]);
  const topSources = useMemo(() => topCounterparts(events, countryIdx, id, 'sources'), [events, countryIdx, id]);
  const topDest = useMemo(() => topCounterparts(events, countryIdx, id, 'destinations'), [events, countryIdx, id]);
  const maliciousIps = useMemo(() => {
    const set = new Set<string>();
    for (const i of countryIdx) {
      const e = events[i]!;
      if (e.srcCountry === id && e.srcIp) set.add(e.srcIp);
    }
    return set.size;
  }, [countryIdx, events, id]);
  const claims = useMemo(() => countryIdx.filter((i) => events[i]!.basis === 'attribution_claim').length, [countryIdx, events]);
  const sourcesUsed = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of countryIdx) m.set(events[i]!.sourceId, (m.get(events[i]!.sourceId) ?? 0) + 1);
    return [...m.entries()];
  }, [countryIdx, events]);

  // Previous equal-length period, for the historical comparison.
  const prevCount = useMemo(() => {
    const len = win[1] - win[0];
    let n = 0;
    for (const e of events) {
      if (e.t >= win[0] - len && e.t < win[0] && (e.srcCountry === id || e.dstCountry === id)) n++;
    }
    return n;
  }, [events, win, id]);

  // Per-country lookups need the API; a static snapshot only has what was exported.
  const network = useNetworkFacts(id, country?.iso2 ?? null, dataset?.origin === 'api' ? 'live' : dataset?.mode === 'demo' ? 'demo' : undefined, dataset?.network[id]);
  if (!country) return <EmptyState title="Unknown country">No boundary record for “{id}”.</EmptyState>;
  const level = activityLevel(stats.total, maxTotal);
  const name = (cid: string) => geo?.byId.get(cid)?.name ?? cid;
  const withData = INTEL_ROWS.filter((r) => (stats.byCategory[r.cat] ?? 0) > 0);
  const without = INTEL_ROWS.filter((r) => !(stats.byCategory[r.cat] ?? 0));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold leading-6 text-ink">{country.name}</h2>
            <p className="text-xs text-ink-3">
              {country.subregion} · {country.region}
              {country.type !== 'Sovereign country' && country.type !== 'Country' ? ` · ${country.type} (${country.sovereign})` : ''}
            </p>
          </div>
          <div className="mono flex gap-1 text-2xs">
            {country.iso2 && <span className="rounded-xs border border-line-strong px-1.5 py-0.5 text-ink-2">{country.iso2}</span>}
            {country.iso3 && <span className="rounded-xs border border-line-strong px-1.5 py-0.5 text-ink-2">{country.iso3}</span>}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-px overflow-hidden rounded-xs border border-line bg-line">
          {[
            { l: 'Total', v: stats.total, t: 'All observations involving this country' },
            { l: 'Incoming', v: stats.incoming, t: 'Country is the destination side' },
            { l: 'Outgoing', v: stats.outgoing, t: 'Country is the source side' },
            { l: 'Located', v: stats.hosted, t: 'Infrastructure located here with no counterpart country' },
          ].map((k) => (
            <div key={k.l} className="flex h-[52px] min-w-0 flex-col justify-center bg-panel px-2" title={k.t}>
              <div className="label-caps truncate !tracking-normal">{k.l}</div>
              <div className="tabular truncate text-[16px] font-medium leading-6 text-ink">{fmtInt(k.v)}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs" title="Relative to the busiest country in the current view">
          <span className="text-ink-3">
            Activity level <span className={cx('ml-1 font-medium', level === 'high' || level === 'elevated' ? 'text-ink' : 'text-ink-2')}>{LEVEL_LABEL[level]}</span>
          </span>
          {stats.maxSeverity && (
            <span className="flex items-center gap-1.5 text-ink-3">
              Highest <SeverityBadge severity={stats.maxSeverity} />
            </span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <Button onClick={() => setDirection(direction === 'incoming' ? 'all' : 'incoming')} className={direction === 'incoming' ? 'bg-elevated' : ''} aria-pressed={direction === 'incoming'}>
            <ArrowDownLeft size={12} /> In
          </Button>
          <Button onClick={() => setDirection(direction === 'outgoing' ? 'all' : 'outgoing')} className={direction === 'outgoing' ? 'bg-elevated' : ''} aria-pressed={direction === 'outgoing'}>
            <ArrowUpRight size={12} /> Out
          </Button>
          <Button title="Add another country to compare (or Shift-click on the map)" onClick={() => document.dispatchEvent(new CustomEvent('cta:open-search', { detail: 'compare' }))}>
            <GitCompare size={12} /> Compare
          </Button>
          <Button
            onClick={() =>
              save({ title: `Country profile — ${country.name}`, description: `${fmtInt(stats.total)} observations in view`, target: { kind: 'country', id }, datasetMode: dataset?.mode ?? 'demo' })
            }
          >
            <BookmarkPlus size={12} /> Save
          </Button>
        </div>
      </header>

      <section>
        <SectionTitle>Country overview</SectionTitle>
        <dl>
          <Field label="Capital">{country.capital ?? <span className="text-ink-3">Not recorded</span>}</Field>
          <Field label="Population">
            {country.population ? (
              <>
                {fmtInt(country.population)} <span className="text-xs text-ink-3">est. {country.populationYear} · Natural Earth</span>
              </>
            ) : (
              <span className="text-ink-3">Not available</span>
            )}
          </Field>
          <Field label="Internet use">
            <span className="text-ink-3">Not available from configured sources</span>
          </Field>
          <Field label="Networks (ASN)">
            {network.state === 'ready' && network.facts ? (
              <span>
                <span className="tabular">{fmtInt(network.facts.asnCount)}</span> ASNs ·{' '}
                <span className="tabular">{fmtInt(network.facts.ipv4Prefixes)}</span> IPv4 prefixes
                <span className={cx('ml-1 text-xs', network.facts.isDemo ? 'text-demo' : 'text-ink-3')}>
                  {network.facts.isDemo ? 'synthetic' : network.facts.source}
                </span>
              </span>
            ) : network.state === 'loading' ? (
              <span className="text-ink-3">Querying backend…</span>
            ) : (
              <span className="text-ink-3">{network.error ?? 'Not available'}</span>
            )}
          </Field>
          {country.note && <Field label="Note">{country.note}</Field>}
        </dl>
      </section>

      <section>
        <SectionTitle>Cybersecurity intelligence</SectionTitle>
        {stats.total === 0 ? (
          <EmptyState title="No observations in view">No source reported activity involving {country.name} for the current filters and observation period.</EmptyState>
        ) : (
          <>
            <dl>
              <Field label="Malicious IPs">
                <span className="tabular">{fmtInt(maliciousIps)}</span> <span className="text-xs text-ink-3">unique addresses geolocated here</span>
              </Field>
              {withData.map((r) => (
                <Field key={r.cat} label={CATEGORY_LABEL[r.cat]}>
                  <span className="tabular">{fmtInt(stats.byCategory[r.cat])}</span> <span className="text-xs text-ink-3">{r.label.toLowerCase()}</span>
                </Field>
              ))}
              {claims > 0 && (
                <Field label="Actor claims">
                  <span className="tabular">{fmtInt(claims)}</span> <span className="text-xs text-ink-3">third-party attribution claims (unverified)</span>
                </Field>
              )}
            </dl>
            {without.length > 0 && (
              <p className="mt-1.5 text-2xs text-ink-3">No supporting observations for: {without.map((r) => CATEGORY_LABEL[r.cat]).join(', ')}.</p>
            )}
          </>
        )}
      </section>

      {stats.total > 0 && (
        <>
          <section>
            <SectionTitle right={<span className="mono text-2xs text-ink-3">{fmtUtcDate(win[0])} → {fmtUtcDate(win[1])}</span>}>Activity over time</SectionTitle>
            <div className="h-[84px]">
              <TimeHistogram buckets={buckets} height={84} />
            </div>
            <p className="mt-1.5 text-xs text-ink-3">
              Previous equal period: <span className="tabular text-ink-2">{fmtInt(prevCount)}</span> observations
              {prevCount > 0 && (
                <span className="text-ink-2"> ({stats.total >= prevCount ? '+' : ''}{Math.round(((stats.total - prevCount) / prevCount) * 100)}%)</span>
              )}
              .
            </p>
          </section>

          <section>
            <SectionTitle>Severity</SectionTitle>
            <SeverityBar counts={stats.bySeverity} />
          </section>

          <section>
            <SectionTitle>Incoming vs outgoing</SectionTitle>
            <SplitBar a={stats.incoming} b={stats.outgoing} c={stats.hosted} aLabel="Incoming" bLabel="Outgoing" cLabel="Located only" />
          </section>

          <section className="grid grid-cols-2 gap-4">
            <div>
              <SectionTitle>Top source countries</SectionTitle>
              <BarList items={topSources.map((t) => ({ key: t.id, label: name(t.id), value: t.count, onClick: () => selectCountry(t.id) }))} empty="None" />
            </div>
            <div>
              <SectionTitle>Top destinations</SectionTitle>
              <BarList items={topDest.map((t) => ({ key: t.id, label: name(t.id), value: t.count, onClick: () => selectCountry(t.id) }))} empty="None" />
            </div>
          </section>

          <section>
            <SectionTitle>Threat categories</SectionTitle>
            <BarList
              items={(Object.entries(stats.byCategory) as Array<[ThreatCategory, number]>)
                .sort((a, b) => b[1] - a[1])
                .map(([c, v]) => ({ key: c, label: CATEGORY_LABEL[c], value: v }))}
            />
          </section>

          <section>
            <button type="button" onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between" aria-expanded={expanded}>
              <h3 className="label-caps">Detailed view · {fmtInt(countryIdx.length)} events</h3>
              <ChevronDown size={13} className={cx('text-ink-3 transition-transform', expanded && 'rotate-180')} />
            </button>
            {expanded && (
              <div className="mt-2">
                <EventList idx={countryIdx} height={320} />
              </div>
            )}
          </section>
        </>
      )}

      <section className="border-t border-line pt-3">
        <SectionTitle>Provenance</SectionTitle>
        <ul className="text-xs text-ink-3">
          <li>Boundaries &amp; population: {geo?.source}</li>
          {sourcesUsed.map(([sid, n]) => (
            <li key={sid}>
              {dataset?.sources.find((s) => s.id === sid)?.name ?? sid}: <span className="tabular text-ink-2">{fmtInt(n)}</span> observations
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function useNetworkFacts(id: string, iso2: string | null, mode: 'demo' | 'live' | undefined, cached: CountryNetworkFacts | undefined) {
  const [state, setState] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; facts?: CountryNetworkFacts; error?: string }>({ state: 'idle' });
  useEffect(() => {
    if (cached) {
      setState({ state: 'ready', facts: cached });
      return;
    }
    if (mode !== 'live' || !iso2) {
      setState({ state: 'error', error: 'Not available from configured sources' });
      return;
    }
    const ctrl = new AbortController();
    setState({ state: 'loading' });
    fetchCountryNetwork(iso2, ctrl.signal)
      .then((facts) => setState({ state: 'ready', facts }))
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setState({ state: 'error', error: 'Network registry source unavailable' });
      });
    return () => ctrl.abort();
  }, [id, iso2, mode, cached]);
  return state;
}
