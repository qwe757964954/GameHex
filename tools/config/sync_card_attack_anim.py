# -*- coding: utf-8 -*-
"""按骨架实测值回填「所有卡牌角色」的攻击动画时长与命中时点。

口径（沿用 2026-11-06 定下、2026-11-16 沿用至今的那一套）：
  ① `unitAttackDuration` = 该单位 prefab 对应 `.skel` 里 `attack` 动画的 duration
     （`tools/spine_dur.py` 实测；不是猜的，也不是占位值）；
  ② `unitAttackHitTime` = 总时长 × 40%（「伤害帧在攻击动画总时长的 40%」）；
  ③ `unitAttackInterval` **不动** —— 那是平衡值，改它等于改 DPS。

覆盖四份产物（三写）：
  ① 源表 `doc/塔防数据配置/PVP-卡牌.xlsx`         / `PVP-怪物卡牌.xlsx`
  ② 转表产物 `doc/塔防数据配置/json/client/{pvpCard,monsterCard}.json`
  ③ 运行时 `assets/remoteRef/{pvpCard,monsterCard}.json`

⚠️ 运行时**只读 `pvpCard` 的这两列**（`ZCPvpTableParser`），`monsterCard` 那份没有代码消费；
   两边一起改是为了让源表自身自洽，不是为了让怪物换个动作。

两个例外（不改、只报告）：
  · 运动霸 68033 / 50035：attack 动画 1.0s **长于** `unitAttackInterval` 0.7s。
    写下去会让「攻击态 1.0s」把 0.7s 的节拍拖成 1.0s ⇒ DPS 掉三成；
    而且它的普攻本来就是冲刺（冲刺期循环播 attack 片段），不存在被砍断的问题。
  · 50017 机甲菇：`unitPrefabPath` 曾指向 **不存在的** `units/阿尔萨斯/阿尔萨斯`，
    当时按同名玩家卡 68015 的 prefab（`skel/机甲菇/机甲菇`）取值并打印告警。
    该路径已于 2026-11-18 修正（`tools/config/fix_monster_prefab_50017.py`）⇒ 现在直接读到
    自己的骨架（实测 1.1s，与当时借用的值一致）；`BORROW` 保留为「路径再失效」时的兜底。

用法：
    python tools/config/sync_card_attack_anim.py             # 只看差异（默认，不写盘）
    python tools/config/sync_card_attack_anim.py --apply      # 真写
"""

from __future__ import annotations

import glob
import io
import json
import os
import re
import sys
import time
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import spine_dur  # noqa: E402
from sync_treant_excel import cell_xml, set_cell, write_zip  # noqa: E402

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
POW_ROOT = os.path.dirname(PROJECT_ROOT)
DOC = os.path.join(POW_ROOT, 'doc', '塔防数据配置')
CLIENT_JSON = os.path.join(DOC, 'json', 'client')
REMOTE_REF = os.path.join(PROJECT_ROOT, 'assets', 'remoteRef')
RESOURCES = os.path.join(PROJECT_ROOT, 'assets', 'resources')
BACKUP_DIR = os.path.join(PROJECT_ROOT, 'tmp', 'backup_card_anim_20261118')

HIT_RATIO = 0.4

#  (=表名, xlsx 路径, sheet 成员, 表头行, client json, remoteRef json)
TABLES = [
    ('玩家卡牌', os.path.join(DOC, 'PVP-卡牌.xlsx'), 'xl/worksheets/sheet1.xml', 5,
     'pvpCard.json'),
    ('怪物卡牌', os.path.join(DOC, 'PVP-怪物卡牌.xlsx'), 'xl/worksheets/sheet1.xml', 5,
     'monsterCard.json'),
]

#  刻意不改的卡：id → 原因
SKIP = {
    68033: '运动霸：attack 1.0s > attackInterval 0.7s，写下去 DPS 掉三成（普攻本来就是冲刺）',
    50035: '运动霸：同上',
}
#  prefab 路径失效、按同名玩家卡取值：卡 id → 借用的玩家卡 id
BORROW = {50017: 68015}


def round3(value: float) -> float:
    return round(value + 0.0, 3)


def number_for_json(value: float):
    """整数值写成 int，与表里既有风格一致（1 而不是 1.0）。"""
    rounded = round3(value)
    return int(rounded) if rounded == int(rounded) else rounded


def skel_of(prefab_path: str) -> str | None:
    """`skel/豌豆射手/豌豆射手` → `assets/resources/skel/豌豆射手/*.skel`。"""
    if not prefab_path:
        return None
    folder = os.path.join(RESOURCES, os.path.dirname(prefab_path.replace('\\', '/')))
    hits = sorted(glob.glob(os.path.join(folder, '*.skel')))
    return hits[0] if hits else None


