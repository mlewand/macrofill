# TODO

Deferred from MVP0. Each item states the behavior that applies until it's done.

## Kcal consistency check for products

Warn when a product's kcal differs from 4·protein + 4·carbs + 9·fat + 2·fibre, and save only after the user confirms the values. A relative tolerance alone misfires on low-energy products because of label rounding, so use something like max(15%, 10 kcal).

Until then: no check.

## Tare and bowl-lift detection mid-meal

Unresolved. Cases to handle:

- tare between ingredients;
- lifting the bowl off the scale and putting it back;
- lifting a small food item (e.g. a 15 g piece of apple) and putting it back: it must still count as food;
- the scale re-zeroing after a power cycle during a disconnect.

Until then: only stable readings at Start and Next count, so anything lifted and put back before Next is harmless. A step amount below 0 (e.g. after a tare) asks for a manual correction (M3-6).

## Manual scale reconnect

For when automatic reconnect isn't possible or keeps failing: a Reconnect button (user gesture, device chooser), plus handling a possible new zero on the first reading after reconnecting.

Until then: automatic reconnect only (M6-6). If it fails, the meal can be finished with manual weights.

## Resume Scale Mode after page reload

Needs a reconnect (see above) and new-zero handling.

Until then: a reload resumes Direct Entry sessions only (M5-8).

## Negative item amounts

Net removal of an ingredient recorded as a negative item.

Until then: item grams must be ≥ 0.

## Usage data consent

Before serving other users: consent or opt-out for usage events, and including them in per-user data export and deletion (GDPR).

## Scale library changes (before Phase B)

Done in `@mlewand/huajun-ble-scale` 0.0.4 (library PR #1); nothing open:

- Monotonic timestamp: `Reading.receivedAtMonotonic`, alongside the unchanged `receivedAt`. Use it for `ScaleReading.timestamp`.
- `toReading(frame, times)` is exported, so `ReplayScaleDriver` can re-parse stored bytes with `parseFrame` + `toReading` (M3-11).
- `CapacitorTransport.deviceId` holds the picked device's ID, and `new CapacitorTransport({ deviceId })` connects to it without the chooser (M6-6). On the web this works within the page session of the first pick. After a reload it depends on Chrome's `navigator.bluetooth.getDevices()`, which is still behind a flag; see "Resume Scale Mode after page reload" above.

## Scale library from npm

`packages/scale` depends on `@mlewand/huajun-ble-scale` 0.0.4 through the tarball attached to the library's GitHub release `v0.0.4`, because pnpm's `minimumReleaseAge` held back the npm release when `HuajunDriver` was added. The tarball is the npm-published one (same integrity).

Switch to the npm version range (`^0.0.4`) once the hold has passed, and check that pnpm adds no `minimumReleaseAgeExclude` entry.
