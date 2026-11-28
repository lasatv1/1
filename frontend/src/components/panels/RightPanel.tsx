import { ArrowLeft, PanelRightClose, X } from 'lucide-react';
import { useAppStore } from '@/state/appStore';
import { useDataStore } from '@/state/dataStore';
import { IconButton, Skeleton, ErrorState, Button } from '@/components/common/ui';
import { CountryProfile } from './CountryProfile';
import { ConnectionInvestigation } from './ConnectionInvestigation';
import { EventDetail, IpInvestigation } from './EntityViews';
import { ComparisonView, GlobalOverview, RegionProfile } from './GroupViews';
import { LiveEntityView } from './LiveViews';

const TITLE = {
  country: 'Country intelligence profile',
  compare: 'Country comparison',
  region: 'Region profile',
  connection: 'Connection investigation',
  ip: 'IP investigation',
  event: 'Event detail',
  live: 'Live object',
} as const;

export function RightPanel() {
  const inspect = useAppStore((s) => s.inspect);
  const history = useAppStore((s) => s.history);
  const back = useAppStore((s) => s.back);
  const close = useAppStore((s) => s.closeInspector);
  const setOpen = useAppStore((s) => s.setRightOpen);
  const status = useDataStore((s) => s.datasetStatus);
  const error = useDataStore((s) => s.datasetError);

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-line bg-panel" aria-label="Details" aria-live="polite">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        {history.length > 0 && (
          <IconButton label="Back" onClick={back}>
            <ArrowLeft size={14} />
          </IconButton>
        )}
        <span className="flex-1 truncate px-1 text-sm font-medium text-ink">{inspect ? TITLE[inspect.kind] : 'Overview'}</span>
        {inspect && (
          <IconButton label="Close (Esc)" onClick={close}>
            <X size={14} />
          </IconButton>
        )}
        <IconButton label="Collapse panel" onClick={() => setOpen(false)}>
          <PanelRightClose size={14} />
        </IconButton>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4" key={inspect ? JSON.stringify(inspect) : 'overview'}>
        {status === 'loading' ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-64" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : status === 'error' ? (
          <ErrorState
            title="Could not load observations"
            detail={error ?? undefined}
            action={
              <div className="flex gap-2">
                <Button onClick={() => void useDataStore.getState().useLive()}>Retry</Button>
                <Button variant="ghost" onClick={() => useDataStore.getState().useDemo()}>
                  Use demonstration data
                </Button>
              </div>
            }
          />
        ) : !inspect ? (
          <GlobalOverview />
        ) : inspect.kind === 'country' ? (
          <CountryProfile id={inspect.id} />
        ) : inspect.kind === 'compare' ? (
          <ComparisonView />
        ) : inspect.kind === 'region' ? (
          <RegionProfile id={inspect.id} />
        ) : inspect.kind === 'connection' ? (
          <ConnectionInvestigation id={inspect.id} />
        ) : inspect.kind === 'ip' ? (
          <IpInvestigation ip={inspect.id} />
        ) : inspect.kind === 'live' ? (
          <LiveEntityView feed={inspect.feed} id={inspect.id} />
        ) : (
          <EventDetail id={inspect.id} />
        )}
      </div>
    </aside>
  );
}
