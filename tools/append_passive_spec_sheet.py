# -*- coding: utf-8 -*-
"""给 技能设计案2.xlsx 补「被动重设计口径」页，并追加两张记录页。"""
import datetime
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

SRC = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
wb = openpyxl.load_workbook(SRC)

H1 = Font(name='微软雅黑', size=13, bold=True, color='FF1F3864')
H2 = Font(name='微软雅黑', size=11, bold=True, color='FF2E5C8A')
BODY = Font(name='微软雅黑', size=10)
MONO = Font(name='Consolas', size=9)
HEAD_FILL = PatternFill('solid', fgColor='FFDCE6F1')
SEP = Border(bottom=Side(style='thin', color='FFB7C9DC'))


def put(ws, row, values, font=BODY, fill=None, wrap=True):
    for i, v in enumerate(values, start=1):
        c = ws.cell(row, i)
        c.value = v
        c.font = font
        c.alignment = Alignment(wrap_text=wrap, vertical='top')
        if fill:
            c.fill = fill


# ------------------------------------------------------------ 口径页
NAME = '被动重设计口径'
if NAME in wb.sheetnames:
    del wb[NAME]
ws = wb.create_sheet(NAME, 1)
for col, w in zip('ABCDEF', (16, 20, 34, 30, 34, 12)):
    ws.column_dimensions[col].width = w

r = 1
ws.cell(r, 1).value = '被动技能重设计 · 属性分层与品级口径（2026-10-30）'
ws.cell(r, 1).font = H1
r += 1
ws.cell(r, 1).value = ('把 68006~68035 共 30 张卡、68 条被动全部改成纯数值成长，不再出现召唤 / 瞬移 / 击退 / 眩晕 / 嘲讽 / '
                       '反弹这类「类主动」效果；68001~68005（豌豆游侠、巨力坚果、火焰树妖、玉林好汉、椰蛋战士）的被动保持原样。')
ws.cell(r, 1).font = BODY
ws.cell(r, 1).alignment = Alignment(wrap_text=True, vertical='top')
ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
ws.row_dimensions[r].height = 46
r += 2

# ---- 一 · 属性四层
ws.cell(r, 1).value = '一 · 属性四层（每个字段都对应代码里真实读得到的位置）'
ws.cell(r, 1).font = H2
r += 1
put(ws, r, ['层', '属性', 'statId / 参数', '口径', '落点', '需新增'],
    font=Font(name='微软雅黑', size=10, bold=True), fill=HEAD_FILL)
ws.row_dimensions[r].height = 22
r += 1

LAYERS = [
    ('基础属性', '生命上限', 'maxHp', 'addRate，按基础值乘（0.10 = +10%）', 'ZCUnitStatPatch.maxHpPct', '否'),
    ('基础属性', '攻击力', 'attack', 'addRate（0.10 = +10%）', 'ZCUnitStatPatch.attackPct', '否'),
    ('高级属性', '攻击速度', 'attackSpeed', 'addRate（0.18 = +18%）', 'ZCUnitStatPatch.attackSpeedPct', '否'),
    ('高级属性', '暴击率', 'critRate', 'add，**整数口径**（12 = +12%）', 'ZCUnitStatPatch.critRatePct', '否'),
    ('高级属性', '暴击伤害', 'critDamage', 'add，**整数口径**（60 = +60%）', 'ZCUnitStatPatch.critDamagePct', '否'),
    ('高级属性', '最终伤害倍率', 'damageRate', '只接受 addRate（0.15 = +15%），面板不变', 'ZCUnitStatPatch.damageRatePct', '否'),
    ('高级属性', '移动速度', 'moveSpeed', 'addRate（0.15 = +15%）', 'ZCUnitStatPatch.moveSpeedPct', '否'),
    ('高级属性', '攻击范围', 'attackRange', 'addRate（0.10 = 范围 +10%）', 'ZCUnitStatPatch.attackRangePct', '否'),
    ('高级属性', '吸血', 'lifestealRate', 'add，**比例口径**（0.03 = 造成伤害的 3%）', 'ZCUnitStatPatch.lifestealRate', '否'),
    ('技能属性', '穿透', 'pierceCount', 'skillParamJson，整数', 'ZCAttackResolutionSystem:531', '否'),
    ('技能属性', '连击段数', 'attackCount → multiHit', 'skillParamJson，整数', 'ZCAttackResolutionSystem:146', '否'),
    ('技能属性', '弹数', 'bulletNum', 'skillParamJson，整数（配 bulletAngle 扇形均分）', 'ZCAttackResolutionSystem:413', '否'),
    ('技能属性', '溅射', 'explosionDamageRate', 'skillParamJson，0.30 = 30% 溅射', 'ZCAttackResolutionSystem:527', '否'),
    ('技能属性', '附加伤害', 'impactDamageRate', 'skillParamJson，0.20 = 额外 20%', 'ZCAttackResolutionSystem:403', '否'),
    ('技能属性', '减速', 'slowRatio', 'skillParamJson，0.25 = 移速 -25%', 'ZCAttackResolutionSystem:552', '否'),
    ('技能属性', '处决', 'executeChance', 'skillParamJson，0.14 = 14% 概率', 'ZCAttackResolutionSystem:539', '否'),
    ('技能属性', '友军护盾', 'shieldRatio', 'skillParamJson，0.18 = 最大生命 18%（全队光环盾）', 'ZCAttackResolutionSystem:462', '否'),
    ('克制关系', '对克制目标增伤', 'counterDamageRate', 'addRate（0.13 = 对克制目标 +13%）', 'cardCounterMultiplier（ZCCombatCatalog:274）', '**是**'),
    ('克制关系', '受克制方减伤', 'counteredDamageReduce', 'addRate（0.13 = 受到的伤害 -13%）', 'cardCounterMultiplier（ZCCombatCatalog:274）', '**是**'),
    ('克制关系', '同阵营友军增益', 'aura_team_stat', 'skill 域光环，radius=6，attack / maxHp addRate', '依赖 1011 自身光环元件', '依赖元件'),
]
for row in LAYERS:
    put(ws, r, list(row))
    for c in range(1, 7):
        ws.cell(r, c).border = SEP
    ws.row_dimensions[r].height = 20
    r += 1

