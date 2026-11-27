/** Multi-country comparison, region profile and the default global overview. */
import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useDataStore } from '@/state/dataStore';
import { useDerivedStore } from '@/state/derivedStore';
import { useAppStore } from '@/state/appStore';
import { emptyStats, histogram } from '@/lib/data/aggregate';
import { CATEGORY_LABEL } from '@/lib/layers';
import { fmtInt, fmtRelative } from '@/lib/format';
import { severityOrder, severityLabel, severityColor } from '@/design/tokens';
import { BarList, SeverityBar, TimeHistogram } from '@/components/charts/charts';
import { EmptyState, SectionTitle, SeverityBadge, StatusDot, SOURCE_STATUS_LABEL, Kbd } from '@/components/common/ui';
import { EventList } from './EventList';
import type { CountryStats, Severity, ThreatCategory } from '@/types/intel';

function sumStats(list: CountryStats[], id: string): CountryStats {
  const out = emptyStats(id);
  for (const s of list) {
    out.total += s.total;
    out.incoming += s.incoming;
    out.outgoing += s.outgoing;
    out.hosted += s.hosted;
    for (const k of severityOrder) out.bySeverity[k] += s.bySeverity[k];
    for (const [k, v] of Object.entries(s.byCategory)) out.byCategory[k as ThreatCategory] = (out.byCategory[k as ThreatCategory] ?? 0) + (v ?? 0);
  }
  out.maxSeverity = severityOrder.find((k) => out.bySeverity[k] > 0) ?? null;
  return out;
}

