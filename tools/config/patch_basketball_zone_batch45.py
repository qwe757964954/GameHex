# -*- coding: utf-8 -*-
"""第 45 批：篮球天才 68030「篮球火」103004 / pvpSkill 30848 的判定口径改回设计案。

用户口径（2026-11-25）：
    「按设计案：目标圆心 R110 / 3 秒」

现状与设计案的两处冲突（都是「照现状配就静默错」的坑）：
  1. `pvpSkill 30848.areaRadius` 写的是 **70**（半径），设计案主表 M 列原话是
     「以目标为圆心，**220p 为直径**」⇒ 半径 110。
  2. `pvpSkill 30848.durationSeconds` 写的是 **2**，设计案原话「技能持续时间为 3s」。
  3. 三档 `skillParamJson` 都带 `zoneSelfCentered: 1` ⇒ `ZCAttackResolutionSystem`
     把区域圆心从目标改成**施法者脚下**（「斗气爆发」那条口径）。篮球火是扔到目标身上
     的，必须去掉这个键；去掉后 `zoneCount === 1 ⇒ offset = 0`，圆心正好落在目标点。

🔴 三写：xlsx 是转表器的唯一真源。只改 JSON 不写 Excel，转表器一跑（以 Excel 为准）
就把 70 / 2 / `zoneSelfCentered` 抄回来，而且**屏幕上什么都看不出来** ——
范围圈是按判定半径画的，判定错了圈就比技能小一半。

写法沿用 `patch_fan_single_k.py`：
  · xlsx 走 zip 级只替换目标 `<c>`（这张表公式单元格多，openpyxl 保存会把缓存值写空）；
  · remoteRef 是列存 `{k,v,c}`（CRLF、元素独占行），整份用 `render` 重写；
  · client 是行对象数组，`json.dump` 紧凑写。

幂等：目标值固定，内容没变就跳过写盘。
用法：python tools/config/patch_basketball_zone_batch45.py
"""
import io
import json
import os
import re
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import cell_xml, read_zip_rows  # noqa: E402
from patch_splash_shot_k import render  # noqa: E402  同一个 render：数组一行一个元素、`\\r\\n`

ROOT = 'D:/Alan/Project/POW'
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client')
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef')
BACKUP_DIR = os.path.join(ROOT, 'doc', '塔防数据配置_历史备份')
XLSX_SKILL = os.path.join(ROOT, 'doc', '塔防数据配置', 'PVP-技能.xlsx')
XLSX_PLAN = os.path.join(ROOT, 'doc', '塔防数据配置', 'J-技能表.xlsx')
XLSX_K = os.path.join(ROOT, 'doc', '塔防数据配置', 'K-卡牌升级.xlsx')

SKILL_ID = 30848
CHAIN = 103004
#  pvpSkill 30848 在「PVP-技能.xlsx / 技能配置」里的行号（A 列 = 30848）。
SKILL_ROW = 73
#  pvpSkillPlan 三档在「J-技能表.xlsx / PVP技能配置」里的行号（B 列 = 9403xxxx）。
PLAN_ROWS = (190, 191, 192)
#  armySkillLevelUp 三档在「K-卡牌升级.xlsx / 卡牌技能升级表」里的行号（A 列 = 103004）。
K_ROWS = (364, 365, 366)

#  —— 判定口径（设计案真值）——
AREA_RADIUS = 110          # 「220p 为直径」⇒ 半径 110 逻辑 px
DURATION_SECONDS = 3       # 「技能持续时间为 3s」
MODIFIER_IDS = (94030041, 94030042, 94030043)
#  三档倍率不动，只把 `zoneSelfCentered` 摘掉（圆心改回目标点）。
DAMAGE_RATES = ('0.7', '1.0', '1.4')
#  🔴 文案必须跟着判定走：原句「对周围敌人」是「自身圆心」时代的说法，
#  改成目标圆心之后照原文案念，玩家会以为是自己脚下一圈。
DESCS = (
    '以目标为圆心半径110持续3秒砸下篮球，造成70%伤害并沉默2秒，对召唤物和分身额外造成100%伤害',
    '以目标为圆心半径110持续3秒砸下篮球，造成100%伤害并沉默2.5秒',
    '以目标为圆心半径110持续3秒砸下篮球，造成140%伤害并沉默3秒，对召唤物和分身额外造成300%伤害',
)


def param_json(tier):
    return '{"damageRate":%s}' % DAMAGE_RATES[tier]


# ────────────────────────────────────────── xlsx 单元格手术

def value_of(xml, ref):
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not match:
        return None
    texts = re.findall(r'<t[^>]*>(.*?)</t>', match.group(1) or '', re.S)
    texts += re.findall(r'<v>(.*?)</v>', match.group(1) or '', re.S)
    return texts[0] if texts else ''


