// The main entry has no drivers, so importing it loads neither Capacitor nor the mock. The drivers
// have their own entries: `@macrofill/scale/huajun`, `@macrofill/scale/mock` and
// `@macrofill/scale/replay`.
export * from './driver.js';
export * from './script.js';
export * from './recording.js';
