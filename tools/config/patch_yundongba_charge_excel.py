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
# 列序 → (json 字段名, 中文表头, 说明, 行2 导出标记, 行6 数据类型)
#
# ⚠️ 表头是 **6 行**，不是 4 行：
#   行1 表名（只有 A1 有值，其余留空）
#   行2 导出标记（本表统一 '3'）
#   行3 中文表头
#   行4 说明
#   行5 **英文字段名**（json key）
#   行6 **数据类型**（int / float / string / long）
#
# 缺行 5 或行 6 时，openpyxl 不会为该格生成 XML 节点，POI 取到 null，
# eSon 的 `Esheet.getExcelColumns` 会直接抛
#   NullPointerException: Cannot invoke "Cell.getRowIndex()" because "cell" is null
# —— 打表整个中断。2026-11-02 就是这么炸的，别再只写 1~4 行。
NEW_COLS = [
    ('chargeDistance', '冲刺距离', '起手冲锋的距离；撞到才算伤害，撞不到＝冲空（零伤害但冷却照扣）', '3', 'int'),
    ('chargeSpeedScale', '冲刺速度倍率', '冲刺阶段的移速倍率，4=四倍速；留空/1=不加速', '3', 'int'),
    ('impactEffectPrefabPath', '命中附加特效', '命中时额外播一次的表现（如「气浪」），resources 下的父 Prefab 路径；不参与伤害', '3', 'string'),
]

#  `chargeDistance` 的目标值：2026-11-02 冲刺改成「真·撞击」后由设计案的 120 提到 220
#  （220 × 0.3 = 66 世界单位起点 − 近战 15.3 ⇒ 冲锋段约 0.51s）。
#  这个脚本只是「按 json 现值补齐三列表头」的幂等工具，所以这里跟 json 对齐、别再写死 120。
CHARGE_DISTANCE = 220


def main():
    rows = json.load(open(JSON, encoding='utf-8'))
    row = next((item for item in rows if int(item['skillId']) == SKILL_ID), None)
    if row is None:
        raise SystemExit('client json 里找不到技能 %d' % SKILL_ID)
    targets = [row[field] for field, *_ in NEW_COLS]
    if targets[0] != CHARGE_DISTANCE or targets[1] != 4:
        raise SystemExit('json 里的冲刺参数不是 %d / 4：%s' % (CHARGE_DISTANCE, targets))

    os.makedirs(BACKUP, exist_ok=True)
    shutil.copy2(PATH, os.path.join(BACKUP, 'PVP-技能.xlsx'))

    wb = load_workbook(PATH)
    ws = wb['技能配置']

    # ------- 定位数据行
    target_row = None
    for r in range(7, ws.max_row + 1):
        if ws.cell(r, 1).value is not None and str(ws.cell(r, 1).value).strip() == str(SKILL_ID):
            target_row = r
            break
    if target_row is None:
        raise SystemExit('PVP-技能.xlsx 里找不到技能 %d' % SKILL_ID)

    last_col = ws.max_column
    if last_col < 18:
        raise SystemExit('PVP-技能.xlsx 的列数异常（%d），先核对' % last_col)

    # ------- 表头 6 行：1 表名 / 2 导出标记 / 3 中文 / 4 说明 / 5 字段名 / 6 类型
    for offset, (field, title, desc, type_code, data_type) in enumerate(NEW_COLS):
        col = 19 + offset                     # S / T / U
        letter = get_column_letter(col)
        for check_row, expect in ((3, title), (5, field), (6, data_type)):
            current = ws.cell(check_row, col).value
            if current not in (None, '', expect):
                raise SystemExit('%s%d 已被占用：%r（脚本要写 %r）'
                                 % (letter, check_row, current, expect))
        ws.cell(3, col).value = title
        ws.cell(4, col).value = desc
        # 第 1 行只有 A 列是表名（"pvpSkill.json"），其余留空；第 2 行是导出标记。
        ws.cell(2, col).value = type_code
        # 🔴 行 5 / 行 6 必须落值：空着不会生成 XML 节点，eSon 读表头时会 NPE。
        ws.cell(5, col).value = field
        ws.cell(6, col).value = data_type
        for r in range(1, 7):
            src = ws.cell(r, 18)              # 样式一律照 R 列（原来最后一列）
            dst = ws.cell(r, col)
            if src.has_style:
                dst.font = copy(src.font)
                dst.fill = copy(src.fill)
                dst.border = copy(src.border)
                dst.alignment = copy(src.alignment)
        ws.column_dimensions[letter].width = 16 if offset == 0 else 26

    # ------- 数据
    for offset, (field, *_) in enumerate(NEW_COLS):
        ws.cell(target_row, 19 + offset).value = row[field]

    wb.save(PATH)

    # ------- 回读自检
    wb2 = load_workbook(PATH)
    ws2 = wb2['技能配置']
    got = {}
    for r in range(7, ws2.max_row + 1):
        if ws2.cell(r, 1).value is not None and str(ws2.cell(r, 1).value).strip() == str(SKILL_ID):
            got = {field: ws2.cell(r, 19 + i).value for i, (field, *_) in enumerate(NEW_COLS)}
            break
    expect = {field: row[field] for field, *_ in NEW_COLS}
    if got != expect:
        raise SystemExit('回读不一致：%s != %s' % (got, expect))
    # 表头必须 6 行齐全（行 5 字段名 / 行 6 类型缺一个，eSon 打表就 NPE）
    for offset, (field, _, _, _, data_type) in enumerate(NEW_COLS):
        col = 19 + offset
        header = [ws2.cell(r, col).value for r in range(1, 7)]
        if header[4] != field or header[5] != data_type:
            raise SystemExit('%s 列表头不全：%s（行5 应为 %r、行6 应为 %r）'
                             % (get_column_letter(col), header, field, data_type))
    # 其他行这三列必须还是空的
    dirty = []
    for r in range(7, ws2.max_row + 1):
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