r += 1
ws.cell(r, 1).value = '二 · 品级规则'
ws.cell(r, 1).font = H2
r += 1
put(ws, r, ['品级', '规则', '词缀构成', 'L1/L2/L3 解锁', '典型数值档', ''],
    font=Font(name='微软雅黑', size=10, bold=True), fill=HEAD_FILL)
r += 1
TIERS = [
    ('绿（1）', '只做基础属性：血量 / 伤害', '1~2 条（进攻条 / 生命条 / 双修条）', '兵种 3 / 14 / 22 级',
     '主属性 +10/+12/+14%；双修 +5/+6/+7%'),
    ('蓝（2）· 路线A', '基础属性（同绿卡，档位更高）', '1~2 条', '兵种 0 / 14 / 22 级',
     '主属性 +15/+18/+21%；双修 +8/+10/+12%'),
    ('蓝（2）· 路线B', '克制关系属性：进攻向 / 防御向 / 友军向，三选一', '1~2 条', '兵种 0 / 14 / 22 级',
     '主词缀 +10/+13/+16%；双修 +5/+6/+7%；友军向 +4/+7/+12%'),
    ('紫（3）', '技能属性 + 高级属性，技能属性主导', '2 条（每条 1 技能 + 1 高级）', '兵种 0 / 14 / 22 级',
     '技能 +10~30% 或穿透 1/1/2；高级 +8~20%'),
    ('金（4）', '高级属性 + 技能属性，高级属性主导', '3 条（2 高级 + 1 技能）', '兵种 0 / 16 / 23 级',
     '高级 +12~32%；技能穿透 1/2/3、溅射 20/30/40%、处决 10/14/18%'),
]
for row in TIERS:
    put(ws, r, list(row) + [''])
    for c in range(1, 6):
        ws.cell(r, c).border = SEP
    ws.row_dimensions[r].height = 34
    r += 1

