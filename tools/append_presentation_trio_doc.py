# -*- coding: utf-8 -*-
"""表现三修（2026-11-03）· 设计案回写。

用户这轮三条口径（逐字）：
  1.「镭射飞龙的普通攻击修改成，朝着目标发射一条逐渐延长的射线，触碰到第一个敌人时就会停止延长，
     造成1次伤害，特效缓慢变透消失，0.18s内消失」
  2.「椰蛋战士的 龙卷风技能的初始生成夹角要增加大20°，更扩散一点，特效的范围和预制大小整体缩小成80%，
     同时碰撞范围要匹配」
  3.「运动霸的冲刺技能的朝向反了，红色箭头应该朝向目标」（追问后确认为「攻击特效气刃朝向反了」）

改到的地方：
  1. `技能设计案 (2)` 第 26 行（100504 暴风）：K/L 列夹角 30→50 度、N/O/P 三列按新口径重写；
  2. 同页第 47 行（201001 镭射能量线）：O 列重写（旧稿还写着前伸 34 / 上抬 16 / 粗细 0.65，
     那三个数在 2026-11-02 已经改成 8 / 44 / 1.8）、P 列同步这三处数字并补定格渐隐；
  3. 同页第 51 行（101004 镭射死光）：O 列粗细 0.65→1.8 / 0.845→2.34，补「只最后一穿才定格」；
  4. 同页第 162 行（203301 拳击冲撞）：O 列补一句「气刃刃口朝目标」（本轮修正 180°）；
  5. `技能实现改动明细` / `本次改动说明` 页尾各追加一节。

⚠️ openpyxl 另存会把冻结窗格掉回默认值，存完必须写回（主表当前是 K1，脚本动态读取）。
⚠️ 若 Excel / WPS 正开着这个文件，save 会抛 PermissionError —— 捕获后提示关文档即可。
⚠️ 追加用「本节首行标记」，重跑本脚本会先删掉上次追加的那一节再重写（幂等）；
   但**不要**在之后再追加别的节再重跑本脚本，否则那节会被一起删掉。
"""

import math

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

PATH = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'

SHEET = '技能设计案 (2)'
COL_ID, COL_CARD, COL_SKILL, COL_NAME = 1, 2, 7, 8
COL_L1, COL_L2, COL_L3 = 11, 12, 13
COL_MECH, COL_SHOW, COL_LANDING = 14, 15, 16

#  主表列宽（宽度单位 = 1 个 '0' 宽；中文按 2 个单位折算）。
COL_WIDTHS = {COL_L1: 46.0, COL_L2: 13.0, COL_L3: 13.0, COL_MECH: 50.0, COL_SHOW: 46.0, COL_LANDING: 13.0}
MAX_ROW_HEIGHT = 409.0

#  主表每行文字实际占的高度。反推自表里成批的老行：1 行 15.5、2 行 31.0、3 行 46.5，
#  即 **15.5pt / 行**（微软雅黑 10pt + 行距）。早先按 14.0 估，两行以上的行都会矮一行左右。
LINE_PT = 15.5

H1 = Font(name='微软雅黑', size=13, bold=True, color='FF1F3864')
LABEL = Font(name='微软雅黑', size=10, bold=True, color='FF2E5C8A')
BODY = Font(name='微软雅黑', size=10)
HEAD_FILL = PatternFill('solid', fgColor='FFDCE6F1')

# ── ① 暴风（68005 / 100504）────────────────────────────────────────────────────
STORM_L1 = ('L1（兵种 12 级）：生成3道小旋风，初始夹角为50度，从角色朝向目标移动，'
            '持续3s，最多对路径上的3个敌人造成80%伤害')
STORM_L2 = ('L2（兵种 20 级）：生成3道小旋风，角度夹角为50度，从角色朝向目标移动，'
            '持续4s，只对路径上的4个敌人造成100%伤害')
