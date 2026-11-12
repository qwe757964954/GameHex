# -*- coding: utf-8 -*-
"""持续光环伤害效果（大威天芦「无尘禁土」102503）散图 -> 图集 + 循环动画 + 战斗 Prefab。

源资源：`units/projectiles/持续光环伤害效果/` 下 51 张 1262×1924 散图（`223_01 … 223_51`），
**没有 prefab / anim / pac**。复用 `build_dart_attack_fx.py` 的生成器（与 `玉米射手_普攻`
同构的两级节点 prefab），只改模块级常量。

## 设计案口径（`技能设计案2.xlsx` 第 125 行「表现描述」）

「使用【持续光环伤害伤害效果】叠加成类似角色的黄色，中间持续伤害时，在**第 8 到第 25 帧循环**。」

⇒ 只取 `223_08 … 223_25` 这 **18 帧**做循环段（1~7 是「燃起」的起势，26~51 是「收起」的
余波，都不进循环）；18 帧 / sample 12 = **1.5 秒**一圈。入场的「由无到有」由区域系统的
`growSeconds`（0.2s 由小变大）负责，不靠这段动画自己长。

`CACHE_UNUSED_FRAMES = True`：剩下 33 帧散图（含 meta）搬去 `tmp/projectile_src/<set>/`，
**不留在 bundle 里被打包** —— 只取一段帧时很容易漏这一步，漏了就是几十 MB 的死资源。

## 尺寸口径（改大小只动 `PREFAB_SCALE` 这一个数）

区域判定半径取 `pvpSkillPlan.skillParamJson.auraRadius = 60`（与既有区域技能同一档）。
项目统一换算（docs §1.11，见 `ZCCombatEffectScale` 的注释）：
    屏上 px = 逻辑 px × combatDistanceScale(0.3) × view/logical(2.5625) = 逻辑 px × 0.76875
⇒ 光环直径 = 60 × 2 × 0.76875 = **92.25 屏上 px**。

美术侧量出来的锚点（`223_16`，同批帧一致）：
  · 底部蓝色漩涡的 **alpha>60 可见宽 ≈ 772 源 px**（占 1262 画布的 61%），水平居中于 x≈618；
  · 漩涡**质心在 y ≈ 1507**（源图高 1924），即画布垂直中心下方 28.3%。

于是：
  · 画布取长边 256 ⇒ `CANVAS_H = round(1924 × 256 / 1262) = 390`；
  · 漩涡在画布里的可见宽 = 772 × 256/1262 = 156.6 ⇒ `PREFAB_SCALE = 92.25 / 156.6 ≈ 0.58`
    （屏上 156.6 × 0.58 = 90.8px，与 92.25 的判定直径基本齐平）；
  · 漩涡质心要落在**节点原点**（＝单位脚下），而它不是画布中心 ⇒ 用 `_lpos.y` 抬回去。
    注意 `_lpos` 是**父空间**坐标、**不乘自己的 `_lscale`**（同 `玉米射手_普攻` 的两级结构），
    所以位移量 = 28.3% × CANVAS_H × PREFAB_SCALE。

## 为什么没有染色

设计案要「叠加成类似角色的黄色」。试过在 Sprite 上烘 `_color` 做乘算：
浓黄（255,214,96）会把唯一的实色元素（蓝漩涡）压成土褐，淡黄（255,236,170）几乎看不出变化 ——
乘算只能压暗、不能把蓝提成黄。**配色交给美术出图或 shader**，prefab 保持原色。
真要临时改，把下面的 `PREFAB_COLOR` 打开即可（生成器支持 `cc.Sprite._color`）。
"""
import os

import build_dart_attack_fx as base

SET_NAME = '持续光环伤害效果'
base.SET_NAME = SET_NAME
#  设计案：「在第 8 到第 25 帧循环」⇒ 18 帧，首尾都取。
base.FRAMES = ['223_%02d.png' % i for i in range(8, 26)]
base.CANVAS_W = 256
base.CANVAS_H = 390
base.PREFAB_SCALE = 0.58

#  漩涡质心（`223_16` 的 alpha≥40 加权质心 618 / 1507，源图 1262×1924）。
VORTEX_CENTER_Y = 1507 / 1924
base.PREFAB_POS = (0.0, round((VORTEX_CENTER_Y - 0.5) * base.CANVAS_H * base.PREFAB_SCALE, 2))
#  已试过并否决的染色方案，见文件头「为什么没有染色」。
base.PREFAB_COLOR = None
#  只取循环段 ⇒ 其余散图搬出 bundle。
base.CACHE_UNUSED_FRAMES = True

if __name__ == '__main__':
    base.main()
