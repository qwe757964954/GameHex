# -*- coding: utf-8 -*-
"""按卡牌 id 改 `PVP-卡牌.xlsx` 的单个数值单元格（与 patch_pvp_card_field.js 成对使用）。

只改单元格值，不增删行；沿用 sync_treant_excel 的 zip 级手术（不重排整张表、不动样式）。

用法：
    python tools/config/patch_card_cell_excel.py unitMaxHp 68001=40 68012=50
    python tools/config/patch_card_cell_excel.py unitAttackRange 68003=550
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    ROOT, find_row_by, read_zip_rows, set_cell, write_zip,
)

PATH = os.path.join(ROOT, 'PVP-卡牌.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'

# 卡表列顺序（表头第 5 行的字段名，A 起算）。与 pvpCard.json 的键一一对应。
CARD_COLUMNS = [
    'id', 'name', 'type', 'rarity', 'unitId', 'traits', 'skillList', 'enabled',
    'description', 'buildSeconds', 'buildAttackTime', 'buildAttackRange', 'buildDamge',
    'goldDigTime', 'soilderAddTime', 'cycleBaseValue', 'buildDigGoldNum', 'baseHp',
    'buildNumLimit', 'cyclePerTierValue', 'unitMaxHp', 'unitAttack', 'unitMoveSpeed',
    'unitAttackRange', 'unitAttackInterval', 'unitAttackDuration', 'unitAttackHitTime',
    'unitBodyRadius', 'unitFlying', 'unitCanAttackAir', 'unitHero', 'unitStatus',
    'unitPrefabPath', 'prefabSize', 'unitSkillId', 'attackStyle', 'headIcon', 'buildIcon',
]


def colLetter(index):
    out = ''
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        out = chr(65 + rem) + out
    return out


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        raise SystemExit('用法：python patch_card_cell_excel.py <字段名> <卡牌id=值> [...]')
    field, pairs = args[0], args[1:]
    if field not in CARD_COLUMNS:
        raise SystemExit(f'卡表没有字段 {field}；可选：{", ".join(CARD_COLUMNS)}')
    col = colLetter(CARD_COLUMNS.index(field))

    targets = {}
    for pair in pairs:
        card_id, value = pair.split('=')
        targets[int(card_id)] = float(value) if '.' in value else int(value)

    xml = read_zip_rows(PATH, MEMBER)
    for card_id, value in targets.items():
        row = find_row_by(xml, 'A', card_id)
        if not row:
            raise SystemExit('PVP-卡牌.xlsx 里找不到卡牌 %d' % card_id)
        xml = set_cell(xml, '%s%d' % (col, row), value)

    backup = write_zip(PATH, MEMBER, xml, BACKUP)
    detail = '，'.join('%d → %s' % (card_id, value) for card_id, value in targets.items())
    print('[ok] PVP-卡牌.xlsx %s（%s 列）%s' % (field, col, detail))
    print('备份：', backup, os.path.getsize(backup))


if __name__ == '__main__':
    main()
