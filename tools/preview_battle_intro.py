# -*- coding: utf-8 -*-
"""画「进入关卡战斗 / 匹配界面」整页过场的时序预览（离线验收用，不参与运行时）。

用法（仓库根目录）：

    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/preview_battle_intro.py

流程：先 `npx tsx tools/preview_battle_intro_curves.ts` 按模型逐帧采样（真源 =
`model/TerritoryBattleIntro`）→ 再用 PIL 把**当帧的六个数**画成屏幕示意 → 删掉中间 JSON。

合成的规则与运行时一一对应（`TerritoryMapView.applyBattleIntro` /
`TerritoryBattleIntroHud.applyIntroHud` / `TerritoryBattleCover.apply`）：

    HUD   位移 = 方向 × pushPx × uiPush      透明度 = uiOpacity
    地块  绕地图中心缩到 cellScale            透明度 = cellOpacity
    云    每朵 = 云团 × coverSpread           逐朵 alpha（按各自 delay 淡）× 整层 coverOpacity

云用的是**真美术**（`assets/resources/image/territory/cloud/cloud_body_0`，第五版起只取云体）：
放大到 `cover.width × cover.height`、按 `scale` 再乘一次、`flip` 时左右镜像、
帧号 = `每朵相位 % 帧数`（当前只有 1 帧）。所以预览图和实机看到的是同一批云 ——
"贴纸感"、"发灰"这类问题能在这张图上看出来，不用等打真机。

⚠️ 每一帧都是一张**独立画布**再贴上去：云在 `spread` 很大时位置远超面板，
   直接画在整张画布上会溢到隔壁帧，读起来像"云已经盖满了还在第一帧"。

产物：docs/进战斗过场-时序.png
"""
import json
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD_ART = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'cloud')
CLOUD_FRAME_COUNT = 5
CURVES = os.path.join(ROOT, 'docs', '.tmp-battle-intro.json')
OUT = os.path.join(ROOT, 'docs', '进战斗过场-时序.png')

NPX = shutil.which('npx.cmd') or shutil.which('npx') or 'npx.cmd'

SCREEN_W = 750
SCREEN_H = 1334
PUSH_PX = max(SCREEN_W, SCREEN_H) * 0.9
SCALE = 0.30

SAND = (201, 179, 143)
TILE = (150, 108, 62)
TILE_EDGE = (206, 128, 70)
HUD_BLUE = (58, 92, 140)
HUD_GOLD = (206, 168, 84)
INK = (36, 30, 22)

# 与 ArenaRoot 的 HUD 布局大致对位（屏幕坐标，原点在画面中心，y 向上）。
HUD_BLOCKS = [
    ('PlayerCard', -190, 545, 340, 96, 'left', HUD_GOLD),
    ('ResBarLayer', 130, 598, 300, 52, 'right', HUD_BLUE),
    ('EntryBar', 150, 540, 300, 66, 'right', HUD_BLUE),
    ('LeftList', -318, 250, 96, 260, 'left', HUD_BLUE),
    ('RightList', 318, 250, 96, 260, 'right', HUD_BLUE),
    ('OSRankEntry', 330, 400, 62, 62, 'right', HUD_GOLD),
    ('BeginGame', 0, -430, 300, 84, 'down', HUD_GOLD),
    ('BottomHud', 0, -520, 620, 66, 'down', HUD_BLUE),
    ('ChestBar', 300, -470, 130, 120, 'right', HUD_GOLD),
    ('BottomNav', 0, -640, 750, 92, 'down', HUD_BLUE),
]

DIRS = {'left': (-1, 0), 'right': (1, 0), 'up': (0, 1), 'down': (0, -1)}


def sample() -> dict:
    with open(CURVES, 'w', encoding='utf-8') as fp:
        subprocess.run([NPX, 'tsx', 'tools/preview_battle_intro_curves.ts'], cwd=ROOT, check=True,
                       stdout=fp)
    with open(CURVES, encoding='utf-8') as fp:
        return json.load(fp)


