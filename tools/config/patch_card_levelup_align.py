# -*- coding: utf-8 -*-
"""`cardLevelUp` 全表对齐 `pvpCard` 面板（通用版，2026-11-16）。

## 为什么要通用版

`patch_mushroom_card_levelup.py` 把 5 张蘑菇卡写死在 `PANEL` 里。本轮改的是花果标准的
跨种族校正（6 张，涉及蘑菇/盆栽/僵尸），写死就复用不了。这里改成：**每张卡都读
`PVP-卡牌.xlsx` 的 U/V/R，与 `cardLevelUp` 的 L0 逐张比对，不一致就重算整条 51 级曲线**。

字段口径不变：

    maxHp      ← pvpCard.unitMaxHp
    attack     ← pvpCard.unitAttack
    buildingHp ← pvpCard.baseHp

## 曲线怎么来

`cardLevelUp` 的 I 列是 0~50 级绝对面板值，全表共享一条等级乘子，且「L0 基值相同 ⇒
51 级逐级完全一致」（35 张卡 20 个基值组已验证）。所以新序列直接**抄同基值的既有卡**，
不做浮点推导。参考池只用「L0 已经等于 pvpCard」的卡来建，避免拿过期值当模板。

用法：
    python tools/config/patch_card_levelup_align.py --check
    python tools/config/patch_card_levelup_align.py --write
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

from sync_treant_excel import ROOT, read_zip_rows, write_zip                    # noqa: E402
from patch_bullet_falloff import set_cell_safe                                  # noqa: E402
from patch_multi_target_falloff import dump_rows, read_rows                      # noqa: E402
from patch_mushroom_race import dump_rich, read_packed                           # noqa: E402

DEMO = 'D:/Alan/Project/POW/Demo3.8'
REMOTE = os.path.join(DEMO, 'assets', 'remoteRef')
CLIENT = os.path.join(ROOT, 'json', 'client')
CARD_XLSX = os.path.join(ROOT, 'PVP-卡牌.xlsx')
LEVEL_XLSX = os.path.join(ROOT, 'K-卡牌升级.xlsx')
CARD_MEMBER = 'xl/worksheets/sheet1.xml'
LEVEL_MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP = os.path.join(DEMO, 'tmp', 'backup_levelup_align')

FIELDS = ('maxHp', 'attack', 'buildingHp')
ROW_RE = re.compile(r'<row r="(\d+)"[^>]*>(.*?)</row>', re.S)


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


def cell_value(body, ref, sst):
    cell = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, body, re.S)
    if not cell:
        return ''
    inner = cell.group(1) or ''
    found = re.search(r'<v>(.*?)</v>', inner, re.S)
    if 't="s"' in cell.group(0) and found:
        return sst[int(found.group(1))]
    if 't="inlineStr"' in cell.group(0):
        text = re.search(r'<t[^>]*>(.*?)</t>', inner, re.S)
        return html.unescape(text.group(1)) if text else ''
    return found.group(1) if found else ''


def read_panels():
    """{id: (maxHp, attack, buildingHp)}，取自 PVP-卡牌 R/U/V。"""
    sst = load_sst(CARD_XLSX)
    xml = read_zip_rows(CARD_XLSX, CARD_MEMBER)
    panels = {}
    for row_num, body in ROW_RE.findall(xml):
        card = cell_value(body, 'A%d' % int(row_num), sst)
        if not card.isdigit() or not 68000 < int(card) < 68200:
            continue
        panels[int(card)] = (int(float(cell_value(body, 'U%d' % int(row_num), sst) or 0)),
                             int(float(cell_value(body, 'V%d' % int(row_num), sst) or 0)),
                             int(float(cell_value(body, 'R%d' % int(row_num), sst) or 0)))
    if len(panels) != 35:
        raise SystemExit('PVP-卡牌 读到 %d 张（应为 35）' % len(panels))
    return panels


def read_levels():
    """{id: {level: [attrList]}}，来自 K-卡牌升级 sheet1。"""
    sst = load_sst(LEVEL_XLSX)
    xml = read_zip_rows(LEVEL_XLSX, LEVEL_MEMBER)
    levels = {}
    rows = {}
    for row_num, body in ROW_RE.findall(xml):
        card = cell_value(body, 'A%d' % int(row_num), sst)
        level = cell_value(body, 'C%d' % int(row_num), sst)
        if not card.isdigit() or not level.isdigit() or not 68000 < int(card) < 68200:
            continue
        blob = cell_value(body, 'I%d' % int(row_num), sst)
        try:
            attrs = json.loads(blob) if blob else []
        except ValueError:
            continue
        index = int(level)
        levels.setdefault(int(card), {})[index] = {one['statId']: one['value'] for one in attrs}
        rows[(int(card), index)] = int(row_num)
    return levels, rows


def build_curve(levels):
    """按 L0 基值建曲线池：{字段: {基值: [L0..L50]}}。

    🔴 池必须收**全部**卡，不能排除待改的卡：`68010` 是唯一持有 `maxHp=1200` 的卡，而它自己
    也在待改列表（pvpCard 说 600）—— 排掉就没人能提供 1200 的曲线。曲线形状来自全局等级乘子，
    任何一张卡都是合法模板；只要「同基值 ⇒ 同序列」成立即可。
    """
    curves = {field: {} for field in FIELDS}
    owner = {field: {} for field in FIELDS}
    for card, level_map in levels.items():
        if len(level_map) != 51:
            raise SystemExit('card %d 只有 %d 级' % (card, len(level_map)))
        base = level_map[0]
        for field in FIELDS:
            value = base.get(field)
            if value is None:
                continue
            series = [level_map[i][field] for i in range(51)]
            known = curves[field].get(value)
            if known is None:
                curves[field][value] = series
            elif known != series:
                raise SystemExit('%s 基值 %s 在 %d 与前面卡不一致' % (field, value, card))
            owner[field].setdefault(value, set()).add(card)
    return curves, owner


def plan():
    panels = read_panels()
    levels, row_index = read_levels()

    stale = set()
    for card, (hp, atk, bhp) in panels.items():
        l0 = levels.get(card, {}).get(0, {})
        if (l0.get('maxHp'), l0.get('attack'), l0.get('buildingHp')) != (hp, atk, bhp):
            stale.add(card)

    curves, owner = build_curve(levels)
    wanted = {}
    for card in sorted(stale):
        hp, atk, bhp = panels[card]
        wanted[card] = {}
        series = {}
        for field, base in (('maxHp', hp), ('attack', atk), ('buildingHp', bhp)):
            if base in curves[field]:
                series[field] = curves[field][base]
            elif field == 'buildingHp' and base == hp * 2 and hp in curves['maxHp']:
                # 全表第一次出现的建筑血基值（例如 2400 = 生命 1200 × 2）没有现成模板，
                # 按「建筑血 = 单位生命 × 2」（花果 9/10 张成立）用生命曲线放大。
                series[field] = [value * 2 for value in curves['maxHp'][hp]]
                print('  [推导] card %d 的 buildingHp=%d 无模板，用 maxHp=%d 曲线 ×2' % (card, base, hp))
            else:
                raise SystemExit('card %d 需要 %s 基值 %d，但全表没有参考曲线' % (card, field, base))
        for level in range(51):
            wanted[card][level] = [
                {'statId': 'maxHp', 'value': series['maxHp'][level]},
                {'statId': 'attack', 'value': series['attack'][level]},
                {'statId': 'buildingHp', 'value': series['buildingHp'][level]},
            ]
    return panels, levels, row_index, stale, curves, owner, wanted


def describe(panels, levels, stale):
    print('  %-6s %-26s → %-26s' % ('id', 'cardLevelUp L0（当前）', 'pvpCard 面板（目标）'))
    for card in sorted(stale):
        l0 = levels[card][0]
        print('  %-6d %-26s → %-26s'
              % (card,
                 '%d/%d/%d' % (l0.get('maxHp', 0), l0.get('attack', 0), l0.get('buildingHp', 0)),
                 '%d/%d/%d' % panels[card]))


def write_excel(wanted, row_index, check):
    xml = read_zip_rows(LEVEL_XLSX, LEVEL_MEMBER)
    changed = 0
    for card, per_level in wanted.items():
        for level, attrs in per_level.items():
            text = json.dumps(attrs, ensure_ascii=False, separators=(',', ':'))
            xml = set_cell_safe(xml, 'I%d' % row_index[(card, level)], text)
            changed += 1
    if changed and not check:
        write_zip(LEVEL_XLSX, LEVEL_MEMBER, xml, BACKUP)
    return changed


def write_json(wanted, check):
    total = 0
    target = os.path.join(REMOTE, 'cardLevelUp.json')
    keys, _values, rows = read_packed(target)
    touched = 0
    for row in rows:
        card = int(str(row['id']))
        level = int(str(row['level']))
        if card in wanted and level in wanted[card]:
            row['attrList'] = [dict(one) for one in wanted[card][level]]
            touched += 1
    if touched and not check:
        with io.open(target, 'w', encoding='utf-8', newline='') as handle:
            handle.write(dump_rich(keys, rows))
    print('  cardLevelUp.json[remoteRef] 改 %d 行' % touched)
    total += touched

    target = os.path.join(CLIENT, 'cardLevelUp.json')
    data, trailing = read_rows(target)
    touched = 0
    for row in data:
        card = int(str(row['id']))
        level = int(str(row['level']))
        if card in wanted and level in wanted[card]:
            row['attrList'] = [dict(one) for one in wanted[card][level]]
            touched += 1
    if touched and not check:
        with io.open(target, 'w', encoding='utf-8', newline='') as handle:
            handle.write(dump_rows(data, trailing))
    print('  cardLevelUp.json[client]    改 %d 行' % touched)
    total += touched
    return total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    check = not args.write

    panels, levels, row_index, stale, _curves, _owner, wanted = plan()
    print('== cardLevelUp L0 与 pvpCard 不一致 %d 张' % len(stale))
    if not stale:
        print('== 已全部对齐，无需改动 ==')
        return 0
    describe(panels, levels, stale)

    print('== ① K-卡牌升级.xlsx I 列')
    cells = write_excel(wanted, row_index, check)
    print('  改 %d 格（%d 张 × 51 级）' % (cells, len(stale)))
    print('== ② 两份 cardLevelUp.json')
    total = write_json(wanted, check)
    print('== %s ==' % ('干跑完成，未落盘' if check else '已落盘'))
    if check:
        print('  将改 %d 格源表 + %d 行 JSON' % (cells, total))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