r += 1
ws.cell(r, 1).value = '三 · 「克制关系属性」为什么有三种表达'
ws.cell(r, 1).font = H2
r += 1
for line in [
    '克制链：花果 → 蘑菇 → 盆栽 → 僵尸 → 花果（阵营）；法师 → 坦克 → 射手 → 战士 → 法师（职业）。',
    '原有实现只有一条：出手方命中被克制方时伤害 ×1.3（cardCounterMultiplier），且是全局规则、没有可配的个体修正项。',
    '所以蓝卡的「克制关系属性」被拆成三个子方向，每张卡三选一，同级互斥：',
    '  · 进攻向（4 张里的 68020 三叶小丑）：对「自己克制的阵营/职业」增伤 —— 打得对才赚。',
    '  · 防御向（68021 血蹄）：受到「克制自己的阵营/职业」的伤害降低 —— 站得住才赚。',
    '  · 友军向（68030 篮球天才）：给「同阵营友军」加攻击 / 生命 —— 克制链上的协同收益，自己不打也能赚。',
    '  · 基础向（68029 金发统领）：放弃克制，直接换面板 —— 数值最稳、不看对手。',
    '友军向走的是 1011 自身光环元件（aura_team_stat，radius=6，随本体移动），不需要新增属性字段；',
    '进攻向 / 防御向需要新增两个 statId（见第四节）。',
]:
    ws.cell(r, 1).value = line
    ws.cell(r, 1).font = BODY
    ws.cell(r, 1).alignment = Alignment(wrap_text=True, vertical='top')
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
    ws.row_dimensions[r].height = 18 if len(line) < 60 else 32
    r += 1

r += 1
ws.cell(r, 1).value = '四 · 需要新增的代码字段（只有两个）'
ws.cell(r, 1).font = H2
r += 1
for line in [
    'StatId：counterDamageRate、counteredDamageReduce。三处登记：ZCStatSchema 的 ZCStatId 联合类型 / STAT_IDS / '
    'ZCModifierRuntime 的 ZCUnitStatPatch（counterDamageRatePct、counteredDamageReducePct 两个百分数字段）。',
    '消费点：ZCCombatCatalog.cardCounterMultiplier 现在只返回 rules 里的 damageMultiplier；改为在此基础上再乘 '
    '(1 + 攻方.counterDamageRatePct/100) 与 (1 - 守方.counteredDamageReducePct/100)，两项缺省 0 ⇒ 既有单位行为逐字不变。',
    '工作量：约半天（含 3 条单测：无字段时行为不变 / 增伤生效 / 减伤生效且不吃穿护盾）。',
    '降级方案（不想动代码时）：把 counterDamageRate 改写成 damageRate、counteredDamageReduce 改写成 maxHp addRate，'
    '数值打 7 折，代价是「只在克制时生效」这层条件消失了，蓝卡变成小号紫卡。',
]:
    ws.cell(r, 1).value = line
    ws.cell(r, 1).font = BODY
    ws.cell(r, 1).alignment = Alignment(wrap_text=True, vertical='top')
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
    ws.row_dimensions[r].height = 34
    r += 1

r += 1
ws.cell(r, 1).value = '五 · 本轮改名（原名与新效果冲突的 13 条）'
ws.cell(r, 1).font = H2
r += 1
put(ws, r, ['技能ID', '卡牌', '原名', '新名', '改名原因', ''],
    font=Font(name='微软雅黑', size=10, bold=True), fill=HEAD_FILL)
r += 1
RENAMES = [
    (101103, '冰法师', '冰峰', '寒霜根基', '原名是「每 7 次普攻放一次冰峰」的计数触发，属于类主动'),
    (101401, '驭兽师', '兽群号令', '兽血共鸣', '原名是召唤物/野兽专属光环，现在改为自身连击 + 攻速'),
    (101903, '狼骑兵', '钩索拉拽', '缠索战法', '原名是拉拽位移 + 路径伤害，现在是生命/攻击双修'),
    (102201, '萨满', '先祖图腾', '先祖之力', '原名是友军攻速光环图腾，现在是自身攻速 + 多弹'),
    (102202, '萨满', '净化图腾', '净化之息', '原名是友军回复 + 解控光环，现在是移速 + 减速'),
    (102402, '亡灵法师', '骸骨仆从', '白骨咒印', '原名是召唤骷髅，属于召唤类，必须去掉'),
    (102502, '伊利丹', '闪避本能', '猎影本能', '原名是闪避 + 闪避后增益，现有字段没有闪避'),
    (102602, '凯尔萨斯', '魔力虹吸', '魔力回响', '原名是击杀回血 + 下次技能增伤，属于事件触发'),
    (102702, '亡灵骑士', '恐惧威压', '亡者威势', '原名是敌方减益光环，现在改为自身暴击向'),
    (102803, '饥饿战士', '饥饿餐箱', '饱食之力', '原名是阵亡爆炸，触发条件是死亡，不属于成长'),
    (103003, '篮球天才', '铁山靠', '铁山体魄', '原名是周期性击退，属于类主动'),
    (103302, '运动霸', '空间跳跃', '无重力步', '原名是瞬移到最近敌人，属于位移类'),
    (103402, '魔术师', '幻象挺身', '幻影韧性', '原名是闪避 + 概率免死，现有字段没有闪避/免死'),
]
for row in RENAMES:
    put(ws, r, list(row) + [''])
    for c in range(1, 6):
        ws.cell(r, c).border = SEP
    ws.row_dimensions[r].height = 20
    r += 1

