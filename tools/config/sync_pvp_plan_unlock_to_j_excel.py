# -*- coding: utf-8 -*-
"""把 `pvpSkillPlan.unlockHeroLevel` 同步回 J-技能表 / PVP技能配置（G 列「英雄解锁等级」）。

背景（2026-11-26 第 54 批）：
  用户裁决「以设计案为准」，把 L1 解锁等级从 3/6/9/12 覆盖成设计案 2/3/5/7。
  上一轮只做了 `pvpSkillPlan.json`（remote + client）+ K-卡牌升级.xlsx + armySkillLevelUp.json，
  漏了 J-技能表这一列 —— 转表器一跑就会把 json 的 2/3/5/7 重建回 3/6/9/12，
  142 行白改。本脚本补上最后一个写口。

三写完整性：J-技能表 G 列 → pvpSkillPlan.json（remote）→ pvpSkillPlan.json（client）
（K 表 + armySkillLevelUp 已由 sync_army_skill_unlock.py 负责，本脚本不碰）

用法：
  python tools/config/sync_pvp_plan_unlock_to_j_excel.py          # 干跑
  python tools/config/sync_pvp_plan_unlock_to_j_excel.py --write  # 落盘
"""
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from patch_dawtianlu_aura_punch_excel import sheet_member  # noqa: E402
from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402
from xlsx_read import read_sheet  # noqa: E402

ROOT = 'D:/Alan/Project/POW/doc/塔防数据配置'
BACKUP_DIR = ROOT + '_历史备份'
J_PATH = os.path.join(ROOT, 'J-技能表.xlsx')
SHEET_NAME = 'PVP技能配置'
PLAN = 'assets/remoteRef/pvpSkillPlan.json'

COLS = {'unitId': 3, 'skillChainId': 4, 'skillLevel': 6, 'unlockHeroLevel': 7}
HEADER_ROWS = 6  # 前 6 行是说明/表头
WRITE = '--write' in sys.argv

HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def cell(cells, n):
    return str(cells[n - 1]).strip() if len(cells) >= n else ''


def set_num_cell(xml, ref, value):
    """把单元格写成数字格，沿用原 style；只替换那一个 <c>。"""
    m = re.search(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % re.escape(ref), xml, re.S)
    if not m:
        raise SystemExit('[fail] 单元格 %s 不存在' % ref)
    style = re.search(r's="(\d+)"', m.group(0))
    style_attr = ' s="%s"' % style.group(1) if style else ''
    new = '<c r="%s"%s><v>%d</v></c>' % (ref, style_attr, int(value))
    return xml[:m.start()] + new + xml[m.end():]


def cell_text(xml, ref):
    m = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % re.escape(ref), xml, re.S)
    if not m:
        return None
    inner = m.group(1) or ''
    t = re.search(r'<t[^>]*>(.*?)</t>', inner, re.S)
    v = re.search(r'<v>(.*?)</v>', inner, re.S)
    return t.group(1) if t else (v.group(1) if v else '')


def main():
    plan = json.load(open(os.path.join(HERE, PLAN), encoding='utf-8'))
    want = {}
    skipped = []
    for r in plan:
        key = (str(r['unitId']), str(r['skillChainId']), str(r['skillLevel']))
        if 'unlockHeroLevel' not in r:
            skipped.append(key)
            continue
        want[key] = int(r['unlockHeroLevel'])
    print('json 计划行 %d（去重键 %d）' % (len(plan), len(want)))
    if skipped:
        print('⚠️ 缺 unlockHeroLevel 字段、跳过 %d 行：%s' % (len(skipped), skipped))

    name, rows = read_sheet(J_PATH, 8)
    assert name == SHEET_NAME, 'sheet 8 应叫 %r，实际 %r' % (SHEET_NAME, name)

    member = sheet_member(J_PATH, SHEET_NAME)
    xml = read_zip_rows(J_PATH, member)
    print('目标成员 %s' % member)

    # 定位：xlsx 行号 -> key
    seen = {}
    targets = []  # (row, key, 现值)
    for idx, cells in rows:
        if idx <= HEADER_ROWS:
            continue
        unit = cell(cells, COLS['unitId'])
        chain = cell(cells, COLS['skillChainId'])
        lv = cell(cells, COLS['skillLevel'])
        if not unit or not chain or not lv:
            continue
        key = (unit, chain, lv)
        seen[key] = idx
        if key in want:
            cur = cell_text(xml, 'G%d' % idx)
            targets.append((idx, key, cur))

    print('xlsx 数据键 %d，命中计划表 %d' % (len(seen), len(targets)))
    missing = set(want) - set(seen)
    print('计划表有、xlsx 无：%d' % len(missing))
    for k in list(missing)[:10]:
        print('   ?', k)

    changes = [(row, key, cur, want[key]) for row, key, cur in targets
               if str(cur) != str(want[key])]
    print('\n需改 %d 行' % len(changes))
    for row, key, cur, newv in changes[:6]:
        print('  %s row=%-5d %s  %s -> %s' % (key, row, '', cur, newv))
    if len(changes) > 6:
        print('  … 其余 %d 行' % (len(changes) - 6))

    if not changes:
        print('\n已一致，无改动。')
        return

    if not WRITE:
        print('\n（干跑，未落盘）')
        return

    new_xml = xml
    for row, key, cur, newv in changes:
        new_xml = set_num_cell(new_xml, 'G%d' % row, newv)

    # 校验：只有 G 列变了
    refs_old = re.findall(r'<c r="([A-Z]+)(\d+)"', xml)
    refs_new = re.findall(r'<c r="([A-Z]+)(\d+)"', new_xml)
    assert refs_old == refs_new, '单元格集合变了'

    bak = write_zip(J_PATH, member, new_xml, BACKUP_DIR)
    print('\n备份 -> %s' % bak)

    after = read_zip_rows(J_PATH, member)
    bad = [row for row, key, cur, newv in changes
           if str(cell_text(after, 'G%d' % row)) != str(newv)]
    print('回读 %d 行：%s' % (len(changes), '全部一致' if not bad else '%d 行不一致 %s' % (len(bad), bad[:5])))

    # 逐行核对未在 targets 的 G 格没被动
    stray = [idx for idx, cells in rows
             if idx > HEADER_ROWS
             and cell(cells, COLS['unitId'])
             and cell_text(after, 'G%d' % idx) != cell_text(xml, 'G%d' % idx)
             and idx not in {c[0] for c in changes}]
    print('误伤其它行：%d' % len(stray))


main()
