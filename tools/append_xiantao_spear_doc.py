# -*- coding: utf-8 -*-
"""仙桃行者 68009 普攻换「旧值 长枪兵普攻_刀光」特效 · 设计案回写（2026-11-23 第 42 批续）。

需求原话：「仙桃行者，普通攻击也要播放 长枪兵的武将技能特效」。
半小时后用户纠正：「搞错了，应该使用的是 旧值 长枪兵普攻_刀光」——
第一版按字面填了 `长枪兵_武将技能`（地面枪阵），本次连文案一起纠回。

回写三件事：
  1. 主表第 42 行（30718 长棍横扫）：O 列（表现描述）按**真实资源**重写 ——
     原文本就写着「长枪兵普攻_刀光 拉成 120° 扇形」，但那格配表一直是空的；
     现在配表真的指向刀光了，但**没有 120° 扇形放大**（`pvpSkill` 没有扇形参数，
     实际是贴在本体出手点的一下横斩、尺寸 1）；
  2. 主表第 46 行（100904 大地之力）：P 列补一句「普攻换图后强化那一击登记为不播」；
  3. `技能实现改动明细` / `本次改动说明` 页尾各追加一节。

⚠️ openpyxl 另存会把冻结窗格掉成默认值，存完写回。
⚠️ Excel 正开着这个文件时 save 会抛 PermissionError。
⚠️ 每节可重跑：`write_block` 先按首行标记裁掉上一次追加的行再写；主表两列是**整段重写**（幂等）。
⚠️ 上一版（枪阵口径）已经写进文档的块，靠 `OLD_*_MARK` 一并清掉，不留两块并存。
"""
import math

from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

PATH = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
SHEET = '技能设计案 (2)'

ROW_ATTACK, ROW_SKILL = 42, 46
COL_SKILL, COL_NAME = 7, 8
COL_SHOW, COL_LANDING = 15, 16

H1 = Font(name='微软雅黑', size=13, bold=True, color='FF1F3864')
LABEL = Font(name='微软雅黑', size=10, bold=True, color='FF2E5C8A')
BODY = Font(name='微软雅黑', size=10)
HEAD_FILL = PatternFill('solid', fgColor='FFDCE6F1')

SHOW_NEW = (
    '【P6 复用】长枪兵普攻 units/projectiles/长枪兵普攻_刀光：8 帧 @12fps 刀光 clip（0.667s），'
    'prefab 根 _lpos (0,0)、_lscale 1、画布 64×42 —— '
    '就是贴在本体出手点的一下横斩，不是从地面爆起的地面技。'
    '① 锚点：caster（兜底）。近战事件的 from 是施法者，刀光跟着人走；'
    '这与重击柱的 target（砸在受击目标脚下）是两种东西，别串。'
    '② 层：top（melee 事件类型的默认层）。'
    '③ 尺寸：1（prefab 烘焙，目录不写 nodeScale）。'
    '④ 寿命：走近战默认 defaultAttackTravelSeconds = 0.32s，**故意不抬** —— '
    'clip 虽是 0.667s，但长枪兵原版同样被 0.32s 截断，这就是用户要的「旧值观感」。'
    '🔴 因此这张图**不登记 ZCEffectCatalog**（没有 spec 条目）：'
    '锚点 / 层 / 尺寸 / 寿命四项全走兜底，与长枪兵行 30171 逐字一致；'
    '给它单独登记一份参数 = 让两张卡分家。'
    '⚠️ 强化那一击（每 5 次普攻 = 30844 大地之力）**不继承这张图**：'
    '它在 ZC_EMPOWERED_FX_OVERRIDES 里登记为 null（显式不播贴图），'
    '表现交给落点那根重击柱；否则会变成「一把刀光拖着飞过去再砸一根柱子」。'
)

