# -*- coding: utf-8 -*-
"""68025 大威天芦「天降神拳」102504：补 K 表（armySkillLevelUp）的 name / desc 三档。

为什么这份表走 zip 级手术、不用 openpyxl：
`K-卡牌升级.xlsx / 卡牌技能升级表` 里有 1492 个**公式单元格**（D/E 列的共享公式、
N 列「I/II/III」档位、O 列「解锁<color>…<color>：…」拼接）。openpyxl 保存时只写公式、
**不写缓存值**，转表器（POI）读的是缓存值 ⇒ 整表会导成空。所以这里只替换 B/C 两列的
`<c>` 元素，其余字节原样保留 —— 与 `sync_treant_excel.py` 里那条「不依赖 sharedStrings、
不新增样式」的口径一致。

modfiy 列（L）**不动**：`project_skill_plan.mjs` 在导出时把 pvpSkillPlan.modifierId
回填进来（94025041/42/43），写死反而会和 J 表打架。
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/Project/POW/doc/塔防数据配置/K-卡牌升级.xlsx'
MEMBER = 'xl/worksheets/sheet2.xml'      # workbook.xml: 卡牌技能升级表 = rId2
BACKUP_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置_历史备份'

CHAIN_ID = 102504
NAME = '天降神拳'
# 与 skillParamJson 同一套数：214% / 357% / 500% 对应 300 / 500 / 700（面板 140）
DESCS = {
    1: '累计8次普攻，向目标方向打出一记贯穿重拳，最多命中5个敌人，单个目标受到214%伤害，每多命中一人递减50%',
    2: '累计8次普攻，向目标方向打出一记贯穿重拳，最多命中7个敌人，单个目标受到357%伤害，每多命中一人递减50%',
    3: '累计8次普攻，向目标方向打出一记贯穿重拳，最多命中9个敌人，单个目标受到500%伤害，每多命中一人递减50%',
}
COL_LEVEL = 'E'
COL_NAME = 'B'
COL_DESC = 'C'
DATA_START = 7


def row_text(xml, row_num, col):
    import re
    m = re.search(r'<c r="%s%d"[^>]*?(?:/>|>(.*?)</c>)' % (col, row_num), xml, re.S)
    if not m:
        return None
    inner = m.group(1) or ''
    texts = re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)
    texts += re.findall(r'<v>(.*?)</v>', inner, re.S)
    return texts[0] if texts else ''


def main():
    xml = read_zip_rows(PATH, MEMBER)

    import re
    levels = {}
    for m in re.finditer(r'<c r="%s(\d+)"[^>]*>(.*?)</c>' % COL_LEVEL, xml, re.S):
        if row_text(xml, int(m.group(1)), 'A') == str(CHAIN_ID):
            level = re.search(r'<v>(\d+)</v>', m.group(2))
            levels[int(m.group(1))] = int(level.group(1)) if level else None
    if len(levels) != 3:
        raise SystemExit('[fail] K 表 %s 命中 %d 行，预期 3 行' % (CHAIN_ID, len(levels)))

    if all(row_text(xml, row, COL_NAME) == NAME for row in levels):
        print('[skip] 102504 三档名字已是 %s' % NAME)
        return

    for row, level in sorted(levels.items()):
        if level not in DESCS:
            raise SystemExit('[fail] 第 %d 行档位读出 %r' % (row, level))
        xml = set_cell(xml, '%s%d' % (COL_NAME, row), NAME)
        xml = set_cell(xml, '%s%d' % (COL_DESC, row), DESCS[level])
        print('  L%d（第 %d 行）-> %s' % (level, row, NAME))

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, 'K-卡牌升级.xlsx.bak-%s' % stamp)
    write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    moved = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    if os.path.isfile(moved):
        os.replace(moved, backup)

    check = read_zip_rows(PATH, MEMBER)
    for row in levels:
        if row_text(check, row, COL_NAME) != NAME:
            raise SystemExit('[fail] 回读失败：第 %d 行' % row)
    print('[ok] 回读通过；备份 %s' % backup)


if __name__ == '__main__':
    main()
