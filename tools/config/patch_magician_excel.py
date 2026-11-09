# -*- coding: utf-8 -*-
"""把魔术师技能重做的结果同步回 4 张 Excel 源表（2026-11-06）。

对应 JSON 由 `tools/config/patch_magician_skills.js` 写入，本脚本只是把同一份结果
镜像到策划表，保证「转表产物 / remoteRef / Excel 源表」三处一致。

改到的地方：
  1. PVP-技能.xlsx（技能配置）：30710 强化次数/触发方式/副技能；30854 → 鹿神守护；
     删除 30855 空间置换整行。
  2. J-技能表.xlsx（PVP技能配置）：删 103403 三行、改 103404 三行、追加 103405 三行。
  3. K-卡牌升级.xlsx（卡牌技能升级表）：删 103403 三行、改 103404 三行、追加 103405 三行。
  4. PVP-卡牌.xlsx：68034 的 skillList。

守卫：每一步都先按 id 找行、找不到就抛错，避免行序漂移时静默改错行。
"""
import copy
import json

import openpyxl

DOC_JSON = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/'
XLSX = 'D:/Alan/Project/POW/doc/塔防数据配置/'

UNIT_ID = '68034'
ATTACK_SKILL = 30710
ULT_SKILL = 30854
RETIRED_SKILL = 30855


def rows_of(table):
    raw = json.load(open(DOC_JSON + table + '.json', encoding='utf-8'))
    return raw if isinstance(raw, list) else raw['rows']


def find_row(ws, col, value, first=4):
    for row in range(first, ws.max_row + 1):
        cell = ws.cell(row, col).value
        if cell is not None and str(cell) == str(value):
            return row
    return None


# ────────────────────────────── 1. PVP-技能.xlsx
def patch_pvp_skill():
    path = XLSX + 'PVP-技能.xlsx'
    wb = openpyxl.load_workbook(path)
    ws = wb['技能配置']

    skill = {row['skillId']: row for row in rows_of('pvpSkill')}
    attack = skill[ATTACK_SKILL]
    ultimate = skill[ULT_SKILL]

    row = find_row(ws, 1, ATTACK_SKILL)
    if row is None:
        raise SystemExit('[fail] PVP-技能 找不到 %s' % ATTACK_SKILL)
    # H=强化次数, K=触发方式, R=副技能ID
    ws.cell(row, 8).value = attack['empoweredEvery']
    ws.cell(row, 11).value = attack['trigger']
    ws.cell(row, 18).value = None
    print('[ok] PVP-技能 第 %d 行（%s）：强化次数=%s 触发方式=%s 副技能=空'
          % (row, ATTACK_SKILL, attack['empoweredEvery'], attack['trigger']))

    row = find_row(ws, 1, ULT_SKILL)
    if row is None:
        raise SystemExit('[fail] PVP-技能 找不到 %s' % ULT_SKILL)
    # B=名称, G=范围半径, J=技能特效预设, M=伤害倍率, N=持续时间, O=波次
    ws.cell(row, 2).value = ultimate['name']
    ws.cell(row, 7).value = ultimate['areaRadius']
    ws.cell(row, 10).value = ultimate['effectPrefabPath']
    ws.cell(row, 13).value = ultimate['damageRate']
    ws.cell(row, 14).value = ultimate['durationSeconds']
    ws.cell(row, 15).value = ultimate['waves']
    print('[ok] PVP-技能 第 %d 行（%s）：%s / 半径 %s / 持续 %ss'
          % (row, ULT_SKILL, ultimate['name'], ultimate['areaRadius'], ultimate['durationSeconds']))

    row = find_row(ws, 1, RETIRED_SKILL)
    if row is None:
        raise SystemExit('[fail] PVP-技能 找不到 %s' % RETIRED_SKILL)
    ws.delete_rows(row, 1)
    print('[ok] PVP-技能 删除第 %d 行（%s 空间置换）' % (row, RETIRED_SKILL))

    wb.save(path)


