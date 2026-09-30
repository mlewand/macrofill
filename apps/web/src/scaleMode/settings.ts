import { defaultTrackerConfig, type TrackerConfig } from '@macrofill/domain';

/**
 * Weight tracker settings for Scale Mode, in one place for tuning on the real scale: stability
 * tolerance and window (M3-5), the wait for a stable Next (M3-4), and how far below 0 an amount
 * counts as 0 (M3-6).
 */
export const trackerSettings: TrackerConfig = { ...defaultTrackerConfig };
