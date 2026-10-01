import type { Reading } from '@mlewand/huajun-ble-scale';
import type { ScaleReading } from './driver.js';

/**
 * M3-13: maps the library's reading to a driver reading. The library decodes the bytes; a reading
 * in another unit has no grams (M3-14).
 */
export function toScaleReading(reading: Reading): ScaleReading {
  const mapped: ScaleReading = {
    timestamp: reading.receivedAtMonotonic,
    receivedAt: reading.receivedAt,
    raw: reading.raw,
  };
  if (reading.grams !== undefined) mapped.grams = reading.grams;
  if (reading.stable !== undefined) mapped.stable = reading.stable;
  return mapped;
}
