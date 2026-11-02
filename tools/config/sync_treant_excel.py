# -*- coding: utf-8 -*-
"""把火焰树妖（68003）这轮改动回填到 `doc/塔防数据配置` 的三张 Excel 源表。

涉及三张表、四件事：
  1. `PVP-技能.xlsx` / `技能配置`（pvpSkill）：
     · 30711 强化次数 10 → 6、强化技能ID 36181 → 30811；
     · 追加 30811「树妖·灼热地带」一行。
  2. `PVP-修改器适配.xlsx` / `状态映射`（pvpStatus）：追加 burn_ignite_l1~l3 三行。
  3. `J-技能表.xlsx` / `PVP技能配置`（pvpSkillPlan）：追加 68003 的 12 行（4 技能 × 3 档）。

为什么不用 openpyxl 直接另存：
  `J-技能表.xlsx` 的 `修改器` 页 dimension 是 `A1:XFD3234`（16000 列 × 3234 行），
  openpyxl 读进来 `max_column` 就是 16384，一保存会把整张表按 16384 列重写，
  文件从 2.6MB 涨到几百 MB（`PVP-修改器适配.xlsx` 上次就是这么从 20KB 涨到 5.4MB 的）。
  所以这里做 **zip 级手术**：只改目标 sheet 的 xml，其余条目原样复制。

写入格式与该表既有数据行完全一致（`t="inlineStr"` + 逐列沿用模板行的 `s=` 样式），
不依赖 sharedStrings，也不新增样式，导出链路（EO / POI）读法与原来一样。
"""

import io
import json
import os
import re
import shutil
import zipfile
from xml.sax.saxutils import escape

ROOT = 'D:/Alan/Project/POW/doc/塔防数据配置'
CLIENT_JSON = os.path.join(ROOT, 'json', 'client')

# ---------------------------------------------------------------- 列顺序（与表头一致）

COLS_SKILL = ['skillId', 'name', 'mode', 'effectKey', 'projectileKey', 'projectileSpeed',
              'areaRadius', 'empoweredEvery', 'empoweredSkillId', 'effectPrefabPath',
              'trigger', 'cooldown', 'damageRate', 'durationSeconds', 'waves',
              'slowRatio', 'onHitStatusId']

COLS_STATUS = ['legacyBuffKey', 'statusId', 'name', 'durationSeconds', 'intervalSeconds',
               'maxStacks', 'refreshPolicy', 'handlerKey', 'statJson', 'enabled',
               'periodicAmountPct', 'periodicBasis', 'periodicCapMultiplier', 'control']

COLS_PLAN = ['enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
             'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
             'triggerEvent', 'behaviorKey', 'stateMode', 'targetSelector', 'statId',
             'operation', 'value', 'statusId', 'statusStatJson', 'durationSeconds',
             'maxStacks', 'replacementSkillId', 'cooldown', 'maxTriggers', 'desc',
             'sourceVersion', 'publishStatus', 'skillParamJson']


# ---------------------------------------------------------------- xml 小工具

def col_letter(index):
    """0 -> A（只在 <= 26 列的假表上用得到，这里做一个通用的）。"""
    out = ''
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out


def row_of(xml, row_num):
    m = re.search(r'<row r="%d"[^>]*>(.*?)</row>' % row_num, xml, re.S)
    return m


def row_tag(xml, row_num):
    return re.search(r'<row r="%d"[^>]*>' % row_num, xml)


def styles_of_row(xml, row_num):
    """取模板行每一列的样式 id：{'A': '17', 'B': '17', ...}。"""
    m = row_of(xml, row_num)
    if not m:
        raise SystemExit('模板行 %d 不存在' % row_num)
    styles = {}
    for cell in re.finditer(r'<c r="([A-Z]+)%d"(?: s="(\d+)")?' % row_num, m.group(1)):
        styles[cell.group(1)] = cell.group(2)
    return styles


def cell_xml(ref, style, value):
    s = ' s="%s"' % style if style is not None else ''
    if value is None:
        return '<c r="%s"%s t="n" />' % (ref, s)
    if isinstance(value, bool):
        value = 1 if value else 0
    if isinstance(value, (int, float)):
        # 整数不要写成 3.0，导出时会被当成浮点
        text = ('%d' % value) if isinstance(value, int) else repr(value)
        return '<c r="%s"%s t="n"><v>%s</v></c>' % (ref, s, text)
    return '<c r="%s"%s t="inlineStr"><is><t>%s</t></is></c>' % (
        ref, s, escape(str(value)))


def build_row(row_num, values, styles):
    cells = ''.join(cell_xml('%s%d' % (col_letter(i), row_num),
                             styles.get(col_letter(i)),
                             value)
                    for i, value in enumerate(values))
    return '<row r="%d">%s</row>' % (row_num, cells)


def last_data_row(xml):
    nums = [int(n) for n in re.findall(r'<row r="(\d+)"', xml)]
    return max(nums)


def bump_dimension(xml, new_last_row):
    def repl(m):
        return '<dimension ref="%s%d:%s%d"' % (m.group(1), int(m.group(2)),
                                               m.group(3), max(int(m.group(4)), new_last_row))
    return re.sub(r'<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"', repl, xml, count=1)


def find_row_by(xml, col, value):
    """在指定列里找 value 所在行号；找不到返回 None。"""
    for m in re.finditer(r'<c r="%s(\d+)"[^>]*>(.*?)</c>' % col, xml, re.S):
        inner = m.group(2)
        texts = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
        texts += re.findall(r'<v>(.*?)</v>', inner, re.S)
        if any(t == str(value) for t in texts):
            return int(m.group(1))
    return None


