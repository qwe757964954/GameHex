# -*- coding: utf-8 -*-
"""把【技能设计案 (2)】的「技能状态」列（第 19 列 / S）刷成实际落地状态。

判定逻辑不在这里 —— 全在 `audit_skill_design_status.build_report()`（读 remoteRef 配表 +
代码里已注册的 statId / behaviorKey + 预制是否在包里）。本脚本只负责：

  1. 逐行写 `已实现` / `待规划`；
  2. 配色沿用表里原有的两种状态：`已实现` = 原来「已完成」那格（FF92D050 亮绿）、
     `待规划` = 原来「规划中」那格（theme0 / tint -0.25 浅灰）—— 直接 copy 模板单元格的
     fill/font/alignment，**不自己造颜色**，这样跟表里已有行完全一致；
  3. 存完把冻结窗格写回（openpyxl 另存会把它掉成默认值）。

重跑安全：状态由配置算出来，同一份配置跑 N 次结果一样。
"""
import sys

from copy import copy

from openpyxl import load_workbook

sys.path.insert(0, 'D:/Alan/Project/POW/Demo3.8/tools')
from audit_skill_design_status import DOC, SHEET, build_report  # noqa: E402

COL_STATUS = 19
DONE_TEXT = '已实现'
TODO_TEXT = '待规划'
# 模板格：S2 = 原来的「已完成」（绿），S52 = 原来的「规划中」（浅灰）
TEMPLATE_DONE = (2, COL_STATUS)
TEMPLATE_TODO = (52, COL_STATUS)


def main():
    report = build_report()
    wb = load_workbook(DOC)
    sheet = wb[SHEET]

    # ⚠️ 必须先把模板样式 copy 成普通对象再进循环：
    # `sheet.cell(r, c)` 每次返回的是**同一个** Cell 对象，而 TEMPLATE_TODO 落在第 52 行，
    # 这一行本身会被判成「已实现」并原地改色 —— 不提前 copy 的话，从第 52 行往后所有
    # 「待规划」行都会被染成绿色（曾经踩过）。
    def snapshot(row):
        cell = sheet.cell(row, COL_STATUS)
        return (copy(cell.font), copy(cell.fill), copy(cell.alignment), copy(cell.border))

    styles = {True: snapshot(TEMPLATE_DONE[0]), False: snapshot(TEMPLATE_TODO[0])}

    changed = 0
    for item in report:
        row = item['row']
        text = DONE_TEXT if item['ok'] else TODO_TEXT
        cell = sheet.cell(row, COL_STATUS)
        font, fill, alignment, border = styles[item['ok']]
        if cell.value != text:
            changed += 1
        cell.value = text
        cell.font = copy(font)
        cell.fill = copy(fill)
        cell.alignment = copy(alignment)
        cell.border = copy(border)

    frozen = sheet.freeze_panes
    wb.save(DOC)
    wb2 = load_workbook(DOC)
    wb2[SHEET].freeze_panes = frozen or 'N1'
    wb2.save(DOC)

    # ------- 回读自检：每一行都必须有值，且与判定结果一一对应
    check = load_workbook(DOC)[SHEET]
    mismatch = []
    for item in report:
        got = check.cell(item['row'], COL_STATUS).value
        want = DONE_TEXT if item['ok'] else TODO_TEXT
        if got != want:
            mismatch.append((item['row'], got, want))
    if mismatch:
        raise SystemExit('回读不一致：%s' % mismatch[:6])

    # 回读自检之二：两种状态的底色必须各自唯一（防「模板格被循环改色」这类事故）
    def fill_key(cell):
        f = cell.fill
        fg = f.fgColor
        return (f.patternType, fg.type, fg.rgb if fg.type == 'rgb' else None,
                fg.theme if fg.type == 'theme' else None,
                round(fg.tint, 4) if isinstance(fg.tint, (int, float)) else None)

    seen = {}
    for item in report:
        seen.setdefault((DONE_TEXT if item['ok'] else TODO_TEXT), set()).add(
            fill_key(check.cell(item['row'], COL_STATUS)))
    for text, keys in seen.items():
        if len(keys) != 1:
            raise SystemExit('%s 出现 %d 种底色，模板被污染：%s' % (text, len(keys), keys))
    print('[ok] 底色自检：已实现=%s / 待规划=%s' % (
        sorted(seen[DONE_TEXT])[0], sorted(seen[TODO_TEXT])[0]))

    counts = {}
    for item in report:
        key = DONE_TEXT if item['ok'] else TODO_TEXT
        counts[key] = counts.get(key, 0) + 1
    print('[ok] 写入 %d 行（实际变化 %d 行）：%s / %s'
          % (len(report), changed, counts.get(DONE_TEXT, 0), counts.get(TODO_TEXT, 0)))
    print('[ok] 冻结窗格：%s' % (frozen or 'N1'))

    # 新增状态列后各卡的三态汇总，方便回话里直接引用
    by_card = {}
    for item in report:
        by_card.setdefault(item['card'], []).append(item)
    full = [card for card, items in sorted(by_card.items()) if all(i['ok'] for i in items)]
    part = [card for card, items in sorted(by_card.items())
            if any(i['ok'] for i in items) and not all(i['ok'] for i in items)]
    none = [card for card, items in sorted(by_card.items()) if not any(i['ok'] for i in items)]
    print('[ok] 全实现卡 %d 张：%s' % (len(full), ' '.join(full)))
    print('[ok] 部分实现卡 %d 张：%s' % (len(part), ' '.join(part)))
    print('[ok] 全未实现卡 %d 张：%s' % (len(none), ' '.join(none) or '—'))


if __name__ == '__main__':
    try:
        main()
    except PermissionError:
        raise SystemExit('写入失败：技能设计案2.xlsx 正被 Excel 占用，关闭文档后重跑')
