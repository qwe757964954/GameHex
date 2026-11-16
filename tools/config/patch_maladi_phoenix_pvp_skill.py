# -*- coding: utf-8 -*-
"""把「102604 凤凰降临 = 每 8 次普攻」补回 `PVP-技能.xlsx` + `client/pvpSkill.json`。

## 为什么要补（2026-11-13 发现）

2026-11-11 那轮做「凤凰降临 36182」时只写了 `assets/remoteRef/pvpSkill.json`：

| 位置 | 30181 的 强化次数 / 强化技能ID | 36182 行 |
| :--- | :--- | :--- |
| `assets/remoteRef/pvpSkill.json` | 8 / 36182 ✅ | 有 ✅ |
| `PVP-技能.xlsx`（源表） | **10 / 36181** ❌（火法师武将技的旧值） | **没有** ❌ |
| `doc/塔防数据配置/json/client/pvpSkill.json` | 10 / 36181 ❌ | 没有 ❌ |

源表是根，client 是源表的转表产物 ⇒ 只要有人重导一次，`remoteRef` 里的 36182 就静默回滚，
`tests/zcds-maladi-guo.test.ts` 的「每 8 次普攻」那条会直接红（本轮就是这么发现的）。

## 改什么

1. `PVP-技能.xlsx / 技能配置`（字段行在第 5 行、数据从第 7 行起）：
   - 30181 那行的 H（强化次数）10 → **8**、I（强化技能ID）36181 → **36182**；
   - 末行后追加 36182 一行（值取自 `remoteRef`，列样式沿用 36181 那行）。
2. `client/pvpSkill.json`：30181 同步成 8 / 36182；在 30181 之后插入 36182 行
   （键序按 client 的既有顺序，`null` 键不写 —— 与 `writeRowsLikeOriginal` 同一条口径）。

`remoteRef` 已经是对的，不碰。走 zip 级手术（`set_cell` + `build_row`），不用 openpyxl 另存。

用法：`python tools/config/patch_maladi_phoenix_pvp_skill.py`
"""
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    build_row, bump_dimension, col_letter, last_data_row, read_zip_rows, set_cell,
    styles_of_row, write_zip,
)

