# -*- coding: utf-8 -*-
"""K-卡牌升级.xlsx 与 PVP-卡牌.xlsx 的魔术师同步（2026-11-06）。

为什么**不删行**：`卡牌技能升级表` 的「技能等级」列是一串 `=E(N-3)` 的自引用公式链，
删任意一行都会把后面的引用整体错位（openpyxl 不会重写公式），整张表就烂了。
所以 103403 那三行原地下线成 103405 鹿神守护 —— 正好也是三个等级档，
行数不变、公式链不动，且与 `armySkillLevelUp.json` 的内容一致。
"""
import json

import openpyxl

DOC_JSON = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/'
XLSX = 'D:/Alan/Project/POW/doc/塔防数据配置/'
RETIRED_CHAIN = '103403'
BLINK_CHAIN = '103404'
DEER_CHAIN = '103405'


def rows_of(table):
    raw = json.load(open(DOC_JSON + table + '.json', encoding='utf-8'))
    return raw if isinstance(raw, list) else raw['rows']


def patch_army_skill():
    path = XLSX + 'K-卡牌升级.xlsx'
    wb = openpyxl.load_workbook(path)
    ws = wb['卡牌技能升级表']

    rows = {(int(r['id']), int(r['skilllevel'])): r for r in rows_of('armySkillLevelUp')}

    # ① 103403 三行原地下线成 103405（行数不变，E 列公式链不动）
    victims = [r for r in range(4, ws.max_row + 1) if str(ws.cell(r, 1).value) == RETIRED_CHAIN]
    if len(victims) != 3:
        raise SystemExit('[fail] 103403 应恰好 3 行，实际 %d' % len(victims))
    for level, row in enumerate(sorted(victims), start=1):
        item = rows[(int(DEER_CHAIN), level)]
        ws.cell(row, 1).value = int(DEER_CHAIN)
        ws.cell(row, 2).value = item['name']
        ws.cell(row, 3).value = item['desc']
        ws.cell(row, 4).value = item['unlockarmylevel']
        # E 列是公式（=E(N-3)），保留不动。
        ws.cell(row, 10).value = item['armySkillType']
        print('[ok] K-卡牌升级 第 %d 行：103403 lv%d → 103405 %s lv%d'
              % (row, level, item['name'], level))

    # ② 103404 改名 + 换描述
    level_seen = 0
    for r in range(4, ws.max_row + 1):
        if str(ws.cell(r, 1).value) != BLINK_CHAIN:
            continue
        level_seen += 1
        item = rows[(int(BLINK_CHAIN), level_seen)]
        ws.cell(r, 2).value = item['name']
        ws.cell(r, 3).value = item['desc']
        print('[ok] K-卡牌升级 第 %d 行：%s → %s' % (r, '空间置换', item['name']))
    if level_seen != 3:
        raise SystemExit('[fail] 103404 应恰好 3 行，实际 %d' % level_seen)

    wb.save(path)


def patch_card():
    path = XLSX + 'PVP-卡牌.xlsx'
    wb = openpyxl.load_workbook(path)
    ws = wb['卡牌配置']
    header = {str(ws.cell(3, c).value).strip(): c for c in range(1, ws.max_column + 1)}
    id_col = header.get('卡牌ID') or header.get('unitId')
    skill_col = header.get('技能组') or header.get('skillList')
    if not id_col or not skill_col:
        raise SystemExit('[fail] PVP-卡牌 表头对不上：%s' % list(header)[:8])
    for r in range(4, ws.max_row + 1):
        if str(ws.cell(r, id_col).value) == '68034':
            ws.cell(r, skill_col).value = '[103401, 103402, 103404, 103405]'
            print('[ok] PVP-卡牌 第 %d 行：技能组 → [103401, 103402, 103404, 103405]' % r)
            wb.save(path)
            return
    raise SystemExit('[fail] PVP-卡牌 找不到 68034')


patch_army_skill()
patch_card()
print('\n[完成] K-卡牌升级 / PVP-卡牌 已同步')
