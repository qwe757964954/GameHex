# -*- coding: utf-8 -*-
"""第 44 批（2026-11-24）：仙桃行者 100904 / 机甲菇 101503 的 K 表（armySkillLevelUp）同步。

两件事（用户原话见 `tools/config/patch_batch44_dash_chain.js` 开头）：
  · 100904「大地之力」→「腾云驾雾」，描述整段换成四段突进连击的口径；
  · 101503「武器绞杀」→「三尖两刃」，**描述一个字不动**（里面没有技能名）。

K 表 C 列是**卡牌 UI 真读**的那份描述：JSON 改了这里不改，技能面板就还写着旧口径。

为什么走 zip 级手术、不用 openpyxl：
`K-卡牌升级.xlsx / 卡牌技能升级表`（sheet2）里有大量公式单元格（D/E 共享公式、
N 列档位、O 列「解锁<color>…」拼接）。openpyxl 存档只写公式不写缓存值，
转表器（POI）读缓存值 ⇒ 整表导成空。这里只替换 B/C 两列的目标 `<c>`。

数据源 = `doc/塔防数据配置/json/client/armySkillLevelUp.json`（两份 JSON 已由
`tools/config/patch_batch44_dash_chain.js` 改好）⇒ 源表永远是 json 的投影，不另写死文案。

modfiy 列（L）**不动**：`project_skill_plan.mjs` 导出时把 pvpSkillPlan.modifierId
回填进来，写死反而会和 J 表打架。

幂等：内容一致就不写盘；写完回读 6 行 × B/C 逐格比对。
用法：python tools/config/patch_batch44_k.py
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

CHAINS = [100904, 101503]
COL_CHAIN = 'A'
COL_LEVEL = 'E'
COL_NAME = 'B'
COL_DESC = 'C'


def load_client():
    with open(CLIENT, encoding='utf-8') as fh:
        source = json.load(fh)
    rows = source if isinstance(source, list) else source.get('data', [])
    tiers = {chain: {} for chain in CHAINS}
    for row in rows:
        chain = int(float(row.get('id', 0)))
        if chain not in tiers:
            continue
        tiers[chain][int(float(row.get('skilllevel', 0)))] = {
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
    for chain in CHAINS:
        if sorted(tiers[chain]) != [1, 2, 3]:
            raise SystemExit('[fail] client 侧 %s 档位不全：%s' % (chain, sorted(tiers[chain])))
        for level, row in tiers[chain].items():
            if not row['name'] or not row['desc']:
                raise SystemExit('[fail] %s L%d 名字/描述为空，不能拿空串覆盖源表' % (chain, level))

    xml = read_zip_rows(PATH, MEMBER)

    #  先按 E 列（档位）扫全表，再用 A 列确认链号 —— 与 patch_batch43_k.py 同一套定位。
    located = {chain: {} for chain in CHAINS}
    for m in re.finditer(r'<c r="%s(\d+)"[^>]*>(.*?)</c>' % COL_LEVEL, xml, re.S):
        row_num = int(m.group(1))
        raw_chain = row_text(xml, row_num, COL_CHAIN)
        if raw_chain is None or not raw_chain.strip().isdigit():
            continue
        chain = int(float(raw_chain))
        if chain not in located:
            continue
        level = re.search(r'<v>(\d+)</v>', m.group(2))
        located[chain][row_num] = int(level.group(1)) if level else None

    for chain in CHAINS:
        if len(located[chain]) != 3:
            raise SystemExit('[fail] K 表 %s 命中 %d 行，预期 3 行' % (chain, len(located[chain])))

    plan = []
    for chain in CHAINS:
        for row_num, level in sorted(located[chain].items()):
            if level not in tiers[chain]:
                raise SystemExit('[fail] 第 %d 行档位读出 %r' % (row_num, level))
            name, desc = tiers[chain][level]['name'], tiers[chain][level]['desc']
            if row_text(xml, row_num, COL_NAME) == name and row_text(xml, row_num, COL_DESC) == desc:
                continue
            plan.append((chain, row_num, level, name, desc))

    if not plan:
        print('[skip] 两条链的 name/desc 已与 client 一致')
        return

    for chain, row_num, level, name, desc in plan:
        xml = set_cell(xml, '%s%d' % (COL_NAME, row_num), name)
        xml = set_cell(xml, '%s%d' % (COL_DESC, row_num), desc)
        print('  %s L%d（第 %d 行）-> %s | %s' % (chain, level, row_num, name, desc))

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    os.makedirs(BACKUP_DIR, exist_ok=True)
    write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    moved = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    backup = os.path.join(BACKUP_DIR, 'K-卡牌升级.xlsx.bak-batch44-%s' % stamp)
    if os.path.isfile(moved):
        os.replace(moved, backup)
    else:
        backup = '(write_zip 未生成备份)'

    check = read_zip_rows(PATH, MEMBER)
    for chain in CHAINS:
        for row_num, level in sorted(located[chain].items()):
            if row_text(check, row_num, COL_NAME) != tiers[chain][level]['name']:
                raise SystemExit('[fail] 回读 name 失败：%s 第 %d 行' % (chain, row_num))
            if row_text(check, row_num, COL_DESC) != tiers[chain][level]['desc']:
                raise SystemExit('[fail] 回读 desc 失败：%s 第 %d 行' % (chain, row_num))
    print('[ok] 6 行 × B/C 逐格回读通过；备份 %s' % backup)


if __name__ == '__main__':
    main()
