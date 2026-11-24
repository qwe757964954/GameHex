# -*- coding: utf-8 -*-
"""把源表 `PVP-怪物卡牌.xlsx` 的「建筑外观」（`buildIcon`）同步到两份产物。

2026-11-23 需求：塔防模式的怪物基地图换了 —— 美术已替换、源表也填了 `npc_base`，
但转表产物（client json / remoteRef）还停在旧值 `hq-base`，等于「表改了没打表」。

只同步这一列，原因：
  · 这一列是**纯美术指向**，值就是 `image/buildings/` 下的图名，运行时 `loadDir` 整目录加载、
    再按帧名索引（`ZCGameLoader.loadBuildingFrames`）⇒ 加一张新图不需要登记任何清单；
  · 同一次对比里源表还有别的差（`headIcon` 整列换成了直路径 `icons/head/*`、`type` 的数字/字符串写法、
    主城的 `prefabSize`）—— 那些**不是本次需求**，其中 `headIcon` 会走 `icon.json` 的 key 解析，
    直路径解不出来（头像会整片不显示），必须先确认再打，别顺手带出去。

用法：
    python tools/config/sync_monster_base_icon.py            # 预演
    python tools/config/sync_monster_base_icon.py --apply     # 真写
"""

from __future__ import annotations

import io
import json
import os
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
POW_ROOT = os.path.dirname(PROJECT_ROOT)
DOC = os.path.join(POW_ROOT, 'doc', '塔防数据配置')

XLSX = os.path.join(DOC, 'PVP-怪物卡牌.xlsx')
CLIENT_JSON = os.path.join(DOC, 'json', 'client', 'monsterCard.json')
REMOTE_REF = os.path.join(PROJECT_ROOT, 'assets', 'remoteRef', 'monsterCard.json')
HEADER_ROW = 5
COLUMN = 'buildIcon'


def read_xlsx_column() -> dict[int, object]:
    """读出 id → buildIcon（只读，`close()` 放 finally，见 2026-11-18 的 WinError 5 那条）。"""
    import openpyxl
    workbook = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
    try:
        rows = list(workbook.worksheets[0].iter_rows(values_only=True))
    finally:
        workbook.close()
    header = rows[HEADER_ROW - 1]
    index = {name: column for column, name in enumerate(header) if name}
    if COLUMN not in index or 'id' not in index:
        raise SystemExit('表头里没有 %s / id 列（先核对第 %d 行）' % (COLUMN, HEADER_ROW))
    result: dict[int, object] = {}
    for row in rows[HEADER_ROW:]:
        card_id = row[index['id']]
        if not isinstance(card_id, int):
            continue                                    # 类型行 / 备注行
        value = row[index[COLUMN]]
        result[card_id] = value.strip() if isinstance(value, str) and value.strip() else None
    return result


def as_rows(data):
    """两种形态都吃：列存 `{k,v,c}` 或行对象数组。"""
    if isinstance(data, dict):
        return [dict(zip(data['k'], row)) for row in data['v']], data
    return data, None


def write(path: str, data, column_major: bool) -> None:
    if column_major:
        text = json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
    else:
        text = '[' + ',\n'.join(
            json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in data) + ']'
    with io.open(path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(text)


def sync(path: str, source: dict[int, object], apply: bool) -> int:
    with io.open(path, encoding='utf-8') as handle:
        raw = handle.read()
    data = json.loads(raw)
    rows, column_store = as_rows(data)
    #  列存要往 `v` 里写：先记住 buildIcon 的列号，避免改完对象再回头找。
    column = column_store['k'].index(COLUMN) if column_store is not None else COLUMN

    touched = 0
    for position, row in enumerate(rows):
        card_id = row['id']
        if card_id not in source:
            continue
        want = source[card_id]
        #  行对象形态里「没配」是不写键（不是写 null），所以读取一律用 get。
        have = row.get(COLUMN)
        if have == want:
            continue
        if column_store is not None:
            column_store['v'][position][column] = want
        else:
            row[COLUMN] = want
        print('  %s：%s 的 %s ← %r（原 %r）'
              % (os.path.basename(path), card_id, COLUMN, want, have))
        touched += 1

    if not touched:
        print('  %s：无差异（幂等）' % os.path.basename(path))
        return 0
    if not apply:
        return touched
    #  行数 / 行宽 / 换行数都不该变 —— 只换一个字符串值，排版动了就是写坏了。
    text = (json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
            if column_store is not None else
            '[' + ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows) + ']')
    if text.count('\n') != raw.count('\n'):
        raise SystemExit('%s 换行数变了，排版被改坏，中止' % os.path.basename(path))
    write(path, data if column_store is not None else rows, column_store is not None)

    check = json.loads(io.open(path, encoding='utf-8').read())
    back, _ = as_rows(check)
    for row in back:
        if row['id'] in source and row.get(COLUMN) != source[row['id']]:
            raise SystemExit('回读不一致：%s 的 %s = %r' % (row['id'], COLUMN, row.get(COLUMN)))
    print('  %s：已写 %d 格' % (os.path.basename(path), touched))
    return touched


def main(argv: list[str]) -> int:
    apply = '--apply' in argv
    source = read_xlsx_column()
    current = {card_id: value for card_id, value in source.items() if value}
    print('源表 %s：%d 行，其中 %d 行配了建筑外观' % (COLUMN, len(source), len(current)))
    for card_id, value in sorted(current.items()):
        print('  %s → %s' % (card_id, value))
    total = 0
    for path in (CLIENT_JSON, REMOTE_REF):
        total += sync(path, source, apply)
    print('%s：共 %d 格%s' % ('已写盘' if apply else '待写', total, '' if apply else '（加 --apply 真写）'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
