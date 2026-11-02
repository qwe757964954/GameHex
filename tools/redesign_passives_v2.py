# -*- coding: utf-8 -*-
"""技能设计案2 · 被动技能 V2：统一命名 + 末日植物科技文案 + 1:2:4:10 价值比。

价值模型（VP，1 VP = +1% 面板攻击的等效战力）：
  每条被动（L3 满级）预算：绿 10 / 蓝 20 / 紫 60 / 金 150
  每张卡（绿3条 / 蓝3条 / 紫2条 / 金2条）合计：绿 30 : 蓝 60 : 紫 120 : 金 300 = 1 : 2 : 4 : 10
68001~68005 不动。
"""
import os
import re
import shutil
import datetime
import openpyxl

SRC = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
BACKUP_DIR = r'C:/Users/Administrator/AppData/Local/Temp/tft_backup'
SHEET = '技能设计案 (2)'

# ------------------------------------------------------------------ 价值表
#  1 VP = 「+1% 面板攻击」在标准镜像是上的等效战力增量。
VP = {
    'attack': 1.0, 'maxHp': 1.0,
    'attackSpeed': 0.95, 'damageRate': 1.2,
    'moveSpeed': 0.5, 'attackRange': 0.7,
    'critRate': 0.5, 'critDamage': 0.2, 'lifestealRate': 0.9,
    'pierceCount': 60, 'multiHit': 100, 'bulletNum': 55,
    'explosionDamageRate': 2.0, 'impactDamageRate': 1.5,
    'slowRatio': 1.0, 'executeChance': 1.5, 'shieldRatio': 1.0,
    'counterDamageRate': 0.8, 'counteredDamageReduce': 0.8,
    'allyAtk': 0.9, 'allyHp': 0.9,
}

# ------------------------------------------------------------------ 文案词典
def pct(v):
    return f'{round(v * 100)}'


