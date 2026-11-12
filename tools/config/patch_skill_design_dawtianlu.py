# -*- coding: utf-8 -*-
"""技能设计案2.xlsx 第 126 行（68025 大威天芦 / 102504 天降神拳）：补三档效果、落地口径、状态。

同样是 zip 级手术：工作簿里有 1 个公式单元格（伤害参数 B46），openpyxl 存一次就会把
它的缓存值抹掉。这里只改 K/L/M/P/S 五个格子，其余 137KB 原样保留。

编号与数值口径来自已经落地的配表（`pvpSkill` 30858/30859、`pvpSkillPlan` 102504 三档）：
  · 弹速 100、持续 4 秒  → pvpSkill.projectileSpeed + skillParamJson.projectileLifeSeconds
  · 伤害 300/500/700     → damageRate 2.14/3.57/5.00（÷ 面板 140）
  · 命中 5/7/9 个敌人    → pierceCount 4/6/8（首目标不占穿透次数）
  · 每多一人 -50%        → pierceFalloff 0.5
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'          # workbook.xml: 技能设计案 (2) = rId1
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'
ROW = 126

TIERS = [
    (1, 'L1（兵种 0 级）：累计 8 次普攻后，向目标方向击出一记贯穿重拳，弹速 100、持续 4 秒；'
        '最多命中 5 个敌人，首击 300 伤害（≈214% 面板），之后每多命中一人伤害递减 50%'),
    (2, 'L2（兵种 20 级）：累计 8 次普攻后，向目标方向击出一记贯穿重拳，弹速 100、持续 4 秒；'
        '最多命中 7 个敌人，首击 500 伤害（≈357% 面板），之后每多命中一人伤害递减 50%'),
    (3, 'L3（兵种 25 级）：累计 8 次普攻后，向目标方向击出一记贯穿重拳，弹速 100、持续 4 秒；'
        '最多命中 9 个敌人，首击 700 伤害（=500% 面板），之后每多命中一人伤害递减 50%'),
]

MODIFIER = (
    'pvpSkill 30859「天降神拳」（projectile，projectileSpeed=100，'
    'effectPrefabPath=units/projectiles/大拳飞冲子弹类特效/大拳飞冲子弹类特效）承接弹道，'
    '挂到 30858「大威天芦普攻」的 empoweredSkillId；普攻行 trigger=every_n_attacks、'
    'empoweredEvery=8（原借 30171 长枪兵普攻，2026-11-09 解耦）。'
    'skill 域 skillParamJson={"damageRate":2.14/3.57/5.00,"pierceCount":4/6/8,'
    '"pierceFalloff":0.5,"projectileLifeSeconds":4}。'
    '三条换算口径：① damageRate 是**面板倍率**不是绝对值 —— skillDamageRate 乘的是 '
    'pvpCard.unitAttack(140)，所以 300/500/700 ⇒ 2.14/3.57/5.00；'
    '② pierceCount **不含首个目标**（首目标 + 穿透 N 次 = 5/7/9 人），与玉林好汉「穿透 3 人」同口径；'
    '③ projectileLifeSeconds 是 2026-11-09 新增参数，让弹道寿命取固定值而不是「距离 ÷ 速度」。'
    '升级描述与修改器引用见 K 表 102504（94025041/42/43，由 pvpSkillPlan.modifierId 回填）。'
)

STATUS = '已实现'

CELLS = [('K', TIERS[0][1]), ('L', TIERS[1][1]), ('M', TIERS[2][1]),
         ('P', MODIFIER), ('S', STATUS)]


def main():
    xml = read_zip_rows(PATH, MEMBER)
    import re
    if '<row r="%d"' % ROW not in xml:
        raise SystemExit('[fail] 第 %d 行不存在' % ROW)
    for col, value in CELLS:
        ref = '%s%d' % (col, ROW)
        if '<c r="%s"' % ref not in xml:
            raise SystemExit('[fail] 单元格 %s 不存在' % ref)
        xml = set_cell(xml, ref, value)
        print('  %s = %s' % (ref, value[:36] + ('…' if len(value) > 36 else '')))

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    src = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    backup = os.path.join(BACKUP_DIR, '%s.bak-%s' % (os.path.basename(PATH), stamp))
    if os.path.isfile(src) and src != backup:
        os.replace(src, backup)

    check = read_zip_rows(PATH, MEMBER)
    for col, value in CELLS:
        if value[:20] not in check:
            raise SystemExit('[fail] 回读失败：%s%d' % (col, ROW))
    print('[ok] 回读通过；备份 %s' % backup)


if __name__ == '__main__':
    main()
