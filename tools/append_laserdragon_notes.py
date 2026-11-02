# -*- coding: utf-8 -*-
"""镭射飞龙（68010）· 设计案描述补齐的收尾部分。

三件事：
  1. `技能设计案 (2)` 第 48 / 49 / 50 / 51 行的 P 列（以及 49 的 N 列）按**真实代码口径**更正：
     - 101001 的多发必须走 unit 域 `bulletNum`（增量），不是 skillParamJson、也不是 projectileCount；
     - 101002 的「命中附加伤害」必须走 unit 域 `damageRate`（全命中生效），
       `impactDamageRate` 只在强化那一击被读（ZCAttackResolutionSystem:403 的 empowered 分支）；
     - 101003 / 101004 的解锁等级改成与线上 armySkillLevelUp 一致；
     - 101004 L3 的「受到治疗降低」标注为当前落不了地。
  2. `技能实现改动明细` 页尾追加一节「设计案 → 配置的差距清单」（9 条差距 + 2 条数值自查 + 落地顺序）。
  3. `本次改动说明` 页尾追加一节记录。

⚠️ openpyxl 另存会把冻结窗格掉成默认值，存完必须写回（本文件既有约定，当前应为 K1）。
⚠️ 若 Excel 正开着这个文件，save 会抛 PermissionError —— 捕获后提示关文档即可。
⚠️ 每节都可重跑：先按首行标记裁掉上一次追加的行，再写。
"""

import math
import re

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

PATH = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'

SHEET = '技能设计案 (2)'
COL_NAME, COL_MECH, COL_SHOW, COL_LANDING = 8, 14, 15, 16

H1 = Font(name='微软雅黑', size=13, bold=True, color='FF1F3864')
LABEL = Font(name='微软雅黑', size=10, bold=True, color='FF2E5C8A')
BODY = Font(name='微软雅黑', size=10)
HEAD_FILL = PatternFill('solid', fgColor='FFDCE6F1')

# ------------------------------------------------------------------ 主表更正
# 行号 → (技能ID, 期望技能名) 作行号漂移守卫
GUARD = {
    47: (201001, '镭射能量线'),
    48: (101001, '孢子弹幕'),
    49: (101002, '裂变凿击'),
    50: (101003, '追踪导弹'),
    51: (101004, '镭射死光'),
}

P48_OLD_HEAD = 'skill 域 skillParamJson={"bulletNum":1/1/2}'
P48_NEW = (
    'unit 域 bulletNum add=1/1/2（「增量」口径：+1 即 2 发、+2 即 3 发，走 bulletNumFlat，'
    '下限 1；写成 projectileCount 没有 flat 映射，会静默不生效） + '
    'unit 域 bulletAngle add=12（总张角 12° ＝ 每发偏 6°，只在发数 > 1 时才转方向） + '
    'unit 域 attackSpeed addRate=0.14/0.20/0.26 + unit 域 damageRate addRate=0.08/0.12/0.16；'
    '全部落在 68010 新建的普攻行 30717 及其 plan 行上，四条参数各占一行、互不覆盖'
)

N49_NEW = (
    '弹头在触敌瞬间裂变助推，在原有伤害之外再补一段按面板攻击折算的附加倍率。这里有个口径坑：'
    'impactDamageRate（skillParamJson）只在「强化那一击」被读取（ZCAttackResolutionSystem 的 '
    'empowered 分支），普通普攻读的是 pvpSkill.damageRate —— 所以要让「每一次命中都附加」必须走 '
    'unit 域 damageRate（addRate 0.50 → 最终 ×1.50）。damageRate 只在最终结算处乘一次、不抬高面板，'
    '也不额外触发状态与处决；和「孢子弹幕」叠加时每一发都各自吃一遍。'
    '【裂变凿击】附加伤害 50% → 78%；攻速 14% → 26%；射程 8% → 16%；满级价值约 153 VP，本档预算 150 VP。'
)

