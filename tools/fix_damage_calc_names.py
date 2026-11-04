# -*- coding: utf-8 -*-
"""技能伤害测算页 · 按实际研发配置修正（2026-11-03）。

问题：测算页有 34 行被动/主动技能名仍是早期方案命名（甚至 68010 五行整组挂着
风法师模板名「风刃吐息 / 冰霜之躯 / 霜冻建筑 / 亡灵母舰 / 冰冻吐息」），
与研发实际配置（pvpSkillPlan.skillName）不一致。

修正口径：
  1. 技能名：全部对齐 pvpSkillPlan.skillName（动态读取，不硬编码）；
  2. 68010 普攻 201001：对齐主表「镭射能量线」；
  3. 68010 的 101003/101004 触发类型、触发参数、伤害类型、倍率
     原来是占位（「主动 / 待定 / 召唤 / 0」与「主动 / 待定 / AoE DoT / 1.2~1.6」），
     按研发实际修正：
       · 101003 追踪导弹：主动-冷却秒数 12 · 随机多点 · 3/5/8
       · 101004 镭射死光：主动-累计普攻 8 · 直线·穿透 · 2.0/2.6/3.2

不动：解锁等级列（已与 plan 一致）、O 列之后的测算公式（按 $A 列卡牌 ID 引用，
不硬编码技能名，改名安全）。

⚠️ openpyxl 另存会把冻结窗格掉回默认值，存完必须写回（本页 F13）。
"""

import json

from openpyxl import load_workbook

PATH = r'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
PLAN_JSON = r'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json'

SHEET = '技能伤害测算'
#  列号：1 卡牌ID / 4 技能ID / 5 技能名 / 6 触发类型 / 7 触发参数 / 8 伤害类型 / 9~11 倍率
COL_CARD, COL_SKILL, COL_NAME = 1, 4, 5
COL_TRIGGER, COL_PARAM, COL_KIND = 6, 7, 8
COL_L1, COL_L2, COL_L3 = 9, 10, 11
FREEZE = 'F13'

#  68010 普攻（20xxxx 不在 plan 里）：对齐主表 47 行的命名。
NORMAL_ATTACK_NAMES = {'201001': '镭射能量线'}

#  68010 两行占位的触发 / 倍率修正（行号 → 目标值）。
OVERRIDE_ROWS = {
    52: {'trigger': '主动-冷却秒数', 'param': 12, 'kind': '随机多点', 'l1': 3, 'l2': 5, 'l3': 8},
    53: {'trigger': '主动-累计普攻', 'param': 8, 'kind': '直线·穿透', 'l1': 2.0, 'l2': 2.6, 'l3': 3.2},
    #  旧模板遗留：裂变凿击是「命中附加 50% 伤害」的增伤被动，不是减益。
    51: {'kind': '无直接伤害（增益）'},
}


def load_plan_names():
    """skillChainId → skillName（plan 内同名多档，取任意一行）。"""
    raw = json.load(open(PLAN_JSON, encoding='utf-8'))
    names = {}
    for row in raw:
        chain = str(row['skillChainId'])
        name = row.get('skillName')
        if chain and name and chain not in names:
            names[chain] = name
    return names


def main():
    plan_names = load_plan_names()
    wb = load_workbook(PATH)
    ws = wb[SHEET]
    freeze = ws.freeze_panes

    renamed, overridden = [], []
    for r in range(4, ws.max_row + 1):
        card = ws.cell(r, COL_CARD).value
        skill_id = ws.cell(r, COL_SKILL).value
        if card is None or skill_id is None:
            continue
        sid = str(skill_id)
        #  ── 技能名 ──
        target_name = NORMAL_ATTACK_NAMES.get(sid) or plan_names.get(sid)
        if target_name:
            old = ws.cell(r, COL_NAME).value
            if old != target_name:
                ws.cell(r, COL_NAME).value = target_name
                renamed.append((r, sid, old, target_name))
        #  ── 68010 占位触发 / 倍率 ──
        if r in OVERRIDE_ROWS:
            fix = OVERRIDE_ROWS[r]
            if 'trigger' in fix:
                ws.cell(r, COL_TRIGGER).value = fix['trigger']
                ws.cell(r, COL_PARAM).value = fix['param']
            ws.cell(r, COL_KIND).value = fix['kind']
            if 'l1' in fix:
                ws.cell(r, COL_L1).value = fix['l1']
                ws.cell(r, COL_L2).value = fix['l2']
                ws.cell(r, COL_L3).value = fix['l3']
            overridden.append(r)

    ws.freeze_panes = freeze or FREEZE
    wb.save(PATH)

    #  ── 回读断言 ──
    wb2 = load_workbook(PATH)
    ws2 = wb2[SHEET]
    assert ws2.freeze_panes == (freeze or FREEZE), ws2.freeze_panes
    for r, sid, _, new in renamed:
        assert str(ws2.cell(r, COL_NAME).value) == new, (r, ws2.cell(r, COL_NAME).value)
    for r, fix in OVERRIDE_ROWS.items():
        assert str(ws2.cell(r, COL_KIND).value) == fix['kind'], r
        if 'trigger' in fix:
            assert str(ws2.cell(r, COL_TRIGGER).value) == fix['trigger'], r
        if 'l1' in fix:
            assert float(ws2.cell(r, COL_L1).value) == fix['l1'], r

    print('[ok] 技能名修正 %d 行：' % len(renamed))
    for r, sid, old, new in renamed:
        print('    r%-4d %s  %s -> %s' % (r, sid, old, new))
    print('[ok] 68010 触发/倍率修正行：', overridden)
    print('[ok] 冻结窗格：%s' % ws2.freeze_panes)


if __name__ == '__main__':
    main()
