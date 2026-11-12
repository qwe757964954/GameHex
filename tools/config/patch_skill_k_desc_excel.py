# -*- coding: utf-8 -*-
"""把 `armySkillLevelUp` 的 name / desc 写进源表 `K-卡牌升级.xlsx / 卡牌技能升级表`。

## 为什么

`armySkillLevelUp.desc` 是**卡片 UI 真正读的那份描述**（`CardSkillDescMarkup`），而它的源表
是 `K-卡牌升级.xlsx` 的 B（name）/ C（desc）两列。改完导出的两份 JSON 不回写源表，
下次谁从源表重导一次，新文案（触发距离 / 落雷间距）就静默退回旧值。

68026 麻辣铁锅的 102603 / 102604 六行**表里有行、B/C 是空的**（2026-11-12 实测），
所以本脚本按 `id + skilllevel` 定位后直接写，不新增行。

## 为什么走 zip 级手术

该页签有大量**公式单元格**（`N` 档位、`O` 拼接文案）。openpyxl 保存只写公式不写缓存值，
而转表器读缓存值 ⇒ 整表会导成空。所以只替换 B/C 的 `<c>` 元素，其余字节原样保留
（与 `patch_magdi_mushroom_k.py` 同一套手法）。

用法：
    python tools/config/patch_skill_k_desc_excel.py              # 默认 102603 102604
    python tools/config/patch_skill_k_desc_excel.py 102601 102602 102603 102604
"""
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REMOTE_ARMY = os.path.join(ROOT, 'assets', 'remoteRef', 'armySkillLevelUp.json')

PATH = 'D:/Alan/Project/POW/doc/塔防数据配置/K-卡牌升级.xlsx'
MEMBER = 'xl/worksheets/sheet2.xml'      # workbook.xml: 卡牌技能升级表 = rId2
SHEET_NAME = '卡牌技能升级表'
BACKUP_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置_历史备份'

COL_ID = 'A'
COL_NAME = 'B'
COL_DESC = 'C'
COL_LEVEL = 'E'

DEFAULT_IDS = (102603, 102604)


def load_records():
    data = json.load(open(REMOTE_ARMY, encoding='utf-8'))
    keys = data['k']
    wanted = tuple(int(a) for a in sys.argv[1:]) or DEFAULT_IDS
    out = {}
    for row in data['v']:
        record = dict(zip(keys, row))
        if record['id'] in wanted:
            out[(record['id'], record['skilllevel'])] = record
    if not out:
        raise SystemExit('[fail] remoteRef/armySkillLevelUp.json 里找不到 %s' % (wanted,))
    return out


def main():
    records = load_records()

    #  逻辑坐标（id / level）→ 物理行号：用 openpyxl 只读定位，不参与写盘。
    import openpyxl
    book = openpyxl.load_workbook(PATH, read_only=True, data_only=True)
    sheet = book[SHEET_NAME]
    row_of = {}
    for index, row in enumerate(sheet.iter_rows(min_row=1, values_only=True), start=1):
        if row[0] is None or not isinstance(row[4], (int, float)):
            continue
        key = (int(row[0]), int(row[4]))
        if key in records:
            row_of[key] = index
    book.close()

    missing = sorted(set(records) - set(row_of))
    if missing:
        raise SystemExit('[fail] 表里缺这些行：%s' % (missing,))

    xml = read_zip_rows(PATH, MEMBER)
    for key, row_index in sorted(row_of.items(), key=lambda pair: pair[1]):
        record = records[key]
        name = record.get('name') or ''
        desc = record.get('desc') or ''
        xml = set_cell(xml, '%s%d' % (COL_NAME, row_index), name)
        xml = set_cell(xml, '%s%d' % (COL_DESC, row_index), desc)
        print('  第 %d 行  %s L%d  %s' % (row_index, record['id'], record['skilllevel'],
                                        desc[:40] + '…' if len(desc) > 40 else desc))

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    source = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    backup = os.path.join(BACKUP_DIR, '%s.bak-%s' % (os.path.basename(PATH), stamp))
    if os.path.isfile(source) and source != backup:
        os.replace(source, backup)

    #  回读：openpyxl 逐行比对，避免「写进去了但转表读不到」那种静默失败。
    book = openpyxl.load_workbook(PATH, read_only=True, data_only=True)
    sheet = book[SHEET_NAME]
    for key, row_index in row_of.items():
        row = list(sheet.iter_rows(min_row=row_index, max_row=row_index, values_only=True))[0]
        expected = records[key]
        if str(row[1]) != str(expected.get('name')) or str(row[2]) != str(expected.get('desc')):
            raise SystemExit('[fail] 回读不一致：%s 第 %d 行' % (key, row_index))
    book.close()
    print('[ok] 回读通过（%d 行）；备份 %s' % (len(row_of), backup))


if __name__ == '__main__':
    main()
