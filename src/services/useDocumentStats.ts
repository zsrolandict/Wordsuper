import { useEffect, useRef, useState } from 'react';
import { onSelectionChanged, readDocumentLength, readSelectionLength } from './wordDocument';

export interface DocumentStats {
  documentChars: number | null;
  selectionChars: number | null;
}

// Reading the whole body goes over the Office bridge; on a long contract that's expensive, so it's throttled
const DOCUMENT_REFRESH_MS = 10_000;
const SELECTION_DEBOUNCE_MS = 400;

/**
 * Live size of the document and the selection, for the limits bar.
 * The selection is re-read when it moves; the document size at most every 10 s while the cursor moves
 * (a skipped read is done later, so the size never goes stale), and right away when refreshKey changes.
 */
export function useDocumentStats(refreshKey: unknown): DocumentStats {
  const [stats, setStats] = useState<DocumentStats>({ documentChars: null, selectionChars: null });
  const refreshRef = useRef<(forceDocument: boolean) => void>(() => {});

  useEffect(() => {
    if (typeof Word === 'undefined') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let documentTimer: ReturnType<typeof setTimeout> | undefined;
    let lastDocumentRead = 0;

    const readDocument = async () => {
      clearTimeout(documentTimer);
      documentTimer = undefined;
      lastDocumentRead = Date.now();
      try {
        const documentChars = await readDocumentLength();
        if (!cancelled) setStats(prev => ({ ...prev, documentChars }));
      } catch {
        // E.g. the document is busy; the next change retries
      }
    };

    refreshRef.current = (forceDocument) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const selectionChars = await readSelectionLength();
          if (!cancelled) setStats(prev => ({ ...prev, selectionChars }));
        } catch {
          // E.g. the document is busy; the next change retries
        }
        const sinceLastRead = Date.now() - lastDocumentRead;
        if (forceDocument || sinceLastRead >= DOCUMENT_REFRESH_MS) {
          await readDocument();
        } else if (!documentTimer) {
          // Throttled: read it once the interval is over, so a change is never missed
          documentTimer = setTimeout(readDocument, DOCUMENT_REFRESH_MS - sinceLastRead);
        }
      }, SELECTION_DEBOUNCE_MS);
    };

    refreshRef.current(true);
    const unsubscribe = onSelectionChanged(() => refreshRef.current(false));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(documentTimer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    refreshRef.current(true);
  }, [refreshKey]);

  return stats;
}
