# -*- coding: utf-8 -*-
"""把设计案「卡牌描述与落地」页的**卡牌描述**回填进 `PVP-卡牌.xlsx / 卡牌配置` 的 I 列。

配套脚本：`patch_card_description.js` 负责两份 JSON（`assets/remoteRef` + `json/client`），
两个脚本读同一份设计页，先跑 js 再跑本脚本（或反过来，两边都幂等）。

为什么不用 openpyxl 另存：见 `patch_magdi_skill_rows_excel.py` 抬头 —— 这张表启用了
`修改器` 那种 16384 列的 dimension，另存会把整表按 16384 列重写。

守卫
────
· 设计页 A 列必须是数字卡牌 ID、F 列描述非空；
· 第 5 行 I 列必须仍是 `description`；
· 设计页里每张卡都必须在表里找得到行，且 I 列单元格已存在（`set_cell` 不建格）；
· 回读逐字一致。

用法：python tools/config/patch_card_description.py
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402
from patch_dawtianlu_aura_punch_excel import sheet_member  # noqa: E402
from xlsx_read import read_sheet  # noqa: E402

ROOT = 'D:/Alan/Project/POW'
DESIGN = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
DESIGN_CARD_SHEET = '卡牌描述与落地'
CARD_XLSX = os.path.join(ROOT, 'doc', '塔防数据配置', 'PVP-卡牌.xlsx')
BACKUP_DIR = os.path.join(ROOT, 'Demo3.8', 'tmp', 'config_backup')

SHEET_NAME = '卡牌配置'
FIELD_ROW = 5
DESC_COLUMN = 'I'


def load_descriptions():
    """设计页 → {卡牌ID: 描述}。"""
    sheet = None
    for index in range(10):
        try:
            name, rows = read_sheet(DESIGN, index)
        except Exception:
            continue
        if name == DESIGN_CARD_SHEET:
            sheet = rows
            break
    if sheet is None:
        raise SystemExit('[fail] 设计案里找不到页签 %s' % DESIGN_CARD_SHEET)

    out = {}
    for _, cells in sheet:
        if not cells or len(cells) < 6:
            continue
        try:
            card_id = int(str(cells[0]).strip())
        except (TypeError, ValueError):
            continue
        text = str(cells[5] or '').strip()
        if not text:
            raise SystemExit('[fail] 卡牌 %d 的描述是空串' % card_id)
        out[card_id] = text
    if len(out) < 30:
        raise SystemExit('[fail] 只读到 %d 张卡的描述，设计页结构可能变了' % len(out))
    return out


def cell_text(fragment):
    texts = re.findall(r'<t[^>]*>(.*?)</t>', fragment, re.S)
    texts += re.findall(r'<v>(.*?)</v>', fragment, re.S)
    return texts[0] if texts else ''


def row_of_card(xml):
    rows = {}
    for match in re.finditer(r'<c r="A(\d+)"[^>]*?(?:/>|>(.*?)</c>)', xml, re.S):
        text = cell_text(match.group(2) or '')
        try:
            rows[int(text)] = int(match.group(1))
        except ValueError:
            continue
    return rows


def shared_strings(path):
    text = read_zip_rows(path, 'xl/sharedStrings.xml')
    return [''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S)) for si in re.findall(r'<si>(.*?)</si>', text, re.S)]


def resolved_text(fragment, strings):
    """单元格正文：`t="s"` 要再查一次共享字符串表（表头行就是共享字符串）。"""
    if 't="s"' in fragment:
        index = re.search(r'<v>(\d+)</v>', fragment)
        return strings[int(index.group(1))] if index else ''
    return cell_text(fragment)


def update(expected):
    member = sheet_member(CARD_XLSX, SHEET_NAME)
    xml = read_zip_rows(CARD_XLSX, member)
    strings = shared_strings(CARD_XLSX)

    header = re.search(r'<c r="%s%d"[^>]*?(?:/>|>(.*?)</c>)' % (DESC_COLUMN, FIELD_ROW), xml, re.S)
    if header is None or resolved_text(header.group(0), strings) != 'description':
        raise SystemExit('[fail] %s 第 %d 行 I 列不是 description（实得 %r）' % (
            SHEET_NAME, FIELD_ROW, resolved_text(header.group(0), strings) if header else None))

    rows = row_of_card(xml)
    missing = [card_id for card_id in expected if card_id not in rows]
    if missing:
        raise SystemExit('[fail] 表里找不到这些卡的行：%s' % missing)

    changed = 0
    for card_id, text in sorted(expected.items()):
        ref = '%s%d' % (DESC_COLUMN, rows[card_id])
        if ('<c r="%s"' % ref) not in xml:
            raise SystemExit('[fail] 单元格 %s 不存在（不能静默跳过）' % ref)
        current = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
        if cell_text(current.group(1) or '') == text:
            continue
        xml = set_cell(xml, ref, text)
        changed += 1
    return member, xml, changed, rows


def verify(expected, rows):
    xml = read_zip_rows(CARD_XLSX, sheet_member(CARD_XLSX, SHEET_NAME))
    bad = []
    for card_id, text in expected.items():
        ref = '%s%d' % (DESC_COLUMN, rows[card_id])
        match = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
        if match is None or cell_text(match.group(1) or '') != text:
            bad.append(card_id)
    if bad:
        raise SystemExit('[fail] 回读不一致：%s' % bad[:5])
    print('[ok] 回读通过：%d 张卡的描述已落进 %s / %s' % (len(expected), os.path.basename(CARD_XLSX), SHEET_NAME))


def main():
    expected = load_descriptions()
    print('[ok] 设计页读到 %d 张卡的描述' % len(expected))
    member, xml, changed, rows = update(expected)
    if not changed:
        print('[skip] I 列已是目标文案')
        verify(expected, rows)
        return
    write_zip(CARD_XLSX, member, xml, BACKUP_DIR)
    print('[ok] %s / %s：改写 %d 行（成员 %s）' % (os.path.basename(CARD_XLSX), SHEET_NAME, changed, member))
    verify(expected, rows)


if __name__ == '__main__':
    main()
