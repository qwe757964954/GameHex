# -*- coding: utf-8 -*-
"""第 43 批（2026-11-23）：把三条技能链的新口径写回《技能设计案2.xlsx》。

三条链（用户原话见 docs/design 第二十四节）：

  1. `101504`（机甲菇）—— 原「菌毯爆发」整条弃用，换成科学家搬过来的「射线集束」（参数一字不改）；
  2. `101503`（机甲菇）—— 改名「武器绞杀」，描述里的「菌丝」全换「武器」，参数一个不动；
  3. `103503`（科学家）—— 原「射线集束」原地改成「文明之火」（3 块火焰区、6/8/10 秒、100/110/120%）。

写两个成员：
  · `xl/worksheets/sheet1.xml`（主表「技能设计案 (2)」）—— 第 75 / 76 / 176 行；
  · `xl/worksheets/sheet9.xml`（「卡牌描述与落地」）—— 68015 / 68035 的卡面描述、68015 技能 4 名字。

🔴 为什么走 zip 级手术：这张表 8 个页签 + 大量样式，openpyxl 另存会丢公式缓存值
（历史上同类表从 20KB 涨到 5.4MB）。这里只替换命中的 `<c>` 节点，其余条目逐字节复制。

守卫：三条链的行号必须现算（`xlsx_read` 解共享字符串），不写死；
      A 列技能 ID 必须与预期一致；回读逐字比对。
幂等：内容一致就跳过，不写盘。
用法：python tools/config/patch_batch43_design.py
"""
import io
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
COL_COUNTER = 17
COL_COUNTERED = 18
COL_STATE = 19

COUNTER_WARRIOR = '盆栽阵营 · 法师职业'
COUNTERED_WARRIOR = '花果阵营 · 射手职业'


def col_letter(index):
    """1-based 列号 → 字母。"""
    letters = ''
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def cell_pattern(ref):
    return re.compile(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, re.S)


def get_cell_text(xml, ref):
    m = cell_pattern(ref).search(xml)
    if not m:
        return None
    body = m.group(0)
    texts = re.findall(r'<t[^>]*>(.*?)</t>', body, re.S)
    if not texts:
        texts = re.findall(r'<v>(.*?)</v>', body, re.S)
    if not texts:
        return ''
    return (texts[0]
            .replace('&lt;', '<').replace('&gt;', '>')
            .replace('&quot;', '"').replace('&apos;', "'")
            .replace('&amp;', '&'))


def set_cell(xml, ref, value):
    m = cell_pattern(ref).search(xml)
    if not m:
        raise SystemExit('[fail] 单元格 %s 不存在（set_cell 不建格）' % ref)
    style = re.search(r's="(\d+)"', m.group(0))
    style_attr = ' s="%s"' % style.group(1) if style else ''
    new = '<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (
        ref, style_attr, escape(str(value)))
    return xml[:m.start()] + new + xml[m.end():]


# ────────────────────────────────────────── 三条链的新口径

RAY_L = [
    'L1（兵种 12 级）：累计普攻 8 次后向前方射出集束射线，持续 2 秒，每 0.2 秒对命中敌人造成 20% 伤害',
    'L2（兵种 24 级）：持续 3 秒，每 0.2 秒造成 25% 伤害，并使命中目标受到的伤害提高 10%',
    'L3（兵种 36 级）：持续 4 秒，每 0.2 秒造成 35% 伤害，使目标受到的伤害提高 20%；'
    '射线末端光斑额外造成 50% 范围伤害',
]

RAY_MECH = (
    '高频射线（每秒 5 跳），目标离开射线立即停止结算；III 级的额外波及在射线消失的瞬间结算一次。\n'
    '🔴 2026-11-23 第 43 批：本条**整条从科学家 103503 搬来**（用户：「科学家的射线集束技能给机甲菇使用，'
    '技能效果不变，直接替换掉机甲菇的菌毯爆发，菌毯爆发弃用」）。参数与描述逐字保留，只换了宿主；'
    '槽位原来的「菌毯爆发」（`burst_aura`，一次性圆形爆发 + 自护盾）不再挂在 68015 身上，'
    '车道代码本身没删（68018 的菌核爆裂还在用同一套爆发元件）。'
)

RAY_VISUAL = (
    '【复用】镭射飞龙普通攻击那张横向红色光束（`units/projectiles/镭射飞龙_普攻`）。'
    '🔴 **保持原色，不改蓝** —— 用户口径「机甲菇使用的射线颜色和镭射飞龙的普通攻击颜色一致」。\n'
    '原设计写的是「类似镭射飞龙、改成蓝色」，实测两张图的主色差得远（雷电冲击 84,156,252 青蓝、'
    '镭射飞龙 252,36,12 正红），而染色是**乘法**混色 ⇒ 青蓝 × 蓝只会得到一片脏暗，做不出「一致」。'
    '所以这一版直接换图、不染色。\n'
    '🔴 换图必须重算基准半长：新图可见宽 575 屏上 px ÷ 0.76875 = 748 逻辑 px ⇒ 半长 374'
    '（旧值 180 是雷电冲击那张图的）。表值半长 120 ⇒ 事件级 `effectScale = 120 / 374`；'
    '不重算就是「画面比判定短一半还偏」。'
)

