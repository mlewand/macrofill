import { z } from 'zod';
import { idSchema, timestampSchema } from './common.js';
import { lookupAttemptSchema } from './lookup.js';

// M7-8: the usage event catalog. Names and props are defined here only; the web app tracks them
// with a typed `track(name, props)` and the api validates them (M4-10). No personal data: ids,
// durations and the choices made in the flow.

const inputMethod = z.enum(['scale', 'direct']);
const durationMs = z.number().int().nonnegative();
/** The step's index in the recipe, from 0. */
const step = z.number().int().nonnegative();

const props = {
  flow_started: z.object({ inputMethod }),
  /** Saved: from the recipe pick to the save. */
  flow_finished: z.object({ inputMethod, durationMs }),
  /** Discarded or left without saving. */
  flow_abandoned: z.object({ inputMethod, durationMs }),
  /** From the step showing to it being recorded. */
  step_completed: z.object({
    inputMethod,
    step,
    durationMs,
    weightSource: z.enum(['scale', 'manual']),
  }),
  step_skipped: z.object({ inputMethod, step }),
  step_undone: z.object({ inputMethod, step }),
  /** Typed grams replacing the scale's (M6-5). */
  manual_correction: z.object({ inputMethod, step }),
  scale_disconnected: z.object({}),
  /** From the drop to the connection being back (M6-6). */
  scale_reconnected: z.object({ durationMs }),
  /** #66-6: an unknown barcode looked up in the providers, each one's result. No barcode. */
  product_lookup: z.object({ attempts: z.array(lookupAttemptSchema).max(10) }),
} as const;

export type UsageEventName = keyof typeof props;
export type UsageEventProps<N extends UsageEventName> = z.infer<(typeof props)[N]>;

const common = {
  /** Client-generated, so a retried batch stores each event once. */
  id: idSchema,
  /** One per page load. */
  clientSessionId: idSchema,
  occurredAt: timestampSchema,
  /** The web build that sent it. */
  appVersion: z.string().min(1).max(64),
};

export const usageEventSchema = z.discriminatedUnion('name', [
  z
    .object({ ...common, name: z.literal('flow_started'), props: props.flow_started.strict() })
    .strict(),
  z
    .object({ ...common, name: z.literal('flow_finished'), props: props.flow_finished.strict() })
    .strict(),
  z
    .object({ ...common, name: z.literal('flow_abandoned'), props: props.flow_abandoned.strict() })
    .strict(),
  z
    .object({ ...common, name: z.literal('step_completed'), props: props.step_completed.strict() })
    .strict(),
  z
    .object({ ...common, name: z.literal('step_skipped'), props: props.step_skipped.strict() })
    .strict(),
  z
    .object({ ...common, name: z.literal('step_undone'), props: props.step_undone.strict() })
    .strict(),
  z
    .object({
      ...common,
      name: z.literal('manual_correction'),
      props: props.manual_correction.strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      name: z.literal('scale_disconnected'),
      props: props.scale_disconnected.strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      name: z.literal('scale_reconnected'),
      props: props.scale_reconnected.strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      name: z.literal('product_lookup'),
      props: props.product_lookup.strict(),
    })
    .strict(),
]);

export type UsageEvent = z.infer<typeof usageEventSchema>;

/** Most events in one `POST /events`. */
export const MAX_EVENT_BATCH = 100;

/** `POST /events` (M4-10). */
export const usageEventBatchSchema = z.object({
  events: z.array(usageEventSchema).min(1).max(MAX_EVENT_BATCH),
});

export type UsageEventBatch = z.infer<typeof usageEventBatchSchema>;
