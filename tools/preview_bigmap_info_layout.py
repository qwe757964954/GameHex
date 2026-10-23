# -*- coding: utf-8 -*-
"""画「世界页详情弹窗居中竖排」改前改后对照图（离线验收用，不参与运行时）。

用法（在仓库根目录）：
    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/preview_bigmap_info_layout.py

为什么要这张图（2026-10-22）：用户给实机截图说「弹窗内的 icon 和描述以及标题需要统一居中对齐」。
截图里三样东西各偏一边：图标被推在卡片左边缘、压在正文上；正文左对齐、从图标底下起笔；
标题为让开图标整体右移。这种"错位"只有按真实排版数字贴一遍才看得出，文字描述会失真。

流程：`npx tsx tools/preview_bigmap_info_layout_curves.ts` 从 `model/BigMapInfoLayout` 取排版数字
      （真源），图标高度也从真美术的 alpha 包围盒算 ⇒ 这里只贴图，不重算公式。
产物：docs/世界页详情弹窗-居中竖排-改前改后.png
"""
import json
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURVES = os.path.join(ROOT, 'docs', '.tmp-bigmap-info-layout.json')
OUT = os.path.join(ROOT, 'docs', '世界页详情弹窗-居中竖排-改前改后.png')

NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'

BG = (246, 247, 249)
INK = (30, 34, 40)
MUTED = (120, 128, 140)
LINE = (223, 226, 232)
BAD = (214, 62, 54)
GOOD = (28, 130, 214)
GUIDE = (240, 170, 40)

# 与 `BIGMAP_HUD_COLORS` 同值（HUD 深色卡 + 金）
CARD = (72, 73, 83)
RIM = (7, 7, 8)
HAIRLINE = (176, 138, 78)
GOLD = (245, 201, 92)
CREAM = (238, 235, 214)
CARD_INK = (48, 34, 22)
BUTTON = (245, 201, 92)
CLOSE_FILL = (92, 93, 104)

SCALE = 1.0
GAP = 16
MARGIN = 22
HEADER = 108


