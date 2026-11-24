# -*- coding: utf-8 -*-
"""仙桃行者 68009「大地之力」100904 首目标重击 · 设计案回写（2026-11-23 第 42 批）。

用户口径：
  1. 「大地之力新增效果，第一个被攻击的目标受到 300%/370%/450% 的伤害，并在该目标位置播放
     【仙桃行者_重击技能】特效，特效落点的圆圈内所有敌人受到第一个目标一致的伤害，
     其他的效果保持不变」；
  2. 「所有使用了【重骑兵_武将技能的】统一更换为【仙桃行者_重击技能】特效，
     并且该特效的释放一定是在目标的坐标位置播放」。

回写四件事：
  1. 主表第 46 行（100904 大地之力）：K/L/M 三档补「首目标 300/370/450% 重击 + 落点圆」，
     N 列（技能详述）补机制，O 列（表现）按**真实资源**重写，P 列（落地口径）写死实现细节；
  2. 主表第 42 行（30718 长棍横扫）：状态「待规划」→「已实现」，P 列补一句「强化那一击去哪一行」；
  3. `表现资源映射` 第 46 行补新美术（重击柱 29 帧）；
  4. `技能实现改动明细` / `本次改动说明` 页尾各追加一节。

⚠️ openpyxl 另存会把冻结窗格掉成默认值，存完必须写回（主表当前是 N1）。
⚠️ Excel 正开着这个文件时 save 会抛 PermissionError —— 捕获后提示关文档即可。
⚠️ 每节都可重跑：`write_block` 先按首行标记裁掉上一次追加的行再写。
"""
import math

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

PATH = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
SHEET = '技能设计案 (2)'

ROW_ATTACK, ROW_SKILL = 42, 46
COL_SKILL, COL_NAME = 7, 8   # 技能ID / 技能名
COL_L1, COL_L2, COL_L3 = 11, 12, 13
COL_MECH, COL_SHOW, COL_LANDING, COL_STATUS = 14, 15, 16, 19

H1 = Font(name='微软雅黑', size=13, bold=True, color='FF1F3864')
LABEL = Font(name='微软雅黑', size=10, bold=True, color='FF2E5C8A')
BODY = Font(name='微软雅黑', size=10)
HEAD_FILL = PatternFill('solid', fgColor='FFDCE6F1')

# ── 第 46 行 100904 ───────────────────────────────────────────────
QUAKE_CLAUSE = '；首个命中的敌人改为{n}%重击，落点范围内的敌人受到同等伤害'
TIER_CLAUSE = {1: 300, 2: 370, 3: 450}

MECH_ADD = (
    '\n【首目标重击（2026-11-23）】第一个被命中的敌人额外承受 300%/370%/450% 伤害'
    '（= 原波动的 2.5 倍，面板基数不含克制），并在**它的坐标**播一次【仙桃行者_重击技能】；'
    '该特效落点 54 逻辑 px 的圆内（除首目标外的敌方单位）各结算一次「与首目标同倍率」的伤害，'
    '逐个受击者算自己的克制。首目标不重复进落点圆（再算一遍就是 600%）。'
    '其余穿透目标、波动宽度、冷却节拍全部不变。'
)

SHOW_NEW = (
    '【P6 新做】重击柱 units/projectiles/仙桃行者_重击技能：32 张 1065×2372 散图取 29 帧，'
    '一次性演出 1.208s（24fps），atlas + anim + prefab 由 tools/build_xiantao_quake_fx.py 生成。'
    '① 普通波动的表现仍是 重骑兵_践踏（沿朝向拉伸推进，见 30844 行）；'
    '② 首目标那一拍在**受击目标脚下**再叠这根柱子（ZCEffectCatalog 里登记 anchor=target，'
    '层 top —— 它是「打在空中的一下」，不能被 area 默认压回地面层）；'
    '③ 柱子尺寸烘在 prefab 上（offset 子节点 _lscale 0.56、_lpos.y 116.27 把画布里的裂纹环对到脚下），'
    '目录不再登记 nodeScale ⇒ 只有一个尺寸真源。'
    '⚠️ 画面那圈地面裂纹环直径 ≈ 83 屏上 px ↔ 判定圆 54×0.3×2.56 ≈ 83 屏上 px，两者是对齐的：'
    '改 prefab 缩放必须同步改 skillParamJson.quakeRadius，否则会出现「看着没打到却掉血」。'
    '④ 重骑兵武将技 36241（68015 的强化那一击）换的也是这根柱子，同样落在目标坐标。'
)

