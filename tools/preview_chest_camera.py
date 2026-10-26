# -*- coding: utf-8 -*-
"""画「开箱镜头推进」对照图（离线验收用，不参与运行时）。

用法（在仓库根目录）：
    "C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe" tools/preview_chest_camera.py

为什么要这张图（2026-10-22，2026-10-23 改口径）：用户先要「镜头轻微推进」，再要「倍率按奖励资源的
数量分弱中强三档（1.08 / 1.35 / 2.3）」。倍率是个幅度问题，文字说不清 ——
所以上图是**曲线**（幅度 + 时机），下图是 **1:1 像素**的真实大小对比（红虚线 = 静止态原大小）。

⚠️ 实现口径：倍率乘在「镜头层」（Stage：宝箱 + 光效）上并绕**箱口**缩放，
   同时 `focus` 把视角中心从格心挪到屏幕中心（地图那半由 `TerritoryMapView` 同帧跟上）。
   下图只画宝箱那半（地块固定）—— 是为了让"放大了多少"看得清，不是运行时就这样。

流程：`npx tsx tools/preview_chest_camera_curves.ts` 从 model 逐帧采样
      → 这里只画，不重算缓动。
产物：docs/章节地图宝箱镜头推进-改前改后.png
"""
import json
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURVES = os.path.join(ROOT, 'docs', '.tmp-chest-camera.json')
CHEST_PNG = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'chest', 'chest_seq_0.png')
LAND_PNG = os.path.join(ROOT, 'assets', 'resources', 'image', 'buildings', 'img_land_01.png')
OUT = os.path.join(ROOT, 'docs', '章节地图宝箱镜头推进-改前改后.png')

NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'

BG = (247, 248, 250)
INK = (28, 32, 38)
MUTED = (122, 130, 142)
LINE = (226, 229, 235)
C_WEAK = (86, 156, 214)
C_MEDIUM = (232, 150, 62)
C_STRONG = (176, 88, 208)
C_BEFORE = (150, 156, 168)
C_LID = (214, 62, 54)
C_FADE = (52, 108, 176)

# 补帧图几何（`TERRITORY_CHEST_ART_METRICS`：画布 142×156、闭合可见 x[2,140] y[2,112]）
ART_CANVAS = (142, 156)
ART_LEFT, ART_BOTTOM, ART_W, ART_H = 2, 2, 138, 110
LAND_DRAW = (126, 117)

W = 1200
MARGIN = 34


