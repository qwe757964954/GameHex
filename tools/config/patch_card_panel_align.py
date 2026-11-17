# -*- coding: utf-8 -*-
"""以「花果」为标准的卡牌面板校正（2026-11-16）。

## 口径（用户原话）

「参照现在最新的 pvp 卡牌表中的花果种族的职业和品阶属性的比例，将花果种族的单位基础生命值、
攻击力、建筑血量作为标准参考，调整其他种族的不符合比例的数值，直接调整源表。」

## 花果给出的标准

`camp=花果` 的 10 张卡，每个「职业 × 品阶」组合恰好只有一组值：

| 品阶 | 射手 | 法师 | 战士 | 坦克 |
| --- | --- | --- | --- | --- |
| 绿 | 40/12/120 | — | — | 300/16/600 |
| 蓝 | 120/24/240 | 120/24/240 | — | — |
| 紫 | — | — | 400/52/800 | 1200/24/2400 |
| 金 | 600/120/1200 | 600/120/1200 | 1000/130/2000 | — |

两条可验证的比例：

· **射手 = 法师**（蓝 120/24、金 600/120 完全相同）；
· **战士 = 射手 ×（生命 1.667 / 攻击 1.083）**（紫 400/52 vs 紫射手 240/48；金 1000/130 vs 金射手 600/120）；
· **建筑血 = 单位生命 × 2**（10 张里 9 张成立，唯一例外是 68001 绿射手 40/120，它自己就是标准，不动）。

## 校正规则

1. 其他种族的卡，若「职业 × 品阶」在花果有基准且三字段不等 ⇒ 三字段全部对齐基准；
2. 无花果基准的卡，**不动生命与攻击**（无依据），只在建筑血 ≠ 生命 × 2 时按比例补齐；
3. 花果自己一张不动。

「无基准」的组合（绿法师 / 绿战士 / 蓝战士 / 蓝坦克 / 紫射手 / 紫法师 / 金坦克）保持原值 ——
品阶递进在花果内部并不统一（射手 绿→蓝 ×3 生命、坦克 绿→紫 ×4 生命），外推没有依据。

用法：
    python tools/config/patch_card_panel_align.py --check
    python tools/config/patch_card_panel_align.py --write
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

from sync_treant_excel import ROOT, read_zip_rows, set_cell, write_zip      # noqa: E402
from patch_multi_target_falloff import dump_rows, read_rows                  # noqa: E402
from patch_mushroom_race import dump_rich, read_packed                       # noqa: E402

DEMO = 'D:/Alan/Project/POW/Demo3.8'
REMOTE = os.path.join(DEMO, 'assets', 'remoteRef')
CLIENT = os.path.join(ROOT, 'json', 'client')
CARD_XLSX = os.path.join(ROOT, 'PVP-卡牌.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP = os.path.join(DEMO, 'tmp', 'backup_panel_align')

BASE_CAMP = '花果'
FIELDS = (('R', 'baseHp'), ('U', 'unitMaxHp'), ('V', 'unitAttack'))
RARITY = {1: '绿', 2: '蓝', 3: '紫', 4: '金'}
ROW_RE = re.compile(r'<row r="(\d+)"[^>]*>(.*?)</row>', re.S)


def load_sst():
    with zipfile.ZipFile(CARD_XLSX) as handle:
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


def scan_cards():
    """[{row, id, name, camp, cls, rarity, baseHp, unitMaxHp, unitAttack}]"""
    sst = load_sst()
    xml = read_zip_rows(CARD_XLSX, MEMBER)
    cards = []
    for row_num, body in ROW_RE.findall(xml):
        card = cell_value(body, 'A%d' % int(row_num), sst)
        if not card.isdigit() or not 68000 < int(card) < 68200:
            continue
        traits = json.loads(cell_value(body, 'F%d' % int(row_num), sst) or '{}')
        record = {
            'row': int(row_num),
            'id': int(card),
            'name': cell_value(body, 'B%d' % int(row_num), sst),
            'camp': traits.get('camp', ''),
            'cls': traits.get('attack', ''),
            'rarity': int(float(cell_value(body, 'D%d' % int(row_num), sst) or 0)),
        }
        for column, key in FIELDS:
            record[key] = int(float(cell_value(body, '%s%d' % (column, record['row']), sst) or 0))
        cards.append(record)
    if len(cards) != 35:
        raise SystemExit('PVP-卡牌 读到 %d 张卡（应为 35）' % len(cards))
    return cards


def build_base(cards):
    """{(品阶, 职业): (baseHp, unitMaxHp, unitAttack)}，同组合必须唯一。"""
    base = {}
    for card in cards:
        if card['camp'] != BASE_CAMP:
            continue
        key = (card['rarity'], card['cls'])
        value = (card['baseHp'], card['unitMaxHp'], card['unitAttack'])
        if key in base and base[key] != value:
            raise SystemExit('花果 %s%s 出现两组值 %s / %s'
                             % (RARITY[key[0]], key[1], base[key], value))
        base[key] = value
    return base


def plan(cards, base):
    """[{card, before, after, why}]"""
    todo = []
    for card in cards:
        if card['camp'] == BASE_CAMP:
            continue
        before = (card['baseHp'], card['unitMaxHp'], card['unitAttack'])
        key = (card['rarity'], card['cls'])
        if key in base:
            after = base[key]
            if after != before:
                todo.append({'card': card, 'before': before, 'after': after, 'why': '对齐花果同职业同品阶'})
            continue
        # 无基准：只补建筑血比例（花果 = 单位生命 × 2）
        if card['unitMaxHp'] and card['baseHp'] != card['unitMaxHp'] * 2:
            after = (card['unitMaxHp'] * 2, card['unitMaxHp'], card['unitAttack'])
            todo.append({'card': card, 'before': before, 'after': after, 'why': '建筑血 = 生命 × 2'})
    return todo


def describe(todo):
    print('  %-6s %-8s %-4s %-3s %-26s → %-26s %s'
          % ('id', '名称', '阵营', '品阶', '改前(血/攻/建筑)', '改后', '依据'))
    for one in todo:
        card = one['card']
        print('  %-6d %-8s %-4s %-3s %-26s → %-26s %s'
              % (card['id'], card['name'], card['camp'], RARITY[card['rarity']],
                 '%d/%d/%d' % one['before'], '%d/%d/%d' % one['after'], one['why']))


def write_excel(todo, check):
    xml = read_zip_rows(CARD_XLSX, MEMBER)
    changed = 0
    for one in todo:
        row = one['card']['row']
        for index, (column, _key) in enumerate(FIELDS):
            before, after = one['before'][index], one['after'][index]
            if before == after:
                continue
            xml = set_cell(xml, '%s%d' % (column, row), after)
            changed += 1
    if changed and not check:
        write_zip(CARD_XLSX, MEMBER, xml, BACKUP)
    return changed


def write_json(panels, check):
    """把源表 R/U/V **全表 35 张**同步到两份 pvpCard.json。

    不能只写本轮校正的那 6 张：`68002 / 68006 / 68010` 等卡的面板在 JSON 里本来就是旧值
    （历史漂移，例如 68006 源表生命 1200、JSON 还是 700），只改 6 张会让
    `patch_growth_from_card_level_up.js` 的「L1 == pvpCard 基础值」守卫直接失败。
    """
    wanted = {card: {'baseHp': bhp, 'unitMaxHp': hp, 'unitAttack': atk}
              for card, (hp, atk, bhp) in panels.items()}
    total = 0

    target = os.path.join(REMOTE, 'pvpCard.json')
    keys, _values, rows = read_packed(target)
    touched = 0
    drift = []
    for row in rows:
        card = int(str(row['id']))
        if card not in wanted:
            continue
        for key, value in wanted[card].items():
            if row.get(key) != value:
                drift.append((card, key, row.get(key), value))
                row[key] = value
                touched += 1
    if touched and not check:
        with io.open(target, 'w', encoding='utf-8', newline='') as handle:
            handle.write(dump_rich(keys, rows))
    print('  pvpCard.json[remoteRef] 改 %d 格' % touched)
    total += touched

    target = os.path.join(CLIENT, 'pvpCard.json')
    data, trailing = read_rows(target)
    touched = 0
    for row in data:
        card = int(str(row['id']))
        if card not in wanted:
            continue
        for key, value in wanted[card].items():
            if row.get(key) != value:
                row[key] = value
                touched += 1
    if touched and not check:
        with io.open(target, 'w', encoding='utf-8', newline='') as handle:
            handle.write(dump_rows(data, trailing))
    print('  pvpCard.json[client]    改 %d 格' % touched)
    total += touched
    return total, drift


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    check = not args.write

    cards = scan_cards()
    base = build_base(cards)
    print('== 花果基准 %d 组' % len(base))
    for key in sorted(base):
        print('  %s%-3s %d/%d/%d' % (RARITY[key[0]], key[1], base[key][0], base[key][1], base[key][2]))

    todo = plan(cards, base)
    print('== 待校正 %d 张' % len(todo))
    if todo:
        describe(todo)

    cells = 0
    if todo:
        print('== 落到源表 PVP-卡牌.xlsx（R=建筑基础生命 / U=单位生命 / V=单位攻击）')
        cells = write_excel(todo, check)
        print('  改 %d 格' % cells)
    else:
        print('== 源表面板已全部符合花果标准')

    final = {card['id']: (card['unitMaxHp'], card['unitAttack'], card['baseHp']) for card in cards}
    for one in todo:
        final[one['card']['id']] = (one['after'][1], one['after'][2], one['after'][0])

    # JSON 同步始终执行：源表可能已经手改过，而 JSON 还停在旧值（历史漂移）
    print('== 回灌两份 pvpCard.json（全表 R/U/V 对齐，含历史漂移）')
    total, drift = write_json(final, check)
    for card, key, before, value in drift:
        print('    · %d.%s %r → %r' % (card, key, before, value))
    print('== %s ==' % ('干跑完成，未落盘' if check else '已落盘'))
    if check:
        print('  将改 %d 格源表 + %d 格 JSON' % (cells, total))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
