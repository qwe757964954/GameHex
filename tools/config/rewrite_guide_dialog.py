# -*- coding: utf-8 -*-
"""新手引导台词表 + 组号 + 步骤表 `台词组` 的唯一改写口（2026-11-17 第 15 条起）。

当前目标态（第 22 条）：**22 句 / 11 组 `D01~D11`**。`CONTENT` 是台词的唯一事实来源，
`STEP_DIALOG` 是「步骤 → 台词组」的唯一事实来源，两边都写**绝对值**，不靠旧表反推。

  1. `新手引导台词` sheet 的数据行整段重写，多余的尾行清空；
  2. 组号按行序重排，id = `组序号×100 + 句序号`（`D05` ⇒ `501`/`502`）；
  3. 步骤表的 `台词组` 列写成 `STEP_DIALOG` 里的绝对目标值（不是「旧→新」改名表，
     改名表连跑两次会把已经改好的组再删一遍）；列头提示的 `D01~D1N` 跟着组数走。

第 18 条的变化：`4-1` 只留「再多翻几块」；原 `402`/`403`（「走，带你痛揍……点击关卡 1-1」
＋「Go go go!」）拆成新 `D05` 挂到 **`5-1`（点关卡地块）**，`D06~D11` 整体前移一位。
第 22 条的变化：`D06`（`5-3` 战斗里那张抽到的卡）三句并成**一句**，`602`/`603` 删除。

改完再跑 `export_guide_step.py` 把两份 `guideStep.json` 重生成（`dialogId` 一起进去），
本脚本自己负责两份 `guideDialog.json`。

为什么不用 openpyxl：会把整表按 16384 列重写（见 `sync_treant_excel.py` 顶部说明）。
这里复用 `sync_guide_dialog_ids.Book` 的 zip 级手术：已在共享字符串里的值只换索引，
新文案写 `t="inlineStr"`，落盘前再把 sst 的 `count` 对齐到实际引用数。

幂等：表已经是目标样子时全部打印 `[skip]`，槽位号 / 组号都不会再动。
"""

import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_guide_dialog_ids import (  # noqa: E402
    Book, XLSX, STEP_SHEET, DIALOG_SHEET, REMOTE_DIR, CLIENT_DIR, PROJECT,
    DIALOG_KEYS, dump_remote, dump_client, write_if_changed,
)

PEASANT = '豌豆游侠'
ELISE = '埃莉斯'

# 新版台词（图 1）。`D04` = 旧 D05/D06/D07 三组并在 `4-1` 一步里播完。
# 组号写死成目标值：本脚本同时负责「内容」和「编号」，不靠旧表反推。
CONTENT = [
    (1, PEASANT, '救星可算来了！我埋土里五百年了，先挖我出去，边走边说。'),
    (1, ELISE, '五百年……你气色倒不错。'),

    (2, PEASANT, '埋在这儿的可不止我一个。外头植物都疯了，脾气比僵尸还大，翻的时候看着点。'),

    (3, PEASANT, '你运气不错啊，再翻一块试试看。'),

    # `4-1` 是「翻第 3 块地」：只留「再多翻几块」。
    (4, PEASANT, '再多翻几块，就能给我升级了。'),

    # === 新 `D05` = 老的 `402`/`403`（用户 2026-11-17 第 18 条）===
    # 这两句说的是**下一步**的动作（`5-1` 点关卡地块），挂在 `4-1` 上等于台词抢在手指前面
    # 发号令：玩家还在翻地就被告知「点击关卡 1-1」，而光圈这时候画在第三块地上。
    # 拆成独立一组之后 id 从 `402`/`403` 变成 `501`/`502`，后面所有组整体前移一位（D06~D11）。
    (5, PEASANT, '走，带你痛揍那些疯植物去 —— 点击「关卡」1-1。'),
    (5, ELISE, 'Go go go!'),

    # 卡牌展示（`5-3`）：顺位后从 `D05` 变成 `D06`。
    #
    # 用户 2026-11-18 第 22 条：战斗里的这段**只剩一句**（原来 601/602/603 三句，
    # 玩家还没读完卡牌就消失了 —— 那张卡只活 1.156s，见 `ZC_CARD_REVEAL_SECONDS`）。
    # 原 `602`「它自己上场了！」/ `603`「没错，看它大显身手吧。」删除，意思并进这一句。
    (6, PEASANT, '这是刚抽到的卡牌，它会自动战斗，看它如何大显身手吧'),

    (7, PEASANT, '打完仗手上全是碎片，攒着会发霉。点底部「卡牌」。'),
    (7, ELISE, '会发霉？'),
    (7, PEASANT, '五百年了，什么都发霉。'),

    (8, PEASANT, '点我这张脸。点准点，我只有一张。'),
    (8, ELISE, '看得出来。'),

    (9, PEASANT, '点「升级」！十片碎片，换我一条新胳膊。'),
    (9, ELISE, '你本来就一条胳膊。'),
    (9, PEASANT, '所以才要换。'),

    (10, PEASANT, '升完了？回地图——打赢挣来的那块地，翻它。'),
    (10, ELISE, '它给什么。'),
    (10, PEASANT, '钱。不给同胞。'),

    (11, PEASANT, '最后一句：左边有个「主线任务」，那是你接下来五百年的活儿。'),
    (11, ELISE, '五百年。'),
    (11, PEASANT, '我熬得住，你也行。'),
]

