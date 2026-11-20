# -*- coding: utf-8 -*-
"""设计案同步（2026-11-19 用户口径）：急冻瓜「冰山陨落」102403 的释放位置改成受击目标。

用户原话：
> 急冻瓜的【冰山陨落】的释放位置应该是受击目标的位置，不是自身，
> 区域效果和冰锥都是落在目标身上 同步修改源表和设计案

改的是设计案第 120 行的 4 格（K / N / O / P），落点口径一句话说清：

· K（玩家可见 L1 文案）：「在自身位置引爆冰山」→「在受击目标位置引爆冰山」；
· N（机制 + 本轮改动）：第一条机制的「**自身位置**」改成「**受击目标位置**」，
  并补一句「冰域圆心 / 冰锥落点 / 减速范围三者一起搬到目标身上」；
· O（表现）：「冰锥……落在施法者所在位置」→「落在**受击目标所在位置**（与冰域圆心同一点）」，
  并把「冰锥目前是代码表按单位登记的落地一次性表现」写清（`ZCSelfAuraFx` 的
  `SELF_AURA_LANDING_FX_BY_UNIT`，漏收进资源清单就是「天上什么都不砸」）；
· P（落地口径）：补 `auraAtTarget = 1` 这条新键 —— 圆心 = 当前受击目标坐标、
  **隐含关闭 `auraFollow`**、没有目标 ⇒ 拒放不消费 CD、缺省 0 ⇒ 存量 `self_aura` 逐字不变。

幂等：逐格比对，内容没变就跳过写盘（共享字符串格子首轮回索引、之后回正文，两种都认）。

用法：python tools/config/patch_skill_design2_ice_at_target.py
"""
import html
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

ROOT = 'D:/Alan/占城玩法/策划文档/战斗系统'
XLSX = os.path.join(ROOT, '技能设计案2.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/config_backup'

ROW = 120
EXPECTED_CHAIN = '102403'

K_TEXT = (
    'L1（兵种 9 级）：冷却 14 秒，在受击目标位置引爆冰山，张开半径 120 的冰域，'
    '持续 3 秒、每 0.5 秒对范围内敌人造成 55% 伤害并使其移速降低 50%'
)

N_TEXT = (
    '法师高级主动。**第一条机制**：冷却到点在**受击目标位置**炸开一片冰域，'
    '每 0.5 秒结算一次范围伤害。'
    '**第二条机制**：冰域内的敌人移速降低 50%（软控，不剥夺攻击）。'
    '「陨落」的观感由落地那一击承担（冰锥自天而降，砸的就是同一个目标点），'
    '冰域本身是持续的蓝色光圈 ——设计案表现列要求「技能持续过程中需要有明确的蓝色光圈代表技能范围」，'
    '光圈就是 `auraRadius`，与判定半径同源，不需要另做一层提示。\n'
    '【2026-11-19 改动】释放位置由「自身脚下」改为「受击目标位置」：'
    '冰域圆心 / 冰锥落点 / 减速范围三者是同一点，一起搬到目标身上（口径见 P 列 `auraAtTarget`）；'
    '没有受击目标时**拒放**、不空烧一片地。\n'
    '【第 9 批】原行只有触发参数 `697`（Q4：文案被历史 skillId 覆盖），机制由第 9 批补。'
)

O_TEXT = (
    '【复用】冰锥复用【冰法师的冰锥】特效、旋转 -90°，落在**受击目标所在位置**'
    '（与冰域圆心同一点，不是施法者脚下）；'
    '它是「落地那一击」的一次性表现（0.5 秒后自己消失），不是跟着冰域站满 3 秒的那个圈。'
    '🔴 路径按单位登记在 `ZCSelfAuraFx` 的 `SELF_AURA_LANDING_FX_BY_UNIT`（行为技能在 `pvpSkill` 里没有造型槽），'
    '并且必须被 `ZCVisualResourcePlan` 收进本局清单 —— 漏收就是「区域照常掉血、天上什么都不砸下来」且不报错。'
    '蓝色光圈 = `self_aura` 的区域本身（`auraRadius` 与判定半径同源，改一个数两处一起动）。'
    '区域的持有时长 = auraSeconds（3 秒），表现事件的 durationSeconds 必须 ≥ 它'
)

P_TEXT = (
    'behaviorKey = **self_aura**（`castSelfAura`），冷却车道 `auraReadyAt`。'
    'skillParamJson：auraCooldown = 14、auraSeconds = 3、auraInterval = 0.5、'
    'auraRadius = 120（逻辑 px，与 attackRange 同一套数 ⇒ 乘 combatDistanceScale）、'
    'auraDamageRate = 0.55 / 0.65 / 0.75、auraSlowRatio = 0.5、'
    '**auraAtTarget = 1**（2026-11-19 新键，三档同值：判定圆心 = 当前受击目标坐标，'
    '并且**隐含关闭 `auraFollow`** —— 跟随会把圆心每帧拽回施法者，等于没搬；'
    '没有目标 ⇒ 拒放、不消费 CD；缺省 0 ⇒ 无尘禁土 / 磁电冲击 / 喷射火焰逐字不变）。'
    '单跳的暴击 / 克制按开光环那一刻的目标算一次，之后每波同值（区域只存一个 damage 标量）。'
    'pvpSkillId 沿用本卡普攻 30671 ⇒ 参数袋键 = `68024:30671`，与 102401 / 102402 同一袋。'
    '🔴 **statusId 必须留空**：那是整卡共用的一个槽（mergeSkillPlanIntoRuntime 按 unitId:pvpSkillId 合并），'
    '写了它本卡普攻每一发都会顺手挂上同一个状态'
)

CELLS = {'K': K_TEXT, 'N': N_TEXT, 'O': O_TEXT, 'P': P_TEXT}


def cell_text(xml, ref):
    """读一个单元格的当前文本（共享字符串只回索引，够用于幂等比较，不解析正文）。"""
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not match:
        return None
    inner = match.group(1) or ''
    for pattern in (r'<t[^>]*>(.*?)</t>', r'<is>.*?<t[^>]*>(.*?)</t>', r'<v>(.*?)</v>'):
        hit = re.search(pattern, inner, re.S)
        if hit:
            return html.unescape(hit.group(1))
    return ''


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    #  守卫：行号必须真的落在这条技能上，避免设计案插行后改错单元格。
    actual = cell_text(xml, 'G%d' % ROW)
    if actual != EXPECTED_CHAIN:
        raise SystemExit('[fail] 第 %d 行 G 列是 %r，不是 %s' % (ROW, actual, EXPECTED_CHAIN))

    changed = []
    for column, value in CELLS.items():
        ref = '%s%d' % (column, ROW)
        if cell_text(xml, ref) == value:
            continue
        xml = set_cell(xml, ref, value)
        changed.append(ref)
    if not changed:
        print('[skip] 设计案第 %d 行已是目标文本（%d 格）' % (ROW, len(CELLS)))
        return

    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 设计案第 %d 行写入 %d 格：%s；备份 → %s' % (
        ROW, len(changed), ', '.join(changed), backup))


if __name__ == '__main__':
    main()
