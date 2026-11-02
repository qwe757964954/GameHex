# -*- coding: utf-8 -*-
"""运动霸（68033）普攻按「203301 拳击冲撞」重做 · 设计案回写。

四件事：
  1. `技能设计案 (2)` 第 162 行的 O 列（表现描述）按**真实资源**重写（原文只有「气浪」这种概念词）；
  2. 同一行的 P 列（落地口径）原来是**空的**，这次填满 —— 冲刺距离怎么换算、倍率乘在哪、
     气浪是哪条事件、受击特效为什么和设计案写的「坦克」对不上；
  3. `表现资源映射` 第 70 行 68033 的说明补上「气浪 = 践踏」；
  4. `技能实现改动明细` / `本次改动说明` 页尾各追加一节。

⚠️ openpyxl 另存会把冻结窗格掉成默认值，存完必须写回（主表当前是 N1）。
⚠️ 若 Excel 正开着这个文件，save 会抛 PermissionError —— 捕获后提示关文档即可。
⚠️ **追加位置是页尾**：`trim_from` 会从本节标题一直删到工作表末尾，所以重跑本脚本
会把「之后又追加的那几节」一起删掉。重跑请按时间顺序（本脚本 → 后来的脚本），
或者先把后面的节手工搬走。
⚠️ 每节都可重跑：先按首行标记裁掉上一次追加的行，再写。
"""

import math

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

PATH = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'

SHEET = '技能设计案 (2)'
ROW = 162
COL_NAME, COL_SKILL, COL_SHOW, COL_LANDING = 8, 7, 15, 16

H1 = Font(name='微软雅黑', size=13, bold=True, color='FF1F3864')
LABEL = Font(name='微软雅黑', size=10, bold=True, color='FF2E5C8A')
BODY = Font(name='微软雅黑', size=10)
HEAD_FILL = PatternFill('solid', fgColor='FFDCE6F1')

SHOW_NEW = (
    '【P1 沿用】出手 消灭学霸_普攻（units/projectiles/消灭学霸_普攻，15 帧拳套冲击，贴出手点）；'
    '命中 受击 + 气浪（复用 重骑兵_践踏，9 帧地面冲击环，压在受击点、走地面层）；'
    '开始冲刺时把移动动作换成循环的攻击动作，冲刺结束（进射程）立刻回跑动 / idle。'
    '⚠️ 受击特效在代码里按**攻击方职业**取（ZCGameLoader 的 HIT_FX_DIRECTORY，四职业各一组），'
    '68033 的职业是战士 ⇒ 实际播的是「战士受击」，与这里写的「受击(坦克)」不一致。'
    '要强制某个技能播指定职业的受击，得给 pvpSkill 再加一列 per-skill 覆盖，等拍板。'
)

LANDING_NEW = (
    'pvpSkill 30713「运动霸普攻」（= 设计案 203301 拳击冲撞）：mode=melee、弹速 0、cooldown=14、'
    'trigger=every_seconds、empoweredSkillId=30853（天外飞石）、secondarySkillId=30852（能量光束）、'
    'effectPrefabPath=消灭学霸_普攻；本轮新增三列 —— '
    'chargeDistance=120、chargeSpeedScale=4、impactEffectPrefabPath=units/projectiles/重骑兵_践踏/重骑兵_践踏。'
    '\n判定口径：chargeReach = (120 + 目标碰撞半径) × combatDistanceScale(0.3)。'
    '表里多数单位 bodyRadius 还是 0 ⇒ 36 世界单位，约 1 个六角格宽（≈92 视图像素）；'
    '进了这个圈就把 ZCMovementSystem 三条推进的步长再乘 4，出圈立刻回原速（不做滞回）。'
    '从 36 走到近战射程 13.5 的那 22.5 世界单位：原速 25 要 0.90s，冲刺 100 只要 0.225s。'
    '\n表现口径：冲刺期间 ZCUnitSystem 每帧置 unit.charging=true，ZCUnitView 据此把 moveClip 换成 '
    'attackClip —— spine 的 setAnimation(0, name, true) 本身就是循环，不需要额外开 loop。'
    '气浪由 ZCAttackResolutionSystem 在命中事件之后**补推**一条 type=area、damage=0 的事件'
    '（area 在 zcCombatEffectLayerOf 里归地面层，所以压在角色脚下而不是糊在脸上），只影响画面、'
    '不重复结算伤害。\n注意：冲刺倍率与 moveSpeed、卡组加成、冰冻减速是**相乘**关系，'
    '所以「被冻住的运动霸冲锋」依旧比正常冲刺慢 —— 这是有意的，冲刺不该免疫减速。'
)