r += 1
ws.cell(r, 1).value = '六 · 两点平衡提醒'
ws.cell(r, 1).font = H2
r += 1
for line in [
    '1) 金卡这轮不再给任何纯面板（maxHp / attack）。金卡的强度 100% 来自倍率与结算形状，'
    '所以它对「攻速、暴击、克制关系」的敏感度远高于绿卡；绿卡则相反，吃的是绝对面板。这是有意为之的分工，'
    '但如果后续发现金卡在低等级段（兵种 0~15 级）偏弱，优先补的是「高级属性的基础档」，而不是回退加面板。',
    '2) 紫/金的技能属性都写成 skillParamJson，按「同 unitId:pvpSkillId 参数叠加」合并进本卡普攻技能行；'
    '也就是说一个被动想改两个技能参数，需要两行计划行，不能挤在一行里。',
]:
    ws.cell(r, 1).value = line
    ws.cell(r, 1).font = BODY
    ws.cell(r, 1).alignment = Alignment(wrap_text=True, vertical='top')
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
    ws.row_dimensions[r].height = 46
    r += 1

ws.freeze_panes = 'A4'

# ------------------------------------------------------------ 本次改动说明
ws2 = wb['本次改动说明']
r2 = ws2.max_row + 1
if ws2.cell(r2 - 1, 1).value not in (None, ''):
    r2 += 1


def put2(row, label, text, header=False):
    a = ws2.cell(row, 1)
    a.value = label
    a.font = Font(name='微软雅黑', size=11, bold=True, color='FF2E5C8A') if header else Font(name='微软雅黑', size=10, bold=True)
    a.alignment = Alignment(wrap_text=True, vertical='top')
    if text is not None:
        b = ws2.cell(row, 2)
        b.value = text
        b.font = BODY
        b.alignment = Alignment(wrap_text=True, vertical='top')
    return row + 1


r2 = put2(r2, '被动技能重设计 · 2026-10-30', None, header=True)
r2 = put2(r2, '做了什么', '把 68006~68035 共 30 张卡的 68 条被动，从「各写一套机制（召唤、瞬移、击退、嘲讽、反弹、减伤、回血…）」'
                        '统一收敛成纯数值成长，并按品级分层：绿=基础属性（血量/伤害），蓝=基础属性或克制关系属性二选一，'
                        '紫=技能属性+高级属性，金=高级属性+技能属性。68001~68005 的被动一字未动。')
r2 = put2(r2, '为什么这么改', '原来的 68 条被动里，能直接落地的不到 1/3：闪避、减伤、格挡、反弹、受治疗、召唤、嘲讽、'
                              '免死这些在 ZCUnitStatPatch 里根本没有对应字段，写完也只能挂在「待实现」。'
                              '改成纯数值后，每条被动都能落到一个真实存在、且已经被单测覆盖的字段上，'
                              '配表当天就能生效，不需要等新机制。')
r2 = put2(r2, '品级怎么分层', '绿 1~2 条、全是基础属性；蓝 1~2 条、基础向或克制向二选一；紫 2 条、每条 1 技能属性 + 1 高级属性；'
                              '金 3 条、2 高级属性 + 1 技能属性。完整词典与数值档见新页【被动重设计口径】。')
r2 = put2(r2, '克制关系属性的三种表达', '进攻向（对克制目标增伤）/ 防御向（受克制方减伤）/ 友军向（同阵营友军加攻或加血），'
                                        '蓝卡三选一。68020 三叶小丑走进攻、68021 血蹄走防御、68030 篮球天才走友军、'
                                        '68029 金发统领放弃克制换面板。友军向不需要新字段（走 1011 光环元件），'
                                        '进攻/防御向需要新增 counterDamageRate、counteredDamageReduce 两个 statId。')
r2 = put2(r2, '补齐了哪些空白', '5 行：100103（P 落地口径）、100104（N 详述，P 同步更正为已实装的 burst 连发机制）、'
                               '100704（K/L/M 三级 + O 表现 + P 落地）、101003（K/L/M + N + P）、101004（K/L/M + N + O + P）。'
                               '补完之后【技能设计案 (2)】A~R 共 18 列、175 行数据零空白单元格。')
