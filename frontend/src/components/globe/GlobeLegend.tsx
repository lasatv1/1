import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { severityOrder, severityLabel, severityCode, sequentialRamp, colors } from '@/design/tokens';
import { SeveritySwatch, cx } from '@/components/common/ui';
import { useAppStore } from '@/state/appStore';
import { useDerivedStore } from '@/state/derivedStore';
import { LAYER_BY_ID } from '@/lib/layers';
import { fmtInt } from '@/lib/format';

/** Per-layer legend: explains exactly what each visual encoding means for the active layer. */
export function GlobeLegend() {
  const layerId = useAppStore((s) => s.layer);
  const disputed = useAppStore((s) => s.display.disputed);
  const density = useAppStore((s) => s.display.density);
  const shown = useDerivedStore((s) => s.visibleConnections.length);
  const total = useDerivedStore((s) => s.connections.length);
  const layer = LAYER_BY_ID[layerId];
  const arcs = layer.visuals.includes('arcs');
  const markers = layer.visuals.includes('markers');
  const [open, setOpen] = useState(true);

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-10 w-[252px] rounded-sm border border-line bg-panel/90 px-2.5 py-2 text-2xs text-ink-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between">
        <span className="label-caps">Legend · Layer {layer.index} {layer.short}</span>
        <ChevronDown size={12} className={cx('text-ink-3 transition-transform', !open && 'rotate-180')} />
      </button>
      {open && (arcs || markers) && (
        <ul className="mb-1.5 mt-1.5 flex justify-between" aria-label="Severity">
          {severityOrder.map((s) => (
            <li key={s} className="mono flex items-center gap-1" title={severityLabel[s]}>
              <SeveritySwatch severity={s} />
              {severityCode[s]}
            </li>
          ))}
        </ul>
      )}
      {open && (<>
      {arcs && (
        <div className="flex items-center gap-2 py-0.5">
          <svg width="34" height="10" aria-hidden>
            <defs>
              <linearGradient id="lg-arc" x1="0" x2="1">
                <stop offset="0" stopColor={colors.ink2} stopOpacity="0.25" />
                <stop offset="1" stopColor={colors.ink2} stopOpacity="1" />
              </linearGradient>
            </defs>
            <path d="M1 9 Q17 -3 31 9" fill="none" stroke="url(#lg-arc)" strokeWidth="1.5" />
            <circle cx="31" cy="9" r="1.6" fill={colors.ink2} />
          </svg>
          <span className="truncate">Source → destination</span>
        </div>
      )}
      {markers && (
        <div className="flex items-center gap-2 py-0.5">
          <svg width="34" height="10" aria-hidden>
            <circle cx="17" cy="5" r="4" fill="none" stroke={colors.ink2} strokeWidth="1.5" />
          </svg>
          <span className="truncate" title="Ring size is proportional to the square root of the count">{arcs ? 'Located only (no counterpart)' : 'Located observations'}</span>
        </div>
      )}
      {layer.choropleth && (
        <div className="py-0.5">
          <div className="flex h-2 overflow-hidden rounded-[1px]">
            {sequentialRamp.map((c) => (
              <span key={c} className="flex-1" style={{ background: c }} />
            ))}
          </div>
          <div className="mt-0.5 flex justify-between text-ink-3">
            <span>Fewer</span>
            <span>{layer.choropleth === 'asn' ? 'Registered ASNs (log)' : 'Observations (log)'}</span>
            <span>More</span>
          </div>
        </div>
      )}
      {disputed && (
        <div className="flex items-center gap-2 py-0.5">
          <svg width="34" height="10" aria-hidden>
            <path d="M1 5 H33" stroke={colors.disputed} strokeWidth="1.2" strokeDasharray="3 2.5" />
          </svg>
          <span className="truncate">Disputed / breakaway boundary</span>
        </div>
      )}
      {arcs && (
        <div className="mt-1.5 border-t border-line pt-1.5 text-ink-3">
          <span title={`Limit ${density}, ranked by severity-weighted volume`}>
            Showing <span className="tabular text-ink-2">{fmtInt(shown)}</span> of <span className="tabular text-ink-2">{fmtInt(total)}</span> relationships
          </span>
        </div>
      )}
      </>)}
    </div>
  );
}
