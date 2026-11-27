import { useState, type ReactNode } from 'react';
import { ChevronDown, PanelLeftClose } from 'lucide-react';
import { useAppStore } from '@/state/appStore';
import { useDerivedStore } from '@/state/derivedStore';
import { useDataStore } from '@/state/dataStore';
import { LAYERS, LAYER_BY_ID, CATEGORY_LABEL, ALL_CATEGORIES } from '@/lib/layers';
import { severityOrder, severityLabel } from '@/design/tokens';
import { fmtCompact, fmtInt, fmtUtc, fromUtcInput, toUtcInput } from '@/lib/format';
import { cx, IconButton, Segmented, SeveritySwatch, StatusDot, Toggle, SOURCE_STATUS_LABEL } from '@/components/common/ui';
import type { ThreatCategory } from '@/types/intel';

function Section({ title, children, defaultOpen = true, right, id }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode; id?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line px-3 py-2.5" aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          id={id}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-1 text-left focus-visible:outline-offset-2"
        >
          <ChevronDown size={12} className={cx('text-ink-3 transition-transform', !open && '-rotate-90')} />
          <h2 id={id ? `${id}-h` : undefined} className="label-caps">
            {title}
          </h2>
        </button>
        {right}
      </div>
      {open && <div className="mt-2">{children}</div>}
    </section>
  );
}

function CheckRow({ checked, onChange, children, count, disabled }: { checked: boolean; onChange: () => void; children: ReactNode; count?: number; disabled?: boolean }) {
  return (
    <label className={cx('flex h-[26px] cursor-pointer items-center gap-2 rounded-xs px-1 text-sm hover:bg-elevated/60', disabled && 'cursor-default opacity-45')}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} className="h-3 w-3 accent-accent" />
      <span className="flex min-w-0 flex-1 items-center gap-2 text-ink-2">{children}</span>
      {count != null && <span className="tabular text-xs text-ink-3">{fmtCompact(count)}</span>}
    </label>
  );
}

