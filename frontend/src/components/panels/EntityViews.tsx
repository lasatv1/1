/** IP investigation and single-event detail views. Both only summarise data already ingested — no active lookups. */
import { useMemo } from 'react';
import { ExternalLink, FlaskConical } from 'lucide-react';
import { useDataStore } from '@/state/dataStore';
import { useAppStore } from '@/state/appStore';
import { CATEGORY_LABEL } from '@/lib/layers';
import { fmtInt, fmtUtc } from '@/lib/format';
import { BasisTag, EmptyState, Field, SectionTitle, SeverityBadge } from '@/components/common/ui';
import { SeverityBar } from '@/components/charts/charts';
import { EventList } from './EventList';
import type { Severity } from '@/types/intel';

export function IpInvestigation({ ip }: { ip: string }) {
  const dataset = useDataStore((s) => s.dataset);
  const geo = useDataStore((s) => s.geo);
  const open = useAppStore((s) => s.openInspector);
  const idx = useMemo(() => {
    const out: number[] = [];
    dataset?.events.forEach((e, i) => {
      if (e.srcIp === ip || e.dstIp === ip || e.indicators.some((x) => x.value === ip)) out.push(i);
    });
    return out;
  }, [dataset, ip]);

  const summary = useMemo(() => {
    const sev: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const cats = new Map<string, number>();
    const countries = new Set<string>();
    const asns = new Set<number>();
    const orgs = new Set<string>();
    const sources = new Set<string>();
    let first = Infinity;
    let last = -Infinity;
    for (const i of idx) {
      const e = dataset!.events[i]!;
      sev[e.severity]++;
      cats.set(e.category, (cats.get(e.category) ?? 0) + 1);
      sources.add(e.sourceId);
      if (e.srcIp === ip) {
        if (e.srcCountry) countries.add(e.srcCountry);
        if (e.srcAsn) asns.add(e.srcAsn);
        if (e.srcOrg) orgs.add(e.srcOrg);
      } else if (e.dstIp === ip) {
        if (e.dstCountry) countries.add(e.dstCountry);
        if (e.dstAsn) asns.add(e.dstAsn);
      }
      first = Math.min(first, e.t);
      last = Math.max(last, e.t);
    }
    return { sev, cats: [...cats.entries()].sort((a, b) => b[1] - a[1]), countries: [...countries], asns: [...asns], orgs: [...orgs], sources: [...sources], first, last };
  }, [idx, dataset, ip]);

  if (!idx.length)
    return (
      <EmptyState title={`No observations for ${ip}`}>
        This address does not appear in the active dataset. CyberThreat Atlas does not perform live lookups, scans or probes against addresses.
      </EmptyState>
    );

  const isDoc = /^(192\.0\.2|198\.51\.100|203\.0\.113)\./.test(ip);
  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="label-caps">IP address investigation</p>
        <h2 className="mono mt-1 text-[17px] font-medium text-ink">{ip}</h2>
        {isDoc && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-demo">
            <FlaskConical size={12} /> RFC 5737 documentation address used by the demonstration dataset.
          </p>
        )}
      </header>
      <section>
        <dl>
          <Field label="Geolocated to">
            {summary.countries.map((c) => (
              <button key={c} type="button" className="mr-2 hover:underline" onClick={() => open({ kind: 'country', id: c })}>
                {geo?.byId.get(c)?.name ?? c}
              </button>
            ))}
          </Field>
          <Field label="ASN" mono>
            {summary.asns.length ? summary.asns.map((a) => `AS${a}`).join(', ') : '—'}
          </Field>
          {summary.orgs.length > 0 && (
            <Field label="Network" mono>
              {summary.orgs.join(', ')}
            </Field>
          )}
          <Field label="First observed" mono>
            {fmtUtc(summary.first, true)}
          </Field>
          <Field label="Last observed" mono>
            {fmtUtc(summary.last, true)}
          </Field>
          <Field label="Observations">{fmtInt(idx.length)}</Field>
          <Field label="Sources">{summary.sources.map((s) => dataset?.sources.find((x) => x.id === s)?.name ?? s).join(', ')}</Field>
          <Field label="Categories">{summary.cats.map(([c, n]) => `${CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL]} (${n})`).join(', ')}</Field>
        </dl>
        <p className="mt-2 text-xs text-ink-3">
          Geolocation reflects address registration/routing data at observation time and may be inaccurate for VPNs, proxies, anycast and cloud ranges.
        </p>
      </section>
      <section>
        <SectionTitle>Severity</SectionTitle>
        <SeverityBar counts={summary.sev} />
      </section>
      <section>
        <SectionTitle>Events</SectionTitle>
        <EventList idx={idx} height={320} />
      </section>
    </div>
  );
}

