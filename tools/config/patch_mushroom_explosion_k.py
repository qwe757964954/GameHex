# -*- coding: utf-8 -*-
"""101704 改名（2026-11-19）：K 表 + armySkillLevelUp 两份产物。

只动 **101704 这三行**：
  · `K-卡牌升级.xlsx` sheet2（卡牌技能升级表）B 列技能名 / C 列描述；
  · `armySkillLevelUp.json`（client + remoteRef）id=101704 的 name / desc。

为什么不用 `patch_batch17_k.py` 重跑：那个脚本按整张 CHAINS 表重写 B/C/D/L/M，
第 17 批之后 102203 / 102004 / 103503 的文案又改过几轮，重跑会把它们一起打回旧值。
本脚本只认 101704，值一律从 `pvpSkillPlan` 读（不在这里抄第二份）——两份产物不一致直接报错。

幂等：内容没变就不写盘。
用法：python tools/config/patch_mushroom_explosion_k.py
"""
import io
import json
import os
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows  # noqa: E402
from patch_burst_k import value_of, write_cell  # noqa: E402

ROOT = 'D:/Alan/Project/POW'
XLSX = os.path.join(ROOT, 'doc', '塔防数据配置', 'K-卡牌升级.xlsx')
MEMBER = 'xl/worksheets/sheet2.xml'
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client')
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef')
BACKUP_DIR = os.path.join(ROOT, 'doc', '塔防数据配置_历史备份')

CHAIN = 101704


def load_plan():
    """档位 → (技能名, 描述)；两份 pvpSkillPlan 必须逐字一致。"""
    out = {}
    for folder, packed in ((REMOTE, True), (CLIENT, False)):
        path = os.path.join(folder, 'pvpSkillPlan.json')
        with io.open(path, encoding='utf-8') as handle:
            data = json.load(handle)
        if packed:
            keys = data['k']
            rows = [dict(zip(keys, row)) for row in data['v']]
        else:
            rows = data
        for row in rows:
            if int(row['skillChainId']) != CHAIN:
                continue
            level = int(row['skillLevel'])
            got = (row['skillName'], row['desc'])
            if level in out and out[level] != got:
                raise SystemExit('[fail] 第 %d 档两份 pvpSkillPlan 不一致：%r vs %r'
                                 % (level, out[level], got))
            out[level] = got
    missing = [level for level in (1, 2, 3) if level not in out]
    if missing:
        raise SystemExit('[fail] pvpSkillPlan 缺档位：%s' % missing)
    return out


def patch_level_up(plan, folder, packed):
    path = os.path.join(folder, 'armySkillLevelUp.json')
    with io.open(path, encoding='utf-8') as handle:
        data = json.load(handle)
    if packed:
        keys = data['k']
        rows = data['v']
        index = {name: position for position, name in enumerate(keys)}

        def field(row, name):
            return row[index[name]]

        def setter(row, name, value):
            row[index[name]] = value
    else:
        rows = data

        def field(row, name):
            return row.get(name)

        def setter(row, name, value):
            row[name] = value

    changed = 0
    for level in (1, 2, 3):
        name, desc = plan[level]
        hit = [row for row in rows
               if int(field(row, 'id')) == CHAIN and int(field(row, 'skilllevel')) == level]
        if len(hit) != 1:
            raise SystemExit('[fail] %s 里 id=%d 第 %d 档有 %d 行（预期 1）'
                             % (path, CHAIN, level, len(hit)))
        row = hit[0]
        for column, value in (('name', name), ('desc', desc)):
            if field(row, column) != value:
                setter(row, column, value)
                changed += 1
    if changed:
        with io.open(path, 'w', encoding='utf-8', newline='') as handle:
            if packed:
                import re

                def render(value):
                    if isinstance(value, list):
                        if not value:
                            return '[]'
                        return '[\r\n%s\r\n]' % ',\r\n'.join(render(item) for item in value)
                    if isinstance(value, dict):
                        items = list(value.items())
                        if not items:
                            return '{}'
                        return '{\r\n%s\r\n}' % ',\r\n'.join(
                            '%s:%s' % (json.dumps(key, ensure_ascii=False), render(item))
                            for key, item in items)
                    return json.dumps(value, ensure_ascii=False)
                handle.write('{\r\n"k":%s,\r\n"v":%s,\r\n"c":%s\r\n}'
                             % (render(keys), render(rows), render(data['c'])))
            else:
                json.dump(rows, handle, ensure_ascii=False, separators=(',', ':'))
    print('[ok] %s/armySkillLevelUp.json：改 %d 格'
          % (os.path.basename(os.path.dirname(path)), changed))


def rows_of_chain(xml):
    """链号 → {档位: 行号}。A 列链号、E 列档位。"""
    out = {}
    for row in range(3, 1400):
        got = value_of(xml, 'A%d' % row)
        if not got or not got.strip().isdigit() or int(got) != CHAIN:
            continue
        level = value_of(xml, 'E%d' % row)
        if level and level.strip().isdigit():
            out[int(level)] = row
    return out


def patch_xlsx(plan):
    xml = read_zip_rows(XLSX, MEMBER)
    targets = rows_of_chain(xml)
    missing = [level for level in (1, 2, 3) if level not in targets]
    if missing:
        raise SystemExit('[fail] K 表找不到档位：%s' % missing)

    changed = 0
    for level in (1, 2, 3):
        name, desc = plan[level]
        row = targets[level]
        for ref, value in (('B%d' % row, name), ('C%d' % row, desc)):
            current = value_of(xml, ref)
            if current is not None and current == str(value):
                continue
            xml = write_cell(xml, ref, value)
            changed += 1

    if not changed:
        print('[skip] K 表 B/C 已是目标值')
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(XLSX, os.path.join(BACKUP_DIR, 'K-卡牌升级.xlsx.bak-mushroom'))
    tmp = XLSX + '.tmp'
    with zipfile.ZipFile(XLSX) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == MEMBER:
                data = xml.encode('utf-8')
            dst.writestr(info, data)
    os.replace(tmp, XLSX)
    print('[ok] K-卡牌升级.xlsx：改 %d 格' % changed)


def main():
    plan = load_plan()
    print('[plan] ' + ' | '.join('%d:%s' % (level, plan[level][0]) for level in (1, 2, 3)))
    patch_level_up(plan, CLIENT, False)
    patch_level_up(plan, REMOTE, True)
    patch_xlsx(plan)


if __name__ == '__main__':
    main()
