import { useSyncExternalStore } from 'react';

/**
 * How many AI requests are running anywhere in the add-in (any tab, any panel). The header shows a moving sign while
 * it is above zero, so it is clear that work goes on even after clicking elsewhere.
 */
let running = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

/** Counts the work as running until it settles, whichever way */
export async function trackActivity<T>(work: () => Promise<T>): Promise<T> {
  running++;
  notify();
  try {
    return await work();
  } finally {
    running--;
    notify();
  }
}

export const runningActivities = () => running;

export function useRunningActivities(): number {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    runningActivities,
    runningActivities,
  );
}
