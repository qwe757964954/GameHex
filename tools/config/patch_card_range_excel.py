# -*- coding: utf-8 -*-
"""把法师 550 / 射手 500 写回 `PVP-卡牌.xlsx` 的「单位攻击距离」列（X 列）。

只改单元格值，不增删行；手法沿用 sync_treant_excel 的 zip 级手术（不重排整张表、不动样式）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    ROOT, find_row_by, read_zip_rows, set_cell, write_zip,
)

PATH = os.path.join(ROOT, 'PVP-卡牌.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
COL_RANGE = 'X'          # 单位攻击距离（unitAttackRange）
BACKUP = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'

# 卡牌 id -> 目标射程（与 patch_ranged_attack_range.js 写进 JSON 的值一一对应）
TARGETS = {
    # 法师 550
    68003: 550, 68010: 550, 68011: 550, 68015: 550, 68022: 550,
    68024: 550, 68026: 550, 68030: 550, 68034: 550,
    # 射手 500
    68001: 500, 68004: 500, 68008: 500, 68012: 500, 68013: 500,
    68017: 500, 68020: 500, 68032: 500, 68035: 500,
}


def main():
    xml = read_zip_rows(PATH, MEMBER)
    changed = []
    for card_id, target in TARGETS.items():
        row = find_row_by(xml, 'A', card_id)
        if not row:
            raise SystemExit('PVP-卡牌.xlsx 里找不到卡牌 %d' % card_id)
        name_cell = find_row_by(xml, 'A', card_id)
        xml = set_cell(xml, '%s%d' % (COL_RANGE, row), target)
        changed.append((card_id, name_cell, target))
    backup = write_zip(PATH, MEMBER, xml, BACKUP)
    print('[ok] PVP-卡牌.xlsx 改了 %d 个单元格（X 列）' % len(changed))
    for card_id, row, target in changed:
        print('   行%-3d 卡牌 %d → %d' % (row, card_id, target))
    print('备份：', backup, os.path.getsize(backup))


if __name__ == '__main__':
    main()
