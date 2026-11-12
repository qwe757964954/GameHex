# -*- coding: utf-8 -*-
"""技能设计案2.xlsx 第 80/81 行（68016 磁电菇）：判定改矩形 + 状态收尾。

2026-11-11 用户口径：「把判定改成长方形，尽可能贴合特效范围」。

改四件事（zip 级手术，只动目标格，公式缓存原样保留）：
  1. K/L/M 81 —— 磁电冲击的三档从「半径 160/180/200 的冲击波」改写成「长 × 宽的雷电束」；
  2. P 81 —— 「判定取圆形区域」整句换成矩形口径（含尺寸推导与「不随朝向旋转」）；
  3. P 81 末段 —— 删掉「⚠️ 已知差异（圆的上下缘是空的…三个选项）」；
  4. S 80/81 —— 101603 / 101604 两条都已实现，状态从「待规划」改「已实现」。

数值全部对得上配表：`pvpSkillPlan` 三档 `auraRadius` 160/180/200 当半长用，
`auraRectHalfHeight` 54 当半宽用（⇒ 108 逻辑 px = 屏上 83px ≈ 美术高 82.4px）。
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'

#  三档：兵种等级、半长（= auraRadius）、每波倍率
TIERS = [(1, 0, 160, '250%'), (2, 20, 180, '300%'), (3, 25, 200, '350%')]


def tier_text(tier):
    """半长 ×2 = 全长；半宽 54 ×2 = 108（三档不变）。"""
    level_no, hero_level, half_length, rate = tier
    if level_no == 1:
        return ('L1（兵种 %d 级）：累计 8 次普攻，在身前展开一道长 %d、宽 108 的雷电束'
                '（左右各 %d、上下各 54 逻辑 px），持续 3 秒、每秒 1 波、每波 %s 攻击力，'
                '每波最多命中 5 个敌人' % (hero_level, half_length * 2, half_length, rate))
    return ('L%d（兵种 %d 级）：雷电束加长到 %d（左右各 %d），宽度仍是 108；每波 %s 攻击力；'
            '触发门槛 / 时长 / 5 人上限不变'
            % (level_no, hero_level, half_length * 2, half_length, rate))


K81, L81, M81 = (tier_text(t) for t in TIERS)

P81 = (
    'behaviorKey=self_aura（复用自身光环车道，新增「累计普攻」触发口径 auraEvery，与 auraCooldown 二选一；'
    '计数走 unit.auraFiredCount）。'
    '参数：auraEvery=8 / auraSeconds=3 / auraInterval=1（共 3 波）/ auraRadius=160·180·200 / '
    'auraRectHalfHeight=54 / auraDamageRate=2.5·3.0·3.5 / auraForward=1 / auraFollow=0（站桩，不跟随本体）/ '
    'auraWaveMaxTargets=5。'
    '落点 = 本体美术朝向前方 1（表值，×combatDistanceScale）；**判定是与坐标轴对齐的矩形**'
    '（2026-11-11 用户口径「把判定改成长方形，尽可能贴合特效范围」）：'
    '半长沿用 auraRadius（160/180/200），半宽写死 auraRectHalfHeight=54 ⇒ 108 逻辑 px = 屏上 83.0px，'
    '正好等于雷电冲击美术的高 82.4px；L2 的全长 360 也基本等于美术宽 363。'
    '矩形**不随本体朝向旋转** —— area 事件两端同点，视图的 zcCombatEffectHeadingDegrees 对零位移返回 null，'
    '美术本身也不转，判定必须跟美术同一个朝向口径。形状判定收口在 zcGroundZoneReaches，'
    'resolveWave 与 resolveExpiry 两处都要走它（漏到期那处 = 每波打不到、消散时按圆炸一次）。'
    '这是**逐技能开**的：无尘禁土 102503（站桩光柱）与麻辣铁锅喷射火焰 102603（身前圆形）仍然是圆。'
    '造型按单位可覆盖：ZCSelfAuraFx.SELF_AURA_FX_BY_UNIT —— 68016 → 雷电冲击，68025 无尘禁土仍用原来那根光柱。'
    '触发范围闸门同上（待触发不消费计数，目标进范围立刻补放）。'
    '表现：已落地。prefab = units/projectiles/雷电冲击/雷电冲击（按表现描述只取第 9~14 帧做 0.5s 循环、'
    'wrapMode=2；1~8 起势 / 15~18 消散不进循环段，入场由区域系统的 growSeconds=0.2 负责）。'
    '画布 489×144、烘焙缩放 0.575963 ⇒ 屏上 279.3×82.4px = 逻辑 363×107，与矩形判定同源'
    '（6 帧 alpha 并集 485×143 画布 px 推出来的）。'
)

CELLS = [('K', 81, K81), ('L', 81, L81), ('M', 81, M81), ('P', 81, P81),
         ('S', 80, '已实现'), ('S', 81, '已实现')]


def main():
    xml = read_zip_rows(PATH, MEMBER)
    for col, row, _ in CELLS:
        ref = '%s%d' % (col, row)
        if '<c r="%s"' % ref not in xml:
            raise SystemExit('[fail] 单元格 %s 不存在' % ref)
    for col, row, value in CELLS:
        ref = '%s%d' % (col, row)
        xml = set_cell(xml, ref, value)
        print('  %-4s = %s%s' % (ref, value[:44].replace('\n', ' '), '…' if len(value) > 44 else ''))

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    src = os.path.join(BACKUP_DIR, os.path.basename(PATH))
    backup = os.path.join(BACKUP_DIR, '%s.bak-%s' % (os.path.basename(PATH), stamp))
    if os.path.isfile(src) and src != backup:
        os.replace(src, backup)

    check = read_zip_rows(PATH, MEMBER)
    for col, row, value in CELLS:
        if value[:20] not in check:
            raise SystemExit('[fail] 回读失败：%s%d' % (col, row))
    print('[ok] 回读通过；备份 %s' % backup)


if __name__ == '__main__':
    main()
