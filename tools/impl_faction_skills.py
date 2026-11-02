# -*- coding: utf-8 -*-
"""花果 / 僵尸 种族技能落地：把设计案翻译成 pvpSkill / pvpSkillPlan / pvpStatus / pvpCard / armySkillLevelUp。

设计案（`技能设计案2.xlsx`）到运行时之间有几条硬约束，脚本按它们落：

1. **一条普攻行只有一个强化槽 + 一个副槽**（`empoweredSkillId` / `secondarySkillId`），
   所以一张卡最多两条主动走触发链。
2. **`pvpSkillPlan` 的唯一键是 (unitId, skillChainId, skillLevel)**，一行只能带**一个** statId。
   多词缀技能（设计案里「+攻速 +伤害 +移速」这种）必须拆**子链**：`skillId + 90000*k`。
   子链不出现在 UI 上（`armySkillLevelUp` 只认主链），运行时照样按等级选最高档。
3. **`unit 域 statId` 走 `pvpSkillPlan.statId`，`skill 域参数`走 `skillParamJson`**；
   两者互不影响，同名也不同域（`damageRate` 两边都有，含义不同）。
4. **`empoweredEvery` / `cooldown` 只认普攻行**（`ZCCombatSystem.consumeEmpoweredAttack` 读 profile），
   所以「累计 5→4 次」这类逐档变化本轮落不了，统一按 I 级值配，并在报告里列出来。
5. **同一张卡的所有计划行共用 `unitId:pvpSkillId` 一个参数袋**
   （`ZCMatchRuntimeCompiler.mergeSkillPlanIntoRuntime`），所以同一张卡的多个
   「参数型被动」必须用**互不重名的键**（如 `teamAura0*` / `teamAura1*`），
   `statusId` 只能有一个（链号最大的那条赢）。

用法：
  python tools/impl_faction_skills.py --faction 花果 [--dry]
  python tools/impl_faction_skills.py --faction 僵尸 [--dry]
"""

import argparse
import json
import os
import re
import sys

DESIGN = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
ROOT = r'D:/Alan/Project/POW/Demo3.8'
REF = os.path.join(ROOT, 'assets/remoteRef')

TABLE_FILES = {
    'pvpCard': 'pvpCard.json',
    'pvpSkill': 'pvpSkill.json',
    'pvpSkillPlan': 'pvpSkillPlan.json',
    'pvpStatus': 'pvpStatus.json',
    'armySkillLevelUp': 'armySkillLevelUp.json',
}

FX = 'units/projectiles/%s/%s'


def fx(name):
    return FX % (name, name)


# ───────────────────────────────────────────────────────────── 基础工具


def load(name):
    with open(os.path.join(REF, TABLE_FILES[name]), encoding='utf-8') as handle:
        raw = json.load(handle)
    if isinstance(raw, list):
        keys, rows = list(raw[0].keys()), [dict(row) for row in raw]
    else:
        keys = raw['k']
        rows = [dict(zip(keys, values)) for values in raw['v']]
    return keys, rows


def save(name, keys, rows):
    payload = {'k': keys, 'v': [[row.get(key) for key in keys] for row in rows], 'c': 1}
    with open(os.path.join(REF, TABLE_FILES[name]), 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(',', ':'))


def design_text():
    """从设计案取 技能名 / L1L2L3 正文 / 解锁等级，避免文案与表脱节。"""
    import openpyxl

    book = openpyxl.load_workbook(DESIGN, read_only=True)
    sheet = book['技能设计案 (2)']
    out = {}
    for row in sheet.iter_rows(min_row=2, max_row=sheet.max_row, values_only=True):
        sid = row[6]
        if sid is None:
            continue
        levels = []
        for text in row[10:13]:
            match = re.search(r'兵种\s*(\d+)\s*级', str(text or ''))
            levels.append(int(match.group(1)) if match else None)
        out[str(sid)] = {
            'card': row[1], 'camp': row[3], 'role': row[4], 'rarity': row[5],
            'name': row[7], 'levels': levels, 'texts': [row[10], row[11], row[12]],
        }
    book.close()
    return out


def strip_level(text):
    """把「L1（兵种 0 级）：xxx」削成「xxx」，只留玩家读得到的机制描述。"""
    if text is None:
        return ''
    return re.sub(r'^L\d（兵种\s*\d+\s*级）[：:]\s*', '', str(text)).strip()


def plan_row(unit, chain, level, unlock, name, kind, scope, stat=None, op=None, value=None,
             params=None, behavior=None, status=None, duration=None):
    return {
        'enabled': 1,
        'modifierId': 93000000 + chain * 10 + level,
        'unitId': unit,
        'skillChainId': chain,
        'skillName': name,
        'skillLevel': level,
        'unlockHeroLevel': max(1, unlock or 0),
        'skillKind': kind,
        'passiveScope': scope,
        'progressionMode': 'replace',
        'pvpSkillId': None,          # 由调用方填
        'triggerEvent': None,
        'stateMode': 'none',
        'targetSelector': None,
        'durationSeconds': duration,
        'maxStacks': None,
        'cooldown': None,
        'maxTriggers': None,
        'desc': None,
        'sourceVersion': '2026-10-30',
        'publishStatus': 1,
        'statId': stat,
        'operation': op,
        'value': value,
        'behaviorKey': behavior,
        'statusId': status,
        'statusStatJson': None,
        'skillParamJson': json.dumps(params, ensure_ascii=False, separators=(',', ':')) if params else None,
    }