P49_NEW = (
    'unit 域 damageRate addRate=0.50/0.64/0.78（全命中生效，最终 ×1.50 / ×1.64 / ×1.78） + '
    'unit 域 attackSpeed addRate=0.14/0.20/0.26 + unit 域 attackRange addRate=0.08/0.12/0.16；'
    '三条落在 68010 新建的 plan 行上，与 101001 的参数互不覆盖（不同 statId 各占一行）。'
    '不要写成 impactDamageRate —— 那个只在强化那一击生效'
)

P50_TAIL = (
    '；新行为必须自己从 skillParamJson 读倍率，强化分支里那个 impactDamageRate 只在 empowered 那一击生效，'
    '独立技能读不到'
)

P51_TAIL = (
    '。L3 的「受到治疗降低 50%」当前落不了地：ZCUnitStatPatch 没有受治疗类字段，'
    'ZCStatusResolutionSystem.healUnit 也只是 target.hp + amount、没有任何修正钩子。'
    '两条路：① 新增 statId healTakenRate（消费点加在 healUnit 里）；'
    '② 换成现有字段能表达的减益 attackSpeedPct = -25（攻速降低 25%，持续 4 秒）。'
    '建议先走 ②，见【技能实现改动明细】差距 7'
)

# 101003 / 101004 的解锁等级对齐线上（9/18/24 与 0/20/25）
LEVEL_FIX = {50: (9, 18, 24), 51: (0, 20, 25)}