def read_rows_from_xlsx(path: str, header_row: int) -> list[dict]:
    """只读：用 openpyxl 读（写盘一律走 zip 手术，见 `patch_xlsx`）。

    🔴 `read_only=True` 的 workbook **不会自己关**：它把 xlsx 当 zip 一直开着，
    同一进程随后 `os.replace` 写回这张表就报 `WinError 5 拒绝访问`（本次踩过）。
    所以必须 `close()`，并且放在 `finally` 里。
    """
    import openpyxl
    workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
    try:
        sheet = workbook.worksheets[0]
        rows = list(sheet.iter_rows(values_only=True))
    finally:
        workbook.close()
    header = rows[header_row - 1]
    result = []
    for index, row in enumerate(rows[header_row:], start=header_row + 1):
        if not row or row[0] is None or not isinstance(row[0], int):
            continue
        record = dict(zip(header, row))
        record['__row__'] = index
        result.append(record)
    return result


def read_rows_from_json(name: str) -> list[dict]:
    path = os.path.join(CLIENT_JSON, name)
    with io.open(path, encoding='utf-8') as handle:
        return json.load(handle)


def patch_xlsx(path: str, member: str, edits: dict[str, float]) -> None:
    """`edits` = {'Z19': 0.667, ...}；zip 级手术，只改目标格。

    🔴 写回会 `WinError 5`：那是 WPS/Excel 占着表（`os.replace` 需要目标文件的 DELETE 权限，
    而办公软件常以「允许读写、不允许删」的共享模式打开）。这里重试三次，仍失败就明确报出来，
    不去原地覆写 —— 那会让用户手上的编辑在下次保存时被回滚。
    """
    with zipfile.ZipFile(path) as archive:
        xml = archive.read(member).decode('utf-8')
    for ref, value in sorted(edits.items(), key=lambda item: (int(re.sub(r'[A-Z]', '', item[0])), item[0])):
        xml = set_cell(xml, ref, number_for_json(value))
    for attempt in range(3):
        try:
            write_zip(path, member, xml, BACKUP_DIR)
            return
        except PermissionError:
            if attempt == 2:
                raise SystemExit(
                    '写 %s 被拒绝（WinError 5）：请先关闭 WPS/Excel 里打开的这张表，再重跑。'
                    % os.path.basename(path))
            time.sleep(1.0)