# ───────────────────────────────────────────────────────────── 状态
# sid -> (名字, 持续秒, statMods, control)
# control 非空时单位进入受控（停止移动/攻击），`ZCStatusSystem.controlOf` 读这一列。
NEW_STATUS = {
    # 花果
    'slow_spore_l1': ('孢子黏液I', 2, {'moveSpeedPct': -30}, None),
    'slow_spore_l2': ('孢子黏液II', 3, {'moveSpeedPct': -40}, None),
    'slow_spore_l3': ('孢子黏液III', 3, {'moveSpeedPct': -50}, None),
    'slow_blade_l3': ('穿刺缠足III', 2, {'moveSpeedPct': -20}, None),
    'stun_1_5': ('眩晕1.5秒', 1.5, {}, 'stun'),
    'stun_2s': ('眩晕2秒', 2, {}, 'stun'),
    'vuln_10': ('集束易伤I', 2, {'damageTakenPct': 10}, None),
    'vuln_20': ('集束易伤II', 2, {'damageTakenPct': 20}, None),
    # 僵尸：艺术家「黏液阻滞」
    'slow_mucus_l1': ('黏液阻滞I', 2, {'moveSpeedPct': -30}, None),
    'slow_mucus_l2': ('黏液阻滞II', 2, {'moveSpeedPct': -40}, None),
    'slow_mucus_l3': ('黏液阻滞III', 2, {'moveSpeedPct': -50}, None),
    # 僵尸：吉他手「声波扫射」
    'slow_wave_l2': ('声波迟滞II', 2, {'moveSpeedPct': -15}, None),
    'slow_wave_l3': ('声波迟滞III', 3, {'moveSpeedPct': -30}, None),
    # 僵尸：眩晕各档（1 / 3 / 4 秒）
    'stun_1': ('眩晕1秒', 1, {}, 'stun'),
    'stun_2_5': ('眩晕2.5秒', 2.5, {}, 'stun'),
    'stun_3': ('眩晕3秒', 3, {}, 'stun'),
    'stun_4': ('眩晕4秒', 4, {}, 'stun'),
}


