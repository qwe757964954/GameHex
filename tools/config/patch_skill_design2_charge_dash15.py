# -*- coding: utf-8 -*-
"""第 15 批设计案同步：101204「菌盾冲锋」/ 102303「冲锋」/ 102703「尖刺冲锋」（2026-11-17）。

本批落地「冲锋」车道，代码新增 `charge_shield` / `legacy_dash` 两条 behaviorKey
（见 `ZCSkillRuntime` 的注册注释），配表由 `tools/config/patch_charge_dash_batch15.js`（JSON）、
`patch_magdi_skill_rows_excel.py`（J 表）、`patch_charge_dash_k.py`（K 表 / armySkillLevelUp）写入。

设计案改三行（第 61 行 101204、第 115 行 102303、第 135 行 102703）：
  · O 列（表现描述）—— 原来写的是「民兵冲锋位移」「轻骑兵_冲锋(静态)」，落地后要写清
    实际接法（锚点取线段中点、路径倍率、护盾表现），否则下一个人找不到那两个 prefab 在哪被用；
  · P 列（落地口径）—— 整段重写：行为键、三档修改器号、参数键、设计案没给的两处取值；
  · S 列（设计状态）—— `【未实现】` / `待规划` → `已实现`。

🔴 P 列原来写的是裸键 `damageRate` / `cooldown` / `vulnerability`：
  · `68027:30241` 的 `skillParamJson`（按 `${unitId}:${pvpSkillId}` 合并成一袋）里**已经有**
    102701 的 `splashRadius` / `splashDamageRate` / `splashFalloff` 与 102702 的
    `lancePierceCount` / `lanceDamageRate` ⇒ 裸 `radius` / `damageRate` 会把普攻溅射与投枪
    一起改掉，**不报错**。
  · `vulnerability` 不是 `statMods` 的字段名，实际字段是 `damageTakenPct`（正值 = 受伤提高）。
  所以实际落地一律 `charge` / `dash` 前缀 + 动态状态，P 列必须跟着改。

幂等：整格重写成固定文本，内容没变则跳过写盘。
用法：python tools/config/patch_skill_design2_charge_dash15.py
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

VISUAL_204 = (
    '【复用】`轻骑兵_冲锋`（contentSize 300×140、根 `_lscale` 1、clip 单帧 loop ⇒ 静态图）'
    '画在**起冲点到落点的中点**：视图没有「沿路径平移」这条通道，只能按锚点定位一次，'
    '而冲锋只有 1 格（≈32 屏上 px），画在路的中间读起来就是「冲过去留下的残影」，时长 0.3s。'
    '路径倍率 0.4（300 × 0.4 = 120 屏上 px ≈ 行程的 2 倍）。'
    '护盾沿用现有 shield 光圈（`applySelfShield` 写 `shieldExpireAt`，到期由 `expireShield` 清零），'
    '不需要新表现。零新增资源。'
)

P_204 = (
    'pvpSkillPlan 101204 三档（modifierId 94012041/42/43，pvpSkillId=30271）：'
    'behaviorKey=charge_shield、skillKind=active_cd、unlockHeroLevel 12/24/36；'
    'skillParamJson={"chargeCooldown":12,"chargeDamageRate":1.0/1.2/1.4,"chargeCells":1,'
    '"chargeHitRadius":40,"chargeShieldRatio":0.12/0.15/0.18,"chargeShieldSeconds":3/3/4}。\n'
    '🔴 参数键必须带 `charge` 前缀：`skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，'
    '`68012:30271` 里已有 101203 的 `mix.critRate`；且 `legacy_dash` 那条用 `dash` 前缀 —— '
    '裸 `cooldown` / `damageRate` 会串车，不报错。\n'
    '运行期：`ZCSkillTriggerSystem.applyChargeShield` 按 `chargeCooldown` 到点 → '
    '朝**当前锁定目标**的方向（无目标退回面朝）走 `chargeCells` 格 → 落点必须落在合法格子上'
    '（逐步缩短 1/0.75/0.5/0.25）→ 推一条 `melee` 残影事件 → `blinkTo` 挪人 → '
    '`ZCAttackResolutionSystem.castChargeDash` 按**点到线段距离 ≤ chargeHitRadius** 收人。\n'
    '🔴 不吃普攻射程闸门：冲锋的意义就是「够不着才冲过去」，用射程挡会退化成「原地打一发」。\n'
    '🔴 命中 0 人也**消费 CD**、护盾也照给（人已经冲出去了，设计原话「并为自己附加护盾」）。\n'
    '车道独立走 `unit.chargeReadyAt`，不推进普攻节拍。'
)

VISUAL_2303 = (
    '【复用】`轻骑兵_冲锋` 画在起冲点到落点的中点（同 101204，路径倍率 0.4、时长 0.3s）。'
    '路径伤害的受击闪白走**通用受击特效**（`damageUnit` 自动按攻击方职业推 `战士受击`），'
    '不需要另叠。III 级落地自保在落点补一条 `刀盾兵_护盾`（contentSize 100×100、17 帧 loop '
    '= 17÷12 = 1.417s，路径倍率 0.55 = 设计原话「缩 55%」）。零新增资源。'
)

P_2303 = (
    'pvpSkillPlan 102303 三档（modifierId 94023031/32/33，pvpSkillId=30216）：'
    'behaviorKey=legacy_dash、skillKind=active_cd、unlockHeroLevel 9/18/27；'
    'skillParamJson={"dashCooldown":12,"dashDamageRate":1.0/1.4/2.2,"dashCells":3,'
    '"dashHitRadius":40,"dashTowardNearest":1,"dashSearchRadius":300,'
    '"dashStunSeconds":1/1.5/2,"dashGuardReducePct":25（仅 III）,"dashGuardSeconds":3（仅 III）}。\n'
    '⚠️ `dashCells` 设计案未给：取 3 格（≈37.8 世界 px）。理由：本条是「向最近敌人冲锋」，'
    '冲程要够得到人；本卡普攻射程 45 表值（≈13 世界 px），3 格是 2.8 个身位。\n'
    '运行期：`ZCSkillTriggerSystem.applyLegacyDash` → 在 `dashSearchRadius` 内找最近敌人 → '
    '朝它冲 `dashCells` 格（但不超过「到目标的距离」，避免冲过头穿到背后）→ '
    '`castChargeDash` 按点到线段距离收人、挂眩晕。**搜索半径内没人 ⇒ 不消费 CD**。\n'
    '🔴 眩晕用参数化硬控 `__stunstrike:<秒>__`（`control: \'stun\'`，与 101403 共用同一签名），'
    '**不要**用 `pvpStatus.stun_1/1_5/2`（值只是巧合相同）。\n'
    '🔴 III 级减伤用 `__dashguard:<百分点>:<秒>__`（`damageTakenPct: -25`）：`pvpStatus` 里'
    '**没有**「受到伤害降低」的通用档（`vulnerability*` 是反方向）。'
    '「冲锋结束后」= 落地那一刻开始计时，与位移同时发生。\n'
    '车道独立走 `unit.dashReadyAt`（与 102703 共用一格：同一条车道），不推进普攻节拍。'
)

VISUAL_2703 = (
    '【复用】`轻骑兵_冲锋` 画在起冲点到落点的中点（同前，路径倍率 0.4、时长 0.3s），'
    '路径伤害的受击闪白走通用受击特效。破甲目标挂状态图标（`__dashvuln:` 由状态系统统一显示），'
    '不需要单独美术。III 级落地护盾沿用现有 shield 光圈（同 101204），不播 `刀盾兵_护盾`'
    '（那个只给 102303 的「非护盾类自保」用）。零新增资源。'
)

P_2703 = (
    'pvpSkillPlan 102703 三档（modifierId 94027031/32/33，pvpSkillId=30241）：'
    'behaviorKey=legacy_dash、skillKind=active_cd、unlockHeroLevel 9/18/27；'
    'skillParamJson={"dashCooldown":12,"dashDamageRate":1.2/1.6/2.2,"dashCells":2,'
    '"dashHitRadius":40,"dashTowardNearest":0,'
    '"dashVulnerablePct":20/35（II/III）,"dashVulnerableSeconds":4/6,'
    '"dashShieldRatio":0.20（仅 III）,"dashShieldSeconds":4（仅 III）}。\n'
    '⚠️ 设计案未给的两处：`dashCells` 取 2 格（≈25.2 世界 px，本条是「向前方冲锋」定长位移，'
    '不找人）；III 级护盾没有时长 ⇒ 取 4 秒（与 101204 III 级同档）。要改只动这两格。\n'
    '运行期：`applyLegacyDash` 的**面朝分支**（`dashTowardNearest = 0`）—— 朝 `unit.facingRadians` '
    '走 `dashCells` 格，前面是空的也照冲（它就是一段位移，不存在「没目标」）。\n'
    '🔴 破甲 / 易伤都是「受到伤害提高」，落到 `damageTakenPct` 的**正值**'
    '（`__dashvuln:<百分点>:<秒>__`）；与 102303 的「自减伤」（同字段负值）方向正好相反，'
    '写反一处就是「自保变成自残」，而且不报错。\n'
    '🔴 参数前缀 `dash` 不能省：`68027:30241` 的袋子里已有 102701 的 `splashRadius` / '
    '`splashDamageRate` / `splashFalloff` 与 102702 的 `lancePierceCount` / `lanceDamageRate` —— '
    '裸 `radius` / `damageRate` 会同时改掉普攻溅射与投枪。\n'
    '车道独立走 `unit.dashReadyAt`（与 102303 共用一格），不推进普攻节拍。'
)

TARGETS = [
    (61, '101204', {'O': VISUAL_204, 'P': P_204, 'S': '已实现'}),
    (115, '102303', {'O': VISUAL_2303, 'P': P_2303, 'S': '已实现'}),
    (135, '102703', {'O': VISUAL_2703, 'P': P_2703, 'S': '已实现'}),
]


def shared_strings():
    """共享字符串表；🔴 必须 `html.unescape`（里面是 `&quot;dashCells&quot;`）。"""
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
        print('[skip] 设计案 101204 / 102303 / 102703 已是目标文本')
        return
    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 设计案写入 %d 格（三条技能的 O 表现 + P 落地口径 + S 状态）；备份 → %s'
          % (changed, backup))


if __name__ == '__main__':
    main()
