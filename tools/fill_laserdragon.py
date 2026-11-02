# -*- coding: utf-8 -*-
"""镭射飞龙 68010 · 补齐设计案缺失的描述与实施口径。"""
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill

SRC = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
H2 = Font(name='微软雅黑', size=11, bold=True, color='FF2E5C8A')
TH = Font(name='微软雅黑', size=10, bold=True)
BODY = Font(name='微软雅黑', size=10)
HEAD_FILL = PatternFill('solid', fgColor='FFDCE6F1')

wb = openpyxl.load_workbook(SRC)
ws = wb['技能设计案 (2)']

# ------------------------------------------------------------------ 行 47 普攻
r = 47
assert str(ws.cell(r, 7).value) == '201001'
ws.cell(r, 8).value = '镭射能量线'
ws.cell(r, 14).value = (
    '从口部射出一条细长的镭射能量线，弹速 500，命中结算 1 次伤害。'
    '能量线是单体判定：不带穿透、不带溅射，能打多远完全由 550 的攻击距离决定。'
    '节拍 1.8s 一次（pvpCard.unitAttackInterval），出手 0.667s、命中点 0.345s，'
    '所以它在 550 射程里属于「慢而稳」的一档，靠单发高伤，不靠频率。'
)
ws.cell(r, 15).value = (
    '【P10 复用·占位】风法师_绿风(8帧) 青色月牙约 60px，沿弹道平移；命中 受击(法师)。'
    '该资源本形是月牙风刃，与「镭射能量线」的细光束形态并不一致，本轮按「不改美术」先占位；'
    '正式资源到位后建议换成 1 张静态青色光束（拉伸即可，不需要序列帧），替换时只改 effectPrefabPath。'
)
ws.cell(r, 16).value = (
    '普攻伤害 = pvpCard.unitAttack（120），本行只定义形态与节拍。'
    '线上 pvpCard.unitSkillId 当前指向 30251「风法师普攻」整行（含 cooldown=15 / trigger=every_seconds / '
    'empoweredSkillId=36251 风法师龙卷风），需要换成 68010 专属行，见【技能实现改动明细】。'
)

# ------------------------------------------------------------------ 行 48/49 被动：补实施细节
assert str(ws.cell(48, 7).value) == '101001'
ws.cell(48, 14).value = (
    '把孢子囊并联成弹巢，一次出手泼出多道弹道，用覆盖面换单体。'
    '它与本卡普攻是同一行技能的两个参数：bulletNum 决定发数，bulletAngle 决定扇形张开的角度。'
    '只加发数不给角度，三发会叠在同一条线上、后两发空放，所以两者必须成对配置。'
    '【孢子弹幕】弹数 1 → 2；攻速 14% → 26%；伤害 8% → 16%；满级价值约 154 VP，本档预算 150 VP。'
)
ws.cell(48, 16).value = (
    'skill 域 skillParamJson={"bulletNum":1/1/2} + unit 域 bulletAngle add=12（3 发共 12° 扇形，每发偏 6°）'
    ' + unit 域 attackSpeed addRate=0.14/0.20/0.26 + unit 域 damageRate addRate=0.08/0.12/0.16；'
    'skill 域参数按「同 unitId:pvpSkillId 参数叠加」合并进 30251 那一行'
)

assert str(ws.cell(49, 7).value) == '101002'
ws.cell(49, 14).value = (
    '弹头在触敌瞬间裂变助推，在原有伤害之外再补一段与面板无关的固定倍率。'
    'impactDamageRate 只作用于命中的那一击，不改变面板攻击、也不额外触发状态与处决，'
    '所以它是纯加法而不是乘法：和「孢子弹幕」的多发叠加时，每一发都各自吃一遍这个倍率。'
    '【裂变凿击】附加伤害 50% → 78%；攻速 14% → 26%；射程 8% → 16%；满级价值约 153 VP，本档预算 150 VP。'
)
ws.cell(49, 16).value = (
    'skill 域 skillParamJson={"impactDamageRate":0.50/0.64/0.78}'
    ' + unit 域 attackSpeed addRate=0.14/0.20/0.26 + unit 域 attackRange addRate=0.08/0.12/0.16；'
    '同样合并进 30251 那一行，与 101001 的参数互不覆盖'
)

