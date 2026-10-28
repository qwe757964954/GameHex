# -*- coding: utf-8 -*-
"""画「解锁地块时云消散」的四段过渡预览图（离线验收用，不参与运行时）。

用法（在仓库根目录）：

    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/preview_cloud_dissolve.py

流程：先 `npx tsx tools/preview_cloud_dissolve_curves.ts` 按模型逐帧采样（真源 =
`model/TerritoryCloud`）→ 再用 PIL 把**真美术帧**按姿态合成 → 删掉中间 JSON。

合成的规则与运行时一一对应（`TerritoryCloudView.applyDissolve`）：

    落点 y  = 格面心 + territoryCloudArtOffsetY(1)   ← 节点基准（画布里云偏上，要压回来）
    云体 y  = 落点 y - liftY                         ← 只有云体上飘
    影子 y  = 落点 y                                 ← 影子留在原地
    缩放 / 透明度 = 姿态里的 scale / opacity（体、影同值）
    帧      = index < 0 → cloud_body_0（整朵）；否则 cloud_dissolve_body_<index>

产物：docs/章节地图云消散预览.png
"""
import json
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURVES = os.path.join(ROOT, 'docs', '.tmp-cloud-dissolve.json')
OUT = os.path.join(ROOT, 'docs', '章节地图云消散预览.png')
CLOUD = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'cloud')

# ⚠️ Windows 上 `npx` 是 `npx.cmd`，直接传 'npx' 会 `WinError 2`（不是 PATH 问题，是扩展名）。
NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'

# 地皮（截图取色）与 UI 配色：预览底必须是**地块**色，否则"云变小"没有参照物。
TILE = (150, 108, 62)
TILE_EDGE = (206, 128, 70)
SAND = (201, 179, 143)


def sample() -> dict:
    """跑 TS 采样器（真源 = model/TerritoryCloud），返回 { total, frameCount, samples }。"""
    subprocess.run([NPX, 'tsx', 'tools/preview_cloud_dissolve_curves.ts'], cwd=ROOT, check=True)
    with open(CURVES, encoding='utf-8') as fp:
        return json.load(fp)


