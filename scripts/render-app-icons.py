#!/usr/bin/env python3
"""Rasterize the rider and driver Liquid Glass icons.

Source of truth: apps/{rider,driver}/assets/brand/icon.svg
Outputs the files app.json already points at:

  assets/images/icon.png                      1024 RGB, no alpha (iOS / Expo)
  assets/images/android-icon-background.png   1024 RGB
  assets/images/android-icon-foreground.png   1024 RGBA glyph
  assets/images/android-icon-monochrome.png   1024 RGBA glyph
  assets/images/splash-icon.png               1024 RGBA glyph
  assets/images/favicon.png                   48 RGB

Requires rsvg-convert (librsvg2-bin) and Pillow.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)

APPS = {
    "rider": "#F56600",
    "driver": "#522D80",
}

# Root groups kept for each export. Anything else at the root is removed.
LAYERS = {
    "icon": {"background", "shadow", "glyph", "gloss"},
    "background": {"background"},
    "foreground": {"shadow", "glyph", "gloss"},
    "monochrome": {"glyph"},
    "splash": {"shadow", "glyph", "gloss"},
}


def flatten(image: Image.Image, fallback: str) -> Image.Image:
    """Composite onto an opaque brand color and drop the alpha channel."""
    hex_color = fallback.lstrip("#")
    rgb = tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
    base = Image.new("RGBA", image.size, rgb + (255,))
    return Image.alpha_composite(base, image.convert("RGBA")).convert("RGB")


def write_variant(source: Path, keep: set[str], dest_svg: Path) -> None:
    tree = ET.parse(source)
    root = tree.getroot()
    for child in list(root):
        if child.tag == f"{{{SVG_NS}}}g" and child.get("id") not in keep:
            root.remove(child)
    tree.write(dest_svg, encoding="utf-8", xml_declaration=True)


def rasterize(svg: Path, png: Path, size: int) -> None:
    subprocess.check_call(
        ["rsvg-convert", "-w", str(size), "-h", str(size), "-o", str(png), str(svg)],
        stdout=subprocess.DEVNULL,
    )


def png_color_type(path: Path) -> int:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path} is not a PNG")
    return data[8 + 8 + 9]  # IHDR color type


def render_app(name: str, fallback: str) -> None:
    brand = ROOT / "apps" / name / "assets" / "brand" / "icon.svg"
    images = ROOT / "apps" / name / "assets" / "images"
    if not brand.is_file():
        raise SystemExit(f"missing {brand}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        rendered: dict[str, Image.Image] = {}
        for layer, keep in LAYERS.items():
            svg = tmp_path / f"{layer}.svg"
            png = tmp_path / f"{layer}.png"
            write_variant(brand, keep, svg)
            rasterize(svg, png, 1024)
            rendered[layer] = Image.open(png).convert("RGBA")

        icon = flatten(rendered["icon"], fallback)
        background = flatten(rendered["background"], fallback)
        if icon.size != (1024, 1024) or background.size != (1024, 1024):
            raise SystemExit(f"{name}: expected 1024 square icons")

        icon.save(images / "icon.png", "PNG", optimize=True)
        background.save(images / "android-icon-background.png", "PNG", optimize=True)
        rendered["foreground"].save(images / "android-icon-foreground.png", "PNG", optimize=True)
        rendered["monochrome"].save(images / "android-icon-monochrome.png", "PNG", optimize=True)
        rendered["splash"].save(images / "splash-icon.png", "PNG", optimize=True)
        icon.resize((48, 48), Image.Resampling.LANCZOS).save(images / "favicon.png", "PNG", optimize=True)

        composite = Image.alpha_composite(background.convert("RGBA"), rendered["foreground"]).convert("RGB")
        diff = ImageChops.difference(composite, icon)
        worst = max(channel[1] for channel in diff.getextrema())
        if worst > 12:
            raise SystemExit(f"{name}: foreground+background drifted from icon.png by {worst}")

        if png_color_type(images / "icon.png") != 2:
            raise SystemExit(f"{name}: icon.png still has an alpha channel")
        alpha = rendered["foreground"].getchannel("A")
        if alpha.getextrema()[0] != 0:
            raise SystemExit(f"{name}: adaptive foreground has no transparent pixels")
        print(f"{name}: wrote 1024 icons (composite delta {worst})")


def main() -> None:
    for name, fallback in APPS.items():
        render_app(name, fallback)


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError as error:
        sys.exit(f"render failed ({error}). Install librsvg2-bin and python3-pil.")
