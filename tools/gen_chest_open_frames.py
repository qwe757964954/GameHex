# -*- coding: utf-8 -*-
"""合成「宝箱开盖」补帧序列（离线生成美术，不参与运行时逻辑）。

用法（在仓库根目录）：
    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/gen_chest_open_frames.py

## 为什么要这个脚本

手上只有两张宝箱美术、且都是整图，没有分层也没有序列：

  · **闭合态** `image/territory/buildings/territory_fixed_resource_v1.png`（黄色箱盖压着，地图格子上显示的就是它）；
  · **开盖态** `image/territory/chest/chest_open_v1.png`（`zw_0005`，箱盖掀起、露出内衬）。

需求（2026-10-22 §2）「点击宝箱打开时切换成开盖那张，可以考虑补帧效果」——
既然两张图是**同一只箱子、同一视角**，中间帧就能直接合成：

  ① 箱体：两次都取开盖图的箱体（闭合图的箱子本体在同一位置，画法一致，取一张即可）；
  ② 箱盖：把开盖图的箱盖绕接缝做**纵向长出**（`k: 0 → 1`）—— 2D 里「盖子绕水平轴掀起」
     就表现为它在画面中的投射高度变大；升起过程中看到的是内衬，这与真实开盖一致；
  ③ 闭合盖：叠在**下面**（新盖压在上面，才不会出现「两张盖子」的幽灵），
     随进度压扁 + 淡出 —— 读作「被顶起来让位」。

为什么中间帧要离线烘焙成图，而不是运行时叠两层 Sprite 做混合：
运行时每帧改 alpha + 缩放会让「闭合盖」一直半透明地留在画面里（幽灵），
烘焙后每帧都是干净的成品图，视图只按索引换帧（和 `hex_pulse_seq` 同一套做法）。

产物：`assets/resources/image/territory/chest/chest_seq_0..5.png`（6 帧，同为 142×156）。
第 0 帧 = 闭合、第 5 帧 = 开盖（= `chest_open_v1.png` 本体）。
"""
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOSED_SRC = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'buildings',
                          'territory_fixed_resource_v1.png')
OPEN_SRC = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'chest', 'chest_open_v1.png')
OUT_DIR = os.path.join(ROOT, 'assets', 'resources', 'image', 'territory', 'chest')

# 与 TerritoryChestView / 旧 `CHEST_LID_RATIO` 同一个几何：开盖图里箱盖占到距顶 83px（142×156）。
SEAM_RATIO = 0.532

# 采样进度（6 帧）：0 = 完全闭合，1 = 完全开盖。
STEPS = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)
# 闭合盖的淡出指数：>1 让它"起手就明显变淡"，避免中间帧出现两张盖子。
CLOSED_LID_FADE_POW = 2.0
# 闭合盖在淡出时同时压扁一点（被顶起来的感觉）。
CLOSED_LID_SQUASH = 0.2


def main():
    openp = Image.open(OPEN_SRC).convert('RGBA')
    W, H = openp.size
    seam = round(H * SEAM_RATIO)
    body_h = H - seam

    closed = Image.open(CLOSED_SRC).convert('RGBA')
    closed_c = closed.crop(closed.getbbox())
    # 闭合图缩到与开盖图同宽；它的箱子本体高度 = 开盖图的箱体高（同一只箱子），
    # 所以「闭合盖」正好是上半部分。
    closed_a = closed_c.resize((W, round(closed_c.height * W / closed_c.width)), Image.LANCZOS)
    if closed_a.height <= body_h:
        raise SystemExit(f'闭合图太矮（{closed_a.height} <= 箱体 {body_h}），几何假设不成立，先复查两张图')
    closed_lid_h = closed_a.height - body_h
    closed_lid = closed_a.crop((0, 0, W, closed_lid_h))

    lid = openp.crop((0, 0, W, seam))
    body = openp.crop((0, seam, W, H))

    for index, p in enumerate(STEPS):
        canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        canvas.alpha_composite(body, (0, seam))

        # ① 闭合盖（垫在下面）
        alpha = int(round(255 * max(0.0, 1 - p) ** CLOSED_LID_FADE_POW))
        if alpha > 0:
            lid_h = max(1, round(closed_lid_h * (1 - CLOSED_LID_SQUASH * p)))
            piece = closed_lid.resize((W, lid_h), Image.LANCZOS)
            piece.putalpha(piece.getchannel('A').point(lambda v: v * alpha // 255))
            canvas.alpha_composite(piece, (0, seam - piece.height))

        # ② 升起的新盖（压在上面）
        k = 1 - (1 - p) ** 1.5
        h = round(seam * k)
        if h >= 2:
            canvas.alpha_composite(lid.resize((W, h), Image.LANCZOS), (0, seam - h))

        path = os.path.join(OUT_DIR, f'chest_seq_{index}.png')
        canvas.save(path)
        print('saved', path, canvas.size, f'p={p}')


if __name__ == '__main__':
    main()
