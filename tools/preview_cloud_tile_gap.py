# -*- coding: utf-8 -*-
"""画「云与地块的 15px 间隙」对照图（离线验收用，不参与运行时）。

用户 2026-10-26：*「底部的云层也要和地块有 15px 的间隙」* —— 截图里最下面一排地块，
云直接贴在深棕色的**侧壁**上（0 间隙）。

根因：地皮图是 **126×117 的 2.5D 立体图**，格面（草地）只占 `y = 0…91`，下面 26px 是侧壁；
而挡云遮罩只按 `HEX_GRID_FACE_HEIGHT = 90` 的格面外扩 15px，遮罩底边比**图底**还高 11px，
云就压在侧壁上。现在基准换成「格面 + 侧壁」（`territoryTileOutlinePoints`）。

本图左右对照：左边旧口径（只有格面），右边新口径（格面 + 侧壁），下方标注实测间隙。

用法（在仓库根目录）：

    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/preview_cloud_tile_gap.py

几何全部来自 `tools/preview_cloud_tile_gap.ts` 的导出（= 代码真源），本文件只负责合成与标注。
"""
import json
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, 'docs', '.tmp-cloud-tile-gap.json')
OUT = os.path.join(ROOT, 'docs', '章节地图云与地块间隙.png')
CLOUD_DIR = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'cloud')
TILE_DIR = os.path.join(ROOT, 'assets', 'resources', 'image', 'buildings')

NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'
SCALE = 1.7          # 地图坐标 → 像素（放大看清 15px）
PANEL_PAD = 26
GAP = 18
HEAD = 92

INK = (30, 34, 40)
MUTED = (110, 118, 130)
BG = (247, 248, 250)
SAND = (201, 179, 143)
MARK = (232, 84, 84)
OK = (46, 158, 96)


def sample() -> dict:
    subprocess.run([NPX, 'tsx', 'tools/preview_cloud_tile_gap.ts'], cwd=ROOT, check=True)
    with open(DATA_JSON, encoding='utf-8') as fp:
        return json.load(fp)