# ───────────────────────────────────────────────────────────── 花果 68006~68010
# 每个 skill：sid / 主 stat / 附加 stat（自动拆子链）/ 技能参数 / 目标状态 / 主动技能行
FLORA = {
    '68006': {
        'attack_row': 30703, 'attack_name': '波利奥普攻', 'mode': 'melee',
        'trigger': 'every_seconds', 'cooldown': 12, 'empowered': 0, 'empowered_skill': 30841,
        'secondary': 0,
        'skill_rows': {30841: dict(name='斗气爆发', mode='area', area=95, duration=5, waves=10,
                                   damage=0.2, effect=fx('波里奥_普攻'))},
        'skills': [
            dict(sid=100601, name='黏液阻滞', kind='passive_stat', scope='deployed',
                 stats=[('moveSpeed', 'addRate', [0.12, 0.16, 0.20])],
                 status=['slow_spore_l1', 'slow_spore_l2', 'slow_spore_l3']),
            dict(sid=100602, name='反应堆护膜', kind='passive_stat', scope='deployed',
                 stats=[('attackSpeed', 'addRate', [0.10, 0.14, 0.18])],
                 params={'shieldRatio': [0.30, 0.40, 0.50]}),
            # 100603 吃口菠萝：CD 10s 自身回血 + 周围 6 格友军回血，III 级解 1 个减益。
            # 走 self_cast（不出手、也没有弹道，强化槽与副轨都用不上），见 ZCSkillTriggerSystem。
            # 6 格 → 6 × 42 = 252（表值口径，与 attackRange 同一套 px）。
            dict(sid=100603, name='吃口菠萝', kind='active_cd', scope='battle',
                 stats=[], behavior='self_cast',
                 params={'selfCastCooldown': [10, 10, 10], 'selfCastSeconds': [0, 0, 0],
                         'selfCastHealPct': [8, 10, 15],
                         'selfCastAllyRadius': [252, 252, 252], 'selfCastAllyHealPct': [4, 5, 8],
                         'selfCastCleanse': [0, 0, 1]}),
            dict(sid=100604, name='斗气爆发', kind='active_cd', scope='battle',
                 stats=[],
                 params={'damageRate': [0.20, 0.30, 0.30], 'zoneSelfCentered': [1, 1, 1]}),
        ],
    },
    '68007': {
        'attack_row': 30712, 'attack_name': '吞噬大嘴花普攻', 'mode': 'melee',
        'trigger': 'every_n_attacks', 'cooldown': 0, 'empowered': 5, 'empowered_skill': 30842,
        'secondary': 0,
        'skill_rows': {30842: dict(name='穿刺利刃', mode='projectile', speed=900,
                                   effect=fx('吞噬大嘴花_普攻'))},
        'skills': [
            # 近战没有弹道，穿甲苔刺的「穿透」对 68007 无效 → 只落攻速 / 伤害，见报告
            dict(sid=100701, name='穿甲苔刺', kind='passive_stat', scope='deployed',
                 stats=[('attackSpeed', 'addRate', [0.10, 0.16, 0.22]),
                        ('damageRate', 'addRate', [0.06, 0.10, 0.14])]),
            dict(sid=100702, name='蔓生连打', kind='passive_stat', scope='deployed',
                 stats=[('attackCount', 'add', [1, 1, 1]),
                        ('attackSpeed', 'addRate', [0.18, 0.26, 0.34]),
                        ('moveSpeed', 'addRate', [0.12, 0.18, 0.24])]),
            # 100703 嗜血：CD 12s，伤害 +50/60/80%、吸血 10/12/15%，持续 6/7/8 秒。
            # 走 self_cast ——「限时增益」只能挂在状态上（unit 域补丁是常驻的）。
            dict(sid=100703, name='嗜血', kind='active_cd', scope='battle',
                 stats=[], behavior='self_cast',
                 params={'selfCastCooldown': [12, 12, 12], 'selfCastSeconds': [6, 7, 8],
                         'selfCastDamagePct': [50, 60, 80],
                         'selfCastLifestealPct': [10, 12, 15]}),
            dict(sid=100704, name='穿刺利刃', kind='active_attack', scope='battle',
                 stats=[],
                 params={'damageRate': [1.20, 1.50, 1.80], 'pierceCount': [99, 99, 99]},
                 status=[None, None, 'slow_blade_l3']),
        ],
    },
    '68008': {
        'attack_row': 30717, 'attack_name': '杰克藕普攻', 'mode': 'projectile', 'speed': 500,
        'effect': fx('弓兵_通用箭矢'),
        'trigger': 'every_seconds', 'cooldown': 12, 'empowered': 0, 'empowered_skill': 30843,
        'secondary': 0,
        'skill_rows': {30843: dict(name='疾风箭', mode='projectile', speed=900,
                                   effect=fx('弓兵_通用箭矢'))},
        'skills': [
            dict(sid=100801, name='穿甲苔刺', kind='passive_stat', scope='deployed',
                 stats=[('attackSpeed', 'addRate', [0.10, 0.16, 0.22]),
                        ('damageRate', 'addRate', [0.06, 0.10, 0.14])],
                 params={'normalPierceCount': [1, 1, 2]}),
            dict(sid=100802, name='爆囊扩散', kind='passive_stat', scope='deployed',
                 stats=[('attackSpeed', 'addRate', [0.14, 0.20, 0.26]),
                        ('damageRate', 'addRate', [0.06, 0.10, 0.14])],
                 params={'splashRadius': [38, 46, 55], 'splashDamageRate': [0.30, 0.40, 0.50]}),
            dict(sid=100803, name='疾风箭', kind='active_cd', scope='battle',
                 stats=[], params={'damageRate': [1.80, 2.30, 2.80]}),
            # 100804 戈壁狂箭：每 8 次普攻打一波箭雨，触发后开 6/7/8 秒窗口、每秒再落一波。
            # 5 格半径 → 5 × 42 = 210（表值口径）。单发 50/55/60%，随机挑人（不对朝向做要求）。
            dict(sid=100804, name='戈壁狂箭', kind='active_attack', scope='battle',
                 stats=[], behavior='random_strike',
                 params={'strikeEvery': [8, 8, 8], 'strikeCount': [5, 6, 8],
                         'strikeRadius': [210, 210, 210], 'strikeDamageRate': [0.50, 0.55, 0.60],
                         'strikeNearest': [0, 0, 0],
                         'strikeSeconds': [6, 7, 8], 'strikeInterval': [1, 1, 1]}),
        ],
    },
    '68009': {
        'attack_row': 30718, 'attack_name': '仙桃行者普攻', 'mode': 'melee',
        'trigger': 'every_n_attacks', 'cooldown': 0, 'empowered': 5, 'empowered_skill': 30844,
        'secondary': 0,
        'skill_rows': {30844: dict(name='大地之力', mode='projectile', speed=800,
                                   effect=fx('重骑兵_践踏'))},
        'skills': [
            dict(sid=100901, name='蔓生连打', kind='passive_stat', scope='deployed',
                 stats=[('attackCount', 'add', [1, 1, 1]),
                        ('attackSpeed', 'addRate', [0.18, 0.26, 0.34]),
                        ('moveSpeed', 'addRate', [0.12, 0.18, 0.24])]),
            # 爆囊扩散在近战卡上没有落点（溅射只走弹道），只落攻速/伤害
            dict(sid=100902, name='爆囊扩散', kind='passive_stat', scope='deployed',
                 stats=[('attackSpeed', 'addRate', [0.14, 0.20, 0.26]),
                        ('damageRate', 'addRate', [0.06, 0.10, 0.14])]),
            # 100903 迅击：「连击」是常驻的（走 unit 域 attackCount，1 = 多打一段 = 共 2 连击；
            # 设计案 L3 的 3 连击要 2），「伤害 / 闪避」是 CD 12s 的限时增益（走 self_cast）。
            # 设计案没给持续时长，本轮暂取 4 秒，等拍板。
            dict(sid=100903, name='迅击', kind='active_cd', scope='battle',
                 stats=[('attackCount', 'add', [1, 1, 2])], behavior='self_cast',
                 params={'selfCastCooldown': [12, 12, 12], 'selfCastSeconds': [4, 4, 4],
                         'selfCastDamagePct': [20, 40, 60], 'selfCastDodgePct': [8, 16, 20]}),
            dict(sid=100904, name='大地之力', kind='active_attack', scope='battle',
                 stats=[], params={'damageRate': [1.20, 1.50, 1.80], 'pierceCount': [99, 99, 99]}),
        ],
    },
    '68010': {
        'attack_row': 30719, 'attack_name': '镭射飞龙普攻', 'mode': 'projectile', 'speed': 500,
        'effect': fx('风法师_绿风'),
        'trigger': 'every_n_attacks', 'cooldown': 0, 'empowered': 8, 'empowered_skill': 30845,
        'secondary': 0,
        'skill_rows': {30845: dict(name='镭射死光', mode='projectile', speed=1200,
                                   effect=fx('风法师_绿风'))},
        'skills': [
            dict(sid=101001, name='孢子弹幕', kind='passive_stat', scope='deployed',
                 #  bulletNum / bulletAngle 必须走 statId（进 `ZCUnitStatPatch.bulletNumFlat/bulletAngleFlat`）：
                 #  skillParamJson 只喂 `skillRuntime.parameters`，发数/张角在那边没有任何消费点。
                 stats=[('attackSpeed', 'addRate', [0.14, 0.20, 0.26]),
                        ('damageRate', 'addRate', [0.08, 0.12, 0.16]),
                        ('bulletNum', 'add', [1, 1, 2]),
                        ('bulletAngle', 'add', [12, 12, 12])]),
            dict(sid=101002, name='裂变凿击', kind='passive_stat', scope='deployed',
                 stats=[('damageRate', 'addRate', [0.50, 0.64, 0.78]),
                        ('attackSpeed', 'addRate', [0.14, 0.20, 0.26]),
                        ('attackRange', 'addRate', [0.08, 0.12, 0.16])]),
            # 101003 追踪导弹：CD 12s 向最近 3/4/5 个敌方各打一发（直击 300/500/800%），
            # 落点爆炸半径 100（表值）+ 100/200/300%。爆炸倍率按「直击伤害 × 系数」结算，
            # 所以 1/3、0.4、0.375 分别对应 100/500、200/500、300/800。
            # ⚠️ 直击 800% 明显超金卡预算（设计案「数值自查」也这么写），等拍板后一起压。
            dict(sid=101003, name='追踪导弹', kind='active_attack', scope='battle',
                 stats=[], behavior='random_strike',
                 params={'strikeCooldown': [12, 12, 12], 'strikeCount': [3, 4, 5],
                         'strikeRadius': [336, 336, 336], 'strikeNearest': [1, 1, 1],
                         'strikeDamageRate': [3.00, 5.00, 8.00],
                         'strikeSplashRadius': [100, 100, 100],
                         'strikeSplashDamageRate': [0.3333, 0.4, 0.375]}),
            dict(sid=101004, name='镭射死光', kind='active_attack', scope='battle',
                 stats=[], params={'damageRate': [2.00, 2.60, 3.20], 'pierceCount': [99, 99, 99]}),
        ],
    },
}


