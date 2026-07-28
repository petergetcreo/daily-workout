#!/usr/bin/env python3
"""Generate the app icons with the standard library only (no Pillow needed).
Run: python3 make-icons.py"""

import struct
import zlib

BG      = (0x12, 0x15, 0x1C)
ACCENT  = (0xFF, 0x7A, 0x2F)


def png(path, size, pad_ratio):
    """pad_ratio shrinks the glyph so maskable icons survive being cropped."""
    px = [[BG for _ in range(size)] for _ in range(size)]
    s = size / 512.0
    scale = 1.0 - pad_ratio
    cx = cy = size / 2.0

    def rect(x0, y0, x1, y1, r=0):
        # coordinates are in 512-space, centred then scaled for padding
        x0 = cx + (x0 * s - cx) * scale
        x1 = cx + (x1 * s - cx) * scale
        y0 = cy + (y0 * s - cy) * scale
        y1 = cy + (y1 * s - cy) * scale
        r = r * s * scale
        for y in range(max(0, int(y0)), min(size, int(y1) + 1)):
            for x in range(max(0, int(x0)), min(size, int(x1) + 1)):
                if r > 0:
                    dx = max(x0 + r - x, 0, x - (x1 - r))
                    dy = max(y0 + r - y, 0, y - (y1 - r))
                    if dx * dx + dy * dy > r * r:
                        continue
                px[y][x] = ACCENT

    # dumbbell, drawn in a 512x512 coordinate space
    rect(158, 238, 354, 274, 14)   # bar
    rect(118, 176, 162, 336, 18)   # inner plate, left
    rect(350, 176, 394, 336, 18)   # inner plate, right
    rect(84,  208, 118, 304, 15)   # outer plate, left
    rect(394, 208, 428, 304, 15)   # outer plate, right

    raw = b''.join(b'\x00' + b''.join(bytes(p) for p in row) for row in px)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))
    print('wrote', path, size)


png('icons/icon-192.png', 192, 0.10)
png('icons/icon-512.png', 512, 0.10)
png('icons/icon-maskable-512.png', 512, 0.30)
