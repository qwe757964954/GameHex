# -*- coding: utf-8 -*-
"""画「新地块生成动画」的离线验收图（不参与运行时）。

用法（在仓库根目录）：
    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/preview_hex_spawn.py

流程：先 `npx tsx tools/preview_hex_spawn_curves.ts` 按模型逐帧采样 → 再用 PIL 画 → 删掉中间 JSON。
产物：docs/章节地图新地块生成预览.png

图里有三块：
  A. 单格曲线：缩放 0.55→1、透明度 0→1（进度 70% 就铺满），0.4s 收口；
  B. 六帧快照：3×3 一簇格子按真实错峰档期逐帧画出来（能直接看出"从中间长开"）；
  C. 错峰顺序：同一簇格子上标出场序号，验证「先中心后外圈」。
"""
import json
import os
import math
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURVES = os.path.join(ROOT, 'docs', '.tmp-hex-spawn-curves.json')
OUT = os.path.join(ROOT, 'docs', '章节地图新地块生成预览.png')

# ⚠️ Windows 上 `npx` 是 `npx.cmd`，直接传 'npx' 会 `WinError 2`（不是 PATH 问题，是扩展名）。
NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'

W, H = 1000, 960
BG = (247, 245, 241)
CARD = (255, 255, 255)
INK = (32, 30, 27)
MUTED = (122, 114, 104)
LINE = (223, 216, 206)
GOLD = (198, 146, 48)
TEAL = (36, 122, 128)
TILE_FILL = (201, 164, 106)
TILE_EDGE = (140, 106, 58)


