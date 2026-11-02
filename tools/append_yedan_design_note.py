# -*- coding: utf-8 -*-
"""把椰蛋战士（68005）这轮的落地口径写回 `技能设计案2.xlsx`。

三件事：
  1. `技能设计案 (2)` 第 22 / 24 / 25 / 26 行的 **P 列（落地口径）** 按实际实现更正 ——
     设计案原稿给的是「理想落法」，有两处照字面写会静默不生效，已改成本轮真正落地的写法。
  2. `本次改动说明` 页尾追加 9 条口径。
  3. `技能实现改动明细` 页尾追加一节「椰蛋战士 2026-11-04」的改动清单。

⚠️ openpyxl 另存会把冻结窗格掉成默认值，存完必须写回（本文件既有约定，当前应为 M20）。
⚠️ 若 Excel 正开着这个文件，`save` 会抛 PermissionError —— 捕获后提示关文档即可。
"""

from openpyxl import load_workbook

PATH = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'

COL_SKILL = 7          # G 列 = 技能ID
COL_LANDING = 16       # P 列 = 落地口径

# 行号 → (期望的技能ID, 新的落地口径)
LANDING = {
    22: (200501, '普攻伤害 = pvpCard.unitAttack，本行只定义形态与节拍。'
                 '原本挂着的 empoweredSkillId=36221（长戟兵武将技）是遗留链路，已按设计案摘掉，'
                 '改指 30831（暴风）——那是 100504 的强化槽落点'),
    24: (100502, '一条普攻行只有一个强化槽（已被 100504 暴风占用），所以横扫挂 pvpSkill 新增列 '
                 'secondarySkillId=30832，由 ZCSkillTriggerSystem 的副轨按 '
                 'secondaryCooldown=8 推进；命中结算在 ZCAttackResolutionSystem.castFanSkill：'
                 '朝当前目标取 120° 扇形、半径 = 当前攻击距离 ×1.4（会吃到 100503 的 +30%）、'
                 '伤害倍率与击退由 skillParamJson 逐档给。击退复用 ZCGameModel.applyLegacyKnockback'
                 '（与 legacy_knockback 同一实现，撞墙/不可走格会被吞）'),
    25: (100503, 'ZCStatSchema 硬校验「同一 unit + 技能链 + 等级只能有一行」⇒ 一行只放得下一个 statId。'
                 '所以攻击范围占 statId（unit 域 attackRange addRate=0.30），'
                 '吸血放同一行的 skillParamJson = {"lifestealRate":0.02}（比例口径，0.02 = 2%），'
                 '运行时按「技能参数优先、unit 域 lifestealRate 兜底」取值，'
                 '并按 damageUnit 真正扣掉的血量（applied）反算回血'),
    26: (100504, 'skill 域 behaviorKey = on_cast_end_spawn_zone（已注册）；数值全在 skillParamJson：'
                 'zoneCount=3 / zoneSpreadDeg=30 / zoneMoveSpeed=70 / zoneDuration=3·4·4 / '
                 'zoneMaxHits=3·4·5 / damageRate=0.8·1.0·1.2。'
                 '暴风走「强化那一击」的持续区域分支，但区域改成**会移动**：'
                 'ZCGroundZoneState 新增 moveVelocityX/Y + hitUnitIds/maxHits，'
                 '从施法者朝目标扇形抛出、路径上每个敌人只吃一次、命中名额打满立刻消散'),
}