STORM_MECH = ('三道风的首尾**总**夹角 50 度（−25° / 0° / +25°），中间那道正对敌人；'
              '风的移动速度 70px，接触到足够数量的敌人会提前消失。'
              '整片风连判定半径都只有原尺寸的 80%。')
STORM_SHOW = ('【P10 沿用】风法师_龙卷风(25帧，落地路径 units/projectiles/椰蛋战士_暴风) '
              '沿用原缩放，2026-11-03 起再整体乘 0.8（视觉缩到 80%）；'
              '玩家看到的范围与判定半径同比例收缩，不会「看着变小、判定没变」。')
STORM_LANDING = ('skill 域 behaviorKey=on_cast_end_spawn_zone；skillParamJson：zoneCount=3 / '
                 'zoneSpreadDeg=50（首尾总夹角，2026-11-03 由 30 上调）/ zoneMoveSpeed=70 / '
                 'zoneDuration=3·4·4 / zoneMaxHits=3·4·5 / damageRate=0.8·1.0·1.2。'
                 '判定半径 pvpSkill 30831.areaRadius=24（2026-11-03 由 30 下调，×0.8）；'
                 '视觉 0.8 走 ZCCombatEffectScale 的 NODE_SCALE_BY_PREFAB_PATH，与半径同步改。')

# ── ② 镭射能量线（68010 / 201001）─────────────────────────────────────────────
BEAM_SHOW = (
    '发射【镭射飞龙_普攻】序列帧（units/projectiles/镭射飞龙_普攻，19 帧，单帧画布 640×53，锚点在左端）：'
    '线的左端钉在飞龙**眼部**（相对单位原点沿弹道前伸 8、竖直上抬 44 —— 单位原点是脚点），'
    '右端每帧追当前弹头，所以射线是**逐渐延长**的；长度靠 scaleX 拉伸，不换帧、不拼多段。'
    '粗细取原画的 1.8 倍（原画 53px 高里不透明的亮芯只有 5~9px，按画布长厚比取 0.65 会细到看不见）。'
    '触到**第一个**敌人那一刻弹道被摘掉 ⇒ 射线停在接触点、不再伸长，随后 0.18s 内整体线性淡到全透明；'
    '淡出期间序列帧继续循环，不换静止帧。命中叠一发 受击(法师)。'
)
BEAM_LANDING_FIX = [
    ('沿朝向前伸 34、垂直上抬 16', '沿弹道前伸 8、竖直上抬 44'),
    ('粗细压到原画的 0.65 倍（普攻 0.65 / 死光 0.845）', '粗细取原画的 1.8 倍（普攻 1.8 / 死光 2.34）'),
    ('visual.scaleY = 0.7 × widthScale（普攻 0.65 / 死光 0.845）',
     'visual.scaleY = 0.7 × widthScale（普攻 1.26 / 死光 1.638）'),
]
BEAM_LANDING_APPEND = (
    '【2026-11-03 补】命中 / 寿命到点后不再「闪没」：ZCProjectileSystem 丢弃弹道时回调 '
    'context.linger，ZCGameModel.lingerBeam 补一条 beamHold=true 的纯表现事件'
    '（from=出手点、to=命中点、寿命=0.18s），视图按满长画并用 UIOpacity 逐步压透明度。'
)

# ── ③ 镭射死光（68010 / 101004）──────────────────────────────────────────────
DEATH_SHOW_OLD = ('复用同一根【镭射飞龙_普攻】光束，只把粗细乘 1.3（widthScale 0.65 → 0.845），'
                  '长度仍由「发射口 → 受击点」实时拉伸；贯穿时一路拉到全场边界，'
                  '到边界处直接截断而不是缩短。命中每个目标各叠一发 受击(法师)。')
DEATH_SHOW_NEW = ('复用同一根【镭射飞龙_普攻】光束，只把粗细乘 1.3（widthScale 1.8 → 2.34），'
                  '长度仍由「发射口 → 受击点」实时拉伸；贯穿时一路拉到射程末端，'
                  '到边界处直接截断而不是缩短。带 pierceCount=99，每穿一个目标都不丢弃弹道，'
                  '所以定格 + 0.18s 淡出只在**最后一穿或寿命到点**那一拍触发（不会沿途叠出一排残影）。'
                  '命中每个目标各叠一发 受击(法师)。')

