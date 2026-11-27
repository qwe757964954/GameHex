# -*- coding: utf-8 -*-
"""运动霸_砸落技能（68033 天外飞石 30853 / 链 103304）散图 -> 图集 + 一次性动画 + Prefab。

源资源：`units/projectiles/运动霸_砸落技能/` 下 33 张 412×366 散图（`063-2-skill1_01…48`，
缺号是美术合帧后的残留，**没有全透明帧**）。

## 内容

「一盆花从天上砸下来」：01~30 货盘由远及近（逐渐变大）、31~32 带起离地尾迹、
33 触地、34 爆出火焰 + 白色冲击环、35~41 火势铺开、42~48 只剩余威环。

## 尺寸口径（改大小只动 `PREFAB_SCALE` 这一个数）

判定：`pvpSkill 30853.areaRadius = 80`（逻辑 px，`combatDistanceScale` 之前的口径），
`createAttackGroundZones` 里 `radius = effectiveAreaRadius = 80 × combatDistanceScale(0.3)`。
屏上换算（§1.11）：逻辑 px × 0.3 × 2.5625 = 逻辑 px × **0.76875**
⇒ 判定直径 **160 逻辑 = 123.0 屏上 px**。

用户口径（2026-11-25 第 46 批）：
> 「特效大小需要和伤害判定范围保持一致，按照砸落爆炸（skill_1_34 图片实际有像素的区域）
>   的特效大小去匹配范围」

即**取 34 帧（触地爆开那一帧）alpha>0 的紧致包围盒**当基准，不是整幅画布、也不是后段那张
铺到 371px 的余威环：

  · 34 帧 bbox = x[54..339] × y[177..335] ⇒ **286×159**（源 px）；
  · 33 帧取并集 bbox = x[11..389] × y[0..362] ⇒ 379×363，先按这个框统一裁掉空白
    （所有帧同一个框，播放不会抖），再等比缩到长边 256：
    `CANVAS_W = 256`、`CANVAS_H = round(363 × 256 / 379) = 245`；
  · 34 帧裁完的内容宽 = 286 × 256/379 = 193.18 画布 px ⇒
    `PREFAB_SCALE = 123.0 / 193.18 ≈ 0.6367`（爆点外沿 = 判定圆直径）。

## 锚点

`area` 事件把 prefab 挂在**目标坐标**上（`ZCCombatEffectPlacement` 对 `area` 取 `ground`，
坐标就是 `groundZone.x/y` = 判定圆心）。所以节点原点必须落在**冲击环椭圆的圆心**，
不能落在画布中心。

实测（34/35 帧 alpha>60 逐行量环的外沿，y 250~330 那段下半区）：
34 帧环外沿 y[250..328]、最宽行 y≈293；35 帧 y[250..331]、最宽行 y≈295
⇒ 椭圆圆心 ≈ **(195, 290)**（源 px，画布 412×366）。由此
`_lpos = (2.37, 46.63)`（`_lpos` 是父空间、不乘自己的 `_lscale`，同第 42/44 批）。

🔴 **别用「alpha>0 的 bbox 中心」当环心**：环的前沿（贴近镜头那半圈）比后沿厚一倍，
bbox 上下界分别是 248 / 331，中点 289.5 看着对，但 42~48 帧那几张余威环上方还压着尘土带，
按 bbox 取会一路偏到 277（偏 13 源 px ≈ 5.6 屏上 px，肉眼就是「爆点浮在地面上」）。

纵向的落点校验：货盘顶部在源 y=0 ⇒ 距环心 277 源 px ⇒ 屏上 **119px**，
约等于判定圆半径（61.5px）的 1.9 倍 —— 「从天而降」的高度够读，不必再叠 `visualLiftPx`。

🔴 后段余威环铺到 371 源 px（≈ 142 屏上 px），比判定圆大 16%：这是火焰 / 尘土的
外溢，**刻意不压回判定圈**（压回去就得把爆点缩小到 106px，反而「明明打到了却没烧到」，
与 §34.6 的教训相反）。改 `areaRadius` 必须同步改这里重跑，反之亦然。
"""
import os