LANDING_NEW = (
    '普攻伤害 = pvpCard.unitAttack，本行只定义形态与节拍。\n'
    '运行编号 30718：2026-11-18 已与源表对齐（原 200901）。本行描述该卡普攻的形态；'
    '与 pvpCard.unitSkillId 一致。\n'
    '2026-11-23：effectPrefabPath = units/projectiles/长枪兵普攻_刀光/长枪兵普攻_刀光'
    '（需求「普通攻击也要播放 长枪兵的武将技能特效」，随后用户纠正为这份**旧值**）—— '
    '之前这一格**是空的**，近战走通用命中表现，只看到受击闪白。'
    '三写同步：assets/remoteRef/pvpSkill.json、doc/塔防数据配置/json/client/pvpSkill.json、'
    'PVP-技能.xlsx / 技能配置 行 64（align_pvp_skill_to_json.py 对齐）。\n'
    '🔴 这张图**不进 ZCEffectCatalog**：锚点 caster / 层 top / 尺寸 1 / 寿命 0.32s 全走兜底，'
    '与长枪兵行 30171 的播法逐字一致（用例 placement ②-3 钉住这一点）。\n'
    '🔴 强化那一击（每 5 次普攻）换 30844 大地之力（弹道），因此它**不再继承**这一格的图：'
    'ZCQuakeFx.ZC_EMPOWERED_FX_OVERRIDES 里 30844 = null（登记为「不播贴图」）。'
    '名单里 null 与「没登记」（undefined）是两种语义，用 ?? 合并会让「刀光拖着飞」回来。'
    '\n用例：tests/zcds-xiantao-quake.test.ts ⑨ / ⑨-1（普攻那一拍播刀光、锚点 caster、'
    '寿命 0.32s、两份产物一致）、'
    'tests/zcds-combat-effect-placement.test.ts ②-3（走兜底、不登记尺寸与寿命）、'
    'tests/zcds-model.test.ts「定案 A」（普攻行不得再有空缺 + 名单三态）。'
)

SKILL_LANDING_MARK = '2026-11-23 续：普攻行 30718 换成'
SKILL_LANDING_ADD = (
    '\n2026-11-23 续：普攻行 30718 换成「长枪兵普攻_刀光」后，'
    '本行的强化那一击（弹道）在 ZC_EMPOWERED_FX_OVERRIDES 里登记为 **null = 不播贴图**，'
    '避免「一把刀光拖着飞」与本行的落点重击柱叠成两套。'
)