STATS = {
    'attack': dict(num='rate', short='攻击', layer='基础',
                   text=lambda v: f'攻击提高{pct(v)}%',
                   mod=lambda s: f'unit 域 attack addRate={s}',
                   fx=None),
    'maxHp': dict(num='rate', short='生命上限', layer='基础',
                  text=lambda v: f'最大生命提高{pct(v)}%',
                  mod=lambda s: f'unit 域 maxHp addRate={s}',
                  fx=None),
    'attackSpeed': dict(num='rate', short='攻速', layer='高级',
                        text=lambda v: f'攻击速度提高{pct(v)}%',
                        mod=lambda s: f'unit 域 attackSpeed addRate={s}',
                        fx=None),
    'damageRate': dict(num='rate', short='伤害', layer='高级',
                       text=lambda v: f'伤害提高{pct(v)}%',
                       mod=lambda s: f'unit 域 damageRate addRate={s}',
                       fx=None),
    'moveSpeed': dict(num='rate', short='移速', layer='高级',
                      text=lambda v: f'移动速度提高{pct(v)}%',
                      mod=lambda s: f'unit 域 moveSpeed addRate={s}',
                      fx='P16 复用：移动时留 0.2s 残影'),
    'attackRange': dict(num='rate', short='射程', layer='高级',
                        text=lambda v: f'攻击范围提高{pct(v)}%',
                        mod=lambda s: f'unit 域 attackRange addRate={s}',
                        fx=None),
    'critRate': dict(num='flatpct', short='暴击率', layer='高级',
                     text=lambda v: f'暴击率提高{pct(v)}%',
                     mod=lambda s: f'unit 域 critRate add={s}（整数口径）',
                     fx=None),
    'critDamage': dict(num='flatpct', short='暴伤', layer='高级',
                       text=lambda v: f'暴击伤害提高{pct(v)}%',
                       mod=lambda s: f'unit 域 critDamage add={s}（整数口径）',
                       fx=None),
    'lifestealRate': dict(num='ratio', short='吸血', layer='高级',
                          text=lambda v: f'造成伤害的{pct(v)}%转化为自身生命',
                          mod=lambda s: f'unit 域 lifestealRate add={s}',
                          fx='P11 复用：斧盾兵_锁链(8帧) 缩 20% 宽，从目标拉回自身 0.2s'),
    'pierceCount': dict(num='int', short='穿透', layer='技能',
                        text=lambda v: f'普攻穿透{v}个目标',
                        mod=lambda s: f'skill 域 skillParamJson={{"pierceCount":{s}}}',
                        fx='P2 复用：弓兵_通用箭矢(静态)，每穿透一次透明度降 20%'),
    'multiHit': dict(num='int', short='连击', layer='技能',
                     text=lambda v: f'普攻追加{v}段连击',
                     mod=lambda s: f'skill 域 skillParamJson={{"multiHit":{s}}}',
                     fx='P3 复用：民兵普攻_刀光(5帧)，追加段再播 1 次'),
    'bulletNum': dict(num='int', short='弹数', layer='技能',
                      text=lambda v: f'普攻额外发射{v}发',
                      mod=lambda s: f'skill 域 skillParamJson={{"bulletNum":{s}}}（配 bulletAngle 扇形均分）',
                      fx='P2 复用：同弹道复制 1~2 条，按角度均分'),
    'explosionDamageRate': dict(num='rate', short='溅射', layer='技能',
                                text=lambda v: f'命中对周围造成{pct(v)}%溅射伤害',
                                mod=lambda s: f'skill 域 skillParamJson={{"explosionDamageRate":{s}}}',
                                fx='P5 复用：普攻爆炸(31帧)，随溅射半径同步缩放'),
    'impactDamageRate': dict(num='rate', short='附加伤害', layer='技能',
                             text=lambda v: f'命中额外附加{pct(v)}%伤害',
                             mod=lambda s: f'skill 域 skillParamJson={{"impactDamageRate":{s}}}',
                             fx='P5 复用：普攻爆炸(31帧) 缩 40% 补一层'),
    'slowRatio': dict(num='rate', short='减速', layer='技能',
                      text=lambda v: f'命中使目标移动速度降低{pct(v)}%',
                      mod=lambda s: f'skill 域 skillParamJson={{"slowRatio":{s}}}',
                      fx='P8 复用：冰法师_冰雕(静态) 缩 30% 贴目标脚下'),
    'executeChance': dict(num='rate', short='处决', layer='技能',
                          text=lambda v: f'普攻有{pct(v)}%概率处决残血目标',
                          mod=lambda s: f'skill 域 skillParamJson={{"executeChance":{s}}}',
                          fx='【纯 UI】处决触发时飘字换深红档'),
    'shieldRatio': dict(num='rate', short='护盾', layer='技能',
                        text=lambda v: f'强化击中时为同阵营友军提供最大生命{pct(v)}%的护盾',
                        mod=lambda s: f'skill 域 skillParamJson={{"shieldRatio":{s}}}',
                        fx='P12 复用：刀盾兵_护盾(17帧) 缩 50% 停末帧'),
    'counterDamageRate': dict(num='rate', short='克制增伤', layer='克制',
                              text=None,
                              mod=lambda s: f'unit 域 counterDamageRate addRate={s}（需新增 statId）',
                              fx='【纯 UI】命中克制目标时飘字换金色档'),
    'counteredDamageReduce': dict(num='rate', short='克制减伤', layer='克制',
                                  text=None,
                                  mod=lambda s: f'unit 域 counteredDamageReduce addRate={s}（需新增 statId）',
                                  fx='【纯 UI】被克制方命中时头顶闪一层灰盾'),
    'allyAtk': dict(num='rate', short='友军攻击', layer='克制',
                    text=lambda v: f'6 格内同阵营友军攻击提高{pct(v)}%',
                    mod=lambda s: f'skill 域 aura_team_stat（radius=6，attack addRate={s}）；依赖 1011 光环元件',
                    fx='P13 复用：出生特效 的扩散环压脚下、随本体移动'),
    'allyHp': dict(num='rate', short='友军生命', layer='克制',
                   text=lambda v: f'6 格内同阵营友军最大生命提高{pct(v)}%',
                   mod=lambda s: f'skill 域 aura_team_stat（radius=6，maxHp addRate={s}）；依赖 1011 光环元件',
                   fx='P13 复用：出生特效 的扩散环压脚下、随本体移动'),
}