# ───────────────────────────────────────────────────────────── 僵尸 68028~68035
ZOMBIE = {
    # 绿·战士：三条纯面板被动 + 餐箱炸弹（落点爆炸）
    '68028': {
        'attack_row': 30705, 'attack_name': '饥饿战士普攻', 'mode': 'melee',
        'trigger': 'every_n_attacks', 'cooldown': 0, 'empowered': 6, 'empowered_skill': 30846,
        'secondary': 0,
        'skill_rows': {30846: dict(name='餐箱炸弹', mode='area', area=60,
                                   damage=1.00, effect=fx('普攻爆炸'))},
        'skills': [
            dict(sid=102801, name='菌甲厚化', kind='passive_stat', scope='deployed',
                 stats=[('maxHp', 'addRate', [0.06, 0.08, 0.10])]),
            dict(sid=102802, name='废土铁芽', kind='passive_stat', scope='deployed',
                 stats=[('attack', 'addRate', [0.06, 0.08, 0.10])]),
            dict(sid=102803, name='共生体质', kind='passive_stat', scope='deployed',
                 stats=[('attack', 'addRate', [0.03, 0.04, 0.05]),
                        ('maxHp', 'addRate', [0.03, 0.04, 0.05])]),
            # 设计案 100/101/102% 三级只差 2%，按其自身建议改 100/130/160%
            dict(sid=102804, name='餐箱炸弹', kind='active_attack', scope='battle',
                 stats=[], params={'damageRate': [1.00, 1.30, 1.60]}),
        ],
    },
    # 蓝·坦克：面板 + 重击（单体高倍率）
    '68029': {
        'attack_row': 30704, 'attack_name': '金发统领普攻', 'mode': 'melee',
        'trigger': 'every_n_attacks', 'cooldown': 0, 'empowered': 5, 'empowered_skill': 30847,
        'secondary': 0,
        'skill_rows': {30847: dict(name='重击', mode='melee',
                                   damage=1.40, effect=fx('金发老板_普攻'))},
        'skills': [
            dict(sid=102901, name='菌甲厚化', kind='passive_stat', scope='deployed',
                 stats=[('maxHp', 'addRate', [0.12, 0.16, 0.20])]),
            dict(sid=102902, name='废土铁芽', kind='passive_stat', scope='deployed',
                 stats=[('attack', 'addRate', [0.12, 0.16, 0.20])]),
            dict(sid=102904, name='共生体质', kind='passive_stat', scope='deployed',
                 stats=[('maxHp', 'addRate', [0.05, 0.07, 0.09]),
                        ('attack', 'addRate', [0.05, 0.07, 0.09])]),
            dict(sid=102903, name='重击', kind='active_attack', scope='battle',
                 stats=[], params={'damageRate': [1.40, 1.70, 2.00]}),
        ],
    },
    # 蓝·法师：三条友军光环 + 绿尸寒警告（自体中心范围 + 眩晕）
    #  光环三路各占一个槽位（teamAura0/1/2），因为整卡共用一份参数袋。
    '68030': {
        'attack_row': 30702, 'attack_name': '篮球天才普攻', 'mode': 'projectile', 'speed': 500,
        'trigger': 'every_seconds', 'cooldown': 14, 'empowered': 0, 'empowered_skill': 30848,
        'secondary': 0,
        'skill_rows': {30848: dict(name='绿尸寒警告', mode='area', area=70,
                                   duration=2, waves=1, damage=0.70, effect=fx('普攻爆炸'))},
        'skills': [
            dict(sid=103001, name='共生信号·攻', kind='passive_stat', scope='deployed',
                 stats=[], behavior='team_aura',
                 params={'teamAura0Radius': [252, 252, 252],
                         'teamAura0AttackPct': [12, 16, 20]}),
            dict(sid=103002, name='共生信号·守', kind='passive_stat', scope='deployed',
                 stats=[], behavior='team_aura',
                 params={'teamAura1Radius': [252, 252, 252],
                         'teamAura1MaxHpPct': [12, 16, 20]}),
            dict(sid=103003, name='共生矩阵', kind='passive_stat', scope='deployed',
                 stats=[], behavior='team_aura',
                 params={'teamAura2Radius': [252, 252, 252],
                         'teamAura2AttackPct': [8, 10, 12],
                         'teamAura2MaxHpPct': [8, 10, 12]}),
            # 沉默在引擎里没有对应控制类型（ZCControlKind 只有 stun/freeze/paralysis/blind），
            # 落为同秒数眩晕并在设计案标注。
            dict(sid=103004, name='绿尸寒警告', kind='active_cd', scope='battle',
                 stats=[], params={'damageRate': [0.70, 1.00, 1.40], 'zoneSelfCentered': [1, 1, 1]},
                 status=['stun_2s', 'stun_2_5', 'stun_3']),
        ],
    },
    # 紫·坦克：护膜 + 黏液阻滞 + 迪斯科旋风；舞王召唤（召唤无原语）本轮不落
    '68031': {
        'attack_row': 30706, 'attack_name': '艺术家普攻', 'mode': 'melee',
        'trigger': 'every_seconds', 'cooldown': 13, 'empowered': 0, 'empowered_skill': 30849,
        'secondary': 0,
        'skill_rows': {30849: dict(name='迪斯科旋风', mode='area', area=60,
                                   duration=3, waves=3, damage=0.80, effect=fx('表演家MJ_普攻'))},
        'skills': [
            dict(sid=103101, name='反应堆护膜', kind='passive_stat', scope='deployed',
                 stats=[('attackSpeed', 'addRate', [0.10, 0.14, 0.18])],
                 params={'shieldRatio': [0.30, 0.40, 0.50]}),
            # 「命中使目标减速」走逐档 statusId（普攻行只有一个 onHitStatusId，无法逐档）
            dict(sid=103102, name='黏液阻滞', kind='passive_stat', scope='deployed',
                 stats=[('moveSpeed', 'addRate', [0.12, 0.16, 0.20])],
                 status=['slow_mucus_l1', 'slow_mucus_l2', 'slow_mucus_l3']),
            # 103103 舞王召唤：**替代口径**。真正的 summon_unit（4 个临时单位、继承生命/攻击、
            # 到期消散）会牵动单位生命周期 / 索敌 / 结算 / 快照编码，不在这一批里做。
            # 这里用 self_cast 把「4 个舞伴的输出」折算成限时增伤：4 × 60/70/80% = 240/280/320%，
            # 持续 6/7/8 秒（与设计案同），冷却取 14 秒（设计案写「待定」）。
            # ⚠️ 没有「多出 4 个身体」的挡拆/占位效果，等 summon_unit 落地后必须换掉。
            dict(sid=103103, name='舞王召唤', kind='active_cd', scope='battle',
                 stats=[], behavior='self_cast',
                 params={'selfCastCooldown': [14, 14, 14], 'selfCastSeconds': [6, 7, 8],
                         'selfCastDamagePct': [240, 280, 320]}),
            dict(sid=103104, name='迪斯科旋风', kind='active_cd', scope='battle',
                 stats=[], params={'damageRate': [0.80, 0.80, 0.80], 'zoneSelfCentered': [1, 1, 1]}),
        ],
    },
    # 金·射手：连打 + 爆囊 + 死亡摇滚（自中心持续）+ 声波扫射（副轨扇形）
    '68032': {
        'attack_row': 30708, 'attack_name': '吉他手普攻', 'mode': 'projectile', 'speed': 500,
        'clear_on_hit': True,
        'trigger': 'every_seconds', 'cooldown': 15, 'empowered': 0, 'empowered_skill': 30851,
        'secondary': 30850,
        'skill_rows': {
            30850: dict(name='声波扫射', mode='area', area=60, damage=0.90, effect=fx('吉他手_普攻')),
            30851: dict(name='死亡摇滚', mode='area', area=65, duration=5, waves=10,
                        damage=0.25, effect=fx('吉他手_普攻')),
        },
        'skills': [
            dict(sid=103201, name='蔓生连打', kind='passive_stat', scope='deployed',
                 stats=[('attackCount', 'add', [1, 1, 1]),
                        ('attackSpeed', 'addRate', [0.18, 0.26, 0.34]),
                        ('moveSpeed', 'addRate', [0.12, 0.18, 0.24])]),
            dict(sid=103202, name='爆囊扩散', kind='passive_stat', scope='deployed',
                 stats=[('attackSpeed', 'addRate', [0.14, 0.20, 0.26]),
                        ('damageRate', 'addRate', [0.06, 0.10, 0.14])],
                 params={'splashRadius': [38, 46, 55], 'splashDamageRate': [0.30, 0.40, 0.50]}),
            # 扇形散射没有「道数」原语，落成副轨扇形：伤害倍率 / 张角 / 半径逐档变化
            dict(sid=103203, name='声波扫射', kind='active_cd', scope='battle',
                 stats=[], params={'secondaryCooldown': [10, 10, 10],
                                   'secondaryDamageRate': [0.90, 1.00, 1.20],
                                   'secondaryFanDeg': [100, 120, 140],
                                   'secondaryRadiusScale': [0.30, 0.32, 0.34],
                                   'secondaryAppliesHitStatus': [0, 1, 1]},
                 status=[None, 'slow_wave_l2', 'slow_wave_l3']),
            dict(sid=103204, name='死亡摇滚', kind='active_cd', scope='battle',
                 stats=[], params={'damageRate': [0.25, 0.30, 0.40], 'zoneSelfCentered': [1, 1, 1]}),
        ],
    },
    # 金·战士：暴击双链 + 附加伤害 + 天外飞石（强化落点）+ 能量光束（副轨扇形）
    '68033': {
        'attack_row': 30713, 'attack_name': '运动霸普攻', 'mode': 'melee',
        'trigger': 'every_seconds', 'cooldown': 14, 'empowered': 0, 'empowered_skill': 30853,
        'secondary': 30852,
        'skill_rows': {
            30852: dict(name='能量光束', mode='area', area=70, damage=1.00, effect=fx('消灭学霸_普攻')),
            30853: dict(name='天外飞石', mode='area', area=80, damage=3.00,
                        effect=fx('驭兽师_巨象践踏')),
        },
        'skills': [
            # 溅射只走弹道，近战卡（运动霸）这一条落不了，只落暴击率 / 暴伤
            dict(sid=103301, name='裂变暴击', kind='passive_stat', scope='deployed',
                 stats=[('critRate', 'add', [22, 30, 38]),
                        ('critDamage', 'add', [90, 120, 150])]),
            # 「命中额外附加 X%」= 面板伤害倍率，落 unit 域 damageRate
            dict(sid=103302, name='裂变凿击', kind='passive_stat', scope='deployed',
                 stats=[('damageRate', 'addRate', [0.50, 0.64, 0.78]),
                        ('attackSpeed', 'addRate', [0.14, 0.20, 0.26]),
                        ('attackRange', 'addRate', [0.08, 0.12, 0.16])]),
            dict(sid=103303, name='能量光束', kind='active_cd', scope='battle',
                 stats=[], params={'secondaryCooldown': [9, 9, 9],
                                   'secondaryDamageRate': [1.00, 1.30, 1.60],
                                   'secondaryFanDeg': [50, 55, 60],
                                   'secondaryRadiusScale': [1.60, 1.80, 2.00]}),
            dict(sid=103304, name='天外飞石', kind='active_cd', scope='battle',
                 stats=[], params={'damageRate': [3.00, 3.00, 3.00]},
                 status=['stun_2s', 'stun_3', 'stun_4']),
        ],
    },
    # 金·法师：多弹 + 裂变暴击（弹道溅射可落）+ 帽子戏法（强化范围+眩晕）+ 空间置换（副轨）
    '68034': {
        'attack_row': 30710, 'attack_name': '魔术师普攻', 'mode': 'projectile', 'speed': 500,
        'trigger': 'every_seconds', 'cooldown': 12, 'empowered': 0, 'empowered_skill': 30854,
        'secondary': 30855,
        'skill_rows': {
            30854: dict(name='帽子戏法', mode='area', area=65, damage=1.00, effect=fx('魔法师_普攻')),
            30855: dict(name='空间置换', mode='area', area=40, damage=1.20, effect=fx('魔法师_普攻')),
        },
        'skills': [
            dict(sid=103401, name='孢子弹幕', kind='passive_stat', scope='deployed',
                 stats=[('attackSpeed', 'addRate', [0.14, 0.20, 0.26]),
                        ('damageRate', 'addRate', [0.08, 0.12, 0.16]),
                        ('bulletNum', 'add', [1, 1, 2]),
                        ('bulletAngle', 'add', [20, 20, 20])]),
            dict(sid=103402, name='裂变暴击', kind='passive_stat', scope='deployed',
                 stats=[('critRate', 'add', [22, 30, 38]),
                        ('critDamage', 'add', [90, 120, 150])],
                 params={'splashRadius': [38, 46, 55], 'splashDamageRate': [0.32, 0.40, 0.48]}),
            # 随机多点没有原语，落成「目标区域群伤 + 眩晕」
            dict(sid=103403, name='帽子戏法', kind='active_cd', scope='battle',
                 stats=[], params={'damageRate': [1.00, 1.20, 1.50]},
                 status=['stun_1', 'stun_1_5', 'stun_2s']),
            # 位移没有原语，只落「落地伤害」这一半
            dict(sid=103404, name='空间置换', kind='active_cd', scope='battle',
                 stats=[], params={'secondaryCooldown': [8, 8, 8],
                                   'secondaryDamageRate': [1.20, 1.00, 1.40],
                                   'secondaryFanDeg': [40, 40, 40],
                                   'secondaryRadiusScale': [0.30, 0.30, 0.35]}),
        ],
    },
    # 金·射手：穿透 + 处决 + 轨道打击（强化落点+眩晕）+ 射线集束（副轨扇形）
    '68035': {
        'attack_row': 30709, 'attack_name': '科学家普攻', 'mode': 'projectile', 'speed': 500,
        'trigger': 'every_seconds', 'cooldown': 16, 'empowered': 0, 'empowered_skill': 30857,
        'secondary': 30856,
        'skill_rows': {
            30856: dict(name='射线集束', mode='area', area=60, damage=1.00, effect=fx('科学家_普攻')),
            30857: dict(name='轨道打击', mode='area', area=90, damage=2.00, effect=fx('普攻爆炸')),
        },
        'skills': [
            dict(sid=103501, name='穿甲苔刺', kind='passive_stat', scope='deployed',
                 stats=[('attackSpeed', 'addRate', [0.10, 0.16, 0.22]),
                        ('damageRate', 'addRate', [0.06, 0.10, 0.14])],
                 params={'normalPierceCount': [1, 1, 2]}),
            dict(sid=103502, name='枯萎收割', kind='passive_stat', scope='deployed',
                 stats=[('critRate', 'add', [20, 28, 36]),
                        ('damageRate', 'addRate', [0.20, 0.26, 0.32])],
                 params={'executeChance': [0.35, 0.45, 0.55]}),
            # 易伤与轨道打击的眩晕共用唯一的 statusId 槽，本轮优先控制 → 易伤未落
            dict(sid=103503, name='射线集束', kind='active_cd', scope='battle',
                 stats=[], params={'secondaryCooldown': [9, 9, 9],
                                   'secondaryDamageRate': [1.00, 1.25, 1.75],
                                   'secondaryFanDeg': [45, 45, 50],
                                   'secondaryRadiusScale': [0.35, 0.35, 0.40]}),
            dict(sid=103504, name='轨道打击', kind='active_cd', scope='battle',
                 stats=[], params={'damageRate': [2.00, 2.80, 4.00]},
                 status=['stun_1', 'stun_1_5', 'stun_2s']),
        ],
    },
}

