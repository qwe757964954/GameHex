# -*- coding: utf-8 -*-
"""仙桃行者_重击技能（大地之力 100904 / 武将技 36241）散图 -> 图集 + 一次性动画 + Prefab。

源资源：`units/projectiles/仙桃行者_重击技能/` 下 32 张 1065×2372 散图
（`245_00 … 245_43`，缺号是美术合帧后的残留；`245_41 / 42 / 43` **整张全透明**，必须剔掉，
否则结尾会多挂 3 帧空白 = 特效「演完了还在原地不动」）。剩 **29 帧**。

复用 `build_dart_attack_fx.py` 的生成器（与 `玉米射手_普攻` 同构的两级节点 prefab），只改模块级常量。

## 与既有投影物特效的两处不同

1. **一次性（`WRAP_LOOP = 1`）**：这是「砸下来 + 起爆 + 消散」的单次演出，循环播会变成一盏一直闪的灯；
2. **sample = 24**：29 帧 / 24 ≈ **1.208s**，与代码常量 `ZC_QUAKE_STRIKE_SECONDS` 必须一致 ——
   事件寿命短于 clip 时长会被 `ZCGameModel` 按 `startedAt + durationSeconds` 提前摘掉，
   表现是「砸下来那一半就没了」（同 §14.5）。

## 尺寸口径（画布即屏上尺寸，`PREFAB_SCALE` 保持 1）

判定圆半径取 `pvpSkillPlan.skillParamJson.quakeRadius = 54`（逻辑 px，约 1.5 格）。
项目统一换算（§1.11）：屏上 px = 逻辑 px × combatDistanceScale(0.3) × view/logical(2.5625)
= 逻辑 px × 0.76875 ⇒ **直径 108 逻辑 = 83.03 屏上 px**。

美术侧实测（`245_03`，alpha>60）：
  · 地面裂纹环**最宽 616 源 px**（y≈1990 那一行，x 224~840，中心 ≈ 532 = 画布中心）；
  · 环带纵向 1950~2155，**质心 y ≈ 2050**（源高 2372，即画布垂直中心下方 36.4%）。

于是：
  · 画布**直接取屏上尺寸**，不再靠 prefab 缩放：`CANVAS_W = 144`（≈ 108 逻辑 px 的环直径
    83.0 + 两侧余量），`CANVAS_H = round(2372 × 144 / 1065) = 321`；
  · 环半径在画布里 = 308 × 144/1065 = 41.6 ⇒ `PREFAB_SCALE = 1`
    （屏上环直径 83.3px，与判定直径 83.0 齐平）；
  · 环质心要落在**节点原点**（＝受击目标的脚下坐标），而它不在画布中心 ⇒ 用 `_lpos.y` 抬回去。
    `_lpos` 是**父空间**坐标、**不乘自己的 `_lscale`**（同 `玉米射手_普攻` 的两级结构），
    所以位移量 = 36.4% × CANVAS_H × PREFAB_SCALE ≈ 116.9。

🔴 画面上的环 = 判定圆，这一条是**刻意对齐**的（§34.6 的教训：玩法半径与美术地面盘一旦脱钩，
玩家立刻会觉得「明明打到了却没伤害」）。改 `quakeRadius` 就必须同步改这里重跑，反之亦然。
"""
import os

import build_dart_attack_fx as base

SET_NAME = '仙桃行者_重击技能'
base.SET_NAME = SET_NAME

#  29 帧：00~39 里剔掉整张全透明的 41 / 42 / 43（它们本来也不在这段区间内）。
base.FRAMES = [
    '245_%02d.png' % i
    for i in (0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 13, 14, 16, 17, 18,
              20, 21, 23, 24, 25, 26, 27, 28, 30, 32, 34, 35, 37, 39)
]
base.CANVAS_W = 144
base.CANVAS_H = 321
#  尺寸全烘在画布里（屏上 px），prefab 不留缩放：再乘一次就是两个真源。
base.PREFAB_SCALE = 1

#  地面裂纹环质心（`245_03` 实测 2050 / 2372），换算成父空间抬高量。
RING_CENTER_Y = 2050 / 2372
base.PREFAB_POS = (0.0, round((RING_CENTER_Y - 0.5) * base.CANVAS_H * base.PREFAB_SCALE, 2))

base.PREFAB_COLOR = None
#  一次性演出：`wrapMode = 1`（Normal，播一遍）。
base.WRAP_LOOP = 1
base.SAMPLE = 24
#  尾段 3 张全透明散图 + 缺号，一律搬出 bundle，不参与打包。
base.CACHE_UNUSED_FRAMES = True


def _build_once_anim(clip_name, frame_uuids, meta_uuid):
    """把 `-loop` 后缀换成 `-play`，并显式写一遍 `wrapMode = 1`。

    生成器的 `build_loop_anim` 名字带 loop、默认循环；这里只换名与模式，曲线结构不动。
    文件名由 `main()` 决定（它按 `-loop` 拼路径），所以 `_rename_anim()` 在跑完后补一次改名。
    """
    clip, meta = _ORIGINAL_BUILD_ANIM(clip_name.replace('-loop', '-play'), frame_uuids, meta_uuid)
    clip['wrapMode'] = 1
    return clip, meta


def _rename_anim(to_loop):
    """在 `-loop.anim` 与 `-play.anim`（含 meta）之间改名，两边都在时以目标为准、清掉残留。

    只改文件名不动 uuid ⇒ prefab 里按 uuid 的引用不受影响。
    跑前先挪回 `-loop`（`main()` 的 `existing_uuid` 才命中同一份 uuid，重跑不会换身份），
    跑完再挪成 `-play`（真名，一次性演出不该叫 loop）。
    """
    anim_dir = os.path.join(base.PROJECTILES_DIR, SET_NAME, 'anim')
    suffix_from, suffix_to = ('-play', '-loop') if to_loop else ('-loop', '-play')
    for ext in ('', '.meta'):
        src = os.path.join(anim_dir, f'{SET_NAME}{suffix_from}.anim{ext}')
        dst = os.path.join(anim_dir, f'{SET_NAME}{suffix_to}.anim{ext}')
        if not os.path.isfile(src):
            continue
        if os.path.isfile(dst):
            #  两边都在：目标已经是权威那一份（uuid 被 prefab 引用），删掉来路上的残留。
            os.remove(src)
            continue
        os.rename(src, dst)
    print(f'[改名] anim 统一为 {SET_NAME}{suffix_to}.anim')


_ORIGINAL_BUILD_ANIM = base.build_loop_anim
base.build_loop_anim = _build_once_anim

if __name__ == '__main__':
    _rename_anim(to_loop=True)
    base.main()
    _rename_anim(to_loop=False)
