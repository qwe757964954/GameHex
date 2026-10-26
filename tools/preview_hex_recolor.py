# -*- coding: utf-8 -*-
"""画「关卡通过后地皮换色」的离线验收图（不参与运行时）。

用法（在仓库根目录）：
    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/preview_hex_recolor.py

流程：先 `npx tsx tools/preview_hex_recolor_curves.ts` 按模型逐帧采样 → 再用 PIL 画 → 删掉中间 JSON。
产物：docs/章节地图地皮换色预览.png

图里有三块：
  A. 单格四条曲线：旧地皮 1→0.55 / 1→0（前 55% 走完）、新地皮 0.6→1 / 0→1（前 70% 铺满），
     并把「交叉 90ms」那一段标出来（不留一帧空格）；
  B. 单格六帧快照：棕旧地皮缩小化掉、绿新地皮从它身下长出来；
  C. 一簇 9 格的错峰档期：证明「先簇心后外圈、总上限 0.3s」。
"""
import json
import math
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURVES = os.path.join(ROOT, 'docs', '.tmp-hex-recolor-curves.json')
OUT = os.path.join(ROOT, 'docs', '章节地图地皮换色预览.png')

# ⚠️ Windows 上 `npx` 是 `npx.cmd`，直接传 'npx' 会 `WinError 2`（不是 PATH 问题，是扩展名）。
NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'

W, H = 1000, 1024
BG = (247, 245, 241)
CARD = (255, 255, 255)
INK = (32, 30, 27)
MUTED = (122, 114, 104)
LINE = (223, 216, 206)
GRID = (240, 236, 229)
TILE_OLD = (166, 112, 74)
TILE_OLD_EDGE = (118, 76, 48)
TILE_NEW = (139, 186, 122)
TILE_NEW_EDGE = (86, 134, 74)
C_OUT_SCALE = (198, 146, 48)
C_OUT_OPACITY = (168, 96, 66)
C_IN_SCALE = (36, 122, 128)
C_IN_OPACITY = (86, 156, 96)


