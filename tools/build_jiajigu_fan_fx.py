# -*- coding: utf-8 -*-
"""机甲菇_武器绞杀（101503 扇形 `fan_slow`）散图 -> 图集 + 一次性动画 + Prefab。

源资源：`units/projectiles/机甲菇_武器绞杀/` 下 25 张 2586×1000 散图（`006-3-attack3_07…31`）。

## 剔帧

`07 / 09 / 11 / 12 / 14 / 15` **整张全透明**（bbox 为 None）—— 它们在序列中段，
留着就是「挥到一半闪一下没了」。直接剔掉，剩 **19 帧**（与第 44 批重击柱同一条口径：
全透明帧不参与打包，也不占 clip 时间）。

## 尺寸口径（改大小只动 `PREFAB_SCALE` 这一个数）

判定：`pvpSkillPlan.skillParamJson` 的 `fanRadius = 150`（逻辑 px）+ `fanAngle = 120`，
`ZCSkillResolutionSystem.castFanSweep` 里 `radius = fanRadius × combatDistanceScale(0.3)`。
屏上换算（§1.11）：逻辑 px × 0.3 × 2.5625 = 逻辑 px × **0.76875**
⇒ 扇形半径 **115.31 屏上 px**。

美术侧实测（19 帧取并集，alpha>0）：内容 bbox = x[653..1940] × y[95..911]
⇒ 1287×816，画布 2586×1000 里有大片空白。

于是先把每帧**按并集 bbox 裁掉空白**（所有帧用同一个框，播放不会抖），再等比缩到长边 256：

  · `CANVAS_W = 256`、`CANVAS_H = round(816 × 256 / 1287) = 162`；
  · 裁完之后内容宽 = 整幅画布宽 ⇒ `PREFAB_SCALE = 115.31 / 256 ≈ 0.4504`
    （「从施法者到尖端」正好等于判定半径）；
  · 尖端在 +X（截图红箭头方向）⇒ 锚点要放在**内容左端**：`_lpos.x = 128 × 0.4504 ≈ 57.65`
    （`_lpos` 是父空间、不乘自己的 `_lscale`，同第 42 批重击柱）；
  · 纵向内容质心与画布中心差 3 源 px ⇒ 忽略（0.27 屏上 px，肉眼不可见）。

🔴 这条「前伸长度 = 判定半径」是刻意对齐的（§34.6 的教训）。扇形 120° 在 r=115 处的
弦长 199 屏上 px，比素材的纵横比（1.58）宽得多 —— **位移长度按判定，张开角度按素材**，
不要为了「铺满扇形」把长度乘上去，那样尖端会伸到判定圆外 2.7 倍。
"""
import os

from PIL import Image

import build_dart_attack_fx as base

SET_NAME = '机甲菇_武器绞杀'
base.SET_NAME = SET_NAME

#  19 帧：剔掉整张全透明的 07 / 09 / 11 / 12 / 14 / 15。
base.FRAMES = [
    '006-3-attack3_%02d.png' % i
    for i in (8, 10, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31)
]

#  19 帧取并集的可见范围（源 px，含 1px 余量）。
UNION_BOX = (652, 94, 1941, 912)
CANVAS_W = 256
CANVAS_H = round((UNION_BOX[3] - UNION_BOX[1]) * CANVAS_W / (UNION_BOX[2] - UNION_BOX[0]))

base.CANVAS_W = CANVAS_W
base.CANVAS_H = CANVAS_H
#  扇形半径 150 逻辑 px = 115.31 屏上 px；裁完之后内容宽 = CANVAS_W。
base.PREFAB_SCALE = round(150 * 0.76875 / CANVAS_W, 4)
#  锚点挪到内容左端（父空间，不乘自身 _lscale）。
base.PREFAB_POS = (round(CANVAS_W / 2 * base.PREFAB_SCALE, 2), 0.0)

base.PREFAB_COLOR = None
#  一次性演出：`wrapMode = 1`（Normal，播一遍）。
base.WRAP_LOOP = 1
#  19 帧 / 24 ≈ 0.792s；`ZC_FAN_SWEEP_SECONDS` 必须与它一致，否则事件先被摘掉。
base.SAMPLE = 24
#  全透明帧 + 未使用的散图一律搬出 bundle。
base.CACHE_UNUSED_FRAMES = True


def _prepare_atlas_frames():
    """按并集 bbox 裁掉空白后写进 `atlas/`。

    `base.main()` 只在 `atlas/<name>.png` **不存在**时才自己缩放 ⇒ 先铺好这一批，
    它就只写 meta / pac / anim / prefab，不会把原图整幅（2586×1000）缩成一条细缝。
    """
    set_dir = os.path.join(base.PROJECTILES_DIR, SET_NAME)
    atlas_dir = os.path.join(set_dir, 'atlas')
    os.makedirs(atlas_dir, exist_ok=True)
    for name in base.FRAMES:
        dst = os.path.join(atlas_dir, name)
        if os.path.isfile(dst):
            continue
        src = os.path.join(set_dir, name)
        if not os.path.isfile(src):
            raise RuntimeError(f'缺帧: {src}')
        with Image.open(src) as im:
            im = im.convert('RGBA').crop(UNION_BOX).resize((CANVAS_W, CANVAS_H), Image.LANCZOS)
            im.save(dst, 'PNG', optimize=True)
        print(f'[裁+缩] {name} -> {CANVAS_W}x{CANVAS_H}')


def _build_once_anim(clip_name, frame_uuids, meta_uuid):
    """把 `-loop` 换成 `-play` 并写死 `wrapMode = 1`（一次性演出不该叫 loop）。"""
    clip, meta = _ORIGINAL_BUILD_ANIM(clip_name.replace('-loop', '-play'), frame_uuids, meta_uuid)
    clip['wrapMode'] = 1
    return clip, meta


def _rename_anim(to_loop):
    """在 `-loop.anim` 与 `-play.anim`（含 meta）之间改名；uuid 不动 ⇒ prefab 引用不受影响。"""
    anim_dir = os.path.join(base.PROJECTILES_DIR, SET_NAME, 'anim')
    suffix_from, suffix_to = ('-play', '-loop') if to_loop else ('-loop', '-play')
    for ext in ('', '.meta'):
        src = os.path.join(anim_dir, f'{SET_NAME}{suffix_from}.anim{ext}')
        dst = os.path.join(anim_dir, f'{SET_NAME}{suffix_to}.anim{ext}')
        if not os.path.isfile(src):
            continue
        if os.path.isfile(dst):
            os.remove(src)
            continue
        os.rename(src, dst)
    print(f'[改名] anim 统一为 {SET_NAME}{suffix_to}.anim')


_ORIGINAL_BUILD_ANIM = base.build_loop_anim
base.build_loop_anim = _build_once_anim


if __name__ == '__main__':
    _rename_anim(to_loop=True)
    _prepare_atlas_frames()
    base.main()
    _rename_anim(to_loop=False)
    print(f'\n完成。特效路径 = units/projectiles/{SET_NAME}/{SET_NAME}')
    print(f'缩放 {base.PREFAB_SCALE}（前伸 = 150 逻辑 px = 115.31 屏上 px）、锚点 {base.PREFAB_POS}')
