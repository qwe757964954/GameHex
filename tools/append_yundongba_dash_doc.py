# -*- coding: utf-8 -*-
"""运动霸（68033）冲刺第二次改口径 · 设计案回写（2026-11-03）。

这轮用户口径（逐字）：
  「城墙 / 建筑目标也需要走冲刺，撞到就停止，撞到单位目标也会停止，
    冲刺是运动霸的普通攻击，每次普通攻击都会有 0.7 秒的冷却时间，
    冷却时间静止在原地播放待机动作」

⚠️ 设计案主表第 162 行还停在 **2026-10-31** 的旧口径（「120px 起冲、冲刺期移速 ×4」）——
   2026-11-02 的「真·撞击」那次只改了表和代码，没回写文档。所以本脚本一次把三件事补齐：
     ① 120px → 220px、移速倍率 → 真·撞击（撞不到零伤害）；
     ② 城墙 / 建筑也走冲刺，撞到即停；
     ③ 0.7s 原地待机（＝ pvpCard 68033.unitAttackInterval 由 1.8 改成 0.7）。

改到的地方：
  1. `技能设计案 (2)` 第 162 行：J 列触发参数 1.8 → 0.7、N 列详述、O 列表现、P 列落地口径；
  2. `技能伤害测算` 第 164 行 G 列（触发参数）同步 0.7 —— 该页公式只算「单发伤害」，不引用 G 列，
     但留 1.8 会跟主表各说各话；
  3. `技能实现改动明细` / `本次改动说明` 页尾各追加一节。

⚠️ openpyxl 另存会把冻结窗格掉成默认值，存完必须写回（主表当前是 N1）。
⚠️ 若 Excel 正开着这个文件，save 会抛 PermissionError —— 捕获后提示关文档即可。
⚠️ 追加位置是页尾：`trim_from` 从本节标题一直删到工作表末尾，重跑本脚本会把「之后又追加的节」
   一起删掉。本脚本是当前最后一节，重跑安全（先按首行标记裁掉上次追加的行，再写）。
"""

import math

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

PATH = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'

SHEET = '技能设计案 (2)'
ROW = 162
COL_NAME, COL_SKILL, COL_TRIGGER, COL_MECH, COL_SHOW, COL_LANDING = 8, 7, 10, 14, 15, 16

MEASURE_SHEET = '技能伤害测算'
MEASURE_ROW = 164
MEASURE_COL_TRIGGER = 7

H1 = Font(name='微软雅黑', size=13, bold=True, color='FF1F3864')
LABEL = Font(name='微软雅黑', size=10, bold=True, color='FF2E5C8A')
BODY = Font(name='微软雅黑', size=10)
HEAD_FILL = PatternFill('solid', fgColor='FFDCE6F1')

TRIGGER_NEW = 0.7

MECH_NEW = (
    '挥拳冲撞当前目标：距敌 220px 起手，锁定目标**当时**的位置直线冲过去（冲出去就收不回来，'
    '中途不再改道）；近战判定，撞到才算命中、结算 1 次伤害。'
    '撞到单位、撞到城墙、撞到建筑都**当场停在接触点**；一路没撞到（目标让开 / 提前跑到终点）'
    '＝冲空，一分伤害都没有。'
    '冲刺就是这段普攻本身：撞上或冲空之后都有 0.7 秒冷却，冷却期间静止在原地播待机动作，'
    '冷却结束再冲下一拳。'
)

SHOW_NEW = (
    '【P1 沿用】出手 消灭学霸_普攻（units/projectiles/消灭学霸_普攻，15 帧拳套冲击，贴出手点）；'
    '命中 受击 + 气浪（复用 重骑兵_践踏，9 帧地面冲击环，压在受击点、走地面层）。'
    '冲刺期间把移动动作换成**循环的攻击动作**；撞上 / 冲空立刻收招回待机，'
    '接下来 0.7 秒原地播**待机动作**（不是出拳），冷却结束再起冲。'
    '⚠️ 受击特效在代码里按**攻击方职业**取（ZCGameLoader 的 HIT_FX_DIRECTORY，四职业各一组），'
    '68033 的职业是战士 ⇒ 实际播的是「战士受击」，与这里写的「受击(坦克)」不一致。'
    '要强制某个技能播指定职业的受击，得给 pvpSkill 再加一列 per-skill 覆盖，等拍板。'
)

LANDING_NEW = (
    'pvpSkill 30713：chargeDistance=220、chargeSpeedScale=4；'
    'pvpCard 68033.unitAttackInterval=0.7（＝冲刺即普攻）。'
    '起手 (220+目标半径)×0.3；撞第一个进圈的单位 / 城墙 / 建筑，停在接触点结算 1 次，'
    '冲空零伤害，收场后待机 0.7s。'
    '细节见【技能实现改动明细】同名节。'
)

