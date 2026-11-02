# -*- coding: utf-8 -*-
"""技能设计案2 · 被动技能重设计（纯数值）+ 空白单元格补齐。

规则（用户 2026-10-30 定）：
  绿 = 基础属性（血量 / 伤害）
  蓝 = 基础属性 或 克制关系属性（2 选 1）
  紫 = 技能属性 + 高级属性（技能属性主导）
  金 = 高级属性 + 技能属性（高级属性主导，3 词缀）
  68001~68005 的被动不动。
"""
import os
import re
import shutil
import datetime
import openpyxl

SRC = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
BACKUP_DIR = r'C:/Users/Administrator/AppData/Local/Temp/tft_backup'
SHEET = '技能设计案 (2)'

# ---------------------------------------------------------------- 属性词典
# kind: pct = 百分数（0.10 显示 10%）；rate = 比例（0.03 显示 3%）；int = 整数
STATS = {
    # ---- 基础属性 ----
    'maxHp': dict(kind='pct', layer='基础',
                  text=lambda v: f'最大生命提高{pct(v)}%',
                  mod=lambda s: f'unit 域 maxHp addRate={s}',
                  fx=None),
    'attack': dict(kind='pct', layer='基础',
                   text=lambda v: f'攻击提高{pct(v)}%',
                   mod=lambda s: f'unit 域 attack addRate={s}',
                   fx=None),
    # ---- 高级属性 ----
    'attackSpeed': dict(kind='pct', layer='高级',
                        text=lambda v: f'攻击速度提高{pct(v)}%',
                        mod=lambda s: f'unit 域 attackSpeed addRate={s}',
                        fx=None),
    'critRate': dict(kind='pct', layer='高级', num='flatpct', short='暴击率',
                     text=lambda v: f'暴击率提高{pct(v)}%',
                     mod=lambda s: f'unit 域 critRate add={s}（整数口径，12 = 12%）',
                     fx=None),
    'critDamage': dict(kind='pct', layer='高级', num='flatpct', short='暴击伤害',
                       text=lambda v: f'暴击伤害提高{pct(v)}%',
                       mod=lambda s: f'unit 域 critDamage add={s}（整数口径，60 = +60%）',
                       fx=None),
    'damageRate': dict(kind='pct', layer='高级',
                       text=lambda v: f'伤害提高{pct(v)}%',
                       mod=lambda s: f'unit 域 damageRate addRate={s}',
                       fx=None),
    'moveSpeed': dict(kind='pct', layer='高级',
                      text=lambda v: f'移动速度提高{pct(v)}%',
                      mod=lambda s: f'unit 域 moveSpeed addRate={s}',
                      fx='P16 复用：移动时留 0.2s 残影（消灭学霸_普攻 首帧）'),
    'attackRange': dict(kind='pct', layer='高级',
                        text=lambda v: f'攻击范围提高{pct(v)}%',
                        mod=lambda s: f'unit 域 attackRange addRate={s}',
                        fx=None),
    'lifestealRate': dict(kind='rate', layer='高级', num='ratio',
                          text=lambda v: f'造成伤害的{pct(v)}%转化为自身生命',
                          mod=lambda s: f'unit 域 lifestealRate add={s}',
                          fx='P11 复用：斧盾兵_锁链(8帧) 缩 20% 宽，从目标拉回自身 0.2s'),
    # ---- 技能属性 ----
    'pierceCount': dict(kind='int', num='int', layer='技能',
                        text=lambda v: f'普攻可穿透{v}个目标',
                        mod=lambda s: f'skill 域 skillParamJson={{"pierceCount":{s}}}',
                        fx='P2 复用：弓兵_通用箭矢(静态)，每穿透一次透明度降 20%'),
    'attackCount': dict(kind='int', num='int', layer='技能',
                        text=lambda v: f'普攻额外追加{v}段连击',
                        mod=lambda s: f'skill 域 skillParamJson={{"multiHit":{s}}}',
                        fx='P3 复用：民兵普攻_刀光(5帧)，追加段再播 1 次'),
    'bulletNum': dict(kind='int', num='int', layer='技能',
                      text=lambda v: f'普攻额外发射{v}发',
                      mod=lambda s: f'skill 域 skillParamJson={{"bulletNum":{s}}}（配 bulletAngle 做扇形均分）',
                      fx='P2 复用：同弹道复制 1~2 条，按角度均分'),
    'explosionDamageRate': dict(kind='pct', layer='技能',
                                text=lambda v: f'命中对周围造成{pct(v)}%溅射伤害',
                                mod=lambda s: f'skill 域 skillParamJson={{"explosionDamageRate":{s}}}',
                                fx='P5 复用：普攻爆炸(31帧)，随溅射半径同步缩放'),
    'impactDamageRate': dict(kind='pct', layer='技能',
                             text=lambda v: f'命中额外附加{pct(v)}%伤害',
                             mod=lambda s: f'skill 域 skillParamJson={{"impactDamageRate":{s}}}',
                             fx='P5 复用：普攻爆炸(31帧) 缩 40% 补一层'),
    'slowRatio': dict(kind='pct', layer='技能',
                      text=lambda v: f'命中使目标移动速度降低{pct(v)}%',
                      mod=lambda s: f'skill 域 skillParamJson={{"slowRatio":{s}}}',
                      fx='P8 复用：冰法师_冰雕(静态) 缩 30% 贴目标脚下'),
    'executeChance': dict(kind='pct', layer='技能',
                          text=lambda v: f'普攻有{pct(v)}%概率直接处决残血目标',
                          mod=lambda s: f'skill 域 skillParamJson={{"executeChance":{s}}}',
                          fx='【纯 UI】处决触发时飘字换深红档，场景零新增'),
    'shieldRatio': dict(kind='pct', layer='技能', short='友军护盾',
                        text=lambda v: f'强化击中时为同阵营全体友军提供相当于最大生命{pct(v)}%的护盾',
                        mod=lambda s: f'skill 域 skillParamJson={{"shieldRatio":{s}}}',
                        fx='P12 复用：刀盾兵_护盾(17帧) 缩 50%，停末帧'),
    # ---- 克制关系属性：进攻向 / 防御向 ----
    'counterDamageRate': dict(kind='pct', layer='克制',
                              text=None,   # 需要 克制/被克制 文案，见 build()
                              mod=lambda s: f'unit 域 counterDamageRate addRate={s}（需新增 statId）',
                              fx='【纯 UI】命中克制目标时飘字换金色档，场景零新增'),
    'counteredDamageReduce': dict(kind='pct', layer='克制',
                                  text=None,
                                  mod=lambda s: f'unit 域 counteredDamageReduce addRate={s}（需新增 statId）',
                                  fx='【纯 UI】被克制方命中时头顶闪一层灰盾，场景零新增'),
    # ---- 克制关系属性：友军向 ----
    'allyAtk': dict(kind='pct', layer='克制',
                    text=lambda v: f'半径 6 格内同阵营友军攻击提高{pct(v)}%',
                    mod=lambda s: f'skill 域 aura_team_stat（radius=6，作用域 ally，attack addRate={s}）；依赖 1011 自身光环元件',
                    fx='P13 复用：出生特效 的扩散环压脚下、随本体移动，半径 6 格'),
    'allyHp': dict(kind='pct', layer='克制',
                   text=lambda v: f'半径 6 格内同阵营友军最大生命提高{pct(v)}%',
                   mod=lambda s: f'skill 域 aura_team_stat（radius=6，作用域 ally，maxHp addRate={s}）；依赖 1011 自身光环元件',
                   fx='P13 复用：出生特效 的扩散环压脚下、随本体移动，半径 6 格'),
}


