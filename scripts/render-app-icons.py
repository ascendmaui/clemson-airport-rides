#!/usr/bin/env python3
"""Build the rider and driver Liquid Glass app icons.

Vector source written to apps/{rider,driver}/assets/brand/icon.svg.
Raster files are the ones Expo already references, plus the iOS AppIcon
set (every legacy size, the 1024 marketing icon, and dark and tinted
1024s) and the ios.icon light/dark/tinted masters.

Requires rsvg-convert (librsvg2-bin) and Pillow.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)

# Point size, scale, idiom. Pixel size is round(pt * scale).
LEGACY_ICONS = [
    (20, 2, "iphone", "Icon-20@2x.png"),
    (20, 3, "iphone", "Icon-20@3x.png"),
    (29, 2, "iphone", "Icon-29@2x.png"),
    (29, 3, "iphone", "Icon-29@3x.png"),
    (40, 2, "iphone", "Icon-40@2x.png"),
    (40, 3, "iphone", "Icon-40@3x.png"),
    (60, 2, "iphone", "Icon-60@2x.png"),
    (60, 3, "iphone", "Icon-60@3x.png"),
    (20, 1, "ipad", "Icon-20.png"),
    (20, 2, "ipad", "Icon-20@2x.png"),
    (29, 1, "ipad", "Icon-29.png"),
    (29, 2, "ipad", "Icon-29@2x.png"),
    (40, 1, "ipad", "Icon-40.png"),
    (40, 2, "ipad", "Icon-40@2x.png"),
    (76, 1, "ipad", "Icon-76.png"),
    (76, 2, "ipad", "Icon-76@2x.png"),
    (83.5, 2, "ipad", "Icon-83.5@2x.png"),
    (1024, 1, "ios-marketing", "Icon-1024.png"),
]


def px(pt: float, scale: float) -> int:
    return int(round(pt * scale))


def arc_endpoints(cx: float, cy: float, radius: float, start: float, end: float) -> tuple[float, float, float, float]:
    """Endpoints for a y-down arc. 0° is east, 270° is up."""

    def point(angle: float) -> tuple[float, float]:
        rad = math.radians(angle)
        return cx + radius * math.cos(rad), cy + radius * math.sin(rad)

    x0, y0 = point(start)
    x1, y1 = point(end)
    return x0, y0, x1, y1


def circle_path(cx: float, cy: float, radius: float, sweep: int) -> str:
    return (
        f"M {cx - radius:.2f} {cy:.2f} "
        f"A {radius:.2f} {radius:.2f} 0 1 {sweep} {cx + radius:.2f} {cy:.2f} "
        f"A {radius:.2f} {radius:.2f} 0 1 {sweep} {cx - radius:.2f} {cy:.2f} Z"
    )


def pin_path(cx: float = 512, cy: float = 500, radius: float = 196, tip: float = 874) -> str:
    left = cx - radius
    right = cx + radius
    return (
        f"M {cx:.2f} {tip:.2f} "
        f"C {cx - radius * 0.12:.2f} {cy + radius * 0.92:.2f}, "
        f"{left + radius * 0.02:.2f} {cy + radius * 0.42:.2f}, "
        f"{left:.2f} {cy:.2f} "
        f"A {radius:.2f} {radius:.2f} 0 0 1 {right:.2f} {cy:.2f} "
        f"C {right - radius * 0.02:.2f} {cy + radius * 0.42:.2f}, "
        f"{cx + radius * 0.12:.2f} {cy + radius * 0.92:.2f}, "
        f"{cx:.2f} {tip:.2f} Z"
    )


def car_paths() -> str:
    """Side-view car, facing right, origin at the body center."""
    body = (
        "M -108 26 "
        "C -102 4 -86 -16 -58 -30 "
        "L -18 -34 "
        "C 8 -36 28 -28 42 -12 "
        "L 64 2 "
        "C 78 8 92 16 104 28 "
        "C 114 36 112 46 98 50 "
        "L 74 52 "
        "L -78 52 "
        "C -102 50 -116 40 -108 26 Z"
    )
    window = (
        "M -16 -4 "
        "C -2 -22 26 -24 46 -6 "
        "L 34 14 "
        "L -10 12 Z"
    )
    return body, window


def spoke(cx: float, cy: float, angle: float, inner: float, outer: float) -> str:
    rad = math.radians(angle)
    return (
        f"M {cx + inner * math.cos(rad):.2f} {cy + inner * math.sin(rad):.2f} "
        f"L {cx + outer * math.cos(rad):.2f} {cy + outer * math.sin(rad):.2f}"
    )


def orange_arc(cx: float, cy: float, radius: float) -> str:
    x0, y0, x1, y1 = arc_endpoints(cx, cy, radius, 206, 334)
    return (
        f"M {x0:.2f} {y0:.2f} "
        f"A {radius:.2f} {radius:.2f} 0 0 1 {x1:.2f} {y1:.2f}"
    )


def background_layers(kind: str) -> str:
    """Full-bleed glossy field. No rounded clip and no outer shadow."""
    return f"""
    <g id="{kind}">
      <rect width="1024" height="1024" fill="url(#{kind}Base)"/>
      <rect width="1024" height="1024" fill="url(#{kind}Glow)"/>
      <rect width="1024" height="1024" fill="url(#{kind}Spec)"/>
      <rect width="1024" height="1024" fill="url(#{kind}Edge)"/>
      <g opacity="0.28" transform="rotate(-32 512 280)">
        <rect x="-80" y="210" width="1280" height="22" rx="11" fill="url(#{kind}Streak)"/>
      </g>
    </g>"""


def background_defs(kind: str, light: str, mid: str, deep: str, glow: str, edge: str, spec_opacity: float) -> str:
    return f"""
    <linearGradient id="{kind}Base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="{light}"/>
      <stop offset="46%" stop-color="{mid}"/>
      <stop offset="100%" stop-color="{deep}"/>
    </linearGradient>
    <radialGradient id="{kind}Glow" cx="50%" cy="46%" r="46%">
      <stop offset="0%" stop-color="{glow}" stop-opacity="0.55"/>
      <stop offset="58%" stop-color="{glow}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="{glow}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="{kind}Spec" cx="18%" cy="12%" r="40%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="{spec_opacity:.2f}"/>
      <stop offset="32%" stop-color="#FFFFFF" stop-opacity="{spec_opacity * 0.38:.2f}"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="{kind}Edge" cx="50%" cy="42%" r="78%">
      <stop offset="0%" stop-color="{edge}" stop-opacity="0"/>
      <stop offset="70%" stop-color="{edge}" stop-opacity="0"/>
      <stop offset="100%" stop-color="{edge}" stop-opacity="0.34"/>
    </radialGradient>
    <linearGradient id="{kind}Streak" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="42%" stop-color="#FFFFFF" stop-opacity="0.05"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.85"/>
      <stop offset="58%" stop-color="#FFFFFF" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>"""


def rider_svg() -> str:
    pin = pin_path()
    body, window = car_paths()
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    {background_defs("background", "#FFC56A", "#FF8A1F", "#F56600", "#FFE0B0", "#C24100", 0.92)}
    {background_defs("background-dark", "#6B3014", "#3A1608", "#160804", "#F56600", "#000000", 0.34)}
    <linearGradient id="pinBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.94"/>
      <stop offset="42%" stop-color="#FFFFFF" stop-opacity="0.62"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.30"/>
    </linearGradient>
    <linearGradient id="pinRim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.98"/>
      <stop offset="48%" stop-color="#FFFFFF" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.22"/>
    </linearGradient>
    <radialGradient id="pinGlow" cx="40%" cy="34%" r="62%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.75"/>
      <stop offset="55%" stop-color="#FFFFFF" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="pinClip"><path d="{pin}"/></clipPath>
    <mask id="pinMono" maskUnits="userSpaceOnUse">
      <rect width="1024" height="1024" fill="#000000"/>
      <path d="{pin}" fill="#FFFFFF"/>
      <g transform="translate(512 518)" fill="#000000">
        <path d="{body}"/>
        <circle cx="-62" cy="52" r="20"/>
        <circle cx="64" cy="52" r="20"/>
      </g>
    </mask>
  </defs>
  {background_layers("background")}
  {background_layers("background-dark")}
  <g id="background-tinted">
    <rect width="1024" height="1024" fill="#000000"/>
  </g>
  <g id="glyph">
    <path d="{pin}" fill="url(#pinBody)"/>
    <g clip-path="url(#pinClip)">
      <ellipse cx="430" cy="430" rx="150" ry="90" fill="url(#pinGlow)"/>
      <ellipse cx="390" cy="400" rx="120" ry="48" fill="#FFFFFF" fill-opacity="0.55"/>
      <path d="{pin}" fill="none" stroke="url(#pinRim)" stroke-width="10"/>
    </g>
  </g>
  <g id="accent" transform="translate(512 518)">
    <path d="{body}" fill="#F56600"/>
    <path d="{window}" fill="#FFF6EA"/>
    <circle cx="-62" cy="52" r="20" fill="#7A2A00"/>
    <circle cx="64" cy="52" r="20" fill="#7A2A00"/>
    <circle cx="-62" cy="52" r="8" fill="#FFE0C2"/>
    <circle cx="64" cy="52" r="8" fill="#FFE0C2"/>
  </g>
  <g id="mono">
    <rect width="1024" height="1024" fill="#FFFFFF" mask="url(#pinMono)"/>
  </g>
</svg>
"""


