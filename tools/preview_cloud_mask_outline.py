# -*- coding: utf-8 -*-
"""画「挡云遮罩多边形」与**一块**地皮的套合关系（离线验收，不参与运行时）。

用户 2026-10-26：*「底部的云层也要和地块有 15px 的间隙」* —— 旧口径只按格面外扩 15px，
底边比图底还高 11px，云压在深棕侧壁上；七版把基准换成「格面 + 26px 侧壁」。

图里：真地皮 + 白线（地块轮廓）+ 红框（遮罩多边形 = 轮廓外扩 15px）+ 三处实测标注。
左右/上下的间隙应当**都是 15px** —— 这是判断口径对不对的唯一标准。

用法（仓库根目录）：

    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/preview_cloud_mask_outline.py

几何来自 `tools/preview_cloud_tile_gap.ts` 的导出（= 代码真源），本文件只负责合成与标注。
"""
import json
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JSON = os.path.join(ROOT, 'docs', '.tmp-cloud-mask.json')
OUT = os.path.join(ROOT, 'docs', '章节地图未解锁云-15px间距.png')
TILE_DIR = os.path.join(ROOT, 'assets', 'resources', 'image', 'buildings')

NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'
SCALE = 3.0
HEAD = 132

INK = (30, 34, 40)
MUTED = (110, 118, 130)
CARD_BG = (46, 49, 56)
MARK = (240, 96, 96)
WHITE = (255, 255, 255)


def font(size, bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc', size)


F_TITLE = font(23, True)
F_SUB = font(15)
F_CAP = font(17, True)
F_TINY = font(13)


def sample() -> dict:
    subprocess.run([NPX, 'tsx', 'tools/preview_cloud_tile_gap.ts', 'docs/.tmp-cloud-mask.json'],
                   cwd=ROOT, check=True)
    with open(DATA_JSON, encoding='utf-8') as handle:
        return json.load(handle)


DATA = sample()
TILE = DATA['tile']
LIFT = TILE['lift']
INSET = DATA['keepOut']
SIDE = TILE['side']
OUTLINE = [(p['x'], p['y']) for p in DATA['outline']]
KEEP_OUT = [(p['x'], p['y']) for p in DATA['keepOutPoints']]

TILE_ART = Image.open(os.path.join(TILE_DIR, 'img_land_01.png')).convert('RGBA')
ART_W, ART_H = TILE_ART.width, TILE_ART.height


def sx(x):
    return x * SCALE


def sy(y):
    return -y * SCALE


def measure(draw, x0, y0, x1, y1, label, vertical=True):
    """画一根两端带横杠的标注线 + 数值。"""
    draw.line([(x0, y0), (x1, y1)], fill=MARK, width=2)
    if vertical:
        for y in (y0, y1):
            draw.line([(x0 - 9, y), (x0 + 9, y)], fill=MARK, width=2)
        draw.text((x0 + 13, (y0 + y1) / 2 - 11), label, font=F_CAP, fill=MARK)
    else:
        for x in (x0, x1):
            draw.line([(x, y0 - 9), (x, y0 + 9)], fill=MARK, width=2)
        draw.text(((x0 + x1) / 2 - 18, y0 + 13), label, font=F_CAP, fill=MARK)


def main() -> None:
    # 画布：一块地皮 + 四周各 15px 的遮罩余量 + 标注留白。
    pad = 110
    width = int(ART_W * SCALE) + pad * 2
    height = int(ART_H * SCALE) + pad * 2
    face_x, face_y = width / 2, height / 2          # 格面中心落在画布中心
    art_x, art_y = face_x, face_y + LIFT * SCALE    # 图心比格面中心低 LIFT

    panel = Image.new('RGBA', (width, height), CARD_BG + (255,))

    # ① 遮罩多边形（先画，垫在地块下面）：半透明红填充 + 红边。
    poly = [(face_x + sx(p[0]), face_y + sy(p[1])) for p in KEEP_OUT]
    tint = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(tint).polygon(poly, fill=MARK + (46,))
    panel.alpha_composite(tint)

    # ② 真地皮（锚点 = 图心）。
    art = TILE_ART.resize((int(ART_W * SCALE), int(ART_H * SCALE)), Image.LANCZOS)
    panel.alpha_composite(art, (int(round(art_x - art.width / 2)), int(round(art_y - art.height / 2))))

    draw = ImageDraw.Draw(panel)
    # ③ 地块轮廓（白）= 遮罩的基准；与红框之间处处 15px。
    outline = [(face_x + sx(p[0]), face_y + sy(p[1])) for p in OUTLINE]
    draw.line(outline + [outline[0]], fill=WHITE + (200,), width=1)
    draw.line(poly + [poly[0]], fill=MARK + (255,), width=2)

    # ④ 两处实测：格面中心正上方的「上间隙」和「底部间隙」（左/右同理，只是斜边不好标）。
    art_top = art_y - ART_H / 2 * SCALE
    art_bottom = art_y + ART_H / 2 * SCALE
    poly_top = min(p[1] for p in poly)
    poly_bottom = max(p[1] for p in poly)

    measure(draw, face_x, poly_top, face_x, art_top, f'{(art_top - poly_top) / SCALE:.0f}px')
    measure(draw, face_x - 30, art_bottom, face_x - 30, poly_bottom,
            f'底部 {(poly_bottom - art_bottom) / SCALE:.0f}px')

    # 标题条
    frame = Image.new('RGBA', (width, height + HEAD - 20), (255, 255, 255, 255))
    frame.alpha_composite(panel, (0, HEAD - 20))
    fd = ImageDraw.Draw(frame)
    fd.rectangle((0, 0, width - 1, height + HEAD - 21), outline=(222, 226, 232), width=1)
    fd.text((16, 14), '挡云遮罩：地块轮廓外扩 15px', font=F_TITLE, fill=INK)
    fd.text((16, 50),
            f'地皮图 {ART_W}×{ART_H}：格面 {TILE["faceWidth"]}×{TILE["faceHeight"]}，下面还有 {SIDE}px 侧壁',
            font=F_TINY, fill=MUTED)
    fd.text((16, 72),
            f'白线 = 地块轮廓，红框 = 遮罩（红框内没有云），两者相距 {INSET}px',
            font=F_TINY, fill=MUTED)
    fd.text((16, 94),
            '只按格面算的话：遮罩底边比地块图底还高 11px，云就压在侧壁上',
            font=F_TINY, fill=MUTED)
    stamp = '2026-10-26 七版'
    fd.text((width - 16 - fd.textlength(stamp, font=F_TINY), 22), stamp, font=F_TINY, fill=MUTED)

    frame.convert('RGB').save(OUT)
    if os.path.exists(DATA_JSON):
        os.remove(DATA_JSON)
    print(OUT)
    print(f'上 {(art_top - poly_top) / SCALE:+.1f} / 底 {(poly_bottom - art_bottom) / SCALE:+.1f}')


if __name__ == '__main__':
    main()
