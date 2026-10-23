# -*- coding: utf-8 -*-
"""画「开箱表演时间轴」改前改后对照图（离线验收用，不参与运行时）。

用法（在仓库根目录）：
    "C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe" tools/preview_chest_timeline.py

为什么要这张图（2026-10-22）：用户看实机说「宝箱打开后，获取奖励后快速消失，现在停止的
时间太长了」。把「最后一枚奖励落袋 → 宝箱开始消失」这一段画成横条，红色斜纹有多长一眼可见，
比文字里写"空转 0.83s"有效得多。

流程：`npx tsx tools/preview_chest_timeline_curves.ts` 从 model 取数（含改前的对照值）
      → 这里只负责画，不重算任何时序公式。
产物：docs/章节地图宝箱时间轴-改前改后.png
"""
import json
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURVES = os.path.join(ROOT, 'docs', '.tmp-chest-timeline.json')
OUT = os.path.join(ROOT, 'docs', '章节地图宝箱时间轴-改前改后.png')

NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'

BG = (247, 248, 250)
CARD = (255, 255, 255)
INK = (28, 32, 38)
MUTED = (122, 130, 142)
LINE = (226, 229, 235)
# 段色：开箱（灰）/ 奖励飞行（蓝）/ 空转（红斜纹）/ 收尾淡出（深蓝）
C_OPEN = (206, 212, 221)
C_FLY = (126, 186, 236)
C_IDLE = (232, 92, 82)
C_FADE = (52, 108, 176)
C_IDLE_FILL = (250, 228, 226)


