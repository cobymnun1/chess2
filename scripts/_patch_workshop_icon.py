"""Convert generated workshop PNG → atlas column + white SVG silhouette."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(r"c:\Users\coby2\Projects\OpenFrontIO")
SRC = Path(
    r"C:\Users\coby2\.cursor\projects\c-Users-coby2-Projects-OpenFrontIO\assets\workshop-icon-gen.png"
)
ATLAS = ROOT / "resources" / "atlases" / "icon-atlas.png"
SVG = ROOT / "resources" / "images" / "ChessWorkshopIconWhite.svg"
TMP = Path(r"C:\Users\coby2\AppData\Local\Temp\workshop-icon-clean.png")


def to_white_silhouette(src: Image.Image, size: int = 64) -> Image.Image:
    img = src.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    px = img.load()
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    op = out.load()
    for y in range(size):
        for x in range(size):
            r, g, b, a = px[x, y]
            # Treat bright / near-white as glyph; ignore black bg
            lum = (r + g + b) / 3
            if lum > 40 and a > 20:
                op[x, y] = (255, 255, 255, 255)
    return out


def silhouette_to_svg_path(icon: Image.Image) -> str:
    """Crude run-length rects SVG — fine for UI; atlas uses the PNG."""
    w, h = icon.size
    px = icon.load()
    rects: list[str] = []
    for y in range(h):
        x = 0
        while x < w:
            while x < w and px[x, y][3] == 0:
                x += 1
            if x >= w:
                break
            x0 = x
            while x < w and px[x, y][3] > 0:
                x += 1
            rects.append(f'<rect x="{x0}" y="{y}" width="{x - x0}" height="1"/>')
    return "\n    ".join(rects)


def main() -> None:
    icon = to_white_silhouette(Image.open(SRC), 64)
    icon.save(TMP)
    print("wrote", TMP)

    atlas = Image.open(ATLAS).convert("RGBA")
    cleared = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    atlas.paste(cleared, (6 * 64, 0))
    atlas.paste(icon, (6 * 64, 0), icon)
    atlas.save(ATLAS)
    print("atlas patched")

    # Clean vector-ish SVG via rect runs (matches raster for UI menus)
    body = silhouette_to_svg_path(icon)
    SVG.write_text(
        f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <!-- Workshop: pitched-roof smithy with chimney -->
  <g fill="#ffffff">
    {body}
  </g>
</svg>
''',
        encoding="utf-8",
    )
    print("svg written", SVG, "bytes", SVG.stat().st_size)


if __name__ == "__main__":
    main()