def pct(v):
    return f'{round(v * 100)}'


SHORT = {
    'maxHp': '最大生命', 'attack': '攻击', 'attackSpeed': '攻击速度',
    'critRate': '暴击率', 'critDamage': '暴击伤害', 'damageRate': '伤害',
    'moveSpeed': '移动速度', 'attackRange': '攻击范围', 'lifestealRate': '吸血',
    'pierceCount': '穿透', 'attackCount': '连击段数', 'bulletNum': '弹数',
    'explosionDamageRate': '溅射', 'impactDamageRate': '附加伤害',
    'slowRatio': '减速', 'executeChance': '处决', 'shieldRatio': '友军护盾',
    'allyAtk': '同阵营友军攻击', 'allyHp': '同阵营友军生命',
}


def fmt_vals(stat, vals):
    """按字段的取数口径格式化三级数值。

    - rate    小数，原样（0.10 → 0.10）
    - ratio   比例，原样（0.03 → 0.03）
    - flatpct 百分数整数（0.12 → 12）；critRate / critDamage 走 flat 分支，必须是整数
    - int     整数
    """
    num = STATS[stat].get('num', 'rate')
    if num == 'int':
        return '/'.join(str(int(v)) for v in vals)
    if num == 'flatpct':
        return '/'.join(str(round(v * 100)) for v in vals)
    return '/'.join(f'{v:.2f}' for v in vals)