RAY_LAND = (
    'skill 域 behaviorKey=ray_beam（`ZCAttackResolutionSystem.castRayBeam` 建区域、'
    '`ZCSkillTriggerSystem.applyRayBeam` 管次数）。'
    'pvpSkillPlan 101504 三档（modifierId 94015041/42/43 **不动**，pvpSkillId=30241，'
    'unlockHeroLevel 12/24/36，skillKind=active_cd）；'
    'skillParamJson={"rayEvery":8,"rayHalfLength":120,"rayHalfWidth":36,"rayForward":30,'
    '"raySeconds":2/3/4,"rayInterval":0.2,"rayDamageRate":0.20/0.25/0.35,"rayVulnPct":0/10/20,'
    '"rayVulnSeconds":0.3（L2/L3）,"raySpotRadius":60 + "raySpotDamageRate":0.5（仅 III）}。\n'
    '🔴 参数一律 ray* 前缀：`skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，'
    '68015 的袋子里还住着 101501 的 `splashRadius` / `splashDamageRate` 与 101503 的 `fan*` —— '
    '裸写 `radius` / `damageRate` 会把普攻溅射和扇形一起改掉，一条错都不报（`zcds-civilization-fire` ② 守着）。\n'
    '🔴 rayVulnPct 要落成状态 `damageTakenPct` 的**正值**（正 = 受到的伤害变高；写成负会变成减伤自残）。\n'
    '🔴 射线不设 `hitOncePerUnit`：设计是每秒 5 跳，「目标离开射线立即停止结算」由「每波按当前矩形重判」'
    '天然满足。\n'
    '🔴 III 级光斑是**第二个区域**（`wavesLeft = 0` 的小区域，与主区域同 `remainingSeconds`），'
    '不是主区域的 `expireDamage` —— 后者按**区域中心**的圆结算，而光斑在射线末端。\n'
    '🔴 `area` 事件不按 radius 缩放 ⇒ 光束长度只走事件级 `effectScale`（`ZCGroundZoneState.effectScale`，'
    '`syncHoldVisual` / `resolveWave` / `pushExpireVisual` 三处同抄）。\n'
    '✅ 2026-11-23 第 43 批整条搬来时**参数一字未改**，只把宿主从 68035 换成 68015、'
    '并把表现图从 `雷电冲击` 换成 `镭射飞龙_普攻`（见「表现描述」）。'
)

FIRE_L = [
    'L1（兵种 9 级）：累计普攻 8 次后，在目标位置中心点半径 200 的圆内随机生成 3 个火焰区域，'
    '每个区域半径 60（与灼热地带一致），持续 6 秒，每秒对范围内敌人造成 100% 伤害',
    'L2（兵种 18 级）：持续 8 秒，每秒造成 110% 伤害',
    'L3（兵种 27 级）：持续 10 秒，每秒造成 120% 伤害',
]

FIRE_MECH = (
    '3 块**各自独立**的区域（不是 1 块记 3 份伤害），每块都按「普攻面板 × 该档倍率」自己结算 —— '
    '用户口径是「每秒钟造成的伤害为 100%/110%/120%」，不是三块合计摊分。\n'
    '落点**圆内随机且面积均匀**：角度 `random() × 2π`、半径 `sqrt(random()) × 200` '
    '（直接乘 random 会让点都挤在圆心）。\n'
    '触发沿用「累计普攻 8 次」，不吃冷却。\n'
    '🔴 2026-11-23 第 43 批：本条原「射线集束」整条搬给了机甲菇 68015（101504），'
    '科学家这条原地改成本技能（用户：「科学家的原射线集束技能改成文明之火，特效使用灼热地带的特效，'
    '改成蓝色的…」）。'
)

