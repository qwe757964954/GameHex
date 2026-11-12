# -*- coding: utf-8 -*-
"""把「全队暴击伤害增幅」的 875 行写回 `doc/塔防数据配置/J-技能表.xlsx` 的 `PVP技能配置`。

配套脚本：`patch_lineup_crit_damage.js`（生成行 + 写两份 json + 导出 `tmp/lineup_crit_rows.json`）。
两边必须一起改，否则下次 eSon 打表（以 Excel 为准）会把新增行整块刷掉。

为什么单独一个脚本
──────────────────
这张表 2.4 MB、16 个页签，openpyxl 存盘会重写全部页签（丢样式/图表风险），所以沿用
`sync_treant_excel` 的 zip 级手术：只重写 `xl/worksheets/sheet9.xml`，其余条目逐字节复制。

好消息：`PVP技能配置` 页里**所有字符串都是 `t="inlineStr"`**（不是共享字符串），
所以完全不用碰 `sharedStrings.xml`，追加行的写法可以逐字复用 `sync_treant_excel.build_row`。

守卫
────
· 第 5 行字段名必须与 `SHEET_COLUMNS` 逐列一致（插列/改名就报错）；
· 末行必须是 462（数据 7~462 = 456 行）；
· D 列不许已存在 skillChainId=109001（重复跑会产生重复键）。

用法：python tools/config/patch_lineup_crit_damage_excel.py
"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    ROOT, build_row, bump_dimension, col_letter, read_zip_rows, styles_of_row,
)
from patch_dawtianlu_aura_punch_excel import sheet_member  # noqa: E402
from patch_storm_radius_growth_excel import shared_strings, write_zip_members  # noqa: E402

SKILL_XLSX = os.path.join(ROOT, 'J-技能表.xlsx')
SHEET_NAME = 'PVP技能配置'
BACKUP_DIR = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'
ROWS_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../tmp/lineup_crit_rows.json')

FIELD_ROW = 5
DATA_START = 7
EXPECT_LAST_ROW = 462
EXPECT_ROWS = 1750
CHAIN_ID = 109001

SHEET_COLUMNS = [
    'enabled', 'modifierId', 'unitId', 'skillChainId', 'skillName', 'skillLevel',
    'unlockHeroLevel', 'skillKind', 'passiveScope', 'progressionMode', 'pvpSkillId',
    'triggerEvent', 'behaviorKey', 'stateMode', 'targetSelector', 'statId', 'operation',
    'value', 'statusId', 'statusStatJson', 'durationSeconds', 'maxStacks',
    'replacementSkillId', 'cooldown', 'maxTriggers', 'desc', 'sourceVersion',
    'publishStatus', 'skillParamJson',
]


def strip_tags(fragment):
    texts = re.findall(r'<t[^>]*>(.*?)</t>', fragment, re.S)
    texts += re.findall(r'<v>(.*?)</v>', fragment, re.S)
    return texts[0] if texts else ''


def field_names(xml, strings):
    """第 FIELD_ROW 行逐列文本。

    这一页的**表头行是共享字符串（`t="s"`）、数据行却是 inlineStr** —— 两批工具写的，
    所以表头必须解引用 `sharedStrings.xml`，不能只看 `<t>`。
    """
    cells = {}
    for m in re.finditer(r'<c r="([A-Z]+)%d"([^>]*)>(.*?)</c>' % FIELD_ROW, xml, re.S):
        attrs, inner = m.group(2), m.group(3)
        if 't="s"' in attrs:
            index = re.search(r'<v>(\d+)</v>', inner)
            cells[m.group(1)] = strings[int(index.group(1))] if index else ''
            continue
        cells[m.group(1)] = strip_tags(inner)
    return cells


def column_values(xml, column):
    return {strip_tags(m.group(2)) for m in re.finditer(
        r'<c r="%s(\d+)"(?:[^>]*)>(.*?)</c>' % column, xml, re.S)}


def main():
    with open(ROWS_JSON, encoding='utf-8') as handle:
        rows = json.load(handle)
    if len(rows) != EXPECT_ROWS:
        raise SystemExit('[fail] 中间产物应为 %d 行，实际 %d 行' % (EXPECT_ROWS, len(rows)))

    member = sheet_member(SKILL_XLSX, SHEET_NAME)
    xml = read_zip_rows(SKILL_XLSX, member)
    strings = shared_strings(SKILL_XLSX)

    # ── 守卫 1：字段行 ──────────────────────────────────────────────────────
    fields = field_names(xml, strings)
    actual = [fields.get(col_letter(index)) for index in range(len(SHEET_COLUMNS))]
    if actual != SHEET_COLUMNS:
        raise SystemExit('[fail] %s 字段行是 %r，预期 %r' % (SHEET_NAME, actual, SHEET_COLUMNS))

    # ── 守卫 2：末行 ────────────────────────────────────────────────────────
    last = max(int(n) for n in re.findall(r'<row r="(\d+)"', xml))
    if last != EXPECT_LAST_ROW:
        raise SystemExit('[fail] 末行是 %d，预期 %d —— 表被改过，先人工确认' % (last, EXPECT_LAST_ROW))

    # ── 守卫 3：技能链未被占用 ──────────────────────────────────────────────
    if str(CHAIN_ID) in column_values(xml, 'D'):
        raise SystemExit('[fail] D 列已存在 skillChainId=%d，重复跑会产生重复键' % CHAIN_ID)

    styles = styles_of_row(xml, last)
    target = last
    for row in rows:
        target += 1
        values = [row[column] for column in SHEET_COLUMNS]
        xml = xml.replace('</sheetData>', build_row(target, values, styles) + '</sheetData>', 1)
    xml = bump_dimension(xml, target)

    backup = write_zip_members(SKILL_XLSX, {member: xml}, BACKUP_DIR, 'lineup-crit')
    print('[ok] %s / %s：追加 %d 行（%d → %d），成员 %s' % (
        os.path.basename(SKILL_XLSX), SHEET_NAME, target - last, last, target, member))
    print('[ok] 备份 → %s' % backup)


def verify():
    import openpyxl

    wb = openpyxl.load_workbook(SKILL_XLSX, read_only=True, data_only=True)
    sheet = wb[SHEET_NAME]
    rows = [r for r in sheet.iter_rows(min_row=DATA_START, values_only=True) if r[0] is not None]
    wb.close()

    if len(rows) != EXPECT_LAST_ROW - DATA_START + 1 + EXPECT_ROWS:
        raise SystemExit('[fail] 回读数据行 %d，预期 %d' % (len(rows), 456 + EXPECT_ROWS))

    seen = set()
    picked = {}
    for r in rows:
        row_key = (str(r[2]), int(r[3]), int(r[5]))
        if row_key in seen:
            raise SystemExit('[fail] 回读发现重复键 %s' % (row_key,))
        seen.add(row_key)
        if int(r[3]) == CHAIN_ID and str(r[2]) in ('68001', '68003', '68005', '68007') and int(r[5]) in (1, 50):
            #  (value, statId, operation, passiveScope, progressionMode)
            picked[(str(r[2]), int(r[5]))] = (r[17], r[15], r[16], r[8], r[9])

    expect = {
        ('68001', 1): (0.5, 'critDamage', 'add', 'owned', 'accumulate'),
        ('68001', 50): (0.5, 'critDamage', 'add', 'owned', 'accumulate'),
        ('68003', 1): (1, 'critDamage', 'add', 'owned', 'accumulate'),
        ('68003', 50): (1, 'critDamage', 'add', 'owned', 'accumulate'),
        ('68005', 1): (2, 'critDamage', 'add', 'owned', 'accumulate'),
        ('68005', 50): (2, 'critDamage', 'add', 'owned', 'accumulate'),
        ('68007', 1): (3, 'critDamage', 'add', 'owned', 'accumulate'),
        ('68007', 50): (3, 'critDamage', 'add', 'owned', 'accumulate'),
    }
    for row_key, want in expect.items():
        got = picked.get(row_key)
        if got is None:
            raise SystemExit('[fail] 回读缺行 %s' % (row_key,))
        #  value 比较放宽浮点差；其余三列必须严格相等
        if abs(float(got[0]) - float(want[0])) > 1e-9 or got[1:] != want[1:]:
            raise SystemExit('[fail] %s 回读 %r，预期 %r' % (row_key, got, want))
    print('[ok] 回读校验通过：%d 行、无重复键，抽样 8 格数值正确' % len(rows))


if __name__ == '__main__':
    main()
    verify()