# ------------------------------------------------------------------ 行 50 追踪导弹：补 K/L/M/N/O/P
assert str(ws.cell(50, 7).value) == '101003'
ws.cell(50, 8).value = '追踪导弹'
ws.cell(50, 11).value = ('L1（兵种 0 级）：冷却 12s，向最近的 3 个敌方单位各发射 1 枚弧线追踪导弹，'
                         '触碰造成 300% 伤害，并在落点产生半径 100px 的爆炸，对范围内敌人造成 100% 伤害')
ws.cell(50, 12).value = ('L2（兵种 16 级）：冷却 12s，发射 4 枚，触碰造成 500% 伤害，'
                         '落点爆炸半径 100px、造成 200% 伤害')
ws.cell(50, 13).value = ('L3（兵种 23 级）：冷却 12s，发射 5 枚，触碰造成 800% 伤害，'
                         '落点爆炸半径 100px、造成 300% 伤害；导弹飞行速度提高 20%')
ws.cell(50, 14).value = (
    '冷却 12s 的追踪型主动：一次泼出 3/4/5 枚弧线弹，每枚独立锁定一个敌方单位，'
    '飞行途中持续修正朝向，不会因为目标走位而脱靶（这一点和直线弹道是本质区别）。'
    '命中结算「直击 + 落点爆炸」两段：直击只打锁定目标，爆炸对 100px 内全部敌方单位生效，两段各自独立结算。'
    '导弹之间不共享命中名额，所以敌人分散站时收益明显高于挤成一团——它是一张「拆阵型」牌，不是「清一团」牌。'
    '目标不足 3/4/5 个时，多余导弹对同一目标补位，不空放。'
)
ws.cell(50, 15).value = (
    '【P10+P5 复用】弹体用 风法师_绿风(8帧) 沿飞行方向压扁成细长导弹、青色描边，'
    '每帧按 180°/s 的转向速率朝目标转头，留 0.15s 半透明拖尾；'
    '触碰瞬间播 普攻爆炸(31帧)，半径随 100px 同步缩放；每个直击目标叠 受击(法师)。'
    '五枚导弹同屏时按发射序号错开 0.06s 起飞，避免叠在一起看不出是几发。'
)
ws.cell(50, 16).value = (
    'skill 域 behaviorKey=homing_missile（missileCount=3/4/5，targetSelect=nearest，turnRate=180°/s，'
    'speedScale=1.0/1.0/1.2，impactDamageRate=3.00/5.00/8.00，explosionRadius=100，'
    'explosionDamageRate=1.00/2.00/3.00，cooldown=12）；'
    '需新增 homing_missile 行为 —— 现有 SKILL_BEHAVIORS 只有 empowered_attack / multi_projectile / '
    'periodic_damage / on_hit_status / skill_params / passive_status / on_cast_end_spawn_zone 七种，没有追踪弹；'
    '落点爆炸可直接复用 ZCGroundZoneSystem 的一次性区域（zoneDuration 取 0.1s 只结算一波）'
)

# ------------------------------------------------------------------ 行 51 镭射死光：把美术锚点对标到真实资源
assert str(ws.cell(51, 7).value) == '101004'
ws.cell(51, 15).value = (
    '【P10 复用】风法师_绿风(8帧) 沿目标方向拉伸成一条贯穿全场的死光，宽度按 1.0/1.3/1.6 倍缩放，'
    '播 0.45s 后淡出；命中目标逐个叠 受击(法师)，末端补 普攻爆炸(缩 50%)。'
    '与 201001 共用同一份美术，靠拉伸与缩放区分「普攻细线」与「大招粗柱」，零新增。'
)
ws.cell(51, 16).value = (
    'skill 域 behaviorKey=on_cast_beam（length=全场，widthScale=1.0/1.3/1.6，'
    'impactDamageRate=2.00/2.60/3.20，maxTargets=0 表示不限）；L3 追加 status healTakenRate=-0.50、duration=4；'
    '触发计数走 empoweredEvery=8/7/6。'
    '需新增 on_cast_beam 行为（当前未注册）；判定是一条以目标方向为轴的线段，'
    '用 ZCTargetingSystem.attackReach 做长度、按垂直距离筛目标'
)

ws.freeze_panes = ws.freeze_panes
wb.save(SRC)
print('[saved] 主表 47~51 行已补齐')
