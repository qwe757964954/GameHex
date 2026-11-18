# -*- coding: utf-8 -*-
"""第 12 批设计案同步：101303「孢爆箭」+ 101104「孢子凝珠」（2026-11-17）。

本批落地的是两条「冷却到点射一枚会爆开的弹」的技能，代码新增 `splash_shot` / `spore_burst`
车道（见 `ZCSkillRuntime` 的注册注释），配表由 `tools/config/patch_splash_shot_batch12.js`
（JSON）与 `patch_splash_shot_k.py`（K 表 / armySkillLevelUp）写入。

设计案这一边改两行（第 65 行 101303、第 56 行 101104）：
  · O 列（表现描述）—— 补一句弹体复用哪张美术（原 O 只写了爆炸，没写箭）；
  · P 列（落地口径）—— 整段重写：行为键、三档修改器号、参数键与「为什么带 shot 前缀」；
  · S 列（设计状态）—— `【未实现】` → `已实现`。

🔴 P 列原来写的是裸键 `damageRate` / `splashRadius` / `cooldown`。这三个键在
`skillParamJson`（按 `${unitId}:${pvpSkillId}` 合并成一袋）里会和**普攻链路**撞车：
`splashRadius` / `splashDamageRate` 是「爆囊扩散」那套在读的键，裸写等于把这张卡的
每次普攻也改成 90px 溅射 —— 不报错、只是数值莫名变大。所以实际落地一律 `shot` 前缀，
P 列必须跟着改，否则下一个人照 P 列配一遍就会踩回去。

幂等：整格重写成固定文本，内容没变则跳过写盘。
用法：python tools/config/patch_skill_design2_splash_shot.py
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

VISUAL_303 = (
    '【复用】弹体 = 弓兵_通用箭矢（静态），命中点播【普攻爆炸】(31 帧) 并按爆点半径缩放。'
    '箭是直线飞行、不画弧线（孢子凝珠/孢爆箭都不是制导）；爆点美术与溅射半径解耦，三档半径共用一个 prefab。零新增资源。'
)

VISUAL_104 = (
    '【复用】弹体 = 弓兵_通用箭矢（静态），命中点播【普攻爆炸】(31 帧) 缩到半径 90；'
    '减速挂 pvpStatus 的口径（代码按参数动态注册 `__shotslow:<百分点>:<秒>__`，与友军光环同一套做法）。零新增资源。'
)

P_303 = (
    'pvpSkillPlan 101303 三档（modifierId 94013031/32/33，pvpSkillId=30401）：'
    'behaviorKey=splash_shot、skillKind=active_cd、unlockHeroLevel 9/18/27；'
    'skillParamJson={"shotCooldown":12/12/11,"shotDamageRate":0.90/1.10/1.30,"shotRadius":90/110/130}。\n'
    '🔴 参数键必须带 `shot` 前缀：`skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，'
    '而 `splashRadius` / `splashDamageRate` 这两个键**普攻链路也在读**（爆囊扩散那套）—— '
    '裸写会把这张卡的每次普攻也改成 90px 溅射，不报错、只是数值莫名变大。\n'
    '运行期：`ZCSkillTriggerSystem.applySplashShot` 按 `shotCooldown` 到点调 '
    '`ZCAttackResolutionSystem.castSplashShot`，复用 `strikeTargets` 的导弹分支'
    '（弹体飞行 → 命中 `resolveProjectileHit` → `splashRadius` 旁溅）。'
    '旁溅倍率给 **1**（设计写的是「半径内所有敌人造成 90%」= 与直击同额），`splashFalloff` 给 0（不递减）。\n'
    '打不出去（锁定目标跑出普攻射程 / 射程内没人）**不消费 CD**，与副轨 / 光环 / 陷阱同一条口径；'
    '车道独立走 `unit.splashReadyAt`，不推进普攻节拍。'
)

P_104 = (
    'pvpSkillPlan 101104 三档（modifierId 94011041/42/43，pvpSkillId=30261）：'
    'behaviorKey=spore_burst、skillKind=active_cd、unlockHeroLevel 12/24/36；'
    'skillParamJson={"shotCooldown":12,"shotDamageRate":0.60/0.75/0.90,"shotRadius":90,'
    '"shotSlowRatio":15/20/25,"shotSlowSeconds":2/2/3}。\n'
    '运行期与 101303 同一条车道（`splash_shot` / `spore_burst` 共用一个实现，只差「有没有减速参数」）：'
    '`applySplashShot` → `castSplashShot` → `strikeTargets` 导弹分支 → `resolveProjectileHit`。\n'
    '🔴 减速**随弹体在命中时挂**（`projectile.onHitStatusId`），不是出手就挂：'
    '`strikeTargets` 的导弹分支此前没把 `options.statusId` 接上去，本批补了这一行 —— '
    '否则「会飞的技能挂减速」永远不生效（立即结算那一路才读它）。\n'
    '🔴 减速比例按档位变（15/20/25%），`pvpStatus` 里的 `slow` 是定值档装不下，'
    '所以代码按「百分点 + 秒数」生成状态 id 并注册（`splashShotSlowStatusId`，'
    '与友军光环 `__aura:` 同一思路）。`moveSpeedPct` 用百分点口径（-15 = 移速 −15%）。\n'
    '🔴 参数键同样必须带 `shot` 前缀（理由见 101303）。'
)

TARGETS = [
    (65, '101303', {'O': VISUAL_303, 'P': P_303, 'S': '已实现'}),
    (56, '101104', {'O': VISUAL_104, 'P': P_104, 'S': '已实现'}),
]


def shared_strings():
    """共享字符串表；🔴 必须 `html.unescape`（里面是 `&quot;shotRadius&quot;`）。"""
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
        print('[skip] 设计案 101303 / 101104 已是目标文本')
        return
    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 设计案写入 %d 格（101303 / 101104 的 O 表现 + P 落地口径 + S 状态）；备份 → %s' % (changed, backup))


if __name__ == '__main__':
    main()
