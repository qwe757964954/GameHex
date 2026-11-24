# -*- coding: utf-8 -*-
"""第 43 批（2026-11-23）：机甲菇 68015 / 科学家 68035 的卡面简介同步进 `PVP-卡牌.xlsx / 卡牌配置` I 列。

为什么改：机甲菇 101504 从「菌毯爆发」换成「射线集束」（旧技能弃用）、
科学家 103503 从「射线集束」换成「文明之火」，而卡牌详情页读的就是这一列 ——
不改就是「面板写着站桩爆炸、实际打出去是一道光」或「面板写着一条线、实际地上撒三片火」。

数据源 = `doc/塔防数据配置/json/client/pvpCard.json`（两份 JSON 已由
`tools/config/patch_batch43_skills.js` 改好）⇒ 源表永远是 json 的投影。

为什么走 zip 级手术：这张表启用了 16384 列的 dimension，openpyxl 另存会把整表按 16384 列重写。

守卫：第 5 行 I 列必须仍是 `description`；A 列必须能定位到 68015；回读逐字一致。
幂等：内容一致就不写盘。
用法：python tools/config/patch_batch43_card_xlsx.py
"""
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402
from patch_dawtianlu_aura_punch_excel import sheet_member  # noqa: E402
from xlsx_read import read_sheet  # noqa: E402

PATH = 'D:/Alan/Project/POW/doc/塔防数据配置/PVP-卡牌.xlsx'
BACKUP_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置_历史备份'
CLIENT = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpCard.json'

CARD_IDS = [68015, 68035]
COL_ID = 'A'
COL_DESC = 'I'


def cell_inner(xml, col, row_num):
    m = re.search(r'<c r="%s%d"[^>]*?(?:/>|>(.*?)</c>)' % (col, row_num), xml, re.S)
    return None if not m else (m.group(1) or '')


def inner_text(inner):
    if inner is None:
        return None
    texts = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
    texts += re.findall(r'<v>(.*?)</v>', inner, re.S)
    return texts[0] if texts else ''


def main():
    with open(CLIENT, encoding='utf-8') as fh:
        cards = json.load(fh)
    rows = cards if isinstance(cards, list) else cards.get('data', [])
    by_id = {str(row.get('id')): row for row in rows}

    member = sheet_member(PATH, '卡牌配置')
    xml = read_zip_rows(PATH, member)

    #  🔴 定位必须走 `xlsx_read`：A 列的文本是共享字符串，直接正则读 `<v>` 只会拿到
    #  sharedStrings 的索引（曾读成 '80'）。`read_sheet` 已解过表，行号是 1-based。
    sheet_rows = read_sheet(PATH, 0)[1]
    header = sheet_rows[4][1][8] if len(sheet_rows) > 4 else None
    if header != 'description':
        raise SystemExit('[fail] 第 5 行 I 列是 %r，预期 description —— 列序变动，先人工核对' % header)

    changed = []
    for card_id in CARD_IDS:
        target = by_id.get(str(card_id))
        if target is None:
            raise SystemExit('[fail] client 里找不到卡牌 %s' % card_id)
        desc = str(target.get('description') or '')
        if not desc:
            raise SystemExit('[fail] %s 的 description 是空的，不能拿空串覆盖源表' % card_id)

        row_num = None
        for index, cells in sheet_rows:
            if str(cells[0]).strip() == str(card_id):
                row_num = index
                break
        if row_num is None:
            raise SystemExit('[fail] 表里找不到卡牌 %s 的行' % card_id)
        if cell_inner(xml, COL_DESC, row_num) is None:
            raise SystemExit('[fail] 第 %d 行 I 列单元格不存在，set_cell 不建格' % row_num)

        before = str(sheet_rows[row_num - 1][1][8] or '')
        if before == desc:
            print('[skip] %s 的卡面描述已与 client 一致' % card_id)
            continue
        print('  %s（第 %d 行）\n    旧：%s\n    新：%s' % (card_id, row_num, before, desc))
        xml = set_cell(xml, '%s%d' % (COL_DESC, row_num), desc)
        changed.append((card_id, row_num, desc))

    if not changed:
        print('[skip] 两张卡的卡面描述都已是 json 的口径，不写盘')
        return

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    os.makedirs(BACKUP_DIR, exist_ok=True)
    write_zip(PATH, member, xml, BACKUP_DIR)
    moved = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    backup = os.path.join(BACKUP_DIR, 'PVP-卡牌.xlsx.bak-batch43-%s' % stamp)
    if os.path.isfile(moved):
        os.replace(moved, backup)
    else:
        backup = '(write_zip 未生成备份)'

    #  回读同样走 `read_sheet`（它会解 inlineStr / sharedStrings 两种写法）。
    verify = read_sheet(PATH, 0)[1]
    for card_id, row_num, desc in changed:
        after = str(verify[row_num - 1][1][8] or '')
        if after != desc:
            raise SystemExit('[fail] 回读 %s 的 I%d 与 client 不一致：%r' % (card_id, row_num, after))
        print('[ok] %s I%d 回读通过' % (card_id, row_num))
    print('[ok] 备份 %s' % backup)


if __name__ == '__main__':
    main()
