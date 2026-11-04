# -*- coding: utf-8 -*-
"""镭射飞龙 V2（2026-11-03 晚）· 设计案回写。

用户这轮三条口径（逐字）：
  1.「镭射飞龙的普通攻击光柱尾端命中目标的判断不够准，应该在长一点，和目标角色的模型的中心坐标」
  2.「追踪导弹技能改用不用截图的激光，改用特效【镭射飞龙导弹技能】触发技能发射出3个技能特效，
     每个特效瞄准一个目标，特效呈弧线飞向目标（3条不同的弧线），中途触碰到任意的目标都会造成1次伤害，
     并停止飞行，到达目标的坐标也会停止飞行，停止飞行后播放【镭射飞龙导弹技能命中】的爆炸特效，
     爆炸范围约80px（范围伤害只有50%的伤害），特效大小需要匹配范围」
  3.「镭射死光的技能的起始位置应该是镭射飞龙的眼睛位置，终点位置才是屏幕位置
     （或者是一个超长的单位距离 18个格子长），但是尾端的方向需要朝向目标」

改到的地方：
  主表 `技能设计案 (2)`：
    · 第 47 行（201001 镭射能量线）：O 列补 tailLift（命中后末端抬到模型中心）；
    · 第 50 行（101003 追踪导弹）：N/O/P 三列按新口径重写（导弹弹道、弧线、爆炸、80px/50%）；
    · 第 51 行（101004 镭射死光）：O 列补「18 格固定长、瞬间全长、方向朝目标」。
  说明页：
    · `技能实现改动明细` / `本次改动说明` 页尾各追加一节。
"""

import math

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

PATH = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'

SHEET = '技能设计案 (2)'
COL_ID, COL_CARD, COL_SKILL, COL_NAME = 1, 2, 7, 8
COL_L1, COL_L2, COL_L3 = 11, 12, 13
COL_MECH, COL_SHOW, COL_LANDING = 14, 15, 16

COL_WIDTHS = {COL_L1: 46.0, COL_L2: 13.0, COL_L3: 13.0, COL_MECH: 50.0, COL_SHOW: 46.0, COL_LANDING: 13.0}
MAX_ROW_HEIGHT = 409.0
LINE_PT = 15.5

H1 = Font(name='微软雅黑', size=13, bold=True, color='FF1F3864')
LABEL = Font(name='微软雅黑', size=10, bold=True, color='FF2E5C8A')
BODY = Font(name='微软雅黑', size=10)
HEAD_FILL = PatternFill('solid', fgColor='FFDCE6F1')

# ── ① 镭射能量线（68010 / 201001）O 列追加 tailLift ──────────────────────────
BEAM_APPEND = (
    '命中后光柱末端不再停在边界接触点，而是沿竖直方向再抬 30px 落到目标模型中心；'
    '目标如果是空中单位，这 30px 刚好把线头从脚点提到胸口，看着「确实打到了」。'
    '只改表现、不改结算 —— 伤害和溅射原本就按目标中心算。'
)

# ── ② 追踪导弹（68010 / 101003）N/O/P 重写 ──────────────────────────────────
MISSILE_N = (
    '冷却 12s 的主动：一次发射 3 枚导弹，每枚独立锁定一个最近的敌方单位，'
    '沿弧线飞向目标（3 条不同的弧线，中段横向甩开约半格）。'
    '中途触碰到任意目标都会立刻停止飞行、结算 1 次伤害；'
    '若一路未撞人，到达锁定目标的坐标也会停止。'
    '停止后在落点播放爆炸特效，爆炸半径 80px，范围内的敌人受到 50% 溅射伤害。'
)
MISSILE_O = (
    '弹体使用【镭射飞龙_导弹技能】序列帧（units/projectiles/镭射飞龙_导弹技能，4 帧循环），'
    '命中/到点后换播【镭射飞龙_导弹技能命中】（12 帧单次爆炸）。'
    '爆炸视觉尺寸按 80px 反推缩放（80/225 ≈ 0.36），与判定半径同比例。'
    '3 条弧线的横向偏移由下标错开（index 0 / 1 / 2 → +arc / −arc / +0.5arc），'
    '靠 ZCCombatEffectView 在 projectile 分支里按 sin(π·progress) 施加垂直偏移实现。'
)
MISSILE_P = (
    'skill 域 behaviorKey=random_strike；skillParamJson：'
    'strikeCooldown=12 / strikeCount=3 / strikeRadius=336 / strikeNearest=1 / strikeDamageRate=3.0 / '
    'strikeSplashRadius=80（2026-11-03 由 100 下调）/ strikeSplashDamageRate=0.5（2026-11-03 由 0.3333 上调）。'
    '表现走 ZCCombatEffectFlight 的 MISSILE_FX_BY_UNIT（68010 登记弹体/爆炸路径与弧线偏移）。'
)

