# -*- coding: utf-8 -*-
"""第 44 批（2026-11-24）：两张单表格子 —— `PVP-技能.xlsx` 的 30844 名称 + `PVP-卡牌.xlsx` 的 68009 卡面简介。

为什么是这两个格子（其余 xlsx 已由专用脚本补上）：
  · `pvpSkillPlan` / `armySkillLevelUp` 走 `sync_plan_rows_to_j_excel.py` 与 `patch_batch44_k.py`；
    只剩 `pvpSkill.name` 与 `pvpCard.description` 没有任何脚本负责。
  · `pvpSkill 30844` 是仙桃行者普攻（30718）`empoweredEvery = 5` 指过去的武将技行 ——
    `sendAttack` 里 `skillName: `${profile.name}·强化`` 读的就是这一格，旧名字「大地之力」
    会一直出现在战斗日志与技能诊断里。模式（`projectile`）**不动**（见 patch_batch44_dash_chain.js）。
  · `pvpCard 68009.description` 是卡牌详情页真读的一行字，旧文案还写着「大地之力推出一道直线冲击波」，
    技能已经换成四段突进连击（用户：「面板说推波、实际贴脸突进」就是在骗玩家）。

两张表都启用了几何级 dimension / 大量共享公式 ⇒ 一律 zip 级只替换目标 `<c>`，其余字节原样保留。
定位必须走 `xlsx_read.read_sheet`：A 列文本是共享字符串，正则读 `<v>` 只会拿到下标。

幂等：内容一致就不写盘；写完回读逐字比对。
用法：python tools/config/patch_batch44_cells.py
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

ROOT = 'D:/Alan/Project/POW/doc/塔防数据配置'
BACKUP_DIR = os.path.join(ROOT + '_历史备份')
CLIENT = os.path.join(ROOT, 'json', 'client')

SKILL_PATH = os.path.join(ROOT, 'PVP-技能.xlsx')
CARD_PATH = os.path.join(ROOT, 'PVP-卡牌.xlsx')

EMPOWERED_SKILL_ID = 30844
UNIT_ID = 68009


def cell_inner(xml, col, row_num):
    m = re.search(r'<c r="%s%d"[^>]*?(?:/>|>(.*?)</c>)' % (col, row_num), xml, re.S)
    return None if not m else (m.group(1) or '')


def _single_sheet_guard(path, sheet_name):
    """`workbook.xml` 里必须只有这一个页签、且名字对得上（多一个就说明页序可能变过）。"""
    wb = read_zip_rows(path, 'xl/workbook.xml')
    names = re.findall(r'<sheet [^>]*name="([^"]+)"', wb)
    members = re.findall(r'<sheet [^>]*r:id="rId(\d+)"', wb)
    return names == [sheet_name] and members == ['1']


def find_row(sheet_rows, key):
    for index, cells in sheet_rows:
        if str(cells[0]).strip() == str(key):
            return index
    return None


def backup(path, xml, member, tag):
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    os.makedirs(BACKUP_DIR, exist_ok=True)
    write_zip(path, member, xml, BACKUP_DIR)
    moved = os.path.join(BACKUP_DIR, os.path.basename(path))
    target = os.path.join(BACKUP_DIR, '%s.bak-%s-%s' % (os.path.basename(path), tag, stamp))
    if os.path.isfile(moved):
        os.replace(moved, target)
        return target
    return '(write_zip 未生成备份)'


def patch_skill_name():
    """`PVP-技能.xlsx / 技能配置`：30844 的 B 列（技能名称）。"""
    with open(os.path.join(CLIENT, 'pvpSkill.json'), encoding='utf-8') as fh:
        source = json.load(fh)
    rows = source if isinstance(source, list) else source.get('data', [])
    target = next((row for row in rows if str(row.get('skillId')) == str(EMPOWERED_SKILL_ID)), None)
    if target is None:
        raise SystemExit('[fail] client 里找不到 pvpSkill %s' % EMPOWERED_SKILL_ID)
    name = str(target.get('name') or '')
    if not name:
        raise SystemExit('[fail] client 侧 30844 的 name 是空的')

    #  🔴 `PVP-技能.xlsx` 只有一个页签（`workbook.xml` 里就一条 `<sheet name="技能配置">`），
    #  所以直接钉 `sheet1.xml`。不能用 `sheet_member`：这张表的 `workbook.xml.rels` 把
    #  `Target` 写在 `Id` 前面，那个反查函数按固定属性序匹配，会报「rels 里找不到 rId1」。
    if not _single_sheet_guard(SKILL_PATH, '技能配置'):
        raise SystemExit('[fail] PVP-技能 不是单页签「技能配置」，先人工核对 member')
    member = 'xl/worksheets/sheet1.xml'
    xml = read_zip_rows(SKILL_PATH, member)
    sheet_rows = read_sheet(SKILL_PATH, 0)[1]
    header = sheet_rows[4][1][1] if len(sheet_rows) > 4 else None
    if header != 'name':
        raise SystemExit('[fail] PVP-技能 第 5 行 B 列是 %r，预期 name —— 列序变动，先人工核对' % header)

    row_num = find_row(sheet_rows, EMPOWERED_SKILL_ID)
    if row_num is None:
        raise SystemExit('[fail] PVP-技能 里找不到技能 %s 的行' % EMPOWERED_SKILL_ID)
    if cell_inner(xml, 'B', row_num) is None:
        raise SystemExit('[fail] 第 %d 行 B 列单元格不存在，set_cell 不建格' % row_num)

    before = str(sheet_rows[row_num - 1][1][1] or '')
    if before == name:
        print('[skip] PVP-技能 %s 的名称已是「%s」' % (EMPOWERED_SKILL_ID, name))
        return
    if before not in ('大地之力', '腾云驾雾'):
        raise SystemExit('[fail] PVP-技能 %s 的名称是 %r，既不是旧名也不是新名，拒绝改'
                         % (EMPOWERED_SKILL_ID, before))
    print('  PVP-技能 %s（第 %d 行）\n    旧：%s\n    新：%s' % (EMPOWERED_SKILL_ID, row_num, before, name))
    xml = set_cell(xml, 'B%d' % row_num, name)
    print('[ok] 备份 %s' % backup(SKILL_PATH, xml, member, 'batch44'))

    #  `read_sheet` 给的是 `(行号, 单元格列表)`，所以 `verify[row]` 已经是那一行了。
    verify = dict(read_sheet(SKILL_PATH, 0)[1])
    after = str(verify[row_num][1] or '')
    if after != name:
        raise SystemExit('[fail] 回读 B%d 与 client 不一致：%r' % (row_num, after))
    print('[ok] PVP-技能 B%d 回读通过' % row_num)


def patch_card_desc():
    """`PVP-卡牌.xlsx / 卡牌配置`：68009 的 I 列（description）。"""
    with open(os.path.join(CLIENT, 'pvpCard.json'), encoding='utf-8') as fh:
        source = json.load(fh)
    rows = source if isinstance(source, list) else source.get('data', [])
    target = next((row for row in rows if str(row.get('id')) == str(UNIT_ID)), None)
    if target is None:
        raise SystemExit('[fail] client 里找不到卡牌 %s' % UNIT_ID)
    desc = str(target.get('description') or '')
    if not desc:
        raise SystemExit('[fail] %s 的 description 是空的' % UNIT_ID)

    member = sheet_member(CARD_PATH, '卡牌配置')
    xml = read_zip_rows(CARD_PATH, member)
    sheet_rows = read_sheet(CARD_PATH, 0)[1]
    header = sheet_rows[4][1][8] if len(sheet_rows) > 4 else None
    if header != 'description':
        raise SystemExit('[fail] PVP-卡牌 第 5 行 I 列是 %r，预期 description —— 列序变动，先人工核对' % header)

    row_num = find_row(sheet_rows, UNIT_ID)
    if row_num is None:
        raise SystemExit('[fail] PVP-卡牌 里找不到卡牌 %s 的行' % UNIT_ID)
    if cell_inner(xml, 'I', row_num) is None:
        raise SystemExit('[fail] 第 %d 行 I 列单元格不存在，set_cell 不建格' % row_num)

    before = str(sheet_rows[row_num - 1][1][8] or '')
    if before == desc:
        print('[skip] PVP-卡牌 %s 的卡面描述已是新口径' % UNIT_ID)
        return
    print('  PVP-卡牌 %s（第 %d 行）\n    旧：%s\n    新：%s' % (UNIT_ID, row_num, before, desc))
    xml = set_cell(xml, 'I%d' % row_num, desc)
    print('[ok] 备份 %s' % backup(CARD_PATH, xml, member, 'batch44'))

    verify = dict(read_sheet(CARD_PATH, 0)[1])
    after = str(verify[row_num][8] or '')
    if after != desc:
        raise SystemExit('[fail] 回读 I%d 与 client 不一致：%r' % (row_num, after))
    print('[ok] PVP-卡牌 I%d 回读通过' % row_num)


def main():
    patch_skill_name()
    patch_card_desc()


if __name__ == '__main__':
    main()