def driver_svg() -> str:
    cx, cy = 512.0, 512.0
    outer, inner = 214.0, 148.0
    ring = circle_path(cx, cy, outer, 1) + " " + circle_path(cx, cy, inner, 0)
    spokes = " ".join(
        spoke(cx, cy, angle, 46, inner - 2) for angle in (270, 30, 150)
    )
    hub = circle_path(cx, cy, 54, 1) + " " + circle_path(cx, cy, 22, 0)
    arc = orange_arc(cx, cy, outer + 36)
    gloss_x0, gloss_y0, gloss_x1, gloss_y1 = arc_endpoints(cx, cy, (outer + inner) / 2, 188, 292)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    {background_defs("background", "#A47AD4", "#6E449E", "#522D80", "#E4D2FF", "#2A1248", 0.88)}
    {background_defs("background-dark", "#3C2460", "#241238", "#100818", "#522D80", "#000000", 0.32)}
    <linearGradient id="wheelGlass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.96"/>
      <stop offset="48%" stop-color="#FFFFFF" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.40"/>
    </linearGradient>
    <filter id="arcGlow" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="8"/>
    </filter>
  </defs>
  {background_layers("background")}
  {background_layers("background-dark")}
  <g id="background-tinted">
    <rect width="1024" height="1024" fill="#000000"/>
  </g>
  <g id="glyph" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="{ring}" fill="url(#wheelGlass)" fill-rule="evenodd"/>
    <path d="{spokes}" stroke="#FFFFFF" stroke-opacity="0.92" stroke-width="34"/>
    <circle cx="{cx:.2f}" cy="{cy:.2f}" r="54" fill="#FFFFFF" fill-opacity="0.92"/>
    <circle cx="{cx:.2f}" cy="{cy:.2f}" r="24" fill="#FFFFFF" fill-opacity="0.45"/>
    <path d="M {gloss_x0:.2f} {gloss_y0:.2f} A {(outer + inner) / 2:.2f} {(outer + inner) / 2:.2f} 0 0 1 {gloss_x1:.2f} {gloss_y1:.2f}"
          stroke="#FFFFFF" stroke-opacity="0.9" stroke-width="16"/>
  </g>
  <g id="accent" fill="none" stroke-linecap="round">
    <path d="{arc}" stroke="#F56600" stroke-opacity="0.35" stroke-width="54" filter="url(#arcGlow)"/>
    <path d="{arc}" stroke="#F56600" stroke-width="30"/>
    <path d="{arc}" stroke="#FFD8B0" stroke-width="8"/>
  </g>
  <g id="mono" fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">
    <path d="{ring}" fill="#FFFFFF" fill-rule="evenodd"/>
    <path d="{spokes}" stroke-width="34"/>
    <path d="{hub}" fill="#FFFFFF" fill-rule="evenodd"/>
    <path d="{arc}" stroke-width="30"/>
  </g>
