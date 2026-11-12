# -*- coding: utf-8 -*-
"""把「由 cardLevelUp 反推出的 1750 行」写回 `doc/塔防数据配置/PVP-修改器适配.xlsx` 的 `PVP成长`。

配套脚本：`patch_growth_from_card_level_up.js`（写两份 json）。两边必须一起改，否则下次
eSon 打表（以 Excel 为准）会把 json 刷回旧的 375 行。

改什么
──────
`PVP成长` 现有 15 张卡 × 1~25 级 = 375 行（第 7~381 行）。这里**整段重写**成
35 张卡 × 1~50 级 = 1750 行（第 7~1756 行）：

    attackFlat(L) = cardLevelUp.attrList.attack(L) − attack(1)
    maxHpFlat(L)  = cardLevelUp.attrList.maxHp(L)  − maxHp(1)
    其余比例列全 0

数据直接从已更新好的 `assets/remoteRef/pvpUnitGrowth.json` 读，避免在这里重算口径 ——
「属性恒等式」的断言在 js 脚本里已经做过了。

守卫
────
· 字段名行（第 5 行）必须还是那 9 个英文列名；
· `dimension` 必须是 `A1:I381`、最后数据行必须是 381（= 动手前状态）；
· 68001 第 1 级的 C 列必须还是 45（原来的品质补偿指纹）—— 对不上说明表被人动过，拒绝覆盖。

`unitId` 列沿用表里既有的 `t="s"` 共享字符串（不混 inlineStr），新卡的 id 追加进
`sharedStrings.xml`；`count` 按「删 375 个引用、加 1750 个引用」净增 1375。

沿用 `sync_treant_excel` 的 zip 级手术：只重写 sheet3.xml 与 sharedStrings.xml，其余条目原样复制。
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    ROOT, build_row, bump_dimension, cell_xml, col_letter, last_data_row, read_zip_rows,
    styles_of_row,
)
from patch_storm_radius_growth_excel import shared_strings, write_zip_members  # noqa: E402

GROWTH_XLSX = os.path.join(ROOT, 'PVP-修改器适配.xlsx')
GROWTH_MEMBER = 'xl/worksheets/sheet3.xml'      # workbook.xml：rId3 = PVP成长
GROWTH_SST = 'xl/sharedStrings.xml'
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/growth_backup'

REMOTE_JSON = 'D:/Alan/Project/POW/Demo3.8/assets/remoteRef/pvpUnitGrowth.json'

FIELD_ROW = 5
DATA_START = 7
GROWTH_COLUMNS = ['unitId', 'level', 'attackFlat', 'attackRate', 'maxHpFlat',
                  'maxHpRate', 'moveSpeedRate', 'attackRangeFlat', 'enabled']

OLD_LAST_ROW = 381
OLD_DIMENSION = 'A1:I381'
MAX_LEVEL = 50
EXPECT_CARDS = 35
EXPECT_ROWS = EXPECT_CARDS * MAX_LEVEL


def field_names(xml, strings):
    cells = {}
    for m in re.finditer(r'<c r="([A-Z]+)%d"([^>]*)>(.*?)</c>' % FIELD_ROW, xml, re.S):
        attrs, inner = m.group(2), m.group(3)
        if 't="s"' in attrs:
            index = re.search(r'<v>(\d+)</v>', inner)
            cells[m.group(1)] = strings[int(index.group(1))] if index else ''
            continue
        texts = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
        texts += re.findall(r'<v>(.*?)</v>', inner, re.S)
        cells[m.group(1)] = texts[0] if texts else ''
    return cells


def cell_value(xml, ref, strings):
    m = re.search(r'<c r="%s"([^>]*)>(.*?)</c>' % ref, xml, re.S)
    if not m:
        return None
    attrs, inner = m.group(1), m.group(2)
    raw = re.search(r'<v>(.*?)</v>', inner, re.S)
    if not raw:
        return None
    return strings[int(raw.group(1))] if 't="s"' in attrs else raw.group(1)


def read_packed(path):
    with open(path, encoding='utf-8') as fh:
        data = json.load(fh)
    keys = data['k']
    return [dict(zip(keys, row)) for row in data['v']]


def strip_data_rows(xml):
    """删掉 r >= DATA_START 的所有 <row>（保留表头四行）。"""
    def repl(m):
        return '' if int(m.group(1)) >= DATA_START else m.group(0)
    return re.sub(r'<row r="(\d+)"(?:\s[^>]*)?(?:/>|>.*?</row>)', repl, xml, flags=re.S)


def build_shared_row(row_num, values, styles, sst_index):
    cells = ['<c r="A%d" s="%s" t="s"><v>%d</v></c>'
             % (row_num, styles.get('A'), sst_index)]
    for index, value in enumerate(values[1:], start=1):
        letter = col_letter(index)
        cells.append(cell_xml('%s%d' % (letter, row_num), styles.get(letter), value))
    return '<row r="%d">%s</row>' % (row_num, ''.join(cells))


def main():
    rows = read_packed(REMOTE_JSON)
    if len(rows) != EXPECT_ROWS:
        raise SystemExit('[fail] remoteRef/pvpUnitGrowth.json 是 %d 行，预期 %d —— 先跑 js 脚本'
                         % (len(rows), EXPECT_ROWS))
    cards = sorted({str(row['unitId']) for row in rows}, key=lambda value: int(value))
    if len(cards) != EXPECT_CARDS:
        raise SystemExit('[fail] 成长表里是 %d 张卡，预期 %d' % (len(cards), EXPECT_CARDS))

    xml = read_zip_rows(GROWTH_XLSX, GROWTH_MEMBER)
    sst = read_zip_rows(GROWTH_XLSX, GROWTH_SST)
    strings = shared_strings(GROWTH_XLSX)

    # ── 守卫 1：字段行 ────────────────────────────────────────────────────
    fields = field_names(xml, strings)
    actual = [fields.get(col_letter(i)) for i in range(len(GROWTH_COLUMNS))]
    if actual != GROWTH_COLUMNS:
        raise SystemExit('[fail] PVP成长 字段行是 %r，预期 %r' % (actual, GROWTH_COLUMNS))

    # ── 守卫 2：动手前的形状 ──────────────────────────────────────────────
    dimension = re.search(r'<dimension ref="([^"]+)"', xml)
    if not dimension or dimension.group(1) != OLD_DIMENSION:
        raise SystemExit('[fail] dimension 是 %r，预期 %r —— 表被人改过，拒绝覆盖'
                         % (dimension.group(1) if dimension else None, OLD_DIMENSION))
    if last_data_row(xml) != OLD_LAST_ROW:
        raise SystemExit('[fail] 最后数据行是 %d，预期 %d' % (last_data_row(xml), OLD_LAST_ROW))
    # 68001 第 1 级：C 列还是原来的品质补偿 45。
    first = None
    for m in re.finditer(r'<c r="A(\d+)"[^>]*>(.*?)</c>', xml, re.S):
        if int(m.group(1)) < DATA_START:
            continue
        if cell_value(xml, 'A%d' % int(m.group(1)), strings) == '68001':
            first = int(m.group(1))
            break
    if first is None or cell_value(xml, 'C%d' % first, strings) != '45':
        raise SystemExit('[fail] 68001 第 1 级的 attackFlat 不是 45，表被人改过，拒绝覆盖')

    # ── sharedStrings：给 35 张卡解出下标，缺的追加 ────────────────────────
    header = re.search(r'count="(\d+)" uniqueCount="(\d+)"', sst)
    if not header:
        raise SystemExit('[fail] sharedStrings 缺 count/uniqueCount')
    total, unique = int(header.group(1)), int(header.group(2))
    string_index = {}
    added = []
    for card in cards:
        if card in strings:
            string_index[card] = strings.index(card)
        else:
            string_index[card] = unique + len(added)
            added.append(card)

    # 删 375 个 unitId 引用、加 1750 个 ⇒ 净增 1375。
    old_refs = OLD_LAST_ROW - DATA_START + 1
    new_total = total - old_refs + len(rows)
    new_unique = unique + len(added)
    sst = sst.replace(header.group(0), 'count="%d" uniqueCount="%d"' % (new_total, new_unique))
    if added:
        sst = sst.replace('</sst>', ''.join('<si><t>%s</t></si>' % item for item in added) + '</sst>')

    # ── 重写数据区 ────────────────────────────────────────────────────────
    styles = styles_of_row(xml, OLD_LAST_ROW)
    xml = strip_data_rows(xml)
    target = DATA_START - 1
    chunks = []
    for row in rows:
        target += 1
        values = [
            str(row['unitId']),
            int(row['level']),
            row['attackFlat'],
            row['attackRate'],
            row['maxHpFlat'],
            row['maxHpRate'],
            row['moveSpeedRate'],
            row['attackRangeFlat'],
            int(row['enabled']),
        ]
        chunks.append(build_shared_row(target, values, styles, string_index[values[0]]))
    xml = xml.replace('</sheetData>', ''.join(chunks) + '</sheetData>', 1)
    xml = bump_dimension(xml, target)

    backup = write_zip_members(GROWTH_XLSX, {GROWTH_MEMBER: xml, GROWTH_SST: sst},
                               BACKUP_DIR, 'growth-from-cardlevelup')
    print('[PVP成长] %d → %d 行（第 %d~%d 行），sharedStrings uniqueCount %d → %d'
          % (old_refs, len(rows), DATA_START, target, unique, new_unique))
    print('  备份：%s' % backup)

    # ── 回读校验 ──────────────────────────────────────────────────────────
    check_xml = read_zip_rows(GROWTH_XLSX, GROWTH_MEMBER)
    check_strings = shared_strings(GROWTH_XLSX)
    if last_data_row(check_xml) != target:
        raise SystemExit('[fail] 回读最后一行是 %d，预期 %d' % (last_data_row(check_xml), target))
    by_key = {}
    for m in re.finditer(r'<c r="A(\d+)"[^>]*>(.*?)</c>', check_xml, re.S):
        row_num = int(m.group(1))
        if row_num < DATA_START:
            continue
        unit_id = cell_value(check_xml, 'A%d' % row_num, check_strings)
        level = cell_value(check_xml, 'B%d' % row_num, check_strings)
        by_key['%s:%s' % (unit_id, int(float(level)))] = row_num
    if len(by_key) != len(rows):
        raise SystemExit('[fail] 回读 %d 条唯一键，预期 %d' % (len(by_key), len(rows)))
    for card in cards:
        for level in (1, 25, 26, 50):
            row_num = by_key.get('%s:%d' % (card, level))
            if row_num is None:
                raise SystemExit('[fail] 回读缺 %s:%d' % (card, level))
    sample = by_key['68007:50']
    print('  抽样 68007 L50：atkFlat=%s hpFlat=%s enabled=%s'
          % (cell_value(check_xml, 'C%d' % sample, check_strings),
             cell_value(check_xml, 'E%d' % sample, check_strings),
             cell_value(check_xml, 'I%d' % sample, check_strings)))


if __name__ == '__main__':
    main()