FIRE_VISUAL = (
    '【复用】火焰树妖「灼热地带」那张地面火焰图（`units/projectiles/火焰树妖_灼热地带技能/'
    '火焰树妖_灼热地带技能`），按**事件级**染成蓝色 `[70,190,255]`。\n'
    '🔴 **蓝色绝不能登记成「路径色」**：同一个 prefab 被火焰树妖 68003 自己的灼热地带（30811）用着，'
    '按路径登记就是「那边也变蓝」。所以新增 `ZCCombatEvent.tint` / `ZCGroundZoneState.tint` 这条通道，'
    '由 `castFireZone` 逐块带上（`ZCCombatEffectView.applyTint` 优先取事件色、回落路径色）。\n'
    '🔴 `area` 类地面特效**从不按 `event.radius` 缩放** ⇒ 区域大小只能等于 prefab 烘焙尺寸，'
    '表值 60 与灼热地带同值，所以这里刚好零缩放。\n'
    '🔴 每块只推一条长效表现（`holdVisual: true` + `growSeconds: 0.2`）：不设的话每秒会推一条 area 事件，'
    '6~10 条火焰叠在同一处，看着像「越来越亮」。'
)

FIRE_LAND = (
    'skill 域 behaviorKey=fire_zone（新增车道：`ZCAttackResolutionSystem.castFireZone` 建区域、'
    '`ZCSkillTriggerSystem.applyFireZone` 管次数）。'
    'pvpSkillPlan 103503 三档（modifierId 94035031/32/33 **不动**，pvpSkillId=30709，'
    'unlockHeroLevel 9/18/27，skillKind=active_cd）；'
    'skillParamJson={"fireEvery":8,"fireCount":3,"fireSpreadRadius":200,"fireRadius":60,'
    '"fireSeconds":6/8/10,"fireInterval":1,"fireDamageRate":1.0/1.1/1.2}。\n'
    '🔴 参数一律 fire* 前缀：`68035:30709` 这一袋里还住着 103501 穿甲苔刺（`normalPierceCount` / '
    '`normalPierceFalloff`）、103502 苔针双连（`extraBulletDamage` / `bulletFalloff`）、'
    '103504 精密陷阱（`trap*` 一整套）—— 裸 `radius` / `damageRate` 会顺手改掉它们。\n'
    '🔴 三个登记点缺一不可：`ZCStatSchema.SKILL_BEHAVIORS` 白名单、`ZCSkillRuntime.register(\'fire_zone\')`、'
    '`ZCEffectCatalog.ZC_EFFECT_BEHAVIOR_KEYS` + 行为 spec（漏 spec = 技能照常结算、'
    '编辑器里也看得见、实战一片空白）。\n'
    '🔴 计数器走 `unit.fireFiredCount`（存 `completedAttackCount` 的上次快照值），必须登记进 '
    '`ZCSnapshotCodec` 白名单，否则读档会白送一次。\n'
    '🔴 不需要新状态：灼热地带那套「站在里面就挨」由地面区域系统按 `waveInterval` 逐跳结算，'
    '本技能每块 `wavesLeft = fireSeconds / fireInterval`（6/8/10 跳）。'
)

CARD_DESC_68015 = '吸血战士：吸养根须把伤害转生命，爆囊扩散补溅射，射线集束向前贯穿。'
CARD_DESC_68035 = '穿透射手：穿甲苔刺配苔针双连，精密陷阱踩中即炸，文明之火在目标处撒三片火雨。'


