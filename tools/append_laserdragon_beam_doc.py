# -*- coding: utf-8 -*-
"""镭射飞龙（68010）· 普攻改成专属光束预制体 · 设计案回写。

四件事：
  1. `技能设计案 (2)` 第 47 行（201001 镭射能量线）的 O 列（表现描述）/ P 列（落地口径）
     按**真实实装口径**重写 —— 之前 O 列还是「使用【镭射飞龙的普通攻击】,线的朝向目标」这种占位话，
     P 列还写着「线上指向风法师普攻、需要换成 68010 专属行」的待办。
  2. 第 51 行（101004 镭射死光）的 O 列从「循环加粗使用【镭射飞龙的普通攻击】」
     改成具体的加粗倍数口径。
  3. `表现资源映射` 第 47 行 68010 从「复用 风法师_绿风」改成「沿用 镭射飞龙_普攻」，
     并同步第 36 行标题里的 沿用/复用 计数（16/16 → 17/15）。
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
COL_NAME, COL_SHOW, COL_LANDING = 8, 15, 16

H1 = Font(name='微软雅黑', size=13, bold=True, color='FF1F3864')
LABEL = Font(name='微软雅黑', size=10, bold=True, color='FF2E5C8A')
BODY = Font(name='微软雅黑', size=10)
HEAD_FILL = PatternFill('solid', fgColor='FFDCE6F1')

# ------------------------------------------------------------------ 主表
GUARD = {
    47: (201001, '镭射能量线'),
    51: (101004, '镭射死光'),
}

SHOW47_OLD = '使用【镭射飞龙的普通攻击】,线的朝向目标'
SHOW47_NEW = (
    '发射【镭射飞龙_普攻】序列帧（units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻，19 帧，'
    '单帧画布 640×53）：线的左端钉在飞龙口部，右端始终指向当次受击目标，长度随目标距离实时拉伸，'
    '不换帧、不做分段拼接。发射口相对单位原点前伸 34px、上抬 16px 以对准眼部；'
    '粗细压到原画的 0.65 倍（原画长厚比 12.2:1，550 射程下正好还原比例）。'
    '命中后叠一发 受击(法师)，因为攻击方是法师职业。'
)

LAND47_APPEND = (
    '【表现侧已实装，2026-10-31】新建预制 units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻'
    '（19 帧图集 + loop 动画；锚点在左端 (0, 0.5)、contentSize 640×53、根节点缩放 1 × 0.7，'
    '沿用项目既有的「法师普攻特效 70%」约定），pvpSkill 30719「镭射飞龙普攻」与 30845「镭射死光」的 '
    'effectPrefabPath 都已指向它。运行时由 ZCBeamEffect.zcBeamFrame 逐帧算：'
    '节点位置 = 发射口（沿朝向前伸 34、垂直上抬 16），节点旋转 = 指向当前弹头，'
    'visual.scaleX = 当前长度 ÷ 640（下限 6px），visual.scaleY = 0.7 × widthScale（普攻 0.65 / 死光 0.845）。'
    '长度靠 scaleX 拉伸、不拼多段：实测 3.2 倍拉伸下序列帧无接缝，比拼段省 2/3 节点数。'
)

SHOW51_OLD = '循环加粗使用【镭射飞龙的普通攻击】'
SHOW51_NEW = (
    '复用同一根【镭射飞龙_普攻】光束，只把粗细乘 1.3（widthScale 0.65 → 0.845），'
    '长度仍由「发射口 → 受击点」实时拉伸；贯穿时一路拉到全场边界，到边界处直接截断而不是缩短。'
    '命中每个目标各叠一发 受击(法师)。'
)

# ------------------------------------------------------------------ 表现资源映射
MAP_ROW_GUARD = (47, '68010', '镭射飞龙')
MAP_TITLE_OLD = '四、35 张卡的普攻资源对照（沿用 16 / 复用 16 / 待确认 1 / 无飞行体 2）'
MAP_TITLE_NEW = '四、35 张卡的普攻资源对照（沿用 17 / 复用 15 / 待确认 1 / 无飞行体 2）'

# ------------------------------------------------------------------ 实现改动明细
DETAIL_MARK = '镭射飞龙 68010 · 普攻改成专属光束预制体（2026-10-31）'
DETAIL = [
    ('结论',
     '68010 的普攻表现原来是「借 风法师_绿风 的 8 帧青色月牙」+「ZCCombatEffectView 的 3px 通用线」，'
     '和设计案写的「从口部射出一条细长的镭射能量线」完全不是一回事 —— 月牙是弧形的风刃，'
     '通用线又没有粗细、没有材质。本轮用 19 张美术散图做出专属图集/动画/预制，'
     '并把运行时改成「发射口 → 弹头」的实时连线，长度靠 scaleX 拉伸。'
     '改动面：1 个新预制目录（569K）+ 1 个新纯函数模块 + 2 处代码接线 + 2 行 pvpSkill 配置。'),
    ('改动 1 · 美术资产（tools/build_laser_beam_fx.py）',
     '19 张散图 → atlas（19 张 png + pac）+ anim（镭射飞龙_普攻-loop.anim）+ '
     '镭射飞龙_普攻.prefab。画布按单帧最大包围盒取 640×53（瘦长条），'
     '锚点钉在左端 (0, 0.5) —— 这是整件事的关键：锚点在左端，运行时改 scaleX 就是「以发射口为原点往右伸长」，'
     '不需要额外补偿位移。根节点缩放 1 × 0.7，跟项目既有「法师普攻特效统一 70%」的约定一致'
     '（tests/zcds-mage-normal-attack-size.test.ts 守着）。'),
    ('改动 2 · 新模块 ZCBeamEffect.ts（纯函数、无 cc 依赖）',
     '三件东西：① BEAM_BY_PREFAB_PATH 登记表，按 effectPrefabPath 认定「这个预制是光束」，'
     '没登记的一律走原来的弹道/通用线，对另外 34 张卡零影响；'
     '② zcBeamWidthScaleOf(spec, skillId)，粗细 = widthScale × widthMultiplierBySkill[skillId]；'
     '③ zcBeamFrame(from, to, spec) → { x, y, angleDegrees, length }，纯几何、可单测。'
     '参数：muzzleForward = 34、muzzleLift = 16、widthScale = 0.65、{30845: 1.3}。'),
    ('改动 3 · ZCCombatEffectView 接线',
     'initialize 多收一个 effectPrefabPath 参数（ZCGameRenderWorld 按事件路径传进来），'
     '在里面查登记表、顺便把 contentSize.width（640）与根节点 scaleY（0.7）存下来。'
     'render 的 projectile 分支先判断 beamSpec：命中就走光束，setPosition/setRotationFromEuler/setScale 三维度，'
     '然后 return；没命中继续走原来的代码。弹头坐标取 projectile 的 previousX/Y → x/y 插值，'
     '不用事件端点的线性插值 —— 前者是真实弹道位置，后者在强化弹/多段弹上会跳。'),
    ('改动 4 · 配置（两行、三处 json + 一张 Excel）',
     'pvpSkill 30719「镭射飞龙普攻」（mode=projectile、弹速 500）与 30845「镭射死光」'
     '（mode=projectile、弹速 1200）的 effectPrefabPath：'
     'units/projectiles/风法师_绿风/风法师_绿风 → units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻。'
     'assets/remoteRef / json/client / json/sever 三份同步，'
     'PVP-卡牌.xlsx 的「卡牌配置」页 J 列（技能特效预设，1-based 第 10 列）回填行 65 / 70。'
     '脚本 patch_laserdragon_beam.js / patch_laserdragon_beam_excel.py 都带守卫：'
     'mode 不是 projectile 就直接抛错，避免误改到别的行。'),
    ('为什么选「拉伸预制体」而不是「多段拼接」',
     '设计时两条路都算过。拼接：按 长度 ÷ 单段长 决定拼几段，要处理段间首尾衔接、'
     '每段旋转一致性、段数不整除时的末段裁切，节点数直接 ×3，且首尾两段在拉伸比不为整数时必然露接缝。'
     '拉伸：只做一次除法（length ÷ 640），1 个节点，改的是 scaleX。'
     '实测把预制拉到 3.2 倍（550 射程那档）时序列帧没有可见接缝、也没有横向拉伸失真，'
     '所以选拉伸。这也是设计案 O 列现在写「不做分段拼接」的由来。'),
    ('两个参数是怎么定的',
     '① widthScale = 0.65：原画单帧是 640×53，长厚比 12.2:1，那是「拉到满射程」时该有的观感；'
     '而 550 射程 ÷ 640 画布 ≈ 0.86 倍长，若粗细也乘 1 就是 53px 粗 —— 太胖，不像激光。'
     '按 12.2:1 反推得 0.65，在 550 射程那档正好还原原画比例。'
     '② muzzleForward = 34 / muzzleLift = 16：量的是「飞龙口部（眼部）相对单位原点」的偏移。'
     '这里有个坑：普攻出手点由 context.unitPosition(unit) 给出，就是单位原点，'
     '整条链路里没有任何「枪口偏移」字段，所以偏移只能在视图层补，不能指望配置。'),
    ('三个边界处理',
     '① 贴脸：目标距离 < 68px（2 × 34）时前伸量压到 span × 0.5，否则发射口会越过目标、'
     '光束朝反方向射出去。② 两端完全重合：长度兜底 6px，实际因为上抬 16px，'
     '至少还有 16px 可见，不会闪一下就没有。③ 死光贯穿到全场边界：到边界就截断，不缩短长度，'
     '否则视觉上会看起来「没打到」。'),
    ('没做什么',
     '没动普攻判定、伤害、弹速（仍 500）、命中点（0.345s）、出手（0.667s）；'
     '没动 101003 追踪导弹的导弹体（仍是 风法师_绿风，那是另一条技能）；'
     '没动另外 34 张卡的普攻表现。ZCBeamEffect 是纯新增，ZCCombatEffectView 只加了一个分支 + return，'
     '原分支逐字未动。'),
    ('验证',
     'tests/zcds-beam-effect.test.ts 9 条全绿：登记表命中/未命中、正前方（34/16/0°/长度）、'
     '正上方（0/50/90°/950）、45°（cos/sin 分摊）、贴脸压前伸、两端重合、'
     '预制体 19 帧 + 锚点 (0,0.5) + 根节点 (0,0) + 缩放 1×0.7、死光加粗 0.65→0.845、'
     '两处配表逐格互校。全量 zcds 测试 1030 条 / 962 绿 / 68 红，'
     '68 条与改动前逐条一致（都是既有历史问题：河道格数、pvpCard 缺 deck 列、建筑产金等）。'),
]

# ------------------------------------------------------------------ 本次改动说明
NOTE_MARK = '镭射飞龙（68010）· 普攻改专属光束预制体 · 2026-10-31'
NOTES = [
    ('做了什么',
     '把 68010 的普攻从「风法师_绿风 占位」换成专属光束：19 张散图做成图集 + loop 动画 + 预制，'
     '运行时按「发射口 → 弹头」实时连线、长度靠 scaleX 拉伸。'
     '同时把 101004 镭射死光也指到同一根光束（加粗 1.3 倍）。'),
    ('为什么原来的不算落地',
     '设计案第 47 行 O 列写的是「使用【镭射飞龙的普通攻击】,线的朝向目标」，'
     '但当时项目里没有这个资源：pvpSkill 30719 挂的是 风法师_绿风（8 帧青色月牙，弧形风刃），'
     '而 ZCCombatEffectView 在没有专属预制时会退化画一根 3px 的通用线 —— '
     '既不是「细长的能量线」，也没有粗细与材质。'),
    ('改了什么口径',
     'O 列现在写清了画布尺寸（640×53）、帧数（19）、锚点位置（左端）、'
     '发射口偏移（前伸 34 / 上抬 16）、粗细（0.65 倍，死光 1.3 倍）。'
     'P 列补了完整的实现口径：哪个预制、哪个函数算帧、scaleX/scaleY 怎么取。'
     '101004 的 O 列从「循环加粗使用…」改成具体的 0.65 → 0.845。'),
    ('为什么是拉伸不是拼接',
     '设计阶段对过两条路：多段拼接 vs 拉伸预制体。拼接要按长度算段数、'
     '要处理段间衔接与旋转一致、首末段还得裁切，节点数 ×3 且非整数拉伸比下必然露接缝。'
     '拉伸只做一次除法，实测 3.2 倍无接缝，所以选拉伸。'),
    ('一个边界坑（已修）',
     '发射口前伸 34px 时，如果目标比 34px 还近，发射口会越过目标、光束朝反方向射出去。'
     '改成 forward = min(34, span × 0.5)，并补了一条用例守着。'),
    ('同步改了资源映射页',
     '`表现资源映射` 第 47 行 68010 从「复用 / 风法师_绿风 / 8 帧青色月牙」'
     '改成「沿用 / units/projectiles/镭射飞龙_普攻 / 19 帧，左端锚点」，'
     '第 36 行的计数也跟着从 沿用 16 · 复用 16 改成 沿用 17 · 复用 15。'),
    ('没做什么',
     '没动普攻判定与任何数值（伤害 120、弹速 500、射程 550、间隔 1.8 全部原样），'
     '没动另外 34 张卡。101003 追踪导弹的导弹体仍是 风法师_绿风，属于另一条待办。'),
    ('下一步',
     '101003 追踪导弹的导弹体还没做专属资源；101004 的「路径宽度 +30% / +60%」'
     '现在只体现在 scaleY 上（0.845），如果要求宽度变化在视觉上更明显，'
     '可以把 widthMultiplierBySkill 从 1.3 提到 1.5 再配一条用例。'),
]


def trim_from(ws, marker, marker_col=1):
    """从首个以 marker 开头的行删到表尾，返回该行号（找不到则返回 max_row+1）。"""
    for row in range(2, ws.max_row + 1):
        if str(ws.cell(row, marker_col).value or '').startswith(marker):
            if row <= ws.max_row:
                ws.delete_rows(row, ws.max_row - row + 1)
            return row
    return ws.max_row + 1


def fit(text, width_chars):
    """按合并宽度估行高（14.5 磅一行 + 5 磅内边距）。"""
    lines = max(1, math.ceil(len(text) / max(1.0, width_chars)))
    return round(lines * 14.5 + 5, 1)


def write_block(ws, start_mark, rows, merge_to, width_chars):
    """从首个 start_mark 行裁掉旧内容，再写标题 + label/body 两列块。"""
    r = trim_from(ws, start_mark)
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
    # 尾部收尾：`delete_rows` 只搬值、搬行高，被删掉那批行的合并区间（B{n}:G{n}）还留在
    # `merged_cells` 里，保存时 openpyxl 又照这些区间把空行写回去 ⇒ 每跑一次多一条白带。
    # 三件事一起做：清行高、删空行、摘掉落在末行之后的合并区间。
    last = r - 1
    for key in [k for k in ws.row_dimensions if k > last]:
        del ws.row_dimensions[key]
    while ws.max_row > last and all(
            ws.cell(ws.max_row, col).value in (None, '') for col in range(1, merge_to + 1)):
        ws.delete_rows(ws.max_row, 1)
    for rng in [item for item in ws.merged_cells.ranges if item.min_row > last]:
        ws.merged_cells.ranges.remove(rng)
    return head, last


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

    # ------- 1. 主表 47 行 O / P
    show47 = design.cell(47, COL_SHOW).value or ''
    if SHOW47_OLD in show47:
        design.cell(47, COL_SHOW).value = SHOW47_NEW
    elif '序列帧' not in show47:
        raise SystemExit('第 47 行 O 列既不是旧写法也不含新写法，先人工确认')
    land47 = design.cell(47, COL_LANDING).value or ''
    if '表现侧已实装' not in land47:
        design.cell(47, COL_LANDING).value = land47.rstrip() + LAND47_APPEND

    # ------- 2. 主表 51 行 O
    show51 = design.cell(51, COL_SHOW).value or ''
    if SHOW51_OLD in show51:
        design.cell(51, COL_SHOW).value = SHOW51_NEW
    elif 'widthScale' not in show51 and '加粗' not in show51:
        raise SystemExit('第 51 行 O 列既不是旧写法也不含新写法，先人工确认')

    # ------- 3. 表现资源映射
    mp = wb['表现资源映射']
    row_no, card, card_name = MAP_ROW_GUARD
    if str(mp.cell(row_no, 1).value) != card or mp.cell(row_no, 2).value != card_name:
        raise SystemExit('表现资源映射第 %d 行不是 %s %s（实为 %s %s），先核对'
                         % (row_no, card, card_name, mp.cell(row_no, 1).value, mp.cell(row_no, 2).value))
    mp.cell(row_no, 4).value = 'units/projectiles/镭射飞龙_普攻'
    mp.cell(row_no, 5).value = '沿用'
    mp.cell(row_no, 6).value = '19 帧，单帧 640×53；锚点钉在左端 (0, 0.5)，运行时靠 scaleX 拉伸长度'
    title = mp.cell(36, 1).value or ''
    if title != MAP_TITLE_NEW:
        if title != MAP_TITLE_OLD:
            raise SystemExit('表现资源映射第 36 行标题已变更，先核对：%r' % title[:60])
        mp.cell(36, 1).value = MAP_TITLE_NEW

    # ------- 4. 技能实现改动明细
    detail = wb['技能实现改动明细']
    d0, d1 = write_block(detail, DETAIL_MARK, DETAIL, merge_to=7, width_chars=246 / 2.1)

    # ------- 5. 本次改动说明
    note = wb['本次改动说明']
    n0, n1 = write_block(note, NOTE_MARK, NOTES, merge_to=9, width_chars=108 / 2.1)

    frozen = design.freeze_panes
    wb.save(PATH)
    wb2 = load_workbook(PATH)
    wb2[SHEET].freeze_panes = frozen or 'N1'
    wb2.save(PATH)

    print('[ok] 主表：47 行 O 已重写、P 已追加实装口径；51 行 O 已改成加粗口径')
    print('[ok] 表现资源映射：第 %d 行改「沿用 镭射飞龙_普攻」；第 36 行计数改 17/15' % row_no)
    print('[ok] 技能实现改动明细：第 %d~%d 行（%d 条）' % (d0, d1, len(DETAIL)))
    print('[ok] 本次改动说明：第 %d~%d 行（%d 条）' % (n0, n1, len(NOTES)))
    print('[ok] 冻结窗格：%s' % (frozen or 'N1'))


if __name__ == '__main__':
    try:
        main()
    except PermissionError:
        raise SystemExit('写入失败：技能设计案2.xlsx 正被 Excel 占用，关闭文档后重跑本脚本')
