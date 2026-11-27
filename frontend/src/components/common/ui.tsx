import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import type { RelationshipBasis, Severity, SourceStatus } from '@/types/intel';
import { severityCode, severityColor, severityLabel } from '@/design/tokens';

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function SeveritySwatch({ severity, size = 8 }: { severity: Severity; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-[1px]"
      style={{ width: size, height: size, background: severityColor[severity] }}
    />
  );
}

/** Severity always shown as swatch + text code, never colour alone. */
export function SeverityBadge({ severity, long = false }: { severity: Severity; long?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs font-medium tracking-wide text-ink-2" title={severityLabel[severity]}>
      <SeveritySwatch severity={severity} />
      <span className="mono">{long ? severityLabel[severity] : severityCode[severity]}</span>
    </span>
  );
}

export const BASIS_LABEL: Record<RelationshipBasis, string> = {
  observed_traffic: 'Observed traffic',
  infrastructure_geolocation: 'Infrastructure geolocation',
  attribution_claim: 'Third-party attribution claim',
  inferred: 'Inferred relationship',
};

export const BASIS_EXPLAIN: Record<RelationshipBasis, string> = {
  observed_traffic:
    'A sensor recorded network traffic from an address geolocated to the source country towards an asset in the destination country. Geolocation describes the address, not the operator.',
  infrastructure_geolocation:
    'Infrastructure associated with the activity is geolocated to the source country. Hosting location does not indicate who controls it.',
  attribution_claim:
    'A third party has published an attribution claim. It is displayed as a claim and has not been verified by this platform.',
  inferred:
    'The relationship was derived by correlating report metadata (for example targeted countries) with indicator geolocation. Treat as a lead, not a finding.',
};

export function BasisTag({ basis }: { basis: RelationshipBasis }) {
  const claim = basis === 'attribution_claim';
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-xs border px-1.5 py-px text-2xs',
        claim ? 'border-demo-line text-demo' : 'border-line-strong text-ink-2',
      )}
      title={BASIS_EXPLAIN[basis]}
    >
      {BASIS_LABEL[basis]}
    </span>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="label-caps">{children}</h3>
      {right}
    </div>
  );
}

export function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[124px_minmax(0,1fr)] items-baseline gap-3 py-[3px] text-sm">
      <dt className="truncate text-ink-3" title={label}>
        {label}
      </dt>
      <dd className={cx('min-w-0 break-words text-ink', mono && 'mono text-xs leading-[18px]')}>{children}</dd>
    </div>
  );
}

export function IconButton({
  label,
  children,
  active,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-sm text-ink-2 transition-colors hover:bg-elevated hover:text-ink disabled:opacity-40',
        active && 'bg-elevated text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Button({
  children,
  variant = 'default',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' | 'primary' }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-xs font-medium transition-colors disabled:opacity-40',
        variant === 'default' && 'border border-line-strong bg-panel text-ink hover:bg-elevated',
        variant === 'ghost' && 'text-ink-2 hover:bg-elevated hover:text-ink',
        variant === 'primary' && 'bg-ink text-panel hover:bg-ink-2',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'xs';
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('flex items-stretch rounded-sm border border-line bg-bg-2 p-px', size === 'sm' ? 'h-7' : 'h-6')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 whitespace-nowrap rounded-[2px] px-2 text-center font-medium transition-colors',
            size === 'sm' ? 'text-xs' : 'text-2xs',
            value === o.value ? 'bg-elevated text-ink' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm text-ink-2 hover:text-ink" title={hint}>
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx('relative h-3.5 w-6 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
      >
        <span className={cx('absolute top-0.5 h-2.5 w-2.5 rounded-full bg-bg transition-[left]', checked ? 'left-3' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-sm border border-dashed border-line-strong px-3 py-3 text-sm">
      <div className="flex items-center gap-2 text-ink-2">
        {icon ?? <Info size={14} />}
        <span className="font-medium">{title}</span>
      </div>
      {children && <div className="text-xs text-ink-3">{children}</div>}
    </div>
  );
}

export function ErrorState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-sm border border-danger-line bg-danger-bg px-3 py-3 text-sm">
      <div className="flex items-center gap-2 text-ink">
        <AlertTriangle size={14} className="text-sev-critical" />
        <span className="font-medium">{title}</span>
      </div>
      {detail && <p className="mono text-2xs text-ink-3">{detail}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-xs', className)} />;
}

export const SOURCE_STATUS_LABEL: Record<SourceStatus, string> = {
  ok: 'Operational',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
  not_configured: 'Not configured',
  demo: 'Demonstration',
};

export function StatusDot({ status }: { status: SourceStatus }) {
  const color =
    status === 'ok' ? '#5B8C78' : status === 'degraded' ? '#B39A4A' : status === 'unavailable' ? '#B5524E' : status === 'demo' ? '#5D7D9C' : '#9AA3AD';
  return <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mono rounded-xs border border-line-strong bg-bg-2 px-1 text-2xs text-ink-2">{children}</kbd>;
}
