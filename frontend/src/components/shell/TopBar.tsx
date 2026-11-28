import { useEffect, useState } from 'react';
import { Search, FlaskConical, RefreshCw, Radio, LogOut, Users } from 'lucide-react';
import { counterEnabled, subscribeCounter } from '@/lib/counter';
import { InfoconBadge } from '@/components/panels/LiveViews';
import { useAppStore, type Overlay } from '@/state/appStore';
import { useDataStore } from '@/state/dataStore';
import { cx, Kbd } from '@/components/common/ui';

function Logo() {
  return (
    <div className="flex shrink-0 items-center gap-2.5 pr-4">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="11" fill="none" stroke="#4A5563" strokeWidth="1.6" />
        <ellipse cx="16" cy="16" rx="5" ry="11" fill="none" stroke="#8A94A0" strokeWidth="1.2" />
        <path d="M5 16h22" stroke="#8A94A0" strokeWidth="1.2" />
        <path d="M9 9.5 Q16 4 22 11" fill="none" stroke="#B5524E" strokeWidth="1.5" />
        <circle cx="22" cy="11" r="1.8" fill="#B5524E" />
      </svg>
      <div className="whitespace-nowrap leading-none">
        <div className="text-[13px] font-semibold tracking-[0.01em] text-ink">CyberThreat Atlas</div>
        <div className="mt-1 hidden text-[9.5px] uppercase tracking-[0.12em] text-ink-3 2xl:block">Geospatial threat intelligence</div>
      </div>
    </div>
  );
}

// `wide`: shown only on wide screens; "Intelligence layers" is also the left panel's first
// section and "About" stays reachable via keyboard help, so nothing is lost when hidden.
const NAV: Array<{ id: Overlay | 'layers'; label: string; wide?: boolean }> = [
  { id: 'none', label: 'Global overview' },
  { id: 'layers', label: 'Intelligence layers', wide: true },
  { id: 'investigations', label: 'Investigations' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'about', label: 'About', wide: true },
];

export function TopBar() {
  const overlay = useAppStore((s) => s.overlay);
  const setOverlay = useAppStore((s) => s.setOverlay);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const mode = useDataStore((s) => s.dataset?.mode);
  const origin = useDataStore((s) => s.dataset?.origin);
  const generatedAt = useDataStore((s) => s.dataset?.generatedAt);
  const backend = useDataStore((s) => s.backendAvailable);
  const pending = useDataStore((s) => s.pendingUpdates);
  const status = useDataStore((s) => s.datasetStatus);
  const auth = useDataStore((s) => s.auth);

  return (
    <header className="flex h-11 shrink-0 items-center border-b border-line bg-bg-2 px-3">
      <Logo />
      <nav aria-label="Primary" className="flex h-full min-w-0 flex-1 items-stretch overflow-hidden">
        {NAV.map((n) => {
          const active = n.id === 'layers' ? false : overlay === n.id;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                if (n.id === 'layers') {
                  useAppStore.setState({ overlay: 'none', leftOpen: true });
                  document.getElementById('panel-layers')?.focus();
                } else setOverlay(n.id);
              }}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'relative whitespace-nowrap px-2.5 text-sm transition-colors xl:px-3',
                n.wide && 'hidden xl:block',
                active ? 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:bg-accent' : 'text-ink-3 hover:text-ink-2',
              )}
            >
              {n.label}
            </button>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-2 pl-3">
        {mode === 'demo' && (
          <div
            role="status"
            className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-sm border border-demo-line bg-demo-bg px-2.5 text-xs text-demo"
            title="Demonstration data: all records are synthetic, generated in the browser. They are not threat intelligence."
          >
            <FlaskConical size={13} />
            <span className="hidden font-medium lg:inline">Demo data</span>
            <span className="hidden text-demo/80 2xl:inline">· synthetic, not intelligence</span>
          </div>
        )}
        {mode === 'live' && (
          <div
            className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-sm border border-line-strong px-2.5 text-xs text-ink-2"
            title={origin === 'snapshot' ? `Published snapshot of real observations, generated ${generatedAt ?? ''} by the scheduled sync` : 'Observations loaded from the backend'}
          >
            <Radio size={13} className="text-sev-low" />
            <span className="hidden lg:inline">{origin === 'snapshot' ? 'Published snapshot' : 'Live sources'}</span>
          </div>
        )}
        {pending > 0 && (
          <button
            type="button"
            onClick={() => void useDataStore.getState().useLive()}
            className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-sm border border-line-strong px-2.5 text-xs text-ink hover:bg-elevated"
          >
            <RefreshCw size={12} /> {pending} new observations
          </button>
        )}
        <InfoconBadge />
        {counterEnabled && <VisitorBadge />}
        <ThemeSwitch />
        <DataModeSwitch mode={mode} backend={backend} loading={status === 'loading'} />
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex h-7 w-7 items-center justify-center gap-2 rounded-sm border border-line bg-panel text-sm text-ink-3 hover:border-line-strong hover:text-ink-2 xl:w-[200px] xl:justify-start xl:px-2.5 2xl:w-[260px]"
          aria-label="Search countries, IPs, events (/)"
        >
          <Search size={13} className="shrink-0" />
          <span className="hidden flex-1 truncate text-left xl:block">Search country, IP…</span>
          <span className="hidden xl:inline">
            <Kbd>/</Kbd>
          </span>
        </button>
        {auth === 'unlocked' && <SignOutButton />}
      </div>
    </header>
  );
}