#  P 列只有 13 字宽（Q/R/S 被「克制 / 被克制 / 技能状态」占着，不能合并），
#  所以 P 写摘要、细节留在明细页；行高按**真实列宽**算，中文按 2 个宽度单位折算。
COL_WIDTHS = {COL_MECH: 50.0, COL_SHOW: 46.0, COL_LANDING: 13.0}
MAX_ROW_HEIGHT = 409.0



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


def fit_cjk(text, width_units):
    """按 Excel 列宽（宽度单位 = 1 个 '0' 宽）估行高：中文算 2 个单位，行高 14pt、封顶 409。"""
    per_line = max(4.0, width_units / 2.0)
    lines = 0
    for block in str(text).split('\n'):
        lines += max(1, math.ceil(len(block) / per_line))
    return min(MAX_ROW_HEIGHT, round(lines * 14.0 + 6, 1))


def write_block(ws, start_mark, rows, merge_to, width_chars):
    r = trim_from(ws, start_mark)
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
    last = r - 1
    for key in [k for k in ws.row_dimensions if k > last]:
        del ws.row_dimensions[key]
    while ws.max_row > last and all(
            ws.cell(ws.max_row, col).value in (None, '') for col in range(1, merge_to + 1)):
        ws.delete_rows(ws.max_row, 1)
    for rng in [item for item in ws.merged_cells.ranges if item.min_row > last]:
        ws.merged_cells.ranges.remove(rng)
    return head, last


