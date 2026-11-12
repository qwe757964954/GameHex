# -*- coding: utf-8 -*-
#  ⚠️ 历史脚本，口径已被后续轮次覆盖（101603 = 60px/0.15s；101604 = 矩形 + 跟随角色）。
#     重跑会把 K-卡牌升级 / armySkillLevelUp 的描述**回滚**到第三轮文案。当前真源：
#       · 配表：tools/config/patch_magdi_mushroom.js（整块重写，已与线上一致）
#       · 描述：patch_magdi_shock_follow.js（两份 JSON）+ patch_skill_k_desc_excel.py
#       · 设计案：patch_skill_design_magdi_follow.py
"""68016 磁电菇「五雷轰顶」101603 / 「磁电冲击」101604：补 K 表（armySkillLevelUp）的 name / desc 三档。

为什么走 zip 级手术、不用 openpyxl：
`K-卡牌升级.xlsx / 卡牌技能升级表` 里有大量**公式单元格**（`N` 列档位、`O` 列
「解锁<color>…<color>：…」拼接）。openpyxl 保存时只写公式、不写缓存值，而转表器（POI）
读的是缓存值 ⇒ 整表会导成空。所以这里只替换 B/C 两列的 `<c>` 元素，其余字节原样保留
（与 `patch_dawtianlu_skill_k.py` 同一套手法）。

⚠️ `O` 列（拼接文案）的**缓存值不会跟着更新** —— 它是辅助列，转表只取 A~M 列，
所以留着旧值不影响导出；要看新文案请用 Excel 打开重算。

`modfiy` 列（L）**不动**：`project_skill_plan.mjs` 导出时把 pvpSkillPlan.modifierId 回填进来。
101603 / 101604 这 6 行在表里**本来就存在**（193~198 行），只是 name / desc 空着。
"""
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/Project/POW/doc/塔防数据配置/K-卡牌升级.xlsx'
MEMBER = 'xl/worksheets/sheet2.xml'      # workbook.xml: 卡牌技能升级表 = rId2
BACKUP_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置_历史备份'

COL_ID = 'A'
COL_NAME = 'B'
COL_DESC = 'C'
COL_LEVEL = 'E'

# 与 `tools/config/patch_magdi_mushroom.js` 的 PANEL_DESC 逐字一致
# （`armySkillLevelUp.desc` / K 表 C 列 / 设计案 M 列是同一份文案）。
SKILLS = {
    101603: ('五雷轰顶', {
        1: '冷却12秒：对目标释放1道雷电并沿其背朝向再落2道（每道间隔60px、出现间隔0.15秒），每道造成160%伤害，30%概率使目标麻痹3秒',
        2: '冷却12秒：对目标释放1道雷电并沿其背朝向再落3道（每道间隔60px、出现间隔0.15秒），每道造成200%伤害，30%概率使目标麻痹3秒',
        3: '冷却12秒：对目标释放1道雷电并沿其背朝向再落4道（每道间隔60px、出现间隔0.15秒），每道造成250%伤害，30%概率使目标麻痹3秒',
    }),
    101604: ('磁电冲击', {
        1: '累计8次普攻：朝目标方向喷出一道长320、宽108的雷电束（起点在自身中心），持续3秒、每秒造成250%伤害，每波最多命中5个敌人',
        2: '累计8次普攻：朝目标方向喷出一道长360、宽108的雷电束（起点在自身中心），持续3秒、每秒造成300%伤害，每波最多命中5个敌人',
        3: '累计8次普攻：朝目标方向喷出一道长400、宽108的雷电束（起点在自身中心），持续3秒、每秒造成350%伤害，每波最多命中5个敌人',
    }),
}


def row_text(xml, row_num, col):
    m = re.search(r'<c r="%s%d"[^>]*?(?:/>|>(.*?)</c>)' % (col, row_num), xml, re.S)
    if not m:
        return None
    inner = m.group(1) or ''
    texts = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
    texts += re.findall(r'<v>(.*?)</v>', inner, re.S)
    return texts[0] if texts else ''


def collect_rows(xml, chain_id):
    """返回 {档位: 行号}，按 A 列 id + E 列档位配对。"""
    levels = {}
    for m in re.finditer(r'<c r="%s(\d+)"[^>]*>(.*?)</c>' % COL_LEVEL, xml, re.S):
        row = int(m.group(1))
        if row_text(xml, row, COL_ID) != str(chain_id):
            continue
        level = re.search(r'<v>(\d+)</v>', m.group(2))
        levels[int(level.group(1)) if level else None] = row
    return levels


def main():
    xml = read_zip_rows(PATH, MEMBER)
    plan = {}
    for chain_id, (name, descs) in SKILLS.items():
        rows = collect_rows(xml, chain_id)
        if len(rows) != 3:
            raise SystemExit('[fail] K 表 %s 命中 %d 行，预期 3 行' % (chain_id, len(rows)))
        for level, row in rows.items():
            if level not in descs:
                raise SystemExit('[fail] %s 第 %d 行档位读出 %r' % (chain_id, row, level))
            plan[row] = (name, descs[level], chain_id, level)
        print('  %s -> 行 %s' % (chain_id, sorted(rows.values())))

    if all(row_text(xml, row, COL_DESC) == desc for row, (_, desc, _, _) in plan.items()):
        print('[skip] 6 行 name/desc 已是目标文案')
        return

    for row in sorted(plan):
        name, desc, chain_id, level = plan[row]
        xml = set_cell(xml, '%s%d' % (COL_NAME, row), name)
        xml = set_cell(xml, '%s%d' % (COL_DESC, row), desc)
        print('  %s L%d（第 %d 行）-> %s' % (chain_id, level, row, name))

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, 'K-卡牌升级.xlsx.bak-%s' % stamp)
    write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    moved = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    if os.path.isfile(moved):
        os.replace(moved, backup)

    check = read_zip_rows(PATH, MEMBER)
    for row, (_, desc, _, _) in plan.items():
        if row_text(check, row, COL_DESC) != desc:
            raise SystemExit('[fail] 回读失败：第 %d 行' % row)
    print('[ok] 回读通过；备份 %s' % backup)


if __name__ == '__main__':
    main()
