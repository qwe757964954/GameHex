#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""2026-11-14 普攻「多打 N 发」（`bulletNum`）的多目标递减：`bulletFalloff = 0.4`。

用户口径：普通攻击带来的穿透类 / 分裂子弹 / 溅射 都要多目标递减，初始值低于普通攻击。
「分裂子弹」在本项目配表里就是 `pvpAttrMap.bulletNum`（普攻多打 N 发）：
第 1 颗是普攻本体（100%），第 2 颗起每颗 ×(1 - bulletFalloff) ⇒ 100% / 60% / 36% / 21.6%。

`bulletFalloff` 挂在**多弹那三条修改器行自己的 `skillParamJson`** 上（同 `pvpSkillId`），
由 `mergeSkillPlanIntoRuntime` 并进普攻那一份 runtime（与 102602 的 `splashDamageRate` 同一条路）。
缺省 0 ⇒ 每颗同额，没配这个键的卡与全部强化那一击行为逐字不变。

涉及 4 张卡（各 3 档，共 12 行）：
    68010 981001 / 68017 981701 / 68026 982601 / 68034 983401   ← `pvpSkillId` 分别为 30719 / 30261 / 30181 / 30710

三写：`assets/remoteRef/pvpSkillPlan.json` + `doc/塔防数据配置/json/client/pvpSkillPlan.json`
    + 源表 `J-技能表.xlsx` sheet9 的 AC 列。

用法：python tools/config/patch_bullet_falloff.py [--check]
"""

from __future__ import annotations

import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from patch_multi_target_falloff import (  # noqa: E402
    CLIENT_PLAN, REMOTE_PLAN, SHEET_PLAN as _SHEET_PLAN, SRC_PLAN,
    _cells_of_row, _load_shared_strings, dump_packed, dump_rows, read_packed, read_rows,
)
from sync_treant_excel import write_zip  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BACKUP = os.path.join(ROOT, 'tmp', 'backup_falloff_20261114', 'xlsx')

BULLET_FALLOFF = 0.4


def main() -> int:
    check_only = '--check' in sys.argv

    keys, values, remote_rows = read_packed(REMOTE_PLAN)
    client_rows, trailing = read_rows(CLIENT_PLAN)
    assert len(remote_rows) == len(client_rows), '两份 pvpSkillPlan 行数不一致'

    touched = []
    for client_row in client_rows:
        if str(client_row.get('statId') or '') != 'bulletNum':
            continue
        raw = client_row.get('skillParamJson')
        params = json.loads(raw) if raw else {}
        if params.get('bulletFalloff') == BULLET_FALLOFF:
            continue
        params['bulletFalloff'] = BULLET_FALLOFF
        client_row['skillParamJson'] = json.dumps(params, ensure_ascii=False, separators=(',', ':'))
        touched.append(str(client_row.get('modifierId')))

    print('多弹行补 bulletFalloff：%d 行 %s' % (len(touched), ' '.join(touched)))
    if check_only:
        return 0

    new_remote = [[row.get(key) for key in keys] for row in client_rows]
    with open(REMOTE_PLAN, 'w', encoding='utf-8', newline='') as handle:
        handle.write(dump_packed(keys, new_remote, 1))
    with open(CLIENT_PLAN, 'w', encoding='utf-8', newline='') as handle:
        handle.write(dump_rows(client_rows, trailing))

    patch_source(client_rows)
    return 0


def patch_source(client_rows) -> None:
    """sheet9 AC 列（C=unitId / D=skillChainId / F=skillLevel）。"""
    target = {}
    for row in client_rows:
        target[(str(row.get('unitId')), str(row.get('skillChainId')), str(row.get('skillLevel')))] = row
    with zipfile.ZipFile(SRC_PLAN) as archive:
        xml = archive.read(_SHEET_PLAN).decode('utf-8')
    shared = _load_shared_strings(SRC_PLAN)
    hit = 0
    patched = 0
    for match in list(re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S)):
        row_number = int(match.group(1))
        if row_number < 6:
            continue
        cells = _cells_of_row(xml, row_number, shared)
        row = target.get((cells.get('C', ''), cells.get('D', ''), cells.get('F', '')))
        if not row:
            continue
        hit += 1
        want = row.get('skillParamJson') or ''
        if cells.get('AC', '') != want:
            xml = set_cell_safe(xml, 'AC%d' % row_number, want)
            patched += 1
    backup = write_zip(SRC_PLAN, _SHEET_PLAN, xml, BACKUP)
    print('源表 J-技能表 sheet9：命中 %d 行、改 %d 格（备份 %s）'
          % (hit, patched, os.path.basename(backup)))


def _col_index(letters: str) -> int:
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - 64)
    return index


def _col_letters(index: int) -> str:
    letters = ''
    while index > 0:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def set_cell_safe(xml: str, ref: str, value: str) -> str:
    """写单元格；**该格原本是空的（稀疏行）时按列序插入**。

    `sync_treant_excel.set_cell` 只会替换已存在的 `<c>`，稀疏行（例如 AC 列全空的历史行）
    会直接 `SystemExit('单元格 xxx 不存在')` —— 多弹那 12 行修改器就是这种行，必须插格。
    """
    from sync_treant_excel import cell_xml, set_cell
    try:
        return set_cell(xml, ref, value)
    except SystemExit:
        pass
    letters = re.match(r'([A-Z]+)(\d+)', ref)
    col, row_number = letters.group(1), int(letters.group(2))
    target_index = _col_index(col)
    row_match = re.search(r'<row r="%d"[^>]*>(.*?)</row>' % row_number, xml, re.S)
    if not row_match:
        raise SystemExit('行 %d 不存在' % row_number)
    body = row_match.group(1)
    #  找到第一个「列号 > 目标列」的格，插在它前面；都不大于就挂到行尾
    insert_at = len(body)
    style = None
    for match in re.finditer(r'<c\s+([^>]*?)(?:/>|>.*?</c>)', body, re.S):
        refs = re.search(r'r="([A-Z]+)\d+"', match.group(1))
        if not refs:
            continue
        if _col_index(refs.group(1)) > target_index:
            insert_at = match.start()
            break
        found = re.search(r's="(\d+)"', match.group(1))
        style = found.group(1) if found else None
    new_body = body[:insert_at] + cell_xml(ref, style, value) + body[insert_at:]
    start = row_match.start(1)
    return xml[:start] + new_body + xml[row_match.end(1):]


if __name__ == '__main__':
    raise SystemExit(main())
