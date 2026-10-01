# Scale captures

Raw notifications from the real Huajun scale, copied from `captures/` in
[`@mlewand/huajun-ble-scale`](https://github.com/mlewand/huajun-bluetooth-kitchen-scale-api) (MIT),
where `NOTES.md` describes each run. One JSON object per line: `t` (ms since the capture started)
and `hex` (the 8-byte frame). The replay tests turn them into recordings, so they re-parse real
bytes.

- `test4.jsonl`: empty scale, then an item placed about 6 s in; settles at 525.6 g.
- `item-placed-and-lifted.jsonl`: an item of about 24.8 g placed, then lifted between 6 and 7 s.
- `unit-cycle.jsonl`: empty scale, UNIT pressed to cycle g → lb:oz → oz → ml → fl.oz → g.