DETAIL_MARK = '仙桃行者 68009 · 普通攻击换「旧值 长枪兵普攻_刀光」（2026-11-23 第 42 批续）'
OLD_DETAIL_MARK = '仙桃行者 68009 · 普通攻击换「长枪兵武将技」特效（2026-11-23 第 42 批续）'
DETAIL = [
    ('结论',
     '把 68009 的普通攻击造型从「无（通用命中表现）」改成复用长枪兵那份旧刀光 '
     '`units/projectiles/长枪兵普攻_刀光`（贴在本体出手点的一下横斩）；'
     '并顺手挡掉一个连带风险 —— 强化那一击不能跟着继承这张图。'),
    ('改到了哪里',
     '① 配表：`pvpSkill 30718 仙桃行者普攻` 的 `effectPrefabPath` = '
     '`units/projectiles/长枪兵普攻_刀光/长枪兵普攻_刀光`（三写）；'
     '② 代码：目录只加路径常量 `ZC_EFFECT_PATHS.spearSlash`，**不加 spec**；'
     '③ 名单：`ZC_EMPOWERED_FX_OVERRIDES[30844] = null`（强化那一击不播贴图，保留）；'
     '④ 文档：本节 + 主表第 42 / 46 行。'),
    ('改前是什么样',
     '`pvpSkill 30718` 的 `effectPrefabPath` 是空的，近战事件不建特效节点，玩家只看到受击闪白。'
     '设计案第 42 行 O 列一直写着「长枪兵普攻_刀光 拉成 120° 扇形」，但那只是纸面口径 —— '
     '配表这一格从来没填过，扇形放大也没实现（`pvpSkill` 没有扇形参数）。'
     '本次把图真的填上，但**不做扇形放大**：就是原来那份 64×42 的刀光，尺寸 1。'),
    ('为什么会先填错成「长枪兵_武将技能」',
     '需求原话是「普通攻击也要播放 长枪兵的武将技能特效」，字面就是武将技那份美术。'
     '第一版照字面填了 `长枪兵_武将技能`（16 帧地面枪阵、216×297），'
     '并按「地面爆发」给了 target 锚点 + 1.333s 寿命。'
     '用户随即纠正「搞错了，应该使用的是 旧值 长枪兵普攻_刀光」⇒ 配表、目录、用例、文案整条回退。'
     '🔴 教训：出现「武将技能」与「普攻」两个词打架时，以设计案 O 列的历史口径（刀光）为准，'
     '先去问、别按字面直译。'),
    ('为什么刀光不登记目录',
     '刀光是 64×42 的一下横斩，贴在本体出手点。它需要的四个参数 —— '
     '锚点 `caster`、层 `top`（melee 默认）、尺寸 1、寿命 `defaultAttackTravelSeconds`（0.32s）—— '
     '**恰好就是长枪兵行 30171 自己的播法**。同一份 prefab 要长得一样，'
     '唯一办法是两张卡都别在目录里给它第二套参数。'
     '🔴 尤其寿命：clip 是 12fps / 0.667s，但长枪兵原版同样被 0.32s 事件寿命截断，'
     '用户要的「旧值观感」就是这一截；抬到 0.667s 反而让两张卡分家。'),
    ('连带的坑：强化那一击会把这张图拖着飞',
     '定案 A 规定「强化那一击借普攻行的 prefab」。普攻行一旦有了图，'
     '68009 的强化那一击（30844 是 projectile）就会拖着一把刀光飞过去，落点再砸一根重击柱。'
     '刀光比枪阵轻得多，但形态换了（近战 → 弹道）就不该继承挥击贴图 ⇒ '
     '`ZC_EMPOWERED_FX_OVERRIDES` 仍是 `string | null`，`30844 = null` 保留。'
     '🔴 `null` 与 `undefined` 必须分开：`undefined` = 没登记（照旧借普攻行）、'
     '`null` = 登记为不播。用 `??` 合并两者会让这个 bug 静默回来，用例专门钉了三态。'),
    ('`durationSeconds` 这个新字段为什么还留着',
     '它是本批前半段为重击柱（29 帧 @24fps ≈ 1.208s）加的：'
     '`ZCGameModel` 每步按 `startedAt + durationSeconds` 压缩过期事件，不抬就是「砸到一半没了」。'
     '刀光不登记它，`zcEffectDurationOf` 对未知路径返回 0 ⇒ `max(travel, 0) = travel`，'
     '存量事件寿命逐字不变。'),
    ('没做什么',
     '没动 30171（长枪兵自己的普攻行）—— 仙桃行者是「借同一份美术」，不是把它挪过来；'
     '没动 36171（长枪兵的武将技行）—— 那份地面枪阵本批一次都没用上；'
     '没改任何数值（攻击 100、间隔 1.8、强化每 5 次都不动）。'),
    ('验证',
     'tests/zcds-xiantao-quake.test.ts 15 条全绿（⑨ 普攻那一拍播刀光 + caster 锚点 + 0.32s 寿命、'
     '⑨-1 两份产物真值、④ 用真定义把「配表 → 定义 → 清单」串起来）；'
     'zcds-combat-effect-placement 16/16（②-3 改成「走兜底、不登记尺寸与寿命」）；'
     'zcds-model 68/68（定案 A「普攻行不得有空缺」+ 名单三态）；'
     'zcds-effect-catalog-parity 15/15（`POST_MIGRATION_PATHS` 删掉枪阵条目）。'
     '全量 zcds-* 1984 条 / 35 红，失败清单与改动前逐条一致（其中 1 条路径快照红本批顺手修好）。'),
]