# ------------------------------------------------------------------ 实现改动明细
DETAIL_MARK = '镭射飞龙 68010 · 设计案 → 配置的差距清单（2026-10-30）'
DETAIL = [
    ('结论',
     '68010 在线上只有 pvpCard 一行，技能侧基本是空的：pvpSkill 借的是风法师普攻整行，'
     'pvpSkillPlan 0 行（68001~68005 各 12 行），pvpStatus 里也没有 68010 专用状态，'
     '也没有任何镭射飞龙专属特效。'
     '设计案 5 条技能要真能打，需要 1 条新普攻行 + 2 条新主动行 + 12 条 plan 行 + 2 个新 behaviorKey'
     '（外加 1 个待拍板的减益字段）。'),
    ('差距 1 · unitSkillId 指错行（最高优先级）',
     'pvpCard 68010 的 unitSkillId = 30251，那一行名字叫「风法师普攻」，除 effectPrefabPath'
     '（units/projectiles/风法师_绿风/风法师_绿风）之外还挂着 cooldown=15 / trigger=every_seconds / '
     'empoweredEvery=1 / empoweredSkillId=36251 —— 36251 是「风法师武将技」（mode=area、radius 60、'
     '0.8 倍 6 波），也就是说 68010 一出手就可能放出一道龙卷风。'
     '改法：新建 pvpSkill 30717「镭射飞龙普攻」（mode=projectile、projectileSpeed=500、'
     'effectPrefabPath 沿用 风法师_绿风 占位），把 pvpCard.unitSkillId 从 30251 改成 30717。'),
    ('差距 2 · 四条技能的 name / desc 还是旧设计',
     'armySkillLevelUp 里 101001~101004 各 3 档共 12 行，name 与 desc 全是本轮之前的设计，与设计案完全不符：'
     '101001 冰霜之躯（攻速 + 冷缩 + 技能范围）→ 孢子弹幕；101002 霜冻建筑（打建筑减速）→ 裂变凿击；'
     '101003 亡灵母舰（投放 2/3/4 个骷髅弓箭手与骷髅战士）→ 追踪导弹；'
     '101004 冰冻吐息（喷寒霜区域、每跳 30/35/40%）→ 镭射死光。'
     '12 行的 desc 要按设计案 L1/L2/L3 逐行重写，name 三档同名；'
     'armySkillType 保持现值 1/1/2/2 不动（1 = 被动、2 = 主动，与设计案 I 列一致）。'),
    ('差距 3 · pvpSkillPlan 一行都没有（真正的工作量在这）',
     '68010 在 pvpSkillPlan 里 0 行，而已落地的 68001~68005 每张各 12 行。'
     '要让被动 / 主动真正生效，至少要新建 12 行（101001 / 101002 / 101003 / 101004 × 3 档）。'
     '字段口径沿用椰蛋战士那批：skillKind（被动 / 主动）、passiveScope、progressionMode=replace（三级取最高）、'
     'statId + operation + value；behaviorKey + skillParamJson 给技能专属参数。'
     '注意 statId 只有 STAT_TO_PATCH 登记过的 10 个能走 flat 映射（critRate / critDamage / bulletNum / '
     'bulletAngle / attackCount / recruitCd / recruitMaxNum / singleRecruitNum / singleRecruitLegionCount / '
     'lifestealRate），其余 unit 域字段一律走 addRate 分支。'),
    ('差距 4 · 两个 behaviorKey 没注册',
     '101003 追踪导弹要 homing_missile、101004 镭射死光要 on_cast_beam。SKILL_BEHAVIORS 现在只有 7 种'
     '（empowered_attack / multi_projectile / periodic_damage / on_hit_status / skill_params / '
     'passive_status / on_cast_end_spawn_zone），两个都得新增并注册到 ZCSkillRuntimeRegistry。'
     '落点爆炸不用新写：复用 ZCGroundZoneSystem 的一次性区域（zoneDuration 取 0.1s 只结算一波）；'
     '直线贯通判定也不用新写几何：长度取 ZCTargetingSystem.attackReach，按到这条线的垂直距离筛目标。'),
    ('差距 5 · 101001 的多发要用 bulletNum（增量），不能写 projectileCount',
     'ZCAttackResolutionSystem:413 的注释写得很清楚：pvpAttrMap.bulletNum 是「增量」，正数多打几发、'
     '负数少打几发、下限 1，最后 Math.round(projectileCount + bulletNumFlat)。'
     'STAT_TO_PATCH 只登记了 bulletNum / bulletAngle，projectileCount 没有 flat 映射 —— '
     '写成 projectileCount 会静默不生效。所以设计案 P 列写 bulletNum add=1/1/2'
     '（L1/L2 各多发 1 发共 2 发，L3 多发 2 发共 3 发）。'
     'bulletAngle 是总张角、只在发数 > 1 时生效（:503 半张角 = bulletAngle/2），配 12° 即每发偏 6°。'),
    ('差距 6 · 101002 的「命中附加」不能用 impactDamageRate',
     'ZCAttackResolutionSystem:403 的 skillDamageRate 只在 empowered 分支里读 '
     'skillRuntime.parameters.impactDamageRate，普通普攻读的是 pvpSkill.damageRate。'
     '所以「每一次命中都附加 50%」必须走 unit 域 damageRate（operation=addRate、value=0.50 → '
     'damageRatePct=50 → 最终 ×1.50，见 :95）；用 impactDamageRate 只会让强化那一击变强。'
     '设计案第 49 行的 N / P 列已按这个口径改写。'),
    ('差距 7 · 101004 L3 的「受到治疗降低 50%」现在落不了地',
     'ZCUnitStatPatch 里没有受治疗类字段，ZCStatusResolutionSystem.healUnit 也只是 '
     'target.hp = min(maxHp, hp + amount)，没有任何修正钩子。两条路：'
     '① 新增 statId healTakenRate（改 ZCStatSchema 的联合类型 + STAT_IDS + STAT_TO_PATCH，'
     '消费点加在 healUnit 里，约 10 行）；'
     '② 把 L3 换成现有字段能表达的减益，例如 attackSpeedPct = -25（攻速降低 25%，持续 4 秒）。'
     '建议先走 ②，等确有「禁疗」需求再上 ①。'),
    ('差距 8 · 解锁等级与设计案不一致（已按线上改齐）',
     '线上 101001 是 0/14/22、101002 是 0/16/23、101003 是 9/18/24、101004 是 0/20/25。'
     '设计案第 50 / 51 行原来按 0/16/23 写，本轮已改成与线上一致（K/L/M 括号里的「兵种 X 级」）。'
     '101004 在 0 级就解锁看着偏早，但那是既有配置；真要挪只改 armySkillLevelUp 的 unlockarmylevel，'
     '不动其他字段，也不影响本轮任何数值。'),
    ('差距 9 · 美术全是复用，没有一张专属资源',
     'find assets -iname "*镭射*" 是空的，projectiles 下 49 个预制里也没有镭射飞龙。'
     '所以 201001 用 风法师_绿风（8 帧青色月牙）占位 —— 月牙风刃与「细光束」形态并不一致，'
     '这是本轮按「不改美术」做的取舍；101003 的导弹体、101004 的死光柱也全靠 风法师_绿风 拉伸 + 缩放。'
     '正式资源到位后只改 pvpSkill.effectPrefabPath 一处，不动逻辑。'
     '另外 pvpCard.unitPrefabPath 是 skel/火龙果/火龙果 —— 68010 的本体模型是火龙果骨架，'
     '也没有独立的「镭射飞龙」预制。'),
    ('数值自查 · 101003 的倍率超预算 4~5 倍（建议回写主表）',
     '面板 120 攻 / 1.8s 间隔 = 66.7 伤害每秒（即 100%/s）。按设计案现值：'
     'L1 = 3×(300%+100%) = 1200% ÷ 12s = 100%/s，等于 +150% 面板 ⇒ 约 150 VP，正好是金卡一条的预算；'
     '但 L2 = 4×(500%+200%) = 2800% ÷ 12s = 233%/s ⇒ 约 350 VP；'
     'L3 = 5×(800%+300%) = 5500% ÷ 12s = 458%/s ⇒ 约 690 VP。'
     '同为金卡主动的「暴风」（椰蛋战士 100504）满级才 100 VP 量级。两个修法：'
     '① 保 12s 冷却、把倍率压成 直击 100/140/180% + 爆炸 40/60/80%'
     '（L3 单目标 1300% ÷ 12s = 108%/s ⇒ 约 162 VP）；'
     '② 保 300/500/800 的倍率、把冷却拉到 55s 左右。建议 ①。'),
    ('数值自查 · 101004 单目标偏弱、多目标才吃满（可以接受）',
     '累计 8 次普攻 ≈ 14.4s。L3 320% 打 1 个目标 = 22%/s ⇒ 约 33 VP，偏弱；'
     '打 3 个 = 67%/s ⇒ 约 100 VP；打 5 个 = 111%/s ⇒ 约 167 VP。'
     '贯穿型本来就是这个形状，团战里站桩密度足够，所以不建议动数值；验收时按「命中 3 个目标」为基线即可。'
     '若一定要让单目标也有价值，可加「每多命中一个目标伤害 ×0.85 递减」，但那是新增逻辑，本轮不做。'),
    ('落地顺序建议',
     '① armySkillLevelUp 改 12 行文案（零风险、可单独上）；'
     '② pvpSkill 建 30717（普攻）/ 30841（镭射死光）/ 30842（追踪导弹），'
     '30717 挂 empoweredEvery=8 + empoweredSkillId=30841 + secondarySkillId=30842 + cooldown=12；'
     '③ pvpSkillPlan 建 12 行（101004 的 8/7/6 次可走 statId=empoweredEvery 分档，'
     '101003 的冷却可走 plan 行 cooldown 列分档）；'
     '④ 注册 homing_missile / on_cast_beam；⑤ 接特效（全是复用，改 effectPrefabPath 即可）。'
     '①~③ 不改代码就能做，④ 是唯一的代码改动。'),
]

