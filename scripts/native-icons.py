#!/usr/bin/env python3
"""Draw distinct rider and driver app icons with the stdlib only."""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, width, height, pixel):
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(pixel(x, y))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def blend(dst, src, cover):
    if cover <= 0:
        return dst
    if cover >= 1:
        return src
    return tuple(int(dst[i] * (1 - cover) + src[i] * cover) for i in range(4))


def circle(x, y, cx, cy, r):
    d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
    if d <= r - 1:
        return 1.0
    if d >= r + 1:
        return 0.0
    return max(0.0, min(1.0, r + 1 - d))


def round_rect(x, y, w, h, r):
    if r <= x < w - r and r <= y < h - r:
        return 1.0
    if x < r and y < r:
        return circle(x, y, r, r, r)
    if x >= w - r and y < r:
        return circle(x, y, w - r, r, r)
    if x < r and y >= h - r:
        return circle(x, y, r, h - r, r)
    if x >= w - r and y >= h - r:
        return circle(x, y, w - r, h - r, r)
    if 0 <= x < w and 0 <= y < h:
        return 1.0
    return 0.0


def rider_pixel(size, glyph_only=False):
    orange = (245, 102, 0, 255)
    white = (255, 255, 255, 255)

    def pixel(x, y):
        sx = x * 1024 / size
        sy = y * 1024 / size
        bg = (0, 0, 0, 0) if glyph_only else orange
        if not glyph_only:
            cover = round_rect(sx, sy, 1024, 1024, 180)
            bg = blend((0, 0, 0, 0), orange, cover)
        # paw: main pad + four toes
        pads = [
            (512, 620, 210),
            (330, 360, 78),
            (450, 300, 86),
            (580, 300, 86),
            (700, 360, 78),
        ]
        cover = 0
        for cx, cy, r in pads:
            cover = max(cover, circle(sx, sy, cx, cy, r))
        return blend(bg, white, cover)

    return pixel


def driver_pixel(size, glyph_only=False):
    purple = (82, 45, 128, 255)
    white = (255, 255, 255, 255)

    def pixel(x, y):
        sx = x * 1024 / size
        sy = y * 1024 / size
        bg = (0, 0, 0, 0) if glyph_only else purple
        if not glyph_only:
            bg = blend((0, 0, 0, 0), purple, round_rect(sx, sy, 1024, 1024, 180))
        # simple car: body, cabin, two wheels
        body = round_rect(sx - 180, sy - 470, 660, 220, 70)
        cabin = round_rect(sx - 300, sy - 360, 360, 150, 40)
        wheel_l = circle(sx, sy, 320, 700, 70)
        wheel_r = circle(sx, sy, 700, 700, 70)
        cover = max(body, cabin, wheel_l, wheel_r)
        return blend(bg, white, cover)

    return pixel


def solid(color):
    def pixel(_x, _y):
        return color
    return pixel


def emit(app, painter, bg):
    base = ROOT / "apps" / app / "assets" / "images"
    write_png(base / "icon.png", 1024, 1024, painter(1024))
    write_png(base / "splash-icon.png", 512, 512, painter(512, glyph_only=True))
    write_png(base / "android-icon-foreground.png", 1024, 1024, painter(1024, glyph_only=True))
    write_png(base / "android-icon-background.png", 1024, 1024, solid(bg))
    write_png(base / "android-icon-monochrome.png", 1024, 1024, painter(1024, glyph_only=True))
    write_png(base / "favicon.png", 48, 48, painter(48))


if __name__ == "__main__":
    emit("rider", rider_pixel, (245, 102, 0, 255))
    emit("driver", driver_pixel, (82, 45, 128, 255))
    print("icons written")
