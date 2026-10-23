"""把大地图布局的「势力范围」离线画成 PNG —— 用来在**不进游戏**的前提下确认染色口径。

只做表现层核对，不参与构建，也不是运行时依赖。

    # 单张
    python tools/map-editor/preview_bigmap_ranges.py assets/resources/config/bigmap-maps/world_01.json out.png
    # 改前/改后对比（给文档用）
    python tools/map-editor/preview_bigmap_ranges.py --compare before.json after.json docs/xxx.png

几何常量与 `BigMapWorldLayout` 对齐（147×96 / 列步长 0.75W / 行步长 H / 奇数列上移半行），
颜色与 `BIGMAP_TERRITORY_COLORS` 对齐 —— 这三处任一改动都要同步改这里，否则预览会"看起来不对但其实是预览错"。
"""
import json
import sys
from PIL import Image, ImageDraw, ImageFont

PALETTE = [
    (96, 170, 104), (206, 132, 62), (92, 138, 208), (166, 106, 190),
    (202, 94, 92), (72, 168, 166), (186, 168, 72), (120, 122, 132),
]
WILD = (170, 150, 120)
BG = (28, 30, 26)
PAD = 20

TILE_W, TILE_H = 147, 96
COL_STEP = TILE_W * 0.75
ROW_STEP = TILE_H


def font(size):
    for path in ('C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf'):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def render(layout_path):
    """按布局画一张图，返回 (image, 说明文字)。"""
    d = json.load(open(layout_path, encoding='utf-8'))
    rows, cols = d['rows'], d['columns']
    cities = d['cities']

    adj = {c['cityId']: set(c.get('adjacentCityIds') or []) for c in cities}
    slot = {}
    for c in sorted(cities, key=lambda c: -len(adj[c['cityId']])):
        cid = c['cityId']
        used = {slot[n] for n in adj[cid] if n in slot}
        s = 0
        while s in used:
            s += 1
        slot[cid] = s

    owner = {}
    for c in cities:
        for h in c.get('rangeHex') or []:
            owner[h] = c['cityId']

    img = Image.new('RGB', (int(PAD * 2 + cols * COL_STEP + TILE_W / 2),
                            int(PAD * 2 + rows * ROW_STEP + TILE_H)), BG)
    g = ImageDraw.Draw(img, 'RGBA')

    def center(hex_id):
        r, c = divmod(hex_id, cols)
        # 偶数列格下移半行、奇数列格上移半行 —— 与 HexGridLayout 的 odd 相位一致
        return (PAD + c * COL_STEP + TILE_W / 2,
                PAD + r * ROW_STEP + (TILE_H / 2 if c % 2 else TILE_H))

    def hexagon(x, y, shrink=0.0):
        hw, hh = TILE_W / 2 - shrink, TILE_H / 2 - shrink
        # 与 BigMapWorldView.hexPath 一致：左右是尖角，上下是平边
        return [(x + hw, y), (x + hw / 2, y + hh), (x - hw / 2, y + hh),
                (x - hw, y), (x - hw / 2, y - hh), (x + hw / 2, y - hh)]

    for h in range(rows * cols):
        x, y = center(h)
        cid = owner.get(h)
        if cid is None:
            g.polygon(hexagon(x, y), fill=WILD + (255,), outline=(90, 78, 60, 255))
        else:
            g.polygon(hexagon(x, y), fill=PALETTE[slot[cid] % len(PALETTE)] + (255,),
                      outline=(255, 255, 255, 60))

    for c in cities:
        for h in c['hexIds']:
            x, y = center(h)
            g.polygon(hexagon(x, y, 1.5), fill=(40, 32, 24, 220), outline=(255, 255, 255, 200))
        x, y = center(c['anchorHexId'])
        g.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(255, 240, 180, 255))

    sizes = [len(c.get('rangeHex') or []) for c in cities]
    return img, f'{len(cities)} 座城，范围 {min(sizes)}~{max(sizes)} 格'


def compare(before, after, out, target=1000):
    a, note_a = render(before)
    b, note_b = render(after)
    scale = min(1.0, target / a.width)
    a = a.resize((int(a.width * scale), int(a.height * scale)), Image.LANCZOS)
    b = b.resize((int(b.width * scale), int(b.height * scale)), Image.LANCZOS)

    gap, top = 24, 62
    img = Image.new('RGB', (a.width + b.width + gap * 3, max(a.height, b.height) + top + gap), (24, 26, 24))
    img.paste(a, (gap, top))
    img.paste(b, (gap * 2 + a.width, top))
    g = ImageDraw.Draw(img)
    f = font(30)
    g.text((gap, 14), f'改前：{note_a}', font=f, fill=(226, 226, 226))
    g.text((gap * 2 + a.width, 14), f'改后：{note_b}', font=f, fill=(150, 214, 160))
    img.save(out)
    print(f'写出 {out} {img.width}x{img.height}')


def main():
    if sys.argv[1] == '--compare':
        compare(sys.argv[2], sys.argv[3], sys.argv[4])
        return
    img, note = render(sys.argv[1])
    img.save(sys.argv[2])
    print(f'写出 {sys.argv[2]}  {note}')


if __name__ == '__main__':
    main()