def font(size, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    return ImageFont.truetype(path, size)


F_TITLE = font(25, True)
F_SUB = font(13)
F_TIER = font(16, True)
F_ROW = font(12)
F_SEG = font(11)
F_TICK = font(11)
F_CELL = font(13)
F_CELL_B = font(13, True)
F_NOTE = font(12)


W = 1200
MARGIN = 34
X0 = 246
X1 = W - MARGIN
ROW_H = 30
ROW_GAP = 6
TIER_GAP = 30
# 题头布局（写死的三条基线：副标题 4 行 → 图例 → 时间轴；改字要同步改这里）
SUB_Y = 58
LEGEND_Y = 150
AXIS_Y = 184
HEADER_H = AXIS_Y + 34


def sample():
    subprocess.run([NPX, 'tsx', 'tools/preview_chest_timeline_curves.ts'],
                   cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    with open(CURVES, encoding='utf-8') as handle:
        return json.load(handle)


def hatch(draw, box, color, step=6):
    """红色斜纹（表示"什么都没发生"的空白）。"""
    left, top, right, bottom = box
    x = left - (bottom - top)
    while x < right:
        draw.line([(max(left, x), bottom), (min(right, x + (bottom - top)), top)], fill=color, width=1)
        x += step


def main():
    data = sample()
    rows = data['rows']
    max_s = data['maxSeconds']

    def sx(seconds):
        return X0 + (X1 - X0) * (seconds / max_s)

    header_h = HEADER_H
    block_h = 20 + ROW_H * 2 + ROW_GAP + TIER_GAP
    table_h = 214
    height = header_h + block_h * len(rows) + table_h

    image = Image.new('RGB', (W, height), BG)
    draw = ImageDraw.Draw(image)

    # ── 题头 ────────────────────────────────────────────────
    draw.text((MARGIN, 22), '开箱表演时间轴：最后一枚奖励落袋 → 宝箱消失', font=F_TITLE, fill=INK)
    lines = [
        '口径：「宝箱打开后，获取奖励后快速消失，现在停止的时间太长了」。',
        '红色斜纹 = 空转：奖励已经拿完、开着的空箱子杵在那里。老口径把它挂在「总时长 − 淡出」上，',
        '与奖励飞完的时刻无关，所以每一档都白留了一截。现在收尾起点 = 末枚落袋 + settleSeconds，',
        '总时长由这条线推出来：三档空转 0.67 / 0.30 / 0.83s → 0.16 / 0.18 / 0.22s。',
    ]
    y = SUB_Y
    for line in lines:
        draw.text((MARGIN, y), line, font=F_SUB, fill=MUTED)
        y += 21

    # 图例
    legend_x = MARGIN
    legend_y = LEGEND_Y
    for label, color, kind in (
        ('开箱（出场 → 箱盖开完）', C_OPEN, 'fill'),
        ('奖励飞行', C_FLY, 'fill'),
        ('空转（要削掉的那段）', C_IDLE, 'hatch'),
        ('收尾淡出（与全部光效同灭）', C_FADE, 'fill'),
    ):
        draw.rectangle([legend_x, legend_y, legend_x + 16, legend_y + 11], fill=color)
        if kind == 'hatch':
            hatch(draw, (legend_x, legend_y, legend_x + 16, legend_y + 11), (255, 255, 255))
            draw.rectangle([legend_x, legend_y, legend_x + 16, legend_y + 11], outline=C_IDLE)
        draw.text((legend_x + 22, legend_y - 1), label, font=F_SUB, fill=MUTED)
        legend_x += 22 + int(draw.textlength(label, font=F_SUB)) + 26

    # 时间刻度（每 0.5s 一根）：标签压在轴上方，轴下方就是条带区
    axis_y = AXIS_Y
    draw.line([(X0, axis_y), (X1, axis_y)], fill=(208, 213, 222), width=1)
    tick = 0.0
    while tick <= max_s + 1e-9:
        x = sx(tick)
        draw.line([(x, axis_y), (x, axis_y + 5)], fill=(208, 213, 222), width=1)
        draw.line([(x, axis_y + 5), (x, height - table_h + 8)], fill=LINE, width=1)
        draw.text((x - 11, axis_y - 18), '%.1f' % tick, font=F_TICK, fill=MUTED)
        tick += 0.5
    draw.text((X1, axis_y - 34), '秒', font=F_TICK, fill=MUTED, anchor='ra')

    # ── 每档两行 ─────────────────────────────────────────────
    y = header_h
    for row in rows:
        draw.text((MARGIN, y), row['name'], font=F_TIER, fill=INK)
        draw.text((MARGIN + 52, y + 2),
                  '末枚落袋 %.2fs' % row['lastReward'], font=F_ROW, fill=MUTED)
        y += 20

        bars = [
            ('改前', row['legacyFadeStart'], row['legacyTotal'], True),
            ('改后', row['fadeStart'], row['end'], False),
        ]
        for label, fade_start, total, legacy in bars:
            draw.text((MARGIN, y + 8), label, font=F_ROW, fill=C_IDLE if legacy else C_FADE)
            top, bottom = y, y + ROW_H

            # 1) 开箱段（强档 0.30s 才入场，条就从 0.30 起 —— 图上不许比实际更早）
            draw.rectangle([sx(row['openStart']), top, sx(row['lidEnd']), bottom], fill=C_OPEN)
            # 2) 奖励飞行
            draw.rectangle([sx(row['flyStart']), top, sx(row['lastReward']), bottom], fill=C_FLY)
            # 3) 空转（斜纹）
            idle_box = [sx(row['lastReward']) + 1, top, sx(fade_start), bottom]
            if idle_box[2] - idle_box[0] >= 1:
                draw.rectangle(idle_box, fill=C_IDLE_FILL)
                hatch(draw, idle_box, C_IDLE, step=5 if legacy else 4)
            # 4) 收尾淡出
            draw.rectangle([sx(fade_start), top, sx(total), bottom], fill=C_FADE)

            # 边框 + 结束标记
            draw.rectangle([sx(row['openStart']), top, sx(total), bottom], outline=(255, 255, 255), width=1)
            draw.line([(sx(total), top - 3), (sx(total), bottom + 3)], fill=C_FADE, width=2)
            # 末枚落袋的刻线（两版同一位置 ⇒ 削掉的是"尾巴"，不是把奖励提前）
            draw.line([(sx(row['lastReward']), top - 4), (sx(row['lastReward']), bottom + 4)],
                      fill=(120, 96, 40), width=1)

            # 行内数值（贴右边界时改写在竖线左侧，别被画布截掉）
            text = '%.2fs' % total
            text_w = draw.textlength(text, font=F_ROW)
            if sx(total) + 8 + text_w > X1:
                draw.text((sx(total) - 8 - text_w, top + 8), text, font=F_ROW,
                          fill=C_IDLE if legacy else C_FADE)
            else:
                draw.text((sx(total) + 8, top + 8), text, font=F_ROW,
                          fill=C_IDLE if legacy else C_FADE)

            # 空转数字（够宽才写，否则会压到斜纹里）
            idle_s = fade_start - row['lastReward']
            if idle_s * (X1 - X0) / max_s >= 54:
                mid = (sx(row['lastReward']) + sx(fade_start)) / 2
                draw.text((mid - 20, top + 8), '%.2fs' % idle_s, font=F_ROW, fill=(176, 52, 44))

            y += ROW_H + ROW_GAP
        y += TIER_GAP - ROW_GAP

    # ── 数字表 ───────────────────────────────────────────────
    table_top = height - table_h + 26
    draw.line([(MARGIN, table_top - 14), (W - MARGIN, table_top - 14)], fill=LINE, width=1)
    cols = [MARGIN, MARGIN + 96, MARGIN + 236, MARGIN + 376, MARGIN + 516, MARGIN + 656, MARGIN + 800]
    headers = ['档位', '末枚落袋', '空转 · 改前', '空转 · 改后', '总时长 · 改前', '总时长 · 改后', '整段缩短']
    for index, head in enumerate(headers):
        draw.text((cols[index], table_top), head, font=F_CELL_B, fill=INK)
    y = table_top + 26
    for row in rows:
        cut = row['legacyTotal'] - row['total']
        values = [
            row['name'],
            '%.2fs' % row['lastReward'],
            '%.2fs' % row['legacyIdle'],
            '%.2fs' % row['idle'],
            '%.2fs' % row['legacyTotal'],
            '%.2fs' % row['total'],
            '-%.2fs（-%d%%）' % (cut, round(cut / row['legacyTotal'] * 100)),
        ]
        for index, value in enumerate(values):
            color = INK if index == 0 else (C_IDLE if index in (2, 4) else C_FADE)
            if index == 6:
                color = (46, 148, 96)
            draw.text((cols[index], y), value, font=F_CELL, fill=color)
        y += 24

    notes = [
        '注：末枚落袋时刻（1.78 / 1.90 / 2.67s）两版完全相同 —— 削掉的只是奖励落袋之后的空转，奖励飞行的节奏一点没动。',
        '因此强档 3.23s 低于参考视频的 3.5s 下限，属有意偏离：那 0.5s 本身就是静置。要找回旧节奏只调 settleSeconds 一个数。',
        '重新生成：npx tsx tools/preview_chest_timeline_curves.ts && python tools/preview_chest_timeline.py（只出图，不动游戏代码）',
    ]
    note_y = y + 10
    for note in notes:
        draw.text((MARGIN, note_y), note, font=F_NOTE, fill=MUTED)
        note_y += 20

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    image.save(OUT)
    print('wrote', OUT, image.size)


if __name__ == '__main__':
    main()