# ── ④ 拳击冲撞（68033 / 203301）─────────────────────────────────────────────
DASH_SHOW_APPEND = (
    '气刃 / 拳套冲击的**刃口始终朝目标**（2026-11-03 修正：此前朝向反了 180°，'
    '美术里那撮亮白其实是**尾焰**不是刃口 —— FACING_BY_PREFAB_PATH 里这张图的偏移由 0° 改成 180°）。'
)


def wrap_lines(text, width_units):
    """按 Excel 列宽折行数：列宽单位 = 1 个 '0' 宽，中文算 2 个单位、ASCII 算 1 个。

    ⚠️ 早先版本把**所有**字符都按 2 个单位算，于是 P 列（宽度 13、内容大半是
    `zoneSpreadDeg=50` 这种 ASCII）会被高估一倍、直接顶到 409 的上限，尾部照样看不见。
    """
    per_line = max(4.0, width_units)
    lines = 0
    for block in str(text).split('\n'):
        used = 0
        count = 1
        for ch in block:
            width = 1 if ord(ch) < 128 else 2
            if used + width > per_line:
                count += 1
                used = width
            else:
                used += width
        lines += count
    return lines


def fit_cjk(text, width_units):
    return min(MAX_ROW_HEIGHT, round(wrap_lines(text, width_units) * 14.0 + 6, 1))


def fit(text, width_chars):
    lines = max(1, math.ceil(len(text) / max(1.0, width_chars)))
    return round(lines * 14.5 + 5, 1)


def trim_from(ws, marker, marker_col=1):
    """从首个以 marker 开头的行删到表尾，返回该行号（找不到则返回 max_row+1）。"""
    for row in range(2, ws.max_row + 1):
        if str(ws.cell(row, marker_col).value or '').startswith(marker):
            if row <= ws.max_row:
                ws.delete_rows(row, ws.max_row - row + 1)
            return row
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
    """把行高设成「这些列都放得下」的高度（按内容**重算**，不与上次的值取大）。

    为什么不取大：上一版把 ASCII 也按双宽算，写出来的 409 是虚高；若再取大，
    这个错误高度就永远改不回来了。

    为什么用 LINE_PT（15.5）而不是 fit_cjk 的 14.0：主表字号是微软雅黑 10，
    老行的高度就摆在那里（2 行 31.0 / 3 行 46.5），14.0 会矮掉最后一行。
    末尾 +3 是上下留白，别让最后一行贴到边框。
    """
    needed = floor
    for col in cols:
        text = ws.cell(row, col).value
        if text:
            needed = max(needed, wrap_lines(text, COL_WIDTHS[col]) * LINE_PT + 3)
    ws.row_dimensions[row].height = min(MAX_ROW_HEIGHT, round(needed, 1))


