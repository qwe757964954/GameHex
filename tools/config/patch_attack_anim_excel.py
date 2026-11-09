# -*- coding: utf-8 -*-
"""把 PVP-卡牌.xlsx 的 Z / AA 列（攻击动画时长 / 命中判定时点）按实测值写回。

数值与 tools/config/patch_attack_anim_timing.js 的 MEASURED 表同源：
攻击动作总时长取骨架 attack 动画 duration（或 <单位>-attack.anim 的 _duration），
命中时点 = 总时长 × 40%。跑完这个脚本后，Excel 才是「表源」，两份 json 由 JS 补丁写。
"""
import openpyxl
from openpyxl.styles import Alignment

XLSX = r'D:/Alan/Project/POW/doc/塔防数据配置/PVP-卡牌.xlsx'
HIT_RATIO = 0.4

MEASURED = {
    68001: 0.7333333, 68002: 1.0, 68003: 1.3333333, 68004: 1.5666667, 68005: 1.3333333,
    68006: 1.3333333, 68007: 1.2333333, 68008: 1.3333333, 68009: 1.5, 68010: 1.3333333,
    68011: 1.0, 68012: 1.0, 68013: 1.0, 68014: 1.0, 68015: 1.0, 68016: 1.0,
    68017: 1.0, 68018: 1.75, 68019: 0.6666667, 68020: 1.1, 68021: 0.8, 68022: 1.0,
    68023: 0.6666667, 68024: 0.8666667, 68025: 0.6, 68026: 0.6666667, 68027: 0.5333333,
    68028: 1.3, 68029: 1.2333333, 68030: 1.9333333, 68031: 1.3, 68032: 1.5,
    68034: 1.3333333, 68035: 1.1666667,
}


def main():
    wb = openpyxl.load_workbook(XLSX)
    ws = wb['卡牌配置']
    header = {str(cell.value).strip(): cell.column for cell in ws[5] if cell.value}
    col_dur = header['unitAttackDuration']
    col_hit = header['unitAttackHitTime']
    col_id = header['id']

    changed = 0
    seen = set()
    for row in range(7, ws.max_row + 1):
        card_id = ws.cell(row=row, column=col_id).value
        if not isinstance(card_id, int):
            continue
        if card_id not in MEASURED:
            continue
        duration = round(MEASURED[card_id], 3)
        hit = round(MEASURED[card_id] * HIT_RATIO, 3)
        for col, value in ((col_dur, duration), (col_hit, hit)):
            cell = ws.cell(row=row, column=col)
            cell.value = value
            cell.alignment = Alignment(horizontal='center')
        seen.add(card_id)
        changed += 1

    missing = sorted(set(MEASURED) - seen)
    if missing:
        raise SystemExit('表里找不到这些卡：%s' % missing)

    wb.save(XLSX)
    print('写入 %d 张卡（68033 运动霸按例外保留原值）' % changed)


if __name__ == '__main__':
    main()
