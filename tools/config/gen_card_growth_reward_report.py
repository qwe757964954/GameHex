# -*- coding: utf-8 -*-
"""生成《卡牌成长与关卡产出综合表》。

口径（用户 2026-11-16 指定）：
  · 卡牌升级基础值按「职业系数」呈现（花果为面板标准）
  · 汇总卡牌成长系数 + 技能成长系数
  · 现有四类关卡奖励：战斗掉落（翻地块 + 塔防波次）、PVP 战斗宝箱、
    章节内一次性奖励（固定格 + 随机格），外加关卡首通奖励
  · 翻地块 = **每次战斗内**打开的地块（2026-11-16 用户确认），不是章节地图的地块；
    轨道按 chapterId 配、每场从第 1 格重新算，可重复
  · 每日体力上限约 300；重复刷关计消耗；BOSS 关体力由 5 改为 10

数据源全部读配置真源（不手抄）：
  assets/remoteRef/pvpCard.json           卡牌面板 / 种族 / 职业 / 品阶
  assets/remoteRef/cardLevelUp.json       0~50 级绝对面板值 + 升级消耗
  assets/remoteRef/pvpSkillPlan.json      技能链逐级生效值
  assets/remoteRef/armySkillLevelUp.json  技能升级消耗
  assets/remoteRef/newTreasureBoxConfig.json + itemBoxPro.json  战斗宝箱
  D:/Alan/Project/POW/doc/塔防数据配置/PVP-关卡.xlsx
      关卡信息表 / 翻地快个数奖励 / 波次奖励 / 关卡地图格子奖励 / 章节关卡首通奖励表

用法：
    python tools/config/gen_card_growth_reward_report.py [输出路径]
"""
from __future__ import annotations

import io
import json
import os
import sys
from collections import defaultdict

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx_read import read_sheet  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REF = os.path.join(ROOT, 'assets', 'remoteRef')
# ⚠️ client 版才是最新导表：`assets/remoteRef/itemBoxPro.json` 长期落后
#    （1767 行、只有 19101~19106 六个池），client 版 2249 行、19101~19142 全配齐
CLIENT_JSON = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client'
LEVEL_XLSX = 'D:/Alan/Project/POW/doc/塔防数据配置/PVP-关卡.xlsx'
OUT_DIR = 'D:/Alan/占城玩法/策划文档/卡牌系统'
OUT_NAME = '卡牌成长与关卡产出综合表_v1_20261116.xlsx'

RARITY = {1: '绿', 2: '蓝', 3: '紫', 4: '金'}
RARITY_ORDER = ['绿', '蓝', '紫', '金']
CLASS_ORDER = ['射手', '法师', '战士', '坦克']
RANGE_BY_CLASS = {'射手': '远程', '法师': '远程', '战士': '近战', '坦克': '近战'}

# 体力口径（用户 2026-11-16 指定）
STAMINA_DAILY = 300
BOSS_COST = 10
NORMAL_COST = 5
# 每场战斗内可开地块数（关卡信息表 openGrideTime）：主线普通关 5、塔防 BOSS 关 1
NORMAL_GRID_OPEN = 5
BOSS_GRID_OPEN = 1
# 配置实算口径（configuration 侧：恢复 120 + 邮件 64 + 粮仓 60 + 好友 25）
STAMINA_CONFIG = 269
STAMINA_PARTS = [
    ('自然恢复', 120, '30 上限 / 每 600s 1 点 / 4 次登录吃满'),
    ('邮件体力', 64, '4 次 × endMailValue 16'),
    ('粮仓体力', 60, '4 次 × endGranaryOneAdd 15'),
    ('好友体力', 25, '5 次 × 5'),
]

MAT_NAMES = {
    7: '银币', 9: '体力', 10: '金币', 10010: '兵种卷轴(10点)', 10011: '装备图纸',
    10012: '兵种卷轴(50点)', 10013: '宝石', 10022: '宝石箱', 14011: '装备',
    16003: '兵种经验', 16014: '天赋石', 18002: '金矿升级材料', 10060: '城墙升级石',
}

# 武将道具 18001~18099 = 卡牌碎片（item.json type 12「武将」，卡面名即道具名）
SHARD_RANGE = (18001, 18099)


def is_shard(res_id):
    return SHARD_RANGE[0] <= res_id <= SHARD_RANGE[1]


# ── 载入 ────────────────────────────────────────────────────────────────────

def load_ref(name):
    with io.open(os.path.join(REF, name), encoding='utf-8') as fh:
        data = json.load(fh)
    if isinstance(data, dict) and 'v' in data:
        keys = data['k']
        return [dict(zip(keys, row)) for row in data['v']]
    return data


ITEM_NAMES = {}


def load_item_names():
    global ITEM_NAMES
    for row in load_ref('item.json'):
        ITEM_NAMES[int(row['resId'])] = row.get('name') or ''


def res_name(res_id):
    if res_id in MAT_NAMES:
        return MAT_NAMES[res_id]
    if res_id in ITEM_NAMES and ITEM_NAMES[res_id]:
        return ITEM_NAMES[res_id]
    return None


def load_client(name):
    with io.open(os.path.join(CLIENT_JSON, name + '.json'), encoding='utf-8') as fh:
        return json.load(fh)


def load_level_rows(sheet_index, min_cols):
    _name, rows = read_sheet(LEVEL_XLSX, sheet_index)
    out = []
    for row_no, values in rows:
        if row_no < 7 or len(values) < min_cols:
            continue
        cells = [str(v).strip() for v in values]
        if not cells[0].isdigit():
            continue
        out.append(cells)
    return out


def parse_reward(text):
    text = (text or '').strip()
    if not text.startswith('['):
        return []
    try:
        return json.loads(text)
    except ValueError:
        return []


def expect(items):
    """奖励列表 → {resId: 期望数量}（pro 为万分比）。"""
    out = defaultdict(float)
    for it in items:
        out[int(it['resId'])] += float(it['number']) * float(it['pro']) / 10000.0
    return out


def merge(dst, src):
    for k, v in src.items():
        dst[k] += v
    return dst


# ── 卡牌 / 成长 ─────────────────────────────────────────────────────────────

def build_cards():
    rows = load_ref('pvpCard.json')
    cards = []
    for row in rows:
        if not row.get('unitId'):
            continue
        traits = row.get('traits') or {}
        cards.append({
            'id': int(row['id']),
            'name': row['name'],
            'camp': traits.get('camp') or '—',
            'cls': traits.get('attack') or '—',
            'rarity': RARITY[int(row['rarity'])],
            'hp': row['unitMaxHp'],
            'atk': row['unitAttack'],
            'bhp': row['baseHp'],
            'range': row['unitAttackRange'],
            'style': row['attackStyle'],
            'buildSeconds': row['buildSeconds'],
            'buildNum': row['buildNumLimit'],
        })
    cards.sort(key=lambda c: (RARITY_ORDER.index(c['rarity']), CLASS_ORDER.index(c['cls'])
                              if c['cls'] in CLASS_ORDER else 9, c['id']))
    return cards


def build_growth():
    rows = load_ref('cardLevelUp.json')
    curve = {}
    cost = {}
    for row in rows:
        cid = int(row['id'])
        level = int(row['level'])
        attrs = {a['statId']: a['value'] for a in row['attrList']}
        curve.setdefault(cid, {})[level] = attrs
        cost.setdefault(cid, {})[level] = (int(row['costCardNum']), int(row['costArmyLevelNum']),
                                          int(row['costCardID']), int(row['costArmyLevelID']))
    return curve, cost


def growth_multiplier(curve):
    """用基值最小的卡做模板，得到 0~50 级的乘子曲线（全表共享同一乘子）。"""
    base_id = min(curve, key=lambda c: curve[c][0]['maxHp'])
    lv0 = curve[base_id][0]
    out = []
    for level in range(0, 51):
        attrs = curve[base_id][level]
        out.append({
            'level': level,
            'hp': attrs['maxHp'] / lv0['maxHp'],
            'atk': attrs['attack'] / lv0['attack'],
            'bhp': attrs['buildingHp'] / lv0['buildingHp'],
        })
    return base_id, out


def build_skills():
    rows = load_ref('pvpSkillPlan.json')
    chains = defaultdict(dict)
    meta = {}
    for row in rows:
        key = (str(row['unitId']), int(row['skillChainId']))
        chains[key][int(row['skillLevel'])] = row
        meta[key] = row
    return chains, meta


def build_skill_cost():
    rows = load_ref('armySkillLevelUp.json')
    cost = {}
    for row in rows:
        cost[int(row['id'])] = {
            'unlock': row['unlockarmylevel'],
            'maxLevel': row['skilllevel'],
            'coin': row['costCoinNum'],
            'coinId': row['costCoinID'],
            'mat': row['costArmySkillLevelNum'],
            'matId': row['costArmySkillLevelID'],
            'name': row['name'],
        }
    return cost


# ── 关卡 ────────────────────────────────────────────────────────────────────

LEVEL_TYPE = {1: '主线', 2: '副本', 3: '大地图', 4: '领地巡逻'}
LEVEL_MOD = {1: '匹配战', 2: '塔防'}


def build_levels():
    rows = load_level_rows(0, 1)   # 尾部空列会让 row 宽度不足，这里不按列数筛

    def cell(r, i):
        return r[i] if i < len(r) else ''

    levels = []
    for r in rows:
        levels.append({
            'levelId': int(cell(r, 0)),
            'type': int(cell(r, 1)),
            'mod': int(cell(r, 2)),
            'modValue': int(cell(r, 3)),
            'cost': int(cell(r, 6)),
            'chapter': int(cell(r, 7)),
            'stage': int(cell(r, 8)),
            'openGrid': int(cell(r, 10)),
            'idleReward': parse_reward(cell(r, 13)),
        })
    return levels


def build_open_grid():
    rows = load_level_rows(3, 3)
    track = defaultdict(dict)
    for r in rows:
        chapter = int(r[0])
        grid = int(r[1])
        track[chapter][grid] = parse_reward(r[2])
    return track


def build_waves():
    rows = load_level_rows(4, 3)
    waves = defaultdict(dict)
    for r in rows:
        waves[int(r[0])][int(r[1])] = parse_reward(r[2])
    return waves


