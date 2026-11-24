# -*- coding: utf-8 -*-
"""第 44 批（2026-11-24）：把腾云驾雾 / 三尖两刃的新口径写回《技能设计案2.xlsx》。

两条链（用户原话见 docs/design 第二十五节）：

  1. `100904`（仙桃行者）—— 原「大地之力」（穿透冲击波 + 首目标重击 + 落点圆）整条换成
     「腾云驾雾」（150px/s 四段突进连击、每人 350/410/480%、每击播重击柱）；
  2. `101503`（机甲菇）—— 改名「三尖两刃」，参数与描述一个不动。

写两个成员：
  · `xl/worksheets/sheet1.xml`（主表「技能设计案 (2)」）—— 第 46 / 75 行；
  · `xl/worksheets/sheet9.xml`（「卡牌描述与落地」）—— 68009 卡面描述、68015 技能 4 名字与状态。

🔴 为什么走 zip 级手术：这张表 8 个页签 + 大量样式，openpyxl 另存会丢公式缓存值
（历史上同类表从 20KB 涨到 5.4MB）。这里只替换命中的 `<c>` 节点，其余条目逐字节复制。

守卫：两条链的行号必须现算（`xlsx_read` 解共享字符串），不写死；
      改前名字必须是「大地之力 / 腾云驾雾」「武器绞杀 / 三尖两刃」之一；回读逐字比对。
幂等：内容一致就跳过，不写盘。
用法：python tools/config/patch_batch44_design.py
"""
import os
import re
import shutil
import sys
import zipfile
from datetime import datetime
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from xlsx_read import read_sheet  # noqa: E402

XLSX = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'
MAIN_MEMBER = 'xl/worksheets/sheet1.xml'
CARD_MEMBER = 'xl/worksheets/sheet9.xml'
MAIN_SHEET = 0
CARD_SHEET = 8

#  主表列（1-based）：7=技能ID 8=技能名 11/12/13=I/II/III 级 14=技能详述
#  15=表现描述 16=落地口径 17=克制 18=被克制 19=状态
COL_SKILL_ID = 7
COL_NAME = 8
COL_L = (11, 12, 13)
COL_MECH = 14
COL_VISUAL = 15
COL_LAND = 16
COL_STATE = 19

DASH_L = [
    'L1（兵种 12 级）：每 5 次普攻，突进到目标身前攻击 1 次（350% 伤害）；'
    '以该目标为圆心 200 范围内另取 3 名敌人，依次突进各攻击 1 次（每个目标 350% 伤害）；'
    '最后回到首个目标的位置。每次攻击都会释放重击特效',
    'L2（兵种 24 级）：每个目标 410% 伤害（人数、半径、速度不变）',
    'L3（兵种 36 级）：每个目标 480% 伤害（人数、半径、速度不变）',
]

DASH_MECH = (
    '四段突进连击：起手锁定「目标 1」→ 以它为圆心 200 半径内由近到远补 3 个（合计 4 人，'
    '同距按 `unit.id`）→ 依次突进到每个人身前打 1 下 → 再回到**起手那一刻目标 1 的坐标**。\n'
    '\u3000\u3000🔴 访问顺序在起手那一帧**拍死**：中途某人被打死就跳过那一段，不换人、不补打 —— '
    '每帧重选会让「选中的人被打死 ⇒ 换一个」变成打不完的循环。\n'
    '\u3000\u3000🔴「不计入普攻累计数」指的是这 4 段伤害：它们走 `strikeTargets`（`context.strike`），'
    '那条路天然不碰 `completedAttackCount`；触发它的那一次普攻**照旧 +1**，'
    '否则「每 5 次普攻」这条节拍永远等不到第 5 次。\n'
    '\u3000\u3000🔴 突进速度是表值 150 px/秒 × `combatDistanceScale` 0.3 = 45 世界 px/秒；'
    '本体**真位移**（每帧 `blinkTo` 推一段），不是瞬移。\n'
    '\u3000\u30002026-11-24 第 44 批：本条原「大地之力」（穿透冲击波 + 首目标 300/370/450% 重击 + 落点圆）'
    '被用户整条换掉，旧四个参数键（`damageRate` / `pierceCount` / `quakeFirstRate` / `quakeRadius`）'
    '一并退场 —— 它们只服务旧机制，100901~100903 一个都不读。'
)

DASH_VISUAL = (
    '【P6 新做·沿用】每次攻击都播 `units/projectiles/仙桃行者_重击技能`（32 张 1065×2372 散图取 29 帧，'
    '一次性 1.208s @24fps，`tools/build_xiantao_quake_fx.py` 生成）。\n'
    '\u3000\u3000🔴 锚点 `target`、层 `top`（「打在空中的一下」，`area` 默认会被压到地面层）；'
    '尺寸不写 `nodeScale` —— 已经烘进 prefab（`_lscale = 0.56`），再乘一次就是两个真源。\n'
    '\u3000\u3000🔴 这条车道**不新增目录 spec**：重击柱按单位收在 `skill_params` 的 `unitPrefabPaths[\'68009\']`'
    '（第 42 批为大地之力补的，本批沿用）⇒ `ZC_EFFECT_BEHAVIOR_SPECS` 保持原样。\n'
    '\u3000\u3000🔴 特效落在**被打的那个人**身上（事件 `toX/toY` = 该目标坐标），不是本体落点。\n'
    '\u3000\u3000⚠️ 旧口径「画面那圈裂纹 = 判定圆」本批失效：判定改成「贴脸打眼前这个」'
    '（`dashChainHitRadius` 40 表值 = 12 世界 px），裂纹只作表现，不再和判定对齐。'
)