# ------------------------------------------------------------------ 风味文案
FLAVOR = {
    '废土铁芽': '把废土合金碾成粉末拌进芽鞘，每一次出手都比上一击更沉。',
    '菌甲厚化': '菌丝在表皮下面结成多层板甲，先挨住，再谈反击。',
    '共生体质': '植株与脚下的菌毯共享养分，攻守同时抬一档，不偏科。',
    '异种猎杀协议': '识别克制谱系上的异种孢子标记，命中同一目标时杀伤额外叠一层。',
    '抗性装甲协议': '针对克制自己的谱系预先调制装甲配方，挨打时才生效。',
    '双向协议': '攻防两套配方同时写入菌核，既有猎杀增益也有抗性增益。',
    '共生信号·攻': '向 6 格内的同阵营植株广播攻击指令，随本体移动。',
    '共生信号·守': '向 6 格内的同阵营植株广播护养指令，随本体移动。',
    '共生矩阵': '把攻守两条信号编成同一张网，同阵营植株双向受益。',
    '穿甲苔刺': '苔刺在弹体前缘长成破甲刃，一次穿透后刃口不钝，可以继续吃下一个。',
    '爆囊扩散': '弹体内置孢子爆囊，命中即炸开，把单体伤害摊成一片。',
    '蔓生连打': '藤腕在一次挥击里分裂出额外的打击段，收招不变、伤害翻倍。',
    '孢子弹幕': '把孢子囊并联成弹巢，一次出手泼出多道弹道，覆盖面换单体。',
    '裂变凿击': '弹头在触敌瞬间裂变助推，附加一段与面板无关的固定倍率伤害。',
    '枯萎收割': '对已经枯萎到临界的目标直接执行终止程序，省掉收尾的那几下。',
    '反应堆护膜': '受击瞬间点燃微型反应堆，为同阵营展开一层按最大生命计算的护膜。',
    '黏液阻滞': '命中处留下一摊黏稠孢子液，踩上去的敌人走得比爬还慢。',
    '超视孢子': '把孢子云撒成一张感知网，先看见、先出手，出手也更稳。',
    '吸养根须': '根须顺着创口探进去抽取养分，边打边回。',
    '裂变暴击': '裂隙瞄准镜把弱点标成高亮，命中要害时触发链式裂变。',
}


# ------------------------------------------------------------------ 模板
def T(name, *slots):
    return (name, list(slots))


# 金卡模板（每条预算 150 VP）
GOLD = {
    'A': T('穿甲苔刺', ('pierceCount', [1, 1, 2]), ('attackSpeed', [0.10, 0.16, 0.22]), ('damageRate', [0.06, 0.10, 0.14])),
    'B': T('蔓生连打', ('multiHit', [1, 1, 1]), ('attackSpeed', [0.18, 0.26, 0.34]), ('moveSpeed', [0.12, 0.18, 0.24])),
    'C': T('孢子弹幕', ('bulletNum', [1, 1, 2]), ('attackSpeed', [0.14, 0.20, 0.26]), ('damageRate', [0.08, 0.12, 0.16])),
    'D': T('爆囊扩散', ('explosionDamageRate', [0.30, 0.40, 0.50]), ('attackSpeed', [0.14, 0.20, 0.26]), ('damageRate', [0.06, 0.10, 0.14])),
    'E': T('裂变凿击', ('impactDamageRate', [0.50, 0.64, 0.78]), ('attackSpeed', [0.14, 0.20, 0.26]), ('attackRange', [0.08, 0.12, 0.16])),
    'F': T('枯萎收割', ('executeChance', [0.35, 0.45, 0.55]), ('critRate', [0.20, 0.28, 0.36]), ('damageRate', [0.20, 0.26, 0.32])),
    'G': T('裂变暴击', ('critRate', [0.22, 0.30, 0.38]), ('critDamage', [0.90, 1.20, 1.50]), ('explosionDamageRate', [0.32, 0.40, 0.48])),
    'H': T('吸养根须', ('lifestealRate', [0.30, 0.40, 0.50]), ('damageRate', [0.15, 0.20, 0.25]), ('explosionDamageRate', [0.20, 0.28, 0.36])),
}