# 步骤 → 台词组（**绝对目标值**，不是「旧→新」的改名表）。
# 🔴 必须写成绝对值：改名表第二次跑会把已经改好的 `D04` 当成旧的 `D04` 再删一遍，
# 连跑两次就把 5-3/5-4/6-1 全清空了（本脚本第一版就踩过）。
# 空串 = 该步没有台词（纯手指 + 气泡）。
STEP_DIALOG = {
    '1-1': 'D01', '1-2': 'D02',
    '2-1': '', '2-2': '', '2-3': 'D03',
    '3-1': '',
    '4-1': 'D04',
    # 第 18 条：「点击关卡 1-1」那两句（原 `402`/`403`）挪到**真正点关卡**的 `5-1`，成为新 `D05`；
    # 卡牌展示 `5-3` 顺势接 `D06`，后面的组整体前移一格（`6-1`→D07 … `8-1`→D11）。
    '5-1': 'D05', '5-2': '',
    # 5-4「结算」不出台词（用户 2026-11-17 第 16 条 ①）：删组后补位，5-3 往后每组前一格，
    # 5-4 空着 —— 那一步只留手指 + 「确定」的光圈。
    '5-3': 'D06', '5-4': '',
    '6-1': 'D07', '6-2': 'D08', '6-3': 'D09',
    '7-1': 'D10',
    '8-1': 'D11',
}

STEP_ID_RE = re.compile(r'\d+-\d+')


def build_lines():
    """[(id, group, order, speaker, content)]，order 按组内出现次数自动 1 起。"""
    out, counter = [], {}
    for group, speaker, content in CONTENT:
        counter[group] = counter.get(group, 0) + 1
        out.append([group * 100 + counter[group], 'D%02d' % group, counter[group], speaker, content])
    return out


