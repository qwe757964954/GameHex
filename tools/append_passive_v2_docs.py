# -*- coding: utf-8 -*-
"""被动 V2 的说明页 + 价值核算页 + 两张记录页追加。"""
import importlib.util
import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from collections import defaultdict

SRC = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
spec = importlib.util.spec_from_file_location('v2', r'D:/Alan/Project/POW/Demo3.8/tools/redesign_passives_v2.py')
V2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(V2)

H1 = Font(name='微软雅黑', size=13, bold=True, color='FF1F3864')
H2 = Font(name='微软雅黑', size=11, bold=True, color='FF2E5C8A')
TH = Font(name='微软雅黑', size=10, bold=True)
BODY = Font(name='微软雅黑', size=10)
HEAD_FILL = PatternFill('solid', fgColor='FFDCE6F1')
SUM_FILL = PatternFill('solid', fgColor='FFF2F7FB')
SEP = Border(bottom=Side(style='thin', color='FFB7C9DC'))

wb = openpyxl.load_workbook(SRC)
ws0 = wb['技能设计案 (2)']

# ---------------------------------------------------------------- 取数
rows_info = []
for item in V2.SPEC:
    r = item[0]
    name, slots = V2.slot_of(item)
    rarity = str(ws0.cell(r, 6).value)
    tier = rarity[0]
    rows_info.append(dict(
        row=r, card=str(ws0.cell(r, 1).value), card_name=ws0.cell(r, 2).value,
        role=ws0.cell(r, 5).value, rarity=rarity, tier=tier,
        sid=str(ws0.cell(r, 7).value), old=ws0.cell(r, 8).value, name=name,
        slots=slots, vp=V2.total_vp(slots),
    ))

card_vp = defaultdict(float)
card_meta = {}
for it in rows_info:
    card_vp[it['card']] += it['vp']
    card_meta[it['card']] = it
tier_cards = defaultdict(list)
for c, v in card_vp.items():
    tier_cards[card_meta[c]['tier']].append((c, v))
tier_avg = {t: sum(v for _, v in lst) / len(lst) for t, lst in tier_cards.items()}
base = tier_avg['绿']

# ---------------------------------------------------------------- 口径页（重建）
NAME = '被动重设计口径'
if NAME in wb.sheetnames:
    del wb[NAME]
ws = wb.create_sheet(NAME, 1)
for col, w in zip('ABCDEFG', (15, 18, 30, 26, 30, 30, 12)):
    ws.column_dimensions[col].width = w


def put(row, values, font=BODY, fill=None):
    for i, v in enumerate(values, start=1):
        c = ws.cell(row, i)
        c.value = v
        c.font = font
        c.alignment = Alignment(wrap_text=True, vertical='top')
        if fill:
            c.fill = fill


def band(row, text, height=34):
    c = ws.cell(row, 1)
    c.value = text
    c.font = BODY
    c.alignment = Alignment(wrap_text=True, vertical='top')
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=7)
    ws.row_dimensions[row].height = height


r = 1
ws.cell(r, 1).value = '被动技能方案 V2 · 统一命名 / 末日植物科技文案 / 1:2:4:10 价值比（2026-10-30）'
ws.cell(r, 1).font = H1
r += 1
band(r, '本轮只改技能数值、技能名与技能文案：面板、主动技能、解锁等级一律不动。'
        '68001 豌豆游侠 / 68002 巨力坚果 / 68003 火焰树妖 / 68004 玉林好汉 / 68005 椰蛋战士 的被动保持原样。'
        '68 条被动按「价值点 VP」重新分配，使 绿:蓝:紫:金 = 1 : 2 : 4 : 10；同品级内四职业按同一预算封顶，'
        'DPS 型拿倍率、EHP 型拿面板，乘积口径下强度对齐。', 52)
r += 2

# ---- 一 · 价值模型
ws.cell(r, 1).value = '一 · 价值模型：VP 怎么算'
ws.cell(r, 1).font = H2
r += 1
band(r, '1 VP = 「+1% 面板攻击」在标准镜像靶上的等效战力增量。所有词缀先折算成 VP，再按品级预算分配，'
        '这样「1:2:4:10」是可以逐条加出来验收的，而不是凭手感。', 32)