def main():
    wb = load_workbook(PATH)
    design = wb[SHEET]

    # ── ① 暴风
    guard(design, 26, 100504, '暴风')
    set_cell(design, 26, COL_L1, STORM_L1)
    set_cell(design, 26, COL_L2, STORM_L2)
    set_cell(design, 26, COL_MECH, STORM_MECH)
    set_cell(design, 26, COL_SHOW, STORM_SHOW)
    set_cell(design, 26, COL_LANDING, STORM_LANDING)
    #  P 列只有 13 字宽，本表 170 多行的 P 都是「数据在格子里、默认视图截断」；
    #  这里不拿它撑行高，否则暴风行会变成 409pt 的一整条空白。
    bump_height(design, 26, (COL_L1, COL_MECH, COL_SHOW), floor=46.5)

    # ── ② 镭射能量线
    guard(design, 47, 201001, '镭射能量线')
    set_cell(design, 47, COL_SHOW, BEAM_SHOW)
    landing = str(design.cell(47, COL_LANDING).value or '')
    for old, new in BEAM_LANDING_FIX:
        if old in landing:
            landing = landing.replace(old, new)
    if 'beamHold' not in landing:
        landing = landing.rstrip('。') + '。' + BEAM_LANDING_APPEND
    set_cell(design, 47, COL_LANDING, landing)
    bump_height(design, 47, (COL_MECH, COL_SHOW), floor=31.0)

    # ── ③ 镭射死光
    guard(design, 51, 101004, '镭射死光')
    set_cell(design, 51, COL_SHOW, DEATH_SHOW_NEW)
    bump_height(design, 51, (COL_MECH, COL_SHOW), floor=46.5)

    # ── ④ 拳击冲撞（只追加朝向那一句）
    guard(design, 162, 203301, '拳击冲撞')
    dash_show = str(design.cell(162, COL_SHOW).value or '')
    if '刃口始终朝目标' not in dash_show:
        set_cell(design, 162, COL_SHOW, dash_show.rstrip('。') + '。' + DASH_SHOW_APPEND)
    bump_height(design, 162, (COL_MECH, COL_SHOW), floor=24.0)

    # ── 明细页 / 说明页
    detail = wb['技能实现改动明细']
    d0, d1 = write_block(detail, DETAIL_MARK, DETAIL, merge_to=7, width_chars=246 / 2.1)
    note = wb['本次改动说明']
    n0, n1 = write_block(note, NOTE_MARK, NOTES, merge_to=9, width_chars=108 / 2.1)

    frozen = design.freeze_panes
    wb.save(PATH)
    wb2 = load_workbook(PATH)
    wb2[SHEET].freeze_panes = frozen or 'K1'
    wb2.save(PATH)

    print('[ok] 主表第 26 行 100504 暴风：夹角 30→50、N/O/P 重写，行高 %.0f' % design.row_dimensions[26].height)
    print('[ok] 主表第 47 行 201001 镭射能量线：O 列重写（34/16/0.65 → 8/44/1.8）、P 列补定格渐隐')
    print('[ok] 主表第 51 行 101004 镭射死光：O 列粗细 1.8/2.34 + 最后一穿才定格')
    print('[ok] 主表第 162 行 203301 拳击冲撞：O 列补气刃朝向')
    print('[ok] 技能实现改动明细：第 %d~%d 行（%d 条）' % (d0, d1, len(DETAIL)))
    print('[ok] 本次改动说明：第 %d~%d 行（%d 条）' % (n0, n1, len(NOTES)))
    print('[ok] 冻结窗格：%s' % (frozen or 'K1'))


