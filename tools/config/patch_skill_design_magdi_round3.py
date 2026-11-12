# -*- coding: utf-8 -*-
"""技能设计案2.xlsx 第 80/81 行第三轮口径（2026-11-11 17:20 用户）。

1. 磁电冲击 101604：「特效起始位置要在角色的中心点，终点要朝向目标方向」
   · K/L/M 81 三档改成「朝目标方向喷出一道长 N、宽 108 的雷电束（起点在自身中心）」；
   · P 81 把「落点 = 前方 1」「矩形不随朝向旋转」两句整段换掉，补 auraFaceTarget / auraVisualLiftPx。
2. 五雷轰顶 101603：「连续特效出现间隔 0.18s，有明显先后顺序，同时间距增加 15px」
   · K 80 里的「每道间隔 30px、出现间隔 0.1s」→「45px、0.18s」；
   · P 80 的参数行与落点说明同步，并在末尾补一段「为什么改」。
3. S 80/81 已经是「已实现」，不动。

zip 级手术，只改 K/L/M/P 五个格子的目标行，其余字节与公式缓存原样保留。
P 列是在**现有文案上做定点替换**（读出来 → 替换 → 写回），不是重打一遍，
免得把上一轮写进去的长篇口径丢掉。每条替换都断言命中，没命中直接报错退出。
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'

TIERS_81 = [
    (1, 0, 320, '250%', '起点在自身中心、抬到身体中心 30px'),
    (2, 20, 360, '300%', None),
    (3, 25, 400, '350%', None),
]


def tier_text(tier):
    level_no, hero_level, length, rate, extra = tier
    if level_no == 1:
        return ('L1（兵种 %d 级）：累计 8 次普攻，朝目标方向喷出一道长 %d、宽 108 的雷电束'
                '（%s），持续 3 秒、每秒 1 波、每波 %s 攻击力，每波最多命中 5 个敌人'
                % (hero_level, length, extra, rate))
    return ('L%d（兵种 %d 级）：雷电束加长到 %d（宽度仍是 108）；每波 %s 攻击力；'
            '触发门槛 / 时长 / 5 人上限不变' % (level_no, hero_level, length, rate))


K81, L81, M81 = (tier_text(t) for t in TIERS_81)

K80 = ('L1（兵种 9 级）：锁定目标落 1 道雷电，并沿目标背朝向再落 2 道'
       '（每道间隔 45px、出现间隔 0.18s、特效第 5 帧判伤），每道 160% 攻击力；'
       '逐道独立 30% 概率使目标进入【麻痹】3 秒（只禁攻击、移速 −50%）')

#  P 列：在原文上定点替换（左旧 / 右新），每条都必须命中
REPLACE_80 = [
    ('boltSpacing=30 / boltInterval=0.1', 'boltSpacing=45 / boltInterval=0.18'),
    ('落点沿「目标 → 背朝向」按 30px 排开', '落点沿「目标 → 背朝向」按 45px 排开'),
]
APPEND_80 = ('\n2026-11-11 第二轮（用户口径「出现间隔 0.18s，有明显的先后顺序，同时间距增加 15px」）：'
             'boltInterval 0.1 → **0.18s**、boltSpacing 30 → **45**（+15 表值逻辑 px ⇒ 世界 13.5px）。'
             'boltDelay 仍是 0.15 —— 它锚的是「特效第 5 帧」的时间窗，与出现间隔无关，'
             '所以五道雷的判伤时刻变成 0.15 / 0.33 / 0.51 / 0.69 / 0.87s。')

REPLACE_81 = [
    ('auraForward=1 / auraFollow=0（站桩，不跟随本体）/ auraWaveMaxTargets=5。',
     'auraForward=160·180·200（= 同档 auraRadius）/ auraFollow=0（站桩，不跟随本体）'
     '/ auraFaceTarget=1（朝当前目标）/ auraVisualLiftPx=30（屏幕竖直抬到身体中心）/ auraWaveMaxTargets=5。'),
    ('落点 = 本体美术朝向前方 1（表值，×combatDistanceScale）；',
     '落点 = 沿「本体 → 目标」方向前移半个身位（auraForward = 同档 auraRadius，×combatDistanceScale）'
     '⇒ 光束正好覆盖「角色中心 → 前方 2×半径」：起点贴角色中心、终点朝目标；'),
    ('矩形**不随本体朝向旋转** —— area 事件两端同点，视图的 zcCombatEffectHeadingDegrees '
     '对零位移返回 null，美术本身也不转，判定必须跟美术同一个朝向口径。',
     '矩形**随目标方向旋转**（角度 = 施法那一刻「本体 → 目标」的方位角，存 zone.angleDegrees）：'
     'area 事件两端同点，视图的 zcCombatEffectHeadingDegrees 对零位移返回 null ⇒ 角度只能由模型给'
     '（event.angleDegrees），判定与美术吃同一个角度。竖直方向另有一条 auraVisualLiftPx=30（屏上 px，'
     '加在 mapToViewY 之后、不跟旋转）把光束从脚点抬到身体中心 —— 单位根节点是逻辑脚点，'
     '不抬的话光束有一半埋在地面线以下。'),
]


def apply(text, rules, label):
    for old, new in rules:
        if old not in text:
            raise SystemExit('[fail] %s 里找不到：%s' % (label, old[:40]))
        text = text.replace(old, new)
    return text


def read_cells():
    """读现有 K/L/M/P 文本（只读，不存盘）。"""
    import openpyxl
    book = openpyxl.load_workbook(PATH, data_only=True, read_only=True)
    sheet = book['技能设计案 (2)']
    cells = {ref: sheet[ref].value for ref in ('P80', 'P81')}
    book.close()
    return cells


def main():
    current = read_cells()
    p80 = apply(str(current['P80']), REPLACE_80, 'P80') + APPEND_80
    p81 = apply(str(current['P81']), REPLACE_81, 'P81')

    cells = [('K', 80, K80), ('P', 80, p80),
             ('K', 81, K81), ('L', 81, L81), ('M', 81, M81), ('P', 81, p81)]

    xml = read_zip_rows(PATH, MEMBER)
    for col, row, _ in cells:
        ref = '%s%d' % (col, row)
        if '<c r="%s"' % ref not in xml:
            raise SystemExit('[fail] 单元格 %s 不存在' % ref)
    for col, row, value in cells:
        ref = '%s%d' % (col, row)
        xml = set_cell(xml, ref, value)
        print('  %-4s = %s%s' % (ref, value[:46].replace('\n', ' '), '…' if len(value) > 46 else ''))

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    src = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    backup = os.path.join(BACKUP_DIR, '%s.bak-%s' % (os.path.basename(PATH), stamp))
    if os.path.isfile(src) and src != backup:
        os.replace(src, backup)

    check = read_zip_rows(PATH, MEMBER)
    for col, row, value in cells:
        if value[:20] not in check:
            raise SystemExit('[fail] 回读失败：%s%d' % (col, row))
    print('[ok] 回读通过；备份 %s' % backup)


if __name__ == '__main__':
    main()
