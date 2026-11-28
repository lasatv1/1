import { useMemo, type ReactNode } from 'react';
import { Trash2, X, FlaskConical } from 'lucide-react';
import { useAppStore } from '@/state/appStore';
import { useDataStore } from '@/state/dataStore';
import { useDerivedStore } from '@/state/derivedStore';
import { histogram } from '@/lib/data/aggregate';
import { CATEGORY_LABEL, LAYERS } from '@/lib/layers';
import { severityOrder, severityLabel, severityColor, severityCode } from '@/design/tokens';
import { fmtInt, fmtUtc, fmtRelative } from '@/lib/format';
import { BarList, SeverityBar, TimeHistogram } from '@/components/charts/charts';
import { Button, EmptyState, IconButton, Kbd, SectionTitle, StatusDot, SOURCE_STATUS_LABEL } from '@/components/common/ui';
import type { ThreatCategory } from '@/types/intel';

function Shell({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  const close = () => useAppStore.getState().setOverlay('none');
  return (
    <div className="absolute inset-0 z-30 flex justify-center overflow-y-auto bg-bg/85 px-6 py-6 backdrop-blur-[2px]" onMouseDown={close}>
      <section
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={`h-fit w-full ${wide ? 'max-w-[1040px]' : 'max-w-[760px]'} rounded-sm border border-line-strong bg-panel`}
      >
        <header className="flex h-11 items-center justify-between border-b border-line px-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <IconButton label="Close (Esc)" onClick={close}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="px-5 py-5">{children}</div>
      </section>
    </div>
  );
}

export function Overlays() {
  const overlay = useAppStore((s) => s.overlay);
  if (overlay === 'analytics') return <Analytics />;
  if (overlay === 'investigations') return <Investigations />;
  if (overlay === 'about') return <About />;
  return null;
}

function Analytics() {
  const dataset = useDataStore((s) => s.dataset);
  const geo = useDataStore((s) => s.geo);
  const baseIdx = useDerivedStore((s) => s.baseIdx);
  const connections = useDerivedStore((s) => s.connections);
  const stats = useDerivedStore((s) => s.stats);
  const win = useDerivedStore((s) => s.window);
  const select = useAppStore((s) => s.selectConnection);
  const selectCountry = useAppStore((s) => s.selectCountry);
  const events = dataset?.events ?? [];
  const buckets = useMemo(() => histogram(events, baseIdx, win[0], win[1], 96), [events, baseIdx, win]);

  const matrix = useMemo(() => {
    const m = new Map<ThreatCategory, Record<string, number>>();
    for (const i of baseIdx) {
      const e = events[i]!;
      const row = m.get(e.category) ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      row[e.severity]!++;
      m.set(e.category, row);
    }
    return [...m.entries()].sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y) - Object.values(a[1]).reduce((x, y) => x + y));
  }, [baseIdx, events]);
  const maxCell = Math.max(1, ...matrix.flatMap(([, r]) => Object.values(r)));
  const name = (id: string) => geo?.byId.get(id)?.name ?? id;
  const outgoing = [...stats.values()].filter((s) => s.outgoing).sort((a, b) => b.outgoing - a.outgoing).slice(0, 8);
  const incoming = [...stats.values()].filter((s) => s.incoming).sort((a, b) => b.incoming - a.incoming).slice(0, 8);
  const corridors = [...connections].sort((a, b) => b.count - a.count).slice(0, 10);

  return (
    <Shell title="Analytics" wide>
      {dataset?.mode === 'demo' && (
        <p className="mb-4 flex items-center gap-2 text-xs text-demo">
          <FlaskConical size={12} /> Computed from the synthetic demonstration dataset.
        </p>
      )}
      <p className="mb-4 text-xs text-ink-3">
        All figures reflect the current layer, filters and observation period ({fmtUtc(win[0])} → {fmtUtc(win[1])}): <span className="tabular text-ink-2">{fmtInt(baseIdx.length)}</span> observations.
      </p>
      <div className="grid grid-cols-2 gap-6">
        <section className="col-span-2">
          <SectionTitle>Observations over time by severity</SectionTitle>
          <div className="h-[120px]">
            <TimeHistogram buckets={buckets} height={120} />
          </div>
        </section>
        <section>
          <SectionTitle>Category × severity</SectionTitle>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="py-1 text-left font-normal text-ink-3">Category</th>
                {severityOrder.map((s) => (
                  <th key={s} className="py-1 text-right font-normal text-ink-3" title={severityLabel[s]}>
                    <span className="mono inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: severityColor[s] }} />
                      {severityCode[s]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map(([cat, row]) => (
                <tr key={cat} className="border-t border-line">
                  <td className="py-1.5 text-ink-2">{CATEGORY_LABEL[cat]}</td>
                  {severityOrder.map((s) => (
                    <td key={s} className="tabular py-1.5 text-right text-ink">
                      <span className="inline-block min-w-[38px] rounded-[2px] px-1" style={{ background: `rgba(79,109,136,${(0.22 * (row[s] ?? 0)) / maxCell})` }}>
                        {fmtInt(row[s])}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <SectionTitle>Busiest relationships</SectionTitle>
          <BarList
            items={corridors.map((c) => ({
              key: c.id,
              label: `${name(c.src)} → ${name(c.dst)} · ${CATEGORY_LABEL[c.category]}`,
              value: c.count,
              color: severityColor[c.severity],
              hint: `Highest severity: ${severityLabel[c.severity]}`,
              onClick: () => (useAppStore.getState().setOverlay('none'), select(c.id)),
            }))}
          />
        </section>
        <section>
          <SectionTitle>Top source-side countries (outgoing)</SectionTitle>
          <BarList items={outgoing.map((s) => ({ key: s.id, label: name(s.id), value: s.outgoing, onClick: () => (useAppStore.getState().setOverlay('none'), selectCountry(s.id)) }))} />
        </section>
        <section>
          <SectionTitle>Top destination-side countries (incoming)</SectionTitle>
          <BarList items={incoming.map((s) => ({ key: s.id, label: name(s.id), value: s.incoming, onClick: () => (useAppStore.getState().setOverlay('none'), selectCountry(s.id)) }))} />
        </section>
        <section className="col-span-2">
          <SectionTitle>Overall severity</SectionTitle>
          <SeverityBar
            counts={baseIdx.reduce(
              (acc, i) => (acc[events[i]!.severity]++, acc),
              { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
            )}
          />
        </section>
      </div>
      <p className="mt-5 text-2xs text-ink-3">
        Source-side counts reflect where infrastructure is geolocated, not where operators are. High volumes often track hosting capacity and sensor placement.
      </p>
    </Shell>
  );
}

function Investigations() {
  const list = useAppStore((s) => s.investigations);
  const del = useAppStore((s) => s.deleteInvestigation);
  const open = useAppStore((s) => s.openInspector);
  const mode = useDataStore((s) => s.dataset?.mode);
  return (
    <Shell title="Investigations">
      <p className="mb-4 text-xs text-ink-3">Saved locally in this browser. Use “Save” in a country profile or connection investigation to add one.</p>
      {list.length === 0 ? (
        <EmptyState title="No saved investigations">Open a country or connection and choose Save to keep it here.</EmptyState>
      ) : (
        <ul className="flex flex-col">
          {list.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 border-b border-line py-2.5">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="text-left text-sm font-medium text-ink hover:underline"
                  onClick={() => {
                    useAppStore.getState().setOverlay('none');
                    if (inv.target.kind === 'country') useAppStore.getState().selectCountry(inv.target.id);
                    else open(inv.target);
                  }}
                >
                  {inv.title}
                </button>
                <div className="text-xs text-ink-3">
                  <span className="mono">{inv.id}</span> · {inv.description} · saved {fmtRelative(inv.createdAt)}
                  {inv.datasetMode === 'demo' && <span className="text-demo"> · demo data</span>}
                  {inv.datasetMode !== mode && <span> · created in {inv.datasetMode} mode</span>}
                </div>
              </div>
              <IconButton label={`Delete ${inv.title}`} onClick={() => del(inv.id)}>
                <Trash2 size={13} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

function About() {
  const sources = useDataStore((s) => s.dataset?.sources ?? []);
  const geoSource = useDataStore((s) => s.geo?.source);
  const mode = useDataStore((s) => s.dataset?.mode);
  const backend = useDataStore((s) => s.backendAvailable);
  return (
    <Shell title="About Ruster Ball">
      <div className="flex flex-col gap-6 text-sm leading-[21px] text-ink-2">
        <section>
          <SectionTitle>Purpose</SectionTitle>
          <p>
            Ruster Ball is a live world-intelligence globe: conflict and unrest, aircraft, ships, satellites, natural hazards, historical borders and cyber threats in one view. For cyber data it shows where infrastructure is located, which countries
            appear together in reports, and how activity changes over time. It is a visualisation system only: it performs no scanning, probing or exploitation.
          </p>
        </section>
        <section>
          <SectionTitle>How to read relationships</SectionTitle>
          <ul className="list-disc space-y-1 pl-4">
            <li><span className="text-ink">Observed traffic</span> — a sensor recorded traffic from an address geolocated in country A to an asset in country B.</li>
            <li><span className="text-ink">Infrastructure geolocation</span> — the infrastructure is hosted in country A; this says nothing about who controls it.</li>
            <li><span className="text-ink">Attribution claim</span> — a third party’s published claim; shown as a claim, never as fact.</li>
            <li><span className="text-ink">Inferred</span> — derived by correlating report metadata with indicator geolocation; a lead, not a finding.</li>
          </ul>
          <p className="mt-2">
            IP geolocation does not prove the identity or physical location of an attacker. VPNs, proxies, compromised hosts, cloud and anycast ranges routinely place
            activity far from its operators.
          </p>
        </section>
        <section>
          <SectionTitle>Data</SectionTitle>
          <p>
            Current mode: <span className="text-ink">{mode === 'demo' ? 'Demonstration (synthetic)' : 'Live backend'}</span>. Backend{' '}
            {backend ? 'reachable' : 'not reachable'}.
          </p>
          {mode === 'demo' && (
            <p className="mt-1 text-demo">
              The demonstration dataset is generated in the browser. It uses RFC 5737 documentation IPs, RFC 6996 private ASNs and the reserved .example TLD, and
              distributes activity by √population so it implies nothing about real countries.
            </p>
          )}
          <ul className="mt-2 flex flex-col gap-1">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-xs">
                <StatusDot status={s.status} />
                <span className="text-ink">{s.name}</span>
                <span className="text-ink-3">— {SOURCE_STATUS_LABEL[s.status]} · {s.attributionMethod}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-3">Boundaries: {geoSource}. Disputed areas are drawn dashed from Natural Earth’s breakaway/disputed datasets.</p>
        </section>
        <section>
          <SectionTitle>Layers</SectionTitle>
          <dl className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-1.5 text-xs">
            {LAYERS.map((l) => (
              <div key={l.id} className="contents">
                <dt className="text-ink">{String(l.index).padStart(2, '0')} · {l.name}</dt>
                <dd className="text-ink-3">
                  {l.requirements} <span className="text-ink-2">Feeds: {l.feeds.join(', ')}.</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <SectionTitle>Keyboard</SectionTitle>
          <ul className="grid grid-cols-2 gap-1.5 text-xs">
            <li><Kbd>G</Kbd> Global view</li>
            <li><Kbd>R</Kbd> Reset globe</li>
            <li><Kbd>F</Kbd> Fullscreen globe</li>
            <li><Kbd>/</Kbd> Search</li>
            <li><Kbd>Esc</Kbd> Close active panel</li>
            <li><Kbd>Shift</Kbd>+click Compare countries</li>
          </ul>
        </section>
        <div>
          <Button onClick={() => useAppStore.getState().setOverlay('none')}>Close</Button>
        </div>
      </div>
    </Shell>
  );
}