# ------------------------------------------------------------------ 本次改动说明
NOTE_MARK = '镭射飞龙（68010）· 设计案描述补齐 · 2026-10-30'
NOTES = [
    ('做了什么',
     '把 68010 在【技能设计案 (2)】第 47~51 行的空缺补齐：201001 镭射能量线（普攻）、101001 孢子弹幕、'
     '101002 裂变凿击、101003 追踪导弹、101004 镭射死光，五条技能的名字、L1/L2/L3、技能详述、'
     '表现描述、落地口径全部写满。之前 101003 的 K/L/M/N/P 是空的、O 列还把数值写进了表现描述；'
     '201001 的 O 列照抄了风法师风刃；101004 的 P 列指向一个并不存在的资源名。'),
    ('补了什么（最实质的两条）',
     '① 101003 原来只叫「亡灵母舰」、没有可落地的机制，现在整条重写为「追踪导弹」：3/4/5 枚弧线弹、'
     '各自锁定一个目标、直击 + 落点爆炸两段独立结算、目标不足时补位不空放，并写明它需要新行为 homing_missile。'
     '② 101004 补上了「贯穿全场、不限命中数」的判定形状与 L3 的减益，并写明需要新行为 on_cast_beam。'),
    ('改了一个名字',
     '101003「亡灵母舰」→「追踪导弹」。原名是旧设计（投放骷髅弓箭手与骷髅战士），与现在的导弹机制完全不搭。'),
    ('纠正了两处「照着写会静默不生效」',
     '① 101001 的多发原来写成 skillParamJson 的 bulletNum，实际只有 bulletNumFlat 有映射、而且是增量口径，'
     'projectileCount 根本没有映射；已改成 unit 域 bulletNum add=1/1/2。'
     '② 101002「命中附加伤害」原来挂 impactDamageRate，那个参数只在强化那一击被读；'
     '已改成 unit 域 damageRate addRate=0.50/0.64/0.78（全命中生效）。'),
    ('对齐了 101003 / 101004 的解锁等级',
     '设计案原按 0/16/23 写，线上分别是 9/18/24 与 0/20/25，已改成与线上一致（不动配置）。'),
    ('新增了一条待拍板',
     '101004 L3 的「受到治疗降低 50%」在现有字段里落不了地 —— ZCUnitStatPatch 没有受治疗字段，'
     'healUnit 也没有修正钩子。两条路写在【技能实现改动明细】差距 7，建议先换成 attackSpeed 减益。'),
    ('没有做什么',
     '没改任何配置 json、没改代码、没动 68010 的面板数值（攻 120 / 血 1200 / 射程 550 / 间隔 1.8），'
     '也没动其他 34 张卡。本轮只写文档。'),
    ('下一步',
     '配置侧差距共 9 条，全在【技能实现改动明细】最后一节。按落地顺序 ①~③ 不改代码就能做'
     '（改 armySkillLevelUp 文案、建 30717 / 30841 / 30842、建 12 条 plan 行），'
     '④ 只有注册 homing_missile / on_cast_beam 要动代码。另外 101003 的倍率建议回写一档'
     '（现值超预算 4~5 倍），等你点头再改 K/L/M。'),
]


