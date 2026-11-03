# -*- coding: utf-8 -*-
"""把运动霸（30713）的 `chargeDistance` 从 120 提到 220 —— 三处一起改。

背景（2026-11-02，冲刺改成「真·撞击」）：
    冲刺不再是「距敌 120px 内移速 ×4」，而是「发现目标 → 起冲 → 撞到才算伤害」。
    起冲后要一路跑到终点快照，所以这个值不再是「开始加速的距离」，
    而是**冲锋的起手距离**：220px × combatDistanceScale(0.3) = 66 世界单位，
    以 `moveSpeed 25 × 4 = 100` 的冲刺速跑完约 0.5s（去掉近战 reach 15.3 之后），
    正好是画面上读得出「先蓄力、再冲过去、撞上」的长度。

三处必须同值，否则改表重导会把改动冲掉：
    ① doc/塔防数据配置/json/client/pvpSkill.json     —— 导出侧的现值（列表 [{...}]）
    ② Demo3.8/assets/remoteRef/pvpSkill.json          —— 运行时的打包态（{k:[], v:[[]]}）
    ③ doc/塔防数据配置/PVP-技能.xlsx                   —— 表源，S 列（第 19 列）
"""
import json
import os
import shutil
from copy import copy

from openpyxl import load_workbook

ROOT = 'D:/Alan/Project/POW/doc/塔防数据配置'
CLIENT_JSON = os.path.join(ROOT, 'json', 'client', 'pvpSkill.json')
XLSX = os.path.join(ROOT, 'PVP-技能.xlsx')
RUNTIME_JSON = 'D:/Alan/Project/POW/Demo3.8/assets/remoteRef/pvpSkill.json'
BACKUP = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'

SKILL_ID = 30713
FIELD = 'chargeDistance'
OLD = 120
NEW = 220
XLSX_COL = 19          # S 列
HEADER_ROWS = 6        # 1 表名 / 2 导出标记 / 3 中文 / 4 说明 / 5 字段名 / 6 类型
DATA_START = 7
# 改成「真·撞击」后，这一列的语义从「距敌多近开始加速」变成「起手冲锋多远」，
# 表里的说明也得跟着改 —— 策划看的是这一行。
DESC = '起手冲锋的距离；撞到才算伤害，撞不到＝冲空（零伤害但冷却照扣）'


def read_client_row():
    rows = json.load(open(CLIENT_JSON, encoding='utf-8'))
    row = next((item for item in rows if int(item.get('skillId') or 0) == SKILL_ID), None)
    if row is None:
        raise SystemExit('client json 里找不到技能 %d' % SKILL_ID)
    return rows, row


def patch_client_json():
    rows, row = read_client_row()
    current = row.get(FIELD)
    if current == NEW:
        print('[skip] client json 已是 %d' % NEW)
        return
    if current != OLD:
        raise SystemExit('client json 的 %s 既不是 %d 也不是 %d：%r' % (FIELD, OLD, NEW, current))
    row[FIELD] = NEW
    with open(CLIENT_JSON, 'w', encoding='utf-8') as handle:
        json.dump(rows, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    got = next(item for item in json.load(open(CLIENT_JSON, encoding='utf-8'))
               if int(item.get('skillId') or 0) == SKILL_ID)[FIELD]
    if got != NEW:
        raise SystemExit('client json 回读不一致：%r' % got)
    print('[ok] client json：%s %d → %d' % (FIELD, OLD, NEW))


def patch_runtime_json():
    data = json.load(open(RUNTIME_JSON, encoding='utf-8'))
    if not isinstance(data, dict) or 'k' not in data or 'v' not in data:
        raise SystemExit('remoteRef/pvpSkill.json 不是打包态 {k,v}，先核对格式')
    keys = data['k']
    if FIELD not in keys:
        raise SystemExit('remoteRef 里没有 %s 这一列' % FIELD)
    index = keys.index(FIELD)
    skill_col = keys.index('skillId')
    touched = 0
    for values in data['v']:
        if int(values[skill_col] or 0) != SKILL_ID:
            continue
        current = values[index]
        if current == NEW:
            print('[skip] remoteRef 已是 %d' % NEW)
            return
        if current != OLD:
            raise SystemExit('remoteRef 的 %s 既不是 %d 也不是 %d：%r' % (FIELD, OLD, NEW, current))
        values[index] = NEW
        touched += 1
    if touched != 1:
        raise SystemExit('remoteRef 里技能 %d 命中 %d 行（应为 1 行）' % (SKILL_ID, touched))
    with open(RUNTIME_JSON, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(',', ':'))
    back = json.load(open(RUNTIME_JSON, encoding='utf-8'))
    got = next(values[index] for values in back['v'] if int(values[back['k'].index('skillId')] or 0) == SKILL_ID)
    if got != NEW:
        raise SystemExit('remoteRef 回读不一致：%r' % got)
    print('[ok] remoteRef json：%s %d → %d' % (FIELD, OLD, NEW))


def patch_xlsx():
    os.makedirs(BACKUP, exist_ok=True)
    shutil.copy2(XLSX, os.path.join(BACKUP, 'PVP-技能.xlsx'))

    wb = load_workbook(XLSX)
    ws = wb['技能配置']

    # 表头守卫：S 列必须还是那三行口径，否则说明列序被动过，别硬写。
    header = {r: ws.cell(r, XLSX_COL).value for r in range(1, HEADER_ROWS + 1)}
    if header[5] != FIELD:
        raise SystemExit('S 列第 5 行字段名不是 %r：%r（列序被动过？）' % (FIELD, header[5]))
    if header[6] != 'int':
        raise SystemExit('S 列第 6 行类型不是 int：%r' % header[6])

    target_row = None
    for r in range(DATA_START, ws.max_row + 1):
        if ws.cell(r, 1).value is not None and str(ws.cell(r, 1).value).strip() == str(SKILL_ID):
            target_row = r
            break
    if target_row is None:
        raise SystemExit('PVP-技能.xlsx 里找不到技能 %d' % SKILL_ID)

    cell = ws.cell(target_row, XLSX_COL)
    desc_cell = ws.cell(4, XLSX_COL)
    if cell.value == NEW and desc_cell.value == DESC:
        print('[skip] excel 已是 %d 且说明已是新口径' % NEW)
        return
    if cell.value not in (OLD, NEW):
        raise SystemExit('excel S%d 既不是 %d 也不是 %d：%r' % (target_row, OLD, NEW, cell.value))
    before = cell.value
    cell.value = NEW
    desc_cell.value = DESC
    wb.save(XLSX)

    ws2 = load_workbook(XLSX)['技能配置']
    got = ws2.cell(target_row, XLSX_COL).value
    if got != NEW:
        raise SystemExit('excel 回读不一致：%r' % got)
    # 其他技能的冲刺三列必须还是空的（别把 220 刷成整列）
    dirty = [ws2.cell(r, 1).value for r in range(DATA_START, ws2.max_row + 1)
             if str(ws2.cell(r, 1).value).strip() != str(SKILL_ID)
             and ws2.cell(r, XLSX_COL).value not in (None, '')]
    if dirty:
        raise SystemExit('这些行的 S 列被写脏了：%s' % dirty[:8])
    print('[ok] PVP-技能.xlsx 第 %d 行 S 列：%s → %d（说明同步新口径）' % (target_row, before, NEW))


def main():
    patch_client_json()
    patch_runtime_json()
    patch_xlsx()
    print('[done] 三处 chargeDistance 已对齐 %d（备份：%s/PVP-技能.xlsx）' % (NEW, BACKUP))


if __name__ == '__main__':
    main()