DETAIL_MARK = '镭射飞龙 68010 / 椰蛋战士 68005 / 运动霸 68033 · 表现三修（2026-11-03）'
DETAIL = [
    ('结论',
     '这一轮三条改动全部落在**表现层**：伤害、倍率、触发次数、解锁等级一格未动。'
     '① 镭射飞龙的普攻补上「命中后 0.18s 淡出」；② 暴风的三道风张得更开、视觉与判定一起缩到 80%；'
     '③ 运动霸普攻那张气刃的朝向由反 180° 改成朝目标。'),
    ('① 镭射飞龙：改之前到底是什么样',
     '「逐渐延长」「碰到第一个敌人就停」「只造成 1 次伤害」这三句**本来就是既有行为**：'
     '光束不进弹道、而是每帧把预制体从发射口拉到当前弹头（ZCBeamEffect.zcBeamFrame），'
     '长度只跟弹头位置有关；弹道在命中那一拍就被 ZCProjectileSystem 摘掉，'
     '摘之前已经被钉在接触点上，所以「不再伸长」是自然结果；伤害也只在命中那一拍结算一次。'
     '真正的问题只有一句：弹道被摘掉的同一帧，整条光柱也跟着消失了 —— 看起来是「闪一下」而不是「打中了」。'),
    ('② 缺的那 0.18 秒是怎么补的',
     'ZCProjectileSystem 丢弃弹道的地方有两处（命中即丢 / 寿命到点），各回调一次新的可选钩子 '
     'context.linger；ZCGameModel.lingerBeam 据此补一条 beamHold=true 的**纯表现事件**：'
     'from=出手点、to=**命中点**（弹道定格的位置，精确，不靠猜）、durationSeconds=0.18。'
     '视图看到这个标记就按满长画、并用宿主节点的 UIOpacity 按进度把整体透明度压到 0。'
     '时长只有一处口径：ZCCombatEffectFlight 的 FADE_BY_PREFAB_PATH。'),
    ('③ 为什么不让弹道自己多活 0.18 秒',
     '两条硬理由：① 弹道还活着就要继续参与碰撞扫掠，同一发会再打一次（甚至打到旁边的人）；'
     '② 快照校验要求弹道速度向量的模长 > 0，想「原地停住」就得把速度清零 ⇒ 存档直接判非法。'
     '补一条纯表现事件既不影响判定，也不进存档（combatEvents 在 restore 时整列清空）。'),
    ('④ 死光（30845）的边界',
     '死光带 pierceCount=99，每穿一个目标都不丢弃弹道 ⇒ 沿途不会定格。'
     '只有最后一穿 / 寿命到点那一拍才补定格事件，所以不会在路径上叠出一排残影。'
     '粗细仍是普攻的 1.3 倍（widthScale 1.8 → 2.34），淡出期间也保持这个粗细。'),
    ('⑤ 暴风：夹角为什么是 30 → 50',
     '配表里的 zoneSpreadDeg 是**首尾两道的总夹角**，不是相邻两道的间隔：'
     '3 道时 30° ⇒ −15° / 0° / +15°，改成 50° ⇒ −25° / 0° / +25°，'
     '正好对上「初始生成夹角增大约 20°、更扩散一点」。中间那道仍正对目标。'),
    ('⑥ 暴风：视觉缩 80% 为什么不能只改一处',
     'area 类地面区域的**视觉尺寸 100% 来自 prefab 的烘焙缩放**，视图从不按 event.radius 缩放；'
     '判定半径又是另一套（pvpSkill.areaRadius × combatDistanceScale）。'
     '所以「预制大小缩到 80%」= 在 ZCCombatEffectScale 的 NODE_SCALE_BY_PREFAB_PATH 里给这张图挂 0.8；'
     '「碰撞范围也要匹配」= pvpSkill 30831.areaRadius 由 30 改成 24（世界半径 9 → 7.2）。'
     '两处必须同步改，只改一处就是「看着变小、判定没变」。'),
    ('⑦ 运动霸：气刃朝向为什么是 180° 而不是 0°',
     '原先按图集肉眼判断「亮白的汇聚点在左、刃口朝右」，于是登记成 0°。'
     '实战截图证伪：目标站在正上方，气刃却朝左下方喷出去 —— 那撮亮白是**尾焰**（能量朝它收拢），'
     '真正的刃口在反方向。改成 180° 之后刃口始终朝目标。'
     '教训：图集是「打击瞬间的定格」，看不出运动方向，朝向只能对着实战看。'),
    ('表改动',
     'pvpSkillPlan 三档 91005141 / 91005142 / 91005143 的 skillParamJson.zoneSpreadDeg：30 → 50；'
     'pvpSkill 30831.areaRadius：30 → 24。'
     '两份磁盘格式同写（assets/remoteRef 列存 {k,v,c} + doc/塔防数据配置/json/client 行存），'
     '脚本 tools/config/patch_yedan_storm_spread.js，带旧值守卫、回读断言与幂等。'
     '⚠️ 写这两份 json 必须走 tools/config/ref_table_io.js，直接 JSON.stringify 覆写会把整张表变成 diff 炸弹。'),
    ('没做什么',
     '没动暴风的风速 70、持续 3/4/4、命中数 3/4/5、伤害倍率 0.8/1.0/1.2；'
     '没动 68010 的面板（攻 120 / 血 1200 / 射程 550 / 间隔 1.8）与弹速 500；'
     '没动 68033 的任何数值；没有改任何触发条件与解锁等级。'),
    ('已知遗留',
     '① `技能伤害测算` 页 68010 那五行的技能名还是风法师模板（风刃吐息 / 冰霜之躯 / 霜冻建筑 / 亡灵母舰 / '
     '冰冻吐息），与主表的 镭射能量线 / 孢子弹幕 / 裂变凿击 / 追踪导弹 / 镭射死光 对不上，本轮没动。'
     '② pvpCard 68001 的 cycleBaseValue 表里是 2，而用例仍按 3 断言（与本次改动无关，等拍板）。'),
    ('验证',
     'tests/zcds-beam-effect.test.ts 18 条全绿（含新增的：淡出时长登记、两条丢弃分支各回调一次 linger、'
     '穿透时不回调、定格光束满长 + 0.18s 淡到 0）；'
     'tests/zcds-combat-effect-flight.test.ts 6 条全绿（气刃四个方向 180/270/360/90）；'
     'tests/zcds-yedan-skills.test.ts 13 条全绿（三档 zoneSpreadDeg = 50）。'
     '全量 zcds 用例 1100 条 / 1047 绿 / 53 红，53 条与 2026-10-31 的全量日志逐条一致，零新增。'),
]

