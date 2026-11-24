#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""按「角色名 + 技能名」清单，从技能设计案主表抽取技能说明，输出 xlsx。

用法：python tools/config/export_skill_desc_by_card.py
清单写在脚本内 USER_LIST；匹配策略见 match_skill()。
"""
import os
import sys
import json
import difflib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from xlsx_read import read_sheet  # noqa: E402

SRC = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
OUT = 'outputs/技能说明补充_20261123.xlsx'

# (角色名, 技能名) —— 用户给的清单，顺序即输出顺序
USER_LIST = [
    ('豌豆游侠', '射击'), ('豌豆游侠', '豌豆快送'), ('豌豆游侠', '强化豌豆'), ('豌豆游侠', '饥饿豌豆'), ('豌豆游侠', '豌豆机关枪'),
    ('巨力坚果', '废土铁芽'), ('巨力坚果', '坚骨'), ('巨力坚果', '抗性装甲协议'), ('巨力坚果', '巨力护盾'),
    ('火焰树妖', '火球弹射'), ('火焰树妖', '废土铁芽'), ('火焰树妖', '超视孢子'), ('火焰树妖', '职业猎杀协议'), ('火焰树妖', '灼热地带'),
    ('玉林好汉', '飞镖投掷'), ('玉林好汉', '职业猎杀协议'), ('玉林好汉', '废土铁芽'), ('玉林好汉', '超视孢子'), ('玉林好汉', '精英猎手'),
    ('椰蛋战士', '蔓生连打'), ('椰蛋战士', '横扫'), ('椰蛋战士', '异种猎杀协议'), ('椰蛋战士', '暴风'),
    ('波利奥', '孢子回流'), ('波利奥', '共生信号'), ('波利奥', '来口菠萝'), ('波利奥', '斗气爆发'),
    ('吞噬大嘴花', '破阵投枪'), ('吞噬大嘴花', '蔓生三连'), ('吞噬大嘴花', '嗜血'), ('吞噬大嘴花', '穿刺利刃'),
    ('杰克藕', '箭矢'), ('杰克藕', '穿甲苔刺'), ('杰克藕', '爆囊扩散'), ('杰克藕', '疾风箭'), ('杰克藕', '戈壁狂箭'),
    ('仙桃行者', '破阵投枪'), ('仙桃行者', '爆囊扩散'), ('仙桃行者', '迅击'), ('仙桃行者', '大地之力'),
    ('镭射飞龙', '孢群弹幕'), ('镭射飞龙', '裂变爆炸'), ('镭射飞龙', '追踪导弹'), ('镭射飞龙', '镭射死光'),
    ('水手菇', '超视孢子'), ('水手菇', '职业猎杀协议'), ('水手菇', '孢子凝珠'),
    ('菇八戒', '废土铁芽'), ('菇八戒', '灵巧投掷'), ('菇八戒', '异种猎杀协议'), ('菇八戒', '菌盾冲锋'),
    ('风炮菇', '连发苔针'), ('风炮菇', '职业猎杀协议'), ('风炮菇', '风炮弹'), ('风炮菇', '连射导弹'),
    ('分裂菇', '蔓生连打'), ('分裂菇', '异种猎杀协议'), ('分裂菇', '菌丝突刺'), ('分裂菇', '一人成军'),
    ('机甲菇', '爆囊扩散'), ('机甲菇', '吸养根须'), ('机甲菇', '武器绞杀'), ('机甲菇', '射线集束'),
    ('磁电菇', '裂变爆炸'), ('磁电菇', '巨囊弹体'), ('磁电菇', '五雷轰顶'), ('磁电菇', '磁电冲击'),
    ('毒箭菇', '苔针双连'), ('毒箭菇', '噬血蔓延'), ('毒箭菇', '群星坠落'), ('毒箭菇', '蘑菇爆炸'),
    ('诅咒菇', '蔓生三连'), ('诅咒菇', '破阵投枪'), ('诅咒菇', '毒液喷吐'), ('诅咒菇', '菌核爆裂'),
    ('窝瓜人', '废土铁芽'), ('窝瓜人', '灵巧投掷'), ('窝瓜人', '职业猎杀协议'), ('窝瓜人', '生命爆发'),
    ('三叶小丑', '异种猎杀协议'), ('三叶小丑', '职业猎杀协议'), ('三叶小丑', '废土铁芽'), ('三叶小丑', '飓风'),
    ('仙人侍卫', '异种猎杀协议'), ('仙人侍卫', '职业猎杀协议'), ('仙人侍卫', '废土铁芽'), ('仙人侍卫', '巨型仙人掌'),
    ('雷蕉', '孢子弹幕'), ('雷蕉', '职业猎杀协议'), ('雷蕉', '闪电链'), ('雷蕉', '嗜血术'),
    ('南瓜战神', '共生信号·迅'), ('南瓜战神', '职业抗性协议'), ('南瓜战神', '冲锋'), ('南瓜战神', '大吼大叫'),
    ('急冻瓜', '冰弹'), ('急冻瓜', '贯穿滋养'), ('急冻瓜', '孢群弹幕'), ('急冻瓜', '冰山陨落'), ('急冻瓜', '急冻光线'),
    ('大威天芦', '蔓生三连'), ('大威天芦', '裂变暴击'), ('大威天芦', '无尘禁土'), ('大威天芦', '天降神拳'),
    ('麻辣铁锅', '孢群弹幕'), ('麻辣铁锅', '裂变爆炸'), ('麻辣铁锅', '喷射火焰'), ('麻辣铁锅', '凤凰降临'),
    ('爆锤莲王', '噬血蔓延'), ('爆锤莲王', '破阵投枪'), ('爆锤莲王', '尖刺冲锋'), ('爆锤莲王', '战神附体'),
    ('饥饿战士', '废土铁芽'), ('饥饿战士', '灵巧投掷'), ('饥饿战士', '异种猎杀协议'), ('饥饿战士', '餐箱炸弹'),
    ('金发统领', '菌甲厚化'), ('金发统领', '废土铁芽'), ('金发统领', '重击'), ('金发统领', '抗性装甲协议'),
    ('篮球天才', '篮球抛射'), ('篮球天才', '废土铁芽'), ('篮球天才', '超视孢子'), ('篮球天才', '职业猎杀协议'), ('篮球天才', '篮球火'),
    ('艺术家', '共生信号·迅'), ('艺术家', '抗性装甲协议'), ('艺术家', '舞王召唤'), ('艺术家', '迪斯科旋风'),
    ('吉他手', '苔针双连'), ('吉他手', '爆囊扩散'), ('吉他手', '声波扫射'), ('吉他手', '死亡摇滚'),
    ('运动霸', '裂变暴击'), ('运动霸', '破阵投枪'), ('运动霸', '能量光束'), ('运动霸', '天外飞石'),
    ('魔术师', '孢群弹幕'), ('魔术师', '裂变爆炸'), ('魔术师', '移形换影'), ('魔术师', '鹿神守护'),
    ('科学家', '穿甲苔刺'), ('科学家', '苔针双连'), ('科学家', '精密陷阱'), ('科学家', '文明之火'),
]

COLS = {
    'cardId': 0, 'card': 1, 'role': 4, 'rarity': 5, 'skillId': 6, 'name': 7,
    'trigger': 8, 'triggerValue': 9, 'L1': 10, 'L2': 11, 'L3': 12,
    'mech': 13, 'visual': 14, 'landing': 15, 'counter': 16, 'counteredBy': 17, 'status': 18,
}


def load_rows():
    _name, rows = read_sheet(SRC, 0)
    out = []
    for rn, vals in rows[1:]:
        vals = vals + [''] * (19 - len(vals))
        if not vals[COLS['cardId']].strip():
            continue
        rec = {k: vals[i] for k, i in COLS.items()}
        rec['row'] = rn
        out.append(rec)
    return out


def norm(s):
    return (s or '').replace(' ', '').replace('\n', '').strip()


def main():
    table = load_rows()
    by_card = {}
    for rec in table:
        by_card.setdefault(norm(rec['card']), []).append(rec)

    report = []
    for card, skill in USER_LIST:
        rows = by_card.get(norm(card), [])
        hit = None
        how = ''
        for rec in rows:
            if norm(rec['name']) == norm(skill):
                hit, how = rec, '同名'
                break
        if hit is None:
            for rec in rows:
                if ('原「%s」' % skill) in rec['mech'] or ('原「%s」' % skill) in rec['landing']:
                    hit, how = rec, '设计案旧名'
                    break
        if hit is None:
            best, best_ratio = None, 0.0
            for rec in rows:
                r = difflib.SequenceMatcher(None, norm(skill), norm(rec['name'])).ratio()
                if r > best_ratio:
                    best, best_ratio = rec, r
            if best is not None and best_ratio >= 0.6:
                hit, how = best, '近似改名 %.0f%%' % (best_ratio * 100)
        if hit is None:
            how = '未匹配'
        report.append((card, skill, hit, how, rows))
    return report


def write_xlsx(report, path):
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    head_fill = PatternFill('solid', fgColor='E8EEF7')
    thin = Side(style='thin', color='D0D7E2')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    def style_sheet(ws, widths, freeze='A2'):
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        for row in ws.iter_rows(min_row=1, max_row=ws.max_row):
            for c in row:
                c.border = border
                c.alignment = Alignment(wrap_text=True, vertical='top')
                if c.row == 1:
                    c.font = Font(bold=True, size=10)
                    c.fill = head_fill
                    c.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center')
                else:
                    c.font = Font(size=10)
        ws.freeze_panes = freeze
        ws.auto_filter.ref = ws.dimensions
        ws.row_dimensions[1].height = 30

    # ---------- sheet1 技能说明 ----------
    ws = wb.active
    ws.title = '技能说明'
    ws.append(['序号', '角色名称', '技能名', '设计案技能名', '技能ID', '定位', '品级', '触发类型',
               'I 级', 'II 级', 'III 级', '技能详述', '技能状态', '匹配说明'])
    for idx, (card, skill, hit, how, _rows) in enumerate(report, start=1):
        if hit:
            ws.append([idx, card, skill, hit['name'], hit['skillId'], hit['role'], hit['rarity'],
                       hit['trigger'], hit['L1'], hit['L2'], hit['L3'], hit['mech'], hit['status'], how])
        else:
            ws.append([idx, card, skill, '', '', '', '', '', '', '', '', '', '', how])
    style_sheet(ws, [5, 11, 12, 12, 9, 7, 8, 20, 40, 40, 40, 78, 11, 12])

    # ---------- sheet2 完整口径 ----------
    ws2 = wb.create_sheet('落地口径')
    ws2.append(['序号', '角色名称', '技能名（清单）', '设计案技能名', '技能ID', '触发类型', '触发参数',
                '技能详述', '表现描述', '落地口径（modifier 建议）', '克制', '被克制', '技能状态'])
    for idx, (card, skill, hit, how, _rows) in enumerate(report, start=1):
        if hit:
            ws2.append([idx, card, skill, hit['name'], hit['skillId'], hit['trigger'],
                        hit['triggerValue'], hit['mech'], hit['visual'], hit['landing'],
                        hit['counter'], hit['counteredBy'], hit['status']])
        else:
            ws2.append([idx, card, skill, '', '', '', '', '', '', '', '', '', ''])
    style_sheet(ws2, [5, 11, 12, 12, 9, 20, 10, 70, 55, 70, 18, 18, 11])

    # ---------- sheet3 核对 ----------
    ws3 = wb.create_sheet('需核对')
    ws3.append(['序号', '角色名称', '清单技能名', '设计案技能名', '技能ID', '情况'])
    n = 0
    for card, skill, hit, how, rows in report:
        if how != '同名':
            n += 1
            ws3.append([n, card, skill, hit['name'] if hit else '（无）',
                        hit['skillId'] if hit else '', how])
    style_sheet(ws3, [5, 12, 14, 14, 10, 40])

    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb.save(path)
    print('saved', path)


if __name__ == '__main__':
    rep = main()
    miss = [r for r in rep if r[2] is None]
    for card, skill, hit, how, _rows in rep:
        if how != '同名':
            print('%-8s %-10s -> %-10s %s %s' % (card, skill, how,
                                                 hit['skillId'] if hit else '', hit['name'] if hit else ''))
    print('total', len(rep), 'miss', len(miss))
    write_xlsx(rep, OUT)

