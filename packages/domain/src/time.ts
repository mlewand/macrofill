import { z } from 'zod';
import { idSchema } from './common.js';

function isTimeZone(name: string): boolean {
  // Intl also accepts bare offsets like `+01:00`, which aren't IANA names and don't follow DST.
  if (/^[+-]/.test(name)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .refine(isTimeZone, { message: 'Not an IANA timezone name.' });

export const userSchema = z.object({
  id: idSchema,
  username: z.string().min(1),
  /** IANA name; decides which day a consumption entry counts toward (M2-5). */
  timezone: timeZoneSchema,
});

export type User = z.infer<typeof userSchema>;

/**
 * M2-5: the calendar day (`YYYY-MM-DD`) an instant falls on in the given timezone.
 * Timestamps are stored in UTC; this is where they turn into the user's day.
 */
export function localDay(instant: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