DETAIL_MARK = '运动霸 68033 · 冲刺改成「真·撞击」+ 结构目标 + 0.7s 原地待机（2026-11-03）'
DETAIL = [
    ('结论',
     '把 68033 的普攻从「靠近就加速」彻底改成设计案里写的「挥拳冲撞」：'
     '距敌 220px 起手，锁着目标当时的位置直线冲过去，撞到才算伤害；'
     '城墙 / 建筑也走同一条冲刺路，撞到就停在接触点；'
     '冲刺就是这一拳的动作，撞上或冲空之后原地待机 0.7 秒再冲下一拳。'),
    ('上一版错在哪',
     '2026-11-01 之前：冲刺只是「距敌 chargeDistance 内把移速乘 4」，move 分支仍一路'
     'advanceTowardUnit / advanceUnitMovement 追着目标走 —— 只要进近战射程就必定结算，'
     '结构上不可能 miss，玩家也躲不掉。用户原话：「现在是会索敌的」。'
     '2026-11-02 改成真·撞击（撞不到零伤害、路径上第一个进圈的敌人），'
     '但当时留着「结构目标不走冲刺」，且冷却在**起冲**那一刻就扣掉。'
     '2026-11-03 用户把这最后两条也定了性：城墙/建筑要冲，冷却从撞上/冲空那刻算，冷却期间站着待机。'),
    ('220px 是怎么定的',
     '规则表 combatDistanceScale=0.3 ⇒ 220px = 66 世界单位；近战 reach = (45+6)×0.3 = 15.3。'
     '于是看得见的冲锋段 = 66 − 15.3 ≈ 50.7 世界单位，按 moveSpeed 25 × 4 = 100 px/s 约 0.51 秒'
     '（30fps 约 15 帧）—— 短于这就不像「冲」，长了又成了「闪现」。'
     '150px 只有 0.27 秒（8 帧），画面读不出蓄力；300px 起手点已经在两格半外，玩家来不及反应。'),
    ('为什么城墙 / 建筑也能撞',
     '结构是静止的，但它一样是「当前锁定的目标」——ZCUnitTargeting.current() 已经把合法性判完了'
     '（墙要 hasExposedWall、建筑要 hp>0 且 wallHp<=0 且 owner 合法）。'
     '所以 dashFirstHit 只是把「单位 + 当前锁定的结构」放进同一次线段扫掠，取最先接触的那个；'
     '撞到结构后把 targetWallHexId / targetBuildingHexId 写成那个地块，sendAttack 自然分流到'
     'damageWall / damageBuilding，扣血口径一点没动。'
     '结构的碰撞半径按 STRUCTURE_TARGET_BODY_RADIUS=80 算 ⇒ reach 37.5，'
     '所以是停在离地块心 37.5 处，不会钻进墙里。'),
    ('结构目标还有两个坑（已补）',
     '① dashStep 里有一道兜底「进不了敌方城墙格」——冲进目标城墙那一格时会被自己拦下并当撞墙收场，'
     '结果是原地不动、永远撞不到墙上。修法是给它放行「本次冲刺目标那一格」'
     '（unit.targetWallHexId ?? unit.targetBuildingHexId）。'
     '② 冲锋路过一面无关的墙不该被截住，所以结构只在**它是当前锁定目标**时才参与扫掠。'),
    ('0.7 秒为什么写在 unitAttackInterval 上',
     '用户口径：「冲刺是运动霸的普通攻击，每次普通攻击都会有 0.7 秒的冷却时间」——'
     '既然冲刺就是普攻，那这个 0.7 就是这张卡的攻速本身，不是「冲刺额外的惩罚」。'
     '所以没新增列：pvpCard 68033.unitAttackInterval 由 1.8 改成 0.7，'
     'nextAttackAt 仍是**唯一**一套出手时钟，快照也不用加字段。'),
    ('冷却起点从起冲挪到收场（连带补了两个洞）',
     '原来在 startDash 里写 nextAttackAt，等于一起冲就扣；0.7 秒从起冲算，'
     '撞上那一刻起其实只剩 0.2 秒待机，画面上根本看不出「站着待机」。'
     '现在改成撞上 / 到点那一刻才起算，并同时写 dashRecoverUntil（管「这 0.7 秒站住别动」）。'
     '⚠️ 连带后果：**超时兜底**和**被硬控打断**这两条以前靠「起冲扣过」蒙对，'
     '改成收场扣之后必须各自显式进冷却，漏一条就是「零成本冲锋」——硬控一解立刻再冲一次。'),
    ('为什么待机要单独一个字段',
     '只写 nextAttackAt 的话，冷却期间单位会一边等一边往目标挪（move 分支照跑）；'
     '只写 dashRecoverUntil 的话，其它流程读不到「什么时候能再出手」，容易走出第二套时钟。'
     '两个同值写入，分工是：nextAttackAt 管出手节拍、dashRecoverUntil 管站桩。'
     '冷闸的位置也讲究 —— 放在 born 之后、**索敌之前**，冷却期间连 acquire 都不做，'
     '否则「目标跑远了 → 切 move → 走过去」又变成一边等冷却一边挪窝。'),
    ('表改动',
     'pvpSkill 30713：chargeDistance 120 → 220（2026-11-02）、chargeSpeedScale=4、'
     'impactEffectPrefabPath=重骑兵_践踏（三条上一轮就加了）。'
     'pvpCard 68033：unitAttackInterval 1.8 → 0.7（本轮）。'
     '三处同写：Excel 表源（PVP-技能 S 列 / PVP-卡牌 Y 列）+ json/client + assets/remoteRef。'
     '⚠️ 写这两份 json 必须走 tools/config/ref_table_io.js：行存是紧凑单行、列存是 CRLF 竖排，'
     '拿 JSON.stringify 直接覆写会把整张表变成 diff 炸弹。'),
    ('没做什么',
     '没动 68033 的其它数值（攻击 150、移速 25、射程 45、出手 0.667s、命中点 0.345s）；'
     '没动 empoweredSkillId(30853 天外飞石) / secondarySkillId(30852 能量光束) 两条既有主动链；'
     '也没动 103303 能量光束 / 103304 天外飞石 自己的实现（仍待做）。'
     '受击特效按攻击方职业播（68033 是战士 ⇒ 播「战士受击」）这一条与设计案的「坦克受击」仍不一致，'
     '等策划拍板，本轮没加特例。'),
    ('验证',
     'tests/zcds-charge.test.ts 27 条全绿：起手距离几何、三个门槛各自失效、碰撞半径与「第一个目标」、'
     'dashStep 直线与放行目标格、placeAt 朝向、起冲 / 命中 / 冲空零伤害照吃冷却 / 路径上第一个 / '
     '冷却没好不起冲 / 硬控打断 / 超时兜底、撞城墙与撞建筑各一条（停在 37.5 处并结算一次）、'
     '结构作废不再冲、0.7s 待机期间坐标与朝向冻结、两份 pvpCard 同值、冲锋段必须短于攻速。'
     '全量 zcds 用例 997 条 / 949 绿 / 48 红，48 条与基线逐条一致（既有历史问题，零新增）。'),
]