r2 = put2(r2, '改名了 13 条', '原名和新效果冲突的被动都改了名（冰峰→寒霜根基、骸骨仆从→白骨咒印、空间跳跃→无重力步…），'
                              '完整对照在【被动重设计口径】第五节。')
r2 = put2(r2, '口径上的一处坑（顺手纠正）', 'critRate / critDamage 走的是 foldStatPatch 的 flat 分支，'
                                            '这两个字段在下游是「百分数 ÷ 100」使用，所以表里必须写 12、60，'
                                            '不能写 0.12、0.6。旧稿 100702 写的 add=0.08 实际只有 +0.08%，已在本轮全部改正。')
r2 = put2(r2, '100103 的 N 列与 L 列不一致（未改，仅记录）', 'L 列写的是「移动速度降低 5/15/25%」，N 列写的是「攻速降低 15/20/25%」。'
                                                            'P 列按 L 列的移速口径填（slowRatio），N 列的攻速说法属于旧稿笔误，'
                                                            '因为 68001 本轮不动，所以留着不改，等下次动这张卡时一并纠正。')

# ------------------------------------------------------------ 实现明细
ws3 = wb['技能实现改动明细']
r3 = ws3.max_row + 1
if ws3.cell(r3 - 1, 1).value not in (None, ''):
    r3 += 1

hdr3 = ['被动重设计 · 2026-10-30', None, None]
c = ws3.cell(r3, 1)
c.value = '被动技能重设计 · 代码侧增量清单（2026-10-30）'
c.font = Font(name='微软雅黑', size=11, bold=True, color='FF2E5C8A')
r3 += 1

put3_rows = [
    ('结论', '零改代码可落地的：66 条 / 68 条。需要新增代码的：2 个 statId（只被 68020、68021 两张蓝卡用到）。'),
    ('新增 statId · counterDamageRate', 'ZCStatSchema：ZCStatId 联合类型加一项、STAT_IDS 加一项；'
                                        'ZCModifierRuntime：ZCUnitStatPatch 加 counterDamageRatePct（百分数整数）。'),
    ('新增 statId · counteredDamageReduce', '同上，字段名 counteredDamageReducePct。'),
    ('消费点', 'ZCCombatCatalog.cardCounterMultiplier 目前只读 rules 的 damageMultiplier（出手 ×1.3）。'
               '改为：命中判定成立时再乘 (1 + 攻方 counterDamageRatePct/100) × (1 - 守方 counteredDamageReducePct/100)。'
               '两项缺省 0 ⇒ 乘 1，既有单位伤害逐字不变。'),
    ('注意', '减伤要乘在「克制倍率之后、护盾结算之前」，否则高倍率下会出现反向受益；'
             '同时要确保它不参与 lifestealRate 的回血反算（回血按 damageUnit 的 applied，天然满足）。'),
    ('单测', '三条：① 不配字段时伤害与改造前逐字一致；② 攻方配 0.13 且守方是克制目标时伤害 ×1.13；'
             '③ 守方配 0.13 且攻方是克制方时实际扣血 ×0.87，且护盾吸收部分不计入回血。'),
    ('不用改的部分', 'maxHp / attack / attackSpeed / critRate / critDamage / damageRate / moveSpeed / attackRange / '
                     'lifestealRate 九个字段，typedToLegacyPatch 与 foldStatPatch 都已支持；'
                     'pierceCount / multiHit / bulletNum / explosionDamageRate / impactDamageRate / slowRatio / '
                     'executeChance / shieldRatio 八个技能参数，ZCAttackResolutionSystem 已有消费点，走 skillParamJson 即可。'),
    ('友军向光环', 'aura_team_stat（radius=6，作用域 ally）已有元件规划（1011），68030 三条被动都靠它；'
                   '如果 1011 还没实装，这 3 条会先空转，需要先补元件。'),
]
for label, text in put3_rows:
    a = ws3.cell(r3, 1)
    a.value = label
    a.font = Font(name='微软雅黑', size=10, bold=True)
    a.alignment = Alignment(wrap_text=True, vertical='top')
    b = ws3.cell(r3, 2)
    b.value = text
    b.font = BODY
    b.alignment = Alignment(wrap_text=True, vertical='top')
    r3 += 1

wb.save(SRC)
print('[saved]', SRC)
print('sheets:', wb.sheetnames)
print('口径页 rows:', ws.max_row, ' 改动说明 rows:', ws2.max_row, ' 实现明细 rows:', ws3.max_row)
