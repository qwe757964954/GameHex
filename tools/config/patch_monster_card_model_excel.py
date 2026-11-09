# -*- coding: utf-8 -*-
"""把 `PVP-怪物卡牌.xlsx` 的 `unitPrefabPath`（AF 列）同步到 `PVP-卡牌.xlsx` 的口径。

## 问题（2026-11-06 山猫问「怪物卡牌模型是不是没跟卡牌同步」）

两张表同一个英雄的 `unitPrefabPath` 不一致：卡牌表早就换成了新的 spine
（`skel/<英雄名>/<英雄名>`），怪物卡表有 13 行还停在老的塔防 `units/<兵种名>`，
而且指向的是**别的兵种**（玉林好汉→女猎手、魔术师→驭兽师 …），
明显是「新模型没出图时先借一个凑」留下的占位。

同名的 37 个英雄里 24 个已经一致，这 13 个是漏改；13 个目标 spine 目录
（`assets/resources/skel/<名>/`）**全都在盘上**，所以是纯表数据问题，不是美术缺口。

## 口径

只按 **同名英雄** 对齐（两张表的 id 是两套阵营：卡牌 68001+、怪物卡 50001+，id 对不上）。
只改 `unitPrefabPath` 一列，其余列一个字都不动。

用法：
    python tools/config/patch_monster_card_model_excel.py --dry-run
    python tools/config/patch_monster_card_model_excel.py
改完必须重新导表：`npm run config:export`
"""
import argparse
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

XLSX = 'D:/City1001/doc/塔防数据配置/PVP-怪物卡牌.xlsx'
SHEET = 'xl/worksheets/sheet1.xml'
BACKUP = 'D:/City1001/Demo3.8/tmp/_bak_xlsx'

# 第 5 行字段名、第 6 行类型，数据从第 7 行起。AF = unitPrefabPath。
FIRST_DATA_ROW = 7
COL_ID = 'A'
COL_NAME = 'B'
COL_MODEL = 'AF'

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load_json(name):
    path = os.path.join(PROJECT_ROOT, 'assets', 'remoteRef', f'{name}.json')
    with open(path, encoding='utf-8') as fh:
        payload = json.load(fh)
    keys = payload['k']
    return [dict(zip(keys, row)) for row in payload['v']]


def read_shared_strings():
    """`xl/sharedStrings.xml` → 字符串数组（`t="s"` 的单元格存的是它的下标）。"""
    with zipfile.ZipFile(XLSX) as z:
        if 'xl/sharedStrings.xml' not in z.namelist():
            return []
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    return [''.join(t.text or '' for t in si.iter(ns + 't')) for si in root.iter(ns + 'si')]


def read_cells(xml):
    """行号 → {列: 文本}（够本脚本用；不引 openpyxl）。"""
    shared = read_shared_strings()
    rows = {}
    for match in re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S):
        row_num = int(match.group(1))
        if row_num < FIRST_DATA_ROW:
            continue
        cells = {}
        for cell in re.finditer(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', match.group(2), re.S):
            col, attrs, body = cell.group(1), cell.group(2), cell.group(3) or ''
            texts = re.findall(r'<t[^>]*>(.*?)</t>', body, re.S)
            if texts:
                cells[col] = ''.join(texts)
                continue
            values = re.findall(r'<v>(.*?)</v>', body, re.S)
            if not values:
                cells[col] = ''
                continue
            raw = values[0]
            # `t="s"` ⇒ 这是 sharedStrings 的下标，不是文本本身（踩过：直接拿 `<v>` 会给出一串数字，
            # 于是按名字对齐全部失配、"无需改动" 假通过）。
            if 't="s"' in attrs:
                index = int(raw)
                cells[col] = shared[index] if 0 <= index < len(shared) else ''
            else:
                cells[col] = raw
        rows[row_num] = cells
    return rows


def plan(rows):
    """[(单元格, 新值, 旧值, 英雄名)] —— 只收「同名英雄两表模型不一致」的行。"""
    card_by_name = {card.get('name'): card.get('unitPrefabPath') for card in load_json('pvpCard')}
    monster_by_id = {m.get('id'): m for m in load_json('monsterCard')}
    changes = []
    for row_num, cells in sorted(rows.items()):
        raw_id = (cells.get(COL_ID) or '').strip()
        if not raw_id:
            continue
        try:
            card_id = int(raw_id)
        except ValueError:
            continue
        name = (cells.get(COL_NAME) or '').strip()
        wanted = card_by_name.get(name)
        if not wanted:
            continue
        current = monster_by_id.get(card_id, {}).get('unitPrefabPath')
        if current == wanted:
            continue
        changes.append(('%s%d' % (COL_MODEL, row_num), wanted, current, name))
    return changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='只打印计划，不落盘')
    args = parser.parse_args()

    xml = read_zip_rows(XLSX, SHEET)
    changes = plan(read_cells(xml))
    if not changes:
        print('无需改动')
        return
    for ref, new, old, name in changes:
        print('%-5s %-8s %-30s → %s' % (ref, name, old or '(空)', new))
    if args.dry_run:
        print('\n共 %d 处（dry-run，未写入）' % len(changes))
        return
    for ref, new, _old, _name in changes:
        xml = set_cell(xml, ref, new)
    backup = write_zip(XLSX, SHEET, xml, BACKUP)
    print('\n共写入 %d 处；原文件备份 → %s' % (len(changes), backup))


if __name__ == '__main__':
    main()