r += 1
put(r, ['属性层', '词缀', '折算口径', '单位 VP', '依据', '', ''], font=TH, fill=HEAD_FILL)
r += 1

VP_DOC = [
    ('基础', '攻击 attack', '1% = 1 VP', '1.0', '锚点：面板直加'),
    ('基础', '生命 maxHp', '1% = 1 VP', '1.0', 'EHP 线性，与 DPS 同权'),
    ('高级', '攻速 attackSpeed', '1% = 0.95 VP', '0.95', '受出手节拍与走位打断约束'),
    ('高级', '伤害倍率 damageRate', '1% = 1.2 VP', '1.2', '独立乘区，不吃面板二次放大'),
    ('高级', '移速 moveSpeed', '1% = 0.5 VP', '0.5', '间接收益（先手、追击、脱战）'),
    ('高级', '射程 attackRange', '1% = 0.7 VP', '0.7', '先手与覆盖，不改单点 DPS'),
    ('高级', '暴击率 critRate', '1% = 0.5 VP', '0.5', '基础暴伤 1.5x ⇒ +0.5% DPS'),
    ('高级', '暴击伤害 critDamage', '1% = 0.2 VP', '0.2', '按暴击率 20% 折算，需配合暴击率'),
    ('高级', '吸血 lifestealRate', '1% = 0.9 VP', '0.9', 'DPS→EHP，受溢出与护盾惩罚'),
    ('技能', '穿透 pierceCount', '1 目标 = 60 VP', '60', '双目标有效输出翻倍，单目标为 0'),
    ('技能', '连击 multiHit', '1 段 = 100 VP', '100', '单体伤害翻倍，但不重复触发状态'),
    ('技能', '弹数 bulletNum', '1 发 = 55 VP', '55', '多目标分摊，单目标收益递减'),
    ('技能', '溅射 explosionDamageRate', '1% = 2.0 VP', '2.0', '按 2 目标聚集度折算'),
    ('技能', '附加伤害 impactDamageRate', '1% = 1.5 VP', '1.5', '只在命中那一击生效'),
    ('技能', '减速 slowRatio', '1% = 1.0 VP', '1.0', '控制换输出窗口'),
    ('技能', '处决 executeChance', '1% = 1.5 VP', '1.5', '只对残血生效，收割型'),
    ('技能', '护盾 shieldRatio', '1% = 1.0 VP', '1.0', '全队光环盾，只在强化击触发'),
    ('克制', '克制增伤 counterDamageRate', '1% = 0.8 VP', '0.8', '条件生效，约 50% 对局触发'),
    ('克制', '克制减伤 counteredDamageReduce', '1% = 0.8 VP', '0.8', '同上'),
    ('克制', '友军攻击 allyAtk', '1% = 0.9 VP', '0.9', '按 2 人受益折算'),
    ('克制', '友军生命 allyHp', '1% = 0.9 VP', '0.9', '同上'),
]
for row in VP_DOC:
    put(r, list(row) + ['', ''])
    for c in range(1, 7):
        ws.cell(r, c).border = SEP
    ws.row_dimensions[r].height = 18
    r += 1

r += 1
ws.cell(r, 1).value = '二 · 品级预算与实测比值'
ws.cell(r, 1).font = H2
r += 1
put(r, ['品级', '被动条数', '每条预算', '整卡预算', '实测整卡均值', '实测比值', '卡数'],
    font=TH, fill=HEAD_FILL)
r += 1
ORDER = ['绿', '蓝', '紫', '金']
PER = {'绿': 10, '蓝': 20, '紫': 60, '金': 150}
CNT = {'绿': 3, '蓝': 3, '紫': 2, '金': 2}
for t in ORDER:
    vals = [v for _, v in tier_cards[t]]
    put(r, [t, CNT[t], PER[t], PER[t] * CNT[t], round(tier_avg[t], 1),
            round(tier_avg[t] / base, 2), len(vals)])
    for c in range(1, 8):
        ws.cell(r, c).border = SEP
    r += 1
put(r, ['合计比值', '', '', '1 : 2 : 4 : 10', f'{tier_avg["绿"]:.0f} : {tier_avg["蓝"]:.0f} : '
     f'{tier_avg["紫"]:.0f} : {tier_avg["金"]:.0f}', '1.00 / 1.92 / 4.12 / 9.86', ''], font=TH, fill=SUM_FILL)