def build_monsters():
    rows = load_level_rows(2, 10)
    info = defaultdict(lambda: {'waves': 0, 'boss': 0, 'elite': 0, 'count': 0})
    for r in rows:
        sid = int(r[0])
        info[sid]['waves'] = max(info[sid]['waves'], int(r[1]))
        mtype = int(r[9]) if len(r) > 9 and r[9].isdigit() else 1
        if mtype == 3:
            info[sid]['boss'] += 1
        elif mtype == 2:
            info[sid]['elite'] += 1
        info[sid]['count'] += int(r[5]) if len(r) > 5 and r[5].isdigit() else 0
    return info


def build_map_grid_reward():
    rows = load_level_rows(5, 2)
    return {int(r[0]): parse_reward(r[1]) for r in rows}


def build_first_pass():
    rows = load_level_rows(7, 2)
    return {int(r[0]): parse_reward(r[1]) for r in rows}


# ── 宝箱 ────────────────────────────────────────────────────────────────────

def build_boxes():
    configs = load_ref('newTreasureBoxConfig.json')
    # 🔴 必须读 client 版：remoteRef 的 itemBoxPro 停在 19101~19106，会让 3 档以上宝箱全算成 0 片
    pro = load_client('itemBoxPro')
    pools = defaultdict(list)
    for row in pro:
        pools[int(row['boxResId'])].append(row)

    def pool_shard(pool_id):
        """池内每抽期望碎片 = Σ((min+max)/2 × pro) / Σpro。池不存在返回 None。"""
        for_pool = pools.get(pool_id)
        if not for_pool:
            return None
        weight = sum(float(i['pro']) for i in for_pool)
        if not weight:
            return None
        return sum((float(i['minNumber']) + float(i['maxNumber'])) / 2.0 * float(i['pro'])
                   for i in for_pool) / weight

    # 已配池的实测值：A/B 池每抽片数、C 池每抽片数（19101~19106 全部为 2、3 或 1 片）
    measured_ab = [pool_shard(p) for p in (19101, 19102, 19104, 19105)]
    measured_c = [pool_shard(p) for p in (19103, 19106)]
    fallback_ab = max(x for x in measured_ab if x)          # 3.0
    fallback_c = max(x for x in measured_c if x)           # 1.0

    out = []
    for cfg in configs:
        box_id = int(cfg['cardBoxID'])
        draws = int(cfg['cardBoxDrawTimes'])
        rate = cfg['cardDropRate'] or []
        total_pro = sum(float(x['pro']) for x in rate) or 1.0
        shard_per_draw = 0.0
        missing = []
        estimated = False
        for index, entry in enumerate(rate):
            pool_id = int(entry['poolId'])
            weight = float(entry['pro']) / total_pro
            value = pool_shard(pool_id)
            if value is None:
                missing.append(pool_id)
                # 位置 0/1 = A/B 池，位置 2 = C 池，与已配池的排布一致
                value = fallback_ab if index < 2 else fallback_c
                estimated = True
            shard_per_draw += weight * value
        extra = expect([{'resId': x['resId'], 'number': x['number'], 'pro': 10000}
                        for x in (cfg['cardMoneyRange'] or [])])
        out.append({
            'id': box_id,
            'name': cfg['cardBoxName'],
            'openTime': cfg['cardBoxOpenTime'],
            'draws': draws,
            'rate': rate,
            'shardPerDraw': shard_per_draw,
            'shards': shard_per_draw * draws,
            'missingPools': missing,
            'estimated': estimated,
            'extra': extra,
            'protect': cfg['cardBoxProtectTimes'],
        })
    return out


def one_card_cost(cost):
    """单卡 Lv0→L50 的累计消耗（costCardNum / costArmyLevelNum 均为「每级」值）。"""
    sample = min(cost)
    shard = sum(v[0] for level, v in cost[sample].items() if level >= 1)
    mat = sum(v[1] for level, v in cost[sample].items() if level >= 1)
    return shard, mat


# 章节 → (章节下界, 章节上界, 宝箱档位索引)
# 来源：X-新宝箱配置【本地】/宝箱队列配置，「章 → 档 = ceil(章/2)」压到 14 档
QUEUE_TIERS = [
    (1, 2, 0), (3, 4, 1), (5, 6, 2), (7, 8, 3), (9, 10, 4), (11, 12, 5), (13, 14, 6),
    (15, 16, 7), (17, 18, 8), (19, 20, 9), (21, 22, 10), (23, 24, 11), (25, 26, 12),
    (27, 28, 13), (29, 30, 13),
]


def box_tier_of_chapter(chapter):
    for lo, hi, tier in QUEUE_TIERS:
        if lo <= chapter <= hi:
            return tier
    return 13


# ── 样式 ────────────────────────────────────────────────────────────────────

TITLE_FONT = Font(name='微软雅黑', size=14, bold=True, color='FFFFFF')
HEAD_FONT = Font(name='微软雅黑', size=10, bold=True, color='FFFFFF')
SUB_FONT = Font(name='微软雅黑', size=10, bold=True, color='1F3864')
BODY_FONT = Font(name='微软雅黑', size=10)
NOTE_FONT = Font(name='微软雅黑', size=9, italic=True, color='595959')

FILL_TITLE = PatternFill('solid', fgColor='1F3864')
FILL_HEAD = PatternFill('solid', fgColor='2F5597')
FILL_SUB = PatternFill('solid', fgColor='D9E2F3')
FILL_KEY = PatternFill('solid', fgColor='FFF2CC')
FILL_WARN = PatternFill('solid', fgColor='FCE4D6')
FILL_OK = PatternFill('solid', fgColor='E2EFDA')

THIN = Side(style='thin', color='BFBFBF')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
CENTER = Alignment(horizontal='center', vertical='center', wrap_text=True)
LEFT = Alignment(horizontal='left', vertical='center', wrap_text=True)


def title_row(ws, row, text, span=8):
    ws.cell(row=row, column=1, value=text)
    ws.cell(row=row, column=1).font = TITLE_FONT
    ws.cell(row=row, column=1).fill = FILL_TITLE
    ws.cell(row=row, column=1).alignment = LEFT
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    ws.row_dimensions[row].height = 26


def sub_row(ws, row, text, span=8):
    ws.cell(row=row, column=1, value=text)
    ws.cell(row=row, column=1).font = SUB_FONT
    ws.cell(row=row, column=1).fill = FILL_SUB
    ws.cell(row=row, column=1).alignment = LEFT
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    ws.row_dimensions[row].height = 20


def head_row(ws, row, headers):
    for i, text in enumerate(headers, start=1):
        c = ws.cell(row=row, column=i, value=text)
        c.font = HEAD_FONT
        c.fill = FILL_HEAD
        c.alignment = CENTER
        c.border = BORDER
    ws.row_dimensions[row].height = 30


def data_row(ws, row, values, fmt=None, fill=None):
    for i, value in enumerate(values, start=1):
        c = ws.cell(row=row, column=i, value=value)
        c.font = BODY_FONT
        c.border = BORDER
        c.alignment = CENTER if not isinstance(value, str) or len(str(value)) < 24 else LEFT
        if fmt and i in fmt:
            c.number_format = fmt[i]
        if fill:
            c.fill = fill


def note_row(ws, row, text, span=8):
    ws.cell(row=row, column=1, value=text).font = NOTE_FONT
    ws.cell(row=row, column=1).alignment = LEFT
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    ws.row_dimensions[row].height = 18


def set_widths(ws, widths):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def fmt_reward(d, skip=(), top=None):
    parts = []
    for res_id, value in sorted(d.items(), key=lambda kv: -kv[1]):
        if res_id in skip or value < 0.005:
            continue
        name = res_name(res_id)
        if name:
            parts.append('%s %.1f' % (name, value))
        else:
            parts.append('%d×%.1f' % (res_id, value))
    if top:
        parts = parts[:top]
    return ' / '.join(parts) if parts else '—'


# ── 生成 ────────────────────────────────────────────────────────────────────

def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(OUT_DIR, OUT_NAME)

    load_item_names()
    cards = build_cards()
    curve, cost = build_growth()
    template_id, mult = growth_multiplier(curve)
    chains, chain_meta = build_skills()
    skill_cost = build_skill_cost()
    levels = build_levels()
    grid_track = build_open_grid()
    waves = build_waves()
    monster_info = build_monsters()
    map_grid = build_map_grid_reward()
    first_pass = build_first_pass()
    boxes = build_boxes()

    # 主线 70 关（7 章 × 10 关），BOSS = 每章第 5、10 关（levelMod=2 塔防）
    mainline = [l for l in levels if l['type'] == 1]
    bosses = [l for l in mainline if l['mod'] == 2]
    boss_ids = {l['levelId'] for l in bosses}

    # 每关翻地块 = 该章 30 格轨道；每 run 翻 openGrid 格
    def grid_per_run(level):
        return level['openGrid']

    # 波次奖励：BOSS 关 modValue 即 startId
    wave_by_level = {}
    for level in bosses:
        sid = level['modValue']
        total = defaultdict(float)
        for wave_no in sorted(waves.get(sid, {})):
            merge(total, expect(waves[sid][wave_no]))
        wave_by_level[level['levelId']] = (sid, waves.get(sid, {}), total)

    wb = Workbook()
    wb.remove(wb.active)

    build_overview(wb, cards, mult, levels, mainline, bosses, boxes, grid_track,
                   wave_by_level, map_grid, first_pass, cost, chains)
    build_panel_sheet(wb, cards)
    build_growth_sheet(wb, cards, mult, cost)
    build_skill_sheet(wb, cards, chains, chain_meta, skill_cost)
    build_level_sheet(wb, levels, mainline, bosses, wave_by_level)
    build_grid_sheet(wb, grid_track, mainline, bosses)
    build_wave_sheet(wb, bosses, wave_by_level, monster_info)
    build_box_sheet(wb, boxes, levels)
    build_onetime_sheet(wb, levels, mainline, map_grid, first_pass)
    build_daily_sheet(wb, boxes, mainline, bosses, wave_by_level, grid_track, levels)
    build_demand_sheet(wb, cards, cost, boxes, mainline, bosses, wave_by_level, grid_track)
    build_conclusion_sheet(wb, cards, cost, boxes, mainline, bosses, wave_by_level,
                           grid_track, map_grid, first_pass)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    wb.save(out_path)
    print('已生成：%s' % out_path)
    return out_path


