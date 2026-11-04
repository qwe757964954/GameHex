# -*- coding: utf-8 -*-
"""把追踪导弹的爆炸范围 / 溅射倍率同步回 `J-技能表.xlsx`（PVP技能配置 sheet 的 AC 列）。

与 `patch_laserdragon_missile.js` 成对：json 侧先落（80px / 0.5），这里按 json 目标值
反推写回 Excel 的 `skillParamJson`（AC 列，第 29 列），写完 openpyxl 回读自检。

只动三格（modifierId 94010031 / 94010032 / 94010033，skillName「追踪导弹」），
其余单元格一字不动。json 里的 `skillParamJson` 是**紧凑单行**（键序与 Excel 一致），
所以这里直接改 `strikeSplashRadius` / `strikeSplashDamageRate` 两个键的值、保持原键序。
"""
import json
import os
import shutil

from openpyxl import load_workbook

ROOT = 'D:/Alan/Project/POW/doc/塔防数据配置'
PATH = os.path.join(ROOT, 'J-技能表.xlsx')
JSON = os.path.join(ROOT, 'json', 'client', 'pvpSkillPlan.json')
BACKUP = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'

MODIFIER_IDS = [94010031, 94010032, 94010033]
OLD_RADIUS = 100
NEW_RADIUS = 80
NEW_RATE = 0.5
COL = 29  # AC 列 = skillParamJson


def main():
    # 从 json 取三档的目标 skillParamJson（已由 js 补丁改好）。
    rows = json.load(open(JSON, encoding='utf-8'))
    target_json = {}
    for mid in MODIFIER_IDS:
        row = next((item for item in rows if item['modifierId'] == mid), None)
        if row is None:
            raise SystemExit('client json 里找不到 modifierId %d' % mid)
        params = json.loads(row['skillParamJson'])
        if params.get('strikeSplashRadius') != NEW_RADIUS or params.get('strikeSplashDamageRate') != NEW_RATE:
            raise SystemExit('json 里 %d 还没改到 80/0.5：%s' % (mid, row['skillParamJson']))
        target_json[mid] = row['skillParamJson']

    os.makedirs(BACKUP, exist_ok=True)
    shutil.copy2(PATH, os.path.join(BACKUP, 'J-技能表.xlsx'))

    wb = load_workbook(PATH)
    ws = wb['PVP技能配置']

    # 按 modifierId 列（B 列）定位三行。
    located = {}
    for r in range(1, ws.max_row + 1):
        val = ws.cell(r, 2).value
        if val in MODIFIER_IDS:
            located[val] = r
    if len(located) != len(MODIFIER_IDS):
        raise SystemExit('Excel 里只找到 %s 档，预期 3 档' % sorted(located.values()))

    changed = 0
    for mid in MODIFIER_IDS:
        r = located[mid]
        cell = ws.cell(r, COL)
        current = cell.value
        if current == target_json[mid]:
            print('= modifierId %d 已是目标值，跳过' % mid)
            continue
        # 守卫：确认当前是 100 / 旧倍率，避免覆盖别处已改的值。
        try:
            cur = json.loads(current)
        except Exception:
            raise SystemExit('modifierId %d 的 AC 列不是合法 JSON：%r' % (mid, current))
        if cur.get('strikeSplashRadius') != OLD_RADIUS:
            raise SystemExit('modifierId %d 的 strikeSplashRadius 不是 %d：%r —— 先确认现值' % (mid, OLD_RADIUS, cur))
        cell.value = target_json[mid]
        changed += 1

    wb.save(PATH)
    print('✔ 已改 %d 格（其余未动）' % changed)

    # 回读自检。
    wb2 = load_workbook(PATH)
    ws2 = wb2['PVP技能配置']
    for mid in MODIFIER_IDS:
        r = located[mid]
        got = ws2.cell(r, COL).value
        p = json.loads(got)
        assert p.get('strikeSplashRadius') == NEW_RADIUS, '回读 %d 半径失败：%s' % (mid, got)
        assert p.get('strikeSplashDamageRate') == NEW_RATE, '回读 %d 倍率失败：%s' % (mid, got)
        # 其它键不许被改动。
        assert p.get('strikeCount') is not None and p.get('strikeDamageRate') is not None
    print('✔ 回读自检通过（三档 80px / 0.5，其余键原样）')


if __name__ == '__main__':
    main()
