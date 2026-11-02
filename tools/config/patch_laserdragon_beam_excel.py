# -*- coding: utf-8 -*-
"""把镭射飞龙两条技能行的「技能特效预设」写回 `PVP-技能.xlsx`（J 列 / effectPrefabPath）。

目标值从转表产物 `json/client/pvpSkill.json` 反推，与 `patch_laserdragon_beam.js` 同源；
手法沿用 sync_treant_excel 的 zip 级手术，写完回读自检。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    ROOT, find_row_by, read_zip_rows, set_cell, write_zip,
)

PATH = os.path.join(ROOT, 'PVP-技能.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
COL_PATH = 'J'           # 技能特效预设（effectPrefabPath）
SKILL_IDS = (30719, 30845)
BACKUP = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'


def main():
    rows = json.load(open(os.path.join(ROOT, 'json', 'client', 'pvpSkill.json'), encoding='utf-8'))
    targets = {}
    for row in rows:
        if int(row['skillId']) in SKILL_IDS:
            targets[int(row['skillId'])] = row['effectPrefabPath']
    if len(targets) != len(SKILL_IDS):
        raise SystemExit('client json 里缺技能行：%s' % (set(SKILL_IDS) - set(targets)))
    if any('镭射飞龙_普攻' not in v for v in targets.values()):
        raise SystemExit('json 里的路径还不是光束预制品：%s' % targets)

    xml = read_zip_rows(PATH, MEMBER)
    changed = []
    for skill_id, path in sorted(targets.items()):
        row = find_row_by(xml, 'A', skill_id)
        if not row:
            raise SystemExit('PVP-技能.xlsx 里找不到技能 %d' % skill_id)
        xml = set_cell(xml, '%s%d' % (COL_PATH, row), path)
        changed.append((skill_id, row, path))
    backup = write_zip(PATH, MEMBER, xml, BACKUP)

    from openpyxl import load_workbook
    wb = load_workbook(PATH, read_only=True, data_only=True)
    ws = wb['技能配置']
    seen = {}
    for row in ws.iter_rows(min_row=7, min_col=1, max_col=18, values_only=True):
        if isinstance(row[0], int):
            seen[row[0]] = row[9]
    wb.close()
    for skill_id, _, path in changed:
        if seen.get(skill_id) != path:
            raise SystemExit('回读不一致：%d 表内 %s / 期望 %s' % (skill_id, seen.get(skill_id), path))

    print('[ok] PVP-技能.xlsx 改了 %d 个单元格（J 列 / 技能特效预设）' % len(changed))
    for skill_id, row, path in changed:
        print('   行%-3d %-6d → %s' % (row, skill_id, path))
    print('备份：', backup, os.path.getsize(backup))


if __name__ == '__main__':
    main()