LANDING_NEW = (
    'skill 域 behaviorKey = skill_params（100904 本来就在这条车道上，每 5 次普攻的强化那一击），'
    'skillParamJson 新增两个键：quakeFirstRate = 3 / 3.7 / 4.5（首目标倍率）、'
    'quakeRadius = 54（落点圆半径，逻辑 px，与 attackRange 同一套数）。'
    '原有的 damageRate（1.2/1.5/1.8）与 pierceCount（99）一个都没动。'
    '\n判定口径：出手时把 quakeFirstRate 乘进 unitDamageBase（**不含克制**，克制逐个受击者算）存进弹道 '
    'quakeDamage；命中时若 target 是单位且 hitUnitIds 为空（= 这颗弹道打到的第一个单位）就用它替代 '
    'baseDamage —— 后续穿透目标仍吃 120/150/180%。「先蹭到城墙」不算首击（墙不记 hitUnitIds）。'
    '落点圆圆心 = 命中点（ZCProjectileSystem 在回调前已把弹道 x/y 对齐到目标坐标），'
    '半径 = 54 × combatDistanceScale(0.3) = 16.2 世界单位。'
    '\n表现口径：resolveProjectileHit 里补推一条 type=melee、radius=0、damage=0 的纯表现事件'
    '（pushQuakeStrikeVisualEvent，from == to == 落点），时长固定 29/24 秒 —— 事件寿命由 '
    'ZCGameModel 按 startedAt + durationSeconds 剔除，短一截就是「砸到一半没了」。'
    '\n🔴 三个键都只在 empowered 时读：计划行按 `${unitId}:${pvpSkillId}` 合并成一袋，'
    '不设闸门会把这张卡**每一次普攻**都变成 300%（与 pierceCount 同一个坑）。'
    '🔴 弹道新增 quakeDamage / quakeRadius / quakeEffectSeconds 三个字段已进 ZCSnapshotCodec 白名单，'
    '不还原 = 读档后这一步静默退化成普通直击。'
    '\n用例：tests/zcds-xiantao-quake.test.ts（14 条，配表真值 / 资源清单 / 锚点登记 / 出手 / 结算 / 旧弹道不变），'
    'tests/zcds-model.test.ts 的「定案 A」那条新增名单例外守卫。'
)

ATTACK_LANDING_ADD = (
    '\n2026-11-23：本行只定义普通普攻的形态与节拍。`pvpSkill` 这一格的 effectPrefabPath 实际为空'
    '（近战走通用命中表现），设计案 O 列写的「长枪兵普攻_刀光」并未落地；'
    '每 5 次普攻的强化那一击换 30844 大地之力（弹道），首目标重击与落点圆见第 46 行 100904。'
)

