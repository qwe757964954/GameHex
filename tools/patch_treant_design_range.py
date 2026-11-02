# -*- coding: utf-8 -*-
"""把「技能设计案2.xlsx」里 68003 两处旧的射程口径（300）改成 2026-10-30 的职业基线（法师 550）。

留成脚本是因为设计案常被 Excel/WPS 打开占用，写不进去时可以关掉后再跑一次。
幂等：已经改成新文案的行会跳过。
"""
import sys

import openpyxl

PATH = r"D:\Alan\占城玩法\策划文档\战斗系统\技能设计案2.xlsx"
SHEET = "技能设计案 (2)"

REPLACEMENTS = [
    (12, 14,
     '面板攻击 24、射程 300。',
     '面板攻击 24、射程 550（法师职业基线，2026-10-30 统一）。'),
    (14, 16,
     '⚠ 与 200301 的射程基线联动：unitAttackRange=300 是底数，+10% 后取 330，改表后需实机确认树妖不会在视野外提前锁定敌人。',
     '⚠ 与 200301 的射程基线联动：unitAttackRange=550 是底数（2026-10-30 法师/射手基线统一：法师 550、射手 500），'
     '+10% 后取 605；索敌实距 = 550 × 0.9 × combatDistanceScale(0.3) ≈ 148.5（>100 走远程分支，不再加碰撞半径）。'),
]


def main():
    wb = openpyxl.load_workbook(PATH)
    ws = wb[SHEET]
    changed = 0
    for row, col, old, new in REPLACEMENTS:
        cell = ws.cell(row, col)
        text = cell.value or ''
        if new in text:
            print(f"[skip] 第 {row} 行第 {col} 列已是新口径")
            continue
        if old not in text:
            raise SystemExit(f"第 {row} 行第 {col} 列既不是旧文案也不是新文案，拒绝改动：{text[:60]!r}")
        cell.value = text.replace(old, new)
        changed += 1
        print(f"[ok] 第 {row} 行第 {col} 列：300 → 550")
    if not changed:
        print("无需改动")
        return
    # openpyxl 保存会把冻结窗格从 M9 掉成 K2，存完必顺手改回
    ws.freeze_panes = "M9"
    try:
        wb.save(PATH)
    except PermissionError:
        sys.exit("❌ 技能设计案2.xlsx 正被 Excel/WPS 占用（存在 ~$ 锁文件），关掉后再跑一次本脚本")
    print("已保存:", PATH)


if __name__ == "__main__":
    main()
