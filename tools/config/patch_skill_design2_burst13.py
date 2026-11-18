# -*- coding: utf-8 -*-
"""第 13 批设计案同步：101504「菌毯爆发」+ 101804「菌核爆裂」（2026-11-17）。

本批落地的是两条「以自身为圆心爆一次」的技能，代码新增 `burst_aura` / `burst_knockback`
车道（见 `ZCSkillRuntime` 的注册注释），配表由 `tools/config/patch_burst_batch13.js`（JSON）、
`patch_burst_k.py`（K 表 / armySkillLevelUp）与 `patch_magdi_skill_rows_excel.py`（J 表）写入。

设计案改两行（第 76 行 101504、第 91 行 101804）：
  · O 列（表现描述）—— 补一句「爆点尺寸按判定半径反算」的口径，原 O 只写了「放大到半径 N」；
  · P 列（落地口径）—— 整段重写：行为键、三档修改器号、参数键与「为什么带 burst 前缀」；
  · S 列（设计状态）—— `【未实现】` → `已实现`。

🔴 P 列原来写的是裸键 `damageRate` / `radius` / `cooldown`。这几个键在
`skillParamJson`（按 `${unitId}:${pvpSkillId}` 合并成一袋）里会和**普攻链路**撞车：
68015 的另一条技能「爆囊扩散」101501 已经把 `splashRadius` / `splashDamageRate` 写进同一个袋子，
裸写等于把这张卡的普攻溅射改成 150px —— 不报错、只是普攻莫名变成大范围溅射。
所以实际落地一律 `burst` 前缀，P 列必须跟着改，否则下一个人照 P 列配一遍就会踩回去。

🔴 101504 的 P 列原来写「III 级减伤走 pvpStatus 现有 damageReduce 档」—— **那张表里没有这一档**
（`vulnerability` 那几条是「受到伤害提高」，方向相反）。实际做法是动态注册
`__burstguard:<百分点>:<秒>__`（与低血护体 `__lowhp:`、孢子凝珠 `__shotslow:` 同一套）。

幂等：整格重写成固定文本，内容没变则跳过写盘。
用法：python tools/config/patch_skill_design2_burst13.py
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

VISUAL_504 = (
    '【复用】爆点 = 普攻爆炸(31 帧)，尺寸按判定半径反算（屏上直径 = 逻辑 150 × 2 × 0.76875 = 230.6px '
    '⇒ 宿主倍率 0.818）；护盾沿用现有 shield 光圈，不加新 prefab。零新增资源。'
)

VISUAL_804 = (
    '【复用】爆点 = 普攻爆炸(31 帧)，尺寸按判定半径反算（屏上直径 = 逻辑 120 × 2 × 0.76875 = 184.5px '
    '⇒ 宿主倍率 0.654）；击退位移走现有 `applyKnockback`，没有独立特效。零新增资源。'
)

P_504 = (
    'pvpSkillPlan 101504 三档（modifierId 94015041/42/43，pvpSkillId=30241）：'
    'behaviorKey=burst_aura、skillKind=active_cd、unlockHeroLevel 12/24/36；'
    'skillParamJson={"burstCooldown":16,"burstDamageRate":1.6/1.9/2.3,"burstRadius":150,'
    '"burstShieldRatio":0.12/0.15/0.18,"burstShieldSeconds":4,"burstShieldReducePct":15（仅 III）}。\n'
    '🔴 参数键必须带 `burst` 前缀：`skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，'
    '而 68015 的另一条技能「爆囊扩散」101501 **已经在同一个袋子里写了 `splashRadius` / `splashDamageRate`** —— '
    '裸写会把这张卡的普攻溅射半径从 38 改成 150，不报错、只是普攻莫名变成大范围溅射。\n'
    '运行期：`ZCSkillTriggerSystem.applyBurstSkill` 按 `burstCooldown` 到点调 '
    '`ZCAttackResolutionSystem.castBurstSkill` —— 全向收集「半径内敌方单位」→ 均等伤害 → '
    '`applySelfShield` 套盾（取最大值 + 写 `shieldExpireAt`，到期由 `expireShield` 清零）。\n'
    '🔴 不吃普攻射程闸门：判据是「爆发半径 150 内有没有人」，命中 0 人即视为没放、'
    '**不消费 CD**；用普攻射程挡会变成「一群怪在 140px 处围着、战士因为普攻打不到而不放大招」。\n'
    '🔴 III 级的「护盾期间受到伤害降低 15%」：`pvpStatus` **没有**通用减伤定值档，'
    '代码按「百分点 + 秒数」动态注册 `__burstguard:15:4__`（`damageTakenPct: -15`，'
    '与低血护体 `__lowhp:` 同一套做法）。减伤与护盾同寿（4 秒），护盾被打破不会提前揭掉减伤。\n'
    '车道独立走 `unit.burstReadyAt`，不推进普攻节拍。'
)

P_804 = (
    'pvpSkillPlan 101804 三档（modifierId 94018041/42/43，pvpSkillId=30667）：'
    'behaviorKey=burst_knockback、skillKind=active_cd、unlockHeroLevel 12/24/36；'
    'skillParamJson={"burstCooldown":14,"burstDamageRate":1.4/1.7/2.1,"burstRadius":120,'
    '"burstKnockbackCells":1/1/2}。\n'
    '运行期与 101504 同一条车道（`burst_aura` / `burst_knockback` 共用一个 `castBurstSkill`，'
    '只差「爆完给自己加什么」）：命中后对**存活**目标调 `applyKnockback`，'
    '格数 × `HEX_GRID_LOGICAL_ROW_STEP` 换算成逻辑坐标，再由 `applyLegacyKnockback` 乘 '
    '`combatDistanceScale` —— 与扇形（`castFanSkill`）的击退完全同源，不新建实现。\n'
    '🔴 参数键同样必须带 `burst` 前缀（理由见 101504）。\n'
    '🔴 两条行为键共用 `unit.burstReadyAt` 这一格：机制是同一件事（自心圆一次性爆发），'
    '而不是「可能同卡并存的两条不同车道」（那才需要各占一格，如 `splashReadyAt` / `burstReadyAt`）。'
)

TARGETS = [
    (76, '101504', {'O': VISUAL_504, 'P': P_504, 'S': '已实现'}),
    (91, '101804', {'O': VISUAL_804, 'P': P_804, 'S': '已实现'}),
]


def shared_strings():
    """共享字符串表；🔴 必须 `html.unescape`（里面是 `&quot;burstRadius&quot;`）。"""
    text = read_zip_rows(XLSX, 'xl/sharedStrings.xml')
    return [html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', item, re.S)))
            for item in re.findall(r'<si>(.*?)</si>', text, re.S)]


def cell_text(xml, ref, strings):
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not match:
        return None
    inner = match.group(1) or ''
    if 't="s"' in match.group(0):
        index = re.search(r'<v>(\d+)</v>', inner)
        return strings[int(index.group(1))] if index else ''
    for pattern in (r'<t[^>]*>(.*?)</t>', r'<is>.*?<t[^>]*>(.*?)</t>', r'<v>(.*?)</v>'):
        hit = re.search(pattern, inner, re.S)
        if hit:
            return html.unescape(hit.group(1))
    return ''


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    strings = shared_strings()
    changed = 0
    for row, chain, cells in TARGETS:
        actual = cell_text(xml, 'G%d' % row, strings)
        if actual != chain:
            raise SystemExit('[fail] 行 %d 的 G 列是 %r，不是 %s（设计案插行了？）' % (row, actual, chain))
        for column, value in sorted(cells.items()):
            ref = '%s%d' % (column, row)
            if cell_text(xml, ref, strings) == value:
                continue
            xml = set_cell(xml, ref, value)
            changed += 1
    if not changed:
        print('[skip] 设计案 101504 / 101804 已是目标文本')
        return
    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 设计案写入 %d 格（101504 / 101804 的 O 表现 + P 落地口径 + S 状态）；备份 → %s'
          % (changed, backup))


if __name__ == '__main__':
    main()
