# -*- coding: utf-8 -*-
"""画「开箱表演的箱子大小 / 落位」改前改后对照图（离线验收用，不参与运行时）。

用法（在仓库根目录）：
    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/preview_chest_placement.py

为什么要这张图（2026-10-22）：用户给了一张实机截图说「播放宝箱打开动画时，动画的节点大小
需要与原宝箱静止状态的大小相近（可以轻微的放大），坐标点保持一致不要有明显的偏移」。
尺寸差 1.4 倍、位置差 18px 这种事文字说不清，必须拿**真美术图**按运行时的缩放贴一遍。

流程：`npx tsx tools/preview_chest_placement_curves.ts` 从 model 里取「改前 / 改后」的缩放与补偿
      → 这里只负责贴图，不重算公式。
产物：docs/章节地图宝箱落位-改前改后.png
"""
import json
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURVES = os.path.join(ROOT, 'docs', '.tmp-chest-placement.json')
FRAME_PNG = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'chest', 'chest_seq_0.png')
STATIC_PNG = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'buildings', 'territory_fixed_resource_v1.png')
LAND_PNG = os.path.join(ROOT, 'assets', 'resources', 'image', 'buildings', 'img_land_01.png')
OUT = os.path.join(ROOT, 'docs', '章节地图宝箱落位-改前改后.png')

NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'

BG = (247, 248, 250)
INK = (30, 34, 40)
MUTED = (120, 128, 140)
LINE = (223, 226, 232)
BAD = (214, 62, 54)
GOOD = (28, 130, 214)
GUIDE = (150, 156, 168)

ZOOM = 1.55
PANEL_W = 240
PANEL_H = 246
GAP = 14
MARGIN = 22
HEADER = 116
FOOTER = 96

LAND_W, LAND_H = 126, 117
LAND_FACE_LIFT = 12.5  # `HEX_GRID_CONTENT_LIFT`：格面中心比整图中心高 12.5px


