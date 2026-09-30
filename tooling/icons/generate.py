#!/usr/bin/env python3
"""Placeholder PWA icons (M7-7): a white bowl on the app's green, drawn without dependencies.

The bowl stays inside the central 80 % circle, so the same image works as a maskable icon.
Run from the repo root: python3 tooling/icons/generate.py
"""
import struct
import zlib
from pathlib import Path

GREEN = (0x2F, 0x6F, 0x3E)
WHITE = (0xFF, 0xFF, 0xFF)
OUT = Path(__file__).resolve().parents[2] / 'apps' / 'web' / 'public' / 'icons'


def pixel(x: float, y: float) -> tuple[int, int, int]:
    """Colour at (x, y) in a unit square."""
    cx, cy = 0.5, 0.46
    # Bowl: the lower half of a disc, with a flat rim.
    if y >= cy and (x - cx) ** 2 + (y - cy) ** 2 <= 0.29**2:
        return WHITE
    if cy - 0.035 <= y < cy and abs(x - cx) <= 0.33:
        return WHITE
    # Steam: two short strokes above the bowl.
    for sx in (0.42, 0.58):
        if abs(x - sx) <= 0.025 and 0.22 <= y <= 0.36:
            return WHITE
    return GREEN


def png(size: int) -> bytes:
    rows = bytearray()
    for py in range(size):
        rows.append(0)  # filter: none
        for px in range(size):
            # 2x2 supersampling for smooth edges.
            samples = [pixel((px + dx) / size, (py + dy) / size) for dx in (0.25, 0.75) for dy in (0.25, 0.75)]
            rows.extend(sum(s[i] for s in samples) // 4 for i in range(3))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

    header = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b'')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        (OUT / f'icon-{size}.png').write_bytes(png(size))
    (OUT / 'apple-touch-icon.png').write_bytes(png(180))
    print(f'Wrote icons to {OUT}')