def font(size, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def local(x, y):
    """屏幕坐标（原点居中、y 向上）→ 面板局部像素。"""
    return (x + SCREEN_W / 2) * SCALE, (SCREEN_H / 2 - y) * SCALE


def load_cloud_frames():
    """待机帧（与运行时同一批图）。

    2026-11-02 晚上第五版起盖层只取**云体**（`cloud_body_N`）—— `cloud_idle_*` 是
    「云体 + 影子」的合并图，密铺时每朵的黑影会盖到邻居的白云体上 ⇒ 整屏发灰。
    先按云体找，缺图才退回老的 `cloud_idle_*`（老资源库还没拆过时也能出图）。
    """
    for prefix in ('cloud_body_', 'cloud_idle_'):
        frames = []
        for index in range(CLOUD_FRAME_COUNT):
            path = os.path.join(CLOUD_ART, '%s%d.png' % (prefix, index))
            if not os.path.exists(path):
                break
            frames.append(Image.open(path).convert('RGBA'))
        if frames:
            return frames
    return []


def paste_clipped(panel, patch, left, top):
    """把 patch 贴到 panel 的 (left, top)，超出面板的部分裁掉（PIL 不接受负坐标）。"""
    width, height = patch.size
    src_left = max(0, -left)
    src_top = max(0, -top)
    dst_left = max(0, left)
    dst_top = max(0, top)
    src_right = min(width, panel.size[0] - left)
    src_bottom = min(height, panel.size[1] - top)
    if src_right <= src_left or src_bottom <= src_top:
        return
    panel.alpha_composite(patch.crop((src_left, src_top, src_right, src_bottom)), (dst_left, dst_top))


def scale_alpha(patch, alpha):
    """按 alpha 压一层不透明度（复用同一张渐变，不改它的形状）。"""
    if alpha >= 0.995:
        return patch
    table = [int(round(value * alpha)) for value in range(256)]
    patch.putalpha(patch.getchannel('A').point(table))
    return patch


def draw_panel(frame, frame_index, grid):
    panel = Image.new('RGBA', (int(SCREEN_W * SCALE), int(SCREEN_H * SCALE) + 52), (250, 248, 244, 255))
    draw = ImageDraw.Draw(panel)
    fx = frame['fx']
    screen_h = SCREEN_H * SCALE

    # ① 页面底色（云散尽后看到的就是它）
    draw.rectangle([0, 0, SCREEN_W * SCALE, screen_h], fill=SAND)

    # ② 地块：绕地图中心缩到 cellScale，整体按 cellOpacity 淡
    cell_alpha = int(round(max(0.0, min(1.0, fx['cellOpacity'])) * 255))
    if cell_alpha > 0:
        layer = Image.new('RGBA', panel.size, (0, 0, 0, 0))
        overlays = ImageDraw.Draw(layer)
        scale = fx['cellScale']
        for row in range(9):
            for col in range(8):
                cx = (col - 3.5) * grid['columnSpacing']
                cy = (row - 4) * grid['rowSpacing'] - 40
                points = [local(cx * scale + px * scale, (cy - 40) * scale + 40 + py * scale)
                          for px, py in ((p['x'], p['y']) for p in grid['face'])]
                overlays.polygon(points, fill=TILE + (cell_alpha,), outline=TILE_EDGE + (cell_alpha,))
        panel.alpha_composite(layer)

    # ③ 云盖层：每朵 = 云团 × spread，逐朵 alpha（含该帧的散场进度）× 整层不透明度
    cover_alpha = max(0.0, min(1.0, fx['coverOpacity']))
    art = grid['cover']['frames']
    if cover_alpha > 0 and art:
        for cloud in grid['cover']['clouds']:
            alpha = cover_alpha * cloud['alpha'][frame_index]
            if alpha <= 0.01:
                continue
            width = max(2, int(round(grid['cover']['width'] * cloud['scale'] * SCALE)))
            height = max(2, int(round(grid['cover']['height'] * cloud['scale'] * SCALE)))
            source = art[cloud['frame'] % len(art)]
            patch = source.resize((width, height), Image.BILINEAR)
            if cloud['flip']:
                patch = patch.transpose(Image.FLIP_LEFT_RIGHT)
            patch = scale_alpha(patch, alpha)
            cx, cy = local(cloud['x'] * fx['coverSpread'], cloud['y'] * fx['coverSpread'])
            paste_clipped(panel, patch, int(round(cx - width / 2)), int(round(cy - height / 2)))

    # ④ HUD：沿各自方向推出，按 uiOpacity 淡
    hud_alpha = int(round(max(0.0, min(1.0, fx['uiOpacity'])) * 255))
    if hud_alpha > 0:
        layer = Image.new('RGBA', panel.size, (0, 0, 0, 0))
        overlays = ImageDraw.Draw(layer)
        push = PUSH_PX * fx['uiPush']
        for _, x, y, w, h, direction, color in HUD_BLOCKS:
            dx, dy = DIRS[direction]
            left, top = local(x + dx * push - w / 2, y + dy * push + h / 2)
            right, bottom = local(x + dx * push + w / 2, y + dy * push - h / 2)
            overlays.rectangle([left, top, right, bottom], fill=color + (hud_alpha,),
                               outline=INK + (min(255, hud_alpha + 40),))
        panel.alpha_composite(layer)

    draw.rectangle([0, 0, SCREEN_W * SCALE, screen_h], outline=INK, width=2)

    # ⑤ 先把标注条刷掉再写字：HUD 推到屏幕外时还会画进这 52px（面板没裁），不刷就是"文字压在色块上"
    draw.rectangle([0, screen_h, SCREEN_W * SCALE, panel.size[1]], fill=(250, 248, 244, 255))

    # ⑥ 标注（两行，避免压到隔壁帧）
    draw.text((2, screen_h + 5), f"{frame['label']}  ·  {frame['phase']}",
              font=font(13, True), fill=INK)
    detail = (f"UI {fx['uiPush'] * 100:0.0f}%/{fx['uiOpacity'] * 100:0.0f}%  "
              f"地块 {fx['cellScale']:0.2f}/{fx['cellOpacity'] * 100:0.0f}%  "
              f"云 {fx['coverSpread']:0.2f}/散{fx['coverRelease'] * 100:0.0f}%")
    draw.text((2, screen_h + 23), detail, font=font(10), fill=(90, 80, 66))
    return panel


def main():
    data = sample()
    data['cover']['frames'] = load_cloud_frames()
    data['grid']['cover'] = data['cover']
    panels = [draw_panel(frame, index, data['grid']) for index, frame in enumerate(data['frames'])]
    columns = 3
    rows = 2
    gap_x, gap_y = 18, 14
    panel_w, panel_h = panels[0].size
    width = columns * panel_w + (columns + 1) * gap_x
    height = 34 + rows * (panel_h + gap_y) + gap_y
    image = Image.new('RGBA', (width, height), (250, 248, 244, 255))
    for index, panel in enumerate(panels):
        col = index % columns
        row = index // columns
        image.alpha_composite(panel, (gap_x + col * (panel_w + gap_x),
                                      34 + row * (panel_h + gap_y)))
    header = (f"整页过场  out {data['outSeconds']}s（UI 推出 + 地块缩小变淡 + 云合拢）"
              f" → hold（云静止等回包/等资源，只有待机循环在动）"
              f" → in {data['inSeconds']}s（云散开 + 逐朵淡）")
    ImageDraw.Draw(image).text((gap_x, 10), header, font=font(13, True), fill=INK)
    image.convert('RGB').save(OUT)
    os.remove(CURVES)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