/** Live page-open count (same counters as the sign-in page). */
function VisitorBadge() {
  const [opens, setOpens] = useState<number | null>(null);
  const [visitors, setVisitors] = useState<number | null>(null);
  useEffect(() => {
    const a = subscribeCounter('opens', setOpens);
    const b = subscribeCounter('visitors', setVisitors);
    return () => {
      a();
      b();
    };
  }, []);
  return (
    <div
      className="hidden h-7 items-center gap-1.5 whitespace-nowrap rounded-sm border border-line px-2 text-xs text-ink-2 xl:flex"
      title={`Live: ${opens ?? '—'} page opens, ${visitors ?? '—'} unique visitors`}
    >
      <Users size={13} className="text-ink-3" />
      <span className="tabular text-ink">{opens ?? '—'}</span>
      <span className="text-ink-3">opens</span>
    </div>
  );
}

function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => useDataStore.getState().logout()}
      className="flex h-7 w-7 items-center justify-center rounded-sm border border-line bg-panel text-ink-3 hover:border-line-strong hover:text-ink"
      aria-label="Sign out"
      title="Sign out"
    >
      <LogOut size={13} />
    </button>
  );
}

function ThemeSwitch() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  return (
    <div className="flex h-7 items-stretch rounded-sm border border-line bg-panel p-px text-xs" role="radiogroup" aria-label="Theme">
      {(['mist', 'light', 'black'] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          onClick={() => setTheme(t)}
          title={t === 'mist' ? 'Mist — mid-tone gray (default)' : t === 'light' ? 'Light — paler surfaces' : 'Black — true-black surfaces'}
          className={cx('min-w-[46px] rounded-[2px] px-2 text-center', theme === t ? 'bg-elevated text-ink' : 'text-ink-3 hover:text-ink-2')}
        >
          {t === 'mist' ? 'Mist' : t === 'light' ? 'Light' : 'Black'}
        </button>
      ))}
    </div>
  );
}

function DataModeSwitch({ mode, backend, loading }: { mode?: 'demo' | 'live'; backend: boolean | null; loading: boolean }) {
  return (
    <div className="flex h-7 items-stretch rounded-sm border border-line bg-panel p-px text-xs" role="radiogroup" aria-label="Data source">
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'demo'}
        onClick={() => useDataStore.getState().useDemo()}
        className={cx('min-w-[46px] rounded-[2px] px-2 text-center', mode === 'demo' ? 'bg-elevated text-ink' : 'text-ink-3 hover:text-ink-2')}
      >
        Demo
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'live'}
        disabled={!backend || loading}
        title={backend ? 'Load real observations' : 'No backend or published snapshot found'}
        onClick={() => void useDataStore.getState().useLive()}
        className={cx('min-w-[46px] rounded-[2px] px-2 text-center disabled:cursor-not-allowed disabled:opacity-40', mode === 'live' ? 'bg-elevated text-ink' : 'text-ink-3 hover:text-ink-2')}
      >
        {loading ? 'Loading…' : 'Live'}
      </button>
    </div>
  );
}
