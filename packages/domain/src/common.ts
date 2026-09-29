import { z } from 'zod';

/** Entity IDs are client-generated UUIDs, so saves can be retried safely. */
export const idSchema = z.uuid();

/** A stable, human-readable id for curated content, e.g. `curd` or `wholegrain-bread`. */
export const slugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** An instant, as an ISO 8601 string in UTC (`Z`). Offsets are rejected. */
export const timestampSchema = z.iso.datetime();

/** Curated content text. Only English is authored for now. */
export const localizedTextSchema = z.object({
  en: z.string().min(1),
  pl: z.string().min(1).optional(),
});

export type LocalizedText = z.infer<typeof localizedTextSchema>;