def trim_from(ws, marker, marker_col=1):
    """从首个以 marker 开头的行删到表尾，返回该行号（找不到则返回 max_row+1）。"""
    for row in range(2, ws.max_row + 1):
        if str(ws.cell(row, marker_col).value or '').startswith(marker):
            if row <= ws.max_row:
                ws.delete_rows(row, ws.max_row - row + 1)
            return row
    return ws.max_row + 1


def fit(text, width_chars):
    lines = max(1, math.ceil(len(text) / max(1.0, width_chars)))
    return round(lines * 14.5 + 5, 1)


def write_block(ws, start_mark, rows, merge_to, width_chars):
    r = trim_from(ws, start_mark)
    # 上次追加留下的空行（openpyxl 的 delete_rows 会把行高/合并样式留在原位，形成一串
    # 全空的幽灵行）。往上收掉，否则每跑一次就在两节之间多一条白带。
    while r > 2 and all(ws.cell(r - 1, col).value in (None, '') for col in range(1, merge_to + 1)):
        ws.delete_rows(r - 1, 1)
        r -= 1
    ws.cell(r, 1).value = start_mark
    ws.cell(r, 1).font = H1
    ws.cell(r, 1).fill = HEAD_FILL
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=merge_to)
    ws.row_dimensions[r].height = 24
    head = r
    r += 1
    for label, text in rows:
        c1 = ws.cell(r, 1)
        c1.value = label
        c1.font = LABEL
        c1.alignment = Alignment(wrap_text=True, vertical='top')
        c2 = ws.cell(r, 2)
        c2.value = text
        c2.font = BODY
        c2.alignment = Alignment(wrap_text=True, vertical='top')
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=merge_to)
        ws.row_dimensions[r].height = fit(text, width_chars)
        r += 1
    # 尾巴上的幽灵行：openpyxl 的 delete_rows 只搬单元格的值，**不搬 `row_dimensions`**，
    # 而保存时每个 `row_dimensions` 条目都会吐一个 `<row>` 标签 ⇒ 删过的行会以
    # 「空行 + 旧行高」的形式留下，`max_row` 因此不缩、表格尾部多出一段白带。
    # 两件事一起做：先清掉超出末行的行高条目，再按需删行。
    last = r - 1
    for key in [k for k in ws.row_dimensions if k > last]:
        del ws.row_dimensions[key]
    while ws.max_row > last and all(
            ws.cell(ws.max_row, col).value in (None, '') for col in range(1, merge_to + 1)):
        ws.delete_rows(ws.max_row, 1)
    # 真正让行「复活」的是**合并区间**：`delete_rows` 会搬值、搬行高，却把已经删掉那批行的
    # `B{n}:G{n}` 合并留在 `merged_cells` 里，保存时 openpyxl 又按这些区间把行标签写回去。
    # 所以最后还要把落在末行之后的合并区间摘掉。
    for rng in [item for item in ws.merged_cells.ranges if item.min_row > last]:
        ws.merged_cells.ranges.remove(rng)
    return head, last