def slot_summary(stat, vals, counter, countered):
    """N 列用的一句话区间，避免把 K/L/M 整段重复一遍。"""
    num = STATS[stat].get('num', 'rate')
    if stat == 'counterDamageRate':
        camp, role = counter
        short = f'对{camp}阵营/{role}职业伤害'
    elif stat == 'counteredDamageReduce':
        camp, role = countered
        short = f'受{camp}阵营/{role}职业伤害'
    else:
        short = SHORT[stat]
    if num == 'int':
        return f'{short} {int(vals[0])} → {int(vals[2])}'
    sign = '-' if stat in ('counteredDamageReduce',) else '+'
    return f'{short} {sign}{pct(vals[0])}% → {sign}{pct(vals[2])}%'


# ---------------------------------------------------------------- 逐行设计
# (行号, 技能ID, 新技能名 or None, 品级, 路线说明, [(stat, [L1,L2,L3]), ...])
BASIC = [0.10, 0.12, 0.14]
DUAL = [0.05, 0.06, 0.07]
A_MAIN = [0.15, 0.18, 0.21]
A_DUAL = [0.08, 0.10, 0.12]
CT_MAIN = [0.10, 0.13, 0.16]
CT_DUAL = [0.06, 0.08, 0.10]
CT_ALLY = [0.04, 0.05, 0.06]