def main():
    lines = build_lines()
    groups = sorted({line[1] for line in lines})
    if groups != ['D%02d' % (index + 1) for index in range(len(groups))]:
        raise SystemExit('台词组不连续：%s' % '、'.join(groups))
    print('目标：%d 句 / %d 组（%s ~ %s）' % (len(lines), len(groups), groups[0], groups[-1]))

    book = Book(XLSX)
    dialog = book.cells(DIALOG_SHEET)
    steps = book.cells(STEP_SHEET)

    data_rows = sorted({row for (_, row) in dialog
                        if ('A', row) in dialog and str(dialog[('A', row)]).isdigit()
                        and re.fullmatch(r'D\d{2}', dialog.get(('B', row), ''))})
    if not data_rows:
        raise SystemExit('台词表里没找到数据行')
    first_row, last_row = data_rows[0], data_rows[-1]
    if len(data_rows) != last_row - first_row + 1:
        raise SystemExit('台词表数据行不连续（%d 行里有空洞）' % len(data_rows))
    print('现有：%d 句（第 %d~%d 行）' % (len(data_rows), first_row, last_row))

    dialog_edits = {}
    for offset, (line_id, group, order, speaker, content) in enumerate(lines):
        row = first_row + offset
        for col, value in zip('ABCDE', (line_id, group, order, speaker, content)):
            # 🔴 一律按字符串比：`Book.cells()` 对数字格返回的是 `<v>` 的原文（str），
            # 拿 int 去比永远不等 ⇒ 每次跑都会重写 54 格、mtime 一直变，幂等就废了。
            if dialog.get((col, row), None) != str(value):
                dialog_edits[(col, row)] = value
    # 多出来的尾行整行清空（用户删句后行数变少，不清会留在表里又被导出去）。
    for row in range(first_row + len(lines), last_row + 1):
        for col in 'ABCDE':
            if dialog.get((col, row), '') != '':
                dialog_edits[(col, row)] = ''

    # 步骤表：台词组列一律写成 `STEP_DIALOG` 里的绝对值（改名的语义见上）。
    step_edits, seen = {}, set()
    for row in sorted({row for (_, row) in steps}):
        step_id = steps.get(('B', row), '')
        if not STEP_ID_RE.fullmatch(step_id):
            continue
        if step_id not in STEP_DIALOG:
            raise SystemExit('步骤表多了一步 %s：`STEP_DIALOG` 没给它分台词组' % step_id)
        seen.add(step_id)
        current = steps.get(('H', row), '')
        wanted = STEP_DIALOG[step_id]
        if current != wanted:
            step_edits[('H', row)] = wanted
            print('[ok] 步骤 %s 台词组 %s → %s' % (step_id, current or '（空）', wanted or '（空）'))
    missing = sorted(set(STEP_DIALOG) - seen)
    if missing:
        raise SystemExit('`STEP_DIALOG` 里的步骤在表里找不到：%s' % '、'.join(missing))

    # 列头提示里的组号范围（"台词组 D01~D14"）跟着表走。
    hint = '台词组 D01~%s' % groups[-1]
    for (col, row), text in list(steps.items()):
        if col == 'H' and text.startswith('台词组 D01~') and text != hint:
            step_edits[('H', row)] = hint
            print('[ok] 列头提示：%s → %s' % (text, hint))

    if dialog_edits:
        book.write(DIALOG_SHEET, dialog_edits)
    if step_edits:
        book.write(STEP_SHEET, step_edits)
    if dialog_edits or step_edits:
        book.flush()
        print('[ok] 已写盘（台词 %d 格 / 步骤 %d 格）' % (len(dialog_edits), len(step_edits)))
    else:
        print('[skip] 源表已是目标状态，无需改动')

    # 两份 guideDialog.json 按**落盘后的表**重建：保证「表 = JSON」不是靠人眼对。
    fresh = Book(XLSX)
    cells = fresh.cells(DIALOG_SHEET)
    rows = []
    for row in range(first_row, first_row + len(lines)):
        rows.append([int(cells[('A', row)]), cells[('B', row)], int(cells[('C', row)]),
                     cells[('D', row)], cells[('E', row)]])
    if rows != lines:
        raise SystemExit('回读与目标不一致，先别导 JSON：\n%s' % rows[:3])

    write_if_changed(os.path.join(REMOTE_DIR, 'guideDialog.json'), dump_remote(DIALOG_KEYS, rows))
    write_if_changed(os.path.join(CLIENT_DIR, 'guideDialog.json'),
                     dump_client([dict(zip(DIALOG_KEYS, row)) for row in rows]))
    print('👉 接着跑 tools/config/export_guide_step.py 把两份 guideStep.json 的 dialogId 一起刷掉')


if __name__ == '__main__':
    main()