# ────────────────────────────── 2. J-技能表.xlsx
PLAN_COLS = {
    'enabled': 1, 'modifierId': 2, 'unitId': 3, 'skillChainId': 4, 'skillName': 5,
    'skillLevel': 6, 'unlockHeroLevel': 7, 'skillKind': 8, 'passiveScope': 9,
    'progressionMode': 10, 'pvpSkillId': 11, 'triggerEvent': 12, 'behaviorKey': 13,
    'stateMode': 14, 'targetSelector': 15, 'statId': 16, 'operation': 17, 'value': 18,
    'statusId': 19, 'statusStatJson': 20, 'durationSeconds': 21, 'maxStacks': 22,
    'cooldown': 23, 'maxTriggers': 24, 'desc': 25, 'sourceVersion': 26,
    'publishStatus': 27, 'skillParamJson': 29,
}


def write_plan_row(ws, row, data):
    for key, col in PLAN_COLS.items():
        value = data.get(key)
        if key in ('value', 'durationSeconds', 'maxStacks', 'cooldown', 'maxTriggers') and value is None:
            value = None
        ws.cell(row, col).value = value


def patch_skill_plan():
    path = XLSX + 'J-技能表.xlsx'
    wb = openpyxl.load_workbook(path)
    ws = wb['PVP技能配置']

    # 2a. 删 103403 三行（从下往上删，行号才不会漂）
    victims = [r for r in range(4, ws.max_row + 1)
               if str(ws.cell(r, 4).value) == '103403' and str(ws.cell(r, 3).value) == UNIT_ID]
    if len(victims) != 3:
        raise SystemExit('[fail] 103403 应恰好 3 行，实际 %d' % len(victims))
    for row in sorted(victims, reverse=True):
        ws.delete_rows(row, 1)
    print('[ok] J-技能表 删除 103403 帽子戏法 %d 行' % len(victims))

    # 2b. 用 JSON 覆盖 103404 三行
    plans = [r for r in rows_of('pvpSkillPlan') if str(r['unitId']) == UNIT_ID]
    blink = sorted([r for r in plans if int(r['skillChainId']) == 103404],
                   key=lambda r: int(r['skillLevel']))
    deer = sorted([r for r in plans if int(r['skillChainId']) == 103405],
                  key=lambda r: int(r['skillLevel']))
    if len(blink) != 3 or len(deer) != 3:
        raise SystemExit('[fail] 计划行数量不对 blink=%d deer=%d' % (len(blink), len(deer)))

    for item in blink:
        row = find_row(ws, 2, item['modifierId'])
        if row is None:
            raise SystemExit('[fail] J-技能表 找不到修改器 %s' % item['modifierId'])
        # 先清空这一行，避免旧值（statusId / 数值列）残留成幽灵
        for col in range(1, ws.max_column + 1):
            ws.cell(row, col).value = None
        write_plan_row(ws, row, item)
    print('[ok] J-技能表 改写 103404 移形换影 3 行')

    # 2c. 追加 103405 三行（样式照抄 103404 的第一行）
    template_row = find_row(ws, 2, blink[0]['modifierId'])
    last = ws.max_row
    for offset, item in enumerate(deer, start=1):
        row = last + offset
        for col in range(1, ws.max_column + 1):
            source = ws.cell(template_row, col)
            target = ws.cell(row, col)
            target._style = copy.copy(source._style)
        write_plan_row(ws, row, item)
    print('[ok] J-技能表 追加 103405 鹿神守护 3 行（第 %d~%d 行）' % (last + 1, last + 3))

    wb.save(path)