export function LeftPanel() {
  const s = useAppStore();
  const catCounts = useDerivedStore((d) => d.categoryCounts);
  const sevCounts = useDerivedStore((d) => d.severityCounts);
  const dataset = useDataStore((d) => d.dataset);
  const geo = useDataStore((d) => d.geo);
  const layer = LAYER_BY_ID[s.layer];

  const layerCount = (cats: ThreatCategory[]) =>
    cats.length ? cats.reduce((a, c) => a + (catCounts[c] ?? 0), 0) : Object.values(catCounts).reduce((a, b) => a + (b ?? 0), 0);
  const categoryChoices: ThreatCategory[] = layer.categories.length ? layer.categories : ALL_CATEGORIES;
  const now = dataset?.extent[1] ?? Date.now();

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-r border-line bg-panel" aria-label="Filters and layers">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-sm font-medium text-ink">Analysis controls</span>
        <IconButton label="Collapse panel" onClick={() => s.setLeftOpen(false)}>
          <PanelLeftClose size={14} />
        </IconButton>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Section title="Intelligence layers" id="panel-layers">
          <ul role="radiogroup" aria-label="Intelligence layer" className="flex flex-col">
            {LAYERS.map((l) => {
              const n = l.id === 'network' ? Object.keys(dataset?.network ?? {}).length : layerCount(l.categories);
              const active = s.layer === l.id;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => s.setLayer(l.id)}
                    title={l.description}
                    className={cx(
                      'group flex h-7 w-full items-center gap-2 rounded-xs px-1.5 text-left text-sm transition-colors',
                      active ? 'bg-elevated text-ink' : 'text-ink-2 hover:bg-elevated/60 hover:text-ink',
                    )}
                  >
                    <span className={cx('mono w-4 text-2xs', active ? 'text-ink-2' : 'text-ink-3')}>{String(l.index).padStart(2, '0')}</span>
                    <span className="flex-1 truncate">{l.name}</span>
                    <span className={cx('tabular text-2xs', n ? 'text-ink-3' : 'text-ink-3/60')}>
                      {n ? fmtCompact(n) : 'no data'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs leading-[17px] text-ink-3">{layer.description}</p>
        </Section>

        <Section
          title="Severity"
          right={
            <button type="button" className="text-2xs text-ink-3 hover:text-ink-2" onClick={() => s.setSeverities([...severityOrder])}>
              All
            </button>
          }
        >
          {severityOrder.map((sv) => (
            <CheckRow key={sv} checked={s.severities.has(sv)} onChange={() => s.toggleSeverity(sv)} count={sevCounts[sv]}>
              <SeveritySwatch severity={sv} />
              {severityLabel[sv]}
            </CheckRow>
          ))}
        </Section>

        <Section
          title="Threat categories"
          right={
            s.categories.size > 0 && (
              <button type="button" className="text-2xs text-ink-3 hover:text-ink-2" onClick={s.clearCategories}>
                Clear
              </button>
            )
          }
        >
          {categoryChoices.map((c) => (
            <CheckRow
              key={c}
              checked={s.categories.size === 0 || s.categories.has(c)}
              onChange={() => s.toggleCategory(c)}
              count={catCounts[c] ?? 0}
            >
              {CATEGORY_LABEL[c]}
            </CheckRow>
          ))}
          {s.categories.size === 0 && <p className="mt-1 px-1 text-2xs text-ink-3">All categories in this layer are shown. Tick to narrow.</p>}
        </Section>

        <Section title="Direction">
          <Segmented
            label="Direction"
            value={s.direction}
            onChange={s.setDirection}
            options={[
              { value: 'all', label: 'All' },
              { value: 'incoming', label: 'Incoming' },
              { value: 'outgoing', label: 'Outgoing' },
            ]}
          />
          <p className="mt-1.5 text-2xs text-ink-3">
            {s.selected.length ? `Relative to ${s.selected.length === 1 ? geo?.byId.get(s.selected[0]!)?.name : `${s.selected.length} selected countries`}.` : 'Applies once a country is selected.'}
          </p>
        </Section>

        <Section title="Observation period">
          <Segmented
            label="Time range"
            value={s.time.preset}
            onChange={(p) => (p === 'custom' ? s.setCustomRange(s.time.from, s.time.to) : s.setTimePreset(p, now))}
            options={[
              { value: '1h', label: '1h', title: 'Last hour' },
              { value: '24h', label: '24h', title: 'Last 24 hours' },
              { value: '7d', label: '7d', title: 'Last 7 days' },
              { value: '30d', label: '30d', title: 'Last 30 days' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
          {s.time.preset === 'custom' ? (
            <div className="mt-2 grid grid-cols-[36px_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 text-xs">
              <label htmlFor="t-from" className="text-ink-3">From</label>
              <input
                id="t-from"
                type="datetime-local"
                value={toUtcInput(s.time.from)}
                onChange={(e) => e.target.value && s.setCustomRange(fromUtcInput(e.target.value), s.time.to)}
                className="mono h-7 w-full rounded-xs border border-line bg-bg-2 px-2 text-2xs"
              />
              <label htmlFor="t-to" className="text-ink-3">To</label>
              <input
                id="t-to"
                type="datetime-local"
                value={toUtcInput(s.time.to)}
                onChange={(e) => e.target.value && s.setCustomRange(s.time.from, fromUtcInput(e.target.value))}
                className="mono h-7 w-full rounded-xs border border-line bg-bg-2 px-2 text-2xs"
              />
              <span />
              <span className="text-2xs text-ink-3">UTC. You can also drag across the timeline.</span>
            </div>
          ) : (
            <p className="mono mt-1.5 text-2xs text-ink-3">
              {fmtUtc(s.time.from)} → {fmtUtc(s.time.to)}
            </p>
          )}
        </Section>

        <Section title="Geography">
          <div className="flex flex-col gap-1.5">
            <select
              aria-label="Region"
              value={s.region ?? ''}
              onChange={(e) => s.setRegion(e.target.value || null, null)}
              className="h-7 w-full rounded-xs border border-line bg-bg-2 px-2 text-sm"
            >
              <option value="">Global — all regions</option>
              {geo?.regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {s.region && (
              <select
                aria-label="Subregion"
                value={s.subregion ?? ''}
                onChange={(e) => s.setRegion(s.region, e.target.value || null)}
                className="h-7 w-full rounded-xs border border-line bg-bg-2 px-2 text-sm"
              >
                <option value="">All of {s.region}</option>
                {geo?.subregions.get(s.region)?.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
            {s.region && geo && (
              <button
                type="button"
                className="flex h-7 w-full items-center justify-center rounded-xs border border-line-strong text-xs text-ink-2 hover:bg-elevated hover:text-ink"
                onClick={() => {
                  const key = s.subregion ?? s.region!;
                  const ids = geo.countries.filter((c) => c.region === s.region && (!s.subregion || c.subregion === s.subregion)).map((c) => c.id);
                  s.selectCountries(ids, { kind: 'region', id: key });
                }}
              >
                Select region &amp; open profile
              </button>
            )}
            <p className="text-2xs text-ink-3">Restricts observations to those touching the chosen region. UN M49 regions via Natural Earth.</p>
          </div>
        </Section>

        <Section title="Data sources">
          {dataset?.sources.map((src) => (
            <CheckRow
              key={src.id}
              checked={s.sources.size === 0 || s.sources.has(src.id)}
              onChange={() => s.toggleSource(src.id)}
              count={src.recordCount}
              disabled={src.status === 'not_configured' || src.status === 'unavailable'}
            >
              <StatusDot status={src.status} />
              <span className="truncate" title={`${SOURCE_STATUS_LABEL[src.status]}${src.statusDetail ? ` — ${src.statusDetail}` : ''}`}>
                {src.name}
              </span>
            </CheckRow>
          ))}
          {!dataset && <p className="text-xs text-ink-3">Loading sources…</p>}
        </Section>

        <Section title="Display" defaultOpen={false}>
          <label className="flex flex-col gap-1 py-1 text-sm text-ink-2">
            <span className="flex justify-between">
              Connection opacity <span className="tabular text-xs text-ink-3">{Math.round(s.display.opacity * 100)}%</span>
            </span>
            <input type="range" min={0.15} max={1} step={0.05} value={s.display.opacity} onChange={(e) => s.setDisplay({ opacity: +e.target.value })} className="accent-accent" />
          </label>
          <label className="flex flex-col gap-1 py-1 text-sm text-ink-2">
            <span className="flex justify-between">
              Max relationships drawn <span className="tabular text-xs text-ink-3">{s.display.density}</span>
            </span>
            <input type="range" min={20} max={600} step={10} value={s.display.density} onChange={(e) => s.setDisplay({ density: +e.target.value })} className="accent-accent" />
          </label>
          <label className="flex flex-col gap-1 py-1 text-sm text-ink-2">
            <span className="flex justify-between">
              Minimum events per relationship <span className="tabular text-xs text-ink-3">{fmtInt(s.display.minCount)}</span>
            </span>
            <input type="range" min={1} max={50} step={1} value={s.display.minCount} onChange={(e) => s.setDisplay({ minCount: +e.target.value })} className="accent-accent" />
          </label>
          <Toggle label="Country labels" checked={s.display.countryLabels} onChange={(v) => s.setDisplay({ countryLabels: v })} />
          <Toggle label="Connection labels" checked={s.display.connectionLabels} onChange={(v) => s.setDisplay({ connectionLabels: v })} />
          <Toggle label="Activity markers" checked={s.display.markers} onChange={(v) => s.setDisplay({ markers: v })} />
          <Toggle
            label="Disputed boundaries"
            hint="Natural Earth breakaway & disputed areas, drawn dashed"
            checked={s.display.disputed}
            onChange={(v) => s.setDisplay({ disputed: v })}
          />
          <Toggle label="Animate flow direction" checked={s.display.animateFlow} onChange={(v) => s.setDisplay({ animateFlow: v })} />
        </Section>
      </div>
    </aside>
  );
}
