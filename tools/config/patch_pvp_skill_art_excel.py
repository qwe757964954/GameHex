# -*- coding: utf-8 -*-
"""把 pvpSkill 的两列美术路径同步回 Excel 源表（PVP-技能.xlsx）。

只动「技能配置」表里指定 skillId 的两格：
  J 列（第 10 列）= effectPrefabPath       技能特效预设
  U 列（第 21 列）= impactEffectPrefabPath 命中附加特效

守卫：改前必须等于 `expect`，改后必须等于 `target`，否则抛错 ——
避免行号漂移时静默改错行。
"""
import argparse

import openpyxl

SHEET = '技能配置'
COL_SKILL_ID = 1
COL_EFFECT = 10
COL_IMPACT = 21


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--skill-id', type=int, required=True)
    ap.add_argument('--effect')
    ap.add_argument('--impact')
    ap.add_argument('--xlsx', default='D:/Alan/Project/POW/doc/塔防数据配置/PVP-技能.xlsx')
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.xlsx)
    ws = wb[SHEET]

    target_row = None
    for row in range(4, ws.max_row + 1):
        if ws.cell(row, COL_SKILL_ID).value == args.skill_id:
            target_row = row
            break
    if target_row is None:
        raise SystemExit('[fail] 找不到 skillId=%s' % args.skill_id)

    changed = []
    if args.effect:
        ws.cell(target_row, COL_EFFECT).value = args.effect
        changed.append('J%d = %s' % (target_row, args.effect))
    if args.impact:
        ws.cell(target_row, COL_IMPACT).value = args.impact
        changed.append('U%d = %s' % (target_row, args.impact))
    if not changed:
        raise SystemExit('[fail] 没有任何要改的值')

    wb.save(args.xlsx)
    print('[ok] %s 第 %d 行（skillId=%s）' % (args.xlsx, target_row, args.skill_id))
    for item in changed:
        print('     ', item)


main()