NOTES = [
    ('椰蛋战士（68005）· 2026-11-04 落地口径', None),
    ('口径 1 · 两条主动必须拆两条链',
     '一条普攻行只有一个强化槽（pvpSkill.empoweredEvery + empoweredSkillId）。68005 同时有'
     '「每 5 次普攻的暴风」和「冷却 8 秒的横扫」，塞不进同一个槽。'
     '所以强化槽给暴风（30831，trigger = every_n_attacks / empoweredEvery = 5），'
     '横扫（30832）挂到 pvpSkill 新增的 secondarySkillId 上，由 ZCSkillTriggerSystem 的副轨'
     '（unit.secondaryReadyAt）单独按 CD 推进。两条链互不推进对方的计数器。'),
    ('口径 2 · 横扫为什么不用 sendAttack',
     'sendAttack 会推进 completedAttackCount / empoweredReadyAt（普攻节拍与强化 CD）。'
     '横扫走独立的 castFanSkill：只做伤害 + 击退 + 一条 area 表现事件，'
     '不动节拍。代价是它不复用「克制/暴击文本」以外的普攻逻辑，但这两样本轮都补了。'),
    ('口径 3 · 横扫的判定怎么算',
     '方向 = 当前目标方向（没有目标就不出手、也不消费 CD）；半角 = secondaryFanDeg/2（缺省 120°）；'
     '半径 = ZCTargetingSystem.attackReach(定义) × secondaryRadiusScale（缺省 1.4）。'
     'attackReach 已经含 bodyRadius 并乘了 combatDistanceScale，所以 100503 的 +30% 攻击距离'
     '会自动把横扫范围一起放大 —— 不需要再配一遍。'),
    ('口径 4 · 「击退 2 格」的单位换算',
     'applyLegacyKnockback 的参数口径是「逻辑距离」，内部再乘 combatDistanceScale(0.3)。'
     '所以 2 格 = 2 × HEX_GRID_LOGICAL_ROW_STEP(42) = 84，落屏约 25（≈1 格行距 ×2）。'
     '直接传 2 会变成 0.6，肉眼几乎不动。'),
    ('口径 5 · 吸血为什么不走 statId',
     'ZCStatSchema 硬校验「同一 unit + 技能链 + 等级只能有一行」，而 100503 要同时给'
     '「攻击范围 +30%」和「吸血 2%」两个数值，一行只有一个 statId 落点。'
     '所以攻击范围占 statId、吸血放 skillParamJson.lifestealRate。'
     '新增的 unit 域 statId lifestealRate 仍然可用（留给「整卡常驻吸血」），'
     '取值优先级是「技能参数 > unit 域」。'),
    ('口径 6 · 吸血按实际扣血反算，持续区域也算',
     '回血量 = damageUnit 返回的 applied × 比例，不是面板伤害。'
     '打护盾 / 溢出 / 被 0 抵消时都不会凭空回血。'
     '派发点共 5 处：近战直击 / 近战范围溅射 / 弹道命中 / 弹道溅射 / **持续区域的每一波（含到期那一下）**。'
     '区域这处由 ZCGroundZoneSystem 通过 IZCGroundZoneContext.lifestealFromHit 回调，'
     '只递「源单位 id + 这一跳的飘字」，比例仍由 ZCAttackResolutionSystem.applyLifesteal 统一取，'
     '不另写一套口径。一次波次打中 N 人 = N 次独立回血，各按各自实际掉血算，不是按一波总额回一次。'
     '源单位已阵亡时不再回血（风还在飘、人已经没了不应继续吸）。'),
    ('口径 7 · 移动区域补了哪些字段',
     'ZCGroundZoneState 原本没有方向、也没有命中上限。新增'
     'moveVelocityX / moveVelocityY（世界坐标/秒）、hitUnitIds + maxHits（命中名额）。'
     '缺省都不写 ⇒ 原地波次区域（暴风雪 / 灼热地带 / 火船）行为逐字不变。'
     '快照编解码已登记这四个字段的校验（速度可负，名额是正整数）。'),
    ('口径 8 · 暴风的「提前消散」怎么判',
     'ZCGroundZoneSystem.tick 先按速度推进位置、再结算这一波：waveInterval 固定 0.15s 探路一次，'
     '命中过的敌人进 hitUnitIds 不再重复结算；hitUnitIds 满 maxHits 就把 remainingSeconds 归零，'
     '区域当帧消失。所以「最多对路径上的 3/4/5 个敌人各打一次」是硬上限，不会被 3 秒时长拖成 More。'),
    ('口径 9 · 美术与表现',
     '暴风：新建 椰蛋战士_暴风.prefab，两级结构，offset._lscale = 2（风法师_龙卷风 原来是 4，缩 50%），'
     '帧与 loop clip 跨目录引用原技能，不复制美术。'
     '横扫：新建 椰蛋战士_横扫.prefab，两级 + 5 簇刀光沿 120° 弧摆开，'
     '引用 长枪兵普攻_刀光 的帧与 clip，每簇 _lscale = 1.15。'
     '两张 prefab 都只含 2 个文件（prefab + meta）。'),
    ('口径 10 · 区域吸血补齐之前为什么没做',
     'ZCGroundZoneSystem 的上下文（IZCGroundZoneContext）是给「只跑区域结算」的轻量场景设计的，'
     '里面没有 skillRuntime / statPatches / effectiveDefinition —— 拿不到施法者的吸血比例，'
     '所以第一版把区域排除在外。补齐方式不是把整套攻击上下文塞进区域（会把区域系统和攻击系统绑死），'
     '而是在区域上下文上加一个 lifestealFromHit(sourceUnitId, hitText) 回调，由模型侧找回源单位、'
     '转给普攻同一条 applyLifesteal。好处是比例只有一个真源；代价是区域那条链必须在模型里接线，'
     '忘了接就是「不吸血但不报错」—— 所以该回调声明成可选，并有三条用例钉住'
     '（命中两人回两次 / 被盾吃不回 / 源单位阵亡不回）。'),
    ('这轮改到的表与代码',
     'pvpSkill：30707 改链（empoweredEvery 1→5、trigger every_seconds→every_n_attacks、'
     'empoweredSkillId 36221→30831、新增 secondarySkillId=30832），新增 30831 / 30832，'
     '并给 PVP-技能.xlsx 补了 R 列 secondarySkillId；'
     'pvpSkillPlan：新增 68005 共 12 行（4 技能 × 3 档）；pvpCard 不变（普攻行没换）。'
     '代码：ZCStatSchema 加 statId lifestealRate 与 behaviorKey on_cast_end_spawn_zone、'
     'ZCModifierRuntime 加 lifestealRate patch 字段、ZCCombatCatalog/ZCPvpTableParser 加 secondaryProfile、'
     'ZCAttackResolutionSystem 加 castFanSkill / applyLifesteal / 移动区域生成、'
     'ZCGroundZoneSystem 加位移、命中名额与 lifestealFromHit 回调、'
     'ZCSkillTriggerSystem 加副轨、ZCSnapshotCodec 登记新字段。'
     '用例：tests/zcds-yedan-skills.test.ts（13 条全绿，含 3 条区域吸血）。'
     '两张 Excel 源表（PVP-技能 / J-技能表）已同步；PVP-卡牌无需改动。'),
]

