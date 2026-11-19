# -*- coding: utf-8 -*-
"""把 50017「机甲菇」的 `unitPrefabPath` 从不存在的旧路径修正到实际资源。

背景（2026-11-18，接「所有卡牌攻击动画重测」那轮的遗留项）：
  怪物卡 50017 的 `unitPrefabPath` 还写着 `units/阿尔萨斯/阿尔萨斯` ——
  `assets/resources/units/阿尔萨斯/` 这个目录**早就不存在了**，同名玩家卡 68015
  已经指到 `skel/机甲菇/机甲菇`。上一轮为了回填攻击动画时长，是按玩家卡借的值，
  没有动路径本身（等策划确认）。本轮用户明确「一并修」。

三处一起改（与其余配表同一套口径）：
  ① 源表 `doc/塔防数据配置/PVP-怪物卡牌.xlsx`
  ② 转表产物 `doc/塔防数据配置/json/client/monsterCard.json`
  ③ 运行时 `assets/remoteRef/monsterCard.json`

⚠️ `monsterCard` 目前**没有代码消费**（运行时只读 `pvpCard`），改它是为了让源表自洽；
   哪天怪物卡接进对局，这条路径就是它要用的那个。

写盘口径：
  · xlsx 走 zip 级手术（`set_cell` + `write_zip`），不另存 —— 见 `sync_treant_excel` 的说明；
  · 两份 json 做**精确字符串替换**（该值各自只出现 1 次），逐字节保住两份产物各自的排版
    （client 是行数组、remoteRef 是列存 `{k,v,c}`，整文件重排会让 diff 变成全量）。

用法：
    python tools/config/fix_monster_prefab_50017.py            # 预演（默认，不写盘）
    python tools/config/fix_monster_prefab_50017.py --apply    # 真写
"""

from __future__ import annotations

import io
import json
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import col_letter, set_cell, write_zip  # noqa: E402
from sync_card_attack_anim import read_rows_from_xlsx  # noqa: E402

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
POW_ROOT = os.path.dirname(PROJECT_ROOT)
DOC = os.path.join(POW_ROOT, 'doc', '塔防数据配置')

XLSX = os.path.join(DOC, 'PVP-怪物卡牌.xlsx')
CLIENT_JSON = os.path.join(DOC, 'json', 'client', 'monsterCard.json')
REMOTE_REF = os.path.join(PROJECT_ROOT, 'assets', 'remoteRef', 'monsterCard.json')
RESOURCES = os.path.join(PROJECT_ROOT, 'assets', 'resources')
BACKUP_DIR = os.path.join(PROJECT_ROOT, 'tmp', 'backup_prefab_50017_20261118')

SHEET_MEMBER = 'xl/worksheets/sheet1.xml'
HEADER_ROW = 5
COLUMN = 'unitPrefabPath'
CARD_ID = 50017
OLD_PATH = 'units/阿尔萨斯/阿尔萨斯'
NEW_PATH = 'skel/机甲菇/机甲菇'


def column_letter_of(columns: list[str], name: str) -> str:
    if name not in columns:
        raise SystemExit('源表表头里没有 %s 列（先核对第 %d 行）' % (name, HEADER_ROW))
    return col_letter(columns.index(name))


def check_asset(path: str) -> None:
    prefab = os.path.join(RESOURCES, path.replace('/', os.sep) + '.prefab')
    if not os.path.isfile(prefab):
        raise SystemExit('目标 prefab 不存在：%s（先确认资源路径）' % prefab)


def patch_xlsx(row_no: int, column: str) -> None:
    with zipfile.ZipFile(XLSX) as archive:
        xml = archive.read(SHEET_MEMBER).decode('utf-8')
    xml = set_cell(xml, '%s%d' % (column, row_no), NEW_PATH)
    write_zip(XLSX, SHEET_MEMBER, xml, BACKUP_DIR)
    print('  源表：%s%d → %s' % (column, row_no, NEW_PATH))


def patch_json(path: str) -> None:
    with io.open(path, encoding='utf-8') as handle:
        raw = handle.read()
    needle = '"%s"' % OLD_PATH
    count = raw.count(needle)
    if count != 1:
        raise SystemExit('%s 里旧路径出现 %d 次（预期 1 次），不敢做字符串替换'
                         % (os.path.basename(path), count))
    text = raw.replace(needle, '"%s"' % NEW_PATH, 1)
    data = json.loads(text)                     # 先解析：替换坏了当场报错，不落盘
    rows = data['v'] if isinstance(data, dict) else data
    keys = data['k'] if isinstance(data, dict) else None
    column = keys.index(COLUMN) if keys else COLUMN
    hit = [row for row in rows if (row[keys.index('id')] if keys else row['id']) == CARD_ID]
    if len(hit) != 1 or hit[0][column] != NEW_PATH:
        raise SystemExit('%s 回读失败：%d 行命中 50017，值不是 %s' % (path, len(hit), NEW_PATH))
    if len(rows) != len(json.loads(raw)['v'] if isinstance(json.loads(raw), dict) else json.loads(raw)):
        raise SystemExit('%s 行数变了，中止' % os.path.basename(path))
    if text.count('\n') != raw.count('\n'):
        raise SystemExit('%s 换行数变了（排版被改坏），中止' % os.path.basename(path))
    with io.open(path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(text)
    print('  %s：50017 的 %s 已更新' % (os.path.basename(path), COLUMN))


def main(argv: list[str]) -> int:
    apply = '--apply' in argv
    check_asset(NEW_PATH)

    rows = read_rows_from_xlsx(XLSX, HEADER_ROW)
    columns = [key for key in rows[0].keys() if key != '__row__']
    column = column_letter_of(columns, COLUMN)
    hit = [row for row in rows if row.get('id') == CARD_ID]
    if len(hit) != 1:
        raise SystemExit('源表里 %d 行命中 %d（预期 1 行）' % (CARD_ID, len(hit)))
    target = hit[0]
    current = target.get(COLUMN)

    print('怪物卡 %d %s' % (CARD_ID, target.get('name')))
    print('  %-18s %s' % ('unitPrefabPath', current))
    if current == NEW_PATH:
        print('已是目标值 %s，无需改动（幂等）' % NEW_PATH)
        return 0
    if current != OLD_PATH:
        raise SystemExit('当前值既不是旧路径也不是新路径（%r），先人工核对再改' % current)
    print('  %-18s %s' % ('→', NEW_PATH))

    if not apply:
        print('预演（未写盘）。确认无误后加 --apply；源表会先备份到 %s'
              % os.path.relpath(BACKUP_DIR, PROJECT_ROOT))
        return 0

    patch_xlsx(target['__row__'], column)
    patch_json(CLIENT_JSON)
    patch_json(REMOTE_REF)
    print('已写：源表 1 格 / client 1 处 / remoteRef 1 处')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