# ── ③ 镭射死光（68010 / 101004）O 列追加 ────────────────────────────────────
DEATH_SHOW_APPEND = (
    '死光不是「打到谁停在哪」，而是固定 18 格（756 逻辑单位）长的超长射线：'
    '从眼睛位置沿目标方向一口气射到屏幕外，瞬间全长（视图层直接画到 event.to，不跟弹头逐帧长）。'
    '方向始终锁定目标，不会因目标移动而偏转；'
    '贯穿路径上全部单位，pierceCount=99 确保不会提前被摘掉。'
)

# ── ④ 说明页追加 ───────────────────────────────────────────────────────────
DETAIL_MARK = '镭射飞龙 68010 · 普攻末端 + 追踪导弹 + 死光 18 格（2026-11-03 晚）'
DETAIL = [
    ('结论',
     '本轮三条全部落地，配表（pvpSkillPlan 半径 80 / 溅射 50%）与代码同步修改。'),
    ('① 普攻末端到中心',
     'ZCProjectileSystem 命中分支把 projectile.x/y 从「边界接触点」改到 target.x/y（模型中心）；'
     '视图侧 zcBeamFrame 追加 tailLift:30，让线头从脚点再抬到胸口。'),
    ('② 追踪导弹改弧线弹道',
     'applyRandomStrike 新增 missile 模式：挑 3 个目标各发一颗 projectile，'
     '带 arcOffset（弧线）与 impactEffectPrefabPath（爆炸）。ZCProjectileSystem 逻辑仍走直线扫掠，'
     '弧线纯视觉 —— ZCCombatEffectView 按 sin(π·progress) 在垂直方向偏移弹体。'
     '命中后 resolveProjectileHit 推 area 事件播爆炸特效，splashRadius=80、splashDamageRate=0.5。'),
    ('③ 死光 18 格固定长',
     'sendAttack 里对 30845 覆盖 event.toX/toY = from + dir·756，'
     'durationSeconds = 756/1200 ≈ 0.63s；视图层光束分支判断 skillId 为死光时直接画到 event.to（固定终点），'
     '不跟弹头逐帧长，实现「瞬间全长」。'),
    ('表改动',
     'pvpSkillPlan.json 三档 modifierId 94010031~33：strikeSplashRadius 100→80、'
     'strikeSplashDamageRate 0.3333→0.5；J-技能表.xlsx AC 列同步。'),
    ('新增资源',
     'tools/build_laserdragon_missile_fx.py 生成导弹弹体与爆炸两个预制体（atlas+anim+prefab）。'),
    ('没做什么',
     '导弹的弧线未改逻辑层碰撞（仍按直线扫掠），因为需求里的「中途碰到任意目标」在直线扫掠下已经覆盖；'
     '若后续需要真正的弧线路径碰撞，再拆 ZCProjectileSystem。'),
    ('已知遗留',
     '技能伤害测算页 68010 五行技能名仍是风法师模板（见 2026-11-03 上午明细）。'),
    ('验证',
     'npm run check:zcds 零错误；相关测试 63 绿 1 红（既有冲刺配表）。'),
]

NOTE_MARK = '镭射飞龙 · 普攻末端 + 追踪导弹 + 死光 18 格 · 2026-11-03 晚'
NOTES = [
    ('① 普攻',
     '光柱末端从「边界接触点」延长到「目标模型中心」，看着更准。'),
    ('② 追踪导弹',
     '弃用旧激光，改用导弹特效；3 条弧线、命中或到点停飞、80px 爆炸、50% 溅射。'),
    ('③ 死光',
     '固定 18 格长，从眼睛射向屏幕外，方向锁定目标，瞬间全长。'),
]


def fit(text, width_chars):
    """按字符宽度估行高：中文 2 单位、ASCII 1 单位。"""
    per_line = max(4.0, width_chars)
    lines = 0
    for block in str(text).split('\n'):
        used = 0
        count = 1
        for ch in block:
            w = 2 if ord(ch) >= 128 else 1
            if used + w > per_line:
                count += 1
                used = w
            else:
                used += w
        lines += count
    return min(MAX_ROW_HEIGHT, round(lines * LINE_PT + 3, 1))


