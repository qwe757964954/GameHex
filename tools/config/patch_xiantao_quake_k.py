# -*- coding: utf-8 -*-
"""仙桃行者 68009「大地之力」100904：K 表（armySkillLevelUp）三档 desc 同步。

第 42 批（2026-11-23）新增「首个命中的敌人改为 300%/370%/450% 重击，落点范围内的敌人
受到同等伤害」⇒ 卡牌 UI 读的那份描述（K 表 C 列）也必须跟着说人话，
否则技能面板还写着旧口径，玩家看到的解释和实际结算不一致。

为什么走 zip 级手术、不用 openpyxl：
`K-卡牌升级.xlsx / 卡牌技能升级表`（sheet2）里有 1492 个公式单元格（D/E 共享公式、
N 列档位、O 列「解锁<color>…」拼接）。openpyxl 存档只写公式不写缓存值，
转表器（POI）读缓存值 ⇒ 整表导成空。这里只替换 B/C 两列的目标 `<c>`。

数据源 = `doc/塔防数据配置/json/client/armySkillLevelUp.json`（两份 JSON 已由
`tools/config/patch_xiantao_quake.js` 改好）⇒ 源表永远是 json 的投影，不另写死文案。

modfiy 列（L）**不动**：`project_skill_plan.mjs` 导出时把 pvpSkillPlan.modifierId
回填进来（94009041/42/43），写死反而会和 J 表打架。

幂等：内容一致就不写盘；写完回读 3 行 × B/C 逐格比对。
用法：python tools/config/patch_xiantao_quake_k.py
"""
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/Project/POW/doc/塔防数据配置/K-卡牌升级.xlsx'
MEMBER = 'xl/worksheets/sheet2.xml'      # workbook.xml: 卡牌技能升级表 = rId2
BACKUP_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置_历史备份'
CLIENT = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/armySkillLevelUp.json'

CHAIN_ID = 100904
COL_CHAIN = 'A'
COL_LEVEL = 'E'
COL_NAME = 'B'
COL_DESC = 'C'


def load_client():
    with open(CLIENT, encoding='utf-8') as fh:
        source = json.load(fh)
    rows = source if isinstance(source, list) else source.get('data', [])
    tiers = {}
    for row in rows:
        if int(float(row.get('id', 0))) != CHAIN_ID:
            continue
        tiers[int(float(row.get('skilllevel', 0)))] = {
            'name': str(row.get('name') or ''),
            'desc': str(row.get('desc') or ''),
        }
    return tiers


def row_text(xml, row_num, col):
    m = re.search(r'<c r="%s%d"[^>]*?(?:/>|>(.*?)</c>)' % (col, row_num), xml, re.S)
    if not m:
        return None
    inner = m.group(1) or ''
    texts = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
    texts += re.findall(r'<v>(.*?)</v>', inner, re.S)
    return texts[0] if texts else ''


def main():
    tiers = load_client()
    if sorted(tiers) != [1, 2, 3]:
        raise SystemExit('[fail] client 侧 %s 档位不全：%s' % (CHAIN_ID, sorted(tiers)))
    for level, row in tiers.items():
        if not row['desc']:
            raise SystemExit('[fail] client L%d 描述为空，不能拿空串覆盖源表' % level)

    xml = read_zip_rows(PATH, MEMBER)

    located = {}
    for m in re.finditer(r'<c r="%s(\d+)"[^>]*>(.*?)</c>' % COL_LEVEL, xml, re.S):
        row_num = int(m.group(1))
        if row_text(xml, row_num, COL_CHAIN) != str(CHAIN_ID):
            continue
        level = re.search(r'<v>(\d+)</v>', m.group(2))
        located[row_num] = int(level.group(1)) if level else None

    if len(located) != 3:
        raise SystemExit('[fail] K 表 %s 命中 %d 行，预期 3 行' % (CHAIN_ID, len(located)))

    plan = []
    for row_num, level in sorted(located.items()):
        if level not in tiers:
            raise SystemExit('[fail] 第 %d 行档位读出 %r' % (row_num, level))
        name, desc = tiers[level]['name'], tiers[level]['desc']
        if row_text(xml, row_num, COL_NAME) == name and row_text(xml, row_num, COL_DESC) == desc:
            continue
        plan.append((row_num, level, name, desc))

    if not plan:
        print('[skip] %s 三档 name/desc 已与 client 一致' % CHAIN_ID)
        return

    for row_num, level, name, desc in plan:
        xml = set_cell(xml, '%s%d' % (COL_NAME, row_num), name)
        xml = set_cell(xml, '%s%d' % (COL_DESC, row_num), desc)
        print('  L%d（第 %d 行）-> %s | %s' % (level, row_num, name, desc))

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    os.makedirs(BACKUP_DIR, exist_ok=True)
    write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    moved = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    backup = os.path.join(BACKUP_DIR, 'K-卡牌升级.xlsx.bak-xiantao-quake-%s' % stamp)
    if os.path.isfile(moved):
        os.replace(moved, backup)
    else:
        backup = '(write_zip 未生成备份)'

    check = read_zip_rows(PATH, MEMBER)
    for row_num, level in sorted(located.items()):
        if row_text(check, row_num, COL_NAME) != tiers[level]['name']:
            raise SystemExit('[fail] 回读 name 失败：第 %d 行' % row_num)
        if row_text(check, row_num, COL_DESC) != tiers[level]['desc']:
            raise SystemExit('[fail] 回读 desc 失败：第 %d 行' % row_num)
    print('[ok] 3 行 × B/C 逐格回读通过；备份 %s' % backup)


if __name__ == '__main__':
    main()
