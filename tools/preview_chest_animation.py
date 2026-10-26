# -*- coding: utf-8 -*-
"""画「章节宝箱三档动画时间轴」预览图（离线验收用，不参与运行时）。

用法（在仓库根目录）：
    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/preview_chest_animation.py

流程：先 `npx tsx tools/preview_chest_curves.ts` 按模型逐帧采样 → 再用 PIL 画 → 删掉中间 JSON。
产物：docs/章节地图宝箱动画预览.png
"""
import json
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURVES = os.path.join(ROOT, 'docs', '.tmp-chest-curves.json')
OUT = os.path.join(ROOT, 'docs', '章节地图宝箱动画预览.png')

# ⚠️ Windows 上 `npx` 是 `npx.cmd`，直接传 'npx' 会 `WinError 2`（不是 PATH 问题，是扩展名）。
NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'


def sample() -> list:
    """跑 TS 采样器（真源 = model/TerritoryChestAnimation），返回三档数据。"""
    subprocess.run([NPX, 'tsx', 'tools/preview_chest_curves.ts'], cwd=ROOT, check=True)
    with open(CURVES, encoding='utf-8') as fp:
        return json.load(fp)


DATA = sample()

W, H = 1680, 1400
BG = (247, 248, 250)
INK = (30, 34, 40)
MUTED = (128, 136, 148)
TRACK = (229, 232, 237)
PANEL = (255, 255, 255)

LEFT = 168
RIGHT = W - 36
TOP = 152

ROW_H = 21
ROW_GAP = 4
PANEL_HEAD = 40
PANEL_GAP = 18