# ── 页尾两节 ───────────────────────────────────────────────────────
DETAIL_MARK = '仙桃行者 68009 · 大地之力补「首目标重击 + 落点圆」（2026-11-23 第 42 批）'
DETAIL = [
    ('结论',
     '把设计案第 46 行 100904 从「直线波动 120/150/180%」补成用户新口径：'
     '第一个被攻击的目标改吃 300%/370%/450%，并在它的坐标播【仙桃行者_重击技能】；'
     '柱子落点 54 逻辑 px 圆内的其他敌人各吃一次同倍率伤害。'
     '与此同时把全表最后一处【重骑兵_武将技能】引用（36241 重骑兵武将技）换成同一根柱子，'
     '并让它在**受击目标坐标**播放。原有的波动倍率、穿透、冷却节拍一条没动。'),
    ('「第一个被攻击的目标」怎么判',
     '不新增计数器：ZCProjectileSystem 是**先** context.hit()、**后**把 id 记进 projectile.hitUnitIds，'
     '所以命中那一拍它还是空数组 ⇒ hitUnitIds.length === 0 就是首击。'
     '再补一个 target.kind === \'unit\'：墙体 / 建筑不记 id，否则「先蹭到一段城墙」会把首目标那份让给墙。'
     '用例专门钉了这条（先打墙、再打人，人还是吃 300%）。'),
    ('为什么另开 quake* 三个键，不复用 impactBurst*',
     '凤凰降临那套 impactBurst* 是「以命中点为心，**含主目标**把所有人再打一遍」；'
     '本次是「首目标**改成**高倍率（不是再打一遍）+ 圆内**除它以外**的人同额」。'
     '两者在「打不打主目标」和「倍率给谁」上正好相反，共用一套键一定错一边。'
     '所以 burstRadius / quakeRadius 各自独立，缺省全 0 ⇒ 存量弹道一个字节都不变。'),
    ('落点圆为什么是 54',
     '按 prefab 里那圈地面裂纹环反推：245_03 帧裂纹最宽 616 源 px、画布 1065 ⇒ 烘焙 0.56 后'
     '屏上 ≈ 83px，对应判定圆 54 逻辑 px（54 × 0.3 × 2.5625 ≈ 41.6 屏上半径）。'
     '刻意反过来「先定美术再定数字」：§34.6 那次（舞伴拴绳用判定半径 60 去套可见环）就是量错了对象，'
     '结果圈和光差 1.79 倍。用例把两者都钉住了，改一边另一条就红。'),
    ('为什么必须给 36241 开「名单覆盖」',
     '2026-11-19 定案 A 规定：强化那一击一律借**普攻行**的 prefab，36xxx 那格美术根本不会被播。'
     '所以光改 pvpSkill 36241 的 effectPrefabPath，游戏里**什么都看不到**（改了没效果）。'
     '本轮在 ZCQuakeFx 里开一张只有 36241 的名单（ZC_EMPOWERED_FX_OVERRIDES），命中时才用它自己的图；'
     '名单外的 36xxx 行照旧借普攻行 —— zcds-model 的「定案 A」用例已改成「名单内必须用、名单外一律不许」。'
     '顺带：名单那一份不吃 ×1.2 —— 它与仙桃行者自己那根柱子是同一个 prefab，两处出现必须一样大。'),
    ('一个对不上的地方（本批没动）',
     '第 42 行 30718 的 O 列写「【P3 复用】长枪兵普攻_刀光(8帧) 拉成 120° 扇形」，'
     '但 pvpSkill 30718 的 effectPrefabPath 实际是空的（近战走通用命中表现）。'
     '本批没给普攻补专属美术，只在 P 列把事实写清楚了 —— 要补的话是另一件事（美术 + 配表一格）。'),
    ('没做什么',
     '没动 30844（大地之力自己的弹道行）的 effectPrefabPath（仍是 重骑兵_践踏，定案 A 下强化击不播它）；'
     '没动 30241（重骑兵普攻，普通普攻仍播 重骑兵_践踏）；'
     '没删 assets 里 重骑兵_武将技能 那份旧美术（只把全表引用清零）；'
     '没改任何数值倍率、穿透次数、冷却与解锁等级。'),
    ('验证',
     '新增 tests/zcds-xiantao-quake.test.ts 14 条（配表两份产物、资源清单、锚点/层序、'
     '出手三个键、非强化不带、首目标 300%、圆内旁人同额、圆外不打、自己人不打、不可重复打首目标、'
     '第二个穿透目标仍 120%、先打墙不算首击、旧弹道不变、facade 坐标与时长）。'
     'tests/zcds-model.test.ts 68/68、tests/zcds-effect-catalog-parity 与 zcds-combat-effect-placement 15/15。'
     '全量 zcds-* 见当日记录。'),
]

