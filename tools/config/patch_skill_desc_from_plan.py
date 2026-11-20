# -*- coding: utf-8 -*-
"""按链号把 `pvpSkillPlan` 的技能名 / 描述同步到另外两份产物（通用）。

改三处：
  · `armySkillLevelUp.json`（client + remoteRef）的 name / desc（卡牌 UI 真读这份）；
  · `K-卡牌升级.xlsx` sheet2（卡牌技能升级表）B 列技能名 / C 列描述。

值一律从 `pvpSkillPlan` 读（不在这里抄第二份）：两份 `pvpSkillPlan` 不一致、
或者 `armySkillLevelUp` 缺档位，直接报错退出，绝不「猜一个值写下去」。

为什么不复用 `patch_mushroom_explosion_k.py`：那个把 CHAIN 写死成 101704。
为什么不复用 `patch_batch17_k.py`：那个按整张 CHAINS 表重写 B/C/D/L/M，
第 17 批之后多条链的文案又改过几轮，重跑会把它们一起打回旧值。

幂等：内容没变就不写盘。
用法：python tools/config/patch_skill_desc_from_plan.py 101404 [101405 ...]
"""
import io
import json
import os
import re
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

LEVELS = (1, 2, 3)


def load_plan(chain):
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
            if row.get('skillChainId') is None or int(row['skillChainId']) != chain:
                continue
            level = int(row['skillLevel'])
            got = (row['skillName'], row['desc'])
            if level in out and out[level] != got:
                raise SystemExit('[fail] %s 链第 %d 档两份 pvpSkillPlan 不一致：%r vs %r'
                                 % (chain, level, out[level], got))
            out[level] = got
    missing = [level for level in LEVELS if level not in out]
    if missing:
        raise SystemExit('[fail] %s 在 pvpSkillPlan 里缺档位：%s' % (chain, missing))
    return out


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


def patch_level_up(chain, plan, folder, packed):
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
    for level in LEVELS:
        name, desc = plan[level]
        hit = [row for row in rows
               if int(field(row, 'id')) == chain and int(field(row, 'skilllevel')) == level]
        if len(hit) != 1:
            raise SystemExit('[fail] %s 里 id=%d 第 %d 档有 %d 行（预期 1）'
                             % (path, chain, level, len(hit)))
        row = hit[0]
        for column, value in (('name', name), ('desc', desc)):
            if field(row, column) != value:
                setter(row, column, value)
                changed += 1
    if changed:
        with io.open(path, 'w', encoding='utf-8', newline='') as handle:
            if packed:
                handle.write('{\r\n"k":%s,\r\n"v":%s,\r\n"c":%s\r\n}'
                             % (render(keys), render(rows), render(data['c'])))
            else:
                json.dump(rows, handle, ensure_ascii=False, separators=(',', ':'))
    print('[ok] %s/armySkillLevelUp.json（链 %d）：改 %d 格'
          % (os.path.basename(os.path.dirname(path)), chain, changed))


def rows_of_chain(xml, chain):
    """链号 → {档位: 行号}。A 列链号、E 列档位。"""
    out = {}
    for row in range(3, 1400):
        got = value_of(xml, 'A%d' % row)
        if not got or not got.strip().isdigit() or int(got) != chain:
            continue
        level = value_of(xml, 'E%d' % row)
        if level and level.strip().isdigit():
            out[int(level)] = row
    return out


def patch_xlsx(plans, tag):
    xml = read_zip_rows(XLSX, MEMBER)
    plan_of_cell = {}
    for chain, plan in plans.items():
        targets = rows_of_chain(xml, chain)
        missing = [level for level in LEVELS if level not in targets]
        if missing:
            raise SystemExit('[fail] K 表找不到链 %d 的档位：%s' % (chain, missing))
        for level in LEVELS:
            row = targets[level]
            plan_of_cell['B%d' % row] = plan[level][0]
            plan_of_cell['C%d' % row] = plan[level][1]

    changed = 0
    for ref in sorted(plan_of_cell):
        value = plan_of_cell[ref]
        current = value_of(xml, ref)
        if current is not None and current == str(value):
            continue
        xml = write_cell(xml, ref, value)
        changed += 1

    if not changed:
        print('[skip] K 表 B/C 已是目标值')
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(XLSX, os.path.join(BACKUP_DIR, 'K-卡牌升级.xlsx.bak-%s' % tag))
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
    chains = [int(arg) for arg in sys.argv[1:]]
    if not chains:
        raise SystemExit('用法：python tools/config/patch_skill_desc_from_plan.py <链号> [链号 ...]')
    plans = {}
    for chain in chains:
        plans[chain] = load_plan(chain)
        print('[plan] %d: %s' % (chain, ' | '.join(
            '%d:%s' % (level, plans[chain][level][0]) for level in LEVELS)))
    for chain in chains:
        patch_level_up(chain, plans[chain], CLIENT, False)
        patch_level_up(chain, plans[chain], REMOTE, True)
    patch_xlsx(plans, 'chain-' + '-'.join(str(chain) for chain in chains))


if __name__ == '__main__':
    main()
