import { useEffect } from 'react';
import { useDataStore } from '@/state/dataStore';
import { LIVE_FEED_BY_ID } from './feeds';
import { useLiveStore } from './liveStore';

const MAX_BACKOFF = 15 * 60 * 1000;

/** One independent refresh loop per enabled feed (toggling one never restarts the others). */
export function LiveFeedRunners() {
  const enabled = useLiveStore((s) => s.enabled);
  const histYear = useLiveStore((s) => s.histYear);
  return (
    <>
      {[...enabled].map((id) => (
        // The historical layer refetches when its year changes.
        <FeedRunner key={id === 'history' ? `history:${histYear}` : id} id={id} />
      ))}
    </>
  );
}

/**
 * Keeps one feed refreshing on its own interval, forever.
 * - Errors back off exponentially (never hammering a free service), then recover.
 * - While the tab is hidden the refresh waits; on return, an overdue feed refreshes at once.
 * - The last good data stays on screen through errors.
 */
function FeedRunner({ id }: { id: string }) {
  const geo = useDataStore((s) => s.geo);

  useEffect(() => {
    const def = LIVE_FEED_BY_ID[id];
    if (!geo || !def) return;
    let timer = 0;
    let failures = 0;
    let dueAt = 0;
    let disposed = false;
    let ctrl: AbortController | null = null;

    const run = async () => {
      if (disposed) return;
      if (document.hidden) {
        dueAt = 0; // refresh as soon as the page is visible again
        return;
      }
      ctrl?.abort();
      ctrl = new AbortController();
      const signal = ctrl.signal;
      const store = useLiveStore.getState();
      if (!store.feeds[id]?.data) store.setFeed(id, { status: 'loading' });
      let next = def.intervalMs;
      try {
        const data = await def.fetch({ geo, signal, histYear: useLiveStore.getState().histYear });
        if (disposed || signal.aborted) return;
        failures = 0;
        useLiveStore.getState().setFeed(id, { status: 'ok', data, error: null, updatedAt: Date.now() });
      } catch (e) {
        if (disposed || (e as Error).name === 'AbortError') return;
        failures += 1;
        next = Math.min(MAX_BACKOFF, Math.max(30_000, def.intervalMs) * 2 ** (failures - 1));
        useLiveStore.getState().setFeed(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
      if (disposed) return;
      dueAt = Date.now() + next;
      timer = window.setTimeout(() => void run(), next);
    };

    const onVisible = () => {
      if (!document.hidden && dueAt <= Date.now()) {
        clearTimeout(timer);
        void run();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    void run();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timer);
      ctrl?.abort();
    };
  }, [id, geo]);

  return null;
}
