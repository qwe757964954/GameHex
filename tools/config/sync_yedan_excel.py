# -*- coding: utf-8 -*-
"""把椰蛋战士（68005）这轮改动回填到 `doc/塔防数据配置` 的 Excel 源表。

三件事：

  1. `PVP-技能.xlsx` / `技能配置`（pvpSkill）：
     · **新增一列 `secondarySkillId`（R 列）** —— 副技能行（一条普攻行只有一个强化槽，
       横扫挂在这里）。不补这一列的话，下次转表会把 JSON 里的 `secondarySkillId` 洗掉，
       表现为「横扫突然不出手」。
     · 重写 30707（改指 30831 + 挂 30832），追加 30831「暴风」、30832「横扫」。
  2. `J-技能表.xlsx` / `PVP技能配置`（pvpSkillPlan）：追加 68005 的 12 行（4 技能 × 3 档）。
  3. `PVP-卡牌.xlsx` 不动：68005 的 `unitSkillId` 仍是 30707（没换普攻行）。

沿用 `sync_treant_excel` 的 zip 级手术：只改目标 sheet 的 xml，其余条目原样复制
（`J-技能表.xlsx` 的「修改器」页 dimension 是 `A1:XFD3234`，openpyxl 一存就爆几百 MB）。

写入格式与既有数据行一致（逐列沿用模板行 `s=` 样式 + `t="inlineStr"`），不新增样式。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import (  # noqa: E402
    COLS_PLAN, COLS_SKILL, ROOT, build_row, cell_xml, col_letter, find_row_by,
    last_data_row, load_client_json, read_zip_rows, styles_of_row, upsert, write_zip,
)

BACKUP = 'C:/Users/Administrator/AppData/Local/Temp/tft_backup'
UNIT_ID = '68005'
SKILL_IDS = (30707, 30831, 30832)
NEW_COLUMN = 'secondarySkillId'
NEW_COLUMN_HEADER = {
    # 与既有列同构：第 1 行是文件名（只在 A1）、第 2 行类型、第 3 行中文、第 4 行说明、第 5 行字段名
    2: '3',
    3: '副技能ID',
    4: ('第二条主动技的 pvpSkill.skillId；0 / 留空 = 没有副技能。'
        '一条普攻行只有一个强化槽（empoweredSkillId），冷却型的那条挂这里，'
        '由 ZCSkillTriggerSystem 的副轨按 secondaryCooldown 推进'),
    5: NEW_COLUMN,
}


def append_cell(xml, row_num, ref, value):
    """在第 row_num 行的末尾追加一个单元格（`set_cell` 只能改已有的，这里要新建）。"""
    import re
    m = re.search(r'<row r="%d"[^>]*>(.*?)</row>' % row_num, xml, re.S)
    if not m:
        raise SystemExit('第 %d 行不存在' % row_num)
    style = re.search(r'<c r="Q%d"[^>]*? s="(\d+)"' % row_num, xml)
    cell = cell_xml(ref, style.group(1) if style else None, value)
    end = m.end() - len('</row>')
    return xml[:end] + cell + xml[end:]


def sync_pvp_skill():
    path = os.path.join(ROOT, 'PVP-技能.xlsx')
    member = 'xl/worksheets/sheet1.xml'
    xml = read_zip_rows(path, member)
    skills = {row['skillId']: row for row in load_client_json('pvpSkill.json')}

    for skill_id in SKILL_IDS:
        assert skill_id in skills, 'json 里没有技能 %d' % skill_id

    # ① 表头补 R 列（只在还没补过的时候写）
    if find_row_by(xml, 'R', NEW_COLUMN) is None:
        for row_num, text in NEW_COLUMN_HEADER.items():
            xml = append_cell(xml, row_num, 'R%d' % row_num, text)
        print('[ok] PVP-技能.xlsx 新增 R 列 %s' % NEW_COLUMN)
    else:
        print('[--] PVP-技能.xlsx R 列已存在，只更新数据行')

    # ② 数据行：30707 重写 + 30831 / 30832 追加
    cols = COLS_SKILL + [NEW_COLUMN]
    rows = [skills[skill_id] for skill_id in SKILL_IDS]
    values = [[row.get(key) for key in cols] for row in rows]
    template = last_data_row(xml)
    styles = styles_of_row(xml, template)
    # R 列沿用 Q 列的样式，避免新列裸奔（对齐方式与既有数据列一致）
    if 'R' not in styles and 'Q' in styles:
        styles['R'] = styles['Q']
    appended = rewritten = 0
    for row_values in values:
        key = row_values[0]
        hit = find_row_by(xml, 'A', key)
        if hit is None:
            target = last_data_row(xml) + 1
            xml = xml.replace('</sheetData>',
                              build_row(target, row_values, styles) + '</sheetData>', 1)
            from sync_treant_excel import bump_dimension
            xml = bump_dimension(xml, target)
            appended += 1
        else:
            hit_styles = styles_of_row(xml, hit)
            if 'R' not in hit_styles and 'Q' in hit_styles:
                hit_styles['R'] = hit_styles['Q']
            import re
            m = re.search(r'<row r="%d"[^>]*>.*?</row>' % hit, xml, re.S)
            xml = xml[:m.start()] + build_row(hit, row_values, hit_styles) + xml[m.end():]
            rewritten += 1
    backup = write_zip(path, member, xml, BACKUP)
    print('[ok] PVP-技能.xlsx 追加 %d 行 / 重写 %d 行：%s'
          % (appended, rewritten, ', '.join('%s %s' % (row[0], row[1]) for row in values)))

    # 守卫：30715（玉米射手普攻）必须原样还在；36221 不能被 30707 再引用
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
