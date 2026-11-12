# -*- coding: utf-8 -*-
"""技能设计案2.xlsx 第 81 行（68016 磁电菇「磁电冲击」101604）：补「跟随角色移动」口径。

2026-11-12 用户口径：
  「68016 的磁电冲击技能应该跟随角色一起移动，固定在角色身前，
    将技能描述同步修改到源表，以及技能设计案」。

改五件事（zip 级手术，只动目标格）：
  1. K/L/M 81 —— 三档描述（原本三格是空的），兵种等级与 `armySkillLevelUp` 对齐 0/20/25；
  2. N 81 —— 旧文本不完整（「在身前1px的位置…冲击波持续 3，」）且写的是「伤害范围匹配特效」，
     换成矩形尺寸 + 波次 + **跟随**的完整口径；
  3. O 81 —— 补「表现事件随区域每帧搬坐标 ⇒ 光束与判定同点同角度」；
  4. P 81 —— 补落地参数与代码路径（含 `auraFollow` 0 → 1、`followForward` 的来历）；
  5. S 81 —— 待规划 → 已实现。

数值逐条对着 `pvpSkillPlan` 94016041~43 抄，不在这里另写一套。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'

ROW = 81

#  三档：兵种解锁等级、半长（= auraRadius）、半宽（三档不变）、每波倍率
TIERS = [(1, 0, 160, 54, '250%'), (2, 20, 180, 54, '300%'), (3, 25, 200, 54, '350%')]

FOLLOW = '随角色移动、始终固定在角色身前'


def tier_text(level_no, hero_level, half_length, half_height, rate):
    if level_no == 1:
        return (
            'L1（兵种 %d 级）：累计 8 次普攻，朝目标方向喷出一道长 %d、宽 %d 的雷电束'
            '（起点在自身中心、%s），持续 3 秒、每秒造成 %s 攻击力伤害，每波最多命中 5 个敌人'
            % (hero_level, half_length * 2, half_height * 2, FOLLOW, rate)
        )
    return (
        'L%d（兵种 %d 级）：雷电束加长到 %d（宽仍 %d），每波 %s 攻击力；'
        '触发门槛 / 时长 / 5 人上限 / 跟随本体均不变'
        % (level_no, hero_level, half_length * 2, half_height * 2, rate)
    )


N_TEXT = (
    '累计 8 次普攻后，沿**角色朝向**喷出一道雷电束。\r\n'
    '判定是**矩形**：长 × 宽 = 320/360/400 × 108 逻辑 px（半长跟随 `auraRadius`、半宽 54），'
    '左缘压在角色脚点、右缘到身前 320/360/400；持续 3 秒，每秒结算 1 波（共 3 波），每波最多命中 5 个敌人。\r\n'
    '🔴 2026-11-12：光束**跟随角色移动、固定在角色身前** —— 角色走位 / 转向时光束跟着走，'
    '不再定死在施法点（原 `auraFollow = 0` 站桩，角色一离开光束就错位）。'
    '实现：`auraFollow` 改 1，`followCaster` 每帧把落点重算成'
    '「本体坐标 + 美术朝向前移 `auraForward`」，矩形朝向同步刷新。'
)

O_TEXT = (
    '使用【雷电冲击】特效，9~14 帧循环。表现事件由区域每帧搬坐标（`holdVisual` + `syncHoldVisual`），'
    '所以「画面上的光束」与「判定矩形」永远同一点、同一角度 —— 跟随本体也是靠这一条自然成立的。'
)

P_TEXT = (
    'behaviorKey=self_aura，触发口径 auraEvery=8（累计普攻，计数走 unit.auraFiredCount）。'
    '参数：auraEvery=8 / auraSeconds=3 / auraInterval=1（共 3 波）/ auraRadius=160·180·200（同时是矩形半长）/ '
    'auraRectHalfHeight=54（半宽 ⇒ 宽 108）/ auraForward=160·180·200（= auraRadius，保证左缘压脚点）/ '
    'auraDamageRate=2.5·3.0·3.5 / auraWaveMaxTargets=5 / auraVisualLiftPx=30 / auraFaceTarget=1（朝向目标）/ '
    '**auraFollow=1**（2026-11-12 由 0 改 1：跟随本体、固定在身前）。'
    '落地：ZCAttackResolutionSystem.castSelfAura 建区域（写 followUnitId + followForward）→ '
    'ZCGroundZoneSystem.followCaster 每帧算落点并刷新 angleDegrees → '
    'zcGroundZoneReaches 判矩形（resolveWave / resolveExpiry 同一处口径）。'
    '跨表同步：两份 JSON + J-技能表 + K-卡牌升级由 patch_magdi_shock_follow.js / '
    'patch_magdi_skill_rows_excel.py / patch_skill_k_desc_excel.py 三写。'
)

STATUS = '已实现'


def main():
    xml = read_zip_rows(PATH, MEMBER)

    jobs = []
    for index, tier in enumerate(TIERS):
        jobs.append((f'{"KLM"[index]}{ROW}', tier_text(*tier)))
    jobs += [
        (f'N{ROW}', N_TEXT),
        (f'O{ROW}', O_TEXT),
        (f'P{ROW}', P_TEXT),
        (f'S{ROW}', STATUS),
    ]

    for ref, value in jobs:
        xml = set_cell(xml, ref, value)
        print('  %-5s %s' % (ref, value.split('\r\n')[0][:110]))

    backup = write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    print('[ok] 写回 %s' % PATH)
    print('[ok] 备份 %s' % backup)

    check = read_zip_rows(PATH, MEMBER)
    for needle in ('跟随角色移动', '固定在角色身前', 'auraFollow=1', '已实现', '长 × 宽 = 320/360/400'):
        if needle not in check:
            raise SystemExit('[fail] 回读缺关键词 %s' % needle)
    print('[ok] 回读通过（K/L/M/N/O/P/S 已落盘）')


if __name__ == '__main__':
    main()