def font(size, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    return ImageFont.truetype(path, size)


F_TITLE = font(25, True)
F_SUB = font(13)
F_PANEL = font(15, True)
F_AXIS = font(11)
F_TINY = font(11)
F_ROW = font(12)
F_CELL = font(13)
F_CELL_B = font(13, True)


def sample():
    subprocess.run([NPX, 'tsx', 'tools/preview_chest_camera_curves.ts'],
                   cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    with open(CURVES, encoding='utf-8') as handle:
        return json.load(handle)


def draw_curve_panel(image, box, row, color):
    """一块「倍率 ~ 时间」小图：曲线 + 开盖/收尾的竖线 + 峰值标注。"""
    left, top, right, bottom = box
    draw = ImageDraw.Draw(image)
    pad_l, pad_r, pad_t, pad_b = 44, 16, 48, 26
    px0, px1 = left + pad_l, right - pad_r
    py0, py1 = top + pad_t, bottom - pad_b

    end = row['end']
    peak = row['peak']
    # Y 轴范围：每档按自己的峰值留余量（2026-10-23 起三档都是 2.3×，但保留这条算法不影响）
    y_max = peak + (peak - 1) * 0.35 + 0.002

    def sx(t):
        return px0 + (px1 - px0) * (t / end)

    def sy(value):
        return py1 - (py1 - py0) * ((value - 1) / (y_max - 1))

    draw.rectangle([px0, py0, px1, py1], fill=(255, 255, 255), outline=LINE)

    # 1.0 基线
    draw.line([(px0, sy(1)), (px1, sy(1))], fill=(206, 212, 220), width=1)
    draw.text((px0 - 6, sy(1) - 7), '1.00', font=F_AXIS, fill=MUTED, anchor='ra')
    draw.text((px0 - 6, sy(peak) - 7), '%.2f' % peak, font=F_AXIS, fill=color, anchor='ra')

    # 开盖段（浅红底）+ 收尾段（浅蓝底）
    draw.rectangle([sx(row['lidStart']), py0, sx(row['lidEnd']), py1], fill=(252, 240, 238))
    draw.rectangle([sx(row['fadeStart']), py0, sx(end), py1], fill=(238, 244, 252))

    # 曲线（面积 + 线）
    points = [(sx(s['t']), sy(s['scale'])) for s in row['samples']]
    if len(points) > 1:
        draw.polygon(points + [(points[-1][0], sy(1)), (points[0][0], sy(1))], fill=color + (0,) if False else None)
        draw.line(points, fill=color, width=2)

    # 关键时刻竖线（标签放在 X 轴下方：放面板里会压住曲线）
    for t, label in ((row['lidStart'], '开盖'), (row['fadeStart'], '收尾')):
        x = sx(t)
        draw.line([(x, py0), (x, py1)], fill=(196, 202, 212), width=1)
        draw.text((x + 3, py1 + 6), label, font=F_TINY, fill=MUTED)

    # X 轴
    draw.line([(px0, py1), (px1, py1)], fill=(206, 212, 220), width=1)
    # 起点 / 终点写在轴下方第二行：第一行留给「开盖 / 收尾」，否则末端会撞在一起
    draw.text((px0, py1 + 6), '0', font=F_AXIS, fill=MUTED)
    draw.text((px1, py1 + 20), '整段 %.2fs' % end, font=F_AXIS, fill=MUTED, anchor='ra')

    # 面板标题：第一行是"总量落在哪一档"，第二行才是峰值/尺寸（名字变长了，不能并排写）
    draw.text((left + 2, top + 2), row['name'], font=F_PANEL, fill=INK)
    detail = '峰值 %.2f×　宝箱 %.0fpx' % (peak, row['chestWidthAtPeak'])
    draw.text((left + 2, top + 24), detail, font=F_ROW, fill=color)


def draw_chest_panel(image, box, label, zoom, note, color, chest, land):
    left, top, right, bottom = box
    draw = ImageDraw.Draw(image)
    draw.text((left, top - 22), label, font=F_ROW, fill=color)  # 面板上方
    cx, cy = (left + right) / 2, (top + bottom) / 2 + 4

    tile = land.resize(LAND_DRAW, Image.LANCZOS)
    image.paste(tile, (round(cx - tile.width / 2), round(cy - tile.height / 2)), tile)

    # 宝箱：按「可见宽 = 84 × zoom」归一
    scale = 84 * zoom / ART_W
    drawn = chest.resize((max(1, round(chest.width * scale)), max(1, round(chest.height * scale))), Image.LANCZOS)
    # 可见区中心相对画布中心的偏移（画布坐标系，y 向上）
    dcx = (ART_CANVAS[0] / 2 - (ART_LEFT + ART_W / 2)) * scale
    dcy = (ART_CANVAS[1] / 2 - (ART_BOTTOM + ART_H / 2)) * scale
    paste_x = round(cx + dcx - drawn.width / 2)
    paste_y = round(cy - dcy - drawn.height / 2)
    image.paste(drawn, (paste_x, paste_y), drawn)

    # 静止态原大小（虚线框）—— 一眼看出"放大了多少"
    ref_w, ref_h = 84, 110 * 84 / ART_W
    draw.rectangle([cx - ref_w / 2, cy - ref_h / 2, cx + ref_w / 2, cy + ref_h / 2],
                   outline=(214, 62, 54), width=1)
    draw.text((cx, bottom + 8), note, font=F_TINY, fill=MUTED, anchor='ma')  # 面板下方，避开宝箱


def main():
    data = sample()
    rows = data['rows']

    header_h = 118
    chart_h = 316
    panel_h = 210
    section_top = header_h + chart_h + 8
    panel_top = section_top + 44
    height = panel_top + panel_h + 84

    image = Image.new('RGB', (W, height), BG)
    draw = ImageDraw.Draw(image)

    draw.text((MARGIN, 22), '开箱镜头推进：推多近看「拿了多少」，不看档位', font=F_TITLE, fill=INK)
    for index, line in enumerate([
        '口径（2026-10-23 最终）：「推进的倍率根据奖励资源的数量区分弱中强三档 …… 强 2.3、中 1.35、弱 1.08」。',
        '三条曲线共用同一份时间轴（弱档），差别只剩倍数本身；起点恒 1.00，推近从开盖那一刻起步、'
        '与开盖同长，拉回与收尾淡出同起同落。',
        'focus = (scale-1)/(本次倍率-1) 恒到 1，任何倍数推到头时宝箱都精确落在屏幕中心 (0,0)。',
    ]):
        draw.text((MARGIN, 58 + index * 21), line.replace('**', ''), font=F_SUB, fill=MUTED)

    # ── 三段曲线 ──────────────────────────────────────────────
    colors = {'weak': C_WEAK, 'medium': C_MEDIUM, 'strong': C_STRONG}
    gap = 24
    panel_w = (W - MARGIN * 2 - gap * 2) // 3
    for index, row in enumerate(rows):
        left = MARGIN + index * (panel_w + gap)
        draw_curve_panel(image, (left, header_h, left + panel_w, header_h + chart_h - 40),
                         row, colors[row['tier']])

    # ── 1:1 大小对比 ──────────────────────────────────────────
    draw.line([(MARGIN, section_top - 6), (W - MARGIN, section_top - 6)], fill=LINE, width=1)
    draw.text((MARGIN, section_top + 2),
              '峰值那一帧的真实大小（1:1 像素，红虚线框 = 静止态 84px 宽；为看清倍数，地块画成固定不动）',
              font=F_ROW, fill=MUTED)

    chest = Image.open(CHEST_PNG).convert('RGBA')
    land = Image.open(LAND_PNG).convert('RGBA')
    boxes = [
        ('改前：不推镜', 1.0, '84px（与静止态一致）', C_BEFORE),
        # 2026-10-23 最终口径：倍率由奖励总量给（≤50 / ≤500 / >500 ⇒ 1.08 / 1.35 / 2.3）
        ('弱：%.2f×' % rows[0]['cameraZoom'], rows[0]['cameraZoom'],
         '%dpx' % round(84 * rows[0]['cameraZoom']), C_WEAK),
        ('中：%.2f×' % rows[1]['cameraZoom'], rows[1]['cameraZoom'],
         '%dpx' % round(84 * rows[1]['cameraZoom']), C_MEDIUM),
        ('强：%.2f×' % rows[2]['cameraZoom'], rows[2]['cameraZoom'],
         '%dpx' % round(84 * rows[2]['cameraZoom']), C_STRONG),
    ]
    panel_w2 = (W - MARGIN * 2 - 20 * 3) // 4
    for index, (label, zoom, note, color) in enumerate(boxes):
        left = MARGIN + index * (panel_w2 + 20)
        draw_chest_panel(image, (left, panel_top, left + panel_w2, panel_top + panel_h),
                         label, zoom, note, color, chest, land)

    draw.text((MARGIN, height - 30),
              '重新生成：npx tsx tools/preview_chest_camera_curves.ts && python tools/preview_chest_camera.py'
              '（只出图，不动游戏代码）',
              font=F_TINY, fill=MUTED)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    image.save(OUT)
    print('wrote', OUT, image.size)


if __name__ == '__main__':
    main()
