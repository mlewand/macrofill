import { describe, expect, it } from 'vitest';
import { localDay, timeZoneSchema, timestampSchema, userSchema } from '../src/index.js';

describe('M2-5: consumption counts toward the day in the user timezone', () => {
  it.each([
    ['winter (CET, UTC+1)', '2026-01-15T22:30:00.000Z', '2026-01-15'],
    ['summer (CEST, UTC+2)', '2026-07-15T21:30:00.000Z', '2026-07-15'],
    ['the night DST starts', '2026-03-28T22:30:00.000Z', '2026-03-28'],
    ['the night DST ends', '2026-10-24T21:30:00.000Z', '2026-10-24'],
  ])('a meal at 23:30 Warsaw time in %s counts toward that Warsaw day', (_when, utc, day) => {
    expect(localDay(utc, 'Europe/Warsaw')).toBe(day);
  });

  it('a meal just after local midnight counts toward the next day', () => {
    expect(localDay('2026-01-15T23:00:00.000Z', 'Europe/Warsaw')).toBe('2026-01-16');
  });

  it('the same instant falls on different days in different timezones', () => {
    const instant = '2026-01-15T23:30:00.000Z';
    expect(localDay(instant, 'UTC')).toBe('2026-01-15');
    expect(localDay(instant, 'Europe/Warsaw')).toBe('2026-01-16');
    expect(localDay(instant, 'America/New_York')).toBe('2026-01-15');
  });

  it('rejects an invalid timezone', () => {
    expect(() => localDay('2026-01-15T23:30:00.000Z', 'Mars/Olympus')).toThrow();
  });

  it('timestamps are UTC ISO strings; offsets are rejected', () => {
    expect(timestampSchema.safeParse('2026-01-15T22:30:00.000Z').success).toBe(true);
    expect(timestampSchema.safeParse('2026-01-15T22:30:00Z').success).toBe(true);
    expect(timestampSchema.safeParse('2026-01-15T23:30:00+01:00').success).toBe(false);
    expect(timestampSchema.safeParse('2026-01-15').success).toBe(false);
  });

  it('a user timezone must be an IANA name', () => {
    const user = { id: 'b2a5c1de-1f2a-4c3b-8d4e-5f6a7b8c9d0e', username: 'marek' };
    expect(userSchema.safeParse({ ...user, timezone: 'Europe/Warsaw' }).success).toBe(true);
    expect(userSchema.safeParse({ ...user, timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(userSchema.safeParse({ ...user, timezone: '+01:00' }).success).toBe(false);
    expect(userSchema.safeParse({ ...user, timezone: '-0500' }).success).toBe(false);
  });

  it.each(['UTC', 'CST6CDT', 'EST5EDT', 'Etc/GMT+1', 'America/Argentina/Buenos_Aires'])(
    'accepts the IANA name %s',
    (timezone) => {
      expect(timeZoneSchema.safeParse(timezone).success).toBe(true);
    },
  );
});
