# -*- coding: utf-8 -*-
"""按卡牌 id 改 `PVP-卡牌.xlsx` 的 `unitPrefabPath` 列（唯一真源是这张 Excel）。

## 为什么需要它

`pvpCard` 和 `monsterCard` 是两张表、两套 id（卡牌 68001+ / 怪物卡 50001+），
同一个英雄的 `unitPrefabPath` 会各自演进，于是出现「怪物卡早就换骨骼、卡牌还停在序列帧」
这种单边改的情况 —— 2026-11-11 雷蕉（68022）就是：怪物卡 50024 已是
`skel/香蕉雷神/香蕉雷神`，卡牌还指 `units/萨满/萨满`（萨满的序列帧，萨尔也在共用）。

`patch_monster_card_model_excel.py` 干的是反方向（拿卡牌表对齐怪物卡表），
本脚本补上「直接改卡牌表」这条路，两只脚才对称。

## 口径

- 列位置**按第 5 行字段名动态查**（不是写死 AG）：两张表的列序不同，
  怪物卡表 `unitPrefabPath` 在 AF，卡牌表在 AG，写死会改错列。
- 只改目标行该列，其余列/行一个字不动。
- 走 zip 级 XML（`sync_treant_excel.set_cell`），不引 openpyxl —— 它会按 XFD 整表重写。

用法：
    python tools/config/patch_pvp_card_model_excel.py --dry-run 68022=skel/香蕉雷神/香蕉雷神
    python tools/config/patch_pvp_card_model_excel.py 68022=skel/香蕉雷神/香蕉雷神
改完必须同步两套 json（`patch_card_model_json.js`）：
    node tools/config/patch_card_model_json.js pvpCard 68022=skel/香蕉雷神/香蕉雷神
"""
import argparse
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

XLSX = 'D:/City1001/doc/塔防数据配置/PVP-卡牌.xlsx'
SHEET = 'xl/worksheets/sheet1.xml'
BACKUP = 'D:/City1001/Demo3.8/tmp/_bak_xlsx'

FIELD_ROW = 5          # 第 5 行字段名
FIRST_DATA_ROW = 7     # 第 7 行起数据
COL_ID = 'A'
COL_FIELD = 'unitPrefabPath'


def read_shared_strings(z):
    if 'xl/sharedStrings.xml' not in z.namelist():
        return []
    root = ET.fromstring(z.read('xl/sharedStrings.xml'))
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    return [''.join(t.text or '' for t in si.iter(ns + 't')) for si in root.iter(ns + 'si')]


def cell_text(attrs, body, shared):
    texts = re.findall(r'<t[^>]*>(.*?)</t>', body, re.S)
    if texts:
        return ''.join(texts)
    values = re.findall(r'<v>(.*?)</v>', body, re.S)
    if not values:
        return ''
    raw = values[0]
    # `t="s"` 存的是 sharedStrings 下标，直接当文本会静默失配（怪物卡脚本踩过）
    if 't="s"' in attrs:
        index = int(raw)
        return shared[index] if 0 <= index < len(shared) else ''
    return raw


def read_rows(xml, shared):
    """行号 → {列: 文本}。"""
    rows = {}
    for match in re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S):
        cells = {}
        for cell in re.finditer(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', match.group(2), re.S):
            cells[cell.group(1)] = cell_text(cell.group(2), cell.group(3) or '', shared)
        rows[int(match.group(1))] = cells
    return rows


def find_column(rows, field):
    header = rows.get(FIELD_ROW) or {}
    for col, name in header.items():
        if name.strip() == field:
            return col
    raise SystemExit('第 %d 行找不到字段 %s' % (FIELD_ROW, field))


def plan(rows, column, targets):
    """[(单元格, 卡牌id, 旧值, 新值)]；目标 id 不存在直接报错，不静默跳过。"""
    by_id = {}
    for row_num, cells in rows.items():
        if row_num < FIRST_DATA_ROW:
            continue
        raw = (cells.get(COL_ID) or '').strip()
        if raw.isdigit():
            by_id[int(raw)] = (row_num, cells.get(column, ''))
    missing = [str(card_id) for card_id in targets if card_id not in by_id]
    if missing:
        raise SystemExit('表里找不到卡牌 id：%s' % ', '.join(missing))
    changes = []
    for card_id, wanted in targets.items():
        row_num, current = by_id[card_id]
        if current == wanted:
            continue
        changes.append(('%s%d' % (column, row_num), card_id, current, wanted))
    return changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='只打印计划，不落盘')
    parser.add_argument('pairs', nargs='+', help='卡牌id=模型路径')
    args = parser.parse_args()

    targets = {}
    for pair in args.pairs:
        card_id, _, path = pair.partition('=')
        if not path:
            raise SystemExit('参数格式不对：%s，应为 id=路径' % pair)
        targets[int(card_id)] = path

    xml = read_zip_rows(XLSX, SHEET)
    with zipfile.ZipFile(XLSX) as z:
        shared = read_shared_strings(z)
    rows = read_rows(xml, shared)
    column = find_column(rows, COL_FIELD)
    changes = plan(rows, column, targets)
    if not changes:
        print('无需改动')
        return
    for ref, card_id, old, new in changes:
        print('%-6s %-8s %-28s → %s' % (ref, card_id, old or '(空)', new))
    if args.dry_run:
        print('\n共 %d 处（dry-run，未写入）' % len(changes))
        return
    for ref, _card_id, _old, new in changes:
        xml = set_cell(xml, ref, new)
    backup = write_zip(XLSX, SHEET, xml, BACKUP)
    print('\n共写入 %d 处；原文件备份 → %s' % (len(changes), backup))


if __name__ == '__main__':
    main()