NOTE_MARK = '仙桃行者（68009）· 普攻改播「长枪兵普攻_刀光」· 2026-11-23（第 42 批续）'
OLD_NOTE_MARK = '仙桃行者（68009）· 普攻改播「长枪兵武将技」· 2026-11-23（第 42 批续）'
NOTES = [
    ('做了什么',
     '仙桃行者的普通攻击现在会播长枪兵那份旧刀光（贴在自己出手点的一下横斩）。'
     '之前这一格是空的，普攻只有受击闪白。'),
    ('三张表都改了',
     '`PVP-技能.xlsx` 行 64、`assets/remoteRef/pvpSkill.json`、'
     '`doc/塔防数据配置/json/client/pvpSkill.json`：30718 的 effectPrefabPath '
     '→ units/projectiles/长枪兵普攻_刀光/长枪兵普攻_刀光。'
     '源表用 align_pvp_skill_to_json.py 对齐（重跑 skip）。'),
    ('一个来回',
     '第一版按需求字面填了「长枪兵_武将技能」那张地面枪阵，用户半小时后纠正：'
     '「搞错了，应该使用的是 旧值 长枪兵普攻_刀光」⇒ 已整条改回。'
     '现在配表 / 目录 / 用例 / 文案四处都是刀光口径。'),
    ('尺寸与时长都不动',
     '刀光就是 64×42、尺寸 1、贴出手点；clip 0.667s 但事件寿命仍是近战默认 0.32s —— '
     '长枪兵原版也是这么被截断的，两张卡要一样就得一起这么播。'),
    ('顺手挡掉的一个坑',
     '定案 A 下强化那一击会借普攻行的图 ⇒ 普攻有了图之后，'
     '大地之力那一发弹道就会拖着一把刀光飞。已在名单里把 30844 登记为「不播贴图」，'
     '表现仍交给落点那根重击柱。'),
    ('没做什么',
     '没动长枪兵自己的普攻行 30171 与武将技行 36171；没改任意数值；'
     '没改 30844 的旧图（定案 A 下它不播）。'),
    ('验证',
     '改写用例 4 条（xiantao-quake ⑨/⑨-1/④、placement ②-3）+ 目录增量清单 1 处，全绿；'
     '全量 zcds-* 1984 条 / 35 红，与改动前失败清单逐条一致。'),
]


def trim_from(ws, marker, marker_col=1):
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


def main():
    wb = load_workbook(PATH)
    design = wb[SHEET]

    if str(design.cell(ROW_ATTACK, COL_SKILL).value) != '30718' \
            or design.cell(ROW_ATTACK, COL_NAME).value != '长棍横扫':
        raise SystemExit('第 %d 行不是 30718 长棍横扫，行号已漂移，先核对' % ROW_ATTACK)
    if str(design.cell(ROW_SKILL, COL_SKILL).value) != '100904':
        raise SystemExit('第 %d 行不是 100904' % ROW_SKILL)

    design.cell(ROW_ATTACK, COL_SHOW).value = SHOW_NEW
    old_landing = str(design.cell(ROW_ATTACK, COL_LANDING).value or '')
    if '普攻伤害 = pvpCard.unitAttack' not in old_landing:
        raise SystemExit('第 42 行 P 列不是本卡普攻的口径（%r），先人工核对' % old_landing[:60])
    design.cell(ROW_ATTACK, COL_LANDING).value = LANDING_NEW

    skill_landing = str(design.cell(ROW_SKILL, COL_LANDING).value or '')
    #  上一版（枪阵口径）追加在 P 列末尾的那一段先裁掉，否则会和新段并存。
    cut = skill_landing.find(SKILL_LANDING_MARK)
    if cut >= 0:
        skill_landing = skill_landing[:cut].rstrip('\n')
    design.cell(ROW_SKILL, COL_LANDING).value = skill_landing + SKILL_LANDING_ADD

    detail = wb['技能实现改动明细']
    note = wb['本次改动说明']
    #  先清掉上一版（枪阵口径）的块，再写新块 —— 两个标记不同，trim 各管各的。
    trim_from(detail, OLD_DETAIL_MARK)
    trim_from(note, OLD_NOTE_MARK)
    d0, d1 = write_block(detail, DETAIL_MARK, DETAIL, merge_to=7, width_chars=246 / 2.1)
    n0, n1 = write_block(note, NOTE_MARK, NOTES, merge_to=9, width_chars=108 / 2.1)

    frozen = design.freeze_panes
    wb.save(PATH)
    wb2 = load_workbook(PATH)
    wb2[SHEET].freeze_panes = frozen or 'N1'
    wb2.save(PATH)

    print('[ok] 主表第 %d 行：O 列重写、P 列改写' % ROW_ATTACK)
    print('[ok] 主表第 %d 行：P 列补「强化那一击不播贴图」' % ROW_SKILL)
    print('[ok] 技能实现改动明细：第 %d~%d 行（%d 条）' % (d0, d1, len(DETAIL)))
    print('[ok] 本次改动说明：第 %d~%d 行（%d 条）' % (n0, n1, len(NOTES)))
    print('[ok] 冻结窗格：%s' % (frozen or 'N1'))


if __name__ == '__main__':
    try:
        main()
    except PermissionError:
        raise SystemExit('写入失败：技能设计案2.xlsx 正被 Excel 占用，关闭文档后重跑本脚本')
