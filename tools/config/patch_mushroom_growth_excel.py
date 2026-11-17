# -*- coding: utf-8 -*-
"""把 5 张蘑菇卡的成长增量写回 `PVP-修改器适配.xlsx / PVP成长`（2026-11-16）。

## 为什么需要这一步

`cardLevelUp` 的 I 列 `attrList` 是**该等级的绝对面板值**，而 `pvpUnitGrowth` 是它的增量派生：

    attackFlat(L) = cardLevelUp.attrList.attack(L) − attrList.attack(1)
    maxHpFlat(L)  = cardLevelUp.attrList.maxHp(L)  − attrList.maxHp(1)

本轮把 68012~68016 的 L0/L1 基值对齐了 `pvpCard`（见 `patch_mushroom_card_levelup.py`），
基值一变，全部 50 级的 flat 都要重算 —— 否则「升级后属性 == cardLevelUp 该级值」这条
恒等式在这 5 张卡上会差一个旧基值。

两份 json 已由 `patch_growth_from_card_level_up.js` 重算（脚本自带那条恒等式断言），
本脚本只负责把同一份数据落到源表，保证 eSon 打表不会把 json 刷回旧值。

## 为什么不用 `patch_growth_from_card_level_up_excel.py`

那个脚本是**一次性 375 → 1750 行迁移**，守卫写死「dimension = A1:I381、最后数据行 381、
68001 的 L1 attackFlat = 45（旧品质补偿指纹）」。表早就迁移完了（A1:I1756），守卫必然拒绝。
所以这里只做增量：按 `(unitId, level)` 定位行，改 C（attackFlat）/ E（maxHpFlat）两列。

用法：
    python tools/config/patch_mushroom_growth_excel.py --check
    python tools/config/patch_mushroom_growth_excel.py --write
"""

import argparse
import html
import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

from sync_treant_excel import ROOT, read_zip_rows, set_cell, write_zip   # noqa: E402

DEMO = 'D:/Alan/Project/POW/Demo3.8'
GROWTH_JSON = os.path.join(DEMO, 'assets', 'remoteRef', 'pvpUnitGrowth.json')
GROWTH_XLSX = os.path.join(ROOT, 'PVP-修改器适配.xlsx')
MEMBER = 'xl/worksheets/sheet3.xml'          # workbook.xml: rId3 = PVP成长
BACKUP = os.path.join(DEMO, 'tmp', 'backup_mushroom_growth')

CARDS = None      # None = 全表 35 张；给元组则只同步那几张（2026-11-16 起默认全表）
LEVELS = range(1, 51)

ROW_RE = re.compile(r'<row r="(\d+)"[^>]*>(.*?)</row>', re.S)
CELL_RE = re.compile(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', re.S)


def load_sst():
    with zipfile.ZipFile(GROWTH_XLSX) as handle:
        raw = handle.read('xl/sharedStrings.xml').decode('utf-8')
    root = re.search(r'<sst.*?</sst>', raw, re.S)
    items = []
    for one in re.finditer(r'<si>(.*?)</si>', root.group(0), re.S):
        text = ''.join(re.findall(r'<t[^>]*>(.*?)</t>', one.group(1), re.S))
        items.append(html.unescape(re.sub(r'<[^>]+>', '', text)))
    return items


def scan(xml, sst):
    """{ (unitId, level): (行号, attackFlat, maxHpFlat) }"""
    found = {}
    for row_num, body in ROW_RE.findall(xml):
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
        unit, level = got.get('A', ''), got.get('B', '')
        if not unit.isdigit() or not level.isdigit():
            continue
        found[(int(unit), int(level))] = (int(row_num), got.get('C', ''), got.get('E', ''))
    return found


def wanted():
    table = json.loads(open(GROWTH_JSON, 'r', encoding='utf-8').read())
    keys = table['k']
    out = {}
    for row in table['v']:
        item = dict(zip(keys, row))
        unit, level = int(str(item['unitId'])), int(str(item['level']))
        if (CARDS is None or unit in CARDS) and level in LEVELS:
            out[(unit, level)] = (int(item['attackFlat']), int(item['maxHpFlat']))
    expect = (35 if CARDS is None else len(CARDS)) * len(LEVELS)
    if len(out) != expect:
        raise SystemExit('growth json 里只找到 %d 行（应为 %d）' % (len(out), expect))
    return out


def _same(text, value):
    if text == '':
        return False
    try:
        return int(float(text)) == value
    except ValueError:
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    check = not args.write

    sst = load_sst()
    xml = read_zip_rows(GROWTH_XLSX, MEMBER)
    found = scan(xml, sst)
    want = wanted()

    missing = [key for key in want if key not in found]
    if missing:
        raise SystemExit('PVP成长 缺 %d 行，例如 %s' % (len(missing), missing[:5]))

    changes = 0
    for (unit, level), (atk, hp) in sorted(want.items()):
        row_num, old_atk, old_hp = found[(unit, level)]
        if not _same(old_atk, atk):
            xml = set_cell(xml, 'C%d' % row_num, atk)
            changes += 1
        if not _same(old_hp, hp):
            xml = set_cell(xml, 'E%d' % row_num, hp)
            changes += 1

    if not check and changes:
        write_zip(GROWTH_XLSX, MEMBER, xml, BACKUP)
    print('  目标 %d 行（%s × %d 级），改 %d 格'
          % (len(want), '全表 35 卡' if CARDS is None else len(CARDS), len(LEVELS), changes))
    print('== %s ==' % ('干跑完成，未落盘' if check else '已落盘'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
