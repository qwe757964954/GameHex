# -*- coding: utf-8 -*-
"""把「冲刺 / 气浪」三列补进 `PVP-技能.xlsx`（S / T / U 列）。

与 `patch_yundongba_charge.js` 成对：json 侧先落，这里按 json 的目标值反推写回 Excel，
写完 openpyxl 回读自检。三列分别是：

    S 冲刺距离（px）        chargeDistance          只运动霸 30713 填 120
    T 冲刺速度倍率          chargeSpeedScale        只运动霸 30713 填 4
    U 命中附加特效          impactEffectPrefabPath  只运动霸 30713 填 践踏（气浪）

这三列是**新增**的，所以除了填 30713 那三个格子，还要把 1~4 行的表头（表名 / 类型 /
中文表头 / 说明）补齐，否则转表工具读不到列定义，下一次导出会把这三列丢掉。

`PVP-技能.xlsx` 只有 15KB、是纯数据表（无图无图元），所以这里直接用 openpyxl，
不像 `J-技能表.xlsx` 那样必须走 zip 级手术。
"""
import json
import os
import shutil
from copy import copy

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

ROOT = 'D:/Alan/Project/POW/doc/塔防数据配置'
PATH = os.path.join(ROOT, 'PVP-技能.xlsx')
JSON = os.path.join(ROOT, 'json', 'client', 'pvpSkill.json')
BACKUP = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'

SKILL_ID = 30713
# 列序 → (json 字段名, 中文表头, 说明, 数据类型码)
NEW_COLS = [
    ('chargeDistance', '冲刺距离', '距目标多近开始冲刺；单位和攻击距离同一套（设定 px），留空=不冲刺', '3'),
    ('chargeSpeedScale', '冲刺速度倍率', '冲刺阶段的移速倍率，4=四倍速；留空/1=不加速', '3'),
    ('impactEffectPrefabPath', '命中附加特效', '命中时额外播一次的表现（如「气浪」），resources 下的父 Prefab 路径；不参与伤害', '3'),
]


def main():
    rows = json.load(open(JSON, encoding='utf-8'))
    row = next((item for item in rows if int(item['skillId']) == SKILL_ID), None)
    if row is None:
        raise SystemExit('client json 里找不到技能 %d' % SKILL_ID)
    targets = [row[field] for field, _, _, _ in NEW_COLS]
    if targets[0] != 120 or targets[1] != 4:
        raise SystemExit('json 里的冲刺参数不是 120 / 4：%s' % targets)

    os.makedirs(BACKUP, exist_ok=True)
    shutil.copy2(PATH, os.path.join(BACKUP, 'PVP-技能.xlsx'))

    wb = load_workbook(PATH)
    ws = wb['技能配置']

    # ------- 定位数据行
    target_row = None
    for r in range(5, ws.max_row + 1):
        if ws.cell(r, 1).value is not None and str(ws.cell(r, 1).value).strip() == str(SKILL_ID):
            target_row = r
            break
    if target_row is None:
        raise SystemExit('PVP-技能.xlsx 里找不到技能 %d' % SKILL_ID)

    last_col = ws.max_column
    if last_col < 18:
        raise SystemExit('PVP-技能.xlsx 的列数异常（%d），先核对' % last_col)

    # ------- 表头三行 + 类型行，样式从 R 列（最后一列）复制
    for offset, (field, title, desc, type_code) in enumerate(NEW_COLS):
        col = 19 + offset                     # S / T / U
        letter = get_column_letter(col)
        if ws.cell(3, col).value not in (None, '', title):
            raise SystemExit('%s3 已被占用：%r' % (letter, ws.cell(3, col).value))
        ws.cell(3, col).value = title
        ws.cell(4, col).value = desc
        # 第 1 行只有 A 列是表名（"pvpSkill.json"），其余留空；第 2 行是类型码。
        ws.cell(2, col).value = type_code
        for r in (1, 2, 3, 4):
            src = ws.cell(r, 18)
            dst = ws.cell(r, col)
            if src.has_style:
                dst.font = copy(src.font)
                dst.fill = copy(src.fill)
                dst.border = copy(src.border)
                dst.alignment = copy(src.alignment)
        ws.column_dimensions[letter].width = 16 if offset == 0 else 26

    # ------- 数据
    for offset, (field, _, _, _) in enumerate(NEW_COLS):
        ws.cell(target_row, 19 + offset).value = row[field]

    wb.save(PATH)

    # ------- 回读自检
    wb2 = load_workbook(PATH)
    ws2 = wb2['技能配置']
    got = {}
    for r in range(5, ws2.max_row + 1):
        if ws2.cell(r, 1).value is not None and str(ws2.cell(r, 1).value).strip() == str(SKILL_ID):
            got = {field: ws2.cell(r, 19 + i).value for i, (field, _, _, _) in enumerate(NEW_COLS)}
            break
    expect = {field: row[field] for field, _, _, _ in NEW_COLS}
    if got != expect:
        raise SystemExit('回读不一致：%s != %s' % (got, expect))
    # 其他行这三列必须还是空的
    dirty = []
    for r in range(5, ws2.max_row + 1):
        if str(ws2.cell(r, 1).value).strip() == str(SKILL_ID):
            continue
        if any(ws2.cell(r, 19 + i).value not in (None, '') for i in range(len(NEW_COLS))):
            dirty.append(ws2.cell(r, 1).value)
    if dirty:
        raise SystemExit('这些行的新列被写脏了：%s' % dirty[:8])

    print('[ok] PVP-技能.xlsx 第 %d 行：S/T/U 三列已写入 %s' % (target_row, expect))
    print('[ok] 其余 %d 行三列均为空' % (ws2.max_row - 5))
    print('[ok] 备份：%s/PVP-技能.xlsx' % BACKUP)


if __name__ == '__main__':
    main()