# 紫卡模板（每条预算 60 VP）
PURPLE = {
    'p1': T('穿甲苔刺', ('pierceCount', [1, 1, 1])),
    'p2': T('爆囊扩散', ('explosionDamageRate', [0.20, 0.26, 0.32])),
    'p3': T('黏液阻滞', ('slowRatio', [0.30, 0.40, 0.50]), ('moveSpeed', [0.12, 0.16, 0.20])),
    'p4': T('反应堆护膜', ('shieldRatio', [0.30, 0.40, 0.50]), ('attackSpeed', [0.10, 0.14, 0.18])),
    'p5': T('裂变凿击', ('impactDamageRate', [0.25, 0.33, 0.40])),
    'p6': T('超视孢子', ('attackRange', [0.30, 0.40, 0.50]), ('critRate', [0.20, 0.28, 0.36])),
    'p7': T('裂变暴击', ('critRate', [0.22, 0.28, 0.34]), ('critDamage', [0.90, 1.20, 1.50]), ('moveSpeed', [0.15, 0.20, 0.25])),
}

# ------------------------------------------------------------------ 逐卡分配
#  绿（3 条 / 卡，每条 10 VP）
G_THREE = {
    'dps': ["废土铁芽|attack|0.06,0.08,0.10",
            "菌甲厚化|maxHp|0.06,0.08,0.10",
            "共生体质|attack+maxHp|0.03,0.04,0.05"],
    'ehp': ["菌甲厚化|maxHp|0.06,0.08,0.10",
            "废土铁芽|attack|0.06,0.08,0.10",
            "共生体质|attack+maxHp|0.03,0.04,0.05"],
}