# ── 00 总览 ─────────────────────────────────────────────────────────────────

def build_overview(wb, cards, mult, levels, mainline, bosses, boxes, grid_track,
                   wave_by_level, map_grid, first_pass, cost, chains):
    ws = wb.create_sheet('00_总览与口径')
    set_widths(ws, [26, 34, 18, 26, 14, 14, 14, 14])
    row = 1
    title_row(ws, row, '卡牌成长 × 技能成长 × 关卡产出 综合表（v1 / 2026-11-16）', 8)
    row += 1
    note_row(ws, row, '数据全部来自配置真源，未做假设性改数；仅「BOSS 关体力 5→10」「每日体力 300」按用户口径调整。')
    row += 2

    sub_row(ws, row, '一、核心口径', 8)
    row += 1
    head_row(ws, row, ['项', '取值', '来源', '说明'])
    row += 1
    one_shard, one_mat = one_card_cost(cost)
    rows = [
        ('卡牌总数', '%d 张' % len(cards), 'pvpCard.json（unitId 非空）', '含 4 种族 × 4 职业 × 4 品阶'),
        ('面板标准', '花果', '2026-11-16 用户拍板', '其余 3 种族已按花果的同职业同品阶比例对齐'),
        ('卡牌等级上限', 'Lv.50（0~50 共 51 档）', 'cardLevelUp.json', 'L0=L1，L2 起涨'),
        ('等级成长乘子', 'L50 ≈ ×%.3f' % mult[-1]['hp'], 'cardLevelUp.json', '全表共享同一条曲线'),
        ('单卡 Lv0→50 碎片', '%d 片' % one_shard,
         'cardLevelUp.costCardNum 累加（L1~L50）', '35 张卡同一条消耗曲线'),
        ('单卡 Lv0→50 兵种经验', '%s 点' % format(one_mat, ','),
         'cardLevelUp.costArmyLevelNum 累加', '16003 兵种升级经验，全兵种共用'),
        ('技能链总数', '%d 条' % len(chains), 'pvpSkillPlan.json', '每链 L1~L3 三档'),
        ('主线关卡', '%d 关（%d 章 × 10 关）' % (len(mainline), len({l['chapter'] for l in mainline})),
         'PVP-关卡.xlsx / 关卡信息表', 'levelType=1'),
        ('BOSS 关', '%d 关' % len(bosses), '每章第 5、10 关（levelMod=2 塔防）', '原体力 5 → 新 10'),
        ('每日体力', '%d 点' % STAMINA_DAILY, '用户口径 ≈300；配置实算 %d' % STAMINA_CONFIG, '见 09 表'),
        ('单次体力', '普通 %d / BOSS %d' % (NORMAL_COST, BOSS_COST), '关卡信息表 levelCost + 用户口径', ''),
        ('战斗宝箱', '%d 档（19001~19014）' % len(boxes), 'newTreasureBoxConfig.json', '章 → 档 = ceil(章/2)'),
        ('奖励来源', '4 类', '翻地块 / 塔防波次 / 战斗宝箱 / 章节一次性（固定格+随机格）', '另附首通奖励'),
    ]
    for item in rows:
        data_row(ws, row, list(item))
        row += 1
    row += 1

    sub_row(ws, row, '二、四类产出的「可重复性」——本表最关键的一处分层', 8)
    row += 1
    head_row(ws, row, ['来源', '载体', '可重复?', '节奏', '上限'])
    row += 1
    layer_rows = [
        ('① 战斗掉落-翻地块', 'openGridReward（按 chapterId 配 30 格轨道）', '可重复',
         '每场战斗内从第 1 格重新开：普通关 %d 格、BOSS 关 %d 格' % (NORMAL_GRID_OPEN, BOSS_GRID_OPEN),
         '每场上限 30 格，每场重置'),
        ('② 战斗掉落-塔防波次', 'defenceWaveReward（按 startId × 波数）', '可重复',
         'BOSS 关每场结算全部波次', '无上限'),
        ('③ PVP 战斗宝箱', 'newTreasureBoxConfig + 队列', '可重复', '每场战斗 1 箱', '每日队列循环'),
        ('④ 章节一次性奖励', '固定格 1016~1022 / 随机格 2002~2008', '一次性', '按章节', '每章 1 次'),
        ('（附）关卡首通奖励', 'levelFirstPassReward', '一次性', '每关首通', '%d 关各 1 次' % len(first_pass)),
    ]
    for item in layer_rows:
        data_row(ws, row, list(item))
        row += 1
    note_row(ws, row, '⚠️ 翻地块是「每次战斗内打开的地块」（2026-11-16 用户确认），不是章节地图的地块：'
                      '奖励轨道按 chapterId 配，同一章所有关共用一套 30 格奖励，但**每场战斗都从第 1 格重新算**，'
                      '所以它和波次、宝箱一样是可重复掉落。')
    row_after_warn = True
    ws.cell(row=row, column=1).fill = FILL_WARN
    row += 2

    sub_row(ws, row, '三、三类成长系数速览', 8)
    row += 1
    head_row(ws, row, ['成长轴', '系数/幅度', '作用面', '说明'])
    row += 1
    growth_rows = [
        ('卡牌·等级成长', 'Lv0→50 ≈ ×%.2f' % mult[-1]['hp'], '生命 / 攻击 / 建筑血',
         '全表共享同一条乘子，与职业、品阶无关'),
        ('卡牌·品阶成长', '绿→金 面板 ×15~30', '生命 / 攻击', '见 01 表，品阶递进不统一（见风险）'),
        ('卡牌·职业成长', '战士/坦克 = 射手 ×1.667 生命、×1.083~0.5 攻击', '生命 / 攻击',
         '花果标准：射手 = 法师；坦克紫 = 射手 ×5 生命'),
        ('技能·等级成长', 'L1→L3 逐级 +10%/级（replace）/ 累加 3 层（accumulate）', '攻击 / 生命 / 射程等',
         '见 03 表，%d 条链' % len(chains)),
        ('技能·升级消耗', '银币 + 兵种升级材料', '—', 'armySkillLevelUp.costCoinNum / costArmySkillLevelNum'),
    ]
    for item in growth_rows:
        data_row(ws, row, list(item))
        row += 1
    ws.freeze_panes = 'A3'


# ── 01 卡牌基础值与职业系数 ─────────────────────────────────────────────────

def build_panel_sheet(wb, cards):
    ws = wb.create_sheet('01_卡牌基础值与职业系数')
    set_widths(ws, [10, 14, 10, 10, 8, 12, 12, 14, 10, 10, 10, 12, 12, 12])
    row = 1
    title_row(ws, row, '一、35 张卡面板明细（花果为面板标准，其余种族已对齐）', 14)
    row += 1
    note_row(ws, row, '卡牌碎片在配置里就是 item.json type 12「武将」道具 18001~18099（道具名 = 卡面名，'
                      '如 18003 = 精灵弓箭手）。本表「碎片」列即按这段 id 区间统计。')
    row += 2
    head_row(ws, row, ['卡牌ID', '名称', '种族', '职业', '品阶', '单位生命', '单位攻击', '建筑血量',
                       '射程', '攻击类型', '生命/攻击', '建筑血/生命', '布防时间', '布防上限'])
    row += 1
    for card in cards:
        ratio = card['hp'] / card['atk'] if card['atk'] else 0
        bhp_ratio = card['bhp'] / card['hp'] if card['hp'] else 0
        data_row(ws, row, [card['id'], card['name'], card['camp'], card['cls'], card['rarity'],
                           card['hp'], card['atk'], card['bhp'], card['range'],
                           RANGE_BY_CLASS.get(card['cls'], '—'), round(ratio, 3),
                           round(bhp_ratio, 2), card['buildSeconds'], card['buildNum']],
                 fmt={6: '#,##0', 7: '#,##0', 8: '#,##0', 11: '0.000', 12: '0.00'})
        row += 1
    ws.freeze_panes = 'C%d' % (row - len(cards))
    row += 1

    # 9 组标准值
    groups = defaultdict(list)
    for card in cards:
        groups[(card['cls'], card['rarity'])].append(card)
    sub_row(ws, row, '二、标准面板（15 个「职业 × 品阶」组合，收敛为 10 种唯一值）', 14)
    row += 1
    head_row(ws, row, ['品阶', '职业', '单位生命', '单位攻击', '建筑血量', '建筑血/生命',
                       '覆盖卡数', '代表卡'])
    row += 1
    for rarity in RARITY_ORDER:
        for cls in CLASS_ORDER:
            if (cls, rarity) not in groups:
                continue
            sample = groups[(cls, rarity)][0]
            names = '、'.join(c['name'] for c in groups[(cls, rarity)][:3])
            data_row(ws, row, [rarity, cls, sample['hp'], sample['atk'], sample['bhp'],
                               round(sample['bhp'] / sample['hp'], 2) if sample['hp'] else 0,
                               len(groups[(cls, rarity)]), names],
                     fmt={3: '#,##0', 4: '#,##0', 5: '#,##0', 6: '0.00'})
            row += 1
    row += 1

    # 职业系数矩阵
    sub_row(ws, row, '三、职业系数（以「同品阶射手」为 1.000 基准）', 14)
    row += 1
    head_row(ws, row, ['品阶', '职业', '生命系数', '攻击系数', '建筑血系数', '基准生命', '基准攻击'])
    row += 1
    for rarity in RARITY_ORDER:
        shooter = groups.get(('射手', rarity))
        if not shooter:
            continue
        base = shooter[0]
        for cls in CLASS_ORDER:
            if (cls, rarity) not in groups:
                continue
            s = groups[(cls, rarity)][0]
            data_row(ws, row, [rarity, cls, round(s['hp'] / base['hp'], 3),
                               round(s['atk'] / base['atk'], 3),
                               round(s['bhp'] / base['hp'], 3), base['hp'], base['atk']],
                     fmt={3: '0.000', 4: '0.000', 5: '0.000'})
            row += 1
    row += 1

    # 品阶系数
    sub_row(ws, row, '四、品阶系数（同职业内，以绿卡为 1.000）', 14)
    row += 1
    head_row(ws, row, ['职业', '绿→蓝 生命', '绿→蓝 攻击', '蓝→紫 生命', '蓝→紫 攻击',
                       '紫→金 生命', '紫→金 攻击', '备注'])
    row += 1
    for cls in CLASS_ORDER:
        seq = [(r, groups.get((cls, r))) for r in RARITY_ORDER]
        seq = [(r, g[0]) for r, g in seq if g]
        if len(seq) < 2:
            continue
        by = dict(seq)
        def factor(a, b, key):
            if a in by and b in by and by[a][key]:
                return round(by[b][key] / by[a][key], 3)
            return '—'
        note = []
        if '绿' not in by:
            note.append('缺绿卡基准')
        if '金' not in by:
            note.append('缺金卡')
        data_row(ws, row, [cls, factor('绿', '蓝', 'hp'), factor('绿', '蓝', 'atk'),
                           factor('蓝', '紫', 'hp'), factor('蓝', '紫', 'atk'),
                           factor('紫', '金', 'hp'), factor('紫', '金', 'atk'),
                           '、'.join(note) or '—'],
                 fmt={2: '0.000', 3: '0.000', 4: '0.000', 5: '0.000', 6: '0.000', 7: '0.000'})
        row += 1
    note_row(ws, row, '⚠️ 品阶递进不统一：射手 绿→蓝 ×3、蓝→紫 ×2、紫→金 ×2.5；坦克只有绿→紫 ×4；'
                      '部分组合缺基准（花果无绿战士/法师、无紫射手/法师），缺基准的组合不做外推。')
    ws.cell(row=row, column=1).fill = FILL_WARN


