#!/usr/bin/env python3
"""Rasterize marketing favicon, apple touch icon, and Open Graph image.

Source marks: public/brand/rider-icon.svg and public/brand/driver-icon.svg
(the Liquid Glass rider pin and driver wheel).
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "public" / "brand"
PUBLIC = ROOT / "public"
RIDER = BRAND / "rider-icon.svg"
DRIVER = BRAND / "driver-icon.svg"
FONT = "/usr/share/fonts/truetype/macos/Inter-SemiBold.ttf"
FONT_REG = "/usr/share/fonts/truetype/macos/Inter-Medium.ttf"


def rasterize(svg: Path, size: int) -> Image.Image:
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        subprocess.check_call(
            ["rsvg-convert", "-w", str(size), "-h", str(size), "-o", tmp.name, str(svg)],
            stdout=subprocess.DEVNULL,
        )
        return Image.open(tmp.name).convert("RGBA")


def round_icon(image: Image.Image, radius_ratio: float = 0.22) -> Image.Image:
    size = image.size[0]
    radius = int(size * radius_ratio)
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.paste(image, (0, 0), mask)
    return out


def flatten(image: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    base = Image.new("RGBA", image.size, color + (255,))
    return Image.alpha_composite(base, image).convert("RGB")


def radial(canvas: Image.Image, center: tuple[int, int], radius: int, color: tuple[int, int, int], alpha: int) -> None:
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx, cy = center
    for step in range(28, 0, -1):
        t = step / 28
        r = int(radius * t)
        a = int(alpha * (1 - t) ** 1.6)
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color + (a,))
    canvas.alpha_composite(layer)


def shadow_paste(canvas: Image.Image, icon: Image.Image, xy: tuple[int, int]) -> None:
    shade = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    mask = icon.getchannel("A")
    black = Image.new("RGBA", icon.size, (26, 10, 40, 150))
    shade.paste(black, (xy[0], xy[1] + 18), mask)
    shade = shade.filter(ImageFilter.GaussianBlur(22))
    canvas.alpha_composite(shade)
    canvas.paste(icon, xy, icon)


def og_image(rider: Image.Image, driver: Image.Image) -> Image.Image:
    width, height = 1200, 630
    canvas = Image.new("RGBA", (width, height), (246, 243, 248, 255))
    radial(canvas, (180, 40), 520, (245, 102, 0), 150)
    radial(canvas, (1040, 80), 480, (82, 45, 128), 130)
    radial(canvas, (600, 640), 420, (255, 255, 255), 180)
    icon = 280
    rider_icon = round_icon(rider.resize((icon, icon), Image.Resampling.LANCZOS))
    driver_icon = round_icon(driver.resize((icon, icon), Image.Resampling.LANCZOS))
    y = 118
    shadow_paste(canvas, rider_icon, (250, y))
    shadow_paste(canvas, driver_icon, (670, y))
    draw = ImageDraw.Draw(canvas)
    title = ImageFont.truetype(FONT, 64)
    sub = ImageFont.truetype(FONT_REG, 28)
    name = "Clemson RIDES"
    line = "Rider and driver"
    name_w = draw.textlength(name, font=title)
    line_w = draw.textlength(line, font=sub)
    draw.text(((width - name_w) / 2, 448), name, font=title, fill=(26, 16, 40, 255))
    draw.text(((width - line_w) / 2, 528), line, font=sub, fill=(82, 45, 128, 255))
    return canvas.convert("RGB")


def main() -> None:
    rider_32 = rasterize(RIDER, 32)
    rider_180 = rasterize(RIDER, 180)
    rider_1024 = rasterize(RIDER, 1024)
    driver_1024 = rasterize(DRIVER, 1024)
    favicon = flatten(rider_32, (245, 102, 0))
    favicon.save(PUBLIC / "favicon.png", "PNG", optimize=True)
    favicon.save(PUBLIC / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])
    flatten(rider_180, (245, 102, 0)).save(PUBLIC / "apple-touch-icon.png", "PNG", optimize=True)
    og_image(rider_1024, driver_1024).save(PUBLIC / "og-image.png", "PNG", optimize=True)
    print("wrote favicon, apple-touch-icon, og-image")


if __name__ == "__main__":
    main()
