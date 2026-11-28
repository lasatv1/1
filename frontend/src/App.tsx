import { lazy, Suspense, useEffect } from 'react';
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { useDataStore } from '@/state/dataStore';
import { useAppStore } from '@/state/appStore';
import { startDerivedPipeline } from '@/state/derivedStore';
import { subscribeToUpdates } from '@/lib/data/apiClient';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useLiveClock } from '@/hooks/useLiveClock';
import { TopBar } from '@/components/shell/TopBar';
import { StatsStrip } from '@/components/shell/StatsStrip';
import { LeftPanel } from '@/components/panels/LeftPanel';
import { RightPanel } from '@/components/panels/RightPanel';
import { Timeline } from '@/components/timeline/Timeline';
import { SearchPalette } from '@/components/search/SearchPalette';
import { Overlays } from '@/components/overlays/Overlays';
import { Button, ErrorState, IconButton } from '@/components/common/ui';
import { LoginPage } from '@/components/auth/LoginPage';
import { LiveFeedRunners } from '@/live/LiveFeedRunners';

// The WebGL bundle (three.js) is split out and loaded on demand.
const GlobeView = lazy(() => import('@/components/globe/GlobeView'));

function GlobeFallback({ label = 'Loading boundary data…' }: { label?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-3">
        <div className="skeleton h-[min(60vh,520px)] w-[min(60vh,520px)] rounded-full opacity-60" />
        <span className="text-xs text-ink-3">{label}</span>
      </div>
    </div>
  );
}

export function App() {
  const geoStatus = useDataStore((s) => s.geoStatus);
  const geoError = useDataStore((s) => s.geoError);
  const mode = useDataStore((s) => s.dataset?.mode);
  const origin = useDataStore((s) => s.dataset?.origin);
  const leftOpen = useAppStore((s) => s.leftOpen);
  const rightOpen = useAppStore((s) => s.rightOpen);
  const compact = useAppStore((s) => s.compact);
  const auth = useDataStore((s) => s.auth);
  useKeyboardShortcuts();
  useLiveClock();

  // Responsive: desktop first; on narrower screens panels start collapsed so the globe
  // keeps priority, and they open as overlays rather than squeezing the viewport.
  useEffect(() => {
    const apply = () => {
      const w = window.innerWidth;
      useAppStore.setState({ compact: w < 1180, leftOpen: w >= 1180, rightOpen: w >= 980 });
    };
    apply();
    let last = window.innerWidth;
    const onResize = () => {
      const w = window.innerWidth;
      if ((last >= 1180) !== (w >= 1180) || (last >= 980) !== (w >= 980)) apply();
      last = w;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    startDerivedPipeline();
    void useDataStore.getState().init();
  }, []);

  useEffect(() => {
    // Push updates exist only with a running API; a static snapshot refreshes on reload.
    if (mode !== 'live' || origin !== 'api') return;
    return subscribeToUpdates(() => void useDataStore.getState().refresh());
  }, [mode, origin]);

  // Login-protected deployment: nothing but the sign-in screen until the data is decrypted.
  if (auth === 'locked') return <LoginPage />;

  return (
    <div className="flex h-full w-full min-w-[720px] flex-col">
      <a href="#globe-viewport" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-panel focus:p-2">
        Skip to globe
      </a>
      <TopBar />
      <StatsStrip />
      <div className="relative flex min-h-0 flex-1">
        {leftOpen && (
          <div className={compact ? 'absolute bottom-0 left-0 top-0 z-40 w-[272px] shadow-[8px_0_24px_rgba(40,48,58,0.14)]' : 'w-[256px] shrink-0 xl:w-[272px]'}>
            <LeftPanel />
          </div>
        )}
        <main className="relative min-w-0 flex-1">
          {geoStatus === 'error' ? (
            <div className="flex h-full items-center justify-center p-8">
              <div className="w-[420px]">
                <ErrorState
                  title="Geographic boundary data failed to load"
                  detail={geoError ?? undefined}
                  action={<Button onClick={() => (useDataStore.setState({ geoStatus: 'idle' }), void useDataStore.getState().init())}>Retry</Button>}
                />
              </div>
            </div>
          ) : geoStatus !== 'ready' ? (
            <GlobeFallback />
          ) : (
            <Suspense fallback={<GlobeFallback label="Loading renderer…" />}>
              <GlobeView />
            </Suspense>
          )}
          {!leftOpen && (
            <IconButton label="Show analysis controls" className="absolute left-3 top-3 z-20 border border-line bg-panel" onClick={() => useAppStore.getState().setLeftOpen(true)}>
              <PanelLeftOpen size={14} />
            </IconButton>
          )}
          {!rightOpen && (
            <IconButton label="Show details panel" className="absolute right-14 top-3 z-20 border border-line bg-panel" onClick={() => useAppStore.getState().setRightOpen(true)}>
              <PanelRightOpen size={14} />
            </IconButton>
          )}
          <Overlays />
        </main>
        {rightOpen && (
          <div className={compact ? 'absolute bottom-0 right-0 top-0 z-40 w-[360px] max-w-[90vw] shadow-[-8px_0_24px_rgba(40,48,58,0.14)]' : 'w-[340px] shrink-0 2xl:w-[380px]'}>
            <RightPanel />
          </div>
        )}
      </div>
      <Timeline />
      <SearchPalette />
      <LiveFeedRunners />
    </div>
  );
}