NOTE_MARK = '仙桃行者（68009）· 大地之力首目标重击 + 重骑兵武将技换图 · 2026-11-23'
NOTES = [
    ('做了什么',
     '大地之力（100904）新增：第一个被打到的敌人改吃 300%/370%/450%，并在它的坐标播【仙桃行者_重击技能】；'
     '柱子落点 54 逻辑 px 圆内的其他敌人各吃一次同倍率伤害。'
     '同时把全表最后一处【重骑兵_武将技能】（36241 重骑兵武将技）换成同一根柱子，落在目标坐标。'),
    ('三张表都同步了',
     '源表 `PVP-技能.xlsx`（36241 的 effectPrefabPath）、`J-技能表.xlsx / PVP技能配置`'
     '（94009041/42/43 的 skillParamJson + desc，28 列逐格回读）、'
     '`K-卡牌升级.xlsx / 卡牌技能升级表`（100904 三档 desc）；两份 JSON 产物同改。'),
    ('为什么看配置表看不出来',
     '2026-11-19 定案 A 之后，武将技行（36xxx）自带的美术**不播**，强化那一击一律借普攻行的图。'
     '所以 36241 只改配置等于没改。本轮加了一张只含 36241 的名单（ZC_EMPOWERED_FX_OVERRIDES），'
     '名单外一行都没放开。'),
    ('美术口径',
     '32 张散图取 29 帧（41/42/43 全透明），1.208s 一次性演出；'
     'prefab 烘焙 0.56、y 偏 116.27 让画布里的地面裂纹环落到脚下。'
     '**裂纹环直径 ↔ 判定圆直径 54 是同一份数**，改一边必须改另一边（§34.6 的教训）。'),
    ('没做什么',
     '没动波动倍率 / 穿透次数 / 冷却 / 解锁等级；没动 30844 与 30241 两行的图；'
     '没删旧美术文件；没给 30718 普攻补专属美术（设计案 O 列那句「长枪兵_刀光」本来就没落地）。'),
    ('验证',
     '新增 tests/zcds-xiantao-quake.test.ts 14 条全绿；zcds-model 68/68；'
     '特效目录 / 摆位两条 15/15（目录新增了迁移后增量清单，基线文件保持冻结）。'),
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
    lines = max(1, math.ceil(len(text) / max(1.0, width_chars)))
    return round(lines * 14.5 + 5, 1)


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


def append_text(value, extra):
    """幂等追加：已经含这段就原样返回。"""
    text = '' if value is None else str(value)
    if extra.strip() and extra.strip() in text:
        return text
    return text + extra


def main():
    wb = load_workbook(PATH)
    design = wb[SHEET]

    # ------- 守卫
    if str(design.cell(ROW_SKILL, COL_SKILL).value) != '100904' \
            or design.cell(ROW_SKILL, COL_NAME).value != '大地之力':
        raise SystemExit('第 %d 行不是 100904 大地之力（实为 %s %s），行号已漂移，先核对'
                         % (ROW_SKILL, design.cell(ROW_SKILL, COL_SKILL).value,
                            design.cell(ROW_SKILL, COL_NAME).value))
    if str(design.cell(ROW_ATTACK, COL_SKILL).value) != '30718':
        raise SystemExit('第 %d 行不是 30718 长棍横扫' % ROW_ATTACK)

    # ------- 第 46 行：三档 + 详述 + 表现 + 落地
    changed = []
    for col, level in ((COL_L1, 1), (COL_L2, 2), (COL_L3, 3)):
        old = design.cell(ROW_SKILL, col).value
        new = append_text(old, QUAKE_CLAUSE.format(n=TIER_CLAUSE[level]))
        if new != (old or ''):
            design.cell(ROW_SKILL, col).value = new
            changed.append('L%d' % level)
    if MECH_ADD.strip() not in str(design.cell(ROW_SKILL, COL_MECH).value or ''):
        design.cell(ROW_SKILL, COL_MECH).value = append_text(
            design.cell(ROW_SKILL, COL_MECH).value, MECH_ADD)
        changed.append('N')
    design.cell(ROW_SKILL, COL_SHOW).value = SHOW_NEW
    design.cell(ROW_SKILL, COL_LANDING).value = LANDING_NEW
    changed.extend(['O', 'P'])

    # ------- 第 42 行：状态 + 落地口径补一句
    status = str(design.cell(ROW_ATTACK, COL_STATUS).value or '')
    if status.strip() == '待规划':
        design.cell(ROW_ATTACK, COL_STATUS).value = '已实现'
        changed.append('第42行状态')
    design.cell(ROW_ATTACK, COL_LANDING).value = append_text(
        design.cell(ROW_ATTACK, COL_LANDING).value, ATTACK_LANDING_ADD)
    changed.append('第42行P')

    # ------- 表现资源映射
    mp = wb['表现资源映射']
    mp_row = None
    for r in range(2, mp.max_row + 1):
        if str(mp.cell(r, 1).value) == '68009':
            mp_row = r
            break
    if mp_row is None:
        raise SystemExit('表现资源映射里找不到 68009')
    mp.cell(mp_row, 6).value = (
        '8 帧，拉成 120° 扇形（普攻）；另新增 重击柱 units/projectiles/仙桃行者_重击技能'
        '（29 帧 / 1.208s，落在受击目标坐标，供 100904 首目标与 36241 武将技共用）'
    )

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

    print('[ok] 主表第 %d 行：改了 %s' % (ROW_SKILL, '、'.join(changed)))
    print('[ok] 表现资源映射第 %d 行：重击柱已登记' % mp_row)
    print('[ok] 技能实现改动明细：第 %d~%d 行（%d 条）' % (d0, d1, len(DETAIL)))
    print('[ok] 本次改动说明：第 %d~%d 行（%d 条）' % (n0, n1, len(NOTES)))
    print('[ok] 冻结窗格：%s' % (frozen or 'N1'))


if __name__ == '__main__':
    try:
        main()
    except PermissionError:
        raise SystemExit('写入失败：技能设计案2.xlsx 正被 Excel 占用，关闭文档后重跑本脚本')