ROWS = [
    # ======================= 绿 · 基础属性 =======================
    (53, 101101, None, '绿', '基础', [('attack', BASIC)]),
    (54, 101102, None, '绿', '基础', [('maxHp', BASIC)]),
    (55, 101103, '寒霜根基', '绿', '基础', [('attack', DUAL), ('maxHp', DUAL)]),

    (58, 101201, None, '绿', '基础', [('attack', BASIC)]),
    (59, 101202, None, '绿', '基础', [('maxHp', BASIC)]),
    (60, 101203, None, '绿', '基础', [('attack', DUAL), ('maxHp', DUAL)]),

    (93, 101901, None, '绿', '基础', [('attack', BASIC)]),
    (94, 101902, None, '绿', '基础', [('maxHp', BASIC)]),
    (95, 101903, '缠索战法', '绿', '基础', [('attack', DUAL), ('maxHp', DUAL)]),

    (138, 102801, None, '绿', '基础', [('attack', BASIC)]),
    (139, 102802, None, '绿', '基础', [('maxHp', BASIC)]),
    (140, 102803, '饱食之力', '绿', '基础', [('attack', DUAL), ('maxHp', DUAL)]),

    # ======================= 蓝 · 路线A 基础向 =======================
    (143, 102901, None, '蓝A', '基础', [('maxHp', A_MAIN)]),
    (144, 102902, None, '蓝A', '基础', [('attack', A_MAIN)]),
    (146, 102904, None, '蓝A', '基础', [('maxHp', A_DUAL), ('attack', A_DUAL)]),

    # ======================= 蓝 · 路线B 克制向（进攻 / 防御 / 友军） =======================
    (98, 102001, None, '蓝B', '克制·进攻', [('counterDamageRate', CT_MAIN)]),
    (99, 102002, None, '蓝B', '克制·进攻', [('counterDamageRate', CT_DUAL), ('allyAtk', CT_ALLY)]),
    (100, 102003, None, '蓝B', '克制·进攻', [('counterDamageRate', DUAL), ('counteredDamageReduce', DUAL)]),

    (103, 102101, None, '蓝B', '克制·防御', [('counteredDamageReduce', CT_MAIN)]),
    (104, 102102, None, '蓝B', '克制·防御', [('counteredDamageReduce', CT_DUAL), ('allyHp', [0.06, 0.08, 0.10])]),
    (105, 102103, None, '蓝B', '克制·防御', [('counterDamageRate', DUAL), ('counteredDamageReduce', DUAL)]),

    (148, 103001, None, '蓝B', '克制·友军', [('allyAtk', [0.08, 0.10, 0.12])]),
    (149, 103002, None, '蓝B', '克制·友军', [('allyHp', [0.10, 0.12, 0.14])]),
    (150, 103003, '铁山体魄', '蓝B', '克制·友军', [('allyAtk', DUAL), ('allyHp', DUAL)]),

    # ======================= 紫 · 技能属性 + 高级属性 =======================
    (28, 100601, None, '紫', '技能主导', [('shieldRatio', [0.15, 0.20, 0.25]), ('attackRange', [0.10, 0.12, 0.14])]),
    (29, 100602, None, '紫', '高级主导', [('damageRate', [0.10, 0.13, 0.16]), ('impactDamageRate', [0.10, 0.15, 0.20])]),

    (63, 101301, None, '紫', '技能主导', [('pierceCount', [1, 1, 2]), ('attackSpeed', [0.12, 0.16, 0.20])]),
    (64, 101302, None, '紫', '高级主导', [('damageRate', [0.10, 0.13, 0.16]), ('explosionDamageRate', [0.15, 0.20, 0.25])]),

    (68, 101401, '兽血共鸣', '紫', '技能主导', [('attackCount', [1, 1, 2]), ('attackSpeed', [0.12, 0.16, 0.20])]),
    (69, 101402, None, '紫', '高级主导', [('lifestealRate', [0.02, 0.03, 0.04]), ('shieldRatio', [0.10, 0.15, 0.20])]),

    (108, 102201, '先祖之力', '紫', '高级主导', [('attackSpeed', [0.12, 0.16, 0.20]), ('bulletNum', [1, 1, 2])]),
    (109, 102202, '净化之息', '紫', '高级主导', [('moveSpeed', [0.12, 0.16, 0.20]), ('slowRatio', [0.15, 0.20, 0.25])]),

    (113, 102301, None, '紫', '技能主导', [('shieldRatio', [0.18, 0.24, 0.30]), ('damageRate', [0.08, 0.10, 0.12])]),
    (114, 102302, None, '紫', '高级主导', [('attackRange', [0.12, 0.15, 0.18]), ('impactDamageRate', [0.15, 0.20, 0.25])]),

    (153, 103101, None, '紫', '技能主导', [('explosionDamageRate', [0.15, 0.20, 0.25]), ('attackSpeed', [0.12, 0.16, 0.20])]),
    (154, 103102, None, '紫', '高级主导', [('moveSpeed', [0.15, 0.20, 0.25]), ('attackCount', [1, 1, 2])]),

    # ======================= 金 · 高级属性 + 技能属性 =======================
    (33, 100701, None, '金', '高级主导', [('attackSpeed', [0.18, 0.24, 0.30]), ('moveSpeed', [0.15, 0.20, 0.25]), ('attackCount', [1, 2, 2])]),
    (34, 100702, None, '金', '高级主导', [('critRate', [0.12, 0.18, 0.24]), ('critDamage', [0.40, 0.60, 0.80]), ('executeChance', [0.10, 0.14, 0.18])]),

    (38, 100801, None, '金', '高级主导', [('damageRate', [0.15, 0.20, 0.25]), ('attackSpeed', [0.12, 0.16, 0.20]), ('explosionDamageRate', [0.20, 0.30, 0.40])]),
    (39, 100802, None, '金', '高级主导', [('critRate', [0.12, 0.18, 0.24]), ('attackRange', [0.10, 0.14, 0.18]), ('pierceCount', [1, 2, 3])]),

    (43, 100901, None, '金', '高级主导', [('attackSpeed', [0.18, 0.24, 0.30]), ('damageRate', [0.10, 0.13, 0.16]), ('attackCount', [1, 2, 2])]),
    (44, 100902, '踏地余威', '金', '高级主导', [('attackRange', [0.15, 0.20, 0.25]), ('moveSpeed', [0.08, 0.10, 0.12]), ('explosionDamageRate', [0.20, 0.30, 0.40])]),

    (48, 101001, None, '金', '高级主导', [('attackSpeed', [0.18, 0.24, 0.30]), ('critRate', [0.08, 0.12, 0.16]), ('bulletNum', [1, 2, 2])]),
    (49, 101002, None, '金', '高级主导', [('damageRate', [0.15, 0.20, 0.25]), ('attackRange', [0.10, 0.14, 0.18]), ('slowRatio', [0.20, 0.25, 0.30])]),

    (73, 101501, None, '金', '高级主导', [('attackSpeed', [0.15, 0.20, 0.25]), ('damageRate', [0.10, 0.13, 0.16]), ('slowRatio', [0.15, 0.20, 0.25])]),
    (74, 101502, None, '金', '高级主导', [('lifestealRate', [0.03, 0.04, 0.05]), ('critDamage', [0.30, 0.50, 0.70]), ('impactDamageRate', [0.15, 0.20, 0.25])]),

    (78, 101601, None, '金', '高级主导', [('critRate', [0.15, 0.20, 0.25]), ('critDamage', [0.40, 0.60, 0.80]), ('explosionDamageRate', [0.20, 0.30, 0.40])]),
    (79, 101602, None, '金', '高级主导', [('damageRate', [0.12, 0.16, 0.20]), ('attackSpeed', [0.12, 0.16, 0.20]), ('shieldRatio', [0.12, 0.16, 0.20])]),

    (83, 101701, None, '金', '高级主导', [('attackSpeed', [0.18, 0.24, 0.30]), ('attackRange', [0.12, 0.16, 0.20]), ('bulletNum', [1, 2, 2])]),
    (84, 101702, None, '金', '高级主导', [('damageRate', [0.15, 0.20, 0.25]), ('critRate', [0.10, 0.14, 0.18]), ('pierceCount', [1, 2, 3])]),

    (88, 101801, None, '金', '高级主导', [('attackRange', [0.18, 0.24, 0.30]), ('attackSpeed', [0.12, 0.16, 0.20]), ('attackCount', [1, 2, 2])]),
    (89, 101802, None, '金', '高级主导', [('lifestealRate', [0.03, 0.04, 0.05]), ('damageRate', [0.10, 0.13, 0.16]), ('impactDamageRate', [0.15, 0.20, 0.25])]),

    (118, 102401, None, '金', '高级主导', [('damageRate', [0.15, 0.20, 0.25]), ('attackRange', [0.10, 0.14, 0.18]), ('executeChance', [0.10, 0.14, 0.18])]),
    (119, 102402, '白骨咒印', '金', '高级主导', [('critRate', [0.12, 0.18, 0.24]), ('critDamage', [0.30, 0.50, 0.70]), ('pierceCount', [1, 2, 3])]),

    (123, 102501, None, '金', '高级主导', [('attackSpeed', [0.18, 0.24, 0.30]), ('critRate', [0.12, 0.18, 0.24]), ('attackCount', [1, 2, 2])]),
    (124, 102502, '猎影本能', '金', '高级主导', [('moveSpeed', [0.15, 0.20, 0.25]), ('damageRate', [0.12, 0.16, 0.20]), ('impactDamageRate', [0.20, 0.30, 0.40])]),

    (128, 102601, None, '金', '高级主导', [('attackSpeed', [0.15, 0.20, 0.25]), ('damageRate', [0.12, 0.16, 0.20]), ('bulletNum', [1, 2, 2])]),
    (129, 102602, '魔力回响', '金', '高级主导', [('lifestealRate', [0.03, 0.04, 0.05]), ('critRate', [0.10, 0.14, 0.18]), ('executeChance', [0.08, 0.12, 0.16])]),

    (133, 102701, None, '金', '高级主导', [('lifestealRate', [0.02, 0.03, 0.04]), ('damageRate', [0.12, 0.16, 0.20]), ('shieldRatio', [0.12, 0.16, 0.20])]),
    (134, 102702, '亡者威势', '金', '高级主导', [('critRate', [0.12, 0.18, 0.24]), ('critDamage', [0.40, 0.60, 0.80]), ('explosionDamageRate', [0.20, 0.30, 0.40])]),

    (158, 103201, None, '金', '高级主导', [('attackSpeed', [0.20, 0.26, 0.32]), ('critRate', [0.10, 0.14, 0.18]), ('attackCount', [1, 2, 2])]),
    (159, 103202, None, '金', '高级主导', [('damageRate', [0.12, 0.16, 0.20]), ('moveSpeed', [0.10, 0.12, 0.14]), ('explosionDamageRate', [0.25, 0.35, 0.45])]),

    (163, 103301, None, '金', '高级主导', [('critRate', [0.12, 0.18, 0.24]), ('critDamage', [0.40, 0.60, 0.80]), ('impactDamageRate', [0.20, 0.30, 0.40])]),
    (164, 103302, '无重力步', '金', '高级主导', [('attackSpeed', [0.15, 0.20, 0.25]), ('moveSpeed', [0.18, 0.24, 0.30]), ('attackCount', [1, 2, 2])]),

    (168, 103401, None, '金', '高级主导', [('attackSpeed', [0.18, 0.24, 0.30]), ('critRate', [0.12, 0.18, 0.24]), ('bulletNum', [1, 2, 2])]),
    (169, 103402, '幻影韧性', '金', '高级主导', [('moveSpeed', [0.15, 0.20, 0.25]), ('damageRate', [0.12, 0.16, 0.20]), ('executeChance', [0.08, 0.12, 0.16])]),

    (173, 103501, None, '金', '高级主导', [('attackRange', [0.18, 0.24, 0.30]), ('critRate', [0.12, 0.18, 0.24]), ('pierceCount', [1, 2, 3])]),
    (174, 103502, None, '金', '高级主导', [('attackSpeed', [0.15, 0.20, 0.25]), ('damageRate', [0.12, 0.16, 0.20]), ('bulletNum', [1, 2, 2])]),
]

