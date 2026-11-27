# -*- coding: utf-8 -*-
"""把 `assets/remoteRef/armySkillLevelUp.json` 的 `modfiy` 追平 client / K 表（2026-11-25）。

## 症状

`tests/zcds-fan-single-batch14.test.ts` 的「两份产物逐格一致」报：

    armySkillLevelUp 101403 的 modfiy 两份不一致   '' !== '94014031'

即 **remoteRef 是 `[]`、client 是 `[94014031]`**。全表扫下来正好 9 格 / 3 条链：

| 链 | 技能 | remoteRef | client / K 表 L 列 |
| :--- | :--- | :--- | :--- |
| `101403` | 扇形射击 L1~L3 | `[]` | `[94014031~33]` |
| `101503` | 溅射射击 L1~L3 | `[]` | `[94015031~33]` |
| `103004` | 舞王 L1~L3 | `[]` | `[94030041~43]` |

K 表 L 列与 client 完全一致 ⇒ 落后的只有 remoteRef（运行期 `RefUtil` 读的就是它）。

## 后果

`armySkillLevelUp.modfiy` 是卡面技能条目挂的修改器号。remoteRef 为空 ⇒ 运行期这三条
技能**一个修改器都不挂**：描述有、数值没有，且不报错。

## 口径

- 只在「remote 为空 / client 非空 / K 表 L 列 == client」时才写，任一条不满足整体放弃；
- 只写 remoteRef 的 `modfiy` 一列，client 与 xlsx 不动（它们已经对）；
- 前置闸：两份 json 都做「未修改重建 == 原文逐字节」自检；
- 幂等：一致就不写盘。
用法：python tools/config/sync_army_skill_modfiy_from_client.py
"""
import io
import json
import os
import shutil
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx_read import read_sheet  # noqa: E402
from sync_army_skill_unlock import (  # noqa: E402
    ARMY_CLIENT, ARMY_REMOTE, JSON_BACKUP, XLSX, load_columnar, load_row_array,
)

SHEET_INDEX = 1
FIRST_DATA_ROW = 7
COL_ID = 1
COL_LEVEL = 5
COL_MODFIY = 12


def main():
    army_v, army_k, army_render, army_raw = load_columnar(ARMY_REMOTE)
    if army_render(army_v) != army_raw:
        raise SystemExit('[fail] remoteRef 原样重建不逐字节相同，放弃')

    c_rows, c_render, c_raw = load_row_array(ARMY_CLIENT)
    if c_render(c_rows) != c_raw:
        raise SystemExit('[fail] client 原样重建不逐字节相同，放弃')

    i_mod = army_k.index('modfiy')
    i_id = army_k.index('id')
    i_lv = army_k.index('skilllevel')

    client = {(str(r['id']), int(r['skilllevel'])): r for r in c_rows}

    targets = {}
    for row in army_v:
        key = (str(row[i_id]), int(row[i_lv]))
        remote_value = row[i_mod]
        from_client = client.get(key, {}).get('modfiy')
        if remote_value or not from_client:
            continue  # remote 已有值，或 client 也空 ⇒ 不归本脚本管
        targets[key] = list(from_client)

    if not targets:
        print('[skip] remoteRef 与 client 的 modfiy 已一致')
        return
    print('[diff] %d 格 remoteRef 为空、client 有值，涉及链 %s' % (
        len(targets), sorted({k[0] for k in targets})))

    # ---- 前置闸：K 表 L 列必须与 client 同值 ----
    _, rows = read_sheet(XLSX, SHEET_INDEX)
    locate = {}
    for row_no, cells in rows:
        if row_no < FIRST_DATA_ROW or not cells:
            continue
        cid = str(cells[COL_ID - 1] if len(cells) >= COL_ID else '').replace('\r', '').strip()
        lvl = str(cells[COL_LEVEL - 1] if len(cells) >= COL_LEVEL else '').replace('\r', '').strip()
        if cid and lvl:
            locate[(cid, int(float(lvl)))] = (row_no, cells)

    conflict = []
    for key, want in targets.items():
        if key not in locate:
            conflict.append('%s 在 K 表里找不到' % (key,))
            continue
        row_no, cells = locate[key]
        cell = str(cells[COL_MODFIY - 1]).replace('\r', '').strip() if len(cells) >= COL_MODFIY else ''
        expect = '[%s]' % ','.join(str(int(x)) for x in want)
        if cell != expect:
            conflict.append('%s K 表 L 列是「%s」，client 是「%s」' % (key, cell, expect))
    if conflict:
        for line in conflict[:10]:
            print('  ' + line)
        raise SystemExit('[fail] K 表 与 client 不互相印证，先人工确认再同步')

    # ---- 写 remoteRef ----
    os.makedirs(JSON_BACKUP, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    shutil.copyfile(ARMY_REMOTE, os.path.join(JSON_BACKUP, 'armySkillLevelUp.modfiy-sync.%s.json' % stamp))

    for row in army_v:
        key = (str(row[i_id]), int(row[i_lv]))
        if key in targets:
            row[i_mod] = targets[key]
            print('[patch] %s#L%d  [] → %s' % (key[0], key[1], json.dumps(targets[key])))
    io.open(ARMY_REMOTE, 'w', encoding='utf-8', newline='').write(army_render(army_v))

    # ---- 回读 ----
    v2, k2, _, _ = load_columnar(ARMY_REMOTE)
    bad = []
    for row in v2:
        key = (str(row[k2.index('id')]), int(row[k2.index('skilllevel')]))
        if key in targets and list(row[k2.index('modfiy')]) != targets[key]:
            bad.append(key)
    if bad:
        raise SystemExit('[fail] 回读不一致：%s' % bad[:5])

    print('[ok] %d 格 remoteRef modfiy 已追平 client（xlsx 三方一致）' % len(targets))


if __name__ == '__main__':
    main()
