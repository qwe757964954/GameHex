# -*- coding: utf-8 -*-
"""技能设计案2.xlsx 第 80 行第四轮口径（2026-11-12 用户）。

> 「68016 的五雷轰顶还是技能效果还是没有做出明显的出现时间间隔差异，和距离间隔，
>   增加每道落雷的间隔 15px，每道特效播放时间间隔 0.15s」

第三轮改成 45px / 0.18s，仍然读不出先后 —— 因为一道雷的特效本身有 193×231 屏上 px，
而 45 表值逻辑 px 只值屏上 34.6px，五个落点几乎完全叠住；0.18s 也远短于特效自身的 0.667s。

所以：`boltSpacing 45 → 60`（屏上 46.1px）、`boltInterval 0.18 → 0.15`。
`boltDelay` 不动 —— 它锚的是「特效第 5 帧」的时间窗，与逐道间隔是两件事。

zip 级手术，只改 K80 / P80 两个格子；P 列在原文上做定点替换（每条都断言命中），
末尾再补一段「为什么还改」，绝不重打整格。
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'

BOLT_SPACING = 60
BOLT_INTERVAL = '0.15'

K80 = ('L1（兵种 9 级）：锁定目标落 1 道雷电，并沿目标背朝向再落 2 道'
       '（每道间隔 %dpx、出现间隔 %ss、特效第 5 帧判伤），每道 160%% 攻击力；'
       '逐道独立 30%% 概率使目标进入【麻痹】3 秒（只禁攻击、移速 −50%%）'
       % (BOLT_SPACING, BOLT_INTERVAL))

REPLACE_80 = [
    ('boltSpacing=45 / boltInterval=0.18',
     'boltSpacing=%d / boltInterval=%s' % (BOLT_SPACING, BOLT_INTERVAL)),
    ('落点沿「目标 → 背朝向」按 45px 排开',
     '落点沿「目标 → 背朝向」按 %dpx 排开' % BOLT_SPACING),
]
APPEND_MARK = '2026-11-12 第三轮（用户口径'
APPEND_80 = ('\n2026-11-12 第三轮（用户口径「还是没有做出明显的出现时间间隔差异和距离间隔，'
             '增加每道落雷的间隔 15px，每道特效播放时间间隔 0.15s」）：'
             'boltSpacing 45 → **60**、boltInterval 0.18 → **0.15**。'
             '上一轮 45px / 0.18s 读不出先后的两个原因：① 45 表值逻辑 px 只值屏上 34.6px，'
             '而一道雷特效本身有 193×231 屏上 px ⇒ 落点几乎完全叠住；'
             '② 0.18s 远短于特效自身时长（`ZC_BOLT_EFFECT_SECONDS` 0.667s）⇒ 前一道没散后一道就来了。'
             '现在屏上间距 46.1px、逐道 0.15s，判伤时刻 0.15 / 0.30 / 0.45 / 0.60 / 0.75s。'
             'boltDelay 仍是 0.15（锚「特效第 5 帧」，与逐道间隔无关）。')


def apply(text, rules, label):
    #  幂等：新串已经在、旧串已经不在了 ⇒ 这一条上一轮已经改过，跳过（不能当成「找不到」报错）。
    for old, new in rules:
        if old not in text:
            if new in text:
                print('  [skip] %s 这条已改过：%s' % (label, new[:40]))
                continue
            raise SystemExit('[fail] %s 里找不到：%s' % (label, old[:44]))
        text = text.replace(old, new)
    return text


def read_cells():
    import openpyxl
    book = openpyxl.load_workbook(PATH, data_only=True, read_only=True)
    sheet = book['技能设计案 (2)']
    cells = {ref: sheet[ref].value for ref in ('K80', 'P80')}
    book.close()
    return cells


def main():
    current = read_cells()
    p80_text = apply(str(current['P80']), REPLACE_80, 'P80')
    if APPEND_MARK not in p80_text:
        p80_text += APPEND_80
    p80 = p80_text
    cells = [('K', 80, K80), ('P', 80, p80)]

    if str(current['P80']) == p80 and str(current.get('K80', '')) == K80:
        print('[skip] K80 / P80 已是目标文案（幂等）')
        return

    xml = read_zip_rows(PATH, MEMBER)
    for col, row, _ in cells:
        ref = '%s%d' % (col, row)
        if '<c r="%s"' % ref not in xml:
            raise SystemExit('[fail] 单元格 %s 不存在' % ref)
    for col, row, value in cells:
        ref = '%s%d' % (col, row)
        xml = set_cell(xml, ref, value)
        print('  %-4s = %s%s' % (ref, value[:46].replace('\n', ' '), '…' if len(value) > 46 else ''))

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    src = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    backup = os.path.join(BACKUP_DIR, '%s.bak-%s' % (os.path.basename(PATH), stamp))
    if os.path.isfile(src) and src != backup:
        os.replace(src, backup)

    check = read_zip_rows(PATH, MEMBER)
    for col, row, value in cells:
        if value[:20] not in check:
            raise SystemExit('[fail] 回读失败：%s%d' % (col, row))
    print('[ok] 回读通过；备份 %s' % backup)


if __name__ == '__main__':
    main()
