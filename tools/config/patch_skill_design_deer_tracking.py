# -*- coding: utf-8 -*-
"""技能设计案2.xlsx 第 171 行（68034 魔术师「鹿神守护」）：改写成「追踪子弹」口径。

2026-11-12 用户口径：
  「小鹿应该是类似子弹一样的效果，只是一个会追踪目标的子弹，从角色朝向的 15px 处生成，
    移动时小鹿播放 walk 动画，前半段移速慢（70px），贴近目标后的移速快（140PX，同步在
    小鹿身上覆盖火船特效），当原目标死亡后，小鹿会转向新目标，接触到任意目标后造成伤害，
    子弹消失」

改六件事（zip 级手术，只动目标格，公式缓存与其余 2000+ 行原样保留）：
  1. G171 —— 链号笔误 103404 → **103405**（这一行一直是鹿神守护，但链号抄成了移形换影）；
  2. K/L/M 171 —— 三档描述（原来三格是空的），兵种等级与 `armySkillLevelUp` 对齐 9/18/24；
  3. N171 —— 旧「直线冲刺 / 伤害递减 50%」整段换成追踪弹六条口径；
  4. O171 —— 补表现资源口径（骨架三段动画 + 火船只当叠层 + 宿上倍率 + 层级覆盖）；
  5. P171 —— 补落地参数与代码路径（含删掉的 `zoneDamageFalloff`）；
  6. S171 —— 待规划 → 已实现。

数值逐条对得上配表 `pvpSkillPlan` 94034051~53，不在这里另写一套。
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'

ROW = 171
CHAIN = 103405

#  三档：兵种解锁等级、单次伤害 —— 与 armySkillLevelUp 的 unlockarmylevel 9/18/24 一致。
TIERS = [(1, 9, 600), (2, 18, 700), (3, 24, 800)]


def tier_text(level_no, hero_level, damage):
    return (
        'L%d（兵种 %d 级）：累计 8 次普攻，在身前 15px 处召唤 1 只小鹿，追踪最近的敌人 —— '
        '前段 70px/s 行走，距目标 ≤200px 后提速到 140px/s 并燃起火焰，'
        '接触敌人造成 %d 点伤害后消失；目标阵亡自动转向最近的敌人'
        % (level_no, hero_level, damage)
    )


N_TEXT = (
    '追踪弹口径（2026-11-12 重做）。小鹿是一颗「会追踪目标的子弹」，不再是对着方向冲出去的地面区域：\r\n'
    '① 生成：施法者朝向（facingRadians）前移 15px，不落在目标处；\r\n'
    '② 慢档：70px/s，每帧朝目标重算方向，播放走路动画（骨架里这一段叫 move，没有单独的 walk）；'
    '期间**不读秒、不结算**任何伤害；\r\n'
    '③ 快档：与目标距离 ≤200px 提速到 140px/s，改播 attack，并在小鹿身上点亮【火法师火船】叠层；\r\n'
    '④ 换目标：原目标阵亡 / 丢失 ⇒ 自动改追最近的敌人（搜索半径 600 世界 px），两档都继续转向；\r\n'
    '⑤ 命中：接触到任意目标造成 1 次伤害后**立刻消失**（命中名额只有 1）；'
    '原「每多命中一个目标伤害降低 50%」作废；\r\n'
    '⑥ 兜底：快档最长存活 2 秒，追不上就自己散场（不会一直飘在场上）。'
)

O_TEXT = (
    'P1 复用：魔术师召唤鹿（lu.skel，657×685 画布，三段动画 idle / move / attack）'
    '+ 火法师火船（挂在 prefab 子节点 fx_火船，**只在快档 active**）。'
    '宿上倍率 100/685（画布高落到 100 屏上 px）；层级覆盖到 top（它是会跑的生物，不铺地面）。'
    '资源零新增。'
)

P_TEXT = (
    'behaviorKey=skill_params（pvpSkillPlan 94034051~53 三档）：'
    '{"damageRate":5/5.8333/6.6667, "zoneMoveSpeed":140, "zoneApproachSpeed":70, '
    '"zoneSprintRange":200, "zoneSpawnForward":15, "zoneDuration":2, "zoneMaxHits":1, '
    '"zoneWaveInterval":0.15, "zoneHoldVisual":1}。'
    '落地：ZCAttackResolutionSystem.castSelfAura 建 zone（approachSpeed / sprintSpeed / sprintRange / '
    'spawnForward 全部 × combatDistanceScale=0.3）→ ZCGroundZoneSystem.advanceChase 每帧追目标、'
    '换目标、切档 → syncHoldVisual 把阶段动画与 overlayFx 推给 ZCCombatEffectView'
    '（applySpineAnimation / applyOverlayFx，叠层节点名登记在 '
    'ZCCombatEffectPlacement.OVERLAY_CHILD_BY_PREFAB_PATH）。'
    '🔴 zoneDamageFalloff 已从本链移除（只打 1 个目标，没有第二个可递减）；代码槽位保留给后续技能。'
)

STATUS = '已实现'


def main():
    xml = read_zip_rows(PATH, MEMBER)

    jobs = [(f'G{ROW}', CHAIN)]
    for index, (level_no, hero_level, damage) in enumerate(TIERS):
        column = 'KLM'[index]
        jobs.append((f'{column}{ROW}', tier_text(level_no, hero_level, damage)))
    jobs += [
        (f'N{ROW}', N_TEXT),
        (f'O{ROW}', O_TEXT),
        (f'P{ROW}', P_TEXT),
        (f'S{ROW}', STATUS),
    ]

    for ref, value in jobs:
        xml = set_cell(xml, ref, value)
        preview = str(value) if isinstance(value, int) else value.split('\r\n')[0]
        print('  %-5s %s' % (ref, preview[:110]))

    backup = write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    print('[ok] 写回 %s' % PATH)
    print('[ok] 备份 %s' % backup)

    #  回读自查：链号、三档、状态都得在。
    check = read_zip_rows(PATH, MEMBER)
    for ref in ['G%d' % ROW, 'K%d' % ROW, 'L%d' % ROW, 'M%d' % ROW, 'N%d' % ROW, 'S%d' % ROW]:
        if 'r="%s"' % ref not in check:
            raise SystemExit('[fail] 回读缺 %s' % ref)
    for needle in ('103405', '追踪', '200px', '立刻消失', '已实现'):
        if needle not in check:
            raise SystemExit('[fail] 回读缺关键词 %s' % needle)
    print('[ok] 回读通过（G/K/L/M/N/O/P/S 已落盘）')


if __name__ == '__main__':
    main()