ROOT = 'D:/Alan/Project/POW'
XLSX = os.path.join(ROOT, 'doc', '塔防数据配置', 'PVP-技能.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = os.path.join(ROOT, 'doc', '塔防数据配置_历史备份')
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef', 'pvpSkill.json')
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client', 'pvpSkill.json')

FIELD_ROW = 5
DATA_FIRST_ROW = 7
BASIC_SKILL_ID = 30181          # 火法师普攻（麻辣铁锅也走这一行：经验证 68026 的普攻 skillId 就是它）
PHOENIX_SKILL_ID = 36182        # 凤凰降临
EMPOWERED_EVERY = 8

#  Excel A..U 共 21 列；`None` = 留空（转表时就是 null）。
COLUMNS = [
    'skillId', 'name', 'mode', 'effectKey', 'projectileKey', 'projectileSpeed',
    'areaRadius', 'empoweredEvery', 'empoweredSkillId', 'effectPrefabPath', 'trigger',
    'cooldown', 'damageRate', 'durationSeconds', 'waves', 'slowRatio', 'onHitStatusId',
    'secondarySkillId', 'chargeDistance', 'chargeSpeedScale', 'impactEffectPrefabPath',
]


def read_json(path):
    with io.open(path, encoding='utf-8') as handle:
        return json.load(handle)


def write_rows(path, rows):
    """client 产物是单行紧凑 JSON、无末尾换行（与 `ref_table_io.writeTable` 同口径）。"""
    text = json.dumps(rows, ensure_ascii=False, separators=(',', ':'))
    with io.open(path, 'w', encoding='utf-8', newline='') as handle:
        handle.write(text)


def remote_rows():
    data = read_json(REMOTE)
    keys = data['k']
    return {record['skillId']: record for record in (dict(zip(keys, row)) for row in data['v'])}


def find_row(xml, skill_id):
    """按 A 列的数字找行号（数据行都带 `t="n"` 或有 `<v>`）。"""
    pattern = r'<c r="A(\d+)"[^>]*>\s*<v>%d</v>' % skill_id
    match = re.search(pattern, xml)
    if not match:
        raise SystemExit('[fail] 技能配置里找不到 skillId=%d' % skill_id)
    return int(match.group(1))


def main():
    remote = remote_rows()
    phoenix = remote.get(PHOENIX_SKILL_ID)
    basic = remote.get(BASIC_SKILL_ID)
    if not phoenix or not basic:
        raise SystemExit('[fail] remoteRef 缺 %s 行' % (PHOENIX_SKILL_ID,))
    if basic.get('empoweredEvery') != EMPOWERED_EVERY or basic.get('empoweredSkillId') != PHOENIX_SKILL_ID:
        raise SystemExit('[fail] remoteRef 的 %d 不是 %d/%d（读到 %r/%r），先核对'
                         % (BASIC_SKILL_ID, EMPOWERED_EVERY, PHOENIX_SKILL_ID,
                            basic.get('empoweredEvery'), basic.get('empoweredSkillId')))

    # ── 1. 源表 ────────────────────────────────────────────────────────
    xml = read_zip_rows(XLSX, MEMBER)
    header = re.findall(r'<c r="([A-Z]+)%d"[^>]*>(.*?)</c>' % FIELD_ROW, xml, re.S)
    if len(header) < len(COLUMNS):
        raise SystemExit('[fail] 字段行只有 %d 列，预期 %d' % (len(header), len(COLUMNS)))

    basic_row = find_row(xml, BASIC_SKILL_ID)
    phoenix_row = None
    try:
        phoenix_row = find_row(xml, PHOENIX_SKILL_ID)
    except SystemExit:
        pass

    if phoenix_row:
        print('[skip] 源表已有 %d 行（第 %d 行）' % (PHOENIX_SKILL_ID, phoenix_row))
    else:
        last = last_data_row(xml)
        new_row = last + 1
        #  样式沿用 36181（同一种「武将技」行，数值列格式一致）
        styles = styles_of_row(xml, find_row(xml, 36181))
        values = [(phoenix.get(column) if phoenix.get(column) is not None else None)
                  for column in COLUMNS]
        #  `trigger` 在 remoteRef 里是空串 ⇒ 表里留空
        for index, column in enumerate(COLUMNS):
            if column == 'trigger' and values[index] == '':
                values[index] = None
        xml = xml.replace('</sheetData>', build_row(new_row, values, styles) + '</sheetData>')
        xml = bump_dimension(xml, new_row)
        print('  + 源表追加 %d（第 %d 行）' % (PHOENIX_SKILL_ID, new_row))

    xml = set_cell(xml, 'H%d' % basic_row, EMPOWERED_EVERY)
    xml = set_cell(xml, 'I%d' % basic_row, PHOENIX_SKILL_ID)
    print('  · 源表第 %d 行（%d）：H=%d、I=%d' % (basic_row, BASIC_SKILL_ID, EMPOWERED_EVERY, PHOENIX_SKILL_ID))

    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 写回 %s' % XLSX)
    print('[ok] 备份 %s' % backup)

    # ── 2. client 产物 ─────────────────────────────────────────────────
    rows = read_json(CLIENT)
    index = next((i for i, row in enumerate(rows) if row.get('skillId') == BASIC_SKILL_ID), -1)
    if index < 0:
        raise SystemExit('[fail] client 里没有 %d' % BASIC_SKILL_ID)
    rows[index] = {**rows[index], 'empoweredEvery': EMPOWERED_EVERY,
                   'empoweredSkillId': PHOENIX_SKILL_ID}
    if any(row.get('skillId') == PHOENIX_SKILL_ID for row in rows):
        print('[skip] client 已有 %d' % PHOENIX_SKILL_ID)
    else:
        #  键序按 client 的既有顺序；`null` 键一律不写（`writeRowsLikeOriginal` 同口径）
        order = ['skillId', 'name', 'mode', 'effectKey', 'projectileKey', 'projectileSpeed',
                 'areaRadius', 'empoweredEvery', 'empoweredSkillId', 'effectPrefabPath',
                 'trigger', 'cooldown', 'damageRate', 'durationSeconds', 'waves', 'slowRatio',
                 'onHitStatusId', 'secondarySkillId', 'chargeDistance', 'chargeSpeedScale',
                 'impactEffectPrefabPath']
        record = {key: phoenix[key] for key in order if phoenix.get(key) is not None}
        rows.insert(index + 1, record)
        print('  + client 在 %d 之后插入 %d' % (BASIC_SKILL_ID, PHOENIX_SKILL_ID))
    write_rows(CLIENT, rows)
    print('[ok] 写回 %s（%d 行）' % (CLIENT, len(rows)))

    # ── 3. 回读 ────────────────────────────────────────────────────────
    check = read_json(CLIENT)
    by_id = {row['skillId']: row for row in check}
    assert by_id[BASIC_SKILL_ID]['empoweredEvery'] == EMPOWERED_EVERY
    assert by_id[BASIC_SKILL_ID]['empoweredSkillId'] == PHOENIX_SKILL_ID
    assert PHOENIX_SKILL_ID in by_id, 'client 缺 36182'
    assert by_id[PHOENIX_SKILL_ID]['effectPrefabPath'] == phoenix['effectPrefabPath']
    assert by_id[PHOENIX_SKILL_ID]['impactEffectPrefabPath'] == phoenix['impactEffectPrefabPath']

    import openpyxl
    book = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    sheet = book['技能配置']
    got_basic = got_phoenix = None
    for row in sheet.iter_rows(min_row=DATA_FIRST_ROW, values_only=True):
        if row[0] == BASIC_SKILL_ID:
            got_basic = row
        if row[0] == PHOENIX_SKILL_ID:
            got_phoenix = row
    book.close()
    if got_basic is None or got_basic[7] != EMPOWERED_EVERY or got_basic[8] != PHOENIX_SKILL_ID:
        raise SystemExit('[fail] 源表回读 %d 不对：%r' % (BASIC_SKILL_ID, got_basic))
    if got_phoenix is None or got_phoenix[1] != '凤凰降临':
        raise SystemExit('[fail] 源表回读缺 36182：%r' % (got_phoenix,))
    print('[ok] 回读通过：源表 %d → %d/%d、新增 %d「%s」；client %d 行'
          % (BASIC_SKILL_ID, EMPOWERED_EVERY, PHOENIX_SKILL_ID, PHOENIX_SKILL_ID,
             got_phoenix[1], len(check)))


if __name__ == '__main__':
    main()