from PIL import Image

import build_dart_attack_fx as base

SET_NAME = '运动霸_砸落技能'
base.SET_NAME = SET_NAME

#  33 帧：01~48 里的缺号是美术合帧残留，逐帧验过没有全透明帧（bbox 全部非 None）。
base.FRAMES = [
    '063-2-skill1_%02d.png' % i
    for i in (1, 2, 3, 5, 6, 8, 9, 11, 13, 15, 16, 18, 20, 22, 23, 25, 27,
              29, 30, 31, 32, 33, 34, 35, 36, 37, 39, 41, 42, 43, 44, 46, 48)
]

#  33 帧 alpha>0 的并集（源 px）。
UNION_BOX = (11, 0, 390, 363)
CANVAS_W = 256
CANVAS_H = round((UNION_BOX[3] - UNION_BOX[1]) * CANVAS_W / (UNION_BOX[2] - UNION_BOX[0]))

#  34 帧（触地爆开）实际有像素的区域 —— 用户指定的尺寸基准。
REFERENCE_BOX = (54, 177, 340, 336)

#  冲击环椭圆圆心（源 px）：34/35 帧逐行量环的外沿，上下界取中（近端更厚，别用 bbox 中心）。
RING_CENTER = (195, 290)

#  判定直径：areaRadius 80 逻辑 px × 2 × 0.76875 屏上 px/逻辑 px。
AOE_DIAMETER_SCREEN = 2 * 80 * 0.76875

_KX = CANVAS_W / (UNION_BOX[2] - UNION_BOX[0])
_KY = CANVAS_H / (UNION_BOX[3] - UNION_BOX[1])
_REFERENCE_W_CANVAS = (REFERENCE_BOX[2] - REFERENCE_BOX[0]) * _KX

base.CANVAS_W = CANVAS_W
base.CANVAS_H = CANVAS_H
#  34 帧内容宽 ↔ 判定圆直径。
base.PREFAB_SCALE = round(AOE_DIAMETER_SCREEN / _REFERENCE_W_CANVAS, 4)
#  冲击环圆心落在节点原点：父空间位移，不乘自身 _lscale。
base.PREFAB_POS = (
    round((CANVAS_W / 2 - (RING_CENTER[0] - UNION_BOX[0]) * _KX) * base.PREFAB_SCALE, 2),
    round(((RING_CENTER[1] - UNION_BOX[1]) * _KY - CANVAS_H / 2) * base.PREFAB_SCALE, 2),
)

base.PREFAB_COLOR = None
#  一次性演出：`wrapMode = 1`（Normal，播一遍）。
base.WRAP_LOOP = 1
#  33 帧 / 24 = 1.375s；`ZC_EFFECT_TUNING.meteorSlamSeconds` 必须与它一致，
#  否则事件先被 `ZCGameModel` 摘掉（表现是「砸到一半没了」）。
base.SAMPLE = 24
#  未使用的散图（本批没有）也一律搬出 bundle。
base.CACHE_UNUSED_FRAMES = True


def _prepare_atlas_frames():
    """按并集 bbox 裁掉空白后写进 `atlas/`。

    `base.main()` 只在 `atlas/<name>.png` **不存在**时才自己整幅缩放 ⇒ 先铺好这一批，
    它就只写 meta / pac / anim / prefab。
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
    print(f'画布 {CANVAS_W}x{CANVAS_H}、缩放 {base.PREFAB_SCALE}、锚点 {base.PREFAB_POS}')
    print(f'34 帧内容 {_REFERENCE_W_CANVAS:.2f} 画布px × {base.PREFAB_SCALE} = '
          f'{_REFERENCE_W_CANVAS * base.PREFAB_SCALE:.2f} 屏上 px（判定直径 {AOE_DIAMETER_SCREEN:.2f}）')
    print(f'时长 {len(base.FRAMES)}/{base.SAMPLE} = {len(base.FRAMES) / base.SAMPLE:.3f}s')
