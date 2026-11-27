# -*- coding: utf-8 -*-
"""战士通用剑气（第 49 批）散图 -> 图集 + 单帧动画 + Prefab。

## 需求

「现有卡牌的角色技能效果中使用了轻骑兵冲锋的统一换成【战士通用剑气】特效，
并制作格式一致的预制，飞行中的定格帧选择 skill_1_24，子弹的朝向目标的方向参考示例图。」

于是：冲锋车道三条技能（菌盾冲锋 101204 / 冲锋 102303 / 尖刺冲锋 102703）原本都播
`units/projectiles/轻骑兵_冲锋/轻骑兵_冲锋` 这张「木马骑兵冲锋残影」，本批统一换成这张剑气。

## 为什么只用 1 帧

源目录里有 `070-1-Skill_1_23 … _37` 共 15 帧（整套斩击序列，每帧都是 1646×673 的大画布）。
用户口径是「**飞行中的定格帧**选 skill_1_24」—— 也就是弹体在飞行途中**定格**在这一帧，
不逐帧播。所以：

  · 只把 `_24` 打进图集，其余 14 帧搬去 `tmp/projectile_src/战士通用剑气/`（`CACHE_UNUSED_FRAMES`）；
  · `anim` 仍是单帧 clip（**必须循环**：单帧不循环在某些机型上会闪一下，同 `build_range_ring_fx.py`）；
  · 事件寿命由模型给（`ZCEffectTuning.dashSeconds = 0.3`），不由 clip 推。

🔴 别改成「按帧数 × 1/24 算寿命」——那是序列帧的口径，这里一共就 1 帧。

## 尺寸口径（贴图就是屏上尺寸，`_lscale` 恒为 1）

实测 alpha>0 的并集是 `(1215,124)-(1597,561)` = **382×437**，画布 1646×673 里 88% 是空白。
先按这个框裁掉空白（只有一帧，不存在逐帧抖动问题），再等比缩到**屏上尺寸**：

    CANVAS_H = 141（= 屏上高），CANVAS_W = round(382 × 141 / 437) = 123（= 屏上宽）

被替换的 `轻骑兵_冲锋` 是 300×140 画布 × `nodeScale 0.4` ⇒ 屏上 **120×56**。
剑气是竖长条（382:437），不能按高度对齐 —— 按**横向**对齐到同一量级
（123 vs 旧 120，纵向更长正是剑气的观感）。

🔴 **prefab 不再乘任何倍率**（2026-11-26 改口径：原先是画布 224×256 + 子节点 0.55）。
要改大小就改 `CANVAS_H`（宽按比例跟着变）重跑，别去 prefab 里加 `_lscale`，
也别去 `ZCCombatEffectScale` 里找。

## 朝向

素材是「C 形月牙、凸面朝 **−X**」（`skill_1_24` 的掩码：中段右边界从 57 列缩到 34 列 ⇒
凹口朝右；用户示例图同样是凸面朝左 + 红箭头朝左 = 飞行方向）。
所以目录登记 `flight.facingOffsetDegrees = 180`，`转角 = 弹道方向 + 180`。
**这个 180 不是可以随手改的常数** —— 漏了它就是「剑气横着飞」。
"""
import os

from PIL import Image

import build_dart_attack_fx as base

SET_NAME = '战士通用剑气'
base.SET_NAME = SET_NAME

#  飞行定格帧（用户指定）。序列 23~37 里只取这一张。
FLIGHT_FRAME = '070-1-Skill_1_24.png'
base.FRAMES = [FLIGHT_FRAME]

#  该帧 alpha>0 的实测范围（源 px，含 1px 余量）。
UNION_BOX = (1215, 124, 1597, 561)
CANVAS_H = 141
CANVAS_W = round((UNION_BOX[2] - UNION_BOX[0]) * CANVAS_H / (UNION_BOX[3] - UNION_BOX[1]))

base.CANVAS_W = CANVAS_W
base.CANVAS_H = CANVAS_H
#  贴图即屏上 123×141 px（与旧残影的 120 宽对齐，见模块注释）⇒ prefab 不再缩放。
base.PREFAB_SCALE = 1
#  裁完之后内容 = 整幅画布，质心就在画布中心 ⇒ 不需要摆位偏移。
base.PREFAB_POS = (0.0, 0.0)

base.PREFAB_COLOR = None
#  单帧也循环（WRAP_LOOP = 2）：一次性播完会停在末帧，部分机型上闪一下。
base.WRAP_LOOP = 2
base.SAMPLE = 24
#  另外 14 帧不用，搬出 bundle（`removeImageInBundle` 管不到散图）。
base.CACHE_UNUSED_FRAMES = True


def _prepare_atlas_frames():
    """按内容框裁掉空白再写进 `atlas/`。

    `base.main()` 只在 `atlas/<name>.png` **不存在**时才自己缩放 —— 而它缩的是**整幅画布**，
    1646×673 压成 224×92 之后月牙只剩一条细缝。所以先铺好这一张，它就只写 meta / pac / anim / prefab。
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


if __name__ == '__main__':
    _prepare_atlas_frames()
    base.main()
    print(f'\n完成。特效路径 = units/projectiles/{SET_NAME}/{SET_NAME}')
    print(f'缩放 {base.PREFAB_SCALE}（屏上 {round(CANVAS_W * base.PREFAB_SCALE)}x'
          f'{round(CANVAS_H * base.PREFAB_SCALE)} px）、朝向偏移 180°（美术凸面 -X）')