</svg>
"""


def write_variant(source: Path, keep: set[str], dest: Path) -> None:
    tree = ET.parse(source)
    root = tree.getroot()
    for child in list(root):
        if child.tag == f"{{{SVG_NS}}}g" and child.get("id") not in keep:
            root.remove(child)
    tree.write(dest, encoding="utf-8", xml_declaration=True)


def rasterize(svg: Path, png: Path, size: int) -> None:
    subprocess.check_call(
        ["rsvg-convert", "-w", str(size), "-h", str(size), "-o", str(png), str(svg)],
        stdout=subprocess.DEVNULL,
    )


def render_groups(source: Path, keep: set[str], size: int, directory: Path, name: str) -> Image.Image:
    svg = directory / f"{name}.svg"
    png = directory / f"{name}.png"
    write_variant(source, keep, svg)
    rasterize(svg, png, size)
    return Image.open(png).convert("RGBA")


def flatten(image: Image.Image) -> Image.Image:
    """Drop alpha. The background layer is already a full-bleed opaque field."""
    if image.getextrema()[3][0] < 255:
        raise SystemExit("icon still has transparent pixels after compositing")
    return image.convert("RGB")


def composite(base: Image.Image, overlay: Image.Image) -> Image.Image:
    return Image.alpha_composite(base.convert("RGBA"), overlay.convert("RGBA"))


def save_rgb(image: Image.Image, path: Path) -> None:
    image.convert("RGB").save(path, "PNG", optimize=True)


def save_rgba(image: Image.Image, path: Path) -> None:
    image.convert("RGBA").save(path, "PNG", optimize=True)


def contents_json() -> dict:
    images = []
    for pt, scale, idiom, filename in LEGACY_ICONS:
        images.append(
            {
                "filename": filename,
                "idiom": idiom,
                "scale": f"{int(scale)}x",
                "size": f"{pt:g}x{pt:g}",
            }
        )
    images.extend(
        [
            {
                "filename": "Icon-1024.png",
                "idiom": "universal",
                "platform": "ios",
                "size": "1024x1024",
            },
            {
                "appearances": [{"appearance": "luminosity", "value": "dark"}],
                "filename": "Icon-1024-dark.png",
                "idiom": "universal",
                "platform": "ios",
                "size": "1024x1024",
            },
            {
                "appearances": [{"appearance": "luminosity", "value": "tinted"}],
                "filename": "Icon-1024-tinted.png",
                "idiom": "universal",
                "platform": "ios",
                "size": "1024x1024",
            },
        ]
    )
    return {"images": images, "info": {"author": "xcode", "version": 1}}


def render_app(name: str, svg_text: str, fallback_check: tuple[int, int, int]) -> dict[str, Image.Image]:
    brand_dir = ROOT / "apps" / name / "assets" / "brand"
    images = ROOT / "apps" / name / "assets" / "images"
    brand_dir.mkdir(parents=True, exist_ok=True)
    source = brand_dir / "icon.svg"
    source.write_text(svg_text, encoding="utf-8")

    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        light_bg = render_groups(source, {"background"}, 1024, directory, "bg")
        light_fg = render_groups(source, {"glyph", "accent"}, 1024, directory, "fg")
        light = flatten(composite(light_bg, light_fg))

        dark_bg = render_groups(source, {"background-dark"}, 1024, directory, "dbg")
        dark = flatten(composite(dark_bg, light_fg))

        tinted_bg = render_groups(source, {"background-tinted"}, 1024, directory, "tbg")
        tinted_fg = render_groups(source, {"mono"}, 1024, directory, "mono")
        tinted = flatten(composite(tinted_bg, tinted_fg))

        mono = tinted_fg
        # Monochrome asset is the glyph alone, transparent outside the mark.
        blank = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        mono_only = composite(blank, mono)

    save_rgb(light, images / "icon.png")
    save_rgb(light, images / "ios-icon-light.png")
    save_rgb(dark, images / "ios-icon-dark.png")
    save_rgb(tinted, images / "ios-icon-tinted.png")
    save_rgb(light_bg.convert("RGB"), images / "android-icon-background.png")
    save_rgba(light_fg, images / "android-icon-foreground.png")
    save_rgba(mono_only, images / "android-icon-monochrome.png")
    save_rgba(light_fg, images / "splash-icon.png")
    save_rgb(light.resize((48, 48), Image.Resampling.LANCZOS), images / "favicon.png")

    iconset = images / "AppIcon.appiconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir()
    seen: set[str] = set()
    for pt, scale, _idiom, filename in LEGACY_ICONS:
        if filename in seen:
            continue
        seen.add(filename)
        size = px(pt, scale)
        dest = iconset / filename
        if size == 1024:
            save_rgb(light, dest)
        else:
            save_rgb(light.resize((size, size), Image.Resampling.LANCZOS), dest)
    save_rgb(dark, iconset / "Icon-1024-dark.png")
    save_rgb(tinted, iconset / "Icon-1024-tinted.png")
    (iconset / "Contents.json").write_text(json.dumps(contents_json(), indent=2) + "\n", encoding="utf-8")

    corner = light.getpixel((12, 1012))
    if abs(corner[0] - fallback_check[0]) > 40 or abs(corner[1] - fallback_check[1]) > 40:
        raise SystemExit(f"{name}: bottom edge {corner} is far from {fallback_check}")
    if light_fg.getchannel("A").getextrema()[0] != 0:
        raise SystemExit(f"{name}: adaptive foreground has no transparent pixels")
    print(f"{name}: wrote masters and AppIcon set")
    return {"light": light, "dark": dark, "tinted": tinted, "fg": light_fg, "bg": light_bg.convert("RGB")}


def rounded_mask(size: int, radius_ratio: float = 0.2237) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    radius = int(round(size * radius_ratio))
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def paste_rounded(canvas: Image.Image, icon: Image.Image, xy: tuple[int, int], size: int, backdrop: tuple[int, int, int]) -> None:
    tile = Image.new("RGBA", (size, size), backdrop + (255,))
    scaled = icon.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    tile.alpha_composite(scaled)
    tile.putalpha(rounded_mask(size))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (xy[0], xy[1] + 8, xy[0] + size, xy[1] + size + 8),
        radius=int(size * 0.2237),
        fill=(0, 0, 0, 40),
    )
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(tile, xy)


def write_preview(icons: dict[str, dict[str, Image.Image]], dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    cell = 280
    gap = 36
    label_h = 36
    margin = 40
    cols = ["light", "dark", "tinted"]
    backdrops = {"light": (232, 232, 237), "dark": (28, 28, 30), "tinted": (58, 58, 64)}
    sheet_w = margin * 2 + 3 * cell + 2 * gap
    sheet_h = margin * 2 + 2 * (cell + label_h) + gap + 120
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (246, 246, 248, 255))
    draw = ImageDraw.Draw(sheet)
    for row, app in enumerate(("rider", "driver")):
        for col, kind in enumerate(cols):
            x = margin + col * (cell + gap)
            y = margin + row * (cell + label_h + gap)
            paste_rounded(sheet, icons[app][kind], (x, y), cell, backdrops[kind])
            caption = f"{app} {kind}"
            draw.text((x, y + cell + 8), caption, fill=(40, 40, 44, 255))
    strip_y = margin + 2 * (cell + label_h + gap)
    sizes = (180, 120, 80, 60, 40)
    x = margin
    for app in ("rider", "driver"):
        for size in sizes:
            paste_rounded(sheet, icons[app]["light"], (x, strip_y), size, (232, 232, 237))
            x += size + 16
        x += 24
    sheet.convert("RGB").save(dest, "PNG", optimize=True)


def main() -> None:
    icons = {
        "rider": render_app("rider", rider_svg(), (245, 102, 0)),
        "driver": render_app("driver", driver_svg(), (82, 45, 128)),
    }
    artifacts = Path("/opt/cursor/artifacts")
    write_preview(icons, artifacts / "app-icon-preview.png")
    for name, layers in icons.items():
        save_rgb(layers["light"], artifacts / f"{name}-icon.png")
        save_rgb(layers["dark"], artifacts / f"{name}-icon-dark.png")
        save_rgb(layers["tinted"], artifacts / f"{name}-icon-tinted.png")
        save_rgba(layers["fg"], artifacts / f"{name}-foreground.png")


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError as error:
        sys.exit(f"render failed ({error}). Install librsvg2-bin and python3-pil.")
