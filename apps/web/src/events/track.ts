import type { UsageEvent, UsageEventName, UsageEventProps } from '@macrofill/domain';
import { createContext, useContext } from 'react';

export type Track = <N extends UsageEventName>(name: N, props: UsageEventProps<N>) => void;

export interface UsageTracker {
  /** Never throws and never waits: tracking must not break or block the UI (M7-8). */
  track: Track;
  /** Sends what's waiting now (e.g. when the page is hidden). Never rejects. */
  flush: () => Promise<void>;
}

/**
 * M7-8: queues usage events and sends them in batches to `POST /events` (M4-10): a few seconds
 * after the first one, or as soon as a batch is full. A failed send keeps the events for the next
 * one, up to `maxQueued`, dropping the oldest beyond that.
 */
export function createUsageTracker(options: {
  send: (events: UsageEvent[]) => Promise<void>;
  appVersion: string;
  clientSessionId: string;
  newId: () => string;
  flushAfterMs?: number;
  batchSize?: number;
  maxQueued?: number;
  /** Whether a failed send may succeed later; if not, its batch is dropped. Default: always. */
  retryable?: (error: unknown) => boolean;
}): UsageTracker {
  const { send, appVersion, clientSessionId, newId } = options;
  const flushAfterMs = options.flushAfterMs ?? 5000;
  const batchSize = options.batchSize ?? 20;
  const maxQueued = options.maxQueued ?? 500;
  const retryable = options.retryable ?? (() => true);
  let queue: UsageEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending: Promise<void> | undefined;

  const flush = async (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    // One send at a time: a flush meanwhile waits, then sends what's still left.
    while (sending) await sending;
    if (queue.length === 0) return;
    const batch = queue.slice(0, 100);
    const current = (async () => {
      try {
        await send(batch);
        queue = queue.filter((e) => !batch.includes(e));
      } catch (error) {
        // Kept for the next send, unless retrying can't help.
        if (!retryable(error)) queue = queue.filter((e) => !batch.includes(e));
      }
    })();
    sending = current;
    await current;
    if (sending === current) sending = undefined;
    // More than a batch, or a failed send: try again later.
    if (queue.length > 0) timer ??= setTimeout(() => void flush(), flushAfterMs);
  };

  const track: Track = (name, props) => {
    try {
      const event = {
        id: newId(),
        clientSessionId,
        occurredAt: new Date().toISOString(),
        appVersion,
        name,
        props,
      } as UsageEvent;
      queue.push(event);
      if (queue.length > maxQueued) queue = queue.slice(queue.length - maxQueued);
      if (queue.length >= batchSize) void flush();
      else timer ??= setTimeout(() => void flush(), flushAfterMs);
    } catch {
      // Tracking never breaks the app.
    }
  };

  return { track, flush };
}

/** Tracks nothing: the default, so components work without a provider. */
export const TrackContext = createContext<Track>(() => undefined);

export const useTrack = () => useContext(TrackContext);

/** Tracks one of the events `flowEvents` makes: a name and its props, as the catalog pairs them. */
export function trackFlowEvent(
  track: Track,
  event: { [N in UsageEventName]: { name: N; props: UsageEventProps<N> } }[UsageEventName],
): void {
  // The union pairs each name with its props; `Track` is generic over one name at a time.
  (track as (name: UsageEventName, props: unknown) => void)(event.name, event.props);
}