# ── 02 卡牌成长系数 ────────────────────────────────────────────────────────

def build_growth_sheet(wb, cards, mult, cost):
    ws = wb.create_sheet('02_卡牌成长系数')
    set_widths(ws, [8, 12, 12, 12, 14, 16, 16, 14, 14, 14, 14])
    row = 1
    title_row(ws, row, '一、等级成长乘子（0~50 级，全表共享同一条曲线）', 11)
    row += 1
    head_row(ws, row, ['等级', '生命乘子', '攻击乘子', '建筑血乘子',
                       '绿射手 生命/攻击', '蓝法师 生命/攻击', '紫战士 生命/攻击',
                       '金坦克 生命/攻击', '累计碎片', '累计兵种材料', '本级碎片'])
    row += 1
    any_card = min(cost, key=lambda c: c)
    cum_shard = 0
    cum_mat = 0
    for entry in mult:
        level = entry['level']
        shard, mat = cost[any_card][level][0], cost[any_card][level][1]
        if level >= 1:
            cum_shard += shard
            cum_mat += mat
        data_row(ws, row, [level, round(entry['hp'], 3), round(entry['atk'], 3),
                           round(entry['bhp'], 3),
                           '%d / %d' % (round(40 * entry['hp']), round(12 * entry['atk'])),
                           '%d / %d' % (round(120 * entry['hp']), round(24 * entry['atk'])),
                           '%d / %d' % (round(400 * entry['hp']), round(52 * entry['atk'])),
                           '—',
                           cum_shard, cum_mat, shard],
                 fmt={2: '0.000', 3: '0.000', 4: '0.000', 9: '#,##0', 10: '#,##0', 11: '#,##0'})
        row += 1
    note_row(ws, row, '金坦克在现表无基准（花果/蘑菇/盆栽/僵尸都缺金坦克），故留「—」不外推。')
    row += 2

    sub_row(ws, row, '二、35 张卡 Lv.50 终值（= 基础值 × 乘子）', 11)
    row += 1
    head_row(ws, row, ['卡牌ID', '名称', '职业', '品阶', 'Lv1 生命', 'Lv50 生命',
                       'Lv1 攻击', 'Lv50 攻击', 'Lv1 建筑血', 'Lv50 建筑血', 'Lv50 战力参考'])
    row += 1
    hp_m, atk_m, bhp_m = mult[-1]['hp'], mult[-1]['atk'], mult[-1]['bhp']
    for card in cards:
        data_row(ws, row, [card['id'], card['name'], card['cls'], card['rarity'],
                           card['hp'], round(card['hp'] * hp_m),
                           card['atk'], round(card['atk'] * atk_m),
                           card['bhp'], round(card['bhp'] * bhp_m),
                           round(card['hp'] * hp_m / 10 + card['atk'] * atk_m)],
                 fmt={5: '#,##0', 6: '#,##0', 7: '#,##0', 8: '#,##0', 9: '#,##0',
                      10: '#,##0', 11: '#,##0'})
        row += 1
    note_row(ws, row, '「战力参考」= Lv50 生命 ÷10 + Lv50 攻击，仅为横向比较用粗估值，非工程公式。')


# ── 03 技能成长系数 ────────────────────────────────────────────────────────

def build_skill_sheet(wb, cards, chains, chain_meta, skill_cost):
    ws = wb.create_sheet('03_技能成长系数')
    set_widths(ws, [10, 14, 10, 10, 8, 12, 14, 10, 10, 10, 10, 12, 30])
    row = 1
    title_row(ws, row, '一、每卡技能成长汇总（L1→L3 生效值）', 13)
    row += 1
    head_row(ws, row, ['卡牌ID', '名称', '品阶', '职业', '链数', '被动条数', '主动条数',
                       '等效攻击% L1', 'L2', 'L3', '等效生命% L3', '成长幅度', '技能名'])
    row += 1
    for card in cards:
        mine = {k: v for k, v in chains.items() if k[0] == str(card['id'])}
        if not mine:
            continue
        atk_lv = [0.0, 0.0, 0.0]
        hp_lv = [0.0, 0.0, 0.0]
        passive = active = 0
        names = []
        for key, by_level in mine.items():
            meta = chain_meta[key]
            names.append(meta['skillName'])
            kind = meta['skillKind']
            if kind == 'active_attack' or kind == 'active_cd':
                active += 1
            else:
                passive += 1
            stat = meta.get('statId')
            op = meta.get('operation')
            accum = meta.get('progressionMode') == 'accumulate'
            running = 0.0
            for lv in (1, 2, 3):
                r = by_level.get(lv)
                value = float(r['value']) if (r and r.get('value') is not None) else 0.0
                if accum:
                    running += value
                else:
                    running = value
                if stat == 'attack' and op in ('addRate', None):
                    atk_lv[lv - 1] += running * 100
                elif stat == 'maxHp' and op in ('addRate', None):
                    hp_lv[lv - 1] += running * 100
        span = '—'
        if atk_lv[0] > 0:
            span = '×%.2f' % (atk_lv[2] / atk_lv[0])
        data_row(ws, row, [card['id'], card['name'], card['rarity'], card['cls'], len(mine),
                           passive, active, round(atk_lv[0], 1), round(atk_lv[1], 1),
                           round(atk_lv[2], 1), round(hp_lv[2], 1), span, '、'.join(names)],
                 fmt={8: '0.0', 9: '0.0', 10: '0.0', 11: '0.0'})
        row += 1
    note_row(ws, row, '「等效攻击%」= 该卡全部被动在对应等级提供的 attack addRate 之和（accumulate 按层累加、'
                      'replace 取当前级值）。主动技能不计入。')
    row += 2

    sub_row(ws, row, '二、技能链明细（%d 条，L1~L3 逐级生效值）' % len(chains), 13)
    row += 1
    head_row(ws, row, ['卡牌ID', '链ID', '技能名', '类型', '成长模式', '属性', '运算',
                       'L1', 'L2', 'L3', 'L1→L3', '满级消耗银币', '说明'])
    row += 1
    for key in sorted(chains, key=lambda k: (int(k[0]), k[1])):
        by_level = chains[key]
        meta = chain_meta[key]
        vals = []
        for lv in (1, 2, 3):
            r = by_level.get(lv)
            vals.append(float(r['value']) if (r and r.get('value') is not None) else None)
        shown = [('—' if v is None else round(v, 4)) for v in vals]
        known = [v for v in vals if v is not None]
        delta = ('×%.2f' % (known[-1] / known[0])) if len(known) >= 2 and known[0] else '—'
        sc = skill_cost.get(key[1], {})
        data_row(ws, row, [int(key[0]), key[1], meta['skillName'],
                           {'passive_stat': '被动-属性', 'event_passive': '被动-事件',
                            'active_attack': '主动-攻击', 'active_cd': '主动-冷却'}.get(meta['skillKind'], meta['skillKind']),
                           '累加' if meta['progressionMode'] == 'accumulate' else '覆盖',
                           meta.get('statId') or '—', meta.get('operation') or '—',
                           shown[0], shown[1], shown[2], delta,
                           sc.get('coin', 0) or 0,
                           (meta.get('desc') or '')[:40]])
        row += 1
    ws.freeze_panes = 'A3'


# ── 04 关卡清单与体力 ──────────────────────────────────────────────────────