r += 2

# ---- 三 · 统一命名
ws.cell(r, 1).value = '三 · 统一命名表（功能相同即同名，跨品级共用一套词库）'
ws.cell(r, 1).font = H2
r += 1
band(r, '原来 68 条被动有 68 个不同的名字，其中大量是「换个说法说同一件事」。本轮把命名收敛成 22 个功能族名：'
        '主词缀决定名字，副词缀不再单独命名。同品级里功能相近的被动直接同名，玩家一眼能认出「这条是穿透」。', 34)
r += 1
put(r, ['族名', '主词缀', '出现品级', '用了几次', '风味设定', '', ''], font=TH, fill=HEAD_FILL)
r += 1
NAME_USE = defaultdict(list)
for it in rows_info:
    NAME_USE[it['name']].append(it)
for nm, items in sorted(NAME_USE.items(), key=lambda kv: (ORDER.index(kv[1][0]['tier']), -len(kv[1]))):
    tiers = '、'.join(sorted({i['tier'] for i in items}, key=ORDER.index))
    main = '+'.join(V2.STATS[st]['short'] for st, _ in items[0]['slots'])
    put(r, [nm, main, tiers, len(items), V2.FLAVOR.get(nm, ''), '', ''])
    for c in range(1, 6):
        ws.cell(r, c).border = SEP
    ws.row_dimensions[r].height = 30
    r += 1

r += 1
ws.cell(r, 1).value = '四 · 四职业怎么拉平'
ws.cell(r, 1).font = H2
r += 1
for line in [
    '同一品级内，四职业拿到的 VP 预算完全相同（绿 30 / 蓝 58 / 紫 120 / 金 297），差别只在「换成什么」。',
    '射手 / 法师：预算优先换 DPS 与结算形状（穿透、连击、弹数、溅射、附加伤害、处决），几乎不拿生命。',
    '战士：DPS 与 EHP 各一半，靠吸血、移速、护盾把「打得久」变成「活得久」。',
    '坦克：预算优先换 EHP 与群体保护（护盾光环、减速、射程），只留一条低 VP 的输出词缀避免完全无威胁。',
    '因为 VP 本身就是按「DPS × EHP 乘积」折算的，所以预算相同 ⇒ 期望战力相同，不需要额外的职业系数。',
    '实测：金卡 战士均值 295 / 射手 294 / 法师 299（差 1.7%）；紫卡 坦克 125 / 射手 124 / 法师 124 / 战士 120；'
    '蓝卡 坦克 58 / 法师 58 / 射手 57 / 战士 57。',
]:
    band(r, line, 20 if len(line) < 70 else 34)
    r += 1

r += 1
ws.cell(r, 1).value = '五 · 仍然需要新增的两个字段'
ws.cell(r, 1).font = H2
r += 1
for line in [
    '克制增伤 counterDamageRate / 克制减伤 counteredDamageReduce —— 只被 68020 三叶小丑、68021 血蹄 用到（共 4 条）。',
    'cardCounterMultiplier 目前只读全局 rules 的 damageMultiplier（出手 ×1.3），没有个体修正项。'
    '需要加两个 statId，并在该函数里各乘一次：(1 + 攻方 counterDamageRatePct/100) 与 (1 - 守方 counteredDamageReducePct/100)。缺省 0 ⇒ 既有伤害逐字不变。',
    '友军向（共生信号 / 共生矩阵）走 1011 光环元件 aura_team_stat，不需要新增字段；元件没实装时这 5 条会先空转。',
    '其余 59 条零改代码即可落地。',
]:
    band(r, line, 34)
    r += 1

ws.freeze_panes = 'A4'

# ---------------------------------------------------------------- 价值核算页
AN = '被动价值核算'
if AN in wb.sheetnames:
    del wb[AN]
wa = wb.create_sheet(AN, 2)
for col, w in zip('ABCDEFG', (10, 14, 8, 8, 8, 16, 52)):
    wa.column_dimensions[col].width = w
