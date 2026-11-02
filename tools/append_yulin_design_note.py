# -*- coding: utf-8 -*-
"""把玉林好汉（68004）这轮的落地口径写回 `技能设计案2.xlsx`。

两件事：
  1. `技能设计案 (2)` 第 21 行（100404 精英猎手）的 N / P 两列更正 ——
     原稿 N 列写「伤害降为 50/70/80」，但同一行 K/L/M 列写的是 60/70/80；
     P 列的落法（`damageRate multiply=0.50`、`falloff` 无参数）也与实现不符。
  2. `本次改动说明` 页尾追加 10 条口径。

⚠️ openpyxl 另存会把冻结窗格从 `M17` 掉成默认值，存完必须写回（本文件既有约定）。
⚠️ 若 Excel 正开着这个文件，`save` 会抛 PermissionError —— 捕获后提示关文档即可。
"""

from openpyxl import load_workbook

PATH = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'

# 行 21 = 100404 精英猎手；列 N=14(设计详述) / P=16(落地口径)
ROW = 21
COL_N = 14
COL_P = 16

N21 = ('箭矢可穿透 3/6/8 个敌人、每次衰减 20%，同时本体伤害降为 60/70/80%，'
       '是典型的牺牲单体换群体。')
P21 = ('skillParamJson = {"damageRate":0.6,"pierceCount":3,"pierceFalloff":0.2}'
       '（L2 0.7 / 6 人、L3 0.8 / 8 人）；穿透衰减由 ZCProjectileSystem 新增 '
       'pierceFalloff 就地乘 baseDamage 实现，缺省 0 时既有穿透弹道行为不变')

NOTES = [
    ('玉林好汉（68004）· 2026-10-30 落地口径', None, None),
    ('口径 1 · 普攻换行不劫持玉米射手',
     '68004 原来的 unitSkillId = 30715（玉米射手普攻，特效是玉米）。新建 30716「玉林好汉普攻」'
     '指向新做的 玉林好汉_飞镖普攻 三件套，30715 原封不动留给玉米射手本尊，'
     '不会出现「玉米射手跟着播飞镖」的静默串味。', None),
    ('口径 2 · 每 10 秒一次',
     'pvpSkill 30716：trigger = every_seconds、cooldown = 10、empoweredSkillId = 30821。'
     '判定在 ZCCombatSystem.consumeEmpoweredAttack 的 CD 分支（empoweredReadyAt 绝对时刻），'
     '开局首次不强化、满 10 秒后的那一击才换成精英猎手。', None),
    ('口径 3 · 「子弹 ×3 倍」用放大版 prefab，不写参数',
     '尺寸的唯一真源是 prefab 根 _lscale（规范 §1.10），代码里 setScale 会造出第二个真源。'
     '所以另做 玉林好汉_飞镖普攻_强化.prefab，_lscale = 1.5（= 0.5 × 3），'
     '帧图与 loop clip 全部跨目录引用普攻那套，不复制美术。'
     '30821 的 effectPrefabPath 指向它，走的是引擎既有的「强化那一击换图」机制。', None),
    ('口径 4 · 穿透衰减是新增参数',
     '原有穿透（ZCProjectileSystem）只扣 remainingPierces、不扣伤害（baseDamage 出手时定死）。'
     '新增 pierceFalloff：每次穿透后就地乘 baseDamage，命中与溅射都从它现算，所以天然一起衰减。'
     '缺省 0 ⇒ 火船这类既有穿透弹道逐字不变。快照编解码已登记该字段的校验。', None),
    ('口径 5 · 伤害倍率（100402）原本是空转的',
     'pvpSkillPlan 写 statId = damageRate 能过 schema，但 ZCUnitStatPatch 没有对应字段、'
     'typedToLegacyPatch 也没有 case，会被 default: break 静默吃掉 —— 表填了、面板和伤害都不动。'
     '这轮补了 damageRatePct，只在伤害结算处乘一次（不抬高面板，符合「伤害倍率≠攻击力」的设计意图）。', None),
    ('口径 6 · 原稿 P 列自相矛盾，已更正',
     'N 列写「伤害降为 50/70/80」，K/L/M 列写 60/70/80，P 列又写 multiply=0.50。'
     '按 K/L/M 与「典型牺牲单体换群体」的意图，统一取 60/70/80，已在两列修正。', None),
    ('这轮改到的表与代码',
     'pvpSkill：新增 30716 / 30821 两行；pvpSkillPlan：新增 68004 共 12 行（4 技能 × 3 档）；'
     'pvpCard：68004 的 unitSkillId 30715 → 30716。'
     '代码：ZCProjectileSystem 加 pierceFalloff 衰减、ZCAttackResolutionSystem 写入该参数、'
     'ZCModifierRuntime 加 damageRatePct、ZCSnapshotCodec 登记校验。'
     '美术：新建 玉林好汉_飞镖普攻（13 帧 / 256×254 / sample 12 / 1.083s）与 _强化 两张 prefab。'
     '用例：tests/zcds-yulin-skills.test.ts（6 条全绿）。'
     '三张 Excel 源表（PVP-技能 / J-技能表 / PVP-卡牌）已同步。', None),
    ('顺手修掉的一个坑',
     '计划行的 skillParamJson 只有在 pvpSkillBinding 已有同键行时才会被合并 ——'
     '玉林好汉没有 30716 的 binding，走的是「新建 runtime」分支，而那条分支原本不合并 skillParams，'
     '表现是「表里填了 pierceCount / pierceFalloff、运行时读到 0」。'
     '已在 ZCMatchRuntimeCompiler 新建分支补上合并。此前的火焰树妖点燃（statusEveryNAttacks）'
     '其实也踩了这条，一并生效。', None),
    ('仍然没做的一条',
     '100404 表现描述里的「回收时糊 普攻爆炸（20% 透明）」没做：'
     '弹体过期/回收在 ZCProjectileSystem 里没有回调，而且 ZCCombatEffectView 目前不支持按事件传 alpha。'
     '要做得先加「弹体终结事件」再给特效壳加透明度参数，属于纯表现增量，建议单独排一轮。', None),
]


def main():
    wb = load_workbook(PATH)
    design = wb['技能设计案 (2)']
    # 守卫：这两格必须是玉林好汉的 100404 行，避免行号漂移写错人
    if str(design.cell(ROW, 1).value) != '68004' or str(design.cell(ROW, 7).value) != '100404':
        raise SystemExit('第 %d 行不是 68004 / 100404，行号已漂移，先核对再写' % ROW)
    design.cell(ROW, COL_N).value = N21
    design.cell(ROW, COL_P).value = P21

    note = wb['本次改动说明']
    start = note.max_row + 2
    for offset, (title, body, _) in enumerate(NOTES):
        row = start + offset
        note.cell(row, 1).value = title
        if body:
            note.cell(row, 2).value = body

    # 冻结窗格必须写回（openpyxl 另存会丢）
    frozen = design.freeze_panes
    wb.save(PATH)
    wb2 = load_workbook(PATH)
    wb2['技能设计案 (2)'].freeze_panes = frozen or 'M17'
    wb2.save(PATH)
    print('[ok] 设计案：第 %d 行 N/P 列已更正；本次改动说明追加 %d 条（行 %d~%d）；冻结窗格 %s'
          % (ROW, len(NOTES), start, start + len(NOTES) - 1, frozen or 'M17'))


if __name__ == '__main__':
    try:
        main()
    except PermissionError:
        raise SystemExit('写入失败：技能设计案2.xlsx 正被 Excel 占用，关闭文档后重跑本脚本')