def font(size, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    return ImageFont.truetype(path, size)


F_TITLE = font(25, True)
F_SUB = font(13)
F_PANEL = font(17, True)
F_TINY = font(12)
F_NUM = font(13, True)


def sample() -> dict:
    subprocess.run([NPX, 'tsx', 'tools/preview_hex_recolor_curves.ts'], cwd=ROOT, check=True)
    with open(CURVES, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def frame_at(data: dict, t: float) -> dict:
    """按采样表线性插值出某时刻的四条曲线值。"""
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
    keys = ('outScale', 'outOpacity', 'inScale', 'inOpacity')
    return {key: a[key] + (b[key] - a[key]) * ratio for key in keys}


def hex_points(cx: float, cy: float, radius: float) -> list:
    """尖顶六边形（与格子的绘制形状一致，仅示意）。"""
    points = []
    for index in range(6):
        angle = math.radians(60 * index + 30)
        points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def draw_tile(base: Image.Image, cx: float, cy: float, radius: float,
              scale: float, alpha: float, fill, edge) -> None:
    """画一块带透明度的地皮（`alpha` 由模型的 opacity 直接给）。"""
    value = int(round(max(0.0, min(1.0, alpha)) * 255))
    if value <= 0 or scale <= 0.01:
        return
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).polygon(
        hex_points(cx, cy, radius * scale),
        fill=fill + (value,),
        outline=edge + (value,),
    )
    base.alpha_composite(layer)


def main() -> None:
    data = sample()
    constants = data['constants']
    seconds = constants['seconds']
    out_end = seconds * constants['outEnd']
    in_start = seconds * constants['inStart']

    image = Image.new('RGBA', (W, H), BG + (255,))
    draw = ImageDraw.Draw(image)

    # ── 标题 ────────────────────────────────────────────────
    draw.text((36, 20), '关卡通过后地皮换色：旧的缩小淡出 + 新的放大淡入（按模型逐帧采样）',
              font=F_TITLE, fill=INK)
    draw.text((36, 58),
              f'单格 {seconds:.2f}s ｜ 旧：1 → {constants["outScale"]:.2f} / 1 → 0，整段前 '
              f'{constants["outEnd"] * 100:.0f}% 走完 ｜ 新：{constants["inFromScale"]:.2f} → 1 / 0 → 1，'
              f'前 {constants["inOpacityPortion"] * 100:.0f}% 铺满',
              font=F_SUB, fill=MUTED)
    draw.text((36, 78),
              f'新旧交叉 {int(round((out_end - in_start) * 1000))}ms（不留一帧空格）｜ '
              f'相邻档差 {constants["stagger"]:.2f}s ｜ 总上限 {constants["staggerMax"]:.2f}s ｜ '
              f'一批 {constants["batchCount"]} 格整批 {constants["batchSeconds"]:.2f}s',
              font=F_SUB, fill=MUTED)
    draw.text((36, 98),
              '格根缩放恒 1（建筑挂在 Station*Layer，原地不动）；地皮与格面框都在格节点下，'
              '换色只写 RecolorOld / RecolorNew 两个临时层。',
              font=F_SUB, fill=MUTED)

    # ── A. 单格四条曲线 ────────────────────────────────────
    box_a = (30, 128, 970, 452)
    draw.rounded_rectangle(box_a, radius=14, fill=CARD, outline=LINE)
    draw.text((52, 142), 'A · 单格曲线（实线 = 不透明度，虚线 = 缩放）', font=F_PANEL, fill=INK)

    left, right, top, bottom = 92, 690, 184, 414
    span = data['span']

    def px(t: float) -> float:
        return left + (right - left) * (t / span)

    def py(v: float) -> float:
        return bottom - (bottom - top) * v

    # 交叉区先铺底色（标出"两层同时可见"的那一段）
    draw.rectangle((px(in_start), top, px(out_end), bottom), fill=(236, 244, 233))
    draw.text(((px(in_start) + px(out_end)) / 2, bottom - 12),
              f'交叉 {int(round((out_end - in_start) * 1000))}ms',
              font=F_TINY, fill=(96, 128, 88), anchor='mb')

    for step in range(5):
        v = step / 4
        draw.line((left, py(v), right, py(v)), fill=GRID)
        draw.text((left - 12, py(v)), f'{v:.2f}', font=F_TINY, fill=MUTED, anchor='rm')
    for step in range(7):
        t = span * step / 6
        draw.line((px(t), top, px(t), bottom), fill=GRID)
        draw.text((px(t), bottom + 8), f'{t:.1f}s', font=F_TINY, fill=MUTED, anchor='mt')

    def series(key: str) -> list:
        return [(px(point['t']), py(point[key])) for point in data['curve']]

    def dashed(points: list, colour, width=2, dash=6, gap=4) -> None:
        for index in range(len(points) - 1):
            x1, y1 = points[index]
            x2, y2 = points[index + 1]
            length = math.hypot(x2 - x1, y2 - y1)
            if length <= 0:
                continue
            offset = 0.0
            while offset < length:
                end = min(length, offset + dash)
                xa = x1 + (x2 - x1) * (offset / length)
                ya = y1 + (y2 - y1) * (offset / length)
                xb = x1 + (x2 - x1) * (end / length)
                yb = y1 + (y2 - y1) * (end / length)
                draw.line((xa, ya, xb, yb), fill=colour, width=width)
                offset += dash + gap

    dashed(series('outScale'), C_OUT_SCALE)
    dashed(series('inScale'), C_IN_SCALE)
    draw.line(series('outOpacity'), fill=C_OUT_OPACITY, width=3, joint='curve')
    draw.line(series('inOpacity'), fill=C_IN_OPACITY, width=3, joint='curve')

    # 关键刻度：旧的归零 / 新的起手 / 整段收口（三段文案各自错开 y，并垫一层底免得压在曲线上）
    for t, colour, caption, top_offset in (
        (in_start, C_IN_SCALE, f'{in_start:.2f}s 新地皮起手', 8),
        (out_end, C_OUT_OPACITY, f'{out_end:.2f}s 旧地皮归零', 30),
        (seconds, INK, f'{seconds:.2f}s 收口（=1 / 不透明）', 8),
    ):
        draw.line((px(t), top, px(t), bottom), fill=colour, width=1)
        x, y = px(t) + 6, top + top_offset
        bbox = draw.textbbox((x, y - 2), caption, font=F_TINY, anchor='lt')
        draw.rectangle((bbox[0] - 4, bbox[1] - 1, bbox[2] + 4, bbox[3] + 1), fill=CARD)
        draw.text((x, y), caption, font=F_TINY, fill=colour, anchor='lt')

    legend_x = 712
    for index, (colour, dashed_flag, text) in enumerate((
        (C_OUT_OPACITY, False, '旧地皮不透明度 1 → 0'),
        (C_OUT_SCALE, True, '旧地皮缩放 1 → 0.55'),
        (C_IN_SCALE, True, '新地皮缩放 0.6 → 1'),
        (C_IN_OPACITY, False, '新地皮不透明度 0 → 1'),
    )):
        y = 196 + index * 40
        if dashed_flag:
            for offset in (0, 10):
                draw.line((legend_x + offset, y + 8, legend_x + offset + 6, y + 8), fill=colour, width=3)
        else:
            draw.line((legend_x, y + 8, legend_x + 26, y + 8), fill=colour, width=3)
        draw.text((legend_x + 36, y), text, font=F_TINY, fill=MUTED, anchor='lm')

    draw.text((legend_x, 366), '旧地皮先"缩"后"化"（缩放 easeOut、', font=F_TINY, fill=MUTED)
    draw.text((legend_x, 383), '透明度 easeIn），所以是「缩小→变透→', font=F_TINY, fill=MUTED)
    draw.text((legend_x, 400), '消失」三步，不是整体等比淡掉。', font=F_TINY, fill=MUTED)

    # ── B. 单格六帧快照 ────────────────────────────────────
    box_b = (30, 470, 970, 752)
    draw.rounded_rectangle(box_b, radius=14, fill=CARD, outline=LINE)
    draw.text((52, 484), 'B · 单格六帧（棕旧地皮在上、绿新地皮在下 —— 缩小时新的从身下露出来）',
              font=F_PANEL, fill=INK)

    frames = 6
    tile_radius = 44
    tile_cy = 574
    slot_w = (box_b[2] - box_b[0] - 60) / frames
    for index in range(frames):
        t = seconds * index / (frames - 1)
        cx = box_b[0] + 30 + slot_w * (index + 0.5)
        cy = tile_cy
        frame = frame_at(data, t)
        # 原尺寸参考线（虚线六边形）：看"缩了多少"
        layer = Image.new('RGBA', image.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).polygon(hex_points(cx, cy, tile_radius), outline=LINE + (255,))
        image.alpha_composite(layer)
        # 渲染序：New 在下、Old 在上（与 `createHex` 的子节点顺序一致）
        draw_tile(image, cx, cy, tile_radius, frame['inScale'], frame['inOpacity'], TILE_NEW, TILE_NEW_EDGE)
        draw_tile(image, cx, cy, tile_radius, frame['outScale'], frame['outOpacity'], TILE_OLD, TILE_OLD_EDGE)
        draw.text((cx, cy + tile_radius + 14), f'{t:.2f}s', font=F_NUM, fill=INK, anchor='ma')
        # 多行文本不支持 anchor，自己拆成两行居中
        draw.text((cx, cy + tile_radius + 38),
                  f'旧 {frame["outScale"]:.2f} / {frame["outOpacity"]:.2f}',
                  font=F_TINY, fill=MUTED, anchor='ma')
        draw.text((cx, cy + tile_radius + 54),
                  f'新 {frame["inScale"]:.2f} / {frame["inOpacity"]:.2f}',
                  font=F_TINY, fill=MUTED, anchor='ma')

    draw.text((52, 724),
              '第 3 帧能看到两层同时在场（旧的在化、新的在长）—— 这就是那 90ms 交叉；'
              '若把 IN_START 调到 OUT_END 之后，中间会空一帧，一闪就是漏光。',
              font=F_TINY, fill=MUTED)

    # ── C. 一簇 9 格��错峰档期 ─────────────────────────────
    box_c = (30, 770, 970, 1000)
    draw.rounded_rectangle(box_c, radius=14, fill=CARD, outline=LINE)
    draw.text((52, 784), 'C · 一簇 9 格的错峰档期（按到簇心的距离升序；格子多了顶到 0.3s 上限）',
              font=F_PANEL, fill=INK)

    cluster = sorted(data['cluster'], key=lambda cell: (cell['delay'], cell['cellId']))
    bar_left, bar_right = 176, 790
    scale_t = (bar_right - bar_left) / constants['batchSeconds']
    for index, cell in enumerate(cluster):
        y = 826 + index * 16
        delay = cell['delay']
        x1 = bar_left + delay * scale_t
        x2 = bar_left + (delay + seconds) * scale_t
        draw.line((bar_left, y + 5, x1, y + 5), fill=GRID, width=1)
        draw.rounded_rectangle((x1, y, x2, y + 10), radius=4, fill=C_OUT_OPACITY if delay else C_OUT_SCALE)
        draw.text((bar_left - 10, y + 5), f'#{cell["cellId"]}', font=F_TINY, fill=MUTED, anchor='rm')
        draw.text((x2 + 8, y + 5), f'+{delay:.2f}s', font=F_TINY, fill=MUTED, anchor='lm')
    draw.text((bar_left, 982),
              f'金色那条是簇心（延迟 0）；相邻档差 {constants["stagger"]:.2f}s，'
              f'9 格排到 {max(c["delay"] for c in cluster):.2f}s —— 还是"轻微落差"。',
              font=F_TINY, fill=MUTED)

    image.convert('RGB').save(OUT, 'PNG')
    os.remove(CURVES)
    print(f'已写出 {OUT}')


if __name__ == '__main__':
    main()
