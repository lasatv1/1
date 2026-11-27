import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, MapPin, Network, FileText, Globe2, Spline } from 'lucide-react';
import { useAppStore } from '@/state/appStore';
import { useDataStore } from '@/state/dataStore';
import { useDerivedStore } from '@/state/derivedStore';
import { useGlobeStore } from '@/state/globeStore';
import { CATEGORY_LABEL } from '@/lib/layers';
import { cx, Kbd } from '@/components/common/ui';

interface Result {
  key: string;
  group: 'Countries' | 'Regions' | 'IP addresses' | 'Events' | 'Relationships';
  label: string;
  meta?: string;
  run: () => void;
}

const ICON = { Countries: MapPin, Regions: Globe2, 'IP addresses': Network, Events: FileText, Relationships: Spline } as const;
const IPV4 = /^\d{1,3}(\.\d{1,3}){0,3}$/;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Geographic, country, IP, event and relationship search (debounced, keyboard-driven). */
export function SearchPalette() {
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const [q, setQ] = useState('');
  const [compare, setCompare] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q.trim(), 120);
  const geo = useDataStore((s) => s.geo);
  const dataset = useDataStore((s) => s.dataset);
  const connections = useDerivedStore((s) => s.connections);

  useEffect(() => {
    const h = (e: Event) => {
      setCompare((e as CustomEvent<string>).detail === 'compare');
      setOpen(true);
    };
    document.addEventListener('cta:open-search', h);
    return () => document.removeEventListener('cta:open-search', h);
  }, [setOpen]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      requestAnimationFrame(() => input.current?.focus());
    } else setCompare(false);
  }, [open]);

  const ipIndex = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of dataset?.events ?? []) {
      if (e.srcIp) m.set(e.srcIp, (m.get(e.srcIp) ?? 0) + 1);
      if (e.dstIp) m.set(e.dstIp, (m.get(e.dstIp) ?? 0) + 1);
    }
    return m;
  }, [dataset]);

  const results = useMemo<Result[]>(() => {
    if (!geo) return [];
    const app = useAppStore.getState();
    const out: Result[] = [];
    const s = dq.toLowerCase();
    const countryHits = geo.countries
      .filter((c) => !s || c.name.toLowerCase().includes(s) || c.nameLong.toLowerCase().includes(s) || c.iso2?.toLowerCase() === s || c.iso3?.toLowerCase() === s)
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(s)) - Number(!b.name.toLowerCase().startsWith(s)) || a.labelRank - b.labelRank)
      .slice(0, s ? 8 : 6);
    for (const c of countryHits)
      out.push({
        key: `c:${c.id}`,
        group: 'Countries',
        label: c.name,
        meta: `${c.iso2 ?? c.adm0} · ${c.subregion}`,
        run: () => {
          app.selectCountry(c.id, compare);
          if (!compare) useGlobeStore.getState().flyTo(c.anchor[0], c.anchor[1]);
        },
      });
    if (compare) return out;
    if (s.length >= 2) {
      for (const r of geo.regions) {
        const subs = [r, ...(geo.subregions.get(r) ?? [])];
        for (const sub of subs)
          if (sub.toLowerCase().includes(s))
            out.push({
              key: `r:${sub}`,
              group: 'Regions',
              label: sub,
              meta: sub === r ? 'Region' : `Subregion of ${r}`,
              run: () => {
                const ids = geo.countries.filter((c) => (sub === r ? c.region === r : c.subregion === sub)).map((c) => c.id);
                app.selectCountries(ids, { kind: 'region', id: sub });
                const first = geo.byId.get(ids[0] ?? '');
                if (first) useGlobeStore.getState().flyTo(first.anchor[0], first.anchor[1], 2.9);
              },
            });
      }
    }
    if (IPV4.test(dq) || dq.includes(':')) {
      let n = 0;
      for (const [ip, count] of ipIndex) {
        if (!ip.startsWith(dq)) continue;
        out.push({ key: `ip:${ip}`, group: 'IP addresses', label: ip, meta: `${count} observations`, run: () => app.openInspector({ kind: 'ip', id: ip }) });
        if (++n >= 6) break;
      }
      if (!n && /^\d{1,3}(\.\d{1,3}){3}$/.test(dq))
        out.push({ key: `ip:${dq}`, group: 'IP addresses', label: dq, meta: 'Not in dataset — open anyway', run: () => app.openInspector({ kind: 'ip', id: dq }) });
    }
    if (s.length >= 4 && dataset) {
      const up = dq.toUpperCase();
      let n = 0;
      for (const e of dataset.events) {
        if (e.id.includes(up) || e.sourceRecordId.toLowerCase().includes(s)) {
          out.push({ key: `e:${e.id}`, group: 'Events', label: e.id, meta: `${CATEGORY_LABEL[e.category]} · ${e.sourceRecordId}`, run: () => app.openInspector({ kind: 'event', id: e.id }) });
          if (++n >= 5) break;
        }
      }
    }
    const pair = dq.toUpperCase().match(/^([A-Z]{2})\s*(?:>|->|→|\s)\s*([A-Z]{2})$/);
    if (pair) {
      for (const c of connections.filter((x) => geo.byId.get(x.src)?.iso2 === pair[1] && geo.byId.get(x.dst)?.iso2 === pair[2]).slice(0, 6))
        out.push({ key: `x:${c.id}`, group: 'Relationships', label: `${c.src} → ${c.dst}`, meta: `${CATEGORY_LABEL[c.category]} · ${c.count} events`, run: () => app.selectConnection(c.id) });
    }
    return out;
  }, [dq, geo, dataset, ipIndex, connections, compare]);

  const pendingEnter = useRef(false);
  const run = (r: Result | undefined) => {
    if (!r) return;
    r.run();
    setOpen(false);
  };
  useEffect(() => {
    setActive(0);
    // Enter pressed before the debounce settled: act on the fresh results instead of stale ones.
    if (pendingEnter.current && dq === q.trim()) {
      pendingEnter.current = false;
      run(results[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);
  if (!open) return null;

  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[#2a323b]/25 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[560px] overflow-hidden rounded-sm border border-line-strong bg-panel shadow-[0_16px_48px_rgba(40,48,58,0.18)]"
      >
        <div className="flex h-11 items-center gap-2 border-b border-line px-3">
          <Search size={15} className="text-ink-3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(results.length - 1, a + 1)));
              else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
              else if (e.key === 'Enter') {
                if (q.trim() !== dq) pendingEnter.current = true;
                else run(results[active]);
              }
              else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder={compare ? 'Add a country to the comparison…' : 'Country, region, IP address, event ID, or “US > DE”'}
            className="h-full flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
            aria-label="Search query"
            aria-activedescendant={results[active] ? `sr-${active}` : undefined}
            role="combobox"
            aria-expanded
            aria-controls="search-results"
            maxLength={120}
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul id="search-results" role="listbox" className="max-h-[420px] overflow-y-auto py-1">
          {results.map((r, i) => {
            const Icon = ICON[r.group];
            const header = r.group !== lastGroup;
            lastGroup = r.group;
            return (
              <li key={r.key} role="presentation">
                {header && <div className="label-caps px-3 pb-1 pt-2">{r.group}</div>}
                <button
                  id={`sr-${i}`}
                  role="option"
                  aria-selected={i === active}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(r)}
                  className={cx('flex h-8 w-full items-center gap-2.5 px-3 text-left text-sm', i === active ? 'bg-elevated text-ink' : 'text-ink-2')}
                >
                  <Icon size={13} className="text-ink-3" />
                  <span className={cx('flex-1 truncate', (r.group === 'IP addresses' || r.group === 'Events') && 'mono text-xs')}>{r.label}</span>
                  {r.meta && <span className="truncate text-2xs text-ink-3">{r.meta}</span>}
                </button>
              </li>
            );
          })}
          {!results.length && <li className="px-3 py-4 text-sm text-ink-3">No matches in countries, regions, or the active dataset.</li>}
        </ul>
        <div className="flex gap-4 border-t border-line px-3 py-1.5 text-2xs text-ink-3">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate
          </span>
          <span>
            <Kbd>Enter</Kbd> open
          </span>
          <span className="ml-auto">Search is local; no external lookups are made.</span>
        </div>
      </div>
    </div>
  );
}
