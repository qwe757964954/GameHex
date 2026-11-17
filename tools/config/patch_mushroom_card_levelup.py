# -*- coding: utf-8 -*-
"""蘑菇阵营 `cardLevelUp` 成长曲线对齐 pvpCard 定稿面板（2026-11-16）。

## 为什么这么改

`K-卡牌升级.xlsx / 卡牌升级表` 的 I 列 `attrList` 存的是 **0~50 级的绝对面板值**
（不是成长率），三字段 `maxHp` / `attack` / `buildingHp`。全表 35 张卡验证过两条硬规律：

  ① 整表共享同一条等级乘子：L50 ≈ L0 × 36.226（各字段同一乘子，L0 与 L1 相等，L2 起上涨）；
  ② **L0 基值相同的卡，51 级逐级完全一致**（68008/68017/68024/68026/68032/68034/68035
     七张 600/120/1200 的整条序列 byte 级相同；68019/68028、68003/68004/68020/68030 同理）。

所以「成长系数对齐 pvpCard」不需要做任何浮点推导：把 L0 三字段换成 pvpCard 的最终值，
再用**已有同基值卡的整条曲线**展开即可。这样既没有舍入争议，也保证同档卡在表内自洽。

字段口径（pvpCard 是主表）：

    maxHp      ← pvpCard.unitMaxHp     （单位生命）
    attack     ← pvpCard.unitAttack    （单位攻击）
    buildingHp ← pvpCard.baseHp        （建筑形态生命）

## 改动范围

全表对拍（35 张）只有 5 张不一致，且正好是本轮改过面板的 5 张，其余 30 张本来就对齐：

    68012 菇八戒  50/13/120   → 100/13/200
    68013 风炮菇  120/24/480  → 240/48/480
    68014 分裂菇  240/48/480  → 400/52/480
    68015 机甲菇  600/130/1200 → 700/140/1200
    68016 磁电菇  700/140/2000 → 600/120/2000

## 三个坑

① I 列原本是 **sharedString**（`t="s"`）。同基值的卡在同一等级会共用同一个 sst 条目，
   直接改 `sharedStrings.xml` 会误伤别的卡 ⇒ 一律逐格改写成 `inlineStr`（保留 `s` 样式）。
② `buildingHp` 不与 `maxHp` 等比（68001 ×3、68012 ×2.4、68013 ×4、68017 ×2），
   它是独立档位 ⇒ 三个字段**各自查池**，不能拿 maxHp 的倍率去推。
③ 池必须只由「非目标卡」提供，否则重跑时目标卡已经是新值，池会被自己污染。
   本脚本对每个 base 断言至少有一个目标集之外的来源。

用法：
    python tools/config/patch_mushroom_card_levelup.py --check
    python tools/config/patch_mushroom_card_levelup.py --write
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

from sync_treant_excel import ROOT, read_zip_rows, write_zip                        # noqa: E402
from patch_bullet_falloff import set_cell_safe                                      # noqa: E402
from patch_multi_target_falloff import dump_rows, read_rows                          # noqa: E402
from patch_mushroom_race import dump_rich, read_packed                              # noqa: E402

DEMO = 'D:/Alan/Project/POW/Demo3.8'
REMOTE = os.path.join(DEMO, 'assets', 'remoteRef')
CLIENT = os.path.join(ROOT, 'json', 'client')
XLSX = os.path.join(ROOT, 'K-卡牌升级.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP = os.path.join(DEMO, 'tmp', 'backup_mushroom_levelup')

FIELDS = ('maxHp', 'attack', 'buildingHp')

# 目标：pvpCard 定稿面板 (unitMaxHp, unitAttack, baseHp)
PANEL = {
    68012: (100, 13, 200),
    68013: (240, 48, 480),
    68014: (400, 52, 480),
    68015: (700, 140, 1200),
    68016: (600, 120, 2000),
}

ROW_RE = re.compile(r'<row r="(\d+)"[^>]*>(.*?)</row>', re.S)
CELL_RE = re.compile(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', re.S)


def load_sst():
    with zipfile.ZipFile(XLSX) as handle:
        if 'xl/sharedStrings.xml' not in handle.namelist():
            return []
        raw = handle.read('xl/sharedStrings.xml').decode('utf-8')
    root = re.search(r'<sst.*?</sst>', raw, re.S)
    items = []
    for one in re.finditer(r'<si>(.*?)</si>', root.group(0), re.S):
        text = ''.join(re.findall(r'<t[^>]*>(.*?)</t>', one.group(1), re.S))
        items.append(html.unescape(re.sub(r'<[^>]+>', '', text)))
    return items


def parse_sheet(xml, sst):
    """返回 (rows, cells)。

    rows  —— [(行号, id, level, {字段: 值})]，只收 A 列是纯数字 id 的数据行；
    cells —— {行号: {列: 原始 attr 串}}，用于后面定位 I 格。
    """
    rows = []
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
        card, level, blob = got.get('A', ''), got.get('C', ''), got.get('I', '')
        if not card.isdigit() or not level.isdigit() or card == '1':
            continue
        try:
            items = json.loads(blob) if blob else []
        except ValueError:
            continue
        rows.append((int(row_num), int(card), int(level),
                     {one['statId']: one['value'] for one in items}))
    return rows


def build_curve(rows):
    """{字段: {L0基值: [L0..L50]}}。

    键是**该字段在 L0 的取值**，值是整张卡 51 级该字段的序列。同基值的多张卡必须
    给出完全相同的序列（全表已验证），否则「抄曲线」这个前提不成立 —— 直接报错。
    """
    per_card = {}
    for _row, card, level, attr in rows:
        per_card.setdefault(card, {})[level] = attr

    curves = {field: {} for field in FIELDS}
    owner = {field: {} for field in FIELDS}
    for card, levels in per_card.items():
        if len(levels) != 51:
            raise SystemExit('card %d 只有 %d 级（应为 51）' % (card, len(levels)))
        base_of = levels[0]
        for field in FIELDS:
            if field not in base_of:
                continue
            base = base_of[field]
            series = [levels[level][field] for level in range(51)]
            known = curves[field].get(base)
            if known is None:
                curves[field][base] = series
            elif known != series:
                raise SystemExit('%s 基值 %s 的曲线在 card %d 上与前面的卡不一致'
                                 % (field, base, card))
            owner[field].setdefault(base, set()).add(card)
    return curves, owner


def plan():
    """算出 {id: {level: attrList}}，并断言池来源不与目标集自污染。"""
    sst = load_sst()
    rows = parse_sheet(read_zip_rows(XLSX, MEMBER), sst)
    curves, owner = build_curve(rows)

    for card, (hp, atk, bld) in PANEL.items():
        for field, base in (('maxHp', hp), ('attack', atk), ('buildingHp', bld)):
            if base not in curves[field]:
                raise SystemExit('基值 %s=%s 在全表没有参考曲线（card %d）' % (field, base, card))
            outsiders = owner[field][base] - set(PANEL)
            if not outsiders:
                raise SystemExit('基值 %s=%s 只被目标卡持有，重跑会自我污染' % (field, base))

    wanted = {}
    for card, (hp, atk, bld) in PANEL.items():
        wanted[card] = {}
        for level in range(51):
            wanted[card][level] = [
                {'statId': 'maxHp', 'value': curves['maxHp'][hp][level]},
                {'statId': 'attack', 'value': curves['attack'][atk][level]},
                {'statId': 'buildingHp', 'value': curves['buildingHp'][bld][level]},
            ]
    return rows, wanted, curves, owner


def write_excel(rows, wanted, check):
    xml = read_zip_rows(XLSX, MEMBER)
    by_card = {}
    for row_num, card, level, _attr in rows:
        by_card.setdefault(card, {})[level] = row_num

    changed = 0
    for card, levels in wanted.items():
        targets = by_card.get(card) or {}
        if len(targets) != 51:
            raise SystemExit('cardLevelUp %d 找到 %d 级（应为 51）' % (card, len(targets)))
        for level, attr in levels.items():
            text = json.dumps(attr, ensure_ascii=False, separators=(',', ':'))
            xml = set_cell_safe(xml, 'I%d' % targets[level], text)
            changed += 1
    if not check:
        write_zip(XLSX, MEMBER, xml, BACKUP)
    return changed


def _apply_rows(container, wanted, mutate):
    touched = 0
    for row in container:
        card, level = int(str(row['id'])), int(str(row['level']))
        if card in wanted and level in wanted[card]:
            mutate(row, wanted[card][level])
            touched += 1
    return touched


def _set_attr(row, attr):
    row['attrList'] = [dict(one) for one in attr]


def write_json(wanted, check):
    """两份 json 的排版不同，各按原样写回。

    · `assets/remoteRef/cardLevelUp.json` 与 `pvpCard.json` 同款**逐列展开**排版
      （SVN 基线：47044 行 / 361685 字节）⇒ 必须走 `dump_rich`，用 `json.dumps` 压成单行
      会整份 diff 全红（314863 字节，虽然内容等价）；
    · `doc/.../json/client/cardLevelUp.json` 是「每行一个带字段名的对象」+ LF + 无末尾换行
      ⇒ `dump_rows`。
    """
    total = 0

    remote = os.path.join(REMOTE, 'cardLevelUp.json')
    keys, _values, rows = read_packed(remote)
    touched = _apply_rows(rows, wanted, _set_attr)
    if not check:
        with io.open(remote, 'w', encoding='utf-8', newline='') as handle:
            handle.write(dump_rich(keys, rows))
    print('  %s（%d 行）' % (remote, touched))
    total += touched

    client = os.path.join(CLIENT, 'cardLevelUp.json')
    data, trailing = read_rows(client)
    touched = _apply_rows(data, wanted, _set_attr)
    if not check:
        with io.open(client, 'w', encoding='utf-8', newline='') as handle:
            handle.write(dump_rows(data, trailing))
    print('  %s（%d 行）' % (client, touched))
    total += touched
    return total


def report(curves):
    print('  %-8s %-24s %s' % ('卡', 'L0 → L2 → L10 → L50', '来源池基值'))
    for card, (hp, atk, bld) in PANEL.items():
        print('  %-8d %4d/%3d/%4d → %4d/%3d/%4d → %5d/%4d/%5d → %6d/%5d/%6d'
              % (card, hp, atk, bld,
                 curves['maxHp'][hp][2], curves['attack'][atk][2], curves['buildingHp'][bld][2],
                 curves['maxHp'][hp][10], curves['attack'][atk][10], curves['buildingHp'][bld][10],
                 curves['maxHp'][hp][50], curves['attack'][atk][50], curves['buildingHp'][bld][50]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    check = not args.write

    print('== ① 建曲线池（同基值 51 级逐级校验）')
    rows, wanted, curves, _owner = plan()
    print('  扫到 %d 行 / %d 张卡' % (len(rows), len({one[1] for one in rows})))
    report(curves)

    print('== ② K-卡牌升级.xlsx「卡牌升级表」I 列 attrList')
    changed = write_excel(rows, wanted, check)
    print('  %d 格（%d 张卡 × 51 级）' % (changed, len(PANEL)))

    print('== ③ JSON 回灌')
    total = write_json(wanted, check)

    print('== %s ==' % ('干跑完成，未落盘' if check else '已落盘'))
    if check:
        print('  将改 %d 格源表 + %d 行 JSON' % (changed, total))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