SPEC = [
    # ---------------- 绿：68011 法师 / 68012 射手（DPS 序）
    (53, 101101, 'g', G_THREE['dps'][0]),
    (54, 101102, 'g', G_THREE['dps'][1]),
    (55, 101103, 'g', G_THREE['dps'][2]),
    (58, 101201, 'g', G_THREE['dps'][0]),
    (59, 101202, 'g', G_THREE['dps'][1]),
    (60, 101203, 'g', G_THREE['dps'][2]),

    # ---------------- 绿：68019 战士 / 68028 战士（EHP 序）
    (93, 101901, 'g', G_THREE['ehp'][0]),
    (94, 101902, 'g', G_THREE['ehp'][1]),
    (95, 101903, 'g', G_THREE['ehp'][2]),
    (138, 102801, 'g', G_THREE['ehp'][0]),
    (139, 102802, 'g', G_THREE['ehp'][1]),
    (140, 102803, 'g', G_THREE['ehp'][2]),

    # ---------------- 蓝A：68029 坦克（基础向）
    (143, 102901, 'g', "菌甲厚化|maxHp|0.12,0.16,0.20"),
    (144, 102902, 'g', "废土铁芽|attack|0.12,0.16,0.20"),
    (146, 102904, 'g', "共生体质|maxHp+attack|0.05,0.07,0.09"),

    # ---------------- 蓝B：68020 射手（进攻向）
    (98, 102001, 'g', "异种猎杀协议|counterDamageRate|0.15,0.20,0.25"),
    (99, 102002, 'g', "双向协议|counterDamageRate+counteredDamageReduce|0.08,0.10,0.12"),
    (100, 102003, 'g', "共生信号·攻|allyAtk|0.12,0.16,0.20"),

    # ---------------- 蓝B：68021 战士（防御向）
    (103, 102101, 'g', "抗性装甲协议|counteredDamageReduce|0.15,0.20,0.25"),
    (104, 102102, 'g', "双向协议|counteredDamageReduce+counterDamageRate|0.08,0.10,0.12"),
    (105, 102103, 'g', "共生信号·守|allyHp|0.12,0.16,0.20"),

    # ---------------- 蓝B：68030 法师（友军向）
    (148, 103001, 'g', "共生信号·攻|allyAtk|0.12,0.16,0.20"),
    (149, 103002, 'g', "共生信号·守|allyHp|0.12,0.16,0.20"),
    (150, 103003, 'g', "共生矩阵|allyAtk+allyHp|0.08,0.10,0.12"),

    # ---------------- 紫：68006 坦克
    (28, 100601, 'p', 'p3'),
    (29, 100602, 'p', 'p4'),
    # ---------------- 紫：68013 射手
    (63, 101301, 'p', 'p1'),
    (64, 101302, 'p', 'p2'),
    # ---------------- 紫：68014 战士
    (68, 101401, 'p', 'p3'),
    (69, 101402, 'p', 'p7'),
    # ---------------- 紫：68022 法师
    (108, 102201, 'p', 'p5'),
    (109, 102202, 'p', 'p2'),
    # ---------------- 紫：68023 坦克
    (113, 102301, 'p', 'p4'),
    (114, 102302, 'p', 'p6'),
    # ---------------- 紫：68031 坦克
    (153, 103101, 'p', 'p4'),
    (154, 103102, 'p', 'p3'),

    # ---------------- 金：16 张卡 × 2
    (33, 100701, 'A'), (34, 100702, 'B'),          # 68007 吞噬大嘴花 战士
    (38, 100801, 'A'), (39, 100802, 'D'),          # 68008 杰克藕 射手
    (43, 100901, 'B'), (44, 100902, 'D'),          # 68009 仙桃行者 战士
    (48, 101001, 'C'), (49, 101002, 'E'),          # 68010 镭射飞龙 法师
    (73, 101501, 'D'), (74, 101502, 'H'),          # 68015 阿尔萨斯 法师
    (78, 101601, 'G'), (79, 101602, 'D'),          # 68016 萨尔 战士
    (83, 101701, 'C'), (84, 101702, 'D'),          # 68017 泰兰德 射手
    (88, 101801, 'B'), (89, 101802, 'E'),          # 68018 九头蛇 战士
    (118, 102401, 'F'), (119, 102402, 'A'),        # 68024 亡灵法师 法师
    (123, 102501, 'B'), (124, 102502, 'G'),        # 68025 伊利丹 战士
    (128, 102601, 'C'), (129, 102602, 'H'),        # 68026 凯尔萨斯 法师
    (133, 102701, 'H'), (134, 102702, 'A'),        # 68027 亡灵骑士 战士
    (158, 103201, 'B'), (159, 103202, 'D'),        # 68032 吉他手 射手
    (163, 103301, 'G'), (164, 103302, 'E'),        # 68033 运动霸 战士
    (168, 103401, 'C'), (169, 103402, 'G'),        # 68034 魔术师 法师
    (173, 103501, 'A'), (174, 103502, 'F'),        # 68035 科学家 射手
]

TIER_LEVELS = {'绿': (3, 14, 22), '蓝': (0, 14, 22), '紫': (0, 14, 22), '金': (0, 16, 23)}

RATIONALE = {
    '绿': ('绿档只补底盘：攻击、生命、以及两者的均衡成长。三条被动没有一条带机制，'
           '全部是面板直加，落地只需 unit 域各一条 addRate。'),
    '蓝': ('蓝档分两条互斥路线——基础向继续抬面板，克制向改挂克制链'
           '（花果→蘑菇→盆栽→僵尸→花果；法师→坦克→射手→战士→法师）。'
           '克制向又分进攻（对克制目标增伤）、防御（受克制方减伤）、友军（同阵营光环）三张面孔，'
           '同一张卡只走其中一张。'),
    '紫': ('紫档是「一处机制 + 一处倍率」：一条改结算形状（穿透 / 溅射 / 连击 / 护盾 / 减速 / 处决），'
           '一条改面板之外的出手效率。'),
    '金': ('金档是「一处必杀机制 + 一到两处倍率」：每条被动都以穿透、连击、多弹、溅射、附加伤害或处决为主干，'
           '其余词缀只为把这处机制推到能吃满的程度。'),
}