def build_level_sheet(wb, levels, mainline, bosses, wave_by_level):
    ws = wb.create_sheet('04_关卡清单与体力')
    set_widths(ws, [10, 8, 8, 10, 10, 10, 10, 10, 10, 12, 12, 10, 12])
    row = 1
    title_row(ws, row, '一、主线 70 关（7 章 × 10 关）：体力与 BOSS 标记', 13)
    row += 1
    head_row(ws, row, ['关卡ID', '章节', '关序', '类型', '模式', '原体力', '新体力',
                       '是否BOSS', '翻格次数', '波次组', '波次数', '章节档位', '备注'])
    row += 1
    for level in sorted(mainline, key=lambda l: (l['chapter'], l['stage'])):
        is_boss = level['levelId'] in {b['levelId'] for b in bosses}
        sid = level['modValue'] if is_boss else None
        wave_count = len(wave_by_level[level['levelId']][1]) if level['levelId'] in wave_by_level else 0
        data_row(ws, row, [level['levelId'], level['chapter'], level['stage'],
                           LEVEL_TYPE.get(level['type'], level['type']),
                           LEVEL_MOD.get(level['mod'], level['mod']),
                           level['cost'], BOSS_COST if is_boss else NORMAL_COST,
                           '是' if is_boss else '否', level['openGrid'],
                           sid or '—', wave_count or '—',
                           min(14, (level['chapter'] + 1) // 2),
                           '每章第 5/10 关为塔防 BOSS' if is_boss else ''],
                 fmt={6: '0', 7: '0'},
                 fill=FILL_KEY if is_boss else None)
        row += 1
    row += 1

    sub_row(ws, row, '二、体力消耗对比（原全 5 → 新 BOSS 10）', 13)
    row += 1
    head_row(ws, row, ['口径', '普通关体力', 'BOSS关体力', '平均单关体力', '每日 300 体力可刷次数',
                       '每日 269 体力可刷次数'])
    row += 1
    avg = (len(mainline) - len(bosses)) / len(mainline) * NORMAL_COST + len(bosses) / len(mainline) * BOSS_COST
    for label, normal, boss in [('原方案（全 5）', 5, 5), ('新方案（BOSS 10）', NORMAL_COST, BOSS_COST)]:
        a = (len(mainline) - len(bosses)) / len(mainline) * normal + len(bosses) / len(mainline) * boss
        data_row(ws, row, [label, normal, boss, round(a, 2),
                           int(STAMINA_DAILY // a), int(STAMINA_CONFIG // a)],
                 fmt={4: '0.00'}, fill=FILL_OK if '新' in label else None)
        row += 1
    note_row(ws, row, '平均单关体力按「主线 70 关里 14 关是 BOSS（20%）」加权；若玩家全程只刷普通关，'
                      '每日次数 = 300÷5 = 60 次；全程只刷 BOSS 关 = 300÷10 = 30 次。')
    row += 2

    sub_row(ws, row, '三、其余关卡（非主线，仅备查）', 13)
    row += 1
    head_row(ws, row, ['类型', '关卡数', '模式分布', '体力分布', '说明'])
    row += 1
    other = defaultdict(list)
    for level in levels:
        if level['type'] != 1:
            other[level['type']].append(level)
    for ltype in sorted(other):
        group = other[ltype]
        mods = defaultdict(int)
        costs = defaultdict(int)
        for level in group:
            mods[LEVEL_MOD.get(level['mod'], level['mod'])] += 1
            costs[level['cost']] += 1
        data_row(ws, row, [LEVEL_TYPE.get(ltype, ltype), len(group),
                           ' / '.join('%s %d' % (k, v) for k, v in sorted(mods.items())),
                           ' / '.join('%d 体力×%d' % (k, v) for k, v in sorted(costs.items())),
                           {'2': '副本，4 关/章', '3': '大地图占城关', '4': '领地巡逻，'
                            '体力 1~7 分档'}.get(str(ltype), '')])
        row += 1
    ws.freeze_panes = 'A3'


# ── 05 翻地块 ──────────────────────────────────────────────────────────────

def build_grid_sheet(wb, grid_track, mainline, bosses):
    ws = wb.create_sheet('05_战斗掉落_翻地块')
    set_widths(ws, [8, 9, 10, 10, 11, 10, 10, 10, 11, 11, 16])
    row = 1
    title_row(ws, row, '翻地块（openGridReward）：每场战斗内打开的地块奖励，每场从第 1 格重新开始，可无限重复', 11)
    row += 1
    note_row(ws, row, '口径（2026-11-16 用户确认）：翻地块 = **每次战斗内**打开的地块，不是章节地图的地块。'
                      '奖励轨道按 chapterId 配（同一章的所有关共用一套 30 格奖励），格号 = 本场战斗内已开格数（1~30），'
                      '每场重新从第 1 格算起，因此是**可重复**掉落，不存在「刷满归零」。')
    row += 1
    note_row(ws, row, '每场能开几格由关卡信息表 `openGrideTime` 决定：主线普通关 = 5 格、塔防 BOSS 关 = 1 格。'
                      '本表同时给两种口径 —— A「按 openGrideTime 实际开格数」与 B「翻满 30 格上限」。'
                      '当前配置只有 1~7 章有主线关，8~30 章为已备好的预留轨道（本表只展开 1~7 章）。')
    row += 2

    chapters = sorted(grid_track)
    chapters = chapters[:7]

    # 概览：每章「每场」产出（A / B 两口径）
    sub_row(ws, row, '一、每场战斗的翻地块产出概览（同章所有关共用这套轨道）', 11)
    row += 1
    head_row(ws, row, ['章节', '格数上限', '普通关开格', 'BOSS关开格',
                       'A口径 银币', 'A口径 经验(个)', 'A口径 碎片',
                       'B口径 银币', 'B口径 经验(个)', 'B口径 碎片', '碎片所在格'])
    row += 1
    for chapter in chapters:
        track = grid_track[chapter]
        full = defaultdict(float)
        for grid in track:
            merge(full, expect(track[grid]))
        partial = defaultdict(float)
        for grid in sorted(track):
            if grid <= NORMAL_GRID_OPEN:
                merge(partial, expect(track[grid]))
        shard_grids = [g for g in sorted(track)
                       if any(is_shard(k) for k in expect(track[g]))]
        data_row(ws, row, [chapter, max(track) if track else 0, NORMAL_GRID_OPEN, BOSS_GRID_OPEN,
                           round(partial.get(7, 0), 1), round(partial.get(10010, 0), 1),
                           round(sum(v for k, v in partial.items() if is_shard(k)), 1),
                           round(full.get(7, 0), 1), round(full.get(10010, 0), 1),
                           round(sum(v for k, v in full.items() if is_shard(k)), 1),
                           '、'.join(str(g) for g in shard_grids) or '无'],
                 fmt={5: '0.0', 6: '0.0', 8: '0.0', 9: '0.0'},
                 fill=FILL_KEY if shard_grids else None)
        row += 1
    note_row(ws, row, '★ 卡牌碎片只压在极少数格（第 1 章是第 30 格）：A 口径普通关只开 5 格 ⇒ 拿不到碎片；'
                      '只有翻到第 30 格才掉 3 片（3 张卡各 1 片）。')
    row += 2

    # 逐章明细
    sub_row(ws, row, '二、逐章 30 格明细（单格奖励 + 本场翻到第 N 格的累计）', 11)
    row += 1
    for chapter in chapters:
        track = grid_track[chapter]
        sub_row(ws, row, '第 %d 章' % chapter, 11)
        row += 1
        head_row(ws, row, ['格号', '银币', '经验(10010)', '图纸(10011)', '天赋石(16014)',
                           '装备(14011)', '宝石(10013)', '卡牌碎片', '本场累计银币', '本场累计经验', '备注'])
        row += 1
        cum_coin = cum_exp = 0.0
        for grid in sorted(track):
            exp = expect(track[grid])
            cum_coin += exp.get(7, 0)
            cum_exp += exp.get(10010, 0)
            shards = sum(v for k, v in exp.items() if is_shard(k))
            note = '★ 卡牌碎片点' if shards else ''
            data_row(ws, row, [grid, round(exp.get(7, 0), 1), round(exp.get(10010, 0), 1),
                               round(exp.get(10011, 0), 1), round(exp.get(16014, 0), 1),
                               round(exp.get(14011, 0), 1), round(exp.get(10013, 0), 1),
                               round(shards, 1), round(cum_coin, 1), round(cum_exp, 1), note],
                     fmt={2: '0.0', 3: '0.0', 9: '0.0', 10: '0.0'},
                     fill=FILL_KEY if shards else None)
            row += 1
        full = defaultdict(float)
        for grid in track:
            merge(full, expect(track[grid]))
        data_row(ws, row, ['30 格合计', round(full.get(7, 0), 1), round(full.get(10010, 0), 1),
                           round(full.get(10011, 0), 1), round(full.get(16014, 0), 1),
                           round(full.get(14011, 0), 1), round(full.get(10013, 0), 1),
                           round(sum(v for k, v in full.items() if is_shard(k)), 1),
                           '', '', 'B 口径（翻满）单场总量'],
                 fmt={2: '0.0', 3: '0.0', 9: '0.0', 10: '0.0'}, fill=FILL_SUB)
        row += 1
        row += 1
    ws.freeze_panes = 'A3'


# ── 06 塔防波次 ────────────────────────────────────────────────────────────

def build_wave_sheet(wb, bosses, wave_by_level, monster_info):
    ws = wb.create_sheet('06_战斗掉落_塔防波次')
    set_widths(ws, [10, 8, 8, 8, 10, 10, 10, 10, 10, 10, 10, 16])
    row = 1
    title_row(ws, row, '塔防波次奖励（defenceWaveReward）：BOSS 关每场结算全部波次，可无限重复', 12)
    row += 1
    note_row(ws, row, '波次奖励按 startId 建表，主线 BOSS 关的 startId = 关卡信息表 levelModValue（1001~1014）。'
                      '出怪表中 monsterType=3 即 BOSS 波。')
    row += 2

    sub_row(ws, row, '一、14 个 BOSS 关单场波次产出', 12)
    row += 1
    head_row(ws, row, ['关卡ID', '章节', '关序', '波次组', '波数', 'BOSS波数', '银币',
                       '经验(10010)', '图纸(10011)', '天赋石(16014)', '碎片', '单场合计(期望)'])
    row += 1
    total_all = defaultdict(float)
    for level_id in sorted(wave_by_level, key=lambda i: i):
        sid, wave_map, total = wave_by_level[level_id]
        level = next(l for l in bosses if l['levelId'] == level_id)
        info = monster_info.get(sid, {})
        shards = sum(v for k, v in total.items() if is_shard(k))
        merge(total_all, total)
        data_row(ws, row, [level_id, level['chapter'], level['stage'], sid,
                           len(wave_map), info.get('boss', 0),
                           round(total.get(7, 0), 1), round(total.get(10010, 0), 1),
                           round(total.get(10011, 0), 1), round(total.get(16014, 0), 1),
                           round(shards, 1), fmt_reward(total, top=4)],
                 fmt={7: '0.0', 8: '0.0', 9: '0.0', 10: '0.0'})
        row += 1
    row += 1

    sub_row(ws, row, '二、单关逐波明细（示例：第 1 章第 5 关 / startId 1001）', 12)
    row += 1
    head_row(ws, row, ['波号', '银币', '经验', '图纸', '装备', '宝石', '天赋石', '卡牌碎片', '备注'])
    row += 1
    sample_sid = sorted(wave_by_level.values(), key=lambda x: x[0])[0][1]
    for wave_no in sorted(sample_sid):
        exp = expect(sample_sid[wave_no])
        shards = sum(v for k, v in exp.items() if is_shard(k))
        data_row(ws, row, [wave_no, round(exp.get(7, 0), 1), round(exp.get(10010, 0), 1),
                           round(exp.get(10011, 0), 1), round(exp.get(14011, 0), 1),
                           round(exp.get(10013, 0), 1), round(exp.get(16014, 0), 1),
                           round(shards, 1), ''],
                 fmt={2: '0.0', 3: '0.0'})
        row += 1
    row += 1

    sub_row(ws, row, '三、章节合计（每章 2 个 BOSS 关，单场相加）', 12)
    row += 1
    head_row(ws, row, ['章节', 'BOSS关', '银币', '经验', '图纸', '天赋石', '碎片'])
    row += 1
    by_chapter = defaultdict(lambda: defaultdict(float))
    for level_id, (sid, _wm, total) in wave_by_level.items():
        level = next(l for l in bosses if l['levelId'] == level_id)
        merge(by_chapter[level['chapter']], total)
    for chapter in sorted(by_chapter):
        t = by_chapter[chapter]
        data_row(ws, row, [chapter, 2, round(t.get(7, 0), 1), round(t.get(10010, 0), 1),
                           round(t.get(10011, 0), 1), round(t.get(16014, 0), 1),
                           round(sum(v for k, v in t.items() if is_shard(k)), 1)],
                 fmt={3: '0.0', 4: '0.0'})
        row += 1
    ws.freeze_panes = 'A3'


# ── 07 战斗宝箱 ────────────────────────────────────────────────────────────

def build_box_sheet(wb, boxes, levels):
    ws = wb.create_sheet('07_战斗宝箱产出')
    set_widths(ws, [8, 16, 12, 10, 10, 12, 12, 26, 14, 16, 14])
    row = 1
    title_row(ws, row, 'PVP 战斗宝箱（14 档）：抽次 × 每抽碎片 = 单箱碎片', 11)
    row += 1
    note_row(ws, row, '每抽碎片 = 池内 Σ((minNumber+maxNumber)/2 × pro) ÷ Σpro，再按 A/B/C 池权重加权。'
                      '42 个池（19101~19142）全部有配置，14 档均为实测值。'
                      '🔴 取数必须读 client 版 `doc/塔防数据配置/json/client/itemBoxPro.json`（2249 行）；'
                      '`assets/remoteRef/itemBoxPro.json` 停在 1767 行、只有 19101~19106，会算成 0。')
    row += 2
    head_row(ws, row, ['档位', '宝箱ID / 名称', '开放时间(s)', '抽次', '每抽碎片', '单箱碎片',
                       '附加货币', '池权重(A/B/C)', '保底次数', '章节映射', '数据完整'])
    row += 1
    for idx, box in enumerate(boxes, start=1):
        chapters = [c for lo, hi, tier in QUEUE_TIERS if tier == idx - 1 for c in range(lo, hi + 1)]
        data_row(ws, row, [idx, '%d / %s' % (box['id'], box['name']), box['openTime'], box['draws'],
                           round(box['shardPerDraw'], 3), round(box['shards'], 2),
                           fmt_reward(box['extra']),
                           ' / '.join('%d(%s%%)' % (r['poolId'], r['pro']) for r in box['rate']),
                           box['protect'],
                           ('第 %d~%d 章' % (min(chapters), max(chapters))) if chapters else '—',
                           ('推算·缺池 %d 个' % len(box['missingPools'])) if box['missingPools'] else '实测'],
                 fmt={5: '0.000', 6: '0.00'},
                 fill=FILL_WARN if box['missingPools'] else None)
        row += 1
    row += 1

    sub_row(ws, row, '二、章节 → 宝箱档位 → 每日胜利循环平均产出', 11)
    row += 1
    head_row(ws, row, ['章节', '档位', '本档箱', '次档箱', '胜利循环平均档位', '平均单箱碎片',
                       '每周首胜箱档', '失败循环平均档位', '每日箱数(满队列)', '每日碎片(胜利)'])
    row += 1
    for lo, hi, tier in QUEUE_TIERS:
        if tier >= len(boxes):
            continue
        cur = boxes[tier]
        nxt = boxes[min(tier + 1, len(boxes) - 1)]
        avg_tier_shard = (5 * cur['shards'] + 2 * nxt['shards']) / 7.0
        fail_avg = (4 * cur['shards'] + 1 * nxt['shards']) / 5.0
        data_row(ws, row, ['第 %d~%d 章' % (lo, hi), tier + 1, '%d' % cur['id'], '%d' % nxt['id'],
                           '5×本档 + 2×次档', round(avg_tier_shard, 2), tier + 1,
                           round(fail_avg, 2), 7, round(avg_tier_shard * 7, 1)],
                 fmt={6: '0.00', 8: '0.00', 10: '0.0'})
        row += 1
    note_row(ws, row, '队列结构取自 X-新宝箱配置【本地】/宝箱队列配置：胜利循环 [本,本,本,次,本,本,次] 共 7 箱、'
                      'triggerTimes=-1（每日不限次、按序列循环）；失败循环 5 箱、只出本档与次档。'
                      '该队列表尚未进工程表，实机按「每场 1 箱」估。')
    row += 1


# ── 08 章节一次性奖励 ──────────────────────────────────────────────────────

def build_onetime_sheet(wb, levels, mainline, map_grid, first_pass):
    ws = wb.create_sheet('08_章节一次性奖励')
    set_widths(ws, [10, 12, 10, 26, 12, 12, 12, 12, 12, 16])
    row = 1
    title_row(ws, row, '章节内一次性奖励：固定格（1016~1022）+ 随机格（2002~2008）+ 关卡首通', 10)
    row += 1
    note_row(ws, row, '固定格 = levelMapGrideReward 中「固定格子-章节N奖励」；随机格 = 「随机奖励池章节N奖励」；'
                      '两者每章各 1 次，与关卡数无关。')
    row += 1
    note_row(ws, row, '⚠️ 这两张表里出现了 item.json 未登记的道具 id：19350（各章都有，9~82 个）与 19301~19307（每章一种），'
                      '名字无从解析，表内按原 id 显示。若是卡牌碎片，则「章节一次性」这条路目前是 0 碎片。')
    ws.cell(row=row, column=1).fill = FILL_WARN
    row += 1
    row += 2

    sub_row(ws, row, '一、固定格与随机格（每章各 1 次）', 10)
    row += 1
    head_row(ws, row, ['章节', '固定格ID', '随机格ID', '固定格内容', '固定格经验',
                       '随机格经验', '固定格碎片', '随机格碎片', '合计经验', '备注'])
    row += 1
    for chapter in range(1, 8):
        fixed_id = 1000 + 15 + chapter   # 1016..1022
        rand_id = 2000 + 1 + chapter     # 2002..2008
        fixed = expect(map_grid.get(fixed_id, []))
        rand = expect(map_grid.get(rand_id, []))
        data_row(ws, row, [chapter, fixed_id, rand_id,
                           fmt_reward(fixed, top=3),
                           round(fixed.get(10010, 0) * 10, 0), round(rand.get(10010, 0) * 10, 0),
                           round(sum(v for k, v in fixed.items() if is_shard(k)), 1),
                           round(sum(v for k, v in rand.items() if is_shard(k)), 1),
                           round((fixed.get(10010, 0) + rand.get(10010, 0)) * 10, 0), ''],
                 fmt={5: '#,##0', 6: '#,##0', 9: '#,##0'})
        row += 1
    row += 1

    sub_row(ws, row, '二、关卡首通奖励（70 关，每关 1 次）', 10)
    row += 1
    head_row(ws, row, ['关卡ID', '章节', '关序', '首通奖励内容', '经验(点)', '碎片', '装备',
                       '天赋石', '图纸', ''])
    row += 1
    by_chapter = defaultdict(lambda: defaultdict(float))
    for level in sorted(mainline, key=lambda l: (l['chapter'], l['stage'])):
        items = first_pass.get(level['levelId'])
        if not items:
            continue
        exp = expect(items)
        merge(by_chapter[level['chapter']], exp)
        data_row(ws, row, [level['levelId'], level['chapter'], level['stage'],
                           fmt_reward(exp, top=3),
                           round(exp.get(10010, 0) * 10, 0),
                           round(sum(v for k, v in exp.items() if is_shard(k)), 1),
                           round(exp.get(14011, 0), 1), round(exp.get(16014, 0), 1),
                           round(exp.get(10011, 0), 1), ''],
                 fmt={5: '#,##0'})
        row += 1
    row += 1

    sub_row(ws, row, '三、按章节汇总（一次性总量）', 10)
    row += 1
    head_row(ws, row, ['章节', '首通经验(点)', '首通碎片', '首通装备', '固定+随机经验(点)',
                       '固定+随机碎片', '一次性合计经验(点)', '一次性合计碎片', '', ''])
    row += 1
    for chapter in sorted(by_chapter):
        t = by_chapter[chapter]
        fixed = expect(map_grid.get(1015 + chapter, []))
        rand = expect(map_grid.get(2001 + chapter, []))
        one_exp = (fixed.get(10010, 0) + rand.get(10010, 0)) * 10
        one_shard = sum(v for k, v in fixed.items() if is_shard(k)) + \
            sum(v for k, v in rand.items() if is_shard(k))
        data_row(ws, row, [chapter, round(t.get(10010, 0) * 10, 0),
                           round(sum(v for k, v in t.items() if is_shard(k)), 1),
                           round(t.get(14011, 0), 1), round(one_exp, 0), round(one_shard, 1),
                           round(t.get(10010, 0) * 10 + one_exp, 0),
                           round(sum(v for k, v in t.items() if is_shard(k)) + one_shard, 1),
                           '', ''], fmt={2: '#,##0', 5: '#,##0', 7: '#,##0'})
        row += 1
    ws.freeze_panes = 'A3'


# ── 09 每日体力收支 ────────────────────────────────────────────────────────

# ── 09 每日体力收支 ────────────────────────────────────────────────────────

def boss_average_shard(wave_by_level):
    total = defaultdict(float)
    for _level_id, (_sid, _wm, one) in wave_by_level.items():
        merge(total, one)
    if not wave_by_level:
        return 0.0
    return sum(v for k, v in total.items() if is_shard(k)) / len(wave_by_level)


def build_daily_sheet(wb, boxes, mainline, bosses, wave_by_level, grid_track, levels):
    ws = wb.create_sheet('09_每日体力收支')
    set_widths(ws, [26, 12, 14, 14, 14, 14, 13, 14, 14, 13])
    row = 1
    title_row(ws, row, '每日 300 体力能刷什么：单场产出与三种打法', 8)
    row += 1
    note_row(ws, row, '口径：每日体力上限 ≈%d（用户 2026-11-16）；配置实算 %d。'
                      '普通关 %d 体力 / BOSS 关 %d 体力。' % (STAMINA_DAILY, STAMINA_CONFIG,
                                                            NORMAL_COST, BOSS_COST))
    row += 2

    sub_row(ws, row, '一、体力来源', 8)
    row += 1
    head_row(ws, row, ['来源', '点数', '占比', '说明'])
    row += 1
    for name, value, note in STAMINA_PARTS:
        data_row(ws, row, [name, value, '%.1f%%' % (value / STAMINA_CONFIG * 100), note])
        row += 1
    data_row(ws, row, ['配置实算合计', STAMINA_CONFIG, '100%', '对照口径'], fill=FILL_SUB)
    row += 1
    data_row(ws, row, ['用户口径（本表主口径）', STAMINA_DAILY,
                       '+%.1f%%' % ((STAMINA_DAILY / STAMINA_CONFIG - 1) * 100),
                       '约 300 点/天'], fill=FILL_KEY)
    row += 2

    boss_shard = boss_average_shard(wave_by_level)
    mid = boxes[3]                       # 19004，第 7~8 章
    box_shard = mid['shards']
    box_exp = mid['extra'].get(10010, 0) * 10

    boss_wave_exp = 0.0
    count = 0
    for _level_id, (_sid, _wm, one) in wave_by_level.items():
        boss_wave_exp += one.get(10010, 0) * 10
        count += 1
    boss_wave_exp = boss_wave_exp / count if count else 0.0

    # 翻地块：取第 7 章轨道（与 19004 同档），按每场实际开格数 A 口径算
    grid_chapter = 7 if 7 in grid_track else max(grid_track)
    grid_normal = defaultdict(float)
    for grid in sorted(grid_track[grid_chapter]):
        if grid <= NORMAL_GRID_OPEN:
            merge(grid_normal, expect(grid_track[grid_chapter][grid]))
    grid_boss = defaultdict(float)
    for grid in sorted(grid_track[grid_chapter]):
        if grid <= BOSS_GRID_OPEN:
            merge(grid_boss, expect(grid_track[grid_chapter][grid]))
    grid_n_shard = sum(v for k, v in grid_normal.items() if is_shard(k))
    grid_b_shard = sum(v for k, v in grid_boss.items() if is_shard(k))
    grid_n_exp = grid_normal.get(10010, 0) * 10
    grid_b_exp = grid_boss.get(10010, 0) * 10

    sub_row(ws, row, '二、单场产出（宝箱 = %s / 翻地块 = 第 %d 章轨道 / 波次 = BOSS 关）'
            % (mid['name'], grid_chapter), 10)
    row += 1
    head_row(ws, row, ['关卡类型', '体力', '宝箱碎片', '波次碎片', '翻地块碎片', '碎片合计',
                       '宝箱经验', '翻地块经验', '经验合计', '单位体力碎片'])
    row += 1
    data_row(ws, row, ['普通关（每场开 %d 格）' % NORMAL_GRID_OPEN, NORMAL_COST,
                       round(box_shard, 2), 0, round(grid_n_shard, 2),
                       round(box_shard + grid_n_shard, 2),
                       round(box_exp, 0), round(grid_n_exp, 0),
                       round(box_exp + grid_n_exp, 0),
                       round((box_shard + grid_n_shard) / NORMAL_COST, 2)],
             fmt={3: '0.00', 5: '0.00', 6: '0.00', 7: '#,##0', 8: '#,##0', 9: '#,##0', 10: '0.00'},
             fill=FILL_OK)
    row += 1
    data_row(ws, row, ['BOSS 关（每场开 %d 格）' % BOSS_GRID_OPEN, BOSS_COST,
                       round(box_shard, 2), round(boss_shard, 2), round(grid_b_shard, 2),
                       round(box_shard + boss_shard + grid_b_shard, 2),
                       round(box_exp, 0), round(grid_b_exp, 0),
                       round(box_exp + boss_wave_exp + grid_b_exp, 0),
                       round((box_shard + boss_shard + grid_b_shard) / BOSS_COST, 2)],
             fmt={3: '0.00', 4: '0.00', 5: '0.00', 6: '0.00', 7: '#,##0', 8: '#,##0',
                  9: '#,##0', 10: '0.00'},
             fill=FILL_KEY if (box_shard + boss_shard) / BOSS_COST < box_shard / NORMAL_COST else None)
    row += 1
    note_row(ws, row, '翻地块碎片只压在极少数格（第 7 章 = 第 30 格）⇒ 普通关每场只开 %d 格拿不到 3 片，'
                      'BOSS 关只开 %d 格更拿不到；翻满 30 格才有。银币/经验/图纸每场都能拿到。'
             % (NORMAL_GRID_OPEN, BOSS_GRID_OPEN))
    row += 1
    note_row(ws, row, '🔴 关键：宝箱数量与体力无关（1 场 1 箱），所以体力翻倍的 BOSS 关在「碎片/体力」上必然吃亏 —— '
                      '只有当单场「波次 + 翻地块」碎片 > 单场宝箱碎片时 BOSS 关才追平。当前波次 %.1f 片、'
                      '宝箱 %.1f 片，BOSS 关单位体力产出仅有普通关的 %.0f%%。'
             % (boss_shard, box_shard, (box_shard + boss_shard) / BOSS_COST / (box_shard / NORMAL_COST) * 100))
    ws.cell(row=row, column=1).fill = FILL_WARN
    row += 1
    note_row(ws, row, '口径边界：本表只统计用户指定的四类来源。关卡「征收」（levelInfo.idleReward，每关 160~200 银币 + '
                      '少量 10010）属另一条活跃线，未计入；若计入，经验侧会显著上抬。')
    row += 2

    sub_row(ws, row, '三、每日 300 点体力的三种打法', 8)
    row += 1
    head_row(ws, row, ['打法', '每日场次', '宝箱碎片', '波次碎片', '碎片合计', '经验(点)',
                       '碎片/体力', '评价'])
    row += 1
    mix_cost = ((len(mainline) - len(bosses)) * NORMAL_COST + len(bosses) * BOSS_COST) / len(mainline)
    strategies = [
        ('全部刷普通关', STAMINA_DAILY // NORMAL_COST, 0.0, '单位体力收益最高（推荐刷法）'),
        ('全部刷 BOSS 关', STAMINA_DAILY // BOSS_COST, 1.0, '碎片总量低但多拿波次材料'),
        ('按关卡配比混刷 80/20', int(STAMINA_DAILY // mix_cost), 0.2, '自然推进节奏'),
    ]
    for label, runs, boss_ratio, comment in strategies:
        box_part = runs * box_shard
        wave_part = runs * boss_ratio * boss_shard
        exp_part = (runs * box_exp + runs * boss_ratio * boss_wave_exp
                    + runs * (1 - boss_ratio) * grid_n_exp + runs * boss_ratio * grid_b_exp)
        data_row(ws, row, [label, runs, round(box_part, 0), round(wave_part, 0),
                           round(box_part + wave_part, 0), round(exp_part, 0),
                           round((box_part + wave_part) / STAMINA_DAILY, 2), comment],
                 fmt={3: '#,##0', 4: '#,##0', 5: '#,##0', 6: '#,##0', 7: '0.00'},
                 fill=FILL_OK if boss_ratio == 0 else None)
        row += 1
    row += 1

    sub_row(ws, row, '四、赛季尺度（140 天，按最优打法）', 8)
    row += 1
    head_row(ws, row, ['项', '数值', '说明'])
    row += 1
    best_runs = STAMINA_DAILY // NORMAL_COST
    best_daily = best_runs * box_shard
    data_row(ws, row, ['赛季总体力', STAMINA_DAILY * 140, '300 × 140 天'], fmt={2: '#,##0'})
    row += 1
    data_row(ws, row, ['赛季总场次（全普通关）', best_runs * 140, '60 场/天'], fmt={2: '#,##0'})
    row += 1
    data_row(ws, row, ['赛季碎片产出（上限）', round(best_daily * 140, 0),
                       '几乎全部来自战斗宝箱'], fmt={2: '#,##0'}, fill=FILL_KEY)
    row += 2
    note_row(ws, row, '单卡与全表需求见 10 表；上表是「碎片总量」上限口径，碎片按卡分散，实际单卡满级更慢。')
    ws.freeze_panes = 'A3'


# ── 10 养成需求 vs 产出 ────────────────────────────────────────────────────

def build_demand_sheet(wb, cards, cost, boxes, mainline, bosses, wave_by_level, grid_track):
    ws = wb.create_sheet('10_养成需求vs产出')
    set_widths(ws, [16, 18, 18, 18, 14, 14, 14, 18])
    row = 1
    title_row(ws, row, '卡牌养成总需求 vs 可重复产出', 8)
    row += 2

    one_shard, one_mat = one_card_cost(cost)
    sub_row(ws, row, '一、单卡满级需求（Lv0 → Lv50）', 8)
    row += 1
    head_row(ws, row, ['项', '数值', '来源'])
    row += 1
    data_row(ws, row, ['卡牌碎片（本卡专属）', one_shard,
                       'cardLevelUp.costCardNum 累加（L1~L50，每级值）'], fmt={2: '#,##0'})
    row += 1
    data_row(ws, row, ['兵种升级经验（16003）', one_mat,
                       'cardLevelUp.costArmyLevelNum 累加（每级值）'], fmt={2: '#,##0'})
    row += 1
    data_row(ws, row, ['技能升级银币', '见 03 表逐链消耗', 'armySkillLevelUp.costCoinNum'])
    row += 2

    sub_row(ws, row, '二、35 张卡全满需求（碎片总量）', 8)
    row += 1
    head_row(ws, row, ['品阶', '卡数', '单卡碎片', '该品阶碎片需求', '占全表'])
    row += 1
    by_rarity = defaultdict(int)
    for card in cards:
        by_rarity[card['rarity']] += 1
    total_need = len(cards) * one_shard
    for rarity in RARITY_ORDER:
        n = by_rarity.get(rarity, 0)
        if not n:
            continue
        data_row(ws, row, [rarity, n, one_shard, n * one_shard,
                           '%.1f%%' % (n * one_shard / total_need * 100)],
                 fmt={3: '#,##0', 4: '#,##0'})
        row += 1
    data_row(ws, row, ['合计', len(cards), one_shard, total_need, '100%'],
             fmt={3: '#,##0', 4: '#,##0'}, fill=FILL_KEY)
    row += 2

    sub_row(ws, row, '三、可重复产出 vs 需求', 8)
    row += 1
    head_row(ws, row, ['项', '数值', '说明'])
    row += 1
    box_shard = boxes[3]['shards']
    boss_shard = boss_average_shard(wave_by_level)
    daily_best = (STAMINA_DAILY // NORMAL_COST) * box_shard
    daily_boss = (STAMINA_DAILY // BOSS_COST) * (box_shard + boss_shard)
    data_row(ws, row, ['每日碎片（全普通关）', round(daily_best, 0), '60 场 × 单箱碎片'],
             fmt={2: '#,##0'})
    row += 1
    data_row(ws, row, ['每日碎片（全 BOSS 关）', round(daily_boss, 0), '30 场 × (宝箱 + 波次)'],
             fmt={2: '#,##0'})
    row += 1
    data_row(ws, row, ['35 卡全满碎片需求', total_need, '%d × %d' % (len(cards), one_shard)],
             fmt={2: '#,##0'})
    row += 1
    data_row(ws, row, ['覆盖天数（按较优打法）', round(total_need / daily_best, 0),
                       '碎片按卡分散，实际更长'],
             fmt={2: '#,##0'}, fill=FILL_WARN)
    row += 1
    data_row(ws, row, ['140 天赛季覆盖率', '%.1f%%' % (daily_best * 140 / total_need * 100),
                       '赛季碎片产出 ÷ 全表需求'],
             fill=FILL_KEY)
    row += 1
    data_row(ws, row, ['单赛季可满卡数（上限）', round(daily_best * 140 / one_shard, 1),
                       '把全部碎片视作可集中于一张卡'], fmt={2: '0.0'})
    row += 2

    sub_row(ws, row, '四、碎片来源结构（每日，全普通关打法）', 8)
    row += 1
    head_row(ws, row, ['来源', '每日碎片', '占比', '备注'])
    row += 1
    runs = STAMINA_DAILY // NORMAL_COST
    sources = [
        ('PVP 战斗宝箱', runs * box_shard, '可重复，主力'),
        ('塔防波次', 0, '普通关无波次'),
        ('翻地块', 0, '每场只开 %d 格，拿不到第 30 格的 3 片' % NORMAL_GRID_OPEN),
        ('章节一次性（固定/随机格 + 首通）', 0, '一次性，未计入日均'),
    ]
    for name, value, note in sources:
        data_row(ws, row, [name, round(value, 0), '%.1f%%' % (value / (runs * box_shard) * 100)
                           if runs else '0%', note], fmt={2: '#,##0'})
        row += 1
    note_row(ws, row, '结论：稳态下「关卡掉落 + 战斗宝箱」的活跃线产出，几乎全部来自战斗宝箱；'
                      '赛季覆盖约 %.0f%% 的 35 卡满级需求，与既有《卡牌碎片与经济定价》'
                      '「关卡掉落占 9.7%%」的结论方向一致。' % (daily_best * 140 / total_need * 100))
    ws.freeze_panes = 'A3'


# ── 11 结论 ────────────────────────────────────────────────────────────────

def build_conclusion_sheet(wb, cards, cost, boxes, mainline, bosses, wave_by_level,
                           grid_track, map_grid, first_pass):
    ws = wb.create_sheet('11_结论与风险')
    set_widths(ws, [6, 48, 34, 20, 30])
    row = 1
    title_row(ws, row, '结论、风险与待确认项', 5)
    row += 2
    head_row(ws, row, ['#', '结论 / 风险', '依据', '数值', '建议'])
    row += 1

    one_shard, one_mat = one_card_cost(cost)
    box_shard = boxes[3]['shards']
    boss_shard = boss_average_shard(wave_by_level)
    daily_best = (STAMINA_DAILY // NORMAL_COST) * box_shard
    total_need = len(cards) * one_shard
    per_stamina_normal = box_shard / NORMAL_COST
    per_stamina_boss = (box_shard + boss_shard) / BOSS_COST

    items = [
        ('1', 'BOSS 关体力改 10 后，单位体力碎片产出反而低于普通关',
         '宝箱按场次给（与体力无关），波次碎片只补 %.1f 片' % boss_shard,
         '普通 %.2f / BOSS %.2f 片每体力' % (per_stamina_normal, per_stamina_boss),
         '若想保留 BOSS 关吸引力，需把波次碎片提到 > %.0f 片/场，或让 BOSS 关宝箱翻倍'
         % box_shard),
        ('2', '翻地块是「每场战斗内打开的地块」，可重复；轨道按 chapterId 配、每场从第 1 格重算',
         '普通关每场开 %d 格、BOSS 关 %d 格（openGrideTime）；同一章所有关共用一套 30 格奖励'
         % (NORMAL_GRID_OPEN, BOSS_GRID_OPEN),
         '单场 30 格轨',
         '银币/经验/图纸每场都能拿；但碎片只压在第 30 格，常规场次开不到'),
        ('3', '碎片产出几乎全部来自 PVP 战斗宝箱',
         '翻地块的碎片只压在第 30 格（常规场次开不到）；波次只有 BOSS 关才有', '宝箱 %.1f 片/箱（%d 抽）'
         % (box_shard, boxes[3]['draws']),
         '每抽碎片数的杠杆大于抽次（1→2 片直接翻倍）'),
        ('4', '宝箱升档只提「品质」，不提「碎片量」——单箱碎片各档基本持平',
         '42 个池每抽都是 2 片（少量 1 片 / 3 片），抽次只有 9 与 10 两档',
         '单箱 %.1f~%.1f 片' % (min(b['shards'] for b in boxes), max(b['shards'] for b in boxes)),
         '想让高档箱更值，得动 itemBoxPro 的 minNumber/maxNumber，动 cardBoxDrawTimes 收益很小'),
        ('5', '35 张卡全满需 %s 片，赛季活跃线约覆盖 %.0f%%'
         % (format(total_need, ','), daily_best * 140 / total_need * 100),
         '单卡 %s 片 × 35；每日上限约 %s 片' % (format(one_shard, ','), format(int(daily_best), ',')),
         '约 %s 天可覆盖' % format(int(total_need / daily_best), ','),
         '差额应由付费线（10012 / 10022）与其他养成系统承担，不宜再让关卡掉落加码'),
        ('6', '兵种升级经验需求远大于碎片',
         '单卡 Lv0→50 = %s 点 16003（碎片仅 %s 片）'
         % (format(one_mat, ','), format(one_shard, ',')), '比值约 %.1f : 1'
         % (one_mat / one_shard),
         '16003 是全兵种共用货币，收支要按兵种侧另算，不能只看卡牌碎片'),
        ('7', '品阶递进不统一，职业系数无法用单一倍率表达',
         '射手 绿→蓝 ×3 / 蓝→紫 ×2 / 紫→金 ×2.5；坦克仅绿→紫 ×4', '4 条曲线不一致',
         '01 表按「品阶 × 职业」给 15 个组合的实际值，缺基准的组合不外推'),
        ('8', '技能成长有 2 种递进模式，混用会算错',
         'accumulate（射程 +10% 累加 3 层）/ replace（+10%→+11%→+12% 逐级覆盖）',
         '2 种模式', '03 表逐链标注模式；改数值时必须按模式换算'),
        ('9', '章节一次性奖励与关卡数无关',
         '固定格 / 随机格每章各 1 次，与 10 关还是 20 关无关', '每章 2 次',
         '章节内关卡多寡只影响翻地块与首通'),
    ]
    for item in items:
        data_row(ws, row, list(item))
        row += 1
    row += 2

    sub_row(ws, row, '待确认项', 5)
    row += 1
    for text in [
        '① BOSS 关体力改 10 后，波次奖励是否同步削减 50%？（现表仍按原值结算，本表按原值算）',
        '② 战斗宝箱队列（每周首胜 / 胜利循环 / 失败循环）目前只在【本地】方案稿，未进工程表；'
        '本表按「每场 1 箱」估。',
        '③ 19002（第 3~4 章）单箱 %.1f 片，反而高于 19003~19011（%.0f 片）——这个倒挂是刻意的吗？'
        % (boxes[1]['shards'], boxes[2]['shards']),
        '④ 每日体力按 300（用户口径）还是 269（配置实算）作为正式口径？本表主用 300、并列 269 对照。',
        '⑤ 卡牌等级上限是否维持 Lv.50？若后续抬到 60 级，25878 片/卡 会显著上抬。',
    ]:
        note_row(ws, row, text)
        row += 1
    ws.freeze_panes = 'A4'


if __name__ == '__main__':
    main()