DETAIL = [
    ('', None),
    ('椰蛋战士（68005）· 2026-11-04 技能实装与配表改动明细', None),
    ('一、本次上线口径（每条技能落在哪张表、靠什么触发）', None),
    ('· 200501 切割（普攻）：pvpSkill 30707，mode=melee 不变，仍是 椰蛋战士_普攻 特效。'
     '只有强化槽被换掉（empoweredEvery=5 / every_n_attacks / empoweredSkillId=30831）。', None),
    ('· 100501 高速移动（被动）：pvpSkillPlan 68005 链 100501 × 3 档，'
     'statId=moveSpeed / operation=addRate / value=0.15，三级同值、progressionMode=replace。', None),
    ('· 100502 横扫（主动-冷却 8s）：pvpSkill 30832 是它的技能行（特效 + 名字），'
     '触发挂在 30707.secondarySkillId；pvpSkillPlan 链 100502 × 3 档给 '
     'secondaryCooldown / secondaryDamageRate(1.2·1.5·1.8) / secondaryFanDeg(120) / '
     'secondaryKnockback(0·0·2)。', None),
    ('· 100503 生命汲取（被动）：pvpSkillPlan 链 100503 × 3 档，'
     'statId=attackRange addRate=0.30 + skillParamJson={"lifestealRate":0.02}。', None),
    ('· 100504 暴风（主动-累计 5 次普攻）：pvpSkill 30831 是它的技能行；'
     'pvpSkillPlan 链 100504 × 3 档给 zoneCount=3 / zoneSpreadDeg=30 / zoneMoveSpeed=70 / '
     'zoneDuration(3·4·4) / zoneMaxHits(3·4·5) / damageRate(0.8·1.0·1.2)，'
     'behaviorKey=on_cast_end_spawn_zone。', None),
    ('二、代码改动点', None),
    ('· 新增 statId lifestealRate（ZCStatSchema 联合类型 + STAT_IDS + UNIT_STAT_IDS + STAT_TO_PATCH；'
     'ZCUnitStatPatch.lifestealRate 是**比例**，不是百分数整数）。', None),
    ('· 新增 behaviorKey on_cast_end_spawn_zone（SKILL_BEHAVIORS + ZCSkillRuntimeRegistry 注册）。', None),
    ('· ZCCombatCatalog.ZCAttackProfile 新增 secondarySkillId；ZCUnitDefinition 新增 secondaryProfile；'
     'ZCPvpTableParser 解析并在指向缺失时直接抛错（避免「表填了、永远不出手」）。', None),
    ('· ZCAttackResolutionSystem：新增 castFanSkill（扇形伤害 + 击退）、applyLifesteal / lifestealRatioOf'
     '（近战直击 / 范围溅射 / 弹道命中三处派发）、zone 分支支持从施法者扇形抛出移动区域。', None),
    ('· IZCAttackResolutionContext 新增 healUnit（转 ZCStatusResolutionSystem.healUnit）与 '
     'applyKnockback（转 ZCGameModel.applyLegacyKnockback），不再各写一套。', None),
    ('· ZCGroundZoneSystem：tick 先推进位移再结算；resolveWave 用 hitUnitIds 去重、满 maxHits 提前消散；'
     'resolveWave / resolveExpiry 每打中一跳都调 context.lifestealFromHit(源单位 id, 飘字)，'
     'IZCGroundZoneContext 因此新增一个可选回调（区域系统不持有攻击上下文）。', None),
    ('· ZCGameModel.buildGroundZoneContext：接 lifestealFromHit —— 按 sourceUnitId 找回源单位、'
     '源单位已阵亡则跳过，否则转给 ZCAttackResolutionSystem.applyLifesteal。'
     '注意 attackResolutionContext 在本方法之后才构造，所以必须用闭包延迟取。', None),
    ('· ZCSkillTriggerSystem：新增副轨 advanceSecondary（secondaryReadyAt + castSecondary 回调，'
     '没打出去不消费 CD）。', None),
    ('· ZCSnapshotCodec：登记 unit.secondaryReadyAt 与 zone 的 moveVelocityX/Y / hitUnitIds / maxHits。', None),
    ('三、验证', None),
    ('· 机制单测：tests/zcds-yedan-skills.test.ts（13 条）—— 配表真值 × 2、编译期属性与参数 × 2、'
     '扇形判定 / 击退换算 / 无目标不出手 / 吸血反算 × 4、移动区域位移去重 / 命中上限提前消散 × 2、'
     '区域吸血 × 3（命中两人回两次 / 被盾吃不回 / 源单位阵亡不回）。', None),
    ('· 全量回归：npx tsx --test tests/zcds-*.test.ts —— 981 条用例，914 通过 / 67 失败，'
     '失败数与改动前完全一致（全部是视图 / prefab / 布局类既有红）。', None),
    ('四、仍然需要拍板的一条', None),
    ('· 暴风旋风的屏上体量按设计案「缩 50%」落成 _lscale=2（龙卷风原 4）。'
     '如果实测觉得「小旋风」仍偏大，只改 tools/build_yedan_skills_fx.py 里的 STORM_SCALE 重跑即可。', None),
]