def font(size, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    return ImageFont.truetype(path, size)


F_TITLE = font(26, True)
F_SUB = font(14)
F_PANEL = font(18, True)
F_ROW = font(13)
F_TINY = font(12)
F_NUM = font(15, True)


def sample() -> dict:
    subprocess.run([NPX, 'tsx', 'tools/preview_hex_spawn_curves.ts'], cwd=ROOT, check=True)
    with open(CURVES, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def frame_at(data: dict, t: float) -> dict:
    """按采样表线性插值出某时刻的 {scale, opacity}。"""
    curve = data['curve']
    if t <= curve[0]['t']:
        return curve[0]
    if t >= curve[-1]['t']:
        return curve[-1]
    step = data['step']
    index = int(t / step)
    a = curve[min(index, len(curve) - 1)]
    b = curve[min(index + 1, len(curve) - 1)]
    span = b['t'] - a['t']
    ratio = 0 if span <= 0 else (t - a['t']) / span
    return {
        'scale': a['scale'] + (b['scale'] - a['scale']) * ratio,
        'opacity': a['opacity'] + (b['opacity'] - a['opacity']) * ratio,
    }


def hex_points(cx: float, cy: float, radius: float) -> list:
    """尖顶六边形（与格子的绘制形状一致，仅示意）。"""
    points = []
    for index in range(6):
        angle = math.radians(60 * index + 30)
        points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def draw_cluster(base: Image.Image, data: dict, cx: float, cy: float, factor: float,
                 t: float) -> None:
    """把一簇格子按 `t` 时刻的姿态画到 (cx, cy) 为中心的方框里（y 向上 → 画时翻）。"""
    radius = data['radius']
    for cell in data['cluster']:
        local = t - cell['delay']
        x = cx + cell['x'] * factor
        y = cy - cell['y'] * factor
        if local < 0:
            # 还没轮到它：只留一个虚线位示意「这格马上要出来」。
            layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
            ImageDraw.Draw(layer).polygon(
                hex_points(x, y, radius * factor), outline=LINE + (255,),
            )
            base.alpha_composite(layer)
            continue
        frame = frame_at(data, local)
        alpha = int(round(frame['opacity'] * 255))
        if alpha <= 0:
            continue
        layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        draw.polygon(
            hex_points(x, y, radius * factor * frame['scale']),
            fill=TILE_FILL + (alpha,),
            outline=TILE_EDGE + (alpha,),
        )
        base.alpha_composite(layer)


def main() -> None:
    data = sample()
    constants = data['constants']
    seconds = constants['seconds']

    image = Image.new('RGBA', (W, H), BG + (255,))
    draw = ImageDraw.Draw(image)

    # ── 标题 ────────────────────────────────────────────────
    draw.text((36, 22), '新地块生成：整格淡入 + 由小变大 + 错峰（按模型逐帧采样）',
              font=F_TITLE, fill=INK)
    draw.text((36, 62),
              f'单格 {seconds:.2f}s ｜ 起手缩放 {constants["fromScale"]:.2f} → 1 ｜ '
              f'透明度在进度 {constants["opacityPortion"] * 100:.0f}% 就铺满 ｜ '
              f'相邻档差 {constants["stagger"]:.3f}s ｜ 总上限 {constants["staggerMax"]:.2f}s',
              font=F_SUB, fill=MUTED)
    draw.text((36, 84),
              '一批 ' + str(constants['batchCount']) + ' 格整批最长 '
              f'{constants["batchSeconds"]:.2f}s（封顶后多出来的格子同档）｜ '
              '翻格（随机资源格）优先：同格的生成动画会被掐掉',
              font=F_SUB, fill=MUTED)

    # ── A. 单格曲线 ────────────────────────────────────────
    box_a = (30, 118, 970, 440)
    draw.rounded_rectangle(box_a, radius=14, fill=CARD, outline=LINE)
    draw.text((52, 134), 'A · 单格曲线', font=F_PANEL, fill=INK)

    left, right, top, bottom = 92, 700, 176, 404
    span = 0.8

    def px(t: float) -> float:
        return left + (right - left) * (t / span)

    def py(v: float) -> float:
        return bottom - (bottom - top) * v

    for step in range(5):
        v = step / 4
        draw.line((left, py(v), right, py(v)), fill=LINE)
        draw.text((left - 12, py(v)), f'{v:.2f}', font=F_TINY, fill=MUTED, anchor='rm')
    for step in range(9):
        t = span * step / 8
        draw.line((px(t), top, px(t), bottom), fill=(240, 236, 229))
        draw.text((px(t), bottom + 8), f'{t:.1f}s', font=F_TINY, fill=MUTED, anchor='mt')

    scale_points = [(px(point['t']), py(point['scale'])) for point in data['curve']]
    opacity_points = [(px(point['t']), py(point['opacity'])) for point in data['curve']]
    draw.line(opacity_points, fill=TEAL, width=3, joint='curve')
    draw.line(scale_points, fill=GOLD, width=3, joint='curve')

    solid_at = seconds * constants['opacityPortion']
    # 两条竖线挨得近（0.28 / 0.40），标注一左一右 + 上下错开，否则字压字。
    for t, colour, caption, dy, anchor in (
        (seconds, GOLD, f'{seconds:.2f}s 单格收口（=1）', 8, 'lt'),
        (solid_at, TEAL, f'{solid_at:.2f}s 透明度已铺满', 30, 'rt'),
    ):
        draw.line((px(t), top, px(t), bottom), fill=colour, width=1)
        draw.text((px(t) + (6 if anchor == 'lt' else -6), top + dy),
                  caption, font=F_TINY, fill=colour, anchor=anchor)

    # 图例
    legend_x = 724
    for index, (colour, text) in enumerate((
        (GOLD, '缩放 scale：0.55 → 1（easeOutCubic）'),
        (TEAL, '不透明度 opacity：0 → 1'),
    )):
        y = 186 + index * 46
        draw.line((legend_x, y + 8, legend_x + 26, y + 8), fill=colour, width=3)
        for offset, line in enumerate(text.split('：')):
            draw.text((legend_x, y + 20 + offset * 17), line if offset else '· ' + line,
                      font=F_TINY, fill=MUTED)
    draw.text((legend_x, 286), '· 阈值以下（= 起手帧）', font=F_TINY, fill=MUTED)
    draw.text((legend_x, 303), '  全透明 + 0.55 缩放', font=F_TINY, fill=MUTED)
    draw.text((legend_x, 340), '同一格重复 play 不打回进度；', font=F_TINY, fill=MUTED)
    draw.text((legend_x, 358), '收口缩放复位 1、透明度复位 255。', font=F_TINY, fill=MUTED)

    # ── B. 六帧快照 ────────────────────────────────────────
    box_b = (30, 458, 970, 690)
    draw.rounded_rectangle(box_b, radius=14, fill=CARD, outline=LINE)
    draw.text((52, 472), 'B · 一簇 9 格的六帧快照（同一批同时露出，错峰后各自从中心长开）',
              font=F_PANEL, fill=INK)

    frames = [0.00, 0.10, 0.20, 0.30, 0.45, 0.70]
    frame_w = 136
    start_x = 46
    for index, t in enumerate(frames):
        x0 = start_x + index * (frame_w + 12)
        draw.rounded_rectangle((x0, 508, x0 + frame_w, 668), radius=10,
                               fill=(252, 250, 246), outline=LINE)
        draw_cluster(image, data, x0 + frame_w / 2, 588, 0.36, t)
        draw.text((x0 + frame_w / 2, 642), f't = {t:.2f}s', font=F_ROW, fill=MUTED, anchor='mt')

    # ── C. 整批档期（甘特） ────────────────────────────────
    box_c = (30, 708, 970, 930)
    draw.rounded_rectangle(box_c, radius=14, fill=CARD, outline=LINE)
    draw.text((52, 722), 'C · 整批档期：每格从自己的延期起播 0.4s，第 7 格起撞 0.3s 上限',
              font=F_PANEL, fill=INK)

    gantt_left, gantt_right = 150, 900
    ordered = sorted(data['cluster'], key=lambda c: (c['delay'], c['cellId']))
    total = constants['batchSeconds']

    def gx(t: float) -> float:
        return gantt_left + (gantt_right - gantt_left) * (t / total)

    for index, cell in enumerate(ordered):
        y = 772 + index * 14
        capped = cell['delay'] >= constants['staggerMax'] - 1e-9
        colour = (196, 148, 58) if capped else TILE_FILL
        draw.text((52, y), f'第 {index + 1} 格', font=F_TINY, fill=MUTED, anchor='lm')
        draw.text((128, y), f'{cell["delay"]:.3f}s', font=F_TINY,
                  fill=(176, 120, 40) if capped else (168, 160, 150), anchor='rm')
        draw.line((gx(cell['delay']), y, gx(cell['delay'] + seconds), y),
                  fill=colour, width=6)
        if capped:
            draw.text((gx(cell['delay'] + seconds) + 6, y), '同档', font=F_TINY,
                      fill=(176, 120, 40), anchor='lm')

    cap_x = gx(constants['staggerMax'])
    draw.line((cap_x, 766, cap_x, 772 + 8 * 14 + 4), fill=(176, 120, 40), width=1)
    draw.text((cap_x - 4, 766), f'上限 {constants["staggerMax"]:.2f}s', font=F_TINY,
              fill=(176, 120, 40), anchor='rs')
    draw.text((gx(total), 766), f'整批收口 {total:.2f}s', font=F_TINY, fill=MUTED, anchor='rt')

    draw.text((52, 892),
              '排序键 = 到这批格包围盒中心的距离（等距按 cellId 兜底）；延期封顶后多出来的格子与上一档同档出现。',
              font=F_TINY, fill=(150, 142, 132))
    draw.text((52, 910),
              f'不封顶时 9 格要排到 {(constants["batchCount"] - 1) * constants["stagger"]:.2f}s、'
              '十几格 0.6s 以上 —— 读成卡顿而不是「落差」。',
              font=F_TINY, fill=(150, 142, 132))

    image.convert('RGB').save(OUT)
    os.remove(CURVES)
    print(f'wrote {OUT} ({W}x{H})')


if __name__ == '__main__':
    main()
