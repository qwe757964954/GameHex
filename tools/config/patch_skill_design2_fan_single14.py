# -*- coding: utf-8 -*-
"""第 14 批设计案同步：101503「菌丝绞杀」+ 101403「菌丝突刺」（2026-11-17）。

本批落地两条「近身型主动」，代码新增 `fan_slow` / `single_strike` 车道
（见 `ZCSkillRuntime` 的注册注释），配表由 `tools/config/patch_fan_single_batch14.js`（JSON）、
`patch_fan_single_k.py`（K 表 / armySkillLevelUp）与 `patch_magdi_skill_rows_excel.py`（J 表）写入。

设计案改两行（第 75 行 101503、第 70 行 101403）：
  · O 列（表现描述）—— 补一句「扇形怎么铺」/「撕裂播多久」，原 O 写得笼统；
  · P 列（落地口径）—— 整段重写：行为键、三档修改器号、参数键与「为什么带 fan / single 前缀」；
  · S 列（设计状态）—— `【未实现】` → `已实现`。

🔴 P 列原来写的是裸键 `damageRate` / `radius` / `cooldown` / `control=stun`：
  · 68015 的 `skillParamJson`（按 `${unitId}:${pvpSkillId}` 合并成一袋）里**已经有**
    101501 的 `splashRadius` / `splashDamageRate` 和 101504 的 `burstRadius` / `burstDamageRate`
    ⇒ 裸 `radius` / `damageRate` 会把普攻溅射与爆发半径一起改掉，**不报错**。
  · `control=stun` 写不进参数袋（值域是 number），只能代码按「秒数」动态注册状态。
  所以实际落地一律 `fan` / `single` 前缀 + 动态状态，P 列必须跟着改。

幂等：整格重写成固定文本，内容没变则跳过写盘。
用法：python tools/config/patch_skill_design2_fan_single14.py
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

VISUAL_503 = (
    '【复用】扇形没有现成美术 ⇒ 铺 3 发普攻爆炸(31 帧)在扇形里：'
    '每发半径 = 扇形半径 × 0.5、离施法者 = 半径 × 0.6、相邻角度 = 半角 × 0.6（−0.6H / 0 / +0.6H），'
    '尺寸按 `zcBurstEffectScale` 反算（屏上直径 = 逻辑直径 × 0.76875 ÷ prefab 屏上宽 282）。'
    '减速沿用现有状态系统（代码按参数动态注册 `__fanslow:<百分点>:<秒>__`）。零新增资源。'
)

VISUAL_403 = (
    '【复用】长戟兵_撕裂（8 帧 @ sample 12 = 0.667s，此前无技能在用），贴在**目标**坐标播；'
    '眩晕用现有控制表现（`control: stun` 走单位受控闸门）。零新增序列帧。'
)

P_503 = (
    'pvpSkillPlan 101503 三档（modifierId 94015031/32/33，pvpSkillId=30241）：'
    'behaviorKey=fan_slow、skillKind=active_cd、unlockHeroLevel 9/18/27；'
    'skillParamJson={"fanCooldown":14/13/12,"fanDamageRate":1.3/1.6/2.0,"fanRadius":150,"fanAngle":120,'
    '"fanMaxTargets":4/5/6,"fanSlowRatio":40/45/50,"fanSlowSeconds":2}。\n'
    '🔴 参数键必须带 `fan` 前缀：`skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，'
    '68015 这张卡的袋子里已经有 101501 的 `splashRadius` 与 101504 的 `burstRadius` —— '
    '裸 `radius` / `damageRate` 会同时改掉普攻溅射与爆发半径，不报错。\n'
    '运行期：`ZCSkillTriggerSystem.applyFanSweep` 按 `fanCooldown` 到点调 '
    '`ZCAttackResolutionSystem.castFanSweep` —— 朝当前锁定目标（无目标时退回面朝方向）、'
    '半径 `fanRadius` 表值、总张角 `fanAngle`、扇形内按距离取最近的 `fanMaxTargets` 个。\n'
    '为什么不复用副轨扇形 `castFanSkill`：那条半径是「普攻射程 × `secondaryRadiusScale`」、'
    '**没有人数上限**、还带击退参数 —— 与本条的「表值 150 / 最多 N 人」对不上。\n'
    '🔴 不吃普攻射程闸门：判据是「扇形半径内有没有人」，命中 0 人即视为没放、**不消费 CD**；'
    '表值 150 大于近战普攻射程，用射程挡会漏掉「怪就在扇形里却因为普攻够不着而不放」。\n'
    '🔴 减速按档位变（40/45/50%），`pvpStatus` 定值档装不下 ⇒ 动态注册 '
    '`__fanslow:<百分点>:<秒>__`（`moveSpeedPct: -40`，百分点口径）。\n'
    '车道独立走 `unit.fanReadyAt`，不推进普攻节拍。'
)

P_403 = (
    'pvpSkillPlan 101403 三档（modifierId 94014031/32/33，pvpSkillId=30216）：'
    'behaviorKey=single_strike、skillKind=active_cd、unlockHeroLevel 9/18/27；'
    'skillParamJson={"singleCooldown":12/12/11,"singleDamageRate":1.5/1.8/2.2,'
    '"singleSearchRadius":300,"singleStopDistance":30,"singleHitRadius":40,'
    '"singleStunSeconds":1/1.5/2,"singleHastePct":30（仅 III）,"singleHasteSeconds":4}。\n'
    '⚠️ `singleSearchRadius` 设计案未给：取 300 表值（≈90 世界 px ≈ 2.5 格）。'
    '本卡普攻射程只有 45 表值（约 13 世界 px），所以这是实打实的「够不着才扑过去」；'
    '要改只动这一格，代码不写死。\n'
    '运行期：`ZCSkillTriggerSystem.applySingleStrike`（与 `applyBlinkStrike` 同侧 —— 要挪人，'
    '而 `blinkTo` 只在触发侧接线）→ 找 `singleSearchRadius` 内最近的敌人 → 落到它身边 '
    '`singleStopDistance` → 在**目标坐标**推一条 `melee` 表现事件（`长戟兵_撕裂`）→ '
    '`context.strike` 打一发（半径 `singleHitRadius`、命中挂眩晕）。\n'
    '🔴 眩晕是**硬控**：状态 id 按秒数动态生成 `__stunstrike:<秒>__`、定义里 `control: \'stun\'`，'
    '走单位受控闸门整段停手。**不要**用 `pvpStatus` 里那几条 `stun_1/1_5/2` —— 它们只是值巧合相同，'
    '改配表时长不会跟着变；也**不要**拿 `numb`（软控，2026-11-17 已按设计删除）。\n'
    '🔴 III 级攻速增益挂在**命中之后**（`strike` 返回值 > 0 才给）：空放不给，'
    '所以不能塞进「施法即加」的 `self_cast` 车道。`attackIntervalPct: 30` = 攻速 +30%。\n'
    '🔴 参数前缀 `single` 同样不能省：68014 的袋子里已有 101401 的 `comboDamage`。\n'
    '车道独立走 `unit.singleReadyAt`，不推进普攻节拍；搜索半径内没人 ⇒ **不消费 CD**。'
)

TARGETS = [
    (75, '101503', {'O': VISUAL_503, 'P': P_503, 'S': '已实现'}),
    (70, '101403', {'O': VISUAL_403, 'P': P_403, 'S': '已实现'}),
]


def shared_strings():
    """共享字符串表；🔴 必须 `html.unescape`（里面是 `&quot;fanRadius&quot;`）。"""
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
        print('[skip] 设计案 101503 / 101403 已是目标文本')
        return
    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 设计案写入 %d 格（101503 / 101403 的 O 表现 + P 落地口径 + S 状态）；备份 → %s'
          % (changed, backup))


if __name__ == '__main__':
    main()