SPECS = {'花果': FLORA, '僵尸': ZOMBIE}


# ───────────────────────────────────────────────────────────── 写入


def build(faction):
    spec = SPECS[faction]
    text = design_text()
    keys_skill, skills = load('pvpSkill')
    keys_plan, plans = load('pvpSkillPlan')
    keys_card, cards = load('pvpCard')
    keys_status, statuses = load('pvpStatus')

    # 幂等：先清掉这些卡在 plan 里的行、以及脚本管理的技能行
    units = set(spec)
    managed_skill_ids = set()
    for card in spec.values():
        managed_skill_ids.update(card['skill_rows'])
    plans = [row for row in plans if str(row['unitId']) not in units]
    skills = [row for row in skills if int(row['skillId']) not in managed_skill_ids]

    added_plan, added_skill, added_status, updated_status = [], [], [], []

    # 状态：存在则按最新口径覆盖（control 列曾经漏配，靠这条修正）
    by_status = {row['statusId']: row for row in statuses}
    for sid, (name, seconds, mods, control) in NEW_STATUS.items():
        payload = {
            'legacyBuffKey': sid, 'statusId': sid, 'name': name,
            'durationSeconds': seconds, 'intervalSeconds': 0, 'maxStacks': 1,
            'refreshPolicy': 'refresh', 'handlerKey': 'none',
            'statJson': json.dumps(mods, ensure_ascii=False, separators=(',', ':')) or None,
            'enabled': 1, 'control': control, 'periodicAmountPct': None,
            'periodicBasis': None, 'periodicCapMultiplier': None,
        }
        exist = by_status.get(sid)
        if exist is None:
            row = {key: None for key in keys_status}
            row.update(payload)
            statuses.append(row)
            added_status.append(sid)
        elif any(exist.get(key) != value for key, value in payload.items()):
            exist.update(payload)
            updated_status.append(sid)

    for unit_id, card in spec.items():
        # ---- 普攻行：已有的就地改「触发链」，没有的新建
        exist = {int(row['skillId']): row for row in skills}
        attack = exist.get(card['attack_row'])
        if attack is None:
            attack = {key: None for key in keys_skill}
            attack.update({
                'skillId': card['attack_row'], 'name': card['attack_name'],
                'mode': card['mode'], 'projectileKey': '', 'projectileSpeed': card.get('speed', 0),
                'areaRadius': 0, 'effectKey': '', 'damageRate': None,
                'durationSeconds': None, 'waves': None, 'slowRatio': None, 'onHitStatusId': None,
            })
            skills.append(attack)
            added_skill.append(card['attack_row'])
        # 现场改链：这三格是「旧武将技残留」的唯一入口，必须逐卡覆盖
        attack.update({
            'name': card['attack_name'],
            'empoweredEvery': card['empowered'],
            'empoweredSkillId': card['empowered_skill'],
            'secondarySkillId': card['secondary'] or None,
            'trigger': card['trigger'],
            'cooldown': card['cooldown'],
        })
        if card.get('clear_on_hit'):
            # 旧表残留的命中状态（吉他手 30708 上的 frostbite）与新被动打架，清掉
            attack['onHitStatusId'] = None
        if card.get('effect'):
            attack['effectPrefabPath'] = card['effect']
        if card.get('speed'):
            attack['projectileSpeed'] = card['speed']

        # ---- 主动技能行
        for sid, meta in card['skill_rows'].items():
            row = {key: None for key in keys_skill}
            row.update({
                'skillId': sid, 'name': meta['name'], 'mode': meta['mode'],
                'projectileKey': '', 'projectileSpeed': meta.get('speed', 0),
                'areaRadius': meta.get('area', 0), 'empoweredEvery': 0, 'empoweredSkillId': 0,
                'secondarySkillId': None, 'effectPrefabPath': meta.get('effect') or '',
                'cooldown': 0, 'effectKey': '', 'trigger': None,
                'damageRate': meta.get('damage'), 'durationSeconds': meta.get('duration'),
                'waves': meta.get('waves'), 'slowRatio': None, 'onHitStatusId': None,
            })
            skills.append(row)
            added_skill.append(sid)

        # ---- 技能计划行
        for skill in card['skills']:
            sid = skill['sid']
            meta = text[str(sid)]
            levels = meta['levels']
            stats = skill.get('stats') or []
            behavior_key = skill.get('behavior') or 'skill_params'
            for index, (stat, op, values) in enumerate(stats):
                chain = sid + 90000 * index
                for level in (1, 2, 3):
                    params = None
                    behavior = None
                    status = None
                    if index == 0:
                        params = {k: v[level - 1] for k, v in (skill.get('params') or {}).items()} or None
                        behavior = behavior_key if params else None
                        status = (skill.get('status') or [None, None, None])[level - 1]
                    row = plan_row(unit_id, chain, level, levels[level - 1], skill['name'],
                                   skill['kind'], skill['scope'], stat, op, values[level - 1],
                                   params, behavior, status)
                    row['pvpSkillId'] = card['attack_row']
                    added_plan.append(row)
            if not stats:
                # 没有 unit 域词缀的技能（纯主动 / 纯参数）：只带参数
                chain = sid
                for level in (1, 2, 3):
                    params = {k: v[level - 1] for k, v in (skill.get('params') or {}).items()} or None
                    status = (skill.get('status') or [None, None, None])[level - 1]
                    row = plan_row(unit_id, chain, level, levels[level - 1], skill['name'],
                                   skill['kind'], skill['scope'], None, None, None,
                                   params, behavior_key if params else None, status)
                    row['pvpSkillId'] = card['attack_row']
                    added_plan.append(row)

        # ---- 卡牌指向
        for row in cards:
            if str(row['id']) == unit_id:
                row['unitSkillId'] = card['attack_row']

    return (keys_skill, skills, added_skill), (keys_plan, plans + added_plan, added_plan), \
        (keys_status, statuses, added_status, updated_status), (keys_card, cards)