NOTE_MARK = '运动霸（68033）· 冲刺改真·撞击 + 结构目标 + 0.7s 待机 · 2026-11-03'
NOTES = [
    ('做了什么',
     '普攻「拳击冲撞」按新口径重做：220px 起手、锁着目标当时的位置直线冲过去、撞到才算伤害；'
     '撞墙撞建筑也一样冲、一样停、一样结算；冲刺就是这一拳，撞上或冲空之后原地待机 0.7 秒。'
     '伤害口径没变（近战单体、一次出手一次扣血）。'),
    ('改了哪三处',
     '① pvpSkill 30713.chargeDistance 120 → 220（起手距离，上一轮改的）；'
     '② 城墙/建筑解禁，走同一条冲刺路（本轮）；'
     '③ pvpCard 68033.unitAttackInterval 1.8 → 0.7 —— 这 0.7 秒就是「冲刺＝普攻」的完整节拍，'
     '没有另开「冲刺冷却」列（本轮）。'),
    ('为什么 0.7 秒要改攻击间隔',
     '因为冲刺不再是「额外加速」，它就是普攻动作本身：冲锋段（≈0.51 秒）是挥拳，'
     '撞上那一下是命中，之后站着待机是收招。写成攻击间隔，'
     '出手节拍就只有 nextAttackAt 一套时钟，表源也只有一格要改。'),
    ('为什么要单独一个「待机」窗口',
     '只扣冷却不做别的，单位会一边等一边往目标挪；'
     '所以冷却期间在索敌之前就拦下（连 acquire 都不做），坐标与朝向都不变、'
     'charging=false、battleState=idle，视图才会老老实实播待机而不是出拳。'),
    ('一个必须说明的偏差',
     '设计案原文是「距离敌人 120px 时开始冲刺，冲刺阶段的移动速度 ×4」。'
     '现在实际是「220px 起手 + 直线撞击 + 撞不到零伤害 + 0.7 秒待机」，'
     '和原文已经不是一回事了 —— 本轮已把主表 N/O/P 三列按新口径重写，'
     '策划若想回到原值，记得连表带代码一起改。'),
    ('没做什么',
     '没动其它数值与既有技能链（天外飞石 / 能量光束 照旧）；'
     '没给 103303 能量光束、103304 天外飞石 补实现，那两条仍挂着；'
     '受击特效「战士 vs 坦克」的不一致也仍待拍板。'),
    ('验证',
     'tests/zcds-charge.test.ts 27 条全绿；全量 zcds 997 条 / 949 绿 / 48 红，'
     '48 条与改动前逐条一致。'),
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

    old_trigger = design.cell(ROW, COL_TRIGGER).value
    if old_trigger not in (1.8, TRIGGER_NEW, '1.8', '0.7'):
        raise SystemExit('第 %d 行 J 列（触发参数）既不是 1.8 也不是 0.7：%r' % (ROW, old_trigger))
    design.cell(ROW, COL_TRIGGER).value = TRIGGER_NEW
    design.cell(ROW, COL_MECH).value = MECH_NEW
    design.cell(ROW, COL_SHOW).value = SHOW_NEW
    design.cell(ROW, COL_LANDING).value = LANDING_NEW
    #  行高按真实列宽算（P 列只有 13 宽，中文一行不到 7 个字），否则 P 会被截成大半个屏都看不到。
    needed = 24.0
    for col, text in ((COL_MECH, MECH_NEW), (COL_SHOW, SHOW_NEW), (COL_LANDING, LANDING_NEW)):
        design.cell(ROW, col).alignment = Alignment(wrap_text=True, vertical='top')
        needed = max(needed, fit_cjk(text, COL_WIDTHS[col]))
    design.row_dimensions[ROW].height = needed

    # ------- 测算页的触发参数（纯展示列，公式不引用它）
    measure = wb[MEASURE_SHEET]
    if str(measure.cell(MEASURE_ROW, 1).value) != '68033' or str(measure.cell(MEASURE_ROW, 4).value) != '203301':
        raise SystemExit('测算页第 %d 行不是 68033 / 203301，先核对' % MEASURE_ROW)
    old_m = measure.cell(MEASURE_ROW, MEASURE_COL_TRIGGER).value
    if old_m not in (1.8, TRIGGER_NEW, '1.8', '0.7'):
        raise SystemExit('测算页 G%d 既不是 1.8 也不是 0.7：%r' % (MEASURE_ROW, old_m))
    measure.cell(MEASURE_ROW, MEASURE_COL_TRIGGER).value = TRIGGER_NEW

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

    print('[ok] 主表第 %d 行：J 列 %s → %s、N/O/P 三列已按新口径重写' % (ROW, old_trigger, TRIGGER_NEW))
    print('[ok] 测算页第 %d 行：G 列 %s → %s' % (MEASURE_ROW, old_m, TRIGGER_NEW))
    print('[ok] 技能实现改动明细：第 %d~%d 行（%d 条）' % (d0, d1, len(DETAIL)))
    print('[ok] 本次改动说明：第 %d~%d 行（%d 条）' % (n0, n1, len(NOTES)))
    print('[ok] 冻结窗格：%s' % (frozen or 'N1'))


if __name__ == '__main__':
    try:
        main()
    except PermissionError:
        raise SystemExit('写入失败：技能设计案2.xlsx 正被 Excel / WPS 占用，关闭文档后重跑本脚本')