# ────────────────────────────── 3. K-卡牌升级.xlsx
def patch_army_skill():
    path = XLSX + 'K-卡牌升级.xlsx'
    wb = openpyxl.load_workbook(path)
    ws = wb['卡牌技能升级表']

    victims = [r for r in range(4, ws.max_row + 1) if str(ws.cell(r, 1).value) == '103403']
    if len(victims) != 3:
        raise SystemExit('[fail] 卡牌技能升级表 103403 应恰好 3 行，实际 %d' % len(victims))
    for row in sorted(victims, reverse=True):
        ws.delete_rows(row, 1)
    print('[ok] K-卡牌升级 删除 103403 帽子戏法 %d 行' % len(victims))

    rows = rows_of('armySkillLevelUp')
    by_key = {(int(r['id']), int(r['skilllevel'])): r for r in rows}
    for level in (1, 2, 3):
        item = by_key[(103404, level)]
        row = None
        for r in range(4, ws.max_row + 1):
            if str(ws.cell(r, 1).value) == '103404' and int(ws.cell(r, 5).value or 0) == level:
                row = r
                break
        if row is None:
            raise SystemExit('[fail] 卡牌技能升级表 找不到 103404 lv%d' % level)
        ws.cell(row, 2).value = item['name']
        ws.cell(row, 3).value = item['desc']
    print('[ok] K-卡牌升级 改写 103404 移形换影 3 行')

    template_row = None
    for r in range(4, ws.max_row + 1):
        if str(ws.cell(r, 1).value) == '103404':
            template_row = r
            break
    if template_row is None:
        raise SystemExit('[fail] 卡牌技能升级表 找不到 103404 模板行')

    last = ws.max_row
    for offset, level in enumerate((1, 2, 3), start=1):
        item = by_key[(103405, level)]
        row = last + offset
        for col in range(1, ws.max_column + 1):
            target = ws.cell(row, col)
            target._style = copy.copy(ws.cell(template_row, col)._style)
        ws.cell(row, 1).value = 103405
        ws.cell(row, 2).value = item['name']
        ws.cell(row, 3).value = item['desc']
        ws.cell(row, 4).value = item['unlockarmylevel']
        ws.cell(row, 5).value = item['skilllevel']
        ws.cell(row, 6).value = item['costCoinID']
        ws.cell(row, 7).value = item['costCoinNum']
        ws.cell(row, 8).value = item['costArmySkillLevelID']
        ws.cell(row, 9).value = item['costArmySkillLevelNum']
        ws.cell(row, 10).value = item['armySkillType']
        ws.cell(row, 12).value = json.dumps(item['modfiy'])
    print('[ok] K-卡牌升级 追加 103405 鹿神守护 3 行（第 %d~%d 行）' % (last + 1, last + 3))

    wb.save(path)


# ────────────────────────────── 4. PVP-卡牌.xlsx
def patch_card():
    path = XLSX + 'PVP-卡牌.xlsx'
    wb = openpyxl.load_workbook(path)
    ws = wb[wb.sheetnames[0]]
    header_row = 3
    cols = {str(ws.cell(header_row, c).value).strip(): c for c in range(1, ws.max_column + 1)}
    id_col = None
    for name in ('unitId', '卡牌ID', 'id'):
        if name in cols:
            id_col = cols[name]
            break
    if id_col is None:
        raise SystemExit('[fail] PVP-卡牌 找不到 id 列，表头=%s' % list(cols)[:8])
    # Excel 表头是中文「技能组」，转表产物里才叫 skillList —— 两个名都认。
    skill_col = cols.get('skillList') or cols.get('技能组')
    if skill_col is None:
        raise SystemExit('[fail] PVP-卡牌 找不到 skillList / 技能组 列')
    row = find_row(ws, id_col, UNIT_ID)
    if row is None:
        raise SystemExit('[fail] PVP-卡牌 找不到 %s' % UNIT_ID)
    ws.cell(row, skill_col).value = '[103401, 103402, 103404, 103405]'
    print('[ok] PVP-卡牌 第 %d 行（%s）：skillList → 103401/103402/103404/103405' % (row, UNIT_ID))
    wb.save(path)


patch_pvp_skill()
patch_skill_plan()
patch_army_skill()
patch_card()
print('\n[完成] 4 张 Excel 源表已同步')