export function ComparisonView() {
  const selected = useAppStore((s) => s.selected);
  const remove = useAppStore((s) => s.removeFromSelection);
  const open = useAppStore((s) => s.openInspector);
  const geo = useDataStore((s) => s.geo);
  const stats = useDerivedStore((s) => s.stats);
  const rows = selected.map((id) => ({ id, name: geo?.byId.get(id)?.name ?? id, s: stats.get(id) ?? emptyStats(id) }));
  const maxTotal = Math.max(1, ...rows.map((r) => r.s.total));
  const cats = [...new Set(rows.flatMap((r) => Object.keys(r.s.byCategory)))] as ThreatCategory[];

  const metric = (label: string, get: (s: CountryStats) => number) => (
    <tr key={label} className="border-b border-line">
      <th scope="row" className="py-1.5 pr-2 text-left text-xs font-normal text-ink-3">
        {label}
      </th>
      {rows.map((r) => (
        <td key={r.id} className="tabular py-1.5 text-right text-sm text-ink">
          {fmtInt(get(r.s))}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="label-caps">Comparison · {rows.length} countries</p>
        <p className="mt-1 text-xs text-ink-3">Shift-click countries on the globe to add or remove them.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <span key={r.id} className="inline-flex h-6 items-center gap-1 rounded-xs border border-line-strong pl-2 pr-1 text-xs text-ink">
              <button type="button" className="hover:underline" onClick={() => open({ kind: 'country', id: r.id })}>
                {r.name}
              </button>
              <button type="button" aria-label={`Remove ${r.name}`} className="text-ink-3 hover:text-ink" onClick={() => remove(r.id)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      </header>
      <section>
        <SectionTitle>Observations</SectionTitle>
        <BarList items={rows.map((r) => ({ key: r.id, label: r.name, value: r.s.total, onClick: () => open({ kind: 'country', id: r.id }) }))} max={maxTotal} />
      </section>
      <section className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line-strong">
              <th className="label-caps py-1 text-left">Metric</th>
              {rows.map((r) => (
                <th key={r.id} className="py-1 pl-2 text-right text-xs font-medium text-ink-2">
                  {geo?.byId.get(r.id)?.iso2 ?? r.id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metric('Total', (s) => s.total)}
            {metric('Incoming', (s) => s.incoming)}
            {metric('Outgoing', (s) => s.outgoing)}
            {metric('Located only', (s) => s.hosted)}
            {severityOrder.map((k) => metric(severityLabel[k], (s) => s.bySeverity[k]))}
            {cats.map((c) => metric(CATEGORY_LABEL[c], (s) => s.byCategory[c] ?? 0))}
            <tr>
              <th scope="row" className="py-1.5 text-left text-xs font-normal text-ink-3">
                Highest
              </th>
              {rows.map((r) => (
                <td key={r.id} className="py-1.5 text-right">
                  {r.s.maxSeverity ? <SeverityBadge severity={r.s.maxSeverity} /> : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function RegionProfile({ id }: { id: string }) {
  const selected = useAppStore((s) => s.selected);
  const open = useAppStore((s) => s.openInspector);
  const geo = useDataStore((s) => s.geo);
  const dataset = useDataStore((s) => s.dataset);
  const stats = useDerivedStore((s) => s.stats);
  const baseIdx = useDerivedStore((s) => s.baseIdx);
  const win = useDerivedStore((s) => s.window);
  const set = useMemo(() => new Set(selected), [selected]);
  const agg = sumStats(selected.map((c) => stats.get(c)).filter(Boolean) as CountryStats[], id);
  const regionIdx = useMemo(
    () => baseIdx.filter((i) => {
      const e = dataset!.events[i]!;
      return (e.srcCountry && set.has(e.srcCountry)) || (e.dstCountry && set.has(e.dstCountry));
    }),
    [baseIdx, dataset, set],
  );
  const buckets = useMemo(() => histogram(dataset?.events ?? [], regionIdx, win[0], win[1], 48), [dataset, regionIdx, win]);
  const ranked = selected
    .map((c) => ({ id: c, total: stats.get(c)?.total ?? 0 }))
    .filter((r) => r.total)
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="label-caps">Region</p>
        <h2 className="mt-1 text-[18px] font-semibold text-ink">{id}</h2>
        <p className="text-xs text-ink-3">{selected.length} countries and territories</p>
      </header>
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xs border border-line bg-line">
        {[
          { l: 'Total', v: agg.total },
          { l: 'Incoming', v: agg.incoming },
          { l: 'Outgoing', v: agg.outgoing },
        ].map((k) => (
          <div key={k.l} className="flex h-[52px] flex-col justify-center bg-panel px-2.5">
            <div className="label-caps truncate">{k.l}</div>
            <div className="tabular truncate text-[16px] font-medium leading-6 text-ink">{fmtInt(k.v)}</div>
          </div>
        ))}
      </div>
      <p className="-mt-3 text-2xs text-ink-3">Totals count intra-region relationships once per country side.</p>
      <section>
        <SectionTitle>Activity over time</SectionTitle>
        <div className="h-[84px]">
          <TimeHistogram buckets={buckets} height={84} />
        </div>
      </section>
      <section>
        <SectionTitle>Severity</SectionTitle>
        <SeverityBar counts={agg.bySeverity} />
      </section>
      <section>
        <SectionTitle>Most active countries</SectionTitle>
        <BarList items={ranked.map((r) => ({ key: r.id, label: geo?.byId.get(r.id)?.name ?? r.id, value: r.total, onClick: () => open({ kind: 'country', id: r.id }) }))} empty="No observations in this region." />
      </section>
    </div>
  );
}

export function GlobalOverview() {
  const geo = useDataStore((s) => s.geo);
  const dataset = useDataStore((s) => s.dataset);
  const stats = useDerivedStore((s) => s.stats);
  const baseIdx = useDerivedStore((s) => s.baseIdx);
  const connections = useDerivedStore((s) => s.connections);
  const selectCountry = useAppStore((s) => s.selectCountry);
  const selectConnection = useAppStore((s) => s.selectConnection);

  const sev = useMemo(() => {
    const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const i of baseIdx) out[dataset!.events[i]!.severity]++;
    return out;
  }, [baseIdx, dataset]);
  const cats = useMemo(() => {
    const m = new Map<ThreatCategory, number>();
    for (const i of baseIdx) {
      const c = dataset!.events[i]!.category;
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [baseIdx, dataset]);
  const top = [...stats.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  const corridors = [...connections].sort((a, b) => b.count - a.count).slice(0, 6);
  const highIdx = useMemo(() => baseIdx.filter((i) => {
    const s = dataset!.events[i]!.severity;
    return s === 'critical' || s === 'high';
  }), [baseIdx, dataset]);
  const name = (id: string) => geo?.byId.get(id)?.name ?? id;

  if (!dataset) return null;
  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="label-caps">Global overview</p>
        <p className="mt-1 text-sm text-ink-2">
          Select a country on the globe for its intelligence profile, or a relationship arc to investigate it. Press <Kbd>/</Kbd> to search.
        </p>
      </header>
      {baseIdx.length === 0 ? (
        <EmptyState title="No observations match">Widen the observation period, re-enable severities, or choose another layer.</EmptyState>
      ) : (
        <>
          <section>
            <SectionTitle>Severity distribution</SectionTitle>
            <SeverityBar counts={sev} />
          </section>
          <section>
            <SectionTitle>Most active countries</SectionTitle>
            <BarList items={top.map((s) => ({ key: s.id, label: name(s.id), value: s.total, onClick: () => selectCountry(s.id) }))} />
          </section>
          <section>
            <SectionTitle>Busiest relationships</SectionTitle>
            <ul className="flex flex-col">
              {corridors.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => selectConnection(c.id)}
                    className="grid w-full grid-cols-[8px_1fr_auto] items-center gap-2 border-b border-line py-1.5 text-left text-sm hover:bg-elevated/60"
                  >
                    <span className="h-2 w-2 rounded-[1px]" style={{ background: severityColor[c.severity] }} aria-hidden />
                    <span className="truncate text-ink-2">
                      {name(c.src)} <span className="text-ink-3">→</span> {name(c.dst)} <span className="text-xs text-ink-3">· {CATEGORY_LABEL[c.category]}</span>
                    </span>
                    <span className="tabular text-xs text-ink">{fmtInt(c.count)}</span>
                  </button>
                </li>
              ))}
              {!corridors.length && <li className="text-xs text-ink-3">No country-to-country relationships in this layer.</li>}
            </ul>
          </section>
          <section>
            <SectionTitle>Threat categories</SectionTitle>
            <BarList items={cats.map(([c, v]) => ({ key: c, label: CATEGORY_LABEL[c], value: v }))} />
          </section>
          <section>
            <SectionTitle>Critical &amp; high observations · {fmtInt(highIdx.length)}</SectionTitle>
            <EventList idx={highIdx} height={260} />
          </section>
        </>
      )}
      <section>
        <SectionTitle>Intelligence sources</SectionTitle>
        <ul className="flex flex-col gap-1.5">
          {dataset.sources.map((s) => (
            <li key={s.id} className="text-sm">
              <div className="flex items-center gap-2">
                <StatusDot status={s.status} />
                <span className="flex-1 truncate text-ink-2">{s.name}</span>
                <span className="text-2xs text-ink-3">{SOURCE_STATUS_LABEL[s.status]}</span>
              </div>
              <div className="ml-3.5 text-2xs text-ink-3">
                {fmtInt(s.recordCount)} records · synced {fmtRelative(s.lastSync)}
                {s.statusDetail ? ` · ${s.statusDetail}` : ''}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