def parse_inline(spec):
    """把 '名|统计|0.06,0.08,0.10' 解析成模板。"""
    name, stats, vals = spec.split('|')
    nums = [float(x) for x in vals.split(',')]
    slots = []
    for st in stats.split('+'):
        nums2 = [int(n) if STATS[st]['num'] == 'int' else n for n in nums]
        slots.append((st, nums2))
    return (name, slots)


def slot_of(item):
    if len(item) == 3:          # (row, sid, 'A') —— 金卡模板
        return GOLD[item[2]]
    kind, payload = item[2], item[3]
    if kind == 'g':             # (row, sid, 'g', '名|词缀|三级值') —— 绿/蓝内联
        return parse_inline(payload)
    return PURPLE[payload]      # (row, sid, 'p', 'p1') —— 紫卡模板


def fmt(stat, vals):
    num = STATS[stat]['num']
    if num == 'int':
        return '/'.join(str(int(v)) for v in vals)
    if num == 'flatpct':
        return '/'.join(str(round(v * 100)) for v in vals)
    return '/'.join(f'{v:.2f}' for v in vals)


def vp_of(stat, v):
    if STATS[stat]['num'] == 'int':
        return v * VP[stat]
    return v * 100 * VP[stat]


def total_vp(slots):
    return sum(vp_of(st, vals[-1]) for st, vals in slots)


def slot_text(stat, v, counter, countered):
    meta = STATS[stat]
    if stat == 'counterDamageRate':
        camp, role = counter
        return f'对{camp}阵营 / {role}职业的目标伤害提高{pct(v)}%'
    if stat == 'counteredDamageReduce':
        camp, role = countered
        return f'受到{camp}阵营 / {role}职业目标的伤害降低{pct(v)}%'
    return meta['text'](v)


def build_context(q_text, r_text):
    def split(text):
        camp = role = ''
        for seg in str(text or '').split('·'):
            seg = seg.strip()
            if seg.endswith('阵营'):
                camp = seg[:-2]
            elif seg.endswith('职业'):
                role = seg[:-2]
        return camp, role
    c_camp, c_role = split(q_text)
    d_camp, d_role = split(r_text)
    return (c_camp or '克制', c_role or '职业'), (d_camp or '被克制', d_role or '职业')