DASH_LAND = (
    'skill 域 behaviorKey=dash_chain（新增车道：`ZCSkillTriggerSystem.applyDashChain` 逐帧推进；'
    '起手标记由 `ZCAttackResolutionSystem.prepareAttack` 在 `consumeEmpoweredAttack` 之后写下并 `return null`）。\n'
    '\u3000\u3000pvpSkillPlan 100904 三档（modifierId 94009041/42/43 **不动**，pvpSkillId=30718，'
    'unlockHeroLevel 12/24/36，stateMode=none、**没有冷却也没有累计计数**）；'
    'skillParamJson={"dashChainSpeed":150,"dashChainSpreadRadius":200,"dashChainCount":4,'
    '"dashChainStopDistance":30,"dashChainHitRadius":40,"dashChainDamageRate":3.5/4.1/4.8}。\n'
    '\u3000\u3000🔴 参数一律 `dashChain*` 前缀：`dashDamageRate` / `dashHitRadius` 已经是冲锋'
    '（`legacy_dash` 102303 / 102703）的键名，裸 `dash*` 会让「同一张卡既有冲锋又有腾云驾雾」时串味；'
    '`68009:30718` 这一袋里还住着 100901 的 `lance*`、100902 的 `splash*`、100903 的 `selfCast*`。\n'
    '\u3000\u3000🔴 三处登记缺一不可：`ZCStatSchema.SKILL_BEHAVIORS` 白名单、'
    '`ZCSkillRuntime.register(\'dash_chain\')`、`ZCEffectCatalog.ZC_EFFECT_BEHAVIOR_KEYS`。\n'
    '\u3000\u3000🔴 六个字段进 `ZCSnapshotCodec`：`dashChainPendingAt` / `dashChainTargetId` / '
    '`dashChainIndex`（数值）、`dashChainReturnX` / `dashChainReturnY`（有限数）、'
    '`dashChainIds`（正整数、不重复）—— 不还原就是「读档回来单位被 `ZCUnitSystem` 冻在半路」'
    '（`dashChainIndex` 有值就 `return`）。\n'
    '\u3000\u3000🔴 `ZCUnitSystem.updateUnit` 的冻结必须插在 `dashUntil` 块**之后**：不索敌'
    '（否则中途锁到新目标）、不出手（会多打一发普攻）、不自己挪窝（会和 `blinkTo` 抢坐标）。\n'
    '\u3000\u3000🔴 打人圆心显式给成**目标自己的坐标**（`IZCStrikeOptions.origin`）：`strikeTargets` '
    '只按「离 origin 最近」挑，刚落地时附近若有更近的敌人，这一下会打到别人身上。\n'
    '\u3000\u3000🔴 「每 5 次普攻」这个节拍在 `pvpSkill 30718.empoweredEvery`，**不在**本技能的参数袋里；'
    '改节拍要改 `PVP-技能.xlsx` / pvpSkill，不是改 `dashChain*`。'
)

CARD_DESC_68009 = '群战战士：破阵投枪 + 爆囊扩散双 AOE，腾云驾雾四段突进逐个贴脸重击。'


def col_letter(index):
    letters = ''
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def cell_pattern(ref):
    return re.compile(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, re.S)


def set_cell(xml, ref, value):
    m = cell_pattern(ref).search(xml)
    if not m:
        raise SystemExit('[fail] 单元格 %s 不存在（set_cell 不建格）' % ref)
    style = re.search(r's="(\d+)"', m.group(0))
    style_attr = ' s="%s"' % style.group(1) if style else ''
    new = '<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (
        ref, style_attr, escape(str(value)))
    return xml[:m.start()] + new + xml[m.end():]


