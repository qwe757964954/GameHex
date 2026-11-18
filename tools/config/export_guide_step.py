# -*- coding: utf-8 -*-
"""新手引导步骤表：**源表 → 两份导出 JSON** 的单一出口。

为什么要单独一支脚本：`npm run config:export` 在本工程跑不通（既有 24 条错），
结果是 `assets/remoteRef/guideStep.json` 与 `doc/塔防数据配置/json/client/guideStep.json`
只能手工维护 —— 2026-11-17 就出现过「源表已经改成 16 步 / 39 句，client 那份还停在
17 步 / D16」的分叉（有人把旧副本写了回去）。这台机器上**只有源表是可信的**，
所以固定成「改完表就跑这支脚本」，两份 JSON 一律由它生成，不再手改。

产出格式（与既有文件逐字一致，不重新排版）：
  · `assets/remoteRef/guideStep.json`：`{k:[...], v:[[...]], c:1}`，`indent=0` 的列存；
    `rewardJson` 空着写 `null`（不是 `[]`）；
  · `doc/塔防数据配置/json/client/guideStep.json`：每行一个对象，行间 `,\\n`，
    字段序固定（`rewardJson` 在 `skipAble` 之后、`nextStep` 之前），奖励对象内键按字母序。

幂等：内容一致时打印 `[skip]` 且不写盘。
"""

import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_guide_dialog_ids import Book, STEP_SHEET, PROJECT, DOC  # noqa: E402

XLSX = os.path.join(DOC, 'X-新手引导.xlsx')
REMOTE = os.path.join(PROJECT, 'assets', 'remoteRef', 'guideStep.json')
CLIENT = os.path.join(DOC, 'json', 'client', 'guideStep.json')

# 源表里的列序（第 5 行的字段名行）；`nextStep` 之后才是 `rewardJson` 的老排版见 REMOTE_KEYS。
XLSX_KEYS = ['guideId', 'stepId', 'flowName', 'triggerType', 'maskType', 'focusNode',
             'requireAction', 'dialogId', 'completeCond', 'skipAble', 'rewardJson', 'nextStep']

# remoteRef 既有的列序（`rewardJson` 在最后）。保持不动，免得整份文件洗一遍。
REMOTE_KEYS = ['guideId', 'stepId', 'flowName', 'triggerType', 'maskType', 'focusNode',
               'requireAction', 'dialogId', 'completeCond', 'skipAble', 'nextStep', 'rewardJson']

# client 的字段序（`rewardJson` 夹在 `skipAble` 与 `nextStep` 之间）。
CLIENT_KEYS = XLSX_KEYS

INT_KEYS = ('guideId', 'skipAble')
FIRST_DATA_ROW = 7
COLUMNS = 'ABCDEFGHIJKL'


def read_rows():
    """源表 → [{key: value}]，列位置按 `COLUMNS` 固定（表头行本身不参与）。"""
    book = Book(XLSX)
    cells = book.cells(STEP_SHEET)
    rows = []
    for row_no in range(FIRST_DATA_ROW, FIRST_DATA_ROW + 200):
        step_id = (cells.get(('B', row_no)) or '').strip()
        if not step_id:
            break
        row = {}
        for column, key in zip(COLUMNS, XLSX_KEYS):
            raw = cells.get((column, row_no)) or ''
            if key in INT_KEYS:
                row[key] = int(str(raw).strip() or 0)
            elif key == 'rewardJson':
                text = str(raw).strip()
                row[key] = json.loads(text) if text else None
            else:
                row[key] = raw
        rows.append(row)
    return rows


def dump_remote(rows):
    table = {'k': REMOTE_KEYS, 'v': [[_remote_value(row, key) for key in REMOTE_KEYS] for row in rows], 'c': 1}
    return json.dumps(table, ensure_ascii=False, indent=0, separators=(',', ':'))


def _remote_value(row, key):
    value = row.get(key)
    if key == 'rewardJson':
        # 空奖励在 remoteRef 里是 `null`（历史口径），不要写成 `[]`。
        return value or None
    return value


def dump_client(rows):
    lines = []
    for row in rows:
        out = {}
        for key in CLIENT_KEYS:
            if key == 'rewardJson':
                # 奖励对象内键按字母序（`number` < `pro` < `resId`），与既有文件一致。
                out[key] = [json.loads(json.dumps(item, sort_keys=True)) for item in (row[key] or [])]
            else:
                out[key] = row[key]
        lines.append(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    return '[' + ',\n'.join(lines) + ']'


def write_if_changed(path, text):
    current = io.open(path, encoding='utf-8', newline='').read() if os.path.exists(path) else None
    if current == text:
        print('[skip] %s' % os.path.relpath(path, PROJECT))
        return False
    io.open(path, 'w', encoding='utf-8', newline='').write(text)
    print('[ok] 已写 %s' % os.path.relpath(path, PROJECT))
    return True


def main():
    rows = read_rows()
    if not rows:
        raise SystemExit('源表步骤表为空，先确认 %s' % os.path.basename(XLSX))
    print('源表：%d 步（%s ~ %s）' % (len(rows), rows[0]['stepId'], rows[-1]['stepId']))
    write_if_changed(REMOTE, dump_remote(rows))
    write_if_changed(CLIENT, dump_client(rows))


if __name__ == '__main__':
    main()