def font(size, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    return ImageFont.truetype(path, size)


F_TITLE = font(27, True)
F_SUB = font(14)
F_CAP = font(16, True)
F_TINY = font(12)

DATA = sample()
TILE = DATA['tile']
CLOUD = DATA['cloud']
CELLS = DATA['cells']
OUTLINE = [(p['x'], p['y']) for p in DATA['outline']]
KEEP_OUT = [(p['x'], p['y']) for p in DATA['keepOutPoints']]
OLD_KEEP_OUT = [(p['x'], p['y']) for p in DATA['oldKeepOutPoints']]
INSET = DATA['keepOut']
SIDE = TILE['side']
LIFT = TILE['lift']


def load(directory, name):
    return Image.open(os.path.join(directory, f'{name}.png')).convert('RGBA')


TILE_ART = load(TILE_DIR, 'img_land_01')
CLOUD_BODY = load(CLOUD_DIR, 'cloud_body_0')
CLOUD_SHADOW = load(CLOUD_DIR, 'cloud_shadow_0')


def sx(x):
    return x * SCALE


def sy(y):
    return -y * SCALE          # 地图 y 向上 → 屏幕 y 向下


def draw_panel(title, subtitle, use_keep_out, note_color):
    """画一栏：真地皮 + 真云（按挡云多边形当反向遮罩）。返回 (图片, 实测间隙px)。"""
    # 面板范围：把云也算进来（云 200×240，比小岛大一圈）。
    xs = [sx(c['x']) for c in CELLS]
    ys = [sy(c['y']) for c in CELLS]
    half_w = (CLOUD['width'] / 2) * SCALE + abs(sx(DATA['spacing']['column']))
    half_h = (CLOUD['height'] / 2) * SCALE + abs(sy(DATA['spacing']['row']))
    left = min(xs) - half_w
    right = max(xs) + half_w
    top = min(ys) - half_h
    bottom = max(ys) + half_h
    width = int(right - left) + PANEL_PAD * 2
    height = int(bottom - top) + PANEL_PAD * 2

    panel = Image.new('RGBA', (width, height), SAND)
    origin = (PANEL_PAD - left, PANEL_PAD - top)   # 地图 (0,0) 落在面板哪里

    def put(img, cx, cy):
        w = int(round(img.width * SCALE))
        h = int(round(img.height * SCALE))
        art = img.resize((w, h), Image.LANCZOS)
        panel.alpha_composite(art, (int(round(origin[0] + cx - w / 2)),
                                    int(round(origin[1] + cy - h / 2))))

    # ① 云：铺满整个面板（= 铺满层的做法），先影子后云体。
    step_col = sx(DATA['spacing']['column'])
    step_row = sy(DATA['spacing']['row'])
    cy = -CLOUD['height']
    while cy < height + CLOUD['height']:
        cx = -CLOUD['width']
        while cx < width + CLOUD['width']:
            put(CLOUD_SHADOW, cx, cy)
            cx += step_col
        cy -= step_row
    cy = -CLOUD['height']
    while cy < height + CLOUD['height']:
        cx = -CLOUD['width']
        while cx < width + CLOUD['width']:
            put(CLOUD_BODY, cx, cy)
            cx += step_col
        cy -= step_row

    # ② 挡云：把多边形画成遮罩，反向擦掉。
    #    多边形点相对**格面中心**，而地块图锚点是**图心** —— 图心比格面中心低 LIFT。
    shape = KEEP_OUT if use_keep_out else OLD_KEEP_OUT
    mask = Image.new('L', (width, height), 0)
    draw = ImageDraw.Draw(mask)
    for cell in CELLS:
        base_x = origin[0] + sx(cell['x'])
        base_y = origin[1] + sy(cell['y']) - LIFT * SCALE
        points = [(base_x + sx(p[0]), base_y + sy(p[1])) for p in shape]
        draw.polygon(points, fill=255)
    clear = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    panel = Image.composite(clear, panel, mask)

    # ③ 地块：真地皮图，锚点=整图中心，落在格心（不加 lift，格心就是图心）。
    for cell in CELLS:
        put(TILE_ART, sx(cell['x']), sy(cell['y']))

    # ④ 标注：最下面那一排（世界 y 最小）取中间那格，量「地块图底 → 云的上边缘」。
    bottom_row = min(CELLS, key=lambda c: c['y'])
    target = min([c for c in CELLS if c['y'] == bottom_row['y']], key=lambda c: abs(c['x']))
    art_bottom = origin[1] + sy(target['y']) + (TILE_ART.height / 2) * SCALE
    cloud_top = (origin[1] + sy(target['y']) - LIFT * SCALE
                 + sy(min(p[1] for p in shape)))
    mid_x = origin[0] + sx(target['x'])
    gap_px = (cloud_top - art_bottom) / SCALE     # > 0 露出间隙；< 0 云压进地块

    d = ImageDraw.Draw(panel)
    y_from, y_to = sorted((art_bottom, cloud_top))
    d.line([(mid_x, y_from), (mid_x, y_to)], fill=note_color, width=2)
    for y_tick in (art_bottom, cloud_top):
        d.line([(mid_x - 12, y_tick), (mid_x + 12, y_tick)], fill=note_color, width=2)
    label = f'{gap_px:+.0f}px' if gap_px >= 0 else f'压进去 {-gap_px:.0f}px'
    d.text((mid_x + 16, (y_from + y_to) / 2 - 10), label, font=F_CAP, fill=note_color)

    # 标题条
    frame = Image.new('RGBA', (width, height + 54), (255, 255, 255, 255))
    frame.alpha_composite(panel, (0, 54))
    fd = ImageDraw.Draw(frame)
    fd.rectangle((0, 0, width - 1, height + 53), outline=(222, 226, 232), width=1)
    fd.text((14, 8), title, font=F_CAP, fill=INK)
    fd.text((14, 30), subtitle, font=F_TINY, fill=MUTED)
    fd.text((width - 14 - fd.textlength(label, font=F_TINY), 8), f'实测 {label}',
            font=F_TINY, fill=note_color)
    return frame, gap_px


def main():
    left, gap_old = draw_panel(
        '旧口径：只按格面外扩 15px',
        '格面底边 - 15 比地块图底还高 11px，云压在侧壁上',
        False,
        MARK,
    )
    right, gap_new = draw_panel(
        '新口径：按地块轮廓（格面 + 侧壁）外扩 15px',
        f'侧壁 {SIDE}px 也算地块，图底再留 {INSET}px',
        True,
        OK,
    )

    width = left.width + right.width + GAP + 40
    height = max(left.height, right.height) + HEAD + 20
    sheet = Image.new('RGBA', (width, height), BG)
    d = ImageDraw.Draw(sheet)
    d.text((20, 20), '云与地块的间隙：底部为什么要算上侧壁（2026-10-26）', font=F_TITLE, fill=INK)
    d.text((20, 56),
           f'地皮图 {TILE["width"]}×{TILE["height"]}，格面只有 {TILE["faceWidth"]}×{TILE["faceHeight"]}（y=0…91），'
           f'下面 {SIDE}px 是 2.5D 侧壁；云与**地块轮廓**留 {INSET}px。'
           '图中标的 px 是地图坐标（已按美术 1:1 算，不是屏幕缩放后的值）。',
           font=F_SUB, fill=MUTED)
    sheet.alpha_composite(left, (20, HEAD))
    sheet.alpha_composite(right, (20 + left.width + GAP, HEAD))

    sheet.convert('RGB').save(OUT)
    if os.path.exists(DATA_JSON):
        os.remove(DATA_JSON)
    print(OUT)
    print(f'旧口径实测 {gap_old:.1f}px / 新口径实测 {gap_new:.1f}px')


if __name__ == '__main__':
    main()