def write_cell(xml, ref, value):
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, xml, re.S)
    if not match:
        raise SystemExit('[fail] 单元格 %s 不存在' % ref)
    style = re.search(r's="(\d+)"', match.group(0))
    return xml[:match.start()] + cell_xml(ref, style.group(1) if style else None, value) + xml[match.end():]


def patch_xlsx(path, member, wanted):
    """wanted: {单元格引用: 目标文本}。内容没变就跳过写盘。"""
    xml = read_zip_rows(path, member)
    changed = 0
    for ref, value in sorted(wanted.items()):
        if value_of(xml, ref) == str(value):
            continue
        xml = write_cell(xml, ref, value)
        changed += 1
    if not changed:
        print('[skip] %s：已是目标值' % os.path.basename(path))
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(path, os.path.join(BACKUP_DIR, os.path.basename(path) + '.bak-batch45'))
    tmp = path + '.tmp'
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == member:
                data = xml.encode('utf-8')
            dst.writestr(info, data)
    #  Windows 上先关掉句柄再替换，否则 `os.replace` 报 WinError 5。
    os.replace(tmp, path)
    print('[ok] %s：改 %d 格' % (os.path.basename(path), changed))


# ────────────────────────────────────────── JSON 三写

def load_json(folder, name):
    path = os.path.join(folder, name + '.json')
    with io.open(path, encoding='utf-8') as handle:
        return path, json.load(handle)


def save_packed(path, data, rows):
    with io.open(path, 'w', encoding='utf-8', newline='') as handle:
        handle.write('{\r\n"k":%s,\r\n"v":%s,\r\n"c":%s\r\n}'
                     % (render(data['k']), render(rows), render(data['c'])))


def patch_skill(folder, packed):
    path, data = load_json(folder, 'pvpSkill')
    if packed:
        keys = data['k']
        rows = data['v']
        hits = [row for row in rows if int(row[keys.index('skillId')]) == SKILL_ID]
    else:
        rows = data
        hits = [row for row in rows if int(row['skillId']) == SKILL_ID]
    if len(hits) != 1:
        raise SystemExit('[fail] %s 里 30848 有 %d 行' % (path, len(hits)))
    row = hits[0]
    changed = 0
    for column, value in (('areaRadius', AREA_RADIUS), ('durationSeconds', DURATION_SECONDS)):
        if packed:
            index = keys.index(column)
            if row[index] != value:
                row[index] = value
                changed += 1
        else:
            if row.get(column) != value:
                row[column] = value
                changed += 1
    if changed:
        if packed:
            save_packed(path, data, rows)
        else:
            with io.open(path, 'w', encoding='utf-8', newline='') as handle:
                json.dump(rows, handle, ensure_ascii=False, separators=(',', ':'))
    print('[ok] %s/pvpSkill：改 %d 格' % (os.path.basename(folder), changed))


def patch_plan(folder, packed):
    path, data = load_json(folder, 'pvpSkillPlan')
    keys = data['k'] if packed else None
    rows = data['v'] if packed else data

    def get(row, name):
        return row[keys.index(name)] if packed else row.get(name)

    def put(row, name, value):
        if packed:
            row[keys.index(name)] = value
        else:
            row[name] = value

    changed = 0
    for tier, modifier_id in enumerate(MODIFIER_IDS):
        hits = [row for row in rows if int(get(row, 'modifierId')) == modifier_id]
        if len(hits) != 1:
            raise SystemExit('[fail] %s 里 %s 有 %d 行' % (path, modifier_id, len(hits)))
        row = hits[0]
        for column, value in (('skillParamJson', param_json(tier)), ('desc', DESCS[tier])):
            if get(row, column) != value:
                put(row, column, value)
                changed += 1
    if changed:
        if packed:
            save_packed(path, data, rows)
        else:
            with io.open(path, 'w', encoding='utf-8', newline='') as handle:
                json.dump(rows, handle, ensure_ascii=False, separators=(',', ':'))
    print('[ok] %s/pvpSkillPlan：改 %d 格' % (os.path.basename(folder), changed))


def patch_level_up(folder, packed):
    path, data = load_json(folder, 'armySkillLevelUp')
    keys = data['k'] if packed else None
    rows = data['v'] if packed else data

    def get(row, name):
        return row[keys.index(name)] if packed else row.get(name)

    def put(row, name, value):
        if packed:
            row[keys.index(name)] = value
        else:
            row[name] = value

    tiers = sorted((row for row in rows if int(get(row, 'id')) == CHAIN),
                   key=lambda row: int(get(row, 'skilllevel')))
    if len(tiers) != 3:
        raise SystemExit('[fail] %s 里 %s 有 %d 档' % (path, CHAIN, len(tiers)))
    changed = 0
    for tier, row in enumerate(tiers):
        #  `modfiy` 一并补上：Excel 的 L 列原先是空的，转表器一跑就把修改器号清成 `[]`
        #  （与第 14 批同一个三写缺口，`zcds-fan-single-batch14` 的逐格对拍正是这么红的）。
        for column, value in (('desc', DESCS[tier]), ('modfiy', [MODIFIER_IDS[tier]])):
            if get(row, column) != value:
                put(row, column, value)
                changed += 1
    if changed:
        if packed:
            save_packed(path, data, rows)
        else:
            with io.open(path, 'w', encoding='utf-8', newline='') as handle:
                json.dump(rows, handle, ensure_ascii=False, separators=(',', ':'))
    print('[ok] %s/armySkillLevelUp：改 %d 格' % (os.path.basename(folder), changed))