def font(size, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    return ImageFont.truetype(path, size)

F_TITLE = font(30, True)
F_SUB = font(15)
F_PANEL = font(19, True)
F_ROW = font(13)
F_TINY = font(12)

ROWS = [
    ('宝箱弹出', 'pop',     (232, 120, 62)),
    ('蓄力',     'charge',  (240, 172, 60)),
    ('开盖换帧', 'frame',   (198, 122, 226)),
    ('放射光条', 'ray',     (246, 186, 80)),
    ('全屏光柱', 'beam',    (104, 176, 244)),
    ('彩虹光束', 'rainbow', (116, 206, 186)),
    ('金币喷泉', 'fountain',(226, 140, 96)),
    ('彩色星光', 'star',    (148, 158, 240)),
    ('奖励飞行', 'fly',     (108, 196, 130)),
    ('镜头推拉', 'camera',  (96, 132, 220)),
    ('暗角压暗', 'vignette',(96, 102, 118)),
]

def lerp(a, b, p):
    return a + (b - a) * p

def blend(bg, fg, alpha):
    return tuple(int(round(lerp(bg[i], fg[i], max(0.0, min(1.0, alpha))))) for i in range(3))

NOTES = {
    # 2026-10-23：三档推镜倍率统一 2.3，白光爆点整层移除
    'weak': '原位播完：2.3× 推镜、无全屏光柱、无粒子雨、无暗角',
    'medium': '光柱贯穿屏幕 + 2.3× 推镜 + 金币喷泉 / 彩色星光；无暗角',
    'strong': '2.3× 推镜 + 暗角 + 彩虹旋转光束 + 高密度奖励（不短于 3.5s）',
}
img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

d.text((36, 26), '章节宝箱：三档开箱动画时间轴（按 TerritoryChestAnimation 逐帧采样）', font=F_TITLE, fill=INK)
d.text((38, 72),
       '分档只由「这一批奖励所有资源数量相加」决定： < 100 弱 ｜ 100 ~ 1000 中（含 1000） ｜ > 1000 强',
       font=F_SUB, fill=MUTED)
d.text((38, 93),
       '条形深浅 = 该瞬间的强度（缩放 / 不透明度 / 角度），越深越强；灰底标「无（本档不做）」= 规格里的禁止项，不是还没做。',
       font=F_SUB, fill=MUTED)
d.text((38, 111),
       '2026-10-22 起「开盖」是**换帧**（chest_seq_0 闭合 → chest_seq_5 全开）：条形越深 = 帧号越靠后，窗口外恒停最后一张。',
       font=F_SUB, fill=(196, 116, 48))

y = TOP
for panel in DATA:
    spec, samples = panel['spec'], panel['samples']
    total = spec['totalSeconds']
    panel_h = PANEL_HEAD + len(ROWS) * (ROW_H + ROW_GAP) + 16
    d.rounded_rectangle([28, y, W - 24, y + panel_h], radius=14, fill=PANEL)

    head = f"{panel['label']}　{total:.1f}s"
    d.text((44, y + 9), head, font=F_PANEL, fill=INK)
    x_head = 44 + d.textlength(head, font=F_PANEL) + 16
    d.text((x_head, y + 15), NOTES[panel['tier']], font=F_TINY, fill=MUTED)

    def tx(t):
        return LEFT + (RIGHT - LEFT) * (t / 4.0)

    for tick in range(0, 5):
        gx = tx(tick)
        d.line([gx, y + PANEL_HEAD - 6, gx, y + panel_h - 22], fill=(238, 240, 244), width=1)
        d.text((gx - 7, y + panel_h - 20), f'{tick}s', font=F_TINY, fill=MUTED)

    end_x = tx(total)
    d.line([end_x, y + PANEL_HEAD - 6, end_x, y + panel_h - 22], fill=(226, 92, 92), width=2)
    label_x = end_x - 34 if end_x > RIGHT - 46 else end_x + 4
    d.text((label_x, y + PANEL_HEAD - 22), '收尾', font=F_TINY, fill=(226, 92, 92))

    for idx, (name, key, color) in enumerate(ROWS):
        ry = y + PANEL_HEAD + idx * (ROW_H + ROW_GAP)
        d.text((44, ry + 3), name, font=F_ROW, fill=INK)
        d.rounded_rectangle([LEFT, ry + 5, tx(4.0), ry + ROW_H - 1], radius=4, fill=TRACK)

        win = None
        if key in ('pop', 'charge'):
            win = (spec[key + 'Start'], spec[key + 'Start'] + spec[key + 'Seconds'])
        elif key == 'frame':
            # 换帧只发生在 lid 窗口内；窗口外恒停最后一张（全开）。
            win = (spec['lidStart'], spec['lidStart'] + spec['lidSeconds'])
        elif key in ('ray', 'beam', 'rainbow'):
            secs_key = {'ray': 'raySeconds',
                        'beam': 'beamDownSeconds', 'rainbow': 'rainbowEnd'}[key]
            start = spec[key + 'Start']
            length = spec[secs_key] if key != 'beam' else (
                spec['beamDownSeconds'] + spec['beamHoldSeconds'] + spec['beamFadeSeconds'])
            if key == 'rainbow':
                win = (start, spec['rainbowEnd'])
            elif key == 'ray':
                win = (start, start + length)
        elif key in ('fountain', 'star', 'fly'):
            if spec[key + 'Count'] > 0 and spec[key + 'Seconds'] > 0:
                end = spec[key + 'Start'] + spec[key + 'Seconds']
                if key == 'fly':
                    end += (spec['flyCount'] - 1) * 0.06
                win = (spec[key + 'Start'], end)

        for s in samples:
            a = 0.0
            if key == 'pop':
                if win and win[0] <= s['t'] <= win[1]:
                    a = s['scale'] / 1.15
            elif key == 'charge':
                if win and win[0] <= s['t'] <= win[1]:
                    a = max(abs(s['scaleY'] - 1) * 24, abs(s['offsetY']) / 8.0)
            elif key == 'frame':
                # 帧号越靠后越深：一眼能看出「这一段在换帧、换到第几张」。
                if win and win[0] <= s['t'] <= win[1]:
                    a = s['frame'] / max(1, spec['openFrames'] - 1)
            elif key == 'ray':
                a = s['ray'] or 0.0
            elif key == 'beam':
                a = s['beam'] or 0.0
            elif key == 'rainbow':
                a = s['rainbow'] or 0.0
            elif key == 'camera':
                a = (s['camera'] - 1) / 1.3
            elif key == 'vignette':
                a = s['vignette'] / 0.55
            elif key in ('fountain', 'star', 'fly'):
                a = 0.9 if (win and win[0] <= s['t'] <= win[1]) else 0.0
            a = max(0.0, min(1.0, a))
            if a <= 0.004:
                continue
            px = tx(s['t'])
            top = ry + 5 + (ROW_H - 6) * (1 - a)
            d.line([px, top, px, ry + ROW_H - 1], fill=blend(TRACK, color, 0.2 + 0.8 * a), width=2)

        absent = (key == 'beam' and not spec['beamDownSeconds'])
        absent = absent or (key == 'rainbow' and spec['rainbowEnd'] <= spec['rainbowStart'])
        absent = absent or (key in ('fountain', 'star') and spec[key + 'Count'] == 0)
        absent = absent or (key == 'camera' and spec['cameraZoom'] == 1)
        absent = absent or (key == 'vignette' and spec['vignetteAlpha'] == 0)
        absent = absent or (key == 'frame' and spec['openFrames'] < 2)
        if absent:
            d.rounded_rectangle([LEFT, ry + 5, tx(4.0), ry + ROW_H - 1], radius=4, fill=(242, 243, 246))
            d.text((LEFT + 10, ry + 3), '无（本档不做）', font=F_TINY, fill=(172, 178, 188))

    y += panel_h + PANEL_GAP

d.text((36, H - 34),
       '生成方式：npx tsx 采样 model/TerritoryChestAnimation → PIL 绘制；改参数表后重跑即可复核（单测见 tests/territory-chest-animation.test.ts）。',
       font=F_TINY, fill=MUTED)

img.save(OUT)
if os.path.exists(CURVES):
    os.remove(CURVES)
print('saved', OUT, img.size)
