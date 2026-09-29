import { useEffect, useRef, useState } from 'react';
import { onSelectionChanged, readDocumentStats, type DocumentStats } from './wordDocument';

/**
 * Live size of the document and the selection, for the limits bar.
 * Refreshes when the selection moves and whenever refreshKey changes (e.g. after an edit).
 */
export function useDocumentStats(refreshKey: unknown): DocumentStats | null {
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (typeof Word === 'undefined') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Reading the whole body is not free, so selection changes are debounced
    refreshRef.current = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        readDocumentStats()
          .then(next => { if (!cancelled) setStats(next); })
          .catch(() => { /* e.g. the document is busy; the next change retries */ });
      }, 400);
    };

    refreshRef.current();
    const unsubscribe = onSelectionChanged(() => refreshRef.current());
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    refreshRef.current();
  }, [refreshKey]);

  return stats;
}
