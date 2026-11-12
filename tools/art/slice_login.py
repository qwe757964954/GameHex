"""Slice the approved login mockup; Cocos owns import metadata and prefab bindings.

Usage: python tools/art/slice_login.py
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tools/art/sources/login/approved-mockup.png'
OUT = ROOT / 'assets/resources/image/login'


def silhouette(tile, radius=0, ellipse=False):
    mask = Image.new('L', (tile.width * 4, tile.height * 4))
    draw = ImageDraw.Draw(mask)
    bounds = (2, 2, mask.width - 3, mask.height - 3)
    if ellipse:
        draw.ellipse(bounds, fill=255)
    else:
        draw.rounded_rectangle(bounds, radius=radius * 4, fill=255)
    tile.putalpha(ImageChops.multiply(tile.getchannel('A'), mask.resize(tile.size, Image.Resampling.LANCZOS)))
    return tile


def empty_frame(tile, border, sample_x, sample_y, middle=8):
    # Sample text-free strips, keeping the actual painted corners and edge detail.
    widths = (border, middle, border)
    xs = (0, sample_x, tile.width - border)
    ys = (0, sample_y, tile.height - border)
    out = Image.new('RGBA', (sum(widths), sum(widths)))
    for row, y in enumerate(ys):
        for col, x in enumerate(xs):
            out.paste(tile.crop((x, y, x + widths[col], y + widths[row])),
                      (sum(widths[:col]), sum(widths[:row])))
    return out


def main():
    source = Image.open(SOURCE).convert('RGBA')
    assert source.size == (1536, 1024), 'Use the approved original-resolution mockup'
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}

    def save(name, tile, bounds, borders=None):
        tile = tile.resize((tile.width * 2, tile.height * 2), Image.Resampling.LANCZOS)
        assert tile.getbbox(), name
        tile.save(OUT / f'{name}.png')
        manifest[name] = {'source': 'approved-mockup.png', 'bounds': list(bounds), 'size': list(tile.size)}
        if borders:
            manifest[name]['borders'] = [value * 2 for value in borders]

    bounds = (638, 480, 996, 900)
    panel = empty_frame(source.crop(bounds), 24, 30, 350, 16)
    save('login_panel', silhouette(panel, 7), bounds, [24] * 4)

    bounds = (726, 473, 918, 511)
    title = source.crop(bounds)
    title.paste(source.crop((763, 479, 769, 505)).resize((105, 26), Image.Resampling.LANCZOS), (45, 6))
    mask = Image.new('L', title.size)
    ImageDraw.Draw(mask).polygon([(26, 0), (166, 0), (191, 19), (166, 37), (26, 37), (0, 19)], fill=255)
    title.putalpha(mask)
    save('login_title', title, bounds, [30, 30, 8, 8])

    for name, bounds, border, sx, sy, radius in [
        ('login_primary', (677, 628, 957, 675), 16, 54, 20, 14),
        ('login_secondary', (682, 683, 953, 726), 14, 47, 18, 12),
        ('login_input', (730, 527, 969, 567), 10, 190, 16, 6),
        ('login_server', (698, 736, 937, 778), 10, 166, 16, 7),
        ('server_row', (1121, 454, 1390, 498), 12, 85, 18, 6),
        ('server_row_selected', (1121, 404, 1390, 449), 12, 85, 18, 6),
        ('server_row_disabled', (1121, 555, 1390, 600), 12, 85, 18, 6),
    ]:
        tile = empty_frame(source.crop(bounds), border, sx, sy)
        save(name, silhouette(tile, radius), bounds, [border] * 4)

    bounds = (700, 792, 730, 823)
    save('login_checkbox', silhouette(source.crop(bounds), 5), bounds)
    bounds = (1373, 349, 1415, 387)
    save('login_close', silhouette(source.crop(bounds), ellipse=True), bounds)
    for name, bounds in [('login_eye', (931, 585, 959, 604)), ('login_check', (1350, 414, 1378, 437))]:
        tile = source.crop(bounds)
        # Keep only the cream/gold glyph, removing the panel beneath it.
        alpha = Image.new('L', tile.size)
        alpha.putdata([max(0, min(255, (min(tile.getpixel((x, y))[:2]) - 105) * 4))
                       for y in range(tile.height) for x in range(tile.width)])
        tile.putalpha(alpha)
        save(name, tile, bounds)
    bounds = (1137, 416, 1157, 436)
    dot = silhouette(source.crop(bounds), ellipse=True)
    dot.putdata([(max(dot.getpixel((x, y))[:3]),) * 3 + (dot.getpixel((x, y))[3],)
                 for y in range(dot.height) for x in range(dot.width)])
    save('server_dot', dot, bounds)
    (OUT / 'login-slices.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Exported {len(manifest)} login slices')


if __name__ == '__main__':
    main()