def font(size, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    return ImageFont.truetype(path, size)


F_TITLE = font(26, True)
F_SUB = font(13)
F_ROW = font(16, True)
F_CELL = font(12)
F_TINY = font(12)
F_BIG = font(14, True)


def sample():
    subprocess.run([NPX, 'tsx', 'tools/preview_chest_placement_curves.ts'],
                   cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    with open(CURVES, encoding='utf-8') as handle:
        return json.load(handle)


def load_art(path):
    """返回 (图, 画布尺寸, alpha 包围盒[像素，y 向下])。"""
    image = Image.open(path).convert('RGBA')
    bbox = image.split()[3].getbbox() or (0, 0, image.width, image.height)
    return image, image.size, bbox


def visible_box(canvas, bbox, factor, node_x, node_y):
    """可见区矩形 + 视觉中心，**游戏像素、y 向下、原点在格心**（不乘 ZOOM）。

    节点中心 = 画布中心；可见区中心相对它偏 `(bbox中心 - 画布中心) × factor`。
    """
    vis_w = (bbox[2] - bbox[0]) * factor
    vis_h = (bbox[3] - bbox[1]) * factor
    dcx = ((bbox[0] + bbox[2]) / 2 - canvas[0] / 2) * factor
    dcy = ((bbox[1] + bbox[3]) / 2 - canvas[1] / 2) * factor
    ccx, ccy = node_x + dcx, node_y + dcy
    return (ccx - vis_w / 2, ccy - vis_h / 2, ccx + vis_w / 2, ccy + vis_h / 2), (ccx, ccy)


def paste_center(panel, image, factor, node_x, node_y, cx, cy):
    """按 `factor × ZOOM` 缩放，以**画布中心**对齐到格心 + (node_x, node_y)×ZOOM。"""
    scale = factor * ZOOM
    drawn = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS)
    px = cx + node_x * ZOOM
    py = cy + node_y * ZOOM
    panel.alpha_composite(drawn, (round(px - drawn.width / 2), round(py - drawn.height / 2)))


def panel_for(kind, data, arts, land):
    """画一块面板，返回 (图, 可见区矩形[游戏像素], 视觉中心[游戏像素])。"""
    frame_img, frame_canvas, frame_bbox = arts['frame']
    static_img, static_canvas, static_bbox = arts['static']
    panel = Image.new('RGBA', (PANEL_W, PANEL_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(panel)
    cx, cy = PANEL_W / 2, PANEL_H / 2

    tile = land.resize((round(LAND_W * ZOOM), round(LAND_H * ZOOM)), Image.LANCZOS)
    panel.alpha_composite(tile, (round(cx - tile.width / 2), round(cy - tile.height / 2 + LAND_FACE_LIFT * ZOOM)))
    draw.line([(cx - 7, cy), (cx + 7, cy)], fill=GUIDE, width=1)
    draw.line([(cx, cy - 7), (cx, cy + 7)], fill=GUIDE, width=1)

    if kind == 'static':
        node = data['stationIconNodeSize']
        # 站点：Icon 节点 128×128 + 可见宽归一 k；可见中心≈节点中心（trim 偏移 0.5px）
        k = data['targetVisibleWidth'] / ((static_bbox[2] - static_bbox[0]) * node / static_canvas[0])
        factor = (node / static_canvas[0]) * k
        paste_center(panel, static_img, factor, 0, 0, cx, cy)
        box, center = visible_box(static_canvas, static_bbox, factor, 0, 0)
    elif kind == 'before':
        factor = data['before']['scale']
        # 节点直接摆在格心（改前没有补偿）；y 向上的 offsetY 换到 y 向下要取反
        node_x, node_y = data['before']['offsetX'], -data['before']['offsetY']
        paste_center(panel, frame_img, factor, node_x, node_y, cx, cy)
        box, center = visible_box(frame_canvas, frame_bbox, factor, node_x, node_y)
    else:
        factor = data['after']['scale']
        node_x, node_y = data['after']['offsetX'], -data['after']['offsetY']
        paste_center(panel, frame_img, factor, node_x, node_y, cx, cy)
        box, center = visible_box(frame_canvas, frame_bbox, factor, node_x, node_y)
    return panel, box, center


def to_panel(box):
    """游戏像素 → 面板像素（相对格心）。"""
    cx, cy = PANEL_W / 2, PANEL_H / 2
    return (cx + box[0] * ZOOM, cy + box[1] * ZOOM, cx + box[2] * ZOOM, cy + box[3] * ZOOM)


def draw_wrapped(draw, x, y, text, fnt, fill, max_width, line_height=19):
    """按像素宽度硬折行（PIL 没有自动换行）。"""
    line = ''
    for char in text:
        probe = line + char
        if draw.textlength(probe, font=fnt) > max_width and line:
            draw.text((x, y), line, font=fnt, fill=fill)
            y += line_height
            line = char
        else:
            line = probe
    if line:
        draw.text((x, y), line, font=fnt, fill=fill)
        y += line_height
    return y


def main():
    data = sample()
    arts = {'frame': load_art(FRAME_PNG), 'static': load_art(STATIC_PNG)}
    land = Image.open(LAND_PNG).convert('RGBA')

    columns = [
        ('static', '① 静止态（地图上那只）', '基准：可见 84 × 66'),
        ('before', '② 改前：按画布高 132 归一', '更大、更低'),
        ('after', '③ 改后：按可见宽 84 归一', '与静止态重合'),
    ]
    total_w = MARGIN * 2 + PANEL_W * len(columns) + GAP * (len(columns) - 1)
    sheet = Image.new('RGB', (total_w, 900), BG)
    draw = ImageDraw.Draw(sheet)

    draw.text((MARGIN, 16), '开箱表演：箱子的尺寸与落位（真美术 · 按运行时缩放贴图）', font=F_TITLE, fill=INK)
    y = draw_wrapped(
        draw, MARGIN, 52,
        '口径：表演里那只箱子要和地图上静止的那只一样大、摆在同一处。格面 123×90，十字为格心。',
        F_SUB, MUTED, total_w - MARGIN * 2)
    y = draw_wrapped(
        draw, MARGIN, y + 3,
        '改前两个毛病：① 归一按画布高 132/156 —— 画布上方留给箱盖的 44px 被算进箱子高度 ⇒ 整体大 1.39 倍；',
        F_SUB, MUTED, total_w - MARGIN * 2)
    y = draw_wrapped(
        draw, MARGIN, y,
        '② 节点以画布中心对齐格心，而画布中心比箱子的视觉中心高 21px ⇒ 又整体低了 18px。',
        F_SUB, MUTED, total_w - MARGIN * 2)
    y = draw_wrapped(
        draw, MARGIN, y + 3,
        '改后：按「可见宽」归一到建筑归一宽 84（真源 TerritoryStationView），视觉中心补偿回格心；'
        '轻微放大交给弹出过冲 1.15。',
        F_SUB, MUTED, total_w - MARGIN * 2)

    panel_top = max(HEADER, y + 10)
    panels = {}
    for index, (kind, title, note) in enumerate(columns):
        left = MARGIN + index * (PANEL_W + GAP)
        top = panel_top
        panel, box, center = panel_for(kind, data, arts, land)
        sheet.paste(panel, (left, top), panel)
        draw.rectangle([left, top, left + PANEL_W - 1, top + PANEL_H - 1], outline=LINE)
        draw.text((left + 4, top + 6), title, font=F_ROW,
                  fill=GOOD if kind == 'after' else (BAD if kind == 'before' else INK))
        draw.text((left + 4, top + PANEL_H + 8), note, font=F_CELL,
                  fill=GOOD if kind == 'after' else (BAD if kind == 'before' else MUTED))
        panels[kind] = (left, top, box, center)

    # 在 ② 上叠加两条轮廓：红 = 改前、蓝 = 改后，一眼看出差多少
    left, top, before_box, _ = panels['before']
    after_box = panels['after'][2]
    overlay = sheet.crop((left, top, left + PANEL_W, top + PANEL_H)).convert('RGBA')
    odraw = ImageDraw.Draw(overlay)
    for box, color in ((panels['after'][2], GOOD), (before_box, BAD)):
        rect = to_panel(box)
        odraw.rectangle(rect, outline=color, width=2)
    sheet.paste(overlay.convert('RGB'), (left, top))

    def size(box):
        return f'{box[2] - box[0]:.0f} × {box[3] - box[1]:.0f}'

    static_box = panels['static'][2]
    static_w = static_box[2] - static_box[0]
    line_y = panel_top + PANEL_H + 30
    draw.text((MARGIN, line_y),
              f'可见区（游戏像素）：静止 {size(static_box)}　改前 {size(before_box)}'
              f'（宽 {(before_box[2] - before_box[0]) / static_w:.2f}×）'
              f'　改后 {size(after_box)}（宽 {(after_box[2] - after_box[0]) / static_w:.2f}×）',
              font=F_BIG, fill=INK)
    draw.text((MARGIN, line_y + 22),
              f'视觉中心纵向偏移：改前 {(before_box[1] + before_box[3]) / 2 - (static_box[1] + static_box[3]) / 2:+.1f}px（偏低）'
              f'　改后 {(after_box[1] + after_box[3]) / 2 - (static_box[1] + static_box[3]) / 2:+.1f}px（对齐）',
              font=F_BIG, fill=INK)
    draw.text((MARGIN, line_y + 46),
              '② 上的红框 = 改前轮廓、蓝框 = 改后轮廓（画在改前的图上，所以红色贴边、蓝色在箱子内）。'
              f'整体按 {ZOOM}× 放大显示。',
              font=F_TINY, fill=MUTED)

    sheet = sheet.crop((0, 0, total_w, line_y + 46 + 18))
    sheet.save(OUT)
    print(f'已出图：{OUT}  ({sheet.width}×{sheet.height})')
    print(f'  静止 {size(static_box)} / 改前 {size(before_box)} / 改后 {size(after_box)}')


if __name__ == '__main__':
    main()
