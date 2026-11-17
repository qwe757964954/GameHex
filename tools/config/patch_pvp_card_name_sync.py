# -*- coding: utf-8 -*-
"""按 `PVP-卡牌.xlsx` 的最新显示名，同步所有引用卡名的配置（2026-11-16）。

## 背景

策划在 2026-11-16 10:40 把两个卡名改回：

    68015  阿尔萨斯   → 机甲菇      （模型仍走 units/阿尔萨斯，名字用机甲菇）
    68017  毒箭蘑菇   → 毒箭菇      （prefab 一直是 skel/毒箭菇）

源表 B 列是唯一权威，但它只改了自己 —— 另外三处还留着旧名，会在界面上显示错名
（升级页材料位读 `cardLevelUp.name`，卡面读 `pvpCard.name`）。

## 同步范围（全配置目录扫过一遍 `*name*` 字段后确定）

| 文件 | 字段 | 旧值 | 说明 |
| --- | --- | --- | --- |
| `assets/remoteRef/pvpCard.json` | `68017.name` | 毒箭蘑菇 | 运行时真读 |
| `doc/.../json/client/pvpCard.json` | `68015.name` | 阿尔萨斯 | 转表产物 |
| （同上） | `68017.name` | 毒箭蘑菇 | |
| `assets/remoteRef/cardLevelUp.json` | `68015.name` ×51 | 阿尔萨斯 | 升级页材料位 |
| （同上） | `68017.name` ×51 | 毒箭蘑菇 | |
| `K-卡牌升级.xlsx` sheet1 B 列 | 68015/68017 | 已是新名 | 校验用，不动 |

## 明确不动的（各自有独立源表或属资源名）

- `monsterCard.json`（`PVP-怪物卡牌.xlsx`）：独立表，源表仍是 50017「阿尔萨斯」/ 50019「毒箭蘑菇」；
  顺带记一笔：remoteRef 版 50017 写的是「机甲菇」，与它自己的源表已经漂移（既有问题，不在本轮范围）。
- `general.json`（武将 68009「阿尔萨斯」）、`item.json` / `head.json`（头像与道具名）、
  `icon.json`（`兵种_头像_阿尔萨斯` 是美术资源 key）、`pvpAttrMap.json`（属性字段索引 `阿尔萨斯普攻伤害系数`）
  —— 全部是资源标识或他人的名字。

用法：
    python tools/config/patch_pvp_card_name_sync.py --check
    python tools/config/patch_pvp_card_name_sync.py --write
"""

import argparse
import html
import io
import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

from sync_treant_excel import ROOT, read_zip_rows, write_zip          # noqa: E402
from patch_bullet_falloff import set_cell_safe                        # noqa: E402
from patch_multi_target_falloff import dump_rows, read_rows            # noqa: E402
from patch_mushroom_race import dump_rich, read_packed                 # noqa: E402

DEMO = 'D:/Alan/Project/POW/Demo3.8'
REMOTE = os.path.join(DEMO, 'assets', 'remoteRef')
CLIENT = os.path.join(ROOT, 'json', 'client')
CARD_XLSX = os.path.join(ROOT, 'PVP-卡牌.xlsx')
LEVEL_XLSX = os.path.join(ROOT, 'K-卡牌升级.xlsx')
MONSTER_XLSX = os.path.join(ROOT, 'PVP-怪物卡牌.xlsx')
BACKUP = os.path.join(DEMO, 'tmp', 'backup_name_sync')

# 🔴 卡名是**跨表外键**：`TerritoryCampaignConfig.buildTerritoryCampaign` 用
#    `pvpCardByName`（按 name 建索引）把 `monsterCard` 的怪映射到 pvpCard，
#    名字对不上就落进 `monster:` 兜底分支、`pvpCardId` 缺失（领地章节 50003 波次直接红）。
#    所以改 pvpCard 的名字必须同步怪物卡里同款单位的名字。
#    怪物卡 id = pvpCard id + 50002（50001 主城 / 50002 金矿是额外两行），这里只列本轮涉及的。
MONSTER_OF = {50017: 68015, 50019: 68017}

