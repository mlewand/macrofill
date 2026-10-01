import type { UsageEventName, UsageEventProps } from '@macrofill/domain';
import { isSummary, type DirectEntryState } from '../directEntry/state';

export type FlowEvent = {
  [N in UsageEventName]: { name: N; props: UsageEventProps<N> };
}[UsageEventName];

/**
 * M7-8: the usage events of one change to a meal flow, from the state before and after it.
 * `durationMs`: how long the step was shown before it was completed.
 */
export function flowEvents(
  before: DirectEntryState,
  after: DirectEntryState,
  durationMs: number,
): FlowEvent[] {
  const { inputMethod } = after;
  const step = before.current;
  if (after.current > step) {
    // Usually one step; in Scale Mode a tracker event can record a few at once. The time shown
    // counts for the first.
    const events: FlowEvent[] = [];
    for (let i = step; i < Math.min(after.current, after.steps.length); i++) {
      events.push(...completed(after, i, i === step ? durationMs : 0));
    }
    return events;
  }
  if (after.current === step - 1) {
    return [{ name: 'step_undone', props: { inputMethod, step: after.current } }];
  }
  // In the summary: the scale's amount of a step replaced by typed grams (M5-6).
  if (inputMethod === 'scale' && isSummary(before) && isSummary(after)) {
    const corrected = after.steps.findIndex(
      (draft, i) => before.steps[i]!.fromScale === true && draft.fromScale !== true,
    );
    if (corrected !== -1) {
      return [{ name: 'manual_correction', props: { inputMethod, step: corrected } }];
    }
  }
  return [];
}

function completed(state: DirectEntryState, step: number, durationMs: number): FlowEvent[] {
  const { inputMethod } = state;
  const draft = state.steps[step]!;
  if (draft.skipped) return [{ name: 'step_skipped', props: { inputMethod, step } }];
  const weightSource = draft.fromScale ? 'scale' : 'manual';
  const events: FlowEvent[] = [
    {
      name: 'step_completed',
      props: { inputMethod, step, durationMs: Math.max(0, Math.round(durationMs)), weightSource },
    },
  ];
  // In Scale Mode, typed grams replace what the scale would record (M6-5).
  if (inputMethod === 'scale' && weightSource === 'manual') {
    events.push({ name: 'manual_correction', props: { inputMethod, step } });
  }
  return events;
}