def trim_from(ws, marker, marker_col=1):
    """从首个以 marker 开头的行删到表尾，返回该行号（找不到则返回 max_row+1）。"""
    for row in range(2, ws.max_row + 1):
        if str(ws.cell(row, marker_col).value or '').startswith(marker):
            if row <= ws.max_row:
                ws.delete_rows(row, ws.max_row - row + 1)
            return row
    return ws.max_row + 1


def need(text, old, new, tag):
    if old not in text:
        raise SystemExit('第 %s 处替换失败：单元格里找不到待替换片段\n%r' % (tag, old[:60]))
    return text.replace(old, new, 1)


def set_level(text, level, tag):
    pattern = re.compile(r'（兵种\s*\d+\s*级）')
    if not pattern.search(text or ''):
        raise SystemExit('第 %s 处替换失败：找不到「（兵种 X 级）」' % tag)
    return pattern.sub('（兵种 %d 级）' % level, text, count=1)


def fit(text, width_chars):
    """按合并宽度估行高（14.5 磅一行 + 5 磅内边距）。中文字按 2 个宽度单位算，所以直接给字符数上限。"""
    lines = max(1, math.ceil(len(text) / max(1.0, width_chars)))
    return round(lines * 14.5 + 5, 1)


def main():
    wb = load_workbook(PATH)
    design = wb[SHEET]

    # ------- 守卫：行号漂移就别写
    for row, (sid, name) in GUARD.items():
        got_sid = str(design.cell(row, 7).value)
        got_name = design.cell(row, COL_NAME).value
        if got_sid != str(sid) or got_name != name:
            raise SystemExit('第 %d 行不是 %s %s（实为 %s %s），行号已漂移，先核对再写'
                             % (row, sid, name, got_sid, got_name))

    # ------- 1. 主表更正
    p48 = design.cell(48, COL_LANDING).value or ''
    if P48_OLD_HEAD in p48:
        design.cell(48, COL_LANDING).value = P48_NEW
    elif 'bulletNum add=1/1/2' not in p48:
        raise SystemExit('第 48 行 P 列既不是旧写法也不含新写法，先人工确认')

    design.cell(49, COL_MECH).value = N49_NEW
    design.cell(49, COL_LANDING).value = P49_NEW

    for row, levels in LEVEL_FIX.items():
        for col, level in zip((11, 12, 13), levels):
            design.cell(row, col).value = set_level(design.cell(row, col).value, level,
                                                    '%d/%d' % (row, col))

    p50 = design.cell(50, COL_LANDING).value or ''
    if '独立技能读不到' not in p50:
        design.cell(50, COL_LANDING).value = p50.rstrip('。；; ') + P50_TAIL

    p51 = design.cell(51, COL_LANDING).value or ''
    if '差距 7' not in p51:      # 原文里已经出现过 healTakenRate，只能用标记判断
        design.cell(51, COL_LANDING).value = p51.rstrip('。；; ') + P51_TAIL

    # ------- 2. 技能实现改动明细
    detail = wb['技能实现改动明细']
    start = trim_from(detail, '镭射飞龙 68010')
    r = start
    detail.cell(r, 1).value = DETAIL_MARK
    detail.cell(r, 1).font = H1
    detail.cell(r, 1).fill = HEAD_FILL
    detail.merge_cells(start_row=r, start_column=1, end_row=r, end_column=11)
    detail.row_dimensions[r].height = 24
    r += 1
    body_width = 246 / 2.1          # B:G 合并宽度按中文字符数折算
    for label, text in DETAIL:
        c1 = detail.cell(r, 1)
        c1.value = label
        c1.font = LABEL
        c1.alignment = Alignment(wrap_text=True, vertical='top')
        c2 = detail.cell(r, 2)
        c2.value = text
        c2.font = BODY
        c2.alignment = Alignment(wrap_text=True, vertical='top')
        detail.merge_cells(start_row=r, start_column=2, end_row=r, end_column=7)
        detail.row_dimensions[r].height = fit(text, body_width)
        r += 1
    detail_end = r - 1

    # ------- 3. 本次改动说明
    note = wb['本次改动说明']
    n0 = trim_from(note, '镭射飞龙（68010）')
    r = n0
    note.cell(r, 1).value = NOTE_MARK
    note.cell(r, 1).font = H1
    note.cell(r, 1).fill = HEAD_FILL
    note.merge_cells(start_row=r, start_column=1, end_row=r, end_column=9)
    note.row_dimensions[r].height = 24
    r += 1
    note_width = 108 / 2.1
    for label, text in NOTES:
        c1 = note.cell(r, 1)
        c1.value = label
        c1.font = LABEL
        c1.alignment = Alignment(wrap_text=True, vertical='top')
        c2 = note.cell(r, 2)
        c2.value = text
        c2.font = BODY
        c2.alignment = Alignment(wrap_text=True, vertical='top')
        note.merge_cells(start_row=r, start_column=2, end_row=r, end_column=9)
        note.row_dimensions[r].height = fit(text, note_width)
        r += 1
    note_end = r - 1

    frozen = design.freeze_panes
    wb.save(PATH)
    wb2 = load_workbook(PATH)
    wb2[SHEET].freeze_panes = frozen or 'K1'
    wb2.save(PATH)

    print('[ok] 主表：48/49 的 P、49 的 N 已按代码口径改写；50/51 解锁等级已对齐线上；'
          '50/51 的 P 各追加一条警示')
    print('[ok] 技能实现改动明细：第 %d~%d 行（%d 条）' % (start, detail_end, len(DETAIL)))
    print('[ok] 本次改动说明：第 %d~%d 行（%d 条）' % (n0, note_end, len(NOTES)))
    print('[ok] 冻结窗格：%s' % (frozen or 'K1'))


if __name__ == '__main__':
    try:
        main()
    except PermissionError:
        raise SystemExit('写入失败：技能设计案2.xlsx 正被 Excel 占用，关闭文档后重跑本脚本')