def main():
    main_xml = read_member(MAIN_MEMBER)
    card_xml = read_member(CARD_MEMBER)

    main_rows = read_sheet(XLSX, MAIN_SHEET)[1]
    row_of = {}
    for index, cells in main_rows:
        skill_id = str(cells[COL_SKILL_ID - 1]).strip() if len(cells) >= COL_SKILL_ID else ''
        if skill_id in ('100904', '101503'):
            row_of[skill_id] = index
    missing = [key for key in ('100904', '101503') if key not in row_of]
    if missing:
        raise SystemExit('[fail] 主表找不到这几条链：%s' % ', '.join(missing))

    parsed = {MAIN_MEMBER: {index: cells for index, cells in main_rows}}
    for skill_id, allowed in (('100904', ('大地之力', '腾云驾雾')), ('101503', ('武器绞杀', '三尖两刃'))):
        name = str(parsed[MAIN_MEMBER][row_of[skill_id]][COL_NAME - 1] or '')
        if name not in allowed:
            raise SystemExit('[fail] 主表 %s 的技能名是 %r，既不是旧名也不是新名，拒绝改' % (skill_id, name))

    plan = []

    #  ① 100904：整条换成腾云驾雾
    row = row_of['100904']
    plan += [
        (MAIN_MEMBER, row, COL_NAME, lambda text: '腾云驾雾'),
        (MAIN_MEMBER, row, COL_L[0], lambda text: DASH_L[0]),
        (MAIN_MEMBER, row, COL_L[1], lambda text: DASH_L[1]),
        (MAIN_MEMBER, row, COL_L[2], lambda text: DASH_L[2]),
        (MAIN_MEMBER, row, COL_MECH, lambda text: DASH_MECH),
        (MAIN_MEMBER, row, COL_VISUAL, lambda text: DASH_VISUAL),
        (MAIN_MEMBER, row, COL_LAND, lambda text: DASH_LAND),
        (MAIN_MEMBER, row, COL_STATE, lambda text: '已实现'),
    ]

    #  ② 101503：只改名（参数、描述、表现、落地口径全部不动）
    row = row_of['101503']
    plan += [(MAIN_MEMBER, row, COL_NAME, lambda text: '三尖两刃')]

    #  ③ 卡面页：68009 的一句话描述；68015 技能 4 的名字与状态
    card_rows = read_sheet(XLSX, CARD_SHEET)[1]
    parsed[CARD_MEMBER] = {index: cells for index, cells in card_rows}
    card_row_of = {}
    for index, cells in card_rows:
        key = str(cells[0]).strip()
        if key in ('68009', '68015'):
            card_row_of[key] = index
    if set(card_row_of) != {'68009', '68015'}:
        raise SystemExit('[fail] 卡面页找不到 68009 / 68015')
    #  🔴 68015 那一行把 101503 列了两次：G 列（技能 1）是「普攻槽」，写的是 `武器绞杀` +
    #  「普攻伤害 = pvpCard.unitAttack」；P 列（技能 4）才是 fan_slow 那条主动技（旧名「菌丝绞杀」、
    #  状态还停在【未实现】）。本批只改 P/Q，G 列属于普攻，需求没提就不动。
    plan += [
        (CARD_MEMBER, card_row_of['68009'], 6, lambda text: CARD_DESC_68009),
        (CARD_MEMBER, card_row_of['68015'], 16, lambda text: '三尖两刃'),
        (CARD_MEMBER, card_row_of['68015'], 17, lambda text: '已实现'),
    ]

    payload = {MAIN_MEMBER: main_xml, CARD_MEMBER: card_xml}
    changed = 0
    for member, row, column, replacer in plan:
        ref = '%s%d' % (col_letter(column), row)
        cells = parsed[member].get(row)
        if cells is None or column - 1 >= len(cells):
            raise SystemExit('[fail] %s 的 %s 位置不存在' % (member, ref))
        before = str(cells[column - 1] or '')
        after = replacer(before)
        if after == before:
            continue
        payload[member] = set_cell(payload[member], ref, after)
        changed += 1
        print('  %s %s' % (ref, after.splitlines()[0][:70]))

    if not changed:
        print('[skip] 两条链与卡面都已是新口径，不写盘')
        return

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = write_members(payload, stamp)

    verify_main = {index: cells for index, cells in read_sheet(XLSX, MAIN_SHEET)[1]}
    for skill_id, expect_name in (('100904', '腾云驾雾'), ('101503', '三尖两刃')):
        cells = verify_main[row_of[skill_id]]
        if str(cells[COL_NAME - 1]) != expect_name:
            raise SystemExit('[fail] 回读 %s 的技能名是 %r' % (skill_id, cells[COL_NAME - 1]))
    if '重击' not in str(verify_main[row_of['100904']][COL_MECH - 1]):
        raise SystemExit('[fail] 回读 100904 的详述里没有「重击」')

    verify_card = {str(cells[0]).strip(): cells for _, cells in read_sheet(XLSX, CARD_SHEET)[1]}
    if str(verify_card['68009'][5]) != CARD_DESC_68009:
        raise SystemExit('[fail] 回读 68009 卡面描述不一致')
    if str(verify_card['68015'][15]) != '三尖两刃':
        raise SystemExit('[fail] 回读 68015 技能 4 名字是 %r' % verify_card['68015'][15])

    print('[ok] %d 格写入并回读通过；备份 %s' % (changed, backup))


def read_member(member):
    with zipfile.ZipFile(XLSX) as archive:
        return archive.read(member).decode('utf-8')


def write_members(payload, stamp):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, '技能设计案2.xlsx.bak-batch44-%s' % stamp)
    shutil.copy2(XLSX, backup)
    tmp = XLSX + '.tmp'
    with zipfile.ZipFile(XLSX) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = payload.get(info.filename)
            if data is None:
                data = src.read(info.filename)
            elif isinstance(data, str):
                data = data.encode('utf-8')
            dst.writestr(info, data)
    os.replace(tmp, XLSX)
    return backup


if __name__ == '__main__':
    main()