ROW_RE = re.compile(r'<row r="(\d+)"[^>]*>(.*?)</row>', re.S)
CELL_RE = re.compile(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', re.S)


def load_sst(path):
    with zipfile.ZipFile(path) as handle:
        if 'xl/sharedStrings.xml' not in handle.namelist():
            return []
        raw = handle.read('xl/sharedStrings.xml').decode('utf-8')
    root = re.search(r'<sst.*?</sst>', raw, re.S)
    items = []
    for one in re.finditer(r'<si>(.*?)</si>', root.group(0), re.S):
        text = ''.join(re.findall(r'<t[^>]*>(.*?)</t>', one.group(1), re.S))
        items.append(html.unescape(re.sub(r'<[^>]+>', '', text)))
    return items


def read_names(path):
    """{id: 显示名}，从 PVP-卡牌 的 A/B 两列取。"""
    sst = load_sst(path)
    xml = read_zip_rows(path, 'xl/worksheets/sheet1.xml')
    names = {}
    for _row, body in ROW_RE.findall(xml):
        got = {}
        for match in CELL_RE.finditer(body):
            col, attr, inner = match.group(1), match.group(2), match.group(3) or ''
            value = re.search(r'<v>(.*?)</v>', inner, re.S)
            if 't="s"' in attr and value:
                got[col] = sst[int(value.group(1))]
            elif 't="inlineStr"' in attr or 't="str"' in attr:
                text = re.search(r'<t[^>]*>(.*?)</t>', inner, re.S)
                got[col] = html.unescape(text.group(1)) if text else ''
            else:
                got[col] = value.group(1) if value else ''
        card, name = got.get('A', ''), got.get('B', '')
        if card.isdigit() and 68000 < int(card) < 68200 and name:
            names[int(card)] = name
    if len(names) != 35:
        raise SystemExit('PVP-卡牌 只读到 %d 张卡名（应为 35）' % len(names))
    return names


def sync_k_table(names, check):
    """`K-卡牌升级.xlsx`「卡牌升级表」B 列（卡牌名称）。

    先解 sst 读当前值，**只改不一致的格** —— 已对齐时一格不写，xlsx 字节完全不变
    （无差别重写会把 1785 格 sharedString 全换成 inlineStr）。
    """
    path = LEVEL_XLSX
    sst = load_sst(path)
    xml = read_zip_rows(path, 'xl/worksheets/sheet1.xml')

    changed = 0
    for row_num, body in ROW_RE.findall(xml):
        unit = re.search(r'<c r="A%d"[^>]*>\s*<v>(\d+)</v>' % int(row_num), body)
        if not unit:
            continue
        card = int(unit.group(1))
        if card not in names:
            continue
        cell = re.search(r'<c r="B%d"[^>]*?(?:/>|>(.*?)</c>)' % int(row_num), body, re.S)
        if not cell:
            raise SystemExit('卡牌升级表 %d 行没有 B 列' % int(row_num))
        inner = cell.group(1) or ''
        attr = cell.group(0)[:cell.group(0).find('>')]
        value = re.search(r'<v>(.*?)</v>', inner, re.S)
        if 't="s"' in attr and value:
            current = sst[int(value.group(1))]
        elif 't="inlineStr"' in attr:
            text = re.search(r'<t[^>]*>(.*?)</t>', inner, re.S)
            current = html.unescape(text.group(1)) if text else ''
        else:
            current = value.group(1) if value else ''
        if current != names[card]:
            xml = set_cell_safe(xml, 'B%d' % int(row_num), names[card])
            changed += 1

    if changed and not check:
        write_zip(path, 'xl/worksheets/sheet1.xml', xml, BACKUP)
    return changed


def sync_json(names, check):
    report = []

    # ① pvpCard：两份都读的是 name 列，逐 id 覆盖
    for base, tag, dumper in ((REMOTE, 'remoteRef', 'rich'), (CLIENT, 'client', 'rows')):
        target = os.path.join(base, 'pvpCard.json')
        if dumper == 'rich':
            keys, _values, rows = read_packed(target)
            touched = 0
            for row in rows:
                card = int(str(row['id']))
                if card in names and row.get('name') != names[card]:
                    row['name'] = names[card]
                    touched += 1
            if not check and touched:
                with io.open(target, 'w', encoding='utf-8', newline='') as handle:
                    handle.write(dump_rich(keys, rows))
        else:
            data, trailing = read_rows(target)
            touched = 0
            for row in data:
                card = int(str(row['id']))
                if card in names and row.get('name') != names[card]:
                    row['name'] = names[card]
                    touched += 1
            if not check and touched:
                with io.open(target, 'w', encoding='utf-8', newline='') as handle:
                    handle.write(dump_rows(data, trailing))
        report.append(('pvpCard.json[%s]' % tag, touched))

    # ② cardLevelUp（只有 remoteRef 版带 name 列；client 版没有）
    target = os.path.join(REMOTE, 'cardLevelUp.json')
    keys, _values, rows = read_packed(target)
    touched = 0
    for row in rows:
        card = int(str(row['id']))
        if card in names and row.get('name') != names[card]:
            row['name'] = names[card]
            touched += 1
    if not check and touched:
        with io.open(target, 'w', encoding='utf-8', newline='') as handle:
            handle.write(dump_rich(keys, rows))
    report.append(('cardLevelUp.json[remoteRef]', touched))
    return report


def verify(names):
    """改完回读：四处 name 必须全等于源表。"""
    problems = []
    for base, tag, rich in ((REMOTE, 'remoteRef/pvpCard', True), (CLIENT, 'client/pvpCard', False)):
        target = os.path.join(base, 'pvpCard.json')
        if rich:
            _k, _v, rows = read_packed(target)
        else:
            rows, _t = read_rows(target)
        for row in rows:
            card = int(str(row['id']))
            if card in names and row.get('name') != names[card]:
                problems.append('%s %d: %r != %r' % (tag, card, row.get('name'), names[card]))
    _k, _v, rows = read_packed(os.path.join(REMOTE, 'cardLevelUp.json'))
    for row in rows:
        card = int(str(row['id']))
        if card in names and row.get('name') != names[card]:
            problems.append('cardLevelUp %d: %r != %r' % (card, row.get('name'), names[card]))
    for base, tag, rich in ((REMOTE, 'remoteRef/monsterCard', True), (CLIENT, 'client/monsterCard', False)):
        target = os.path.join(base, 'monsterCard.json')
        if rich:
            _k, _v, rows = read_packed(target)
        else:
            rows, _t = read_rows(target)
        for row in rows:
            monster_id = int(str(row['id']))
            if monster_id in MONSTER_OF and row.get('name') != names[MONSTER_OF[monster_id]]:
                problems.append('%s %d: %r != %r'
                                % (tag, monster_id, row.get('name'), names[MONSTER_OF[monster_id]]))
    return problems


def sync_monster_card(names, check):
    """怪物卡（`PVP-怪物卡牌.xlsx` + 两份 monsterCard.json）跟随 pvpCard 改名。

    50017 / 50019 是同一只单位在怪物侧的镜像（`headIcon` 与 pvpCard 相同、`unitPrefabPath`
    同源），名字不一致就会让领地章节的 name 映射断链。
    """
    # 先确认映射关系没错：头图标必须与对应 pvpCard 一致
    _k, _v, pvp_rows = read_packed(os.path.join(REMOTE, 'pvpCard.json'))
    pvp_by_id = {int(str(row['id'])): row for row in pvp_rows}
    for monster_id, card_id in MONSTER_OF.items():
        if pvp_by_id[card_id].get('headIcon') != monster_lookup(monster_id).get('headIcon'):
            raise SystemExit('怪物卡 %d 与 pvpCard %d 的头图标不一致，映射可疑' % (monster_id, card_id))

    # ① 源表 B 列（单行）
    sst = load_sst(MONSTER_XLSX)
    xml = read_zip_rows(MONSTER_XLSX, 'xl/worksheets/sheet1.xml')
    changed = 0
    for monster_id, card_id in MONSTER_OF.items():
        row_num, row_body = None, ''
        for rn, body in ROW_RE.findall(xml):
            unit = re.search(r'<c r="A%d"[^>]*>\s*<v>(\d+)</v>' % int(rn), body)
            if unit and int(unit.group(1)) == monster_id:
                row_num, row_body = int(rn), body
                break
        if row_num is None:
            raise SystemExit('怪物卡表找不到 %d' % monster_id)
        cell = re.search(r'<c r="B%d"[^>]*?(?:/>|>(.*?)</c>)' % row_num, row_body, re.S)
        if not cell:
            raise SystemExit('怪物卡表 %d 行没有 B 列' % row_num)
        inner = cell.group(1) or ''
        value = re.search(r'<v>(.*?)</v>', inner, re.S)
        if 't="s"' in cell.group(0) and value:
            current = sst[int(value.group(1))]
        elif value:
            current = html.unescape(value.group(1))
        else:
            current = ''
        if current != names[card_id]:
            xml = set_cell_safe(xml, 'B%d' % row_num, names[card_id])
            changed += 1
    if changed and not check:
        write_zip(MONSTER_XLSX, 'xl/worksheets/sheet1.xml', xml, BACKUP)

    # ② 两份 JSON
    json_changed = 0
    for base, tag, rich in ((REMOTE, 'remoteRef', True), (CLIENT, 'client', False)):
        target = os.path.join(base, 'monsterCard.json')
        if rich:
            keys, _values, rows = read_packed(target)
            touched = 0
            for row in rows:
                monster_id = int(str(row['id']))
                if monster_id in MONSTER_OF and row.get('name') != names[MONSTER_OF[monster_id]]:
                    row['name'] = names[MONSTER_OF[monster_id]]
                    touched += 1
            if touched and not check:
                with io.open(target, 'w', encoding='utf-8', newline='') as handle:
                    handle.write(dump_rich(keys, rows))
        else:
            data, trailing = read_rows(target)
            touched = 0
            for row in data:
                monster_id = int(str(row['id']))
                if monster_id in MONSTER_OF and row.get('name') != names[MONSTER_OF[monster_id]]:
                    row['name'] = names[MONSTER_OF[monster_id]]
                    touched += 1
            if touched and not check:
                with io.open(target, 'w', encoding='utf-8', newline='') as handle:
                    handle.write(dump_rows(data, trailing))
        json_changed += touched
        print('  monsterCard.json[%s] 改 %d 行' % (tag, touched))
    return changed, json_changed


def monster_lookup(monster_id):
    """从 remoteRef/monsterCard.json 取一行（用于头图标断言）。"""
    _k, _v, rows = read_packed(os.path.join(REMOTE, 'monsterCard.json'))
    for row in rows:
        if int(str(row['id'])) == monster_id:
            return row
    raise SystemExit('monsterCard.json 没有 %d' % monster_id)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    check = not args.write

    names = read_names(CARD_XLSX)
    print('== 源表 PVP-卡牌 读到 %d 张卡名' % len(names))

    print('== ① K-卡牌升级.xlsx B 列')
    k_rows = sync_k_table(names, check)
    print('  写 %d 格（35 卡 × 51 级，值已对齐时重写不改变字节）' % k_rows)

    print('== ② JSON 回灌')
    for name, touched in sync_json(names, check):
        print('  %-28s 改 %d 行' % (name, touched))

    print('== ③ 怪物卡（名字是跨表外键，必须跟）')
    m_rows, m_json = sync_monster_card(names, check)
    print('  PVP-怪物卡牌.xlsx B 列 改 %d 格' % m_rows)

    problems = verify(names) if not check else []
    if problems:
        for one in problems[:10]:
            print('  [FAIL]', one)
        raise SystemExit('回读校验失败 %d 处' % len(problems))
    print('== %s ==' % ('干跑完成，未落盘' if check else '已落盘，回读校验通过'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
