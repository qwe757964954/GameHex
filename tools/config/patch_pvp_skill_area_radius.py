# -*- coding: utf-8 -*-
"""把 pvpSkill 的范围半径（`areaRadius`）同步回 Excel 源表（PVP-技能.xlsx）。

链路是 **xlsx → json/client/pvpSkill.json → assets/remoteRef/pvpSkill.json**，
改后两者而不改 xlsx，下次打表就把值刷回去了（`align_pvp_skill_to_json.py` 的文档里
记着这个坑：同一份配置两个版本，打表以 Excel 为准）。

只动「技能配置」表里指定 skillId 的 G 列（第 7 列）。

守卫：
  - 第 5 行第 7 列必须是 `areaRadius`，列序被插列改乱就报错；
  - 传了 `--expect` 时，当前值必须等于它 —— 防止行号漂移/值已被别人改过时静默覆盖。

用法：
    python tools/config/patch_pvp_skill_area_radius.py --skill-id 36251 --radius 30 --expect 60
"""
import argparse
import os
import shutil
from datetime import datetime

import openpyxl

SHEET = '技能配置'
COL_SKILL_ID = 1
COL_AREA_RADIUS = 7
FIELD_ROW = 5
DATA_START = 7          # 1 表名 / 2 导出标记 / 3 中文 / 4 说明 / 5 字段名 / 6 类型
BACKUP_DIR = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--skill-id', type=int, required=True)
    ap.add_argument('--radius', type=float, required=True)
    ap.add_argument('--expect', type=float)
    ap.add_argument('--xlsx', default='D:/Alan/Project/POW/doc/塔防数据配置/PVP-技能.xlsx')
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.xlsx)
    ws = wb[SHEET]

    actual_field = ws.cell(FIELD_ROW, COL_AREA_RADIUS).value
    if actual_field != 'areaRadius':
        raise SystemExit('[fail] 第 %d 行第 %d 列是 %r，预期 %r —— 列序变动，先人工核对'
                         % (FIELD_ROW, COL_AREA_RADIUS, actual_field, 'areaRadius'))

    target_row = None
    for row in range(DATA_START, ws.max_row + 1):
        if ws.cell(row, COL_SKILL_ID).value == args.skill_id:
            target_row = row
            break
    if target_row is None:
        raise SystemExit('[fail] 找不到 skillId=%s' % args.skill_id)

    cell = ws.cell(target_row, COL_AREA_RADIUS)
    before = cell.value
    print('[now] %s!G%d（skillId=%s）= %r' % (SHEET, target_row, args.skill_id, before))
    if args.expect is not None:
        try:
            if float(before) != args.expect:
                raise SystemExit('[fail] 现值 %r 与 --expect %s 不符，拒绝覆盖' % (before, args.expect))
        except (TypeError, ValueError):
            raise SystemExit('[fail] 现值 %r 不是数字，拒绝覆盖' % (before,))
    if before == args.radius:
        print('[skip] 已经是 %s，无需改动' % args.radius)
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = os.path.join(BACKUP_DIR, 'PVP-技能.before-area-radius-%s.xlsx' % stamp)
    shutil.copy2(args.xlsx, backup)

    # 整除的半径写成 int，和表里其它整数格保持一致（openpyxl 存 float 会在表里显示 30.0）
    cell.value = int(args.radius) if float(args.radius).is_integer() else args.radius
    wb.save(args.xlsx)

    check = openpyxl.load_workbook(args.xlsx)[SHEET].cell(target_row, COL_AREA_RADIUS).value
    if check != cell.value:
        raise SystemExit('[fail] 回读校验失败：写进去 %r、读出来 %r' % (cell.value, check))

    print('[ok] %s!G%d（skillId=%s）%r → %r' % (SHEET, target_row, args.skill_id, before, check))
    print('     备份：%s' % backup)


main()