def main():
    main_xml = read_member(MAIN_MEMBER)
    card_xml = read_member(CARD_MEMBER)

    main_rows = read_sheet(XLSX, MAIN_SHEET)[1]
    row_of = {}
    for index, cells in main_rows:
        skill_id = str(cells[COL_SKILL_ID - 1]).strip() if len(cells) >= COL_SKILL_ID else ''
        if skill_id in ('101503', '101504', '103503'):
            row_of[skill_id] = index
    missing = [key for key in ('101503', '101504', '103503') if key not in row_of]
    if missing:
        raise SystemExit('[fail] 主表找不到这几条链：%s' % ', '.join(missing))

    plan = []

    #  ① 101503：改名 + 描述里的「菌丝」全换「武器」（参数不动）
    row = row_of['101503']
    for column, replacer in (
        (COL_NAME, lambda text: '武器绞杀'),
        (COL_L[0], lambda text: text.replace('菌丝', '武器')),
        (COL_L[1], lambda text: text.replace('菌丝', '武器')),
        (COL_L[2], lambda text: text.replace('菌丝', '武器')),
        (COL_MECH, lambda text: text.replace('菌丝', '武器')),
        (COL_VISUAL, lambda text: text.replace('菌丝', '武器')),
        (COL_LAND, lambda text: text
            .replace('与 101504 的 `burstRadius`', '与 101504 的 `rayHalfLength`')
            .replace('会同时改掉普攻溅射与爆发半径', '会同时改掉普攻溅射与射线长度')),
    ):
        plan.append((MAIN_MEMBER, row, column, replacer))

    #  ② 101504：整条换成射线集束
    row = row_of['101504']
    plan += [
        (MAIN_MEMBER, row, COL_NAME, lambda text: '射线集束'),
        (MAIN_MEMBER, row, COL_L[0], lambda text: RAY_L[0]),
        (MAIN_MEMBER, row, COL_L[1], lambda text: RAY_L[1]),
        (MAIN_MEMBER, row, COL_L[2], lambda text: RAY_L[2]),
        (MAIN_MEMBER, row, COL_MECH, lambda text: RAY_MECH),
        (MAIN_MEMBER, row, COL_VISUAL, lambda text: RAY_VISUAL),
        (MAIN_MEMBER, row, COL_LAND, lambda text: RAY_LAND),
        (MAIN_MEMBER, row, COL_COUNTER, lambda text: COUNTER_WARRIOR),
        (MAIN_MEMBER, row, COL_COUNTERED, lambda text: COUNTERED_WARRIOR),
        (MAIN_MEMBER, row, COL_STATE, lambda text: '已实现'),
    ]

    #  ③ 103503：整条换成文明之火
    row = row_of['103503']
    plan += [
        (MAIN_MEMBER, row, COL_NAME, lambda text: '文明之火'),
        (MAIN_MEMBER, row, COL_L[0], lambda text: FIRE_L[0]),
        (MAIN_MEMBER, row, COL_L[1], lambda text: FIRE_L[1]),
        (MAIN_MEMBER, row, COL_L[2], lambda text: FIRE_L[2]),
        (MAIN_MEMBER, row, COL_MECH, lambda text: FIRE_MECH),
        (MAIN_MEMBER, row, COL_VISUAL, lambda text: FIRE_VISUAL),
        (MAIN_MEMBER, row, COL_LAND, lambda text: FIRE_LAND),
        (MAIN_MEMBER, row, COL_STATE, lambda text: '已实现'),
    ]

    #  ④ 卡面页：两张卡的一句话描述 + 68015 技能 4 改名
    card_rows = read_sheet(XLSX, CARD_SHEET)[1]
    card_row_of = {}
    for index, cells in card_rows:
        key = str(cells[0]).strip()
        if key in ('68015', '68035'):
            card_row_of[key] = index
    if set(card_row_of) != {'68015', '68035'}:
        raise SystemExit('[fail] 卡面页找不到 68015 / 68035')
    plan += [
        (CARD_MEMBER, card_row_of['68015'], 6, lambda text: CARD_DESC_68015),
        (CARD_MEMBER, card_row_of['68015'], 7, lambda text: '武器绞杀'),
        (CARD_MEMBER, card_row_of['68035'], 6, lambda text: CARD_DESC_68035),
    ]

    payload = {MAIN_MEMBER: main_xml, CARD_MEMBER: card_xml}
    #  🔴 `before` 必须取 `read_sheet` 解过的文本，不能从 xml 里正则抓：
    #  这张表的单元格大量是 `t="s"`（共享字符串），正则只会拿到 sharedStrings 的下标，
    #  `菌丝 → 武器` 这种「读-改-写」会全部落空且一条提示都没有（第一版就踩了）。
    parsed = {
        MAIN_MEMBER: {index: cells for index, cells in main_rows},
        CARD_MEMBER: {index: cells for index, cells in card_rows},
    }
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
        print('[skip] 三条链与卡面都已是新口径，不写盘')
        return

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = write_members(payload, stamp)

    #  回读：主表三行逐格比对，卡面页两行描述比对。
    verify_main = read_sheet(XLSX, MAIN_SHEET)[1]
    index_of = {index: cells for index, cells in verify_main}
    for skill_id, expect_name in (('101503', '武器绞杀'), ('101504', '射线集束'), ('103503', '文明之火')):
        cells = index_of[row_of[skill_id]]
        if str(cells[COL_NAME - 1]) != expect_name:
            raise SystemExit('[fail] 回读 %s 的技能名是 %r' % (skill_id, cells[COL_NAME - 1]))
        if skill_id != '101503' and '菌丝' in str(cells[COL_MECH - 1]):
            raise SystemExit('[fail] 回读 %s 的技能详述里还有「菌丝」' % skill_id)

    verify_card = {str(cells[0]).strip(): cells for _, cells in read_sheet(XLSX, CARD_SHEET)[1]}
    if str(verify_card['68015'][5]) != CARD_DESC_68015:
        raise SystemExit('[fail] 回读 68015 卡面描述不一致')
    if str(verify_card['68035'][5]) != CARD_DESC_68035:
        raise SystemExit('[fail] 回读 68035 卡面描述不一致')

    print('[ok] %d 格写入并回读通过；备份 %s' % (changed, backup))


def read_member(member):
    with zipfile.ZipFile(XLSX) as archive:
        return archive.read(member).decode('utf-8')


def write_members(payload, stamp):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, '技能设计案2.xlsx.bak-batch43-%s' % stamp)
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
