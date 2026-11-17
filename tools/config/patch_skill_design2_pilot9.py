# -*- coding: utf-8 -*-
"""第 9 批设计案同步：Q2（101702 按 L 列重建）/ Q3（102001 文案间接版）
+ 两条主动打样（102403 冰山陨落 / 102404 急冻光线）的机制、落地口径与状态列。

三条口径说明（写进表里的是结论，这里给理由）：

· 101702 —— L 列本来就写着「吸血 30/34/38% + 溅射 40/44/48%」，但落表一直是旧
  「爆囊扩散」的攻速 + 12/16/20。本轮按 Q2 裁定整条重建，并把「扩散段按 50% 折算」
  写进 L1 与落地列（这个折算原来只在 N 列的文字里，表里没有承载它的键）。

· 102403 / 102404 —— 原行的 L1 只有 `697` / `700` 两个数字（Q4：文案被历史 skillId 覆盖），
  落地列为空。机制由本批补：
    102403 走 `self_aura` 车道 —— 设计案表现列要求「技能持续过程中有明确的蓝色光圈代表
    技能范围」，`self_aura` 的区域本身就是一条 holdVisual 的持续表现，光圈与判定同源；
    且 `auraReadyAt` 在 `ZC_CD_REDUCE_READY_KEYS` 里 ⇒ 同卡 102401 的冷却回退立刻点亮。
    102404 走 `random_strike` 的 `strikeEvery` —— 设计案「主动-累计普攻 9」正好是这条口径。

· 102001 —— Q3 裁定：两条判据（僵尸阵营 / 战士职业）保持可叠加，但玩家可见文案改成
  并列枚举，不再用斜杠暗示二选一，也不写「同时满足会叠乘」。

幂等：所有格子重写成固定文本，内容没变则跳过写盘。
用法：python tools/config/patch_skill_design2_pilot9.py
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

BLOOD_PLAN = (
    'unit 域 lifestealRate **add** = 0.30 / 0.34 / 0.38'
    '（🔴 该字段没有基础值 ⇒ 只能写 add，写 addRate 会乘 baseValue(0) 恒为 0 且不报错）；'
    'skillParamJson lifestealSpreadRate = 0.5（扩散段折算：主目标全额，溅射 / 命中爆炸按 50%）；'
    '第二机制 splashDamageRate = 0.40 / 0.44 / 0.48 + splashFalloff = 0.3'
    ' + splashRadius = 38 / 46 / 55（设计案未定价，沿用已落地值，逻辑 px）；'
    '混搭尾 mix.attack.addRate = 0.14、mix.attackRange.addRate = 0.20；'
    '子链 191702 damageRate addRate = 0.12（三档同值）。'
    '⚠️ 原落地是旧「爆囊扩散」的 attackSpeed addRate 0.30/0.38/0.46 + 溅射 12/16/20，本轮整条清掉'
)

ICE_PLAN = (
    'behaviorKey = **self_aura**（`castSelfAura`），冷却车道 `auraReadyAt`。'
    'skillParamJson：auraCooldown = 14、auraSeconds = 3、auraInterval = 0.5、'
    'auraRadius = 120（逻辑 px，与 attackRange 同一套数 ⇒ 乘 combatDistanceScale）、'
    'auraDamageRate = 0.55 / 0.65 / 0.75、auraSlowRatio = 0.5'
    '（🔴 本轮新开的键，缺省 0 ⇒ 无尘禁土 / 喷射火焰逐字不变）。'
    '单跳的暴击 / 克制按开光环那一刻的目标算一次，之后每波同值（区域只存一个 damage 标量）。'
    'pvpSkillId 沿用本卡普攻 30671 ⇒ 参数袋键 = `68024:30671`，与 102401 / 102402 同一袋。'
    '🔴 **statusId 必须留空**：那是整卡共用的一个槽（mergeSkillPlanIntoRuntime 按 unitId:pvpSkillId 合并），'
    '写了它本卡普攻每一发都会顺手挂上同一个状态'
)

RAY_PLAN = (
    'behaviorKey = **random_strike**，触发口径走 `strikeEvery` = 9（累计普攻）。'
    '🔴 不用 `strikeCooldown` ⇒ 这条主动**没有** `*ReadyAt`，因此**不吃** 102401 的冷却回退 ——'
    '这是有意的，与设计案「不作用于普攻本身」一致。'
    'skillParamJson：strikeEvery = 9、strikeCount = 3、strikeRadius = 260（逻辑 px，且被普攻射程封顶）、'
    'strikeDamageRate = 0.8 / 0.95 / 1.1、strikeNearest = 1、'
    'strikeAppliesStatus = 1（🔴 本轮新开的闸门，缺省 0 ⇒ 既有 random_strike 逐字不变）。'
    '命中挂的状态写死 `numb`（软控：只禁攻击、移速 −50%），'
    '🔴 **不要**取 runtime.statusId（整卡共用槽 ⇒ 会让本卡普攻每发都麻痹）'
)

#  行号 → {列: 文本}。行号守卫在 main 里按 G 列（skillId）核对。
PLANS = {
    # ── Q2：101702 噬血蔓延 ──
    84: {
        'H': '噬血蔓延',
        'K': 'L1（兵种 6 级）：普攻造成伤害的 30% 转化为自身生命（扩散段按 50% 折算）；'
             '命中对周围造成 40% 溅射伤害（同一爆点第 2 个目标起每次 ×0.7）；'
             '攻击提高 14%，伤害提高 12%，攻击范围提高 20%',
        'L': 'L2（兵种 16 级）：转化比例提高到 34%，溅射提高到 44%',
        'M': 'L3（兵种 26 级）：转化比例提高到 38%，溅射提高到 48%',
        'P': BLOOD_PLAN,
        'S': '【已实现】',
    },
    # ── Q3：102001 异种猎杀协议（只改玩家可见文案） ──
    98: {
        'K': 'L1（兵种 3 级）：对僵尸阵营、战士职业的目标伤害提高15%；攻击提高 9%',
        'L': 'L2（兵种 10 级）：对僵尸阵营、战士职业的目标伤害提高20%；攻击提高 9%',
        'M': 'L3（兵种 22 级）：对僵尸阵营、战士职业的目标伤害提高25%；攻击提高 9%',
    },
    # ── 打样一：102403 冰山陨落 ──
    120: {
        'H': '冰山陨落',
        'K': 'L1（兵种 9 级）：冷却 14 秒，在自身位置引爆冰山，张开半径 120 的冰域，'
             '持续 3 秒、每 0.5 秒对范围内敌人造成 55% 伤害并使其移速降低 50%',
        'L': 'L2（兵种 18 级）：单跳伤害提高到 65%，其余不变',
        'M': 'L3（兵种 27 级）：单跳伤害提高到 75%，其余不变',
        'N': '法师高级主动。**第一条机制**：冷却到点在**自身位置**炸开一片冰域，每 0.5 秒结算一次范围伤害。'
             '**第二条机制**：冰域内的敌人移速降低 50%（软控，不剥夺攻击）。'
             '「陨落」的观感由落地那一击承担（冰锥自天而降），冰域本身是持续的蓝色光圈 ——'
             '设计案表现列要求「技能持续过程中需要有明确的蓝色光圈代表技能范围」，'
             '光圈就是 `auraRadius`，与判定半径同源，不需要另做一层提示。\n'
             '【本轮改动】原行只有触发参数 `697`（Q4：文案被历史 skillId 覆盖），机制由本批补。',
        'O': '【复用】冰锥复用【冰法师的冰锥】特效、旋转 -90°，落在施法者所在位置；'
             '蓝色光圈 = `self_aura` 的区域本身（`auraRadius` 与判定半径同源，改一个数两处一起动）。'
             '区域的持有时长 = auraSeconds（3 秒），表现事件的 durationSeconds 必须 ≥ 它',
        'P': ICE_PLAN,
        'S': '【已实现】',
    },
    # ── 打样二：102404 急冻光线 ──
    121: {
        'H': '急冻光线',
        'K': 'L1（兵种 12 级）：累计 9 次普攻，向最近的 3 个敌人各射出一道急冻光线，'
             '造成 80% 伤害并使其麻痹 3 秒（只禁攻击、移速 −50%）',
        'L': 'L2（兵种 24 级）：单道伤害提高到 95%，其余不变',
        'M': 'L3（兵种 36 级）：单道伤害提高到 110%，其余不变',
        'N': '法师高级主动。**第一条机制**：累计 N 次普攻开一次火 —— 与冷却型主动的区别在于它没有 CD 车道，'
             '攻速越高开火越频繁，这是设计上刻意的等价收益。**第二条机制**：三道光线优先打最近的三个目标，'
             '命中挂麻痹（软控）而不是硬控，与冰系「控住但不白给」的平衡口径一致。\n'
             '【本轮改动】原行只有触发参数 `700`（Q4：文案被历史 skillId 覆盖），机制由本批补。',
        'O': '【待美术】三道光线共用冰系弹体（复用【冰法师的冰锥】拉长）；落点暂复用普攻冰弹特效。'
             '🔴 不要走 `zcMissileFxOf` 的导弹分支 —— 那是弧线追踪，这里是直线',
        'P': RAY_PLAN,
        'S': '【已实现】',
    },
}

EXPECTED_CHAIN = {
    84: '101702',
    98: '102001',
    120: '102403',
    121: '102404',
}


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
    writes = {}
    for row, cells in PLANS.items():
        #  守卫：行号必须真的落在这条技能上，避免设计案插行后改错单元格。
        ref_chain = 'G%d' % row
        actual = cell_text(xml, ref_chain)
        if actual != EXPECTED_CHAIN[row]:
            raise SystemExit('[fail] 行 %d 的 G 列是 %r，不是 %s' % (row, actual, EXPECTED_CHAIN[row]))
        for column, value in cells.items():
            writes['%s%d' % (column, row)] = value

    changed = 0
    for ref, value in sorted(writes.items()):
        if cell_text(xml, ref) == value:
            continue
        xml = set_cell(xml, ref, value)
        changed += 1
    if not changed:
        print('[skip] 设计案第 9 批已是目标文本（%d 格）' % len(writes))
        return

    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 设计案第 9 批写入 %d 格（共检查 %d 格）；备份 → %s' % (
        changed, len(writes), backup))


if __name__ == '__main__':
    main()