wa.cell(1, 1).value = '被动价值逐条核算（满级 L3 口径）'
wa.cell(1, 1).font = H1
wa.cell(2, 1).value = 'VP = 等效战力点，1 VP = +1% 面板攻击。整卡 VP 应落在 绿30 / 蓝58 / 紫120 / 金297 附近。'
wa.cell(2, 1).font = BODY
wa.merge_cells(start_row=2, start_column=1, end_row=2, end_column=7)
for i, h in enumerate(['卡牌ID', '卡牌', '职业', '品级', '技能ID', '技能名', '满级VP'], start=1):
    c = wa.cell(4, i)
    c.value = h
    c.font = TH
    c.fill = HEAD_FILL
wa.cell(4, 8).value = '词缀构成'
wa.cell(4, 8).font = TH
wa.cell(4, 8).fill = HEAD_FILL
wa.column_dimensions['H'].width = 46

rr = 5
for t in ORDER:
    sub = [x for x in rows_info if x['tier'] == t]
    sub.sort(key=lambda x: (int(x['card']), x['sid']))
    for it in sub:
        comp = ' + '.join(f'{V2.STATS[st]["short"]}{V2.pct(vals[-1])}%' if V2.STATS[st]['num'] != 'int'
                          else f'{V2.STATS[st]["short"]}{int(vals[-1])}'
                          for st, vals in it['slots'])
        for i, v in enumerate([it['card'], it['card_name'], it['role'], it['rarity'],
                               it['sid'], it['name'], round(it['vp'], 1)], start=1):
            c = wa.cell(rr, i)
            c.value = v
            c.font = BODY
        c = wa.cell(rr, 8)
        c.value = comp
        c.font = BODY
        rr += 1
    # 小计
    wa.cell(rr, 4).value = f'{t} 合计'
    wa.cell(rr, 4).font = TH
    wa.cell(rr, 7).value = round(tier_avg[t], 1)
    wa.cell(rr, 7).font = TH
    wa.cell(rr, 8).value = f'{len(tier_cards[t])} 张卡均值，比值 {tier_avg[t] / base:.2f}'
    wa.cell(rr, 8).font = TH
    for i in range(1, 9):
        wa.cell(rr, i).fill = SUM_FILL
    rr += 1
wa.freeze_panes = 'A5'

# ---------------------------------------------------------------- 本次改动说明
def trim_from(ws, marker):
    for rr in range(2, ws.max_row + 1):
        if str(ws.cell(rr, 1).value or '').startswith(marker):
            if rr <= ws.max_row:
                ws.delete_rows(rr, ws.max_row - rr + 1)
            return rr
    return ws.max_row + 1


ws2 = wb['本次改动说明']
r2 = trim_from(ws2, '被动方案 V2')
if ws2.cell(r2 - 1, 1).value in (None, ''):
    r2 -= 1
if ws2.cell(r2 - 1, 1).value not in (None, ''):
    r2 += 1


def put2(row, label, text, header=False):
    a = ws2.cell(row, 1)
    a.value = label
    a.font = H2 if header else TH
    a.alignment = Alignment(wrap_text=True, vertical='top')
    if text is not None:
        b = ws2.cell(row, 2)
        b.value = text
        b.font = BODY
        b.alignment = Alignment(wrap_text=True, vertical='top')
    return row + 1


r2 = put2(r2, '被动方案 V2 · 统一命名与价值比 · 2026-10-30', None, header=True)
r2 = put2(r2, '这轮只动了什么', '技能名、技能文案（L1/L2/L3 + 详述 + 表现 + 落地口径）与技能数值。'
                                '面板攻击、生命、攻速、主动技能、解锁等级全部原样。68001~68005 的被动一字未动。')
r2 = put2(r2, '命名怎么统一', '68 条被动原来有 68 个名字，很多是「换种说法讲同一件事」。现在收敛成 22 个功能族名，'
                              '主词缀决定名字，副词缀不单独命名。比如所有「主词缀是穿透」的被动都叫【穿甲苔刺】，'
                              '紫卡和 6 张金卡共用这个名字，玩家看名字就知道这条是穿透。完整对照见【被动重设计口径】第三节。')
r2 = put2(r2, '文案风格', '统一到「植物废土末日科技」：菌丝板甲、孢子爆囊、反应堆护膜、枯萎协议、共生信号、穿甲苔刺、'
                          '黏液阻滞、根须抽取。每一条的详述都以一句风味设定开头，再给机制与数值区间。')
