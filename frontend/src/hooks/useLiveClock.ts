import { useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { useDataStore } from '@/state/dataStore';

const ROLL_MS = 30_000; // move the rolling window forward
const REFRESH_MS = 2 * 60_000; // check for newly published intelligence

/** Keeps the app live: the window follows the clock and new data is swapped in silently. */
export function useLiveClock() {
  useEffect(() => {
    const roll = () => {
      const { time, setTimePreset } = useAppStore.getState();
      if (time.preset !== 'custom') setTimePreset(time.preset, Date.now());
    };
    const refresh = () => {
      if (!document.hidden) void useDataStore.getState().refresh();
    };
    const a = setInterval(roll, ROLL_MS);
    const b = setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) {
        roll();
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(a);
      clearInterval(b);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