TIER_LEVELS = {'绿': (3, 14, 22), '蓝A': (0, 14, 22), '蓝B': (0, 14, 22), '紫': (0, 14, 22), '金': (0, 16, 23)}

RATIONALE = {
    '绿': '绿档只做基础属性成长：三条被动分别负责攻击、生命、以及生命与攻击并进，'
          '不改变普攻形态、弹道与结算层级。落到配置只需要 unit 域的各一条 addRate，'
          '不新增字段、不新增资源，是最稳的一档。',
    '蓝A': '蓝档在这里选【基础属性】方向：三级数值整体比绿卡高一个档，'
           '同样只动 maxHp / attack 两条面板。选基础向的卡通常是前排或持续站桩输出的定位。',
    '蓝B': '蓝档在这里选【克制关系属性】方向：不再堆面板，而是把伤害/减伤挂到克制链上'
           '（花果→蘑菇→盆栽→僵尸→花果；法师→坦克→射手→战士→法师），'
           '打得对、扛得对才有收益，逆风时几乎没有收益，属于高上限高风险的一条路线。',
    '紫': '紫档是【技能属性 + 高级属性】两条词缀的组合：一条改技能结算的形状'
          '（穿透 / 溅射 / 护盾 / 连击 / 减速…），另一条改面板之外的出手效率'
          '（攻速 / 暴伤 / 移速 / 吸血 / 射程…）。只吃两条修正，不引入新的运行时机制。',
    '金': '金档是【高级属性 + 技能属性】三条词缀：两条高级属性打底，再叠一条技能属性。'
          '金卡不再给纯面板（maxHp / attack）——它的强度全部来自倍率与结算形状，'
          '所以金卡的收益会被攻速、暴击、克制关系进一步放大。',
}