def main():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    backup = os.path.join(BACKUP_DIR, f'技能设计案2_before_passive_v2_{stamp}.xlsx')
    shutil.copy2(SRC, backup)
    print('[backup]', backup)

    wb = openpyxl.load_workbook(SRC)
    ws = wb[SHEET]
    freeze = ws.freeze_panes
    audit = []

    for item in SPEC:
        row, sid = item[0], item[1]
        got = ws.cell(row, 7).value
        assert str(got).strip() == str(sid), f'row {row} 技能ID 不符：{got} != {sid}'

        name, slots = slot_of(item)
        rarity = str(ws.cell(row, 6).value)
        if rarity.startswith('绿'):
            tier = '绿'
        elif rarity.startswith('蓝'):
            tier = '蓝'
        elif rarity.startswith('紫'):
            tier = '紫'
        else:
            tier = '金'

        card = str(ws.cell(row, 1).value)
        card_name = ws.cell(row, 2).value
        old_name = ws.cell(row, 8).value
        counter, countered = build_context(ws.cell(row, 17).value, ws.cell(row, 18).value)

        ws.cell(row, 8).value = name

        # 等级标签沿用原值
        levels = []
        for col in (11, 12, 13):
            m = re.search(r'兵种\s*(\d+)\s*级', str(ws.cell(row, col).value or ''))
            levels.append(int(m.group(1)) if m else None)
        fb = TIER_LEVELS[tier]
        levels = [lv if lv is not None else fb[i] for i, lv in enumerate(levels)]

        # ---- K/L/M
        ALLY = '6 格内同阵营友军'
        for i, col in enumerate((11, 12, 13)):
            parts = [slot_text(st, vals[i], counter, countered) for st, vals in slots]
            for k in range(1, len(parts)):
                if parts[k].startswith(ALLY) and any(p.startswith(ALLY) for p in parts[:k]):
                    parts[k] = '其' + parts[k][len(ALLY):]
            tail = ''
            flat_slots = [st for st, vals in slots if STATS[st]['num'] != 'int']
            if not flat_slots and i > 0:
                tail = '（与 L1 同值，本级为解锁而非成长）'
            ws.cell(row, col).value = f'L{i + 1}（兵种 {levels[i]} 级）：' + '，'.join(parts) + tail

        # ---- N 技能详述
        vp = total_vp(slots)
        def _one(st, vals):
            short = STATS[st]['short']
            if STATS[st]['num'] == 'int':
                v = int(vals[2])
                return f'{short} {v}（三级同值）' if len({int(x) for x in vals}) == 1 else f'{short} {int(vals[0])} → {v}'
            if len({round(x * 100) for x in vals}) == 1:
                return f'{short} {pct(vals[2])}%（三级同值）'
            return f'{short} {pct(vals[0])}% → {pct(vals[2])}%'

        summary = '；'.join(_one(st, vals) for st, vals in slots)
        ws.cell(row, 14).value = (
            f'{FLAVOR.get(name, "")}{RATIONALE[tier]}\n'
            f'【{name}】{summary}；满级价值约 {vp:.0f} VP，本档预算 '
            f'{ {"绿": 10, "蓝": 20, "紫": 60, "金": 150}[tier] } VP。'
        )

        # ---- O 表现描述
        fxs = []
        for st, _ in slots:
            fx = STATS[st]['fx']
            if fx and fx not in fxs:
                fxs.append(fx)
        if fxs:
            joined = '；'.join(fxs)
            suffix = '' if '零新增' in joined else '；均为现有资源复用，零新增'
            ws.cell(row, 15).value = joined + '。' + suffix.lstrip('；') + ('。' if suffix else '')
        else:
            ws.cell(row, 15).value = ('【无独立特效】纯面板与倍率提升，不产生场景演出；'
                                      '命中飘字沿用现有字号与颜色档，零新增资源。')

        # ---- P 落地口径
        mods = [STATS[st]['mod'](fmt(st, vals)) for st, vals in slots]
        tail = ''
        if tier in ('紫', '金'):
            tail = '；skill 域参数按「同 unitId:pvpSkillId 参数叠加」合并进本卡普攻技能行'
        elif tier == '蓝' and any(st in ('counterDamageRate', 'counteredDamageReduce') for st, _ in slots):
            tail = '；克制倍率在 cardCounterMultiplier 结算，新增字段只需在倍率处再乘一次'
        ws.cell(row, 16).value = ' + '.join(mods) + tail

        audit.append(dict(row=row, card=card, card_name=card_name, sid=sid,
                          old=old_name, name=name, tier=tier, vp=vp,
                          rarity=rarity))

    # ---- 68001~68005 原样保留，仅取出来做比值参照
    frozen = []
    for r in range(2, ws.max_row + 1):
        if str(ws.cell(r, 1).value) in ('68001', '68002', '68003', '68004', '68005'):
            if '被动' in str(ws.cell(r, 9).value):
                frozen.append((r, ws.cell(r, 8).value))

    ws.freeze_panes = freeze
    wb.save(SRC)

    # ---- 核算
    from collections import defaultdict
    per_card = defaultdict(float)
    per_tier = defaultdict(list)
    for a in audit:
        per_card[(a['card'], a['card_name'], a['tier'])] += a['vp']
    for (card, cname, tier), v in sorted(per_card.items(), key=lambda kv: (kv[0][2], kv[0][0])):
        per_tier[tier].append(v)
    print('[saved]', SRC, '| rows', len(audit))
    order = ['绿', '蓝', '紫', '金']
    base = sum(per_tier['绿']) / len(per_tier['绿'])
    for t in order:
        vals = per_tier[t]
        avg = sum(vals) / len(vals)
        print(f'  {t}: 卡数 {len(vals)}  总VP {avg:6.1f}  (min {min(vals):.0f} / max {max(vals):.0f})  比值 {avg / base:.2f}')
    return audit, per_card, frozen


if __name__ == '__main__':
    main()