def patch_json(path: str, key_to_value: dict[int, tuple[float, float]]) -> int:
    """写回 json，**逐字节沿用两份产物各自的排版**（否则一改就整文件重排，diff 没法看）。

    · `assets/remoteRef/*.json`：`{k, v, c}` 列存，`indent=0` + `(',', ':')`
    · `doc/.../json/client/*.json`：行数组，**一行一行**（`},\\n{`）
    """
    with io.open(path, encoding='utf-8') as handle:
        raw = handle.read()
    data = json.loads(raw)
    is_column_major = isinstance(data, dict)
    if is_column_major:                                         # remoteRef：列存 {k, v, c}
        keys = data['k']
        col_dur = keys.index('unitAttackDuration')
        col_hit = keys.index('unitAttackHitTime')
        col_id = keys.index('id')
        touched = 0
        for row in data['v']:
            plan = key_to_value.get(row[col_id])
            if not plan:
                continue
            row[col_dur] = number_for_json(plan[0])
            row[col_hit] = number_for_json(plan[1])
            touched += 1
        text = json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
    else:                                                       # client：行数组
        touched = 0
        for row in data:
            plan = key_to_value.get(row['id'])
            if not plan:
                continue
            row['unitAttackDuration'] = number_for_json(plan[0])
            row['unitAttackHitTime'] = number_for_json(plan[1])
            touched += 1
        text = '[' + ',\n'.join(
            json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in data) + ']'
    #  守卫：排版必须与改之前**逐字一致**（只允许数值不同），否则宁可报错也别悄悄重排。
    if text.count('\n') != raw.count('\n'):
        raise SystemExit('%s 的换行数变了（%d → %d），排版被改坏，中止'
                         % (os.path.basename(path), raw.count('\n'), text.count('\n')))
    with io.open(path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(text)
    return touched


def main(argv: list[str]) -> int:
    apply = '--apply' in argv

    # ── 1. 量测：prefab → attack 时长
    measured: dict[str, float | None] = {}

    def duration_of(prefab_path: str) -> float | None:
        if prefab_path not in measured:
            path = skel_of(prefab_path)
            if not path:
                measured[prefab_path] = None
            else:
                try:
                    measured[prefab_path] = spine_dur.attack_duration(path)
                except Exception as error:                       # noqa: BLE001
                    print('  !! 解析失败 %s：%r' % (path, error))
                    measured[prefab_path] = None
        return measured[prefab_path]

    #  先量玩家卡，怪物卡里 prefab 失效的按卡名借用
    player_rows = read_rows_from_xlsx(TABLES[0][1], TABLES[0][3])
    player_by_name = {row['name']: row for row in player_rows}
    by_name_duration: dict[str, float] = {}
    for row in player_rows:
        value = duration_of(row.get('unitPrefabPath') or '')
        if value:
            by_name_duration[row['name']] = value

    total_changed = 0
    for label, xlsx_path, member, header_row, json_name in TABLES:
        print('=' * 104)
        print('%s  %s' % (label, xlsx_path))
        print('%-7s %-10s %-26s %8s %8s %8s %8s  %s'
              % ('id', 'name', 'prefab', '现D', '现H', '实测D', '新H', '变更'))
        rows = read_rows_from_xlsx(xlsx_path, header_row)
        client_rows = {row['id']: row for row in read_rows_from_json(json_name)}
        header = {str(cell.value).strip(): cell.column_letter
                  for cell in _header_cells(xlsx_path, header_row) if cell.value}
        xlsx_edits: dict[str, float] = {}
        json_plan: dict[int, tuple[float, float]] = {}

        for row in rows:
            card_id = row['id']
            prefab = row.get('unitPrefabPath') or ''
            now_duration = row.get('unitAttackDuration')
            now_hit = row.get('unitAttackHitTime')
            if card_id in SKIP:
                print('%-7s %-10s %-26s %8s %8s %8s %8s  %s'
                      % (card_id, row['name'], prefab, now_duration, now_hit, '--', '--', '跳过：' + SKIP[card_id]))
                continue
            value = duration_of(prefab)
            if value is None and card_id in BORROW:
                borrowed = player_by_name.get(row['name'])
                if borrowed:
                    value = duration_of(borrowed.get('unitPrefabPath') or '')
                if value is None:
                    value = by_name_duration.get(row['name'])
                print('  ⚠ %s %s 的 unitPrefabPath=%r 找不到骨架，按同名玩家卡实测值 %s 回填'
                      % (card_id, row['name'], prefab, value))
            if value is None:
                print('%-7s %-10s %-26s %8s %8s %8s %8s  %s'
                      % (card_id, row['name'], prefab, now_duration, now_hit, '无 attack', '--', '跳过：量不到'))
                continue

            new_duration = round3(value)
            new_hit = round3(value * HIT_RATIO)
            same = (abs(float(now_duration or 0) - new_duration) < 5e-4
                    and abs(float(now_hit or 0) - new_hit) < 5e-4)
            print('%-7s %-10s %-26s %8s %8s %8.3f %8.3f  %s'
                  % (card_id, row['name'], prefab, now_duration, now_hit, new_duration, new_hit,
                     '' if same else '改'))
            if same:
                continue
            total_changed += 1
            xlsx_edits['%s%d' % (header['unitAttackDuration'], row['__row__'])] = new_duration
            xlsx_edits['%s%d' % (header['unitAttackHitTime'], row['__row__'])] = new_hit
            json_plan[card_id] = (new_duration, new_hit)
            if card_id not in client_rows:
                print('  ⚠ %s 不在 %s 里（源表有、产物没有），只改源表' % (card_id, json_name))

        if not xlsx_edits:
            print('  （无需改动）')
            continue
        json_plan = {key: value for key, value in json_plan.items() if key in client_rows}
        if not apply:
            print('  → 待写 %d 格（源表）/ %d 行（两份 json）；加 --apply 真写' % (len(xlsx_edits), len(json_plan)))
            continue
        patch_xlsx(xlsx_path, member, xlsx_edits)
        touch_client = patch_json(os.path.join(CLIENT_JSON, json_name), json_plan)
        touch_remote = patch_json(os.path.join(REMOTE_REF, json_name), json_plan)
        print('  → 已写：源表 %d 格 / client %d 行 / remoteRef %d 行' % (len(xlsx_edits), touch_client, touch_remote))

    print('=' * 104)
    print('%s：共 %d 张卡需要改' % ('已写盘' if apply else '预演（未写盘）', total_changed))
    if not apply:
        print('确认无误后加 --apply 执行；xlsx 会先备份到 %s' % os.path.relpath(BACKUP_DIR, PROJECT_ROOT))
    return 0


def _header_cells(xlsx_path: str, header_row: int):
    """表头行 → 单元格列表（`column_letter` + `value`）。同样必须 `close()`，见 `read_rows_from_xlsx`。"""
    import openpyxl
    workbook = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    try:
        return list(workbook.worksheets[0][header_row])
    finally:
        workbook.close()


if __name__ == '__main__':
    sys.exit(main(sys.argv))