NOTE_MARK = '镭射飞龙 / 椰蛋战士 / 运动霸 · 表现三修 · 2026-11-03'
NOTES = [
    ('做了什么',
     '三条都是表现层：① 镭射飞龙的射线打中人之后停在命中点、0.18 秒内慢慢变透明消失；'
     '② 暴风的三道风张得更开（总夹角 30° → 50°），视觉与判定一起缩到 80%；'
     '③ 运动霸普攻那道气刃的朝向由反 180° 改成朝目标。数值一格未动。'),
    ('镭射飞龙：前三句本来就是对的',
     '「逐渐延长」「碰到第一个敌人就停」「只打 1 次」都没问题 —— 线长每帧跟着弹头走，'
     '弹道命中即消失、伤害只结算一次。缺的只是命中之后整条线**瞬间消失**，像闪了一下。'
     '现在补了 0.18 秒的淡出，且长度定格在命中点、不会掉头重长。'),
    ('暴风：夹角口径要说清',
     '配表里的 zoneSpreadDeg 是**首尾两道的总夹角**（3 道时 30° = −15/0/+15），'
     '所以「增大约 20°」是 30 → 50，中间那道仍正对敌人。'
     '若策划要的是「相邻两道各加 20°」，那应该是 30 → 70，改一个数即可。'),
    ('暴风：为什么要同时改两个地方',
     '视觉大小来自 prefab 的缩放，判定半径来自表里的 areaRadius，两者本来就分开。'
     '这次两边一起 ×0.8（areaRadius 30 → 24），所以是「看着小了、打到的范围也小了」，比例一致。'),
    ('运动霸：气刃为什么之前是反的',
     '图集上那撮亮白看着像刃口，其实是尾焰。按图集登记朝向必然反 180°，'
     '只有对着实战截图才看得出来。现在是 180°，刃口始终朝目标。'),
    ('没做什么',
     '没动任何伤害 / 倍率 / 触发次数 / 解锁等级；没动暴风的风速与命中数；'
     '没动 68010、68033 的面板数值；没给运动霸的能量光束、天外飞石补实现。'),
    ('验证',
     '光束 18 条、朝向 6 条、椰蛋战士 13 条全绿；全量 zcds 1100 条 / 1047 绿 / 53 红，'
     '53 条与 10-31 的全量日志逐条一致（既有历史问题，零新增）。'),
]

if __name__ == '__main__':
    try:
        main()
    except PermissionError:
        raise SystemExit('写入失败：技能设计案2.xlsx 正被 Excel / WPS 占用，关闭文档后重跑本脚本')
