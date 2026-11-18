# -*- coding: utf-8 -*-
"""第 16 批设计案同步：101303「孢爆箭」（改口径）/ 101304「连射导弹」（新落地，2026-11-18）。

设计员这次只改了 **N 列（技能详述）**，并且把 101303 / 101304 的 K/L/M（L1/L2/L3）三列清空了
—— 三档数值只能从 N 列那句话里拆：101303 = 150/180/220%，101304 = 160/200/220%。
所以本脚本补三列：
  · O 列（表现描述）—— 写清实际接了哪几个 prefab、以及「尺寸必须与三叶小丑同步」这类
    下一个人一定会踩的约束；
  · P 列（落地口径）—— 行为键、三档修改器号、参数键、设计没给的两处取值；
  · S 列（设计状态）—— `【未实现】` / `已实现` → `已实现`。

🔴 P 列必须点名「参数前缀」：
  `68013:30401` 这一袋里住着四条技能（101301 的 `bulletFalloff`、101302 的 `mix.*`、
  101303 的 `wind*`、101304 的 `barrage*`），裸 `cooldown` / `damageRate` / `radius`
  会把别条车道一起改掉，**不报错**。

幂等：整格重写成固定文本，内容没变则跳过写盘。
用法：python tools/config/patch_skill_design2_wind_barrage16.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import find_row_by, read_zip_rows, set_cell, write_zip  # noqa: E402

ROOT = 'D:/Alan/占城玩法/策划文档/战斗系统'
XLSX = os.path.join(ROOT, '技能设计案2.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/config_backup'

VISUAL_303 = (
    '【复用】风弹 = `三叶小丑_普攻`（9 帧序列动画，已登记 +30px 发射高度补偿）；'
    '飓风 = `风法师_龙卷风`（三叶小丑的强化那一击，即设计说的「三叶小丑的飓风」）。\n'
    '设计原话要「**蓝色**的风弹」，但工程里只有绿色的 `风法师_绿风` 与这份风系弹体 ⇒ '
    '2026-11-18 用户裁定先复用这一份；美术出蓝色风弹后只改 `ZCWindBarrageFx` 的一行常量'
    '（两套资源清单都从那里读，不会漏加载）。\n'
    '🔴 飓风尺寸必须与三叶小丑那条**同步**：`pvpSkill` 36251 的 `areaRadius = 30`（逻辑 px）'
    '与 `ZCCombatEffectScale` 的 `0.5` 是一对，只改一边就是「看着缩了、判定没缩」。'
    '本技能直接用 30，两处都不新开倍率。零新增资源。'
)

P_303 = (
    'pvpSkillPlan 101303 三档（modifierId 94013031/32/33，pvpSkillId=30401）：'
    'behaviorKey=wind_bolt、skillKind=active_cd、unlockHeroLevel 9/18/27；'
    'skillParamJson={"windCooldown":12,"windDamageRate":1.5/1.8/2.2,"windSpeed":70,'
    '"windLifeSeconds":4,"windZoneRadius":30,"windZoneSeconds":3,'
    '"windZoneDamageRate":0.9/1.08/1.32}。\n'
    '🔴 参数键必须带 `wind` 前缀：`68013:30401` 这一袋里已住着 101301 的 `bulletFalloff`、'
    '101302 的 `mix.*` 与 101304 的 `barrage*` —— 裸 `cooldown` / `damageRate` / `radius` '
    '会串到别条车道，**不报错**。上一版那三个 `shot*` 键本批已整袋删掉。\n'
    '运行期：`ZCSkillTriggerSystem.applyWindShot` 按 `windCooldown` 到点（并过普攻射程闸门）→ '
    '`ZCAttackResolutionSystem.castWindBolt` 朝锁定目标发一枚 velocity = 70×0.3 世界 px/s、'
    '寿命 **4 秒**的弹（不是「飞到目标」的距离：风弹飘到哪算哪）→ 命中走 `resolveProjectileHit` '
    '结算单体 150/180/220%，并在命中点压一块半径 30×0.3 的 `groundZones`：'
    '`hitOncePerUnit`（同一敌人只挨一次）、存活 3 秒、`wavesLeft = 3 ÷ 0.05`（每逻辑步判一次接触）、'
    '`holdVisual` 整段只推一条表现事件（否则每 0.05 秒刷一层残影）。\n'
    '⚠️ 三档数值取自 N 列「150%/180/220%」；**飓风那次伤害设计没给**，2026-11-18 裁定取风弹的 '
    '60%（90/108/132%）。\n'
    '⚠️ 「70px 的移动速度」按项目口径理解为**表值逻辑 px/s**（世界 21px/s ⇒ 4 秒最远约 84 世界 px）。\n'
    '⚠️ 上一版（第 12 批）是「命中点半径 90/110/130 均等溅射」，本批口径完全换了，'
    '`splash_shot` 那条车道本身保留（别的卡仍可能用），只是 68013 不再走它。'
)

VISUAL_304 = (
    '【复用】飞行段 = `镭射飞龙_导弹技能`、落地爆炸 = `镭射飞龙_导弹技能命中`'
    '（与镭射飞龙「追踪导弹」同一对 prefab，设计 O 列原话「复用镭射飞龙的【追踪导弹】」）。\n'
    '原地站定：整轮锁在原地（`castHoldUntil = 间隔 ×(颗数−1) + 0.5` = 1.3 秒），'
    '与设计「站在原地不动」对齐。\n'
    '🔴 那一份爆炸被镭射飞龙按「半径 80 逻辑 px」标定过（路径倍率 123/202），'
    '本技能半径 180 ⇒ 只能走事件级 `effectScale = 180/80 = 2.25`；'
    '改全局路径倍率会把镭射飞龙的爆炸一起放大。零新增资源。\n'
    '⚠️ 这颗弹**不做弧线**（`arcOffset` 只给了个很小的值）：设计只说「抛物线」，'
    '而视图的弧线是「中段横向偏移」，三颗都砸同一片区域时大弧线会看着像乱飞。'
)

P_304 = (
    'pvpSkillPlan 101304 三档（modifierId 94013041/42/43，pvpSkillId=30401）：'
    'behaviorKey=missile_barrage、skillKind=active_attack、triggerEvent=active、'
    'unlockHeroLevel 12/24/36；'
    'skillParamJson={"barrageEvery":10,"barrageCount":3,"barrageInterval":0.4,'
    '"barrageDamageRate":1.6/2.0/2.2,"barrageRadius":180}。\n'
    '🔴 参数键带 `barrage` 前缀（理由同 101303）。\n'
    '运行期：`ZCSkillTriggerSystem.applyMissileBarrage` 按 `completedAttackCount` 每满 10 次普攻'
    '发一轮（**没有 CD**，J 列「主动-累计普攻 10」）→ 首颗立刻发，后两颗由 '
    '`barrageShotsLeft` / `barrageNextAt` 每 0.4 秒补发一颗 → `castBarrageShot` 逐颗重算落点'
    '（目标周围半径 15 逻辑 px 内**面积均匀**取点）→ 弹体 `ignoresMidAirCollision`'
    '（整段不扫掠：不打中途的敌人、也不被墙/建筑拦）+ `explodeOnArrival` → '
    '飞满 `durationSeconds` 那一拍由 `ZCAttackResolutionSystem.resolveProjectileArrival` '
    '在落点对半径 180 内**所有**敌人各结算一次（逐目标再乘克制）。\n'
    '🔴 为什么不能把弹体 `startedAt` 排到未来：快照校验要求 `startedAt <= elapsedSeconds`，'
    '排 0.4 秒后出场的弹体过不了校验 ⇒ 节拍只能由触发系统的 shotsLeft/nextAt 那一套排。\n'
    '⚠️ 「30px 为直径」按半径 15 逻辑 px 落地（世界 4.5px）；「180px 的圆形范围」按半径 180 逻辑 px'
    '（世界 54px）。\n'
    '⚠️ 一轮里若目标全没了，剩下那几颗**照样消耗名额**（一轮是「已经承诺出去」的），'
    '否则队列永远排不空、下一次触发被堵住。'
)

TARGETS = [
    ('101303', VISUAL_303, P_303),
    ('101304', VISUAL_304, P_304),
]

STATUS_DONE = '已实现'


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    before = xml
    for skill_id, visual, params in TARGETS:
        row = find_row_by(xml, 'G', skill_id)
        if row is None:
            raise SystemExit('[fail] 设计案里找不到技能 %s（G 列）' % skill_id)
        for column, value in (('O', visual), ('P', params), ('S', STATUS_DONE)):
            xml = set_cell(xml, '%s%d' % (column, row), value)
        print('[ok] 第 %d 行 %s：O/P/S 已写' % (row, skill_id))
    if xml == before:
        print('[skip] 设计案 O/P/S 已是目标值')
        return
    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 备份 → %s' % backup)


if __name__ == '__main__':
    main()