def upsert(xml, key_col, key_of, rows, styles_row=None):
    """按 key 列 upsert：已存在的行原地重写，其余追加到末尾。返回 (xml, 追加数, 重写数)。"""
    styles = styles_of_row(xml, styles_row or last_data_row(xml))
    appended = rewritten = 0
    for values in rows:
        key = key_of(values)
        hit = find_row_by(xml, key_col, key)
        if hit is None:
            target = last_data_row(xml) + 1
            xml = xml.replace('</sheetData>',
                              build_row(target, values, styles) + '</sheetData>', 1)
            xml = bump_dimension(xml, target)
            appended += 1
        else:
            style_of_hit = styles_of_row(xml, hit)
            old = row_of(xml, hit)
            xml = (xml[:old.start()] + build_row(hit, values, style_of_hit)
                   + xml[old.end():])
            rewritten += 1
    return xml, appended, rewritten


def set_cell(xml, ref, value):
    pattern = r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref
    m = re.search(pattern, xml, re.S)
    if not m:
        raise SystemExit('单元格 %s 不存在' % ref)
    style = re.search(r's="(\d+)"', m.group(0))
    return xml[:m.start()] + cell_xml(ref, style.group(1) if style else None, value) + xml[m.end():]


def read_zip_rows(path, sheet_member):
    with zipfile.ZipFile(path) as z:
        return z.read(sheet_member).decode('utf-8')


def write_zip(path, sheet_member, xml, backup_dir):
    os.makedirs(backup_dir, exist_ok=True)
    backup = os.path.join(backup_dir, os.path.basename(path))
    shutil.copy2(path, backup)
    tmp = path + '.tmp'
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == sheet_member:
                data = xml.encode('utf-8')
            dst.writestr(info, data)
    os.replace(tmp, path)
    return backup


def load_client_json(name):
    with io.open(os.path.join(CLIENT_JSON, name), encoding='utf-8') as fh:
        return json.load(fh)


# ---------------------------------------------------------------- 1. pvpSkill

def sync_pvp_skill(backup_dir):
    path = os.path.join(ROOT, 'PVP-技能.xlsx')
    member = 'xl/worksheets/sheet1.xml'
    xml = read_zip_rows(path, member)
    skills = {row['skillId']: row for row in load_client_json('pvpSkill.json')}

    treant = skills[30711]
    scorch = skills[30811]
    #  只改这两列：强化次数 / 强化技能ID。弹道速度等其它列保持表里原值，
    #  避免顺手把「表 450 / json 500」这种既有差异当成改动写进策划表。
    row30711 = find_row_by(xml, 'A', 30711)
    assert row30711, '找不到 30711'
    xml = set_cell(xml, 'H%d' % row30711, treant['empoweredEvery'])
    xml = set_cell(xml, 'I%d' % row30711, treant['empoweredSkillId'])

    #  列名 → 单元格；json 缺的键（slowRatio / onHitStatusId）写空，与既有 area 行一致
    values = [scorch.get(key) for key in COLS_SKILL]
    xml, added, rewritten = upsert(xml, 'A', lambda row: row[0], [values])
    backup = write_zip(path, member, xml, backup_dir)
    print('[ok] PVP-技能.xlsx 30711 @行%d → 强化次数 %s / 强化技能ID %s；30811 追加 %d 重写 %d'
          % (row30711, treant['empoweredEvery'], treant['empoweredSkillId'], added, rewritten))
    return backup


# ---------------------------------------------------------------- 2. pvpStatus

def sync_pvp_status(backup_dir):
    path = os.path.join(ROOT, 'PVP-修改器适配.xlsx')
    member = 'xl/worksheets/sheet5.xml'
    xml = read_zip_rows(path, member)
    statuses = load_client_json('pvpStatus.json')
    rows = [status for status in statuses
            if str(status.get('statusId', '')).startswith('burn_ignite_l')]
    rows.sort(key=lambda status: status['statusId'])
    assert len(rows) == 3, '点燃三档应恰好 3 行，实际 %d' % len(rows)

    values = [[status.get(key) for key in COLS_STATUS] for status in rows]
    xml, added, rewritten = upsert(xml, 'B', lambda row: row[1], values)
    backup = write_zip(path, member, xml, backup_dir)
    print('[ok] PVP-修改器适配.xlsx / 状态映射 追加 %d 行 / 重写 %d 行：%s'
          % (added, rewritten, ', '.join(row[1] for row in values)))
    return backup


# ---------------------------------------------------------------- 3. pvpSkillPlan

def sync_pvp_skill_plan(backup_dir):
    path = os.path.join(ROOT, 'J-技能表.xlsx')
    member = 'xl/worksheets/sheet16.xml'
    xml = read_zip_rows(path, member)
    plans = load_client_json('pvpSkillPlan.json')
    rows = [plan for plan in plans if str(plan.get('unitId')) == '68003']
    assert len(rows) == 12, '68003 应有 12 行计划，实际 %d' % len(rows)
    rows.sort(key=lambda plan: plan['modifierId'])

    values = [[plan.get(key) for key in COLS_PLAN] for plan in rows]
    xml, added, rewritten = upsert(xml, 'B', lambda row: row[1], values)
    backup = write_zip(path, member, xml, backup_dir)
    print('[ok] J-技能表.xlsx / PVP技能配置 追加 %d 行 / 重写 %d 行：%s'
          % (added, rewritten, ', '.join(str(row[1]) for row in values)))
    return backup


if __name__ == '__main__':
    backups = [
        sync_pvp_skill('C:/Users/Administrator/AppData/Local/Temp/tft_backup'),
        sync_pvp_status('C:/Users/Administrator/AppData/Local/Temp/tft_backup'),
        sync_pvp_skill_plan('C:/Users/Administrator/AppData/Local/Temp/tft_backup'),
    ]
    print('备份：')
    for item in backups:
        print('  ', item, os.path.getsize(item))
