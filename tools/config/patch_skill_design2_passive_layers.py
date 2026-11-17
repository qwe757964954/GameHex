# -*- coding: utf-8 -*-
"""把「职业 × 层级」被动属性矩阵回填到 技能设计案2.xlsx / 技能设计案 (2)（2026-11-16）。

用户口径：
  低级被动围绕单位统一的基础属性，中级围绕职业属性，高级为混搭 + 范围型伤害/增益 + 中低级被动。
  四职业属性池见 passive_layer_plan.POOLS。

原则：**属性已在池内的行一个字都不动**（符合的不变）；只在属性出池时改技能名 + 三档文案 +
详述 + 表现 + 落地口径 + 状态。

只动目标 8 列：H(技能名) I(触发类型) J(触发参数) K/L/M(三档) N(详述) O(表现) P(落地口径) S(状态)。
Q/R（克制/被克制）与 A~G（卡牌与技能 ID）一律不碰。

zip 级手术，不用 openpyxl（该表 dimension 极大，另存会把整张表按 16384 列重写）。
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402
import xlsx_read  # noqa: E402
import passive_layer_plan as PLAN  # noqa: E402

PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'

#  需要新字段 / 新元件的词缀 ⇒ 未实现；其余在既有 modifier 上改参即可 ⇒ 优化中
NEED_NEW = {'regen', 'regen_crit', 'blast', 'cdr', 'lance', 'bullet_size',
            'camp_atk', 'role_atk', 'camp_def', 'role_def',
            'ally_heal', 'ally_atk', 'ally_ms'}

#  蓝卡的基础属性档位比绿卡高一截（预算 58 vs 30）
BLUE_TIERS = {'atk': (17, 20, 23), 'hp': (17, 20, 23), 'rng': (24, 28, 32),
              'aspd': (16, 19, 22), 'crit': (4, 5, 6),
              'camp_atk_crit': (24, 27, 30), 'role_atk_crit': (24, 27, 30),
              'camp_def_crit': (24, 27, 30), 'role_def_crit': (24, 27, 30),
              'regen_crit': (1.5, 1.8, 2.1)}
#  紫/金卡的克制档位
HIGH_TIERS = {'camp_atk': (45, 50, 55), 'role_atk': (45, 50, 55),
              'camp_def': (45, 50, 55), 'role_def': (45, 50, 55),
              'camp_atk_crit': (45, 50, 55), 'role_atk_crit': (45, 50, 55),
              'camp_def_crit': (45, 50, 55), 'role_def_crit': (45, 50, 55),
              'regen': (1.5, 1.8, 2.1), 'regen_crit': (1.5, 1.8, 2.1)}

#  「克制 + 暴击率」混搭条的暴击率尾。
#  🔴 2026-11-16 用户口径：卡牌暴击率上限由 7% 放宽到 15%，档位按品级递进。
EXTRA_CRIT = {'绿（1）': (4, 5, 6), '蓝（2）': (6, 8, 10), '紫（3）': (8, 10, 12)}
CRIT_CAP_TOTAL = 0.15          # 同卡 critRate addRate 合计上限

#  纯克制词缀 → 带暴击率的混搭版（每张卡只升级第一条，保证同卡暴击不重复叠加）
PLAIN_TO_CRIT = {'camp_atk': 'camp_atk_crit', 'role_atk': 'role_atk_crit',
                 'camp_def': 'camp_def_crit', 'role_def': 'role_def_crit'}
CRIT_KINDS = {'camp_atk_crit', 'role_atk_crit', 'camp_def_crit', 'role_def_crit',
              'crit_splash', 'regen_crit'}

#  🔴 用户口径（待确认⑧）：这两张卡允许「被动弱、主动补」，被动侧不再加厚凑满预算
WEAK_CARD = {'68015', '68027'}
WEAK_TAIL_BUDGET = 60.0        # 被动侧最多挂 60 VP 的混搭尾（≈90% 达成），剩余缺口记入主动技能补强清单

#  VP 系数（与「被动重设计口径」页一致）
VP = {'atk': 1.0, 'hp': 1.0, 'rng': 0.7, 'aspd': 0.95, 'crit': 0.5,
      'dmg': 1.2, 'splash': 2.0, 'lifesteal': 0.9, 'counter': 0.8,
      'regen': 20.0, 'ally_ms': 1.2}

#  整卡预算 / 被动条数 ⇒ 单条目标 VP
BUDGET = {'绿（1）': (30, 3), '蓝（2）': (58, 3), '紫（3）': (120, 2), '金（4）': (297, 2)}

#  混搭尾缀（用户 2026-11-16 待确认⑩：一张卡内两条被动不许挂同一个尾巴
#  ⇒ 按 slot 取不同的词缀组合，允许中低级混搭，数值压在各词缀封顶内）
TAIL_CAPS = {'atk': 35, 'dmg': 35, 'aspd': 35, 'rng': 35, 'hp': 35}
TAIL_SETS = {
    '射手': (('atk', 'rng'), ('atk', 'rng', 'dmg')),
    '法师': (('atk', 'rng'), ('atk', 'rng', 'dmg')),
    '战士': (('atk', 'aspd'), ('atk', 'aspd', 'dmg')),
    '坦克': (('atk', 'hp'), ('atk', 'hp', 'dmg')),
}
TAIL_ORDER = ('atk', 'dmg', 'aspd', 'rng', 'hp')
TAIL_CN = {'atk': '攻击提高', 'dmg': '伤害提高', 'aspd': '攻击速度提高',
           'rng': '攻击范围提高', 'hp': '最大生命提高'}
TAIL_FIELD = {'atk': 'unit 域 attack addRate', 'dmg': 'unit 域 damageRate addRate',
              'aspd': 'unit 域 attackSpeed addRate', 'rng': 'unit 域 attackRange addRate',
              'hp': 'unit 域 maxHp addRate'}

MOD_TPL = {
    'atk': 'unit 域 attack addRate={a}/{b}/{c}（面板攻击百分比，三级递进）',
    'hp': 'unit 域 maxHp addRate={a}/{b}/{c}',
    'rng': 'unit 域 attackRange addRate={a}/{b}/{c}（只改选取范围，不改弹速与伤害）',
    'aspd': 'unit 域 attackSpeed addRate={a}/{b}/{c}',
    'crit': 'unit 域 critRate addRate={a}/{b}/{c}（🔴 卡牌被动暴击率硬上限 15%，'
            '配表需加「同卡合计 ≤0.15」断言）',
    'shots_shooter': 'unit 域 bulletNumFlat=2（🔴 额外弹数必须走 unit 域，写进 skillParamJson 引擎不认）；'
                     'skillParamJson extraBulletDamage={a}/{b}/{c} + bulletFalloff=0.4'
                     '（第 2 发按 0.6 再折 = {a2}/{b2}/{c2}）；每颗弹必须自带 to',
    'shots_mage': 'unit 域 bulletNumFlat=2；skillParamJson extraBulletDamage={a}/{b}/{c} + bulletFalloff=0.4'
                  ' + projectileSpreadDeg=25（扇形，<360；🔴 偶数弹配 360° 全向会让每颗弹都不走 aim）；'
                  '第 2 道按 0.6 折 = {a2}/{b2}/{c2}',
    'combo': 'unit 域 multiHit=2；skillParamJson comboDamage={a}/{b}/{c}，comboFalloff=0.4'
             '（第 3 段 = {a2}/{b2}/{c2}）',
    'regen': 'unit 域 hpRegenPct={a}/{b}/{c}（🔴 新字段，需 ZCModifierEngine 与单位帧循环支持）',
    'camp_atk': 'pvpSkillPlan counterDamageRate={a}/{b}/{c}（🔴 需把 cardCounterMultiplier 拆出 camp 判据）',
    'role_atk': 'pvpSkillPlan counterDamageRate={a}/{b}/{c}（camp / role 各一条 record，避免同一行两义）',
    'camp_def': 'pvpSkillPlan counteredDamageReduce={a}/{b}/{c}（🔴 新字段）',
    'role_def': 'pvpSkillPlan counteredDamageReduce={a}/{b}/{c}（camp / role 各一条 record）',
    'lifesteal': 'unit 域 lifestealRate={a}/{b}/{c}；skillParamJson lifestealSpreadRate=0.5（扩散段折算）；'
                 '🔴 纯吸血，无第二机制（被动弱 ⇒ 差额进主动技能补强清单）',
    'lifesteal_splash': 'unit 域 lifestealRate={a}/{b}/{c}；skillParamJson lifestealSpreadRate=0.5（扩散段折算）；'
                        '第二机制：skillParamJson splashDamageRate={m2a}/{m2b}/{m2c} + splashFalloff=0.3',
    'splash': 'skillParamJson splashDamageRate={a}/{b}/{c} + splashFalloff=0.3；'
              '半径读 pvpSkill.areaRadius 并同步特效尺寸（🔴 explosionDamageRate 引擎不认）',
    'pierce': 'unit 域 normalPierceCount=2；skillParamJson normalPierceFalloff=0.4（60/36/12）；'
              '🔴 普攻穿透只能用 normalPierceCount，pierceCount 只服务强化那一击',
    'bullet_size': 'unit 域 bulletSizeScale={a}/{b}/{c}（🔴 新字段；视觉体积与判定半径同步放大）；'
                   '第二机制：skillParamJson splashDamageRate={m2a}/{m2b}/{m2c} + splashFalloff=0.3',
    'blast': 'skillParamJson splashDamageRate={a}/{b}/{c} + splashFalloff=0.3 + blastRadius=90；'
             '判据是正圆（不是以主目标为圆心的爆点递减）',
    'cdr': 'unit 域 cdReduceOnHit={a}/{b}/{c}（🔴 新字段，按秒回退其他主动技能剩余 CD，不含自身）；'
           '第二机制：unit 域 attackSpeed addRate={m2a}/{m2b}/{m2c}',
    'lance': 'skillParamJson lanceEvery={a}/{b}/{c} + lancePierceCount=3 + lancePierceFalloff=0.35'
             '（70/45/30）；触发时只替换本次普攻的 projectileKey，不改 attackRange',
    'camp_atk_crit': 'pvpSkillPlan counterDamageRate={a}/{b}/{c}（🔴 需 cardCounterMultiplier 拆出 camp 判据）；'
                     '同条混搭：unit 域 critRate addRate={x}/{y}/{z}（🔴 卡牌被动合计 ≤0.15，配表加断言）',
    'role_atk_crit': 'pvpSkillPlan counterDamageRate={a}/{b}/{c}（camp / role 各一条 record）；'
                     '同条混搭：unit 域 critRate addRate={x}/{y}/{z}（🔴 ≤0.15）',
    'role_def_crit': 'pvpSkillPlan counteredDamageReduce={a}/{b}/{c}（camp / role 各一条 record）；'
                     '同条混搭：unit 域 critRate addRate={x}/{y}/{z}（🔴 ≤0.15）',
    'camp_def_crit': 'pvpSkillPlan counteredDamageReduce={a}/{b}/{c}（🔴 新字段）；'
                     '同条混搭：unit 域 critRate addRate={x}/{y}/{z}（🔴 ≤0.07）',
    'crit_splash': 'unit 域 critRate addRate={x}/{y}/{z}（金档 11/13/15%，🔴 卡牌被动合计 ≤0.15）；'
                   'skill 域 skillParamJson={{"splashDamageRate":{a}/{b}/{c},"splashFalloff":0.3}}；'
                   '🔴 溅射键名是 splashDamageRate，explosionDamageRate 引擎不认；已移除 critDamage',
    'ally_ms': '1011 光环元件 aura_team_stat → moveSpeed addRate={a}/{b}/{c}'
               '（radiusPx=190，同阵营，含自身，随本体移动）；🔴 元件按用户口径要实装（待确认⑦）',
    'ally_heal': '1011 光环元件 aura_team_stat → 回血通道（radiusPx=190，元件待实装）',
    'ally_atk': '1011 光环元件 aura_team_stat → attack addRate={a}/{b}/{c}（radiusPx=190，元件待实装）',
    'regen_crit': 'unit 域 hpRegenPct={a}/{b}/{c}（🔴 新字段）；'
                  '同条混搭：unit 域 critRate addRate={x}/{y}/{z}（🔴 ≤0.15）',
}

#  金卡「高级 = 混搭」：主机制之外统一挂一条攻速 + 伤害的尾巴，三档不变
HIGH_TAIL = {
    'lifesteal': '；攻击速度提高 20%，伤害提高 15%',
    'splash': '；攻击速度提高 20%，伤害提高 15%',
    'blast': '；攻击速度提高 20%，伤害提高 15%',
    'bullet_size': '；攻击速度提高 20%，伤害提高 15%',
    'cdr': '；攻击速度提高 20%，伤害提高 15%',
    'lance': '；攻击速度提高 20%，伤害提高 15%',
    'pierce': '，伤害提高 14%',
}
HIGH_TAIL_MOD = '；同条混搭尾（三档不变）：unit 域 attackSpeed addRate=0.20 + attack addRate=0.15'


def main_vp(kind, v, extra=None, nseg=2):
    """单条被动「L1 档」的主词缀 VP（含第二机制，混搭尾另算）。"""
    a = v[0]
    info = PLAN.KIND.get(kind, {})
    #  第二机制（用户口径：补机制而不是纯数值）
    mix2 = info.get('mix2')
    m2 = (mix2['tiers'][0] * mix2['vp']) if mix2 else 0.0

    if kind in ('shots_shooter', 'shots_mage'):
        base = a * (1.6 if nseg == 2 else 1.0)
    elif kind == 'bullet_size':
        base = 60.0
    elif kind == 'cdr':
        base = {0.3: 50.0, 0.4: 67.0, 0.5: 83.0, 0.6: 100.0}.get(a, 67.0)
    elif kind == 'lance':
        #  每 4/3/2 次普攻换一发「穿透 3 目标」的远程弹：频率 × 目标数折算
        base = {4: 100.0, 3: 125.0, 2: 150.0}.get(a, 100.0)
    elif kind == 'pierce':
        base = 120.0 + a * 0.95
    elif kind == 'combo':
        #  1 段 = a；2 段 = 第 2 段 a + 第 3 段 a×0.6
        base = a * (1.6 if nseg == 2 else 1.0)
    elif kind in ('atk', 'hp'):
        base = a * 1.0
    elif kind == 'rng':
        base = a * 0.7
    elif kind == 'aspd':
        base = a * 0.95
    elif kind == 'crit':
        base = a * 0.5
    elif kind in ('regen', 'regen_crit'):
        base = a * 20.0
    elif kind == 'ally_ms':
        base = a * 1.2
    elif kind in ('camp_atk', 'role_atk', 'camp_def', 'role_def',
                  'camp_atk_crit', 'role_atk_crit', 'camp_def_crit', 'role_def_crit'):
        base = a * 0.8
    elif kind in ('lifesteal', 'lifesteal_splash'):
        base = a * 0.9
    elif kind in ('splash', 'blast', 'crit_splash'):
        base = a * 2.0
    else:
        base = 0.0
    base += m2
    if extra:
        base += extra[0] * 0.5
    return base


def auto_tail(gap, keys, skip=()):
    """把 VP 缺口摊到指定词缀上（平均分摊 → 触顶后回填），返回 {词缀: 百分比整数}。"""
    keys = [k for k in keys if k not in skip]
    if not keys or gap < 3:
        return {}
    got = dict((k, 0.0) for k in keys)
    left = float(gap)
    for _ in range(6):
        if left <= 0.5:
            break
        openk = [k for k in keys if got[k] < TAIL_CAPS[k] * VP[k] - 0.5]
        if not openk:
            break
        share = left / len(openk)
        for k in openk:
            add = min(TAIL_CAPS[k] * VP[k] - got[k], share)
            got[k] += add
            left -= add
    return dict((k, int(round(v / VP[k]))) for k, v in got.items() if v >= 0.5)


def tail_text(tail):
    if not tail:
        return ''
    parts = ['%s %d%%' % (TAIL_CN[k], tail[k]) for k in TAIL_ORDER if tail.get(k)]
    return '；' + '，'.join(parts) if parts else ''


def tail_mod(tail):
    if not tail:
        return ''
    parts = ['%s=%.2f' % (TAIL_FIELD[k], tail[k] / 100.0)
             for k in TAIL_ORDER if tail.get(k)]
    return '；同条混搭尾（三档不变）：' + ' + '.join(parts)


#  三档文案：每项返回 (l1, l2, l3)
def tier_texts(kind, v, lv, ctx, extra=None, nseg=2):
    a, b, c = v
    n1, n2, n3 = lv
    head = lambda i, n: 'L%d（兵种 %d 级%s）：' % (i, n, '，开局即解锁' if n == 0 else '')
    tail = '%' if PLAN.KIND[kind].get('tail') == '%' else ''

    if kind in ('atk', 'hp', 'rng', 'aspd', 'crit'):
        cn = PLAN.KIND[kind]['cn']
        return tuple('%s%s提高 %s%s' % (head(i + 1, n), cn, val, tail)
                     for i, (n, val) in enumerate(zip(lv, v)))

    if kind in ('shots_shooter', 'shots_mage'):
        if nseg == 1:
            body = '普攻额外发射 1 发' if kind == 'shots_shooter' else '普攻同时裂出 1 道额外弹'
            return (
                '%s%s（额外弹伤害 %d%%），同一爆点第 2 个目标起每次 ×0.7' % (head(1, n1), body, a),
                '%s额外弹伤害提高到 %d%%，其余不变' % (head(2, n2), b),
                '%s额外弹伤害提高到 %d%%，其余不变' % (head(3, n3), c),
            )
        body = '普攻额外发射 2 发' if kind == 'shots_shooter' else '普攻同时裂出 2 道额外弹'
        return (
            '%s%s（第 1 发 %d%%，第 2 发 %d%%），同一爆点第 2 个目标起每次 ×0.7'
            % (head(1, n1), body, a, int(round(a * 0.6))),
            '%s额外弹伤害提高到 %d%% / %d%%，其余不变' % (head(2, n2), b, int(round(b * 0.6))),
            '%s额外弹伤害提高到 %d%% / %d%%，其余不变' % (head(3, n3), c, int(round(c * 0.6))),
        )

    if kind == 'combo':
        if nseg == 1:
            return (
                '%s普攻追加 1 段连击（第 2 段伤害 %d%%）' % (head(1, n1), a),
                '%s第 2 段伤害提高到 %d%%，其余不变' % (head(2, n2), b),
                '%s第 2 段伤害提高到 %d%%，其余不变' % (head(3, n3), c),
            )
        return (
            '%s普攻追加 2 段连击（第 2 段 %d%%，第 3 段 %d%%）'
            % (head(1, n1), a, int(round(a * 0.6))),
            '%s连击伤害提高到 %d%% / %d%%，其余不变' % (head(2, n2), b, int(round(b * 0.6))),
            '%s连击伤害提高到 %d%% / %d%%，其余不变' % (head(3, n3), c, int(round(c * 0.6))),
        )

    if kind in ('regen', 'regen_crit'):
        if kind == 'regen_crit':
            return (
                '%s每秒回复自身最大生命 %s%%，暴击率提高 %d%%' % (head(1, n1), a, extra[0]),
                '%s每秒回复 %s%%，暴击率提高到 %d%%' % (head(2, n2), b, extra[1]),
                '%s每秒回复 %s%%，暴击率提高到 %d%%' % (head(3, n3), c, extra[2]),
            )
        return (
            '%s每秒回复自身最大生命 %s%%' % (head(1, n1), a),
            '%s每秒回复 %s%%，其余不变' % (head(2, n2), b),
            '%s每秒回复 %s%%，其余不变' % (head(3, n3), c),
        )

    if kind in ('camp_atk', 'role_atk'):
        who = ctx['atk_camp'] + '阵营' if kind == 'camp_atk' else ctx['atk_role'] + '职业'
        return (
            '%s对%s的目标伤害提高 %d%%' % (head(1, n1), who, a),
            '%s对%s的目标伤害提高 %d%%' % (head(2, n2), who, b),
            '%s对%s的目标伤害提高 %d%%' % (head(3, n3), who, c),
        )

    if kind in ('camp_def', 'role_def'):
        who = ctx['def_camp'] + '阵营' if kind == 'camp_def' else ctx['def_role'] + '职业'
        return (
            '%s受到%s目标的伤害降低 %d%%' % (head(1, n1), who, a),
            '%s受到%s目标的伤害降低 %d%%' % (head(2, n2), who, b),
            '%s受到%s目标的伤害降低 %d%%' % (head(3, n3), who, c),
        )

    if kind == 'lifesteal':
        return (
            '%s普攻造成伤害的 %d%% 转化为自身生命' % (head(1, n1), a),
            '%s转化比例提高到 %d%%，其余不变' % (head(2, n2), b),
            '%s转化比例提高到 %d%%，其余不变' % (head(3, n3), c),
        )

    if kind == 'lifesteal_splash':
        m2 = PLAN.KIND['lifesteal_splash']['mix2']['tiers']
        return (
            '%s普攻造成伤害的 %d%% 转化为自身生命；命中对周围造成 %d%% 溅射伤害'
            '（同一爆点第 2 个目标起每次 ×0.7）' % (head(1, n1), a, m2[0]),
            '%s转化比例提高到 %d%%，溅射提高到 %d%%' % (head(2, n2), b, m2[1]),
            '%s转化比例提高到 %d%%，溅射提高到 %d%%' % (head(3, n3), c, m2[2]),
        )

    if kind == 'splash':
        return (
            '%s命中对周围造成 %d%% 溅射伤害（同一爆点第 2 个目标起每次 ×0.7）' % (head(1, n1), a),
            '%s溅射伤害提高到 %d%%，其余不变' % (head(2, n2), b),
            '%s溅射伤害提高到 %d%%，其余不变' % (head(3, n3), c),
        )

    if kind == 'pierce':
        return (
            '%s普攻直线穿透 2 个目标（穿透目标依次承受 60%%/36%%/12%%），飞行距离不变；攻击速度提高 %d%%'
            % (head(1, n1), a),
            '%s攻击速度加成提高到 %d%%，穿透数量与衰减链不变' % (head(2, n2), b),
            '%s攻击速度加成提高到 %d%%，穿透数量与衰减链不变' % (head(3, n3), c),
        )

    if kind == 'bullet_size':
        m2 = PLAN.KIND['bullet_size']['mix2']['tiers']
        return (
            '%s普攻弹体体积 ×%s，命中判定半径同比放大；命中对周围造成 %d%% 溅射伤害'
            '（同一爆点第 2 个目标起每次 ×0.7）' % (head(1, n1), a, m2[0]),
            '%s弹体体积 ×%s，溅射提高到 %d%%' % (head(2, n2), b, m2[1]),
            '%s弹体体积 ×%s，溅射提高到 %d%%' % (head(3, n3), c, m2[2]),
        )

    if kind == 'blast':
        return (
            '%s命中在落点生成半径 90 的圆形爆炸，范围内目标承受 %d%% 溅射伤害（逐目标 ×0.7）'
            % (head(1, n1), a),
            '%s爆炸承伤提高到 %d%%，其余不变' % (head(2, n2), b),
            '%s爆炸承伤提高到 %d%%，其余不变' % (head(3, n3), c),
        )

    if kind == 'cdr':
        m2 = PLAN.KIND['cdr']['mix2']['tiers']
        return (
            '%s每次普攻命中使其他主动技能剩余冷却减少 %s 秒；攻击速度提高 %d%%'
            % (head(1, n1), a, m2[0]),
            '%s减冷却提高到 %s 秒，攻速提高到 %d%%' % (head(2, n2), b, m2[1]),
            '%s减冷却提高到 %s 秒，攻速提高到 %d%%' % (head(3, n3), c, m2[2]),
        )

    if kind == 'lance':
        return (
            '%s每 %d 次普攻，把本次攻击替换成一枚远程穿透弹'
            '（穿透 3 个目标，依次承受 70%%/45%%/30%%，飞行距离不变）' % (head(1, n1), a),
            '%s触发间隔缩短为 %d 次，穿透数量与衰减链不变' % (head(2, n2), b),
            '%s触发间隔缩短为 %d 次，穿透数量与衰减链不变' % (head(3, n3), c),
        )

    if kind == 'ally_ms':
        return (
            '%s以本体为圆心 190px 内的同阵营友军（含自身）移动速度提高 %d%%，光环随本体移动'
            % (head(1, n1), a),
            '%s光环移速加成提高到 %d%%，半径与随动不变' % (head(2, n2), b),
            '%s光环移速加成提高到 %d%%，半径与随动不变' % (head(3, n3), c),
        )

    if kind in ('camp_atk_crit', 'role_atk_crit', 'camp_def_crit', 'role_def_crit'):
        if kind == 'camp_def_crit':
            who = ctx['def_camp'] + '阵营'
            tpl = '%s受到%s目标的伤害降低 %d%%，暴击率提高 %d%%'
        elif kind == 'role_def_crit':
            who = ctx['def_role'] + '职业'
            tpl = '%s受到%s目标的伤害降低 %d%%，暴击率提高 %d%%'
        elif kind == 'camp_atk_crit':
            who = ctx['atk_camp'] + '阵营'
            tpl = '%s对%s的目标伤害提高 %d%%，暴击率提高 %d%%'
        else:
            who = ctx['atk_role'] + '职业'
            tpl = '%s对%s的目标伤害提高 %d%%，暴击率提高 %d%%'
        return (tpl % (head(1, n1), who, a, extra[0]),
                tpl % (head(2, n2), who, b, extra[1]),
                tpl % (head(3, n3), who, c, extra[2]))

    if kind == 'crit_splash':
        return (
            '%s暴击率提高 %d%%，命中对周围造成 %d%% 溅射伤害（同一爆点第 2 个目标起每次 ×0.7）'
            % (head(1, n1), extra[0], a),
            '%s暴击率提高到 %d%%，溅射提高到 %d%%' % (head(2, n2), extra[1], b),
            '%s暴击率提高到 %d%%（卡牌上限），溅射提高到 %d%%' % (head(3, n3), extra[2], c),
        )

    if kind in ('ally_heal', 'ally_atk'):
        cn = PLAN.KIND[kind]['cn']
        return tuple('%s6 格内同阵营友军%s提高 %s%%' % (head(i + 1, n), cn, val)
                     for i, (n, val) in enumerate(zip(lv, v)))

    raise SystemExit('未定义文案模板：%s' % kind)


def parse_pair(text):
    """'僵尸阵营 · 战士职业' → ('僵尸', '战士')"""
    m = re.match(r'\s*([^\s·]+?)阵营\s*·\s*([^\s·]+?)职业\s*$', text or '')
    return (m.group(1), m.group(2)) if m else ('僵尸', '战士')


def build_ctx(cm):
    """Q 列 = 本卡克制的（出手方向）；R 列 = 克制本卡的（挨打方向）。
    🔴 增伤类必须读 Q、减伤类必须读 R，两边阵营/职业不同（坦克 Q=射手、R=法师）。"""
    atk = parse_pair(cm.get('Q'))
    dfn = parse_pair(cm.get('R'))
    return {'atk_camp': atk[0], 'atk_role': atk[1], 'def_camp': dfn[0], 'def_role': dfn[1]}


def load_rows(path):
    """行号 → {列字母: 文本}。走 xlsx_read（解 sharedStrings，设计案正文大量 t="s"）。"""
    _, data = xlsx_read.read_sheet(path, 0)
    rows = {}
    for rno, cells in data:
        cell = {}
        for i, val in enumerate(cells):
            if val:
                cell[chr(65 + i) if i < 26 else 'A' + chr(65 + i - 26)] = val
        rows[rno] = cell
    return rows


PLAIN_W = {'攻击提高': 1.0, '最大生命提高': 1.0, '攻击范围提高': 0.7,
           '攻击速度提高': 0.95, '暴击率提高': 0.5}


def plain_vp(text):
    """保留行（属性本就在池内、本轮一个字不改）的既有 VP。"""
    body = (text or '').split('：', 1)[-1]
    vp = 0.0
    for k, w in PLAIN_W.items():
        m = re.search(k + r'\s*(\d+(?:\.\d+)?)%', body)
        if m:
            vp += float(m.group(1)) * w
    m = re.search(r'(?:目标伤害提高|伤害降低)\s*(\d+)%', body)
    if m:
        vp += float(m.group(1)) * 0.8
    return vp


def resolve(rno, cm, slot_of):
    """行 → (kind, tiers, extra, opts, note, slot, lv)，已含「纯克制 → 克制+暴击」升级。"""
    spec = PLAN.SPECS[rno]
    kind, note = spec[0], spec[1]
    opts = spec[2] if len(spec) > 2 else {}
    rarity = cm.get('F')
    slot = slot_of[rno]
    lv = PLAN.LEVELS.get((rarity, slot), (0, 14, 22))

    tiers = opts.get('main_tiers') or PLAN.KIND[kind]['tiers']
    if rarity == '蓝（2）' and kind in BLUE_TIERS:
        tiers = opts.get('main_tiers') or BLUE_TIERS[kind]
    elif rarity in ('紫（3）', '金（4）') and kind in HIGH_TIERS:
        tiers = opts.get('main_tiers') or HIGH_TIERS[kind]

    #  中级机制按品级分强弱：紫卡 1 段/1 发，金卡 2 段/2 发（预算差 120 : 297）
    nseg = 2 if rarity == '金（4）' else 1

    extra = opts.get('extra_tiers')
    if extra is None and kind in CRIT_KINDS:
        #  裂变暴击（金·战士）走 11/13/15%，其余克制/回血混搭条按品级走 3~12%
        extra = (11, 13, 15) if kind == 'crit_splash' else EXTRA_CRIT.get(rarity)
    return kind, tiers, extra, opts, note, slot, lv, nseg


def main():
    xml = read_zip_rows(PATH, MEMBER)
    rows = load_rows(PATH)

    order = {}
    for rno in sorted(rows):
        if rno < 2:
            continue
        cm = rows[rno]
        if '被动' not in (cm.get('I') or ''):
            continue
        order.setdefault(cm.get('A'), []).append(rno)
    slot_of = {}
    for card, rn in order.items():
        for i, r in enumerate(rn):
            slot_of[r] = i

    #  ① 纯克制词缀 → 克制 + 暴击率（每张卡只升级第一条，保证同卡暴击不叠加）
    upgraded = {}
    has_crit = set()
    for rno in sorted(PLAN.SPECS):
        kind = PLAN.SPECS[rno][0]
        if kind in CRIT_KINDS and rno in rows:
            has_crit.add(rows[rno].get('A'))
    pending = {}
    for rno in sorted(PLAN.SPECS):
        if rno not in rows:
            continue
        kind = PLAN.SPECS[rno][0]
        card = rows[rno].get('A')
        if kind in PLAIN_TO_CRIT:
            pending.setdefault(card, []).append(rno)
    for card, rs in pending.items():
        if card in has_crit:
            continue
        r0 = rs[0]
        spec = list(PLAN.SPECS[r0])
        spec[0] = PLAIN_TO_CRIT[spec[0]]
        spec[1] = spec[1] + '；🔴 紫/蓝卡也要有个位数以上暴击率 ⇒ 本条升级成「克制 + 暴击率」混搭条'
        upgraded[r0] = tuple(spec)
        has_crit.add(card)
    saved = dict(PLAN.SPECS)
    PLAN.SPECS.update(upgraded)

    #  ② 逐行算主词缀 VP，再按「整卡」分配混搭尾（同卡两条不重复）
    info_by_row = {}
    card_rows = {}
    for rno in sorted(rows):
        cm = rows[rno]
        if rno < 2 or '被动' not in (cm.get('I') or '') or rno not in PLAN.SPECS:
            continue
        kind, tiers, extra, opts, note, slot, lv, nseg = resolve(rno, cm, slot_of)
        mv = main_vp(kind, tiers, extra, nseg)
        info_by_row[rno] = dict(kind=kind, tiers=tiers, extra=extra, opts=opts,
                                note=note, slot=slot, lv=lv, main=mv, nseg=nseg,
                                card=cm.get('A'), rarity=cm.get('F'), role=cm.get('E'))
        card_rows.setdefault(cm.get('A'), []).append(rno)

    tails = {}
    weak_note = {}
    for card, rs in card_rows.items():
        rarity = info_by_row[rs[0]]['rarity']
        role = info_by_row[rs[0]]['role']
        budget, count = BUDGET[rarity]
        #  保留行已挂的固定尾缀先扣掉
        fixed = 0.0
        for rno, t in PLAN.TAIL_EXTRA.items():
            if rows.get(rno, {}).get('A') == card:
                fixed += sum(t[k] * VP[k] for k in t)
        #  同卡的保留行（不在 SPECS 里）也要占预算，否则会给 SPECS 行多挂尾缀
        for r in order.get(card, []):
            if r not in PLAN.SPECS:
                fixed += plain_vp(rows[r].get('K'))
        used = sum(info_by_row[r]['main'] for r in rs) + fixed
        gap = budget - used
        if card in WEAK_CARD and gap > WEAK_TAIL_BUDGET:
            weak_note[card] = gap - WEAK_TAIL_BUDGET
            gap = WEAK_TAIL_BUDGET
        if gap < 3:
            continue
        target = (budget - fixed) / float(count)
        needs = dict((r, max(0.0, target - info_by_row[r]['main'])) for r in rs)
        tot = sum(needs.values())
        if tot <= 0:
            continue
        for r in rs:
            share = gap * needs[r] / tot
            keys = TAIL_SETS[role][min(info_by_row[r]['slot'], 1)]
            skip = ('aspd',) if info_by_row[r]['kind'] == 'pierce' else ()
            tails[r] = auto_tail(share, keys, skip)

    changed, kept = [], []
    for rno, cm in sorted(rows.items()):
        if rno < 2 or '被动' not in (cm.get('I') or ''):
            continue
        card = cm.get('A')
        rarity = cm.get('F')
        if rno not in PLAN.SPECS:
            if rno not in PLAN.TAIL_EXTRA:
                kept.append((rno, card, cm.get('H'), cm.get('E'), rarity))
                continue
            tail = dict(PLAN.TAIL_EXTRA[rno])
            add = tail_text(tail)
            note2 = ('\r\n【本轮补数】主词缀「%s」属性本就在池内，'
                     '一个字未动；整卡 VP 缺口由本条混搭尾补足：%s。'
                     % (cm.get('H'), add.lstrip('；')))
            mod2 = tail_mod(tail)

            def once(cur, block):
                """🔴 幂等：先把历史重复块折叠成一个，再判断是否已挂。
                   曾因无条件 `+ tail_text(...)` 导致每次重跑追加一遍（行 98 曾叠 11 层）。"""
                cur = cur or ''
                if not block:
                    return cur
                while cur.count(block) > 1:
                    cur = cur.replace(block + block, block)
                return cur if block in cur else cur + block

            for col in ('K', 'L', 'M'):
                xml = set_cell(xml, '%s%d' % (col, rno), once(cm.get(col), add))
            xml = set_cell(xml, 'N%d' % rno, once(cm.get('N'), note2))
            xml = set_cell(xml, 'P%d' % rno, once(cm.get('P'), mod2))
            xml = set_cell(xml, 'S%d' % rno, '【优化中】')
            changed.append((rno, card, cm.get('H'), cm.get('H'), cm.get('E'), rarity, '【优化中】'))
            continue

        d = info_by_row[rno]
        kind, tiers, extra, lv = d['kind'], d['tiers'], d['extra'], d['lv']
        opts, note = d['opts'], d['note']
        tail = {} if opts.get('no_tail') else tails.get(rno, {})

        ctx = build_ctx(cm)
        l1, l2, l3 = tier_texts(kind, tiers, lv, ctx, extra, d['nseg'])
        l1 += tail_text(tail)
        info = PLAN.KIND[kind]
        mech = info['mech']
        if kind == 'crit_splash':
            mech = mech.format(c1=extra[0], c2=extra[1], c3=extra[2],
                               s1=tiers[0], s2=tiers[1], s3=tiers[2])
        mech = mech + ('（本条按整卡 VP 缺口挂混搭尾：%s）' % tail_text(tail).lstrip('；')
                       if tail else '') + \
            '\r\n【本轮改动】' + note + \
            '；按' + cm.get('E') + '·' + {'绿（1）': '低级+中级', '蓝（2）': '低级+中级',
                                       '紫（3）': '中级', '金（4）': '高级+中低级'}[rarity] + \
            '被动池重新分配。'
        if card in weak_note:
            mech += ('\r\n【主动补强】按用户口径「被动可以弱」，被动侧不再加厚（本条混搭尾已按缺口压到最小档）；'
                     '整卡剩余 %.0f VP 记入主动技能补强清单'
                     '（补数值或补机制均可）。' % weak_note[card])
        m2 = info.get('mix2')
        mod = MOD_TPL[kind].format(
            a=tiers[0], b=tiers[1], c=tiers[2],
            a2=int(round(tiers[0] * 0.6)), b2=int(round(tiers[1] * 0.6)),
            c2=int(round(tiers[2] * 0.6)),
            m2a=(m2['tiers'][0] if m2 else 0), m2b=(m2['tiers'][1] if m2 else 0),
            m2c=(m2['tiers'][2] if m2 else 0),
            x=(extra[0] if extra else 0), y=(extra[1] if extra else 0),
            z=(extra[2] if extra else 0))
        mod += tail_mod(tail)
        status = '【未实现】' if kind in NEED_NEW else '【优化中】'

        hname = info.get('name2') if d['nseg'] == 2 and info.get('name2') else info['name']
        for ref, val in [('H%d' % rno, hname), ('I%d' % rno, '被动'), ('J%d' % rno, 0),
                         ('K%d' % rno, l1), ('L%d' % rno, l2), ('M%d' % rno, l3),
                         ('N%d' % rno, mech), ('O%d' % rno, info['fx']),
                         ('P%d' % rno, mod), ('S%d' % rno, status)]:
            xml = set_cell(xml, ref, val)
        changed.append((rno, card, cm.get('H'), hname, cm.get('E'), rarity, status))

    PLAN.SPECS.clear()
    PLAN.SPECS.update(saved)

    backup = write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    print('[ok] 写回 %s' % PATH)
    print('[ok] 备份 %s' % backup)
    print('\n改动 %d 条，保留 %d 条\n' % (len(changed), len(kept)))
    for r, card, old, new, role, rar, st in changed:
        print('  行%-4d %s %-6s %-4s %-5s  %-8s → %-8s %s'
              % (r, card, '', role, rar, old, new, st))
    print('\n未改动（属性已在池内）：')
    for r, card, name, role, rar in kept:
        print('  行%-4d %s %-6s %-4s %-5s %s' % (r, card, '', role, rar, name))
    if weak_note:
        print('\n【主动补强】')
        for card, v in sorted(weak_note.items()):
            print('  %s 被动侧缺口 %.0f VP → 记入主动技能' % (card, v))


if __name__ == '__main__':
    main()