def font(size, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    return ImageFont.truetype(path, max(9, round(size)))


def sample():
    subprocess.run([NPX, 'tsx', 'tools/preview_bigmap_info_layout_curves.ts'],
                   cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    with open(CURVES, encoding='utf-8') as handle:
        return json.load(handle)


class Canvas:
    """卡片局部坐标（原点在卡片中心、y 向上）→ 图像像素（y 向下）。"""

    def __init__(self, image, draw, cx, cy):
        self.image = image
        self.draw = draw
        self.cx = cx
        self.cy = cy

    def px(self, x, y):
        return self.cx + x * SCALE, self.cy - y * SCALE

    def rect(self, x, y, w, h):
        left, top = self.px(x - w / 2, y + h / 2)
        right, bottom = self.px(x + w / 2, y - h / 2)
        return [left, top, right, bottom]

    def text(self, x, y, value, fnt, fill, anchor='mm'):
        px, py = self.px(x, y)
        self.draw.text((px, py), value, font=fnt, fill=fill, anchor=anchor)


def draw_card(canvas, panel_w, panel_h):
    draw = canvas.draw
    radius = 16 * SCALE
    outer = canvas.rect(0, 0, panel_w, panel_h)
    draw.rounded_rectangle(outer, radius=radius + 1, fill=RIM)
    inset = 2 * SCALE
    inner = [outer[0] + inset, outer[1] + inset, outer[2] - inset, outer[3] - inset]
    draw.rounded_rectangle(inner, radius=max(0, radius - inset), fill=CARD, outline=HAIRLINE, width=1)


def draw_close(canvas, panel_w, panel_h):
    size = 30 * SCALE
    cx, cy = canvas.px(panel_w / 2 - 23, panel_h / 2 - 22)
    canvas.draw.rounded_rectangle([cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2],
                                 radius=size * 0.3, fill=CLOSE_FILL)
    canvas.draw.text((cx, cy), '×', font=font(22 * SCALE, True), fill=CARD_INK, anchor='mm')


def draw_button(canvas, x, y, caption, primary=False):
    w, h = 132 * SCALE, 52 * SCALE
    left, top = canvas.px(x - 66, y + 26)
    right, bottom = canvas.px(x + 66, y - 26)
    canvas.draw.rounded_rectangle([left, top, right, bottom], radius=8 * SCALE,
                                  fill=BUTTON if primary else (250, 232, 176))
    px, py = canvas.px(x, y)
    canvas.draw.text((px, py), caption, font=font(19 * SCALE, True), fill=CARD_INK, anchor='mm')


def draw_icon(canvas, png, x, y, height):
    image = Image.open(png).convert('RGBA')
    bbox = image.split()[3].getbbox()
    drawn_h = max(1, round(height * SCALE))
    drawn_w = max(1, round((bbox[2] - bbox[0]) / (bbox[3] - bbox[1]) * drawn_h))
    scaled = image.resize((drawn_w, drawn_h), Image.LANCZOS)
    px, py = canvas.px(x, y)
    canvas.image.alpha_composite(scaled, (round(px - drawn_w / 2), round(py - drawn_h / 2)))


def draw_body(canvas, lines, box_x, box_y, box_w, box_h, line_height, center):
    """正文：`center=True` 走居中（改后），否则沿左边界起笔（改前）。"""
    fnt = font(14 * SCALE)
    step = line_height * SCALE
    top = box_y + box_h / 2
    total = len(lines) * step
    # Label 的 verticalAlign = CENTER ⇒ 整块文字在框内垂直居中
    first_y = top - (box_h - total) / 2 - step / 2
    for index, line in enumerate(lines):
        y = first_y - index * step
        if center:
            canvas.text(0, y, line, fnt, CREAM)
        else:
            canvas.text(box_x - box_w / 2, y, line, fnt, CREAM, anchor='lm')


def panel(data, scene, kind):
    """画一块卡片，返回 (图, 备注文字)。"""
    panel_w, panel_h = data['panelWidth'], data['panelHeight']
    image = Image.new('RGBA', (round(panel_w * SCALE) + 8, round(panel_h * SCALE) + 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    canvas = Canvas(image, draw, image.width / 2, image.height / 2)
    draw_card(canvas, panel_w, panel_h)
    draw_close(canvas, panel_w, panel_h)

    icon_png = os.path.join(ROOT, data['cityIconPng'])
    layout = scene['layout']
    if kind == 'before':
        legacy = scene['legacy']
        canvas.text(legacy['titleX'], panel_h / 2 - 46, scene['title'], font(24 * SCALE, True), GOLD)
        draw_icon(canvas, icon_png, legacy['iconX'], legacy['iconY'],
                  data['iconNaturalHeight'])
        draw_body(canvas, scene['lines'], legacy['bodyX'], legacy['bodyY'],
                  legacy['bodyWidth'], legacy['bodyHeight'], 19, center=False)
        draw_button(canvas, legacy['secondaryX'], legacy['actionY'], '定位')
        return image, '三样各偏一边：图标压在正文上、标题右移'

    canvas.text(layout['centerX'], layout['titleY'], scene['title'], font(24 * SCALE, True), GOLD)
    if layout['iconVisible']:
        draw_icon(canvas, icon_png, 0, layout['iconY'], layout['iconSize'])
    draw_body(canvas, scene['lines'], 0, layout['bodyY'], layout['bodyWidth'],
              layout['bodyHeight'], 19, center=True)
    if scene.get('hasSecondary'):
        draw_button(canvas, layout['secondaryX'], layout['actionY'], '定位')
    if scene.get('hasPrimary'):
        draw_button(canvas, layout['primaryX'], layout['actionY'], '攻打', primary=True)
    # 中线参考：证明标题 / 图标 / 正文 / 单颗按钮都在同一条竖线上
    top = canvas.px(0, panel_h / 2 - 6)
    bottom = canvas.px(0, -panel_h / 2 + 6)
    for y in range(int(top[1]), int(bottom[1]), 9):
        draw.line([(top[0], y), (top[0], y + 4)], fill=GUIDE, width=1)
    note = '一条中线：标题 / 图标 / 正文 / 按钮'
    if not layout['iconVisible']:
        note = '文案太长 ⇒ 图标自动让位，正文吃满（不截字）'
    return image, note


def draw_wrapped(draw, x, y, text, fnt, fill, max_width, line_height=18):
    line = ''
    for char in text:
        if draw.textlength(line + char, font=fnt) > max_width and line:
            draw.text((x, y), line, font=fnt, fill=fill)
            y += line_height
            line = char
        else:
            line += char
    if line:
        draw.text((x, y), line, font=fnt, fill=fill)
        y += line_height
    return y


def main():
    data = sample()
    scenes = {scene['key']: scene for scene in data['scenes']}
    columns = [
        ('before', '① 改前（截图）'),
        ('after-site', '② 改后 · 据点（3 行）'),
        ('after-city', '③ 改后 · 城池（9 行）'),
    ]

    rendered = [(key, title, *panel(data, scenes[key], key)) for key, title in columns]
    card_w = rendered[0][2].width
    card_h = rendered[0][2].height

    total_w = MARGIN * 2 + card_w * len(rendered) + GAP * (len(rendered) - 1)
    sheet = Image.new('RGB', (total_w, 820), BG)
    draw = ImageDraw.Draw(sheet)
    draw.text((MARGIN, 16), '世界页目标详情弹窗：icon / 描述 / 标题 统一居中', font=font(25, True), fill=INK)
    y = draw_wrapped(
        draw, MARGIN, 52,
        '口径：「弹窗内的 icon 和描述以及标题需要统一居中对齐」。卡片 560×400（720×1280 设计稿），1:1 显示；橙色虚线是卡片的中线。',
        font(13), MUTED, total_w - MARGIN * 2)
    y = draw_wrapped(
        draw, MARGIN, y + 3,
        '改前的两个成因：图标 x 用「视口宽」算（-560/2+78）而父节点是卡片 ⇒ 跑到卡片左边缘、压在正文上；'
        '标题为让开图标另算了一个 textCenter ⇒ 右移 86px；正文又是左对齐 ⇒ 从图标底下起笔。',
        font(13), MUTED, total_w - MARGIN * 2)

    top = max(HEADER, y + 12)
    for index, (key, title, image, note) in enumerate(rendered):
        left = MARGIN + index * (card_w + GAP)
        sheet.paste(image, (left, top), image)
        color = BAD if key == 'before' else GOOD
        draw.text((left + 2, top + card_h + 10), title, font=font(16, True), fill=color)
        draw.text((left + 2, top + card_h + 32), note, font=font(12), fill=MUTED)

    bottom = top + card_h + 78
    draw.text((MARGIN, bottom),
              '② 里只有「定位」⇒ 按钮也归中线；两颗都在时并排 ±76（整体仍对称）。'
              '③ 的图标被收起是有意的：9 行文案 + 108px 图标在 400 高的卡片里放不下，文字优先。',
              font=font(13), fill=INK)
    sheet = sheet.crop((0, 0, total_w, bottom + 26))
    sheet.save(OUT)
    print(f'已出图：{OUT}  ({sheet.width}×{sheet.height})')


if __name__ == '__main__':
    main()
