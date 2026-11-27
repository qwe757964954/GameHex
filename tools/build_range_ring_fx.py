# -*- coding: utf-8 -*-
"""技能范围指示「白环」（戈壁狂箭 / 冰山陨落 / 篮球火 共用的地面椭圆圈）。

## 为什么要椭圆

镜头是斜俯视，逻辑坐标 → 视图坐标**横纵比例不同**（`HexGridLayout`）：

    横 ZC_MAP_SCALE_X = 92.25 / 36 = 2.5625
    纵 ZC_MAP_SCALE_Y = 90   / 42 = 2.142857

所以地面上一个「半径 R 逻辑 px」的圆，画到屏上是半轴
`(R × 0.3 × 2.5625, R × 0.3 × 2.142857)` 的**椭圆** —— 纵向只有横向的 **0.8361**。
按正圆去画，玩家会看到「圈比实际判定扁/胖」，这正是 §34.6 那类「玩法半径与地面盘脱钩」的坑。

## 尺寸口径（改大小只动 `PREFAB_SCALE`）

画布 512×428：外沿半轴 = **256 × 214**（= 512 × 0.8359，与 0.8361 差 0.02%，肉眼不可见）。
`PREFAB_SCALE = 1` ⇒ scale 1 时横向半径 256 屏上 px，于是代码侧的倍率是

    effectScale = 半径(逻辑 px) × 0.76875 / 256

`ZC_SKILL_RANGE_RING_REFERENCE_RADIUS` 就是这个 256，两处必须一致。

## 观感（用户口径）

「白色的椭圆描边，边缘微亮，中间是 35% 的透明区域」
⇒ 外沿 4px 纯白描边 + 外扩高斯辉光，内部白色填充**不透明度 35%**（alpha 89/255）。
"""
import os

from PIL import Image, ImageDraw, ImageFilter

import build_dart_attack_fx as base

SET_NAME = '技能范围_白环'
base.SET_NAME = SET_NAME

#  外沿半轴（= scale 1 时的横向半径，代码侧 `ZC_SKILL_RANGE_RING_REFERENCE_RADIUS`）。
SEMI_X = 256
SEMI_Y = round(SEMI_X * 2.142857 / 2.5625)          # 214
#  留一圈留白给外扩辉光，否则辉光被画布边界切齐、边缘看着是硬切。
#  🔴 PAD 必须 ≥ 3 × GLOW_BLUR：高斯模糊的尾部要衰减到 3σ 才基本归零。
#  首版取 16 时实测画布右边缘仍有 alpha 8~11（3%），深色战场上就是一圈极淡的方形边。
PAD = 32
CANVAS_W = SEMI_X * 2 + PAD * 2                     # 576
CANVAS_H = SEMI_Y * 2 + PAD * 2                     # 492
STROKE = 4
FILL_ALPHA = round(255 * 0.35)                      # 89：不透明度 35%
GLOW_BLUR = 10
GLOW_ALPHA = 0.55


def _draw_ring():
    """画一张 512×428 的白环：辉光 + 35% 填充 + 4px 纯白外沿。"""
    box = (PAD, PAD, PAD + SEMI_X * 2 - 1, PAD + SEMI_Y * 2 - 1)

    #  ① 辉光层：只画描边，再整体高斯模糊 ⇒ 外扩与内收都有亮度衰减（「边缘微亮」）。
    glow = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(box, outline=(255, 255, 255, 255), width=STROKE + 2)
    glow = glow.filter(ImageFilter.GaussianBlur(GLOW_BLUR))
    #  乘透明度：辉光不能盖过描边本身。
    alpha = glow.getchannel('A').point(lambda a: int(a * GLOW_ALPHA))
    glow.putalpha(alpha)

    #  ② 内部填充：35% 不透明，能看见地面又看得出圈。
    body = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    ImageDraw.Draw(body).ellipse(box, fill=(255, 255, 255, FILL_ALPHA))

    #  ③ 纯白描边：PIL 的 width 向内画，外沿正好落在 256 × 214 上 ⇒ 圈 = 判定范围。
    edge = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    ImageDraw.Draw(edge).ellipse(box, outline=(255, 255, 255, 255), width=STROKE)

    out = Image.alpha_composite(glow, body)
    out = Image.alpha_composite(out, edge)
    return out


def _prepare_source():
    set_dir = os.path.join(base.PROJECTILES_DIR, SET_NAME)
    os.makedirs(set_dir, exist_ok=True)
    dst = os.path.join(set_dir, f'{SET_NAME}.png')
    _draw_ring().save(dst, 'PNG', optimize=True)
    print(f'[画] {SET_NAME}.png  {CANVAS_W}x{CANVAS_H}（填充 alpha {FILL_ALPHA}/255，描边 {STROKE}px）')


base.CANVAS_W = CANVAS_W
base.CANVAS_H = CANVAS_H
base.PREFAB_SCALE = 1.0
base.PREFAB_POS = (0.0, 0.0)
base.PREFAB_COLOR = None
#  静态图：循环播（单帧 clip 不循环会被 Animation 停在末帧，某些机型会闪一下）。
base.WRAP_LOOP = 2
base.SAMPLE = 24
base.FRAMES = [f'{SET_NAME}.png']
base.CACHE_UNUSED_FRAMES = False


if __name__ == '__main__':
    _prepare_source()
    base.main()
    print(f'\n完成。特效路径 = units/projectiles/{SET_NAME}/{SET_NAME}')
    print('scale 1 时横向半径 256 屏上 px；代码侧 effectScale = 逻辑半径 × 0.76875 / 256')