def main():
    wb = load_workbook(PATH)
    design = wb['技能设计案 (2)']
    for row, (skill_id, text) in LANDING.items():
        # 守卫：行号漂移时不要写错人
        if str(design.cell(row, COL_SKILL).value) != str(skill_id):
            raise SystemExit('第 %d 行不是技能 %s（实为 %s），行号已漂移，先核对再写'
                             % (row, skill_id, design.cell(row, COL_SKILL).value))
        design.cell(row, COL_LANDING).value = text

    note = wb['本次改动说明']
    start = note.max_row + 2
    for offset, (title, body) in enumerate(NOTES):
        row = start + offset
        note.cell(row, 1).value = title
        if body:
            note.cell(row, 2).value = body

    detail = wb['技能实现改动明细']
    detail_start = detail.max_row + 2
    for offset, (title, _) in enumerate(DETAIL):
        detail.cell(detail_start + offset, 1).value = title

    frozen = design.freeze_panes
    wb.save(PATH)
    wb2 = load_workbook(PATH)
    wb2['技能设计案 (2)'].freeze_panes = frozen or 'M20'
    wb2.save(PATH)
    print('[ok] 设计案：P 列更正 %d 行（%s）；本次改动说明追加 %d 条（行 %d~%d）；'
          '实现改动明细追加 %d 行（行 %d~%d）；冻结窗格 %s'
          % (len(LANDING), ', '.join(str(row) for row in sorted(LANDING)),
             len(NOTES), start, start + len(NOTES) - 1,
             len(DETAIL), detail_start, detail_start + len(DETAIL) - 1,
             frozen or 'M20'))


if __name__ == '__main__':
    try:
        main()
    except PermissionError:
        raise SystemExit('写入失败：技能设计案2.xlsx 正被 Excel 占用，关闭文档后重跑本脚本')
