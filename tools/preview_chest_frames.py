# -*- coding: utf-8 -*-
"""画「三档开箱关键帧」实图预览（离线验收用，不参与运行时）。

用法（在仓库根目录）：
    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/preview_chest_frames.py

为什么要这张图（2026-10-22）：开箱从「箱盖分片旋转」改成了**换帧**
（`chest_seq_0` 闭合 → `chest_seq_5` 全开，中间帧由 `tools/gen_chest_open_frames.py` 合成）。
补帧能不能读成「盖子被掀开」，只有看实图判断得出来 —— 时间轴图上它只是几根颜色深浅不同的条。

流程：`npx tsx tools/preview_chest_curves.ts` 按模型逐帧采样 → 这里**直接贴真帧图**
      （帧号由模型给，不在 python 里重算），所以图与运行时看到的是同一张图。
产物：docs/章节地图宝箱关键帧.png
"""
import json
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURVES = os.path.join(ROOT, 'docs', '.tmp-chest-curves.json')
FRAME_DIR = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'chest')
OUT = os.path.join(ROOT, 'docs', '章节地图宝箱关键帧.png')

NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'

BG = (247, 248, 250)
INK = (30, 34, 40)
MUTED = (128, 136, 148)
PANEL = (255, 255, 255)

ZOOM = 1.5


def font(size, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    return ImageFont.truetype(path, size)


F_TITLE = font(30, True)
F_SUB = font(15)
F_ROW = font(19, True)
F_CELL = font(13)
F_TINY = font(12)


def sample():
    """跑 TS 采样器（真源 = model/TerritoryChestAnimation）。"""
    subprocess.run([NPX, 'tsx', 'tools/preview_chest_curves.ts'], cwd=ROOT, check=True)
    with open(CURVES, encoding='utf-8') as fp:
        return json.load(fp)


DATA = sample()
FRAMES = [Image.open(os.path.join(FRAME_DIR, f'chest_seq_{i}.png')).convert('RGBA')
          for i in range(DATA[0]['spec']['openFrames'])]
FRAME_W, FRAME_H = FRAMES[0].size


def nearest(panel, t):
    return min(panel['samples'], key=lambda s: abs(s['t'] - t))


def picks(panel):
    """选帧：语义时刻（数值全部来自模型，这里只决定「看哪几帧」）。"""
    spec = panel['spec']
    candidates = [
        ('弹出', spec['popStart'] + spec['popSeconds'] * 0.55),
        ('蓄力', spec['chargeStart'] + spec['chargeSeconds'] * 0.5),
        # 开盖窗口均分取三张：开头 / 中间 / 收尾（正好检查补帧有没有断层）
        ('开盖 1/3', spec['lidStart'] + spec['lidSeconds'] * 0.2),
        ('开盖 2/3', spec['lidStart'] + spec['lidSeconds'] * 0.55),
        ('全开', spec['lidStart'] + spec['lidSeconds']),
        ('白光', spec['flashStart'] + spec['flashSeconds'] * 0.35),
    ]
    candidates.sort(key=lambda item: item[1])
    return [(name, nearest(panel, t)) for name, t in candidates]


TILE_W = int(FRAME_W * ZOOM) + 12
TILE_H = int(FRAME_H * ZOOM) + 34
COLS = 6
ROW_LABEL = 40
LEFT = 40
W = LEFT * 2 + COLS * TILE_W
TOP = 176
ROW_H = ROW_LABEL + TILE_H
H = TOP + ROW_H * len(DATA) + 56

img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

d.text((36, 26), '章节宝箱：三档开箱关键帧（开盖 = 换帧，chest_seq_0 → 5）', font=F_TITLE, fill=INK)
d.text((38, 74), '第 0 张是闭合宝箱（与地图格子上那只一致），第 5 张是开盖（zw_0005）；'
                 '中间 4 张由 tools/gen_chest_open_frames.py 合成。', font=F_SUB, fill=MUTED)
d.text((38, 96), '合成办法：箱体恒用开盖图的箱体；箱盖绕接缝**纵向长出**（0 → 1）；'
                 '闭合盖垫在下面、压扁淡出（读作「被顶起来让位」）。', font=F_SUB, fill=(196, 116, 48))
d.text((38, 118), '每格左下角是语义时刻，左上角是该帧的模型时间，右上角是模型给出的帧号 —— '
                  '换帧只在 lid 窗口内发生，之后恒停最后一张。', font=F_SUB, fill=MUTED)
d.text((38, 140), '⚠️ 中间帧会被白光（flashStart 起）盖住一部分，这正是不做逐帧精修的前提：'
                  '手伸不到的地方由光效遮。', font=F_SUB, fill=MUTED)

y = TOP
for panel in DATA:
    spec = panel['spec']
    label = f"{panel['label']}　{spec['totalSeconds']:.1f}s"
    d.text((LEFT, y + 8), label, font=F_ROW, fill=INK)
    x_info = LEFT + d.textlength(label, font=F_ROW) + 14
    d.text((x_info, y + 12),
           f"开盖 {spec['lidStart']:.2f}~{spec['lidStart'] + spec['lidSeconds']:.2f}s　"
           f"{spec['openFrames']} 帧（约 {spec['lidSeconds'] * 1000 / max(1, spec['openFrames']):.0f}ms/帧）",
           font=F_TINY, fill=MUTED)

    for col, (name, s) in enumerate(picks(panel)):
        x0 = LEFT + col * TILE_W
        y0 = y + ROW_LABEL
        d.rounded_rectangle([x0 + 4, y0, x0 + TILE_W - 6, y0 + TILE_H - 4], radius=10, fill=PANEL)
        frame = FRAMES[max(0, min(len(FRAMES) - 1, s['frame']))]
        # 该帧的弹出/蓄力缩放也画出来（与运行时同一个数，肉眼可核「小 → 大 → 回落」）
        scale = max(0.01, s['scale'])
        w = max(1, round(frame.width * ZOOM * scale))
        h = max(1, round(frame.height * ZOOM * scale))
        shown = frame.resize((w, h), Image.LANCZOS)
        img.paste(shown, (x0 + (TILE_W - w) // 2, y0 + (TILE_H - 20 - h) // 2), shown)
        d.text((x0 + 10, y0 + 6), f"{s['t']:.2f}s", font=F_TINY, fill=MUTED)
        d.text((x0 + TILE_W - 60, y0 + 6), f"frame {s['frame']}", font=F_TINY, fill=(120, 96, 180))
        d.text((x0 + 10, y0 + TILE_H - 22), name, font=F_CELL, fill=(70, 76, 86))
    y += ROW_H

d.text((36, H - 36),
       '生成方式：npx tsx 采样 model/TerritoryChestAnimation → 直接贴 chest_seq_*.png（帧号来自模型）；'
       '改参数或改帧后重跑即可复核（单测 tests/territory-chest-animation.test.ts）。',
       font=F_TINY, fill=MUTED)

img.save(OUT)
if os.path.exists(CURVES):
    os.remove(CURVES)
print('saved', OUT, img.size)
