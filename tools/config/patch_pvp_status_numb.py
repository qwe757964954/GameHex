#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""补齐 pvpStatus 软控 `numb` 的两处产物（2026-11-13）。

背景：磁电菇（68016）五雷轰顶 101603 的麻痹走 `pvpStatus.numb`
（`statJson = {moveSpeedPct:-50, attackDisabled:1}`，`control` 必须为空 —— 硬控会让单位
在最前置闸门整段 return，连移动都停）。`patch_magdi_mushroom.js` 说好「同时写两处」，
但那一轮只有 `assets/remoteRef/pvpStatus.json` 落了行，转表产物
`doc/塔防数据配置/json/client/pvpStatus.json` 还是 58 行没有 numb
⇒ `zcds-magdi-mushroom` 的「pvpStatus：新增软控 numb」一直红；更麻烦的是谁一导表，
两边行数差就会把麻痹静默抹掉（同一类坑：本轮 30181 也是只写了 remoteRef）。

`pvpStatus` 没有源 xlsx 工作表（全表扫描 PVP-*.xlsx 无 pvpStatus / 状态表），
真源就是这两份手写产物 ⇒ 本脚本只补 client 那份，remoteRef 已有行时只校验不重写。

用法：
    python tools/config/patch_pvp_status_numb.py            # 写
    python tools/config/patch_pvp_status_numb.py --check     # 只校验
"""

from __future__ import annotations

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REMOTE = os.path.join(ROOT, 'assets', 'remoteRef', 'pvpStatus.json')
CLIENT = os.path.abspath(os.path.join(ROOT, '..', 'doc', '塔防数据配置', 'json', 'client', 'pvpStatus.json'))

STATUS_ID = 'numb'

#  列存（remoteRef）是全列；行存（client）里 null 的键不写出 —— 与现有行一致。
NUMB_ROW_FULL = {
    'legacyBuffKey': '磁电麻痹',
    'statusId': STATUS_ID,
    'name': '麻痹',
    'durationSeconds': 3,
    'intervalSeconds': 0,
    'maxStacks': 1,
    'refreshPolicy': 'refresh',
    'handlerKey': 'none',
    'statJson': json.dumps({'moveSpeedPct': -50, 'attackDisabled': 1}, separators=(',', ':')),
    'enabled': 1,
    'control': None,
    'periodicAmountPct': None,
    'periodicBasis': None,
    'periodicCapMultiplier': None,
}
NUMB_ROW_SPARSE = {key: value for key, value in NUMB_ROW_FULL.items() if value is not None}


def read_remote() -> tuple[list[str], list[list]]:
    with open(REMOTE, 'r', encoding='utf-8') as handle:
        packed = json.load(handle)
    return packed['k'], packed['v']


def main() -> int:
    check_only = '--check' in sys.argv
    keys, rows = read_remote()
    index = keys.index('statusId')
    has_remote = any(row[index] == STATUS_ID for row in rows)

    with open(CLIENT, 'r', encoding='utf-8') as handle:
        raw = handle.read()
    client_rows = json.loads(raw)
    client_ids = [row.get('statusId') for row in client_rows]

    print('remoteRef %d 行 / numb=%s' % (len(rows), has_remote))
    print('client    %d 行 / numb=%s' % (len(client_rows), STATUS_ID in client_ids))

    if not has_remote:
        print('[x] remoteRef 缺 numb —— 先跑 tools/config/patch_magdi_mushroom.js')
        return 1
    if check_only:
        return 0 if STATUS_ID in client_ids else 1
    if STATUS_ID in client_ids:
        print('[=] client 已有 numb，跳过')
        return 0

    #  排版照抄原文件：`[{行},\n{行}...]`，无末尾换行、无缩进。
    assert raw.endswith(']'), 'client pvpStatus.json 预期以 ] 结尾'
    body = raw[:-1].rstrip()
    assert body.endswith('}'), 'client pvpStatus.json 预期结尾是 }'
    merged = body + ',\n' + json.dumps(NUMB_ROW_SPARSE, ensure_ascii=False, separators=(',', ':')) + ']'
    with open(CLIENT, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(merged)

    #  回读：行数 +1、numb 字段逐格对拍、其余行一字不动。
    with open(CLIENT, 'r', encoding='utf-8') as handle:
        after = json.load(handle)
    assert len(after) == len(client_rows) + 1, '行数没有 +1'
    assert after[:-1] == client_rows, '既有行被改动'
    row = after[-1]
    assert row['statusId'] == STATUS_ID and row['durationSeconds'] == 3 and row['enabled'] == 1
    assert 'control' not in row, 'control 必须省略（空 = 软控）'
    assert json.loads(row['statJson']) == {'moveSpeedPct': -50, 'attackDisabled': 1}
    print('[+] client 追加 numb（第 %d 行）' % len(after))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