DETAIL_MARK = '运动霸 68033 · 普攻按「拳击冲撞」重做：冲刺 + 气浪（2026-10-31）'
DETAIL = [
    ('结论',
     '设计案第 162 行的普攻（203301 拳击冲撞）原来只有「近战攻击 + 消灭学霸_普攻」是落地的，'
     '「距离敌人 120px 开始冲刺、冲刺期移速 ×4」完全没实现（代码里连冲锋/冲刺的概念都不存在），'
     '「气浪」也没有任何执行口径（P 列是空的）。本轮补上三件事：'
     '两个新的移动参数、一个由参数派生的动画状态、一条命中附加表现事件。'),
    ('设计案原文 → 落地拆解',
     '「挥拳冲撞当前目标，近战判定，命中结算 1 次伤害」→ 不变，30713 本来就是 melee 单体、'
     '一次出手一条事件一次扣血。'
     '「距离敌人 120px 时开始冲刺」→ pvpSkill.chargeDistance=120，判定式 '
     'chargeReach=(120+目标碰撞半径)×0.3。'
     '「冲刺阶段的移动速度 *4」→ pvpSkill.chargeSpeedScale=4，乘进 ZCMovementSystem 的步长。'
     '「命中 气浪」→ pvpSkill.impactEffectPrefabPath=重骑兵_践踏，命中后补一条表现事件。'
     '「开始冲刺时播放循环的攻击动作」→ unit.charging 派生标记，视图换 attackClip。'),
    ('120px 到底多远（这决定数值合不合理）',
     '规则表的 combatDistanceScale=0.3，所以 120px（设定口径，与 attackRange 同一套）'
     '= 36 世界单位；而 1 个六角格的视图像素宽是 92.25，逻辑列步是 36 ⇒ 1 世界单位 ≈ 2.56 视图像素。'
     '两者合起来：120px 设定 ≈ 92 视图像素 ≈ 正好一个格宽。也就是「隔壁格子的敌人」就触发冲锋。'
     '从触发点走到近战射程（(45+0)×0.3=13.5）要跑 22.5 世界单位：原速 25 需 0.90s，'
     '冲刺 100 只需 0.225s —— 约 7 帧（30fps），肉眼可辨但不会「瞬移」。'),
    ('为什么新增 pvpSkill 三列，而不是在代码里写死 68033',
     '写死就是给一张卡开特例：以后僵尸阵营再出一张「冲撞型」战士，还得回来改代码。'
     '三列都是策划会调的东西（多远开始冲、冲多快、命中多一个什么特效），'
     '留在表里才能被后续 35 张卡复用。代价是 pvpSkill 加了 S/T/U 三列，'
     '解析层用 optionalPositiveNumber / assetPath 读，缺省一律 undefined ⇒ 存量 75 行行为逐字不变'
     '（tests/zcds-charge.test.ts 有一条专门守「别的行不许被带上冲刺/气浪」）。'),
    ('冲刺倍率为什么乘在 ZCMovementSystem 里',
     '单位推进有三条路：同格追击 advanceTowardUnit、跨格寻路 advanceUnitMovement、'
     '自由行军 advanceMarch，三者各自算 step = moveSpeed × deck 加成 × 冰冻 × dt。'
     '把倍率乘在函数入参上（speedScale，默认 1）而不是改 moveSpeed，'
     '好处是「原速」这件事只有一处真源：卡表、加成、状态都还是它们自己，冲刺只是一层临时系数。'
     '默认参数 1 让 34 张卡的调用点一个字都不用改。'),
    ('charging 为什么是每帧派生的，不是持久状态',
     '它完全由「当前距离」决定：进圈就冲、出圈就停。做成持久字段要额外处理'
     '「目标换人 / 目标瞬移 / 被击退 / 被硬控」的失效时机，而每帧算一次只是一次 hypot。'
     '所以 ZCUnitSystem 每帧先 unit.charging=false，只有 move 分支可能重新置真；'
     '阵亡 / 被控那一帧也能立刻落回 false（否则尸体会停在出拳姿势上）。'
     '字段本身不进快照语义 —— ZCSnapshotCodec 不解码它，回放也不依赖它。'),
    ('气浪为什么复用「重骑兵_践踏」',
     'find assets -iname "*气浪*" 是空的：项目里没有叫「气浪」的美术。'
     '【表现资源映射】里 P6「地面·冲击环」= 重骑兵_践踏（9 帧、暗红环形冲击）正好是这个形态，'
     '而且 area 事件在 zcCombatEffectLayerOf 里归 ground 层，压在角色脚下而不是糊在脸上，'
     '层次就是气浪该有的。将来美术给了专属气浪，只改 pvpSkill 这一格，不动代码。'),
    ('一个对不上的地方（需要拍板）',
     '设计案 O 列写「命中 受击(坦克)」，但受击特效是按**攻击方职业**播的：'
     'ZCGameLoader 只加载 units/effects/受击特效/<职业>受击 四组，运行时按攻击方的 traits.attack 取。'
     '68033 是战士 ⇒ 实际播「战士受击」。三种处理：'
     '① 就按战士受击（默认，零改动）；② 设计案改成「受击(战士)」；'
     '③ 给 pvpSkill 再加一列 hitFxTrait 做 per-skill 覆盖（约 20 行代码）。'
     '本轮按 ① 落地，O 列已把这件事写清楚。'),
    ('没做什么',
     '没动任何数值：攻击 120、移速 25、射程 45、间隔 1.8、出手 0.667s、命中点 0.345s 全部原样；'
     '没动 empoweredSkillId(30853 天外飞石) / secondarySkillId(30852 能量光束) 两条既有主动链；'
     '也没动 103303 能量光束 / 103304 天外飞石 自己的实现（它们仍待做）。'),
    ('验证',
     'tests/zcds-charge.test.ts 15 条全绿：chargeReach 数学（含「不走 120 射程打 9 折那条」）、'
     '倍率四类边界（没配距离 / 没配倍率 / 倍率 1 / 目标已死 / 同阵营）、'
     'advanceTowardUnit 与 advanceUnitMovement 的 4 倍位移、冲刺不冲过头、'
     '状态机传参与 charging 置真/复位、气浪事件的类型/坐标/0 伤害/唯一 id、'
     '配表只有 30713 有这三列、气浪预制存在、解析层三个字段。'
     '全量 zcds 用例 1045 条 / 977 绿 / 68 红，68 条与改动前逐条一致（既有历史问题）。'),
]