def main():
    #  xlsx 先写（它是真源），再对齐两份 JSON。
    skill_cells = {'G%d' % SKILL_ROW: AREA_RADIUS, 'N%d' % SKILL_ROW: DURATION_SECONDS}
    patch_xlsx(XLSX_SKILL, 'xl/worksheets/sheet1.xml', skill_cells)

    plan_cells = {}
    for tier, row in enumerate(PLAN_ROWS):
        plan_cells['Z%d' % row] = DESCS[tier]        # desc
        plan_cells['AC%d' % row] = param_json(tier)  # skillParamJson
    patch_xlsx(XLSX_PLAN, 'xl/worksheets/sheet9.xml', plan_cells)

    k_cells = {}
    for tier, row in enumerate(K_ROWS):
        k_cells['C%d' % row] = DESCS[tier]
        k_cells['L%d' % row] = '[%d]' % MODIFIER_IDS[tier]
    patch_xlsx(XLSX_K, 'xl/worksheets/sheet2.xml', k_cells)

    patch_skill(REMOTE, packed=True)
    patch_skill(CLIENT, packed=False)
    patch_plan(REMOTE, packed=True)
    patch_plan(CLIENT, packed=False)
    patch_level_up(REMOTE, packed=True)
    patch_level_up(CLIENT, packed=False)
    verify()


def verify():
    xml = read_zip_rows(XLSX_SKILL, 'xl/worksheets/sheet1.xml')
    radius, seconds = value_of(xml, 'G%d' % SKILL_ROW), value_of(xml, 'N%d' % SKILL_ROW)
    if (radius, seconds) != (str(AREA_RADIUS), str(DURATION_SECONDS)):
        raise SystemExit('[fail] PVP-技能 30848 回读不一致：%s / %s' % (radius, seconds))
    xml = read_zip_rows(XLSX_PLAN, 'xl/worksheets/sheet9.xml')
    for tier, row in enumerate(PLAN_ROWS):
        got = (value_of(xml, 'Z%d' % row), value_of(xml, 'AC%d' % row))
        if got != (DESCS[tier], param_json(tier)):
            raise SystemExit('[fail] J-技能表 %d 行回读不一致：%s' % (row, got))
    xml = read_zip_rows(XLSX_K, 'xl/worksheets/sheet2.xml')
    for tier, row in enumerate(K_ROWS):
        got = (value_of(xml, 'C%d' % row), value_of(xml, 'L%d' % row))
        if got != (DESCS[tier], '[%d]' % MODIFIER_IDS[tier]):
            raise SystemExit('[fail] K 表 %d 行回读不一致：%s' % (row, got))
    print('[ok] xlsx 回读通过：30848 半径 %s / %s 秒；三档 desc + skillParamJson + modfiy' % (radius, seconds))

    for folder, packed in ((REMOTE, True), (CLIENT, False)):
        _, data = load_json(folder, 'pvpSkill')
        rows = data['v'] if packed else data
        keys = data['k'] if packed else None

        def get(row, name):
            return row[keys.index(name)] if packed else row.get(name)

        hit = [row for row in rows if int(get(row, 'skillId')) == SKILL_ID][0]
        if (get(hit, 'areaRadius'), get(hit, 'durationSeconds')) != (AREA_RADIUS, DURATION_SECONDS):
            raise SystemExit('[fail] %s/pvpSkill 30848 回读不一致' % os.path.basename(folder))
        _, data = load_json(folder, 'pvpSkillPlan')
        rows = data['v'] if packed else data
        keys = data['k'] if packed else None
        for tier, modifier_id in enumerate(MODIFIER_IDS):
            row = [item for item in rows if int(get(item, 'modifierId')) == modifier_id][0]
            if 'zoneSelfCentered' in str(get(row, 'skillParamJson')):
                raise SystemExit('[fail] %s/%s 还带 zoneSelfCentered' % (os.path.basename(folder), modifier_id))
    print('[ok] 两份 JSON 回读通过：判定 110/3s、参数袋已无 zoneSelfCentered')


if __name__ == '__main__':
    main()