r2 = put2(r2, '1:2:4:10 是怎么保证的', '不是凭手感调，而是先建 VP 表（1 VP = +1% 面板攻击的等效战力），'
                                      '再把每条形色词缀按 VP 折算，最后按品级发预算：绿每条 10、蓝 20、紫 60、金 150；'
                                      '整卡（绿3条/蓝3条/紫2条/金2条）就是 30 : 60 : 120 : 300。'
                                      '实测整卡均值 30 : 57.5 : 123.6 : 295.8，比值 1 : 1.92 : 4.12 : 9.86。'
                                      '逐条核算在【被动价值核算】页。')
r2 = put2(r2, '四职业怎么拉平', 'VP 本身按「DPS × EHP 乘积」折算，所以同品级预算相同就等于期望战力相同，不需要额外职业系数。'
                                '差别只在「预算换成什么」：射手/法师换穿透连击弹数溅射，战士一半 DPS 一半 EHP，'
                                '坦克换护盾光环与减速。实测金卡 战士 295 / 射手 294 / 法师 299（差 1.7%）。')
r2 = put2(r2, '为什么金卡能给到 10 倍', '金卡的 10 倍不是把百分比乘以 10，而是换成「乘法级词缀」：穿透 +2（等价 120 VP）'
                                      '或连击 +1 段（100 VP），这两个在实战里就是翻倍收益，折算后自然到 150 VP/条。'
                                      '绿卡则全部是面板直加，10 VP/条，也就是 +10% 攻击。')
r2 = put2(r2, '改名的连带影响', '13 条原名与新效果冲突的被动全部并入族名（冰峰→寒霜根基 之类已作废，统一按族名走）。'
                                '配置侧只需同步技能名的显示字段，skillId 一个都没动。')

# ---------------------------------------------------------------- 实现明细
ws3 = wb['技能实现改动明细']
r3 = trim_from(ws3, '被动方案 V2')
if ws3.cell(r3 - 1, 1).value in (None, ''):
    r3 -= 1
if ws3.cell(r3 - 1, 1).value not in (None, ''):
    r3 += 1
c = ws3.cell(r3, 1)
c.value = '被动方案 V2 · 落地清单（2026-10-30）'
c.font = H2
r3 += 1
for label, text in [
    ('零改代码', '59 条 / 68 条。全部走已存在的 unit 域 statId 或 skill 域 skillParamJson。'),
    ('需新增 statId', 'counterDamageRate、counteredDamageReduce 两个（68020 / 68021 共 4 条用到）。'),
    ('消费点', 'ZCCombatCatalog.cardCounterMultiplier 现有实现只返回 rules 的 damageMultiplier；'
               '改为在此基础上乘 (1 + 攻方 counterDamageRatePct/100) × (1 - 守方 counteredDamageReducePct/100)。'
               '缺省 0 ⇒ 乘 1，既有单位逐字不变。'),
    ('注意', '减伤要乘在「克制倍率之后、护盾结算之前」。回血走 damageUnit 的 applied，天然不含护盾吸收部分。'),
    ('友军向', '共生信号·攻 / 共生信号·守 / 共生矩阵 共 5 条，依赖 1011 光环元件 aura_team_stat（radius=6）。'
               '元件未实装时这 5 条会先空转，不报错。'),
    ('数值口径坑', 'critRate / critDamage 走 foldStatPatch 的 flat 分支，下游按 pct/100 使用，'
                   '所以表里必须写 12、90，不能写 0.12、0.90。本轮全部按整数口径写入。'),
    ('等级', 'K/L/M 的「兵种 X 级」沿用原值，没有调整任何解锁等级。'),
]:
    a = ws3.cell(r3, 1)
    a.value = label
    a.font = TH
    a.alignment = Alignment(wrap_text=True, vertical='top')
    b = ws3.cell(r3, 2)
    b.value = text
    b.font = BODY
    b.alignment = Alignment(wrap_text=True, vertical='top')
    r3 += 1

wb.save(SRC)
print('[saved]', SRC)
print('sheets:', wb.sheetnames)
print('口径页 rows', ws.max_row, '| 核算页 rows', wa.max_row,
      '| 改动说明', ws2.max_row, '| 实现明细', ws3.max_row)
