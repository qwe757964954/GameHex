# -*- coding: utf-8 -*-
"""补齐并修正 `DM-建筑配置.xlsx` 的 `baseBuildIcon` 列（I 列）。

两个问题一起修（2026-11-06 反馈 row14「基地建造建筑图标需要读表」）：

1. **同类建筑只有第 1 座配了图**：粮食田 71002 有图、71003~71006 空；木材田只有
   71007；铁矿田只有 71014。空列 ⇒ 客户端 `BigMapArtLoader` 只能退回按
   `baseBuildType` 的概念图，玩家看到「五座粮食田长得一样」的通用图。
   口径（山猫 2026-11-06）：「粮食田只配了 1，1-4 都按 1，其他类似」⇒ 同 type
   全部沿用该 type 里**已配的那张图**。

2. **路径少一个 s**：表里写 `image/building/…`、`image/territory/building/…`，
   磁盘实际是 `image/buildings/`、`image/territory/buildings/`（逐张核过都存在）。
   不改这个，补齐了也全是 404 ⇒ 仍然退回概念图。

`type=7`「小玩法入口」全表只有一座、没有同类可参照，保持空列（客户端回退概念图
`construction`，是个工地架子的通用图，视觉上不冲突）。

用法：
    python tools/config/patch_base_building_icon_excel.py --dry-run
    python tools/config/patch_base_building_icon_excel.py

改完必须重新导表：`npm run config:export`。
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

XLSX = 'D:/City1001/doc/塔防数据配置/DM-建筑配置.xlsx'
SHEET = 'xl/worksheets/sheet1.xml'
BACKUP = 'D:/City1001/Demo3.8/tmp/_bak_xlsx'

# 表头在第 5 行、类型在第 6 行，数据从第 7 行起；I 列 = baseBuildIcon。
FIRST_DATA_ROW = 7
COL_ICON = 'I'
COL_ID = 'A'
COL_TYPE = 'C'

# 每个 type 统一用哪张图（都是 `assets/resources/` 下真实存在的图）。
# 空字符串 = 保留空列。
ICON_BY_TYPE = {
    1: 'image/buildings/barracks-peashooter',            # 主城
    2: 'image/buildings/barracks-pineapple',             # 粮食田 ×5
    3: 'image/buildings/barracks-flame',                 # 木材田 ×5
    4: 'image/buildings/barracks-coconut',               # 铁矿田 ×3
    5: 'image/buildings/mine',                           # 货币田
    6: 'image/territory/buildings/territory_random_resource_v1',  # 研究院
    7: '',                                               # 小玩法入口：全表仅一座，无同类
    8: '',                                               # 装饰雕像：各座本来就不同，见 OVERRIDES
}

# 装饰雕像六座各配各的图，按现有值走（只修路径），不参与「同类统一」。
OVERRIDES = {
    71018: 'image/territory/buildings/territory_home_v1',
    71019: 'image/territory/buildings/territory_random_resource_v1',
    71020: 'image/territory/buildings/territory_random_resource_v1',
    71021: 'image/territory/buildings/territory_random_resource_v1',
    71022: 'image/territory/buildings/territory_decor_02_v1',
    71023: 'image/territory/buildings/territory_random_resource_v1',
}


def read_rows(xml):
    """按行号解析出 A/C/I 三列的值（够本脚本用，不引入 openpyxl）。"""
    import re
    rows = {}
    for m in re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S):
        row_num = int(m.group(1))
        if row_num < FIRST_DATA_ROW:
            continue
        body = m.group(2)
        picked = {}
        for col in (COL_ID, COL_TYPE, COL_ICON):
            cell = re.search(r'<c r="%s%d"[^>]*?(?:/>|>.*?</c>)' % (col, row_num), body, re.S)
            if not cell:
                picked[col] = ''
                continue
            texts = re.findall(r'<t[^>]*>(.*?)</t>', cell.group(0), re.S)
            texts += re.findall(r'<v>(.*?)</v>', cell.group(0), re.S)
            picked[col] = texts[0] if texts else ''
        rows[row_num] = picked
    return rows


def plan(rows):
    """算出要写哪些格子：[(ref, 新值, 旧值)]。"""
    changes = []
    for row_num in sorted(rows):
        row = rows[row_num]
        raw_id = (row.get(COL_ID) or '').strip()
        raw_type = (row.get(COL_TYPE) or '').strip()
        if not raw_id or not raw_type:
            continue
        building_id = int(raw_id)
        kind = int(raw_type)
        target = OVERRIDES.get(building_id, ICON_BY_TYPE.get(kind, ''))
        current = (row.get(COL_ICON) or '').strip()
        if target and target != current:
            changes.append(('%s%d' % (COL_ICON, row_num), target, current))
    return changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='只打印计划，不落盘')
    args = parser.parse_args()

    xml = read_zip_rows(XLSX, SHEET)
    changes = plan(read_rows(xml))
    if not changes:
        print('无需改动')
        return

    for ref, new, old in changes:
        print('%-5s %-62s → %s' % (ref, old or '(空)', new))

    if args.dry_run:
        print('\n共 %d 格（dry-run，未写入）' % len(changes))
        return

    for ref, new, _old in changes:
        xml = set_cell(xml, ref, new)
    backup = write_zip(XLSX, SHEET, xml, BACKUP)
    print('\n共写入 %d 格；原文件备份 → %s' % (len(changes), backup))


if __name__ == '__main__':
    main()