def trim_from(ws, start_mark):
    """按首列内容含 start_mark 找到行，删掉该标记行及之后的正文行（直到下一节或空行）。返回起始行号。"""
    for r in range(1, ws.max_row + 1):
        v = ws.cell(r, 1).value
        if v and start_mark in str(v):
            row = r
            while row <= ws.max_row:
                v2 = ws.cell(row, 1).value
                if row > r and v2 and ('·' in str(v2) or str(v2).strip().startswith('【')):
                    break
                if row > r and not v2 and not ws.cell(row, 2).value:
                    # 连续空行结束本节
                    pass
                row += 1
            # 实际删除 r 到 row-1
            for _ in range(r, min(row, ws.max_row + 1)):
                ws.delete_rows(r)
            return r
    return ws.max_row + 1


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


def guard(ws, row, skill_id, name):
    got_id = str(ws.cell(row, COL_SKILL).value)
    got_name = ws.cell(row, COL_NAME).value
    if got_id != str(skill_id) or got_name != name:
        raise SystemExit('第 %d 行不是 %s %s（实为 %s %s），行号已漂移，先核对'
                         % (row, skill_id, name, got_id, got_name))


def set_cell(ws, row, col, value):
    cell = ws.cell(row, col)
    cell.value = value
    cell.alignment = Alignment(wrap_text=True, vertical='top')


def bump_height(ws, row, cols, floor=0.0):
    needed = floor
    for col in cols:
        text = ws.cell(row, col).value
        if text:
            needed = max(needed, fit(text, COL_WIDTHS[col] / 2))
    ws.row_dimensions[row].height = min(MAX_ROW_HEIGHT, round(needed, 1))


def main():
    wb = load_workbook(PATH)
    design = wb[SHEET]

    # ── ① 镭射能量线（O 列追加 tailLift）
    guard(design, 47, 201001, '镭射能量线')
    beam_show = str(design.cell(47, COL_SHOW).value or '')
    if BEAM_APPEND not in beam_show:
        set_cell(design, 47, COL_SHOW, beam_show.rstrip() + '\n' + BEAM_APPEND)
    bump_height(design, 47, (COL_MECH, COL_SHOW), floor=31.0)

    # ── ② 追踪导弹（N/O/P 重写）
    guard(design, 50, 101003, '追踪导弹')
    set_cell(design, 50, COL_MECH, MISSILE_N)
    set_cell(design, 50, COL_SHOW, MISSILE_O)
    set_cell(design, 50, COL_LANDING, MISSILE_P)
    bump_height(design, 50, (COL_MECH, COL_SHOW), floor=49.5)

    # ── ③ 镭射死光（O 列追加）
    guard(design, 51, 101004, '镭射死光')
    death_show = str(design.cell(51, COL_SHOW).value or '')
    if DEATH_SHOW_APPEND not in death_show:
        set_cell(design, 51, COL_SHOW, death_show.rstrip() + '\n' + DEATH_SHOW_APPEND)
    bump_height(design, 51, (COL_MECH, COL_SHOW), floor=46.5)

    # ── 说明页
    detail = wb['技能实现改动明细']
    d0, d1 = write_block(detail, DETAIL_MARK, DETAIL, merge_to=7, width_chars=246 / 2.1)
    note = wb['本次改动说明']
    n0, n1 = write_block(note, NOTE_MARK, NOTES, merge_to=9, width_chars=108 / 2.1)

    frozen = design.freeze_panes
    wb.save(PATH)
    wb2 = load_workbook(PATH)
    wb2[SHEET].freeze_panes = frozen or 'K1'
    wb2.save(PATH)

    print('[ok] 主表第 47 行 201001 镭射能量线：O 列补 tailLift（命中后末端抬到中心）')
    print('[ok] 主表第 50 行 101003 追踪导弹：N/O/P 三列重写（导弹/弧线/爆炸/80px/50%）')
    print('[ok] 主表第 51 行 101004 镭射死光：O 列补 18 格固定长、瞬间全长')
    print('[ok] 技能实现改动明细：第 %d~%d 行（%d 条）' % (d0, d1, len(DETAIL)))
    print('[ok] 本次改动说明：第 %d~%d 行（%d 条）' % (n0, n1, len(NOTES)))
    print('[ok] 冻结窗格：%s' % (frozen or 'K1'))


if __name__ == '__main__':
    main()
