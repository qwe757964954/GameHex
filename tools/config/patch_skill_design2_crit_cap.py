# -*- coding: utf-8 -*-
"""把「裂变暴击」两行的暴击率压到卡牌硬上限 7%（2026-11-16）。

用户口径：「卡牌自身提高暴击率只能是个位数 1~7% 的档位里细分」。

`弱点标记` 已由 patch_skill_design2_passive_layers.py 改为 绿 1/2/3、蓝 4/5/6；
但 `裂变暴击`（68025 / 68033）是「属性符合池子」的保留行，主脚本不碰，仍是 22/30/38%。
本脚本只改这两行的暴击率，**暴击伤害与溅射的三档递进原样保留**，其余列不动。

顺带修 68033 的落地口径：`explosionDamageRate` 引擎不认，统一写 `splashDamageRate`。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'

CRIT_CAP = 7

#  行号 → (兵种等级三档, 暴伤三档, 溅射三档)
ROWS = {
    124: ((0, 16, 23), (90, 120, 150), (20, 26, 32)),
    163: ((0, 14, 22), (90, 120, 150), (32, 40, 48)),
}


def tiers(lv, cdmg, spl):
    n1, n2, n3 = lv
    l1 = ('L1（兵种 %d 级%s）：暴击率提高 %d%%（卡牌硬上限），暴击伤害提高 %d%%，'
          '命中对周围造成 %d%% 溅射伤害（同一爆点第 2 个目标起每次 ×0.7）'
          % (n1, '，开局即解锁' if n1 == 0 else '', CRIT_CAP, cdmg[0], spl[0]))
    l2 = ('L2（兵种 %d 级）：暴击伤害提高到 %d%%，溅射提高到 %d%%，'
          '暴击率已到上限、不再增长' % (n2, cdmg[1], spl[1]))
    l3 = ('L3（兵种 %d 级）：暴击伤害提高到 %d%%，溅射提高到 %d%%，暴击率不变'
          % (n3, cdmg[2], spl[2]))
    return l1, l2, l3


def mech(cdmg, spl):
    return (
        '裂隙瞄准镜把弱点标成高亮，命中要害时触发链式裂变。战士高级「溅射」的混搭变体：'
        '暴击率 + 暴击伤害 + 溅射三段同条。\r\n'
        '🔴 **暴击率固定 %d%%（卡牌被动硬上限），三档不再增长** —— 暴击率是稀缺乘区，'
        '卡牌外的暴伤/暴击词条会把它二次放大，所以卡牌内只给个位数；'
        '三档递进全部落在暴击伤害（%d/%d/%d%%）与溅射（%d/%d/%d%%）上。'
        '【本轮改动】原 22/30/38%% 的暴击率压到上限 %d%%，暴伤与溅射不动。'
        % (CRIT_CAP, *cdmg, *spl, CRIT_CAP))


def mod(cdmg, spl):
    return ('unit 域 critRate add=0.07/0.07/0.07（🔴 卡牌被动合计 ≤0.07，配表加断言） + '
            'unit 域 critDamage add=%d/%d/%d（整数口径） + '
            'skill 域 skillParamJson={"splashDamageRate":%s,"splashFalloff":0.3}；'
            'skill 域参数按「同 unitId:pvpSkillId 参数叠加」合并进本卡普攻技能行'
            % (*cdmg, '/'.join('%.2f' % (v / 100.0) for v in spl)))


def main():
    xml = read_zip_rows(PATH, MEMBER)
    for row, (lv, cdmg, spl) in sorted(ROWS.items()):
        l1, l2, l3 = tiers(lv, cdmg, spl)
        for ref, val in (('K%d' % row, l1), ('L%d' % row, l2), ('M%d' % row, l3),
                         ('N%d' % row, mech(cdmg, spl)), ('P%d' % row, mod(cdmg, spl))):
            xml = set_cell(xml, ref, val)
        print('[ok] 行%d 暴击率 → %d%%；暴伤 %s；溅射 %s' % (row, CRIT_CAP, cdmg, spl))

    backup = write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    print('[ok] 写回 %s' % PATH)
    print('[ok] 备份 %s' % backup)

    check = read_zip_rows(PATH, MEMBER)
    for bad in ('22%', '30%', '38%'):
        if '暴击率提高 %s' % bad in check or '暴击率提高%s' % bad in check:
            raise SystemExit('[fail] 回读仍有超标暴击率 %s' % bad)
    print('[ok] 回读通过：无超标暴击率')


if __name__ == '__main__':
    main()
