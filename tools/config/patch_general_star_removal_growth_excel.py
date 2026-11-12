# -*- coding: utf-8 -*-
"""把「摘掉星级表后的固定攻击补偿」写回 `doc/塔防数据配置/PVP-修改器适配.xlsx` 的 `PVP成长`。

配套脚本：`patch_general_star_removal_growth.js`（写两份 json）。两边必须一起改，
否则下次 eSon 打表（以 Excel 为准）会把 json 里的 `attackFlat` 刷回 0。

改什么
──────
68001~68014 这 14 张老卡，1~25 级的 `attackFlat`（C 列）按品质写死：

    品质 1 → 45   品质 2 → 55   品质 3 → 65   品质 4 → 75

动手前的实际情况：只有 68001 有 1~4 级、68025 有 1~25 级，其余 13 张老卡一行都没有。
所以这里除了改已有的 4 行，还要补 346 行（13 张 × 25 级 + 68001 的 5~25 级）。
新补行的比例列（D/F）沿用该卡最后一级的值：68001 是 0.15，其余 13 张是 0 ——
理由见 js 脚本头部注释，核心是「不能让 5 级出现升一级倒扣 15% 的断崖」。

守卫
────
· 字段名行（第 5 行）必须与预期一致，列序被插列改乱就报错；
· 68001 的 1~4 级必须还是 0 / 0.05 / 0.10 / 0.15，跑偏了说明表被人动过，拒绝覆盖；
· 68002~68014 必须一行都没有（否则说明已经补过，重复跑会产生重复键）；
· 写完用 openpyxl 只读回读校验（不 save，避免二次破坏）。

沿用 `sync_treant_excel` 的 zip 级手术：只重写 sheet3.xml 与 sharedStrings.xml，
其余条目原样复制。`PVP成长` 的 unitId 是 `t="s"` 共享字符串，13 个新 id 要先塞进
sharedStrings 才能引用。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    ROOT, col_letter, build_row, bump_dimension, read_zip_rows, set_cell, styles_of_row,
    last_data_row,
)
from patch_storm_radius_growth_excel import (  # noqa: E402
    write_zip_members, shared_strings,
)

GROWTH_XLSX = os.path.join(ROOT, 'PVP-修改器适配.xlsx')
GROWTH_MEMBER = 'xl/worksheets/sheet3.xml'      # workbook.xml：rId3 = PVP成长
GROWTH_SST = 'xl/sharedStrings.xml'
BACKUP_DIR = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'

FIELD_ROW = 5
DATA_START = 7
GROWTH_COLUMNS = ['unitId', 'level', 'attackFlat', 'attackRate', 'maxHpFlat',
                  'maxHpRate', 'moveSpeedRate', 'attackRangeFlat', 'enabled']

MAX_LEVEL = 25
FLAT_BY_QUALITY = {1: 45, 2: 55, 3: 65, 4: 75}

OLD_CARDS = [
    ('68001', '豌豆游侠', 1), ('68002', '巨力坚果', 1),
    ('68003', '火焰树妖', 2), ('68004', '玉林好汉', 2),
    ('68005', '椰蛋战士', 3), ('68006', '波利奥', 3),
    ('68007', '吞噬大嘴花', 4), ('68008', '杰克藕', 4),
    ('68009', '仙桃行者', 4), ('68010', '镭射飞龙', 4),
    ('68011', '水手菇', 1), ('68012', '菇八戒', 1),
    ('68013', '玛法', 3), ('68014', '分裂菇', 3),
]

#  68001 动手前的四行比例值，作为「这张表没被动过」的指纹。
EXPECT_68001_RATES = {1: 0.0, 2: 0.05, 3: 0.10, 4: 0.15}


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
    """读一格：`t="s"` 走共享字符串，其它按原文返回字符串（数字再自己转）。"""
    m = re.search(r'<c r="%s"([^>]*)>(.*?)</c>' % ref, xml, re.S)
    if not m:
        return None
    attrs, inner = m.group(1), m.group(2)
    raw = re.search(r'<v>(.*?)</v>', inner, re.S)
    if not raw:
        return None
    return strings[int(raw.group(1))] if 't="s"' in attrs else raw.group(1)


def index_rows(xml, strings):
    """unitId → {level: excel 行号}；unitId 列是共享字符串，必须解引用。"""
    out = {}
    for m in re.finditer(r'<c r="A(\d+)"([^>]*)>(.*?)</c>', xml, re.S):
        row = int(m.group(1))
        if row < DATA_START:
            continue
        ref = cell_value(xml, 'A%d' % row, strings)
        level = cell_value(xml, 'B%d' % row, strings)
        if ref is None or level is None:
            continue
        out.setdefault(str(ref), {})[int(float(level))] = row
    return out


def main():
    xml = read_zip_rows(GROWTH_XLSX, GROWTH_MEMBER)
    sst = read_zip_rows(GROWTH_XLSX, GROWTH_SST)
    strings = shared_strings(GROWTH_XLSX)

    fields = field_names(xml, strings)
    actual = [fields.get(col_letter(i)) for i in range(len(GROWTH_COLUMNS))]
    if actual != GROWTH_COLUMNS:
        raise SystemExit('[fail] PVP成长 字段行是 %r，预期 %r' % (actual, GROWTH_COLUMNS))

    rows_by_unit = index_rows(xml, strings)

    # ── 守卫 1：68001 的四行比例值必须还是原样 ──────────────────────────────
    got = rows_by_unit.get('68001', {})
    for level, rate in EXPECT_68001_RATES.items():
        if level not in got:
            raise SystemExit('[fail] 68001 少了第 %d 级' % level)
        now = float(cell_value(xml, 'D%d' % got[level], strings))
        if abs(now - rate) > 1e-9:
            raise SystemExit('[fail] 68001 第 %d 级 attackRate 是 %s，预期 %s —— 表被人改过，拒绝覆盖'
                             % (level, now, rate))

    # ── 守卫 2：其余 13 张必须一行都没有 ────────────────────────────────────
    clashed = [cid for cid, _, _ in OLD_CARDS[1:] if rows_by_unit.get(cid)]
    if clashed:
        raise SystemExit('[fail] %s 已经有行，重复跑会产生重复键，先人工确认' % ','.join(clashed))

    # ── 新 unitId 塞进 sharedStrings ───────────────────────────────────────
    m = re.search(r'count="(\d+)" uniqueCount="(\d+)"', sst)
    if not m:
        raise SystemExit('[fail] sharedStrings 缺 count/uniqueCount')
    total, unique = int(m.group(1)), int(m.group(2))
    added_strings = []
    string_index = {}
    for cid, _, _ in OLD_CARDS:
        if cid in rows_by_unit:
            #  68001 已经在 sharedStrings 里，复用原来的下标（5~25 级也要引用它）。
            string_index[cid] = strings.index(cid)
            continue
        string_index[cid] = unique + len(added_strings)
        added_strings.append(cid)
    new_total = total + sum(MAX_LEVEL - len(rows_by_unit.get(cid, {}))
                            for cid, _, _ in OLD_CARDS)
    new_unique = unique + len(added_strings)
    sst = sst.replace(m.group(0), 'count="%d" uniqueCount="%d"' % (new_total, new_unique))
    if added_strings:
        sst = sst.replace('</sst>', ''.join('<si><t>%s</t></si>' % s for s in added_strings) + '</sst>')

    # ── 68001 的 1~4 级：只改 C 列 ─────────────────────────────────────────
    touched = 0
    for level in EXPECT_68001_RATES:
        xml = set_cell(xml, 'C%d' % got[level], 45)
        touched += 1

    # ── 追加缺的等级 ───────────────────────────────────────────────────────
    styles = styles_of_row(xml, last_data_row(xml))
    target = last_data_row(xml)
    first_last = target
    appended = {}
    for cid, name, quality in OLD_CARDS:
        flat = FLAT_BY_QUALITY[quality]
        have = rows_by_unit.get(cid, {})
        #  比例列锚点：该卡最后一级的值；没有历史行就是 0。
        anchor_rate = 0.0
        if have:
            anchor_row = have[max(have)]
            anchor_rate = float(cell_value(xml, 'D%d' % anchor_row, strings))
        add = 0
        for level in range(1, MAX_LEVEL + 1):
            if level in have:
                continue
            target += 1
            values = [cid, level, flat, anchor_rate, 0, anchor_rate, 0, 0, 1]
            row_xml = build_row(target, values, styles)
            #  unitId 用共享字符串，和表里既有行保持一致（既有行全是 t="s"）。
            row_xml = row_xml.replace(
                '<c r="A%d" s="%s" t="inlineStr"><is><t>%s</t></is></c>'
                % (target, styles.get('A'), cid),
                '<c r="A%d" s="%s" t="s"><v>%d</v></c>'
                % (target, styles.get('A'), string_index[cid]),
            )
            xml = xml.replace('</sheetData>', row_xml + '</sheetData>', 1)
            add += 1
        appended[cid] = (add, anchor_rate)
    xml = bump_dimension(xml, target)

    backup = write_zip_members(GROWTH_XLSX,
                               {GROWTH_MEMBER: xml, GROWTH_SST: sst},
                               BACKUP_DIR, 'star-removal')
    print('[ok] PVP成长：68001 改写 %d 行 attackFlat；追加 %d 行（备份 %s）'
          % (touched, target - first_last, backup))
    for cid, name, quality in OLD_CARDS:
        add, anchor = appended[cid]
        print('  %s %s 品质%d → attackFlat %d（补 %d 行，比例列锚点 %s）'
              % (cid, name, quality, FLAT_BY_QUALITY[quality], add, anchor))


def verify():
    import openpyxl

    wb = openpyxl.load_workbook(GROWTH_XLSX, read_only=True, data_only=True)
    ws = wb['PVP成长']
    rows = [r for r in ws.iter_rows(min_row=DATA_START, values_only=True) if r[0] is not None]
    wb.close()

    seen = {}
    for r in rows:
        cid, level = str(r[0]), int(r[1])
        if (cid, level) in seen:
            raise SystemExit('[fail] 回读发现重复键 %s:%d' % (cid, level))
        seen[(cid, level)] = r

    for cid, name, quality in OLD_CARDS:
        flat = FLAT_BY_QUALITY[quality]
        got = [seen[(cid, lv)] for lv in range(1, MAX_LEVEL + 1) if (cid, lv) in seen]
        if len(got) != MAX_LEVEL:
            raise SystemExit('[fail] 回读 %s 只有 %d 级' % (cid, len(got)))
        bad = [g for g in got if abs(float(g[2]) - flat) > 1e-9]
        if bad:
            raise SystemExit('[fail] 回读 %s 有 %d 行 attackFlat 不是 %s' % (cid, len(bad), flat))
    print('[verify] PVP成长 回读一致：14 张老卡各 %d 级，attackFlat 按品质 45/55/65/75' % MAX_LEVEL)


if __name__ == '__main__':
    main()
    verify()
