# -*- coding: utf-8 -*-
"""大拳飞冲子弹类特效 散图 -> 自动图集(.pac) + 循环动画 + 战斗 Prefab。

68025 大威天芦「天降神拳」（skill 102504 / pvpSkill 30859）的表现资源。
散图（`units/projectiles/大拳飞冲子弹类特效/141_00.png … 141_16.png`，17 张 1350x675）
之前只有序列帧、没有预制，`pvpSkill.effectPrefabPath` 挂不上去，所以复用
`build_dart_attack_fx.py`（玉林好汉飞镖）那套生成器，只换尺寸口径：

  · 画布：长边 256、1:1 保持原始比例 → 1350x675 缩成 **256x128**；
  · `_lscale = 0.6` ⇒ 屏上可见内容宽 ≈ 963/1350 × 256 × 0.6 ≈ **110 px**（约 2.6 格顶面）。
    拳比飞镖（80px）大一圈、比火焰树妖（228px）小，符合「贯穿重拳」的体积；
    要改大小**只动 PREFAB_SCALE 这一个数**，不要动画布；
  · 美术正前方朝 **+X**（拳在右、拖尾在左），与 `ZCCombatEffectView` 的 projectile 分支
    「转角 = 弹道方向」天然对齐，不需要在 `ZCAttackEffectFacing` 里登记偏转。

可重入：已存在的 .png / .pac / .anim 一律跳过，不覆盖成品；prefab 每次重写（内容确定）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build_dart_attack_fx as base  # noqa: E402

base.SET_NAME = '大拳飞冲子弹类特效'
base.FRAMES = ['141_%02d.png' % i for i in range(17)]   # 141_00 … 141_16，共 17 帧
base.CANVAS_W = 256                                      # 长边，与既有投射物特效一致
base.CANVAS_H = 128                                      # 1350x675 等比缩到 256 宽
base.PREFAB_SCALE = 0.6                                  # 屏上可见内容宽 ≈ 110px
base.PREFAB_POS = (0.0, 0.0)                             # 投射物不抬高

if __name__ == '__main__':
    base.main()
