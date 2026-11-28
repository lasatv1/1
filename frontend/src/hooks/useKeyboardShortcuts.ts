import { useEffect } from 'react';
import { useAppStore } from '@/state/appStore';
import { useGlobeStore } from '@/state/globeStore';
import { goGlobal, toggleFullscreen } from '@/components/globe/GlobeControls';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** G global · R reset · F fullscreen · Esc close · / search. */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const app = useAppStore.getState();
      if (e.key === 'Escape') {
        if (app.searchOpen) app.setSearchOpen(false);
        else if (document.fullscreenElement) return; // browser exits fullscreen itself
        else if (app.overlay !== 'none') app.setOverlay('none');
        else if (app.inspect || app.selected.length) app.closeInspector();
        return;
      }
      if (isTyping(e.target) || app.searchOpen) return;
      switch (e.key) {
        case '/':
          e.preventDefault();
          app.setSearchOpen(true);
          break;
        case 'g':
        case 'G':
          goGlobal();
          break;
        case 'r':
        case 'R':
          useGlobeStore.getState().resetCamera();
          break;
        case 'f':
        case 'F':
          toggleFullscreen(document.getElementById('globe-viewport'));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