export function EventDetail({ id }: { id: string }) {
  const dataset = useDataStore((s) => s.dataset);
  const geo = useDataStore((s) => s.geo);
  const open = useAppStore((s) => s.openInspector);
  const e = useMemo(() => dataset?.events.find((x) => x.id === id), [dataset, id]);
  if (!e) return <EmptyState title="Event not found">“{id}” is not in the active dataset.</EmptyState>;
  const src = dataset?.sources.find((s) => s.id === e.sourceId);
  const name = (c: string | null) => (c ? (geo?.byId.get(c)?.name ?? c) : null);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="label-caps">Event</p>
        <h2 className="mono mt-1 text-[15px] font-medium text-ink">{e.id}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={e.severity} long />
          <span className="text-xs text-ink-2">{CATEGORY_LABEL[e.category]}</span>
          <BasisTag basis={e.basis} />
        </div>
        {e.isDemo && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-demo">
            <FlaskConical size={12} /> Synthetic demonstration record — not an observation.
          </p>
        )}
      </header>
      <section>
        <p className="text-sm leading-5 text-ink-2">{e.description}</p>
      </section>
      <section>
        <SectionTitle>Network</SectionTitle>
        <dl>
          <Field label="Source country">
            {e.srcCountry ? (
              <button type="button" className="hover:underline" onClick={() => open({ kind: 'country', id: e.srcCountry! })}>
                {name(e.srcCountry)}
              </button>
            ) : (
              <span className="text-ink-3">Not applicable</span>
            )}
          </Field>
          <Field label="Destination">
            {e.dstCountry ? (
              <button type="button" className="hover:underline" onClick={() => open({ kind: 'country', id: e.dstCountry! })}>
                {name(e.dstCountry)}
              </button>
            ) : (
              <span className="text-ink-3">Not applicable</span>
            )}
          </Field>
          <Field label="Source IP" mono>
            {e.srcIp ? (
              <button type="button" className="text-accent hover:underline" onClick={() => open({ kind: 'ip', id: e.srcIp! })}>
                {e.srcIp}
              </button>
            ) : (
              '—'
            )}
          </Field>
          <Field label="Destination IP" mono>
            {e.dstIp ?? '—'}
          </Field>
          <Field label="Source ASN" mono>
            {e.srcAsn ? `AS${e.srcAsn}` : '—'}
          </Field>
          <Field label="Destination ASN" mono>
            {e.dstAsn ? `AS${e.dstAsn}` : '—'}
          </Field>
          <Field label="Network" mono>
            {e.srcOrg ?? '—'}
          </Field>
        </dl>
      </section>
      <section>
        <SectionTitle>Indicators</SectionTitle>
        <ul className="flex flex-col gap-1">
          {e.indicators.map((i) => (
            <li key={`${i.type}:${i.value}`} className="mono grid grid-cols-[56px_1fr] gap-2 text-2xs">
              <span className="uppercase text-ink-3">{i.type}</span>
              <span className="break-all text-ink-2">{i.value}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <SectionTitle>Provenance</SectionTitle>
        <dl>
          <Field label="Source">{src?.name ?? e.sourceId}</Field>
          <Field label="Source record" mono>
            {e.sourceRecordId}
          </Field>
          <Field label="Observed" mono>
            {fmtUtc(e.observedAt, true)}
          </Field>
          <Field label="First seen" mono>
            {fmtUtc(e.firstSeen, true)}
          </Field>
          <Field label="Last seen" mono>
            {fmtUtc(e.lastSeen, true)}
          </Field>
          <Field label="Collected" mono>
            {fmtUtc(e.collectedAt, true)}
          </Field>
          <Field label="Updated" mono>
            {fmtUtc(e.updatedAt, true)}
          </Field>
          <Field label="Confidence">{e.confidence}/100</Field>
          <Field label="Method">{src?.attributionMethod ?? '—'}</Field>
        </dl>
      </section>
      <section>
        <SectionTitle>References</SectionTitle>
        {e.references.length ? (
          <ul>
            {e.references.map((r) => (
              <li key={r}>
                <a href={r} target="_blank" rel="noopener noreferrer nofollow" className="mono inline-flex items-center gap-1 break-all text-2xs text-accent hover:underline">
                  {r} <ExternalLink size={10} />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-3">No references supplied by the source.</p>
        )}
      </section>
    </div>
  );
}
