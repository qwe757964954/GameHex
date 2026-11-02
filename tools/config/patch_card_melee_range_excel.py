# -*- coding: utf-8 -*-
"""把战士 / 坦克的射程 45 写回 `PVP-卡牌.xlsx` 的「单位攻击距离」列（X 列）。

目标清单从转表产物 `json/client/pvpCard.json` 反推（按 `traits.attack` 筛），
避免手工维护 id 列表漂移；写回后逐格自检，与 JSON 不一致直接报错。

手法沿用 sync_treant_excel 的 zip 级手术：只改目标单元格，不重排整行、不动样式。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    ROOT, find_row_by, read_zip_rows, set_cell, write_zip,
)

PATH = os.path.join(ROOT, 'PVP-卡牌.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
COL_RANGE = 'X'          # 单位攻击距离（unitAttackRange）
JOBS = ('战士', '坦克')
BACKUP = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'


def load_targets():
    path = os.path.join(ROOT, 'json', 'client', 'pvpCard.json')
    rows = json.load(open(path, encoding='utf-8'))
    targets = {}
    for row in rows:
        traits = row.get('traits')
        if not traits or traits.get('attack') not in JOBS:
            continue
        targets[int(row['id'])] = (row['name'], traits['attack'], row['unitAttackRange'])
    if len(targets) != 17:
        raise SystemExit('战士/坦克 应为 17 张，实际 %d 张' % len(targets))
    bad = [k for k, v in targets.items() if v[2] != 45]
    if bad:
        raise SystemExit('JSON 里还不是 45 的卡：%s（先跑 patch_melee_attack_range.js）' % bad)
    return targets


def main():
    targets = load_targets()
    xml = read_zip_rows(PATH, MEMBER)
    changed = []
    for card_id, (name, job, target) in sorted(targets.items()):
        row = find_row_by(xml, 'A', card_id)
        if not row:
            raise SystemExit('PVP-卡牌.xlsx 里找不到卡牌 %d' % card_id)
        xml = set_cell(xml, '%s%d' % (COL_RANGE, row), target)
        changed.append((card_id, name, job, row, target))
    backup = write_zip(PATH, MEMBER, xml, BACKUP)

    # 回读自检：写完必须与 JSON 完全一致
    from openpyxl import load_workbook
    wb = load_workbook(PATH, read_only=True, data_only=True)
    ws = wb['卡牌配置']
    seen = {}
    for row in ws.iter_rows(min_row=7, min_col=1, max_col=24, values_only=True):
        if isinstance(row[0], int):
            seen[row[0]] = row[23]
    wb.close()
    for card_id, _, _, _, target in changed:
        if seen.get(card_id) != target:
            raise SystemExit('回读不一致：%d 表内 %s / 期望 %s' % (card_id, seen.get(card_id), target))

    print('[ok] PVP-卡牌.xlsx 改了 %d 个单元格（X 列 / 单位攻击距离）' % len(changed))
    for card_id, name, job, row, target in changed:
        print('   行%-3d %-6d %-8s %s → %d' % (row, card_id, name, job, target))
    print('备份：', backup, os.path.getsize(backup))


if __name__ == '__main__':
    main()