def font(size, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    return ImageFont.truetype(path, size)


F_TITLE = font(28, True)
F_SUB = font(14)
F_CAP = font(14, True)
F_TINY = font(12)

DATA = sample()
SAMPLES = DATA['samples']
TOTAL = DATA['total']

# 抽 10 帧当胶片：关键节点（起手 / 炸开峰值 / 裂开 / 调头 / 碎块 / 收尾前一帧）都在里面。
PICKS = [0.0, 0.0333, 0.0667, 0.1, 0.1667, 0.25, 0.2833, 0.35, 0.4333, 0.4833]

PANEL_W, PANEL_H = 316, 300
COLS, ROWS = 5, 2
MARGIN = 22
HEAD = 96

# 一格（格面）在预览里的尺寸：直接用地图的真实格面，云与地块的相对大小才是真的。
CELL_W, CELL_H = 123, 90
# 云节点相对格面心的 y 偏移（= territoryCloudArtOffsetY(1) = -21.5，模型常量）。
ART_OFFSET_Y = -21.5
# 画布 200×240 的中心相对「节点锚点」是 0（anchor 居中）⇒ 只要把节点 y 换成像素中心即可。
CANVAS_W, CANVAS_H = 200, 240


def load(name):
    return Image.open(os.path.join(CLOUD, f'{name}.png')).convert('RGBA')


BODY = load('cloud_body_0')
SHADOW = load('cloud_shadow_0')
DISSOLVE_BODY = [load('cloud_dissolve_body_0'), load('cloud_dissolve_body_1')]
DISSOLVE_SHADOW = [load('cloud_dissolve_shadow_0'), load('cloud_dissolve_shadow_1')]


def pick(seconds: float) -> dict:
    """取离目标时刻最近的采样（采样间隔 1/30s）。"""
    return min(SAMPLES, key=lambda item: abs(item['seconds'] - seconds))


def nearest(seconds: float) -> dict:
    """同 pick，但找不到就返回最后一帧（防止浮点抖动导致空表）。"""
    if not SAMPLES:
        raise SystemExit('采样为空：`territoryCloudDissolveFrame` 一帧都没返回')
    return pick(seconds)


def place(panel: Image.Image, art: Image.Image, cx: float, cy: float,
          scale: float, opacity: float) -> None:
    """把一张云图按「中心 (cx,cy)、缩放 scale、整体乘 opacity」贴进面板。"""
    width = max(1, int(round(CANVAS_W * scale)))
    height = max(1, int(round(CANVAS_H * scale)))
    sprite = art.resize((width, height), Image.LANCZOS)
    if opacity < 0.999:
        alpha = sprite.split()[3].point(lambda value: int(value * opacity))
        sprite.putalpha(alpha)
    panel.alpha_composite(sprite, (int(round(cx - width / 2)), int(round(cy - height / 2))))


def draw_panel(pose: dict) -> Image.Image:
    panel = Image.new('RGBA', (PANEL_W, PANEL_H), (255, 255, 255, 255))
    draw = ImageDraw.Draw(panel)
    # 沙地底 + 一个格面：没有地块就没法判断"云变小了没有"。
    draw.rectangle((8, 8, PANEL_W - 8, PANEL_H - 44), fill=SAND)
    cx, cy = PANEL_W / 2, (PANEL_H - 44) / 2 + 8

    def hexagon(inset: float):
        # 平顶蜂窝（与 HEX_GRID_FACE_WIDTH/HEIGHT 同形状），inset = 外扩像素。
        hw, hh, qw = CELL_W / 2 + inset, CELL_H / 2 + inset, CELL_W / 4 + inset
        return [(cx + hw, cy), (cx + qw, cy - hh), (cx - qw, cy - hh),
                (cx - hw, cy), (cx - qw, cy + hh), (cx + qw, cy + hh)]

    draw.polygon(hexagon(0), fill=TILE, outline=TILE_EDGE, width=3)

    index = pose['index']
    body_art = BODY if index < 0 else DISSOLVE_BODY[min(index, len(DISSOLVE_BODY) - 1)]
    shadow_art = SHADOW if index < 0 else DISSOLVE_SHADOW[min(index, len(DISSOLVE_SHADOW) - 1)]

    # 🔴 屏幕坐标是 y 向下：地图里 `-21.5` 的偏移在预览里就是 `+21.5`。
    base_y = cy - ART_OFFSET_Y          # 节点基准（不随消散变化）
    # 影子：留在原地，走自己那条曲线（碎块段收小、更早淡没）。
    place(panel, shadow_art, cx, base_y, pose['shadowScale'], pose['shadowOpacity'])
    # 云体：上飘 + 自己那条曲线（碎块段向外炸）。
    place(panel, body_art, cx, base_y - pose['liftY'], pose['scale'], pose['opacity'])

    draw.text((16, PANEL_H - 36), f"{pose['seconds']:.3f}s", font=F_CAP, fill=(30, 34, 40))
    draw.text((16, PANEL_H - 18),
              f"帧 {'整朵' if index < 0 else index}  体 ×{pose['scale']:.2f}/α{round(pose['opacity'] * 255)}"
              f"  影 ×{pose['shadowScale']:.2f}/α{round(pose['shadowOpacity'] * 255)}",
              font=F_TINY, fill=(96, 104, 116))
    return panel


def main():
    width = MARGIN * 2 + COLS * PANEL_W + (COLS - 1) * 12
    height = HEAD + ROWS * (PANEL_H + 10) + MARGIN
    sheet = Image.new('RGBA', (width, height), (247, 248, 250, 255))
    draw = ImageDraw.Draw(sheet)

    draw.text((MARGIN, 22), '解锁地块：云消散的四段过渡（真美术帧 + 模型姿态合成）', font=F_TITLE, fill=(30, 34, 40))
    draw.text((MARGIN, 58),
              f'总时长 {TOTAL}s ｜ 0~12% 整朵炸一下(×1.06) ｜ 12~56% 裂开、壳收缩(→×0.84) ｜ '
              '56~100% 碎块炸开(→×1.15) ｜ 云体上飘 12px、影子不动 ｜ 30% 之后开始变透、影子 75% 先归零',
              font=F_SUB, fill=(108, 116, 128))
    draw.text((MARGIN, 76), '数据源：territoryCloudDissolveFrame 逐帧采样（与运行时同一份模型）',
              font=F_TINY, fill=(150, 158, 170))

    for slot, seconds in enumerate(PICKS):
        pose = nearest(seconds)
        panel = draw_panel(pose)
        col, row = slot % COLS, slot // COLS
        x = MARGIN + col * (PANEL_W + 12)
        y = HEAD + row * (PANEL_H + 10)
        sheet.alpha_composite(panel, (x, y))
        draw.rectangle((x, y, x + PANEL_W - 1, y + PANEL_H - 1), outline=(222, 226, 232), width=1)

    sheet.convert('RGB').save(OUT)
    if os.path.exists(CURVES):
        os.remove(CURVES)
    print(OUT)


if __name__ == '__main__':
    main()
