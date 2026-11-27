import { useMemo } from 'react';
import { BookmarkPlus, ExternalLink } from 'lucide-react';
import { useDataStore } from '@/state/dataStore';
import { useDerivedStore } from '@/state/derivedStore';
import { useAppStore } from '@/state/appStore';
import { CATEGORY_LABEL } from '@/lib/layers';
import { fmtInt, fmtUtc, fmtDuration } from '@/lib/format';
import { BasisTag, BASIS_EXPLAIN, Button, EmptyState, Field, SectionTitle, SeverityBadge } from '@/components/common/ui';
import { SeverityBar } from '@/components/charts/charts';
import { EventList } from './EventList';
import type { Connection, RelationshipBasis, Severity, ThreatEvent } from '@/types/intel';

const CONTEXT_VERB: Record<RelationshipBasis, string> = {
  observed_traffic: 'recorded traffic from addresses geolocated in {src} towards sensors or assets in {dst}',
  infrastructure_geolocation: 'associated infrastructure geolocated in {src} with activity affecting {dst}',
  attribution_claim: 'include third-party claims linking activity associated with {src} to targets in {dst}',
  inferred: 'were correlated to link infrastructure geolocated in {src} with targeting of {dst}',
};

function topValues(values: Array<string | number | null>, n = 6): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const v of values) if (v != null) m.set(String(v), (m.get(String(v)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Builds careful, non-attributive explanatory text for why a connection is displayed. */
export function intelligenceContext(c: Connection, srcName: string, dstName: string, sourceNames: string[]): string {
  const n = c.count;
  const obs = `${fmtInt(n)} ${CATEGORY_LABEL[c.category].toLowerCase()} observation${n === 1 ? '' : 's'}`;
  const from = sourceNames.length > 1 ? `${sourceNames.length} intelligence sources (${sourceNames.join(', ')})` : sourceNames[0] ?? 'one source';
  const bases = c.bases
    .map((b) => CONTEXT_VERB[b].replace('{src}', srcName).replace('{dst}', dstName))
    .join('; others ');
  const span = c.lastSeen - c.firstSeen;
  return (
    `${obs} from ${from} ${bases} between ${fmtUtc(c.firstSeen)} and ${fmtUtc(c.lastSeen)}` +
    `${span > 0 ? ` (${fmtDuration(span)})` : ''}. Mean reported confidence is ${c.meanConfidence}/100. ` +
    `IP geolocation describes where network addresses are registered or routed; it does not establish who operates the infrastructure or where they are located. ` +
    `This relationship is a starting point for investigation, not an attribution.`
  );
}

export function ConnectionInvestigation({ id }: { id: string }) {
  const conn = useDerivedStore((s) => s.connectionsById.get(id));
  const dataset = useDataStore((s) => s.dataset);
  const geo = useDataStore((s) => s.geo);
  const open = useAppStore((s) => s.openInspector);
  const save = useAppStore((s) => s.saveInvestigation);
  const events: ThreatEvent[] = useMemo(() => (conn && dataset ? conn.eventIdx.map((i) => dataset.events[i]!) : []), [conn, dataset]);

  const derived = useMemo(() => {
    const sev: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const refs = new Set<string>();
    for (const e of events) {
      sev[e.severity]++;
      e.references.forEach((r) => refs.add(r));
    }
    return {
      sev,
      refs: [...refs].slice(0, 20),
      srcIps: topValues(events.map((e) => e.srcIp)),
      dstIps: topValues(events.map((e) => e.dstIp)),
      srcAsn: topValues(events.map((e) => e.srcAsn)),
      dstAsn: topValues(events.map((e) => e.dstAsn)),
      orgs: topValues(events.map((e) => e.srcOrg), 3),
      indicators: topValues(events.flatMap((e) => e.indicators.filter((i) => i.type !== 'ipv4').map((i) => `${i.type}:${i.value}`)), 6),
      demo: events.some((e) => e.isDemo),
    };
  }, [events]);

  if (!conn)
    return (
      <EmptyState title="Connection not in current view">
        The selected relationship has no observations under the current filters or observation period. Adjust filters or the timeline to bring it back.
      </EmptyState>
    );

  const name = (cid: string) => geo?.byId.get(cid)?.name ?? cid;
  const sourceNames = conn.sources.map((s) => dataset?.sources.find((x) => x.id === s)?.name ?? s);
  const confidenceLabel = conn.meanConfidence >= 75 ? 'High' : conn.meanConfidence >= 50 ? 'Moderate' : 'Low';

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="mono text-2xs text-ink-3">CONNECTION · {conn.id.replace(/>/g, ' › ')}</p>
        <h2 className="mt-1 text-[17px] font-semibold leading-6 text-ink">
          <button type="button" className="hover:underline" onClick={() => open({ kind: 'country', id: conn.src })}>
            {name(conn.src)}
          </button>
          <span className="px-2 text-ink-3">→</span>
          <button type="button" className="hover:underline" onClick={() => open({ kind: 'country', id: conn.dst })}>
            {name(conn.dst)}
          </button>
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={conn.severity} long />
          <span className="text-xs text-ink-2">{CATEGORY_LABEL[conn.category]}</span>
          {conn.bases.map((b) => (
            <BasisTag key={b} basis={b} />
          ))}
        </div>
        <div className="mt-3 flex gap-1.5">
          <Button
            onClick={() =>
              save({
                title: `${name(conn.src)} → ${name(conn.dst)} · ${CATEGORY_LABEL[conn.category]}`,
                description: `${fmtInt(conn.count)} events, ${fmtUtc(conn.firstSeen)} – ${fmtUtc(conn.lastSeen)}`,
                target: { kind: 'connection', id: conn.id },
                datasetMode: dataset?.mode ?? 'demo',
              })
            }
          >
            <BookmarkPlus size={12} /> Save investigation
          </Button>
        </div>
      </header>

      <section className="rounded-xs border border-line bg-bg-2 px-3 py-2.5">
        <SectionTitle>Intelligence context</SectionTitle>
        <p className="text-sm leading-[20px] text-ink-2">{intelligenceContext(conn, name(conn.src), name(conn.dst), sourceNames)}</p>
        {derived.demo && (
          <p className="mt-2 text-xs text-demo">All underlying records are synthetic demonstration data.</p>
        )}
        <ul className="mt-2 flex flex-col gap-1">
          {conn.bases.map((b) => (
            <li key={b} className="text-xs text-ink-3">
              <span className="text-ink-2">{b.replace(/_/g, ' ')}:</span> {BASIS_EXPLAIN[b]}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle>Connection record</SectionTitle>
        <dl>
          <Field label="Connection ID" mono>
            {conn.id}
          </Field>
          <Field label="Source country">
            {name(conn.src)} <span className="mono text-xs text-ink-3">{conn.src}</span>
          </Field>
          <Field label="Destination">
            {name(conn.dst)} <span className="mono text-xs text-ink-3">{conn.dst}</span>
          </Field>
          <Field label="Source IP" mono>
            <IpList items={derived.srcIps} onOpen={(ip) => open({ kind: 'ip', id: ip })} />
          </Field>
          <Field label="Destination IP" mono>
            <IpList items={derived.dstIps} onOpen={(ip) => open({ kind: 'ip', id: ip })} />
          </Field>
          <Field label="Source ASN" mono>
            {derived.srcAsn.length ? derived.srcAsn.map(([a, n]) => `AS${a} (${n})`).join(', ') : <span className="text-ink-3">Not provided</span>}
          </Field>
          <Field label="Destination ASN" mono>
            {derived.dstAsn.length ? derived.dstAsn.map(([a, n]) => `AS${a} (${n})`).join(', ') : <span className="text-ink-3">Not provided</span>}
          </Field>
          {derived.orgs.length > 0 && (
            <Field label="Source network" mono>
              {derived.orgs.map(([o]) => o).join(', ')}
            </Field>
          )}
          <Field label="First observed" mono>
            {fmtUtc(conn.firstSeen, true)}
          </Field>
          <Field label="Last observed" mono>
            {fmtUtc(conn.lastSeen, true)}
          </Field>
          <Field label="Event count">
            <span className="tabular">{fmtInt(conn.count)}</span>
          </Field>
          <Field label="Threat category">{CATEGORY_LABEL[conn.category]}</Field>
          <Field label="Severity">
            <SeverityBadge severity={conn.severity} long /> <span className="text-xs text-ink-3">highest observed</span>
          </Field>
          <Field label="Confidence">
            {confidenceLabel} <span className="tabular text-xs text-ink-3">mean {conn.meanConfidence}/100 as reported</span>
          </Field>
          <Field label="Sources">{sourceNames.join(', ')}</Field>
        </dl>
      </section>

      <section>
        <SectionTitle>Severity of underlying events</SectionTitle>
        <SeverityBar counts={derived.sev} />
      </section>

      {derived.indicators.length > 0 && (
        <section>
          <SectionTitle>Associated indicators</SectionTitle>
          <ul className="flex flex-col gap-1">
            {derived.indicators.map(([v, n]) => (
              <li key={v} className="mono flex justify-between gap-3 text-2xs text-ink-2">
                <span className="truncate">{v}</span>
                <span className="text-ink-3">×{n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionTitle>Supporting references</SectionTitle>
        {derived.refs.length ? (
          <ul className="flex flex-col gap-1">
            {derived.refs.map((r) => (
              <li key={r}>
                <a href={r} target="_blank" rel="noopener noreferrer nofollow" className="mono inline-flex items-center gap-1 break-all text-2xs text-accent hover:underline">
                  {r} <ExternalLink size={10} />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-3">The contributing sources supplied no public references for these records.</p>
        )}
      </section>

      <section>
        <SectionTitle>Events · {fmtInt(conn.count)}</SectionTitle>
        <EventList idx={conn.eventIdx} height={300} />
      </section>
    </div>
  );
}

function IpList({ items, onOpen }: { items: Array<[string, number]>; onOpen: (ip: string) => void }) {
  if (!items.length) return <span className="font-sans text-sm text-ink-3">Not provided by source</span>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {items.map(([ip, n]) => (
        <button key={ip} type="button" className="text-accent hover:underline" onClick={() => onOpen(ip)}>
          {ip}
          <span className="text-ink-3"> ×{n}</span>
        </button>
      ))}
    </span>
  );
}
