import { useDerivedStore } from '@/state/derivedStore';
import { useDataStore } from '@/state/dataStore';
import { fmtCompact, fmtInt, fmtRelative, fmtUtc } from '@/lib/format';
import { Skeleton } from '@/components/common/ui';

/** Top-level statistics — every value is computed from the active, filtered dataset. */
export function StatsStrip() {
  const totals = useDerivedStore((s) => s.totals);
  const sources = useDataStore((s) => s.dataset?.sources);
  const mode = useDataStore((s) => s.dataset?.mode);
  const ready = useDataStore((s) => s.datasetStatus === 'ready');
  const lastSync = sources?.reduce<string | null>((a, s) => (s.lastSync && (!a || s.lastSync > a) ? s.lastSync : a), null) ?? null;
  const configured = sources?.filter((s) => s.status !== 'not_configured').length ?? 0;

  const items: Array<{ label: string; value: string; title: string; tone?: 'critical' }> = [
    { label: 'Observed events', value: fmtInt(totals.events), title: 'Observations matching current filters and observation period' },
    { label: 'Countries represented', value: fmtInt(totals.countries), title: 'Distinct countries appearing on either side of an observation' },
    { label: 'Unique indicators', value: fmtCompact(totals.indicators), title: 'Distinct IPs, domains, hashes and CVE references' },
    { label: 'Active sources', value: `${totals.activeSources}/${configured}`, title: 'Sources contributing to the current view / configured sources' },
    { label: 'Critical observations', value: fmtInt(totals.critical), title: 'Observations with critical severity', tone: 'critical' },
    { label: 'Relationships', value: fmtInt(totals.connections), title: 'Directed country pairs per category' },
  ];

  return (
    <div className="flex h-[52px] shrink-0 items-stretch border-b border-line bg-bg">
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-1 flex-col justify-center border-r border-line px-4" title={it.title}>
          <span className="label-caps truncate">{it.label}</span>
          {ready ? (
            <span className="tabular text-[17px] font-medium leading-6 text-ink">
              {it.tone === 'critical' && <span className="mr-1.5 inline-block h-2 w-2 rounded-[1px] bg-sev-critical align-middle" aria-hidden />}
              {it.value}
            </span>
          ) : (
            <Skeleton className="mt-1 h-4 w-16" />
          )}
        </div>
      ))}
      <div className="flex min-w-[210px] flex-col justify-center px-4" title={lastSync ? fmtUtc(lastSync, true) : undefined}>
        <span className="label-caps">{mode === 'demo' ? 'Dataset generated' : 'Last synchronisation'}</span>
        {ready ? (
          <span className="mono text-sm leading-6 text-ink">
            {lastSync ? fmtUtc(lastSync) : '—'} <span className="text-ink-3">· {fmtRelative(lastSync)}</span>
          </span>
        ) : (
          <Skeleton className="mt-1 h-4 w-28" />
        )}
      </div>
    </div>
  );
}
