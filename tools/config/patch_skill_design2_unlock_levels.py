# -*- coding: utf-8 -*-
"""把「技能设计案2.xlsx」L1~L3 列开头的「（兵种 N 级…）」括注，按新解锁规则改写。

规则（2026-11-17 用户口径，`pvpCard.skillList` 的第 N 个技能）：

    技能1 → 3 / 10 / 22
    技能2 → 6 / 16 / 26
    技能3 → 9 / 18 / 27
    技能4 → 12 / 24 / 36

只改**括注**，括注后面的正文一个字不动。
不在 `pvpCard.skillList` 里的行（普攻、主动、待规划）跳过 —— 它们不吃这四档。

幂等：目标括注已存在就跳过。
"""
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

ROOT = 'D:/Alan/占城玩法/策划文档/战斗系统'
XLSX = os.path.join(ROOT, '技能设计案2.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
CARD_CLIENT = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpCard.json'
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/config_backup'

SLOT_LEVELS = [
    [3, 10, 22],
    [6, 16, 26],
    [9, 18, 27],
    [12, 24, 36],
]

#  `L1（兵种 0 级，开局即解锁）：` / `L2（兵种 14 级）：`
BRACKET = re.compile(r'^L([123])（兵种 (\d+) 级(，开局即解锁)?）：')


def bracket_of(tier, level):
    if level <= 0:
        return 'L%d（兵种 0 级，开局即解锁）：' % tier
    return 'L%d（兵种 %d 级）：' % (tier, level)


def load_targets():
    """skillId → 三档解锁等级。"""
    with io.open(CARD_CLIENT, encoding='utf-8') as handle:
        cards = json.load(handle)
    out = {}
    for card in cards:
        if not str(card.get('id', '')).startswith('68'):
            continue
        for slot, chain in enumerate(card.get('skillList') or []):
            if slot >= len(SLOT_LEVELS):
                continue
            out[int(chain)] = SLOT_LEVELS[slot]
    return out


def cell_text(xml, ref, strings):
    match = re.search(r'<c r="%s"([^>]*)>(.*?)</c>' % ref, xml, re.S)
    if not match:
        return None
    attrs, body = match.group(1), match.group(2)
    if 't="s"' in attrs:
        index = re.search(r'<v>(\d+)</v>', body)
        return strings[int(index.group(1))] if index else ''
    text = re.search(r'<t[^>]*>(.*?)</t>', body, re.S)
    if text:
        import html
        return html.unescape(text.group(1))
    number = re.search(r'<v>(.*?)</v>', body, re.S)
    return number.group(1) if number else ''


def main():
    dry = '--check' in sys.argv
    targets = load_targets()
    xml = read_zip_rows(XLSX, MEMBER)

    import html
    shared = read_zip_rows(XLSX, 'xl/sharedStrings.xml')
    strings = [html.unescape(re.sub(r'<[^>]+>', '', si)) for si in re.findall(r'<si>(.*?)</si>', shared, re.S)]

    #  G 列 = skillId，逐行读
    skill_rows = {}
    for match in re.finditer(r'<c r="G(\d+)"[^>]*>(.*?)</c>', xml, re.S):
        row = int(match.group(1))
        value = cell_text(xml, 'G%d' % row, strings)
        if value and str(value).strip().isdigit():
            skill_rows.setdefault(int(str(value).strip()), row)

    changed = 0
    untouched = []
    for skill_id, levels in sorted(targets.items()):
        row = skill_rows.get(skill_id)
        if row is None:
            untouched.append(skill_id)
            continue
        for tier in (1, 2, 3):
            ref = '%s%d' % ('KLM'[tier - 1], row)
            current = cell_text(xml, ref, strings)
            if current is None or not current:
                continue
            bracket = BRACKET.match(current)
            if not bracket:
                continue
            want = bracket_of(tier, levels[tier - 1])
            if bracket.group(0) == want:
                continue
            xml = set_cell(xml, ref, want + current[bracket.end():])
            changed += 1
            print('[ok] %s（%s）L%d → 兵种 %d 级' % (ref, skill_id, tier, levels[tier - 1]))

    if not changed:
        print('[skip] L1~L3 的兵种等级括注已全部符合规则')
        return
    if dry:
        print('[check] 干跑：%d 格，未写盘' % changed)
        return
    write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 写入 %d 格' % changed)
    if untouched:
        print('[skip] %d 条技能在表里找不到行：%s' % (len(untouched), untouched[:20]))


if __name__ == '__main__':
    main()
