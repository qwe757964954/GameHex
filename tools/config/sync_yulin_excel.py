# -*- coding: utf-8 -*-
"""把玉林好汉（68004）这轮改动回填到 `doc/塔防数据配置` 的 Excel 源表。

两件事（第三件 `PVP-卡牌.xlsx` 的 `unitSkillId` 走现成的 `patch_card_cell_excel.py`）：

  1. `PVP-技能.xlsx` / `技能配置`（pvpSkill）：追加
     · 30716「玉林好汉普攻」——自己的飞镖弹道，每 10 秒触发精英猎手；
     · 30821「精英猎手」——穿透弹道，指向放大版 prefab。
  2. `J-技能表.xlsx` / `PVP技能配置`（pvpSkillPlan）：追加 68004 的 12 行（4 技能 × 3 档）。

沿用 `sync_treant_excel` 的 zip 级手术：只改目标 sheet 的 xml，其余条目原样复制
（`J-技能表.xlsx` 的「修改器」页 dimension 是 `A1:XFD3234`，openpyxl 一存就爆几百 MB）。

写入格式与既有数据行一致（逐列沿用模板行 `s=` 样式 + `t="inlineStr"`），不新增样式。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    COLS_PLAN, COLS_SKILL, ROOT, find_row_by, load_client_json,
    read_zip_rows, upsert, write_zip,
)

BACKUP = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'
UNIT_ID = '68004'
SKILL_IDS = (30716, 30821)


def sync_pvp_skill():
    path = os.path.join(ROOT, 'PVP-技能.xlsx')
    member = 'xl/worksheets/sheet1.xml'
    xml = read_zip_rows(path, member)
    skills = {row['skillId']: row for row in load_client_json('pvpSkill.json')}

    for skill_id in SKILL_IDS:
        assert skill_id in skills, 'json 里没有技能 %d' % skill_id
    # 按 id 升序写入，追加顺序与表内既有习惯一致（小 id 在前）。
    rows = [skills[skill_id] for skill_id in sorted(SKILL_IDS)]
    values = [[row.get(key) for key in COLS_SKILL] for row in rows]
    xml, added, rewritten = upsert(xml, 'A', lambda row: row[0], values)
    backup = write_zip(path, member, xml, BACKUP)
    print('[ok] PVP-技能.xlsx 追加 %d 行 / 重写 %d 行：%s'
          % (added, rewritten, ', '.join('%s %s' % (row[0], row[1]) for row in values)))
    # 30715（玉米射手普攻）必须还在、且特效没被改走 —— 它是这轮唯一被「换下来」的行。
    assert find_row_by(xml, 'A', 30715), '30715 行不见了'
    return backup


def sync_pvp_skill_plan():
    path = os.path.join(ROOT, 'J-技能表.xlsx')
    member = 'xl/worksheets/sheet16.xml'
    xml = read_zip_rows(path, member)
    plans = load_client_json('pvpSkillPlan.json')
    rows = [plan for plan in plans if str(plan.get('unitId')) == UNIT_ID]
    assert len(rows) == 12, '%s 应有 12 行计划，实际 %d' % (UNIT_ID, len(rows))
    rows.sort(key=lambda plan: plan['modifierId'])

    values = [[plan.get(key) for key in COLS_PLAN] for plan in rows]
    xml, added, rewritten = upsert(xml, 'B', lambda row: row[1], values)
    backup = write_zip(path, member, xml, BACKUP)
    print('[ok] J-技能表.xlsx / PVP技能配置 追加 %d 行 / 重写 %d 行：%s'
          % (added, rewritten, ', '.join(str(row[1]) for row in values)))
    return backup


if __name__ == '__main__':
    backups = [sync_pvp_skill(), sync_pvp_skill_plan()]
    print('备份：')
    for item in backups:
        print('  ', item, os.path.getsize(item))