NOTE_MARK = '运动霸（68033）· 普攻重做成「拳击冲撞」· 2026-10-31'
NOTES = [
    ('做了什么',
     '把 68033 的普攻从「只会走到脸上挥拳」补成设计案写的「拳击冲撞」：'
     '距敌 120px 开始冲刺、冲刺期移速 ×4、冲刺时循环播攻击动作、命中多叠一圈气浪。'
     '命中判定与伤害没变（仍是近战单体、一次出手一次扣血）。'),
    ('改了三张表的两处',
     'pvpSkill 新增三列（冲刺距离 / 冲刺速度倍率 / 命中附加特效），只有 30713 填了 120 / 4 / 重骑兵_践踏；'
     '其余 75 行三列留空、行为逐字不变。Excel 的 `PVP-技能.xlsx` 同步加了 S/T/U 三列表头与说明。'),
    ('为什么「120px」不是随便写的',
     '按 combatDistanceScale 0.3 换算是 36 世界单位 ≈ 一个六角格宽（92 视图像素）。'
     '也就是「隔壁格的敌人」就起冲，从起冲到贴身只要 0.225 秒 —— 玩家看得见加速，又不会觉得瞬移。'),
    ('一个必须说明的偏差',
     '设计案写「命中 受击(坦克)」，但受击特效按攻击方职业播，68033 是战士 ⇒ 实际是「战士受击」。'
     '本轮没为此加特例，在 O 列写清了；要改的话三条路都写在【技能实现改动明细】里。'),
    ('没做什么',
     '没动任何数值与既有技能链（天外飞石 / 能量光束 照旧）；'
     '没给 103303 能量光束、103304 天外飞石 补实现，那两条仍挂着。'),
    ('验证',
     '新增 tests/zcds-charge.test.ts 15 条，全绿。全量 zcds 用例 1045 条 / 977 绿 / 68 红，'
     '68 条与改动前逐条一致。'),
]


def main():
    wb = load_workbook(PATH)
    design = wb[SHEET]

    # ------- 守卫
    got_sid = str(design.cell(ROW, COL_SKILL).value)
    got_name = design.cell(ROW, COL_NAME).value
    if got_sid != '203301' or got_name != '拳击冲撞':
        raise SystemExit('第 %d 行不是 203301 拳击冲撞（实为 %s %s），行号已漂移，先核对'
                         % (ROW, got_sid, got_name))

    old_show = design.cell(ROW, COL_SHOW).value or ''
    if '气浪' not in old_show:
        raise SystemExit('第 %d 行 O 列不含「气浪」，内容已变，先人工核对：%r' % (ROW, old_show[:60]))
    design.cell(ROW, COL_SHOW).value = SHOW_NEW

    old_landing = design.cell(ROW, COL_LANDING).value
    # 空 ⇒ 首次写；以本次的开头字样打头 ⇒ 上次已经写过，覆盖成同一份（幂等）；
    # 其它内容 ⇒ 有人手写过，停下来别覆盖。
    if old_landing not in (None, '') and not str(old_landing).startswith('pvpSkill 30713「运动霸普攻」'):
        raise SystemExit('第 %d 行 P 列已被别人填过（%r），先人工核对再覆盖'
                         % (ROW, str(old_landing)[:60]))
    design.cell(ROW, COL_LANDING).value = LANDING_NEW

    # ------- 表现资源映射
    mp = wb['表现资源映射']
    row_no = 70
    if str(mp.cell(row_no, 1).value) != '68033' or mp.cell(row_no, 2).value != '运动霸':
        raise SystemExit('表现资源映射第 %d 行不是 68033 运动霸，先核对' % row_no)
    mp.cell(row_no, 6).value = '15 帧，拳套冲击；命中另叠 units/projectiles/重骑兵_践踏 当气浪'

    # ------- 明细 / 说明
    detail = wb['技能实现改动明细']
    d0, d1 = write_block(detail, DETAIL_MARK, DETAIL, merge_to=7, width_chars=246 / 2.1)
    note = wb['本次改动说明']
    n0, n1 = write_block(note, NOTE_MARK, NOTES, merge_to=9, width_chars=108 / 2.1)

    frozen = design.freeze_panes
    wb.save(PATH)
    wb2 = load_workbook(PATH)
    wb2[SHEET].freeze_panes = frozen or 'N1'
    wb2.save(PATH)

    print('[ok] 主表第 %d 行：O 列已重写、P 列已填满（原为空）' % ROW)
    print('[ok] 表现资源映射第 %d 行：气浪口径已补' % row_no)
    print('[ok] 技能实现改动明细：第 %d~%d 行（%d 条）' % (d0, d1, len(DETAIL)))
    print('[ok] 本次改动说明：第 %d~%d 行（%d 条）' % (n0, n1, len(NOTES)))
    print('[ok] 冻结窗格：%s' % (frozen or 'N1'))


if __name__ == '__main__':
    try:
        main()
    except PermissionError:
        raise SystemExit('写入失败：技能设计案2.xlsx 正被 Excel 占用，关闭文档后重跑本脚本')