def build_context(q_text, r_text):
    """从 Q/R 列解析出克制阵营与职业。"""
    def split(text):
        camp = role = ''
        if not text:
            return camp, role
        for seg in str(text).split('·'):
            seg = seg.strip()
            if seg.endswith('阵营'):
                camp = seg[:-2]
            elif seg.endswith('职业'):
                role = seg[:-2]
        return camp, role
    c_camp, c_role = split(q_text)
    d_camp, d_role = split(r_text)
    return (c_camp or '克制', c_role or '职业'), (d_camp or '被克制', d_role or '职业')


def slot_text(stat, v, counter, countered):
    meta = STATS[stat]
    if stat == 'counterDamageRate':
        camp, role = counter
        return f'对{camp}阵营 / {role}职业的目标造成的伤害提高{pct(v)}%'
    if stat == 'counteredDamageReduce':
        camp, role = countered
        return f'受到{camp}阵营 / {role}职业目标的伤害降低{pct(v)}%'
    return meta['text'](v)


def main():
    if not os.path.isdir(BACKUP_DIR):
        os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    backup = os.path.join(BACKUP_DIR, f'技能设计案2_before_passive_redesign_{stamp}.xlsx')
    shutil.copy2(SRC, backup)
    print('[backup]', backup)

    wb = openpyxl.load_workbook(SRC)
    ws = wb[SHEET]
    freeze = ws.freeze_panes

    log = []
    renames = []

    for (row, sid, newname, tier, route, slots) in ROWS:
        got = ws.cell(row, 7).value
        assert str(got).strip() == str(sid), f'row {row} 技能ID 不符：{got} != {sid}'
        old_name = ws.cell(row, 8).value
        card = ws.cell(row, 1).value
        card_name = ws.cell(row, 2).value
        q, r = ws.cell(row, 17).value, ws.cell(row, 18).value
        counter, countered = build_context(q, r)

        if newname:
            ws.cell(row, 8).value = newname
            renames.append((sid, old_name, newname, card_name))

        # ---- 等级标签：沿用原 K 列的「兵种 X 级」，缺失则按品级兜底
        levels = []
        for col in (11, 12, 13):
            txt = ws.cell(row, col).value
            m = re.search(r'兵种\s*(\d+)\s*级', str(txt or ''))
            levels.append(int(m.group(1)) if m else None)
        fallback = TIER_LEVELS[tier]
        levels = [lv if lv is not None else fallback[i] for i, lv in enumerate(levels)]

        # ---- K/L/M 升级文案
        ALLY = '半径 6 格内同阵营友军'
        for i, col in enumerate((11, 12, 13)):
            parts = [slot_text(stat, vals[i], counter, countered) for stat, vals in slots]
            #  两条友军词缀同时出现时，第二条用「其」接续，避免整句前缀重复
            for k in range(1, len(parts)):
                if parts[k].startswith(ALLY) and any(p.startswith(ALLY) for p in parts[:k]):
                    parts[k] = '其' + parts[k][len(ALLY):]
            ws.cell(row, col).value = f'L{i + 1}（兵种 {levels[i]} 级）：' + '，'.join(parts)

        # ---- N 技能详述：机制说明 + 一句话区间（不重复 K/L/M 原文）
        summary = '；'.join(slot_summary(stat, vals, counter, countered) for stat, vals in slots)
        ws.cell(row, 14).value = (
            f'{RATIONALE[tier]}\n【{route}】{summary}。'
            f'三级只放数值、不改机制，落地字段见 P 列。'
        )

        # ---- O 表现描述
        fxs = []
        for stat, _ in slots:
            fx = STATS[stat]['fx']
            if fx and fx not in fxs:
                fxs.append(fx)
        if fxs:
            joined = '；'.join(fxs)
            suffix = '' if '零新增' in joined else '；全部为现有资源复用，零新增'
            ws.cell(row, 15).value = joined + '。' + suffix.lstrip('；') + ('。' if suffix else '')
        else:
            ws.cell(row, 15).value = ('【无独立特效】纯面板/倍率提升，不产生场景演出；'
                                      '命中飘字沿用现有字号与颜色档，零新增资源。')

        # ---- P 落地口径
        mods = []
        for stat, vals in slots:
            mods.append(STATS[stat]['mod'](fmt_vals(stat, vals)))
        tail = ''
        if tier in ('紫', '金'):
            tail = '；skill 域参数按「同 unitId:pvpSkillId 参数叠加」合并进本卡普攻技能行'
        elif tier == '蓝B' and any(s in ('counterDamageRate', 'counteredDamageReduce') for s, _ in slots):
            tail = '；克制链已在 cardCounterMultiplier 结算，新增字段只需在此处乘一次'
        ws.cell(row, 16).value = ' + '.join(mods) + tail

        log.append((row, card, card_name, sid, newname or old_name, tier, route,
                    '；'.join(f'L{i + 1} ' + '、'.join(slot_text(s, v[i], counter, countered) for s, v in slots) for i in range(3)),
                    ' + '.join(mods)))

    # ---------------------------------------------------------------- 空白补齐
    blanks = []

    # row5 100103 饥饿豌豆：补 P（按 K/L/M 的移速口径；N 列写的攻速是旧稿笔误，见说明页）
    ws.cell(5, 16).value = ('status handler=on_hit_status（slowRatio=0.05/0.15/0.25，'
                            'duration=2/3/3）；behaviorKey=on_hit_status 已注册，可直接启用；'
                            '命中同时叠 受击(射手) 与「饥饿」减速图标')
    blanks.append((5, 100103, '饥饿豌豆', 'P 落地口径', ws.cell(5, 16).value))

    # row6 100104 豌豆机关枪：补 N（P 同步改成已实装的 burst 机制）
    ws.cell(6, 14).value = ('冷却 15s 的爆发技：在 1.2s 窗口内按固定间隔连发 3/5/7 发，'
                            '每发按面板 80/80/90% 独立结算、独立判定命中，因此逐发都能触发受击特效与命中状态；'
                            'L3 把窗口拉到 1.5s。连发只推进第一发的出手，余下几发排进单位状态由技能触发器逐步消费，'
                            '不会重复推进普攻节拍。')
    ws.cell(6, 16).value = ('skill 域 burstCount=3/5/7 + burstSeconds=1.2/1.2/1.5 + impactDamageRate=0.80/0.80/0.90；'
                            '由 ZCAttackResolutionSystem 的 burst 分支消费，无需 behaviorKey')
    blanks.append((6, 100104, '豌豆机关枪', 'N 详述（P 同步更正为已实装的 burst 机制）', ws.cell(6, 14).value))

    # row36 100704 穿刺利刃：补 K/L/M/O/P
    ws.cell(36, 11).value = 'L1（兵种 0 级）：累计 5 次普攻后，向前吐出一条贯穿 4 格的直线，对路径上最多 15 个单位造成 120% 伤害'
    ws.cell(36, 12).value = 'L2（兵种 16 级）：累计 5 次普攻，直线贯穿 5 格，最多 20 个单位，造成 150% 伤害'
    ws.cell(36, 13).value = 'L3（兵种 23 级）：累计 4 次普攻，直线贯穿 6 格，最多 25 个单位，造成 180% 伤害，并使命中目标移动速度降低 20%，持续 2 秒'
    ws.cell(36, 15).value = ('【P9 复用】吞噬大嘴花_舌头(12帧) 沿直线拉伸到技能长度播 0.4s；'
                             '路径每命中 1 个单位叠 受击(战士)，末端补 普攻爆炸(缩 50%)')
    ws.cell(36, 16).value = ('skill 域 behaviorKey=on_cast_line（length=4/5/6 格，maxTargets=15/20/25，'
                             'impactDamageRate=1.20/1.50/1.80）；L3 追加 slowRatio=0.20、duration=2；'
                             '触发计数走 empoweredEvery=5/5/4')
    blanks.append((36, 100704, '穿刺利刃', 'K/L/M 三级 + O 表现 + P 落地',
                   'L1 120%/4格/15目标 → L3 180%/6格/25目标 + 减速 20%'))

    # row50 101003 亡灵母舰：补 K/L/M/N/P
    ws.cell(50, 11).value = 'L1（兵种 0 级）：冷却 12s，向目标区域空投 1 座亡灵母舰，落点造成 150% 范围伤害，并就地留下持续 6s 的产兵区，每 2s 产出 1 只骷髅'
    ws.cell(50, 12).value = 'L2（兵种 16 级）：落点 180% 伤害，产兵区持续 8s，每 1.8s 产出 1 只骷髅，骷髅攻击继承 35%'
    ws.cell(50, 13).value = 'L3（兵种 23 级）：落点 220% 伤害，产兵区持续 10s，每 1.5s 产出 1 只骷髅，骷髅攻击继承 50%、生命继承 40%'
    ws.cell(50, 14).value = ('冷却 12s 的投送型主动：先按落点结算一次范围伤害，再在原地生成一个限时产兵区。'
                             '产出的骷髅属于独立召唤单位，共享本体阵营与克制关系，不继承本体的技能与被动；'
                             '产兵区到期后停止产出，已产出的骷髅继续存在到自身阵亡。')
    ws.cell(50, 16).value = ('skill 域 behaviorKey=on_cast_spawn_zone（落点 explosionDamageRate=1.50/1.80/2.20，'
                             'zoneCount=1，zoneDuration=6/8/10，spawnInterval=2.0/1.8/1.5，'
                             'summonAttackInherit=0.25/0.35/0.50，summonHpInherit=0.30/0.35/0.40）；'
                             '需新增 on_cast_spawn_zone 行为，产兵区复用 ZCGroundZoneSystem 的区域壳')
    blanks.append((50, 101003, '亡灵母舰', 'K/L/M 三级 + N 详述 + P 落地',
                   'L1 150%/6s/2.0s 产兵 → L3 220%/10s/1.5s 产兵 + 继承 50% 攻击'))

    # row51 101004 镭射死光：补 K/L/M/N/O/P
    ws.cell(51, 11).value = 'L1（兵种 0 级）：累计 8 次普攻后，向当前目标方向发射一条贯穿全场的死光，对路径上所有单位造成 200% 伤害'
    ws.cell(51, 12).value = 'L2（兵种 16 级）：累计 7 次普攻，造成 260% 伤害，路径宽度提高 30%'
    ws.cell(51, 13).value = 'L3（兵种 23 级）：累计 6 次普攻，造成 320% 伤害，路径宽度提高 60%，并使命中目标受到的治疗效果降低 50%，持续 4 秒'
    ws.cell(51, 14).value = ('累计普攻触发的贯通型大招：判定是一条以目标方向为轴的直线，'
                             '贯穿路径上的全部单位、不做命中数上限，因此站得越密收益越高。'
                             '死光只结算一次伤害，不附加击退；L3 追加的治疗削弱挂在命中状态上，重复命中按刷新计时而非叠层。')
    ws.cell(51, 15).value = ('【P17 复用】镭射飞龙_镭射能量线(静态) 沿目标方向拉伸到全场，宽度按 1.0/1.3/1.6 倍缩放，'
                             '播 0.45s 后淡出；命中目标逐个叠 受击(法师)，末端补 普攻爆炸(缩 50%)')
    ws.cell(51, 16).value = ('skill 域 behaviorKey=on_cast_beam（length=全场，widthScale=1.0/1.3/1.6，'
                             'impactDamageRate=2.00/2.60/3.20，maxTargets=0 表示不限）；'
                             'L3 追加 status healTakenRate=-0.50、duration=4；触发计数走 empoweredEvery=8/7/6')
    blanks.append((51, 101004, '镭射死光', 'K/L/M 三级 + N 详述 + O 表现 + P 落地',
                   'L1 200%/8次 → L3 320%/6次 + 治疗削弱 50%'))

    ws.freeze_panes = freeze
    wb.save(SRC)
    print('[saved]', SRC)
    print('[rows]', len(log), 'passive rows rewritten;', len(blanks), 'blank rows filled')

    return log, blanks, renames, backup


if __name__ == '__main__':
    main()