def update_army_skill_text(faction):
    """把 armySkillLevelUp 的 name/desc/类型 按设计案重写（12 行/卡）。"""
    spec = SPECS[faction]
    text = design_text()
    keys, rows = load('armySkillLevelUp')
    changed = []
    retyped = set()
    for unit_card in spec.values():
        for skill in unit_card['skills']:
            sid = skill['sid']
            meta = text[str(sid)]
            #  `armySkillType` 只是卡牌页的展示口径（`CardSkillList` 注释：1 = 数值被动，
            #  2 = 行为被动，不影响升级）。带 `params`（落 `skillParamJson`）或 `behavior`
            #  （落 `behaviorKey`）的才算「行为」，其余一律数值被动。
            skill_type = 2 if (skill.get('params') or skill.get('behavior')) else 1
            for level in (1, 2, 3):
                for row in rows:
                    if str(row['id']) != str(sid) or int(row['skilllevel']) != level:
                        continue
                    desc = strip_level(meta['texts'][level - 1])
                    if row['name'] != meta['name'] or row['desc'] != desc:
                        row['name'] = meta['name']
                        row['desc'] = desc
                        changed.append((sid, level))
                    if str(row.get('armySkillType')) != str(skill_type):
                        retyped.add((sid, row.get('armySkillType'), skill_type))
                    row['armySkillType'] = skill_type
                    row['unlockarmylevel'] = max(1, meta['levels'][level - 1] or 0)
    for sid, old, new in sorted(retyped, key=lambda item: item[0]):
        print('   技能类型 %s：%s → %s' % (sid, old, new))
    return keys, rows, changed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--faction', default='花果')
    parser.add_argument('--dry', action='store_true')
    args = parser.parse_args()

    (k1, skill_rows, added_skill), (k2, plan_rows, added_plan), \
        (k3, status_rows, added_status, updated_status), (k4, card_rows) = build(args.faction)
    k5, army_rows, changed_text = update_army_skill_text(args.faction)

    print('[plan] 新增 %d 行；技能行 %d；状态 新增 %d / 修正 %d；文案 %d 处'
          % (len(added_plan), len(added_skill), len(added_status), len(updated_status), len(changed_text)))
    for sid in added_skill:
        print('   技能行', sid)
    print('   状态新增', ', '.join(added_status) or '-')
    print('   状态修正', ', '.join(updated_status) or '-')

    if args.dry:
        return

    save('pvpSkill', k1, skill_rows)
    save('pvpSkillPlan', k2, plan_rows)
    save('pvpStatus', k3, status_rows)
    save('pvpCard', k4, card_rows)
    save('armySkillLevelUp', k5, army_rows)
    print('[ok] 已写回 assets/remoteRef/（pvpSkill / pvpSkillPlan / pvpStatus / pvpCard / armySkillLevelUp）')


if __name__ == '__main__':
    sys.exit(main())
