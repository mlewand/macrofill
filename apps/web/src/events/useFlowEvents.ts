import { useEffect, useRef } from 'react';
import type { DirectEntryState } from '../directEntry/state';
import { flowEvents } from './flowEvents';
import { trackFlowEvent, useTrack } from './track';

/**
 * M7-8: tracks each step completed, skipped or undone in a meal flow, with how long the step was
 * shown. A session resumed after a reload starts from where it was, with no events for it.
 */
export function useFlowEvents(flow: DirectEntryState | undefined): void {
  const track = useTrack();
  const previous = useRef(flow);
  /** When the current step showed: set by the first run, and by every step change since. */
  const stepShownAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    const before = previous.current;
    previous.current = flow;
    const now = performance.now();
    const shownAt = stepShownAt.current;
    if (
      shownAt !== undefined &&
      before &&
      flow &&
      before !== flow &&
      before.mealId === flow.mealId
    ) {
      for (const event of flowEvents(before, flow, now - shownAt)) trackFlowEvent(track, event);
    }
    if (
      shownAt === undefined ||
      before?.current !== flow?.current ||
      before?.mealId !== flow?.mealId
    ) {
      stepShownAt.current = now;
    }
  }, [flow, track]);
}

/** Whole ms since the meal flow started (`startedAt`), for flow finished and abandoned. */
export function sinceStart(startedAt: string): number {
  return Math.max(0, Math.round(Date.now() - Date.parse(startedAt)));
}
