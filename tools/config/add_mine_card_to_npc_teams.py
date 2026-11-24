# -*- coding: utf-8 -*-
"""给「塔防队伍的 NPC 卡组」补金矿卡（`npcTeam.npcCard` += `50002`）。

2026-11-23 用户问：「NPC 卡组缺金矿卡，金矿卡是需要配置还是脚本里有默认的」。

答：**必须配置，代码里没有任何默认补一张的机制。**
  · `pvpTileGenParams.initialGuaranteedMine = 1` 保证每个主城六邻格里必有一格金矿；
  · `pvpTile.10005 金矿` 的 `eligibleCardTypes = [1]`，而塔防这一路只认 `npcTeam.npcCard`
    投影出来的卡池（`ZCBattleEntryBuilder.clipToLevelCards` 裁到 `enemyCardIds`）；
  · 队伍里一张 type=1 都没有 ⇒ `drawPvpTile` 的候选为空 ⇒ **那格 100% 空手**（NPC 白扔一次开发）。
  · 全表就一张金矿卡：怪物卡 `50002`（经 `projectCard` 的同名映射落到 pvpCard `2001`）。
    别往 `npcCard` 里写 `2001`（那是 pvpCard id 空间）。

口径（与既有 95 支队伍一致）：每支塔防队伍都带一张 `{"cardID": 50002, "level": 1}`。
本次只补「全是 5xxxx 怪物卡 + 缺 50002」的队伍 —— 即新增的 7001~7070（对应 70 个新关卡）。

⚠️ 队伍上限 8 张（`ZCClientCombatConfig.ZC_MAX_BATTLE_HERO_CARDS`），超了会被 `buildBattleDeck`
   截掉第 9 张 ⇒ 这里先体检再写，超限直接中止，不静默截断。

用法：
    python tools/config/add_mine_card_to_npc_teams.py            # 预演
    python tools/config/add_mine_card_to_npc_teams.py --apply     # 真写（源表 zip 级手术 + 两份产物）
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import time

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
POW_ROOT = os.path.dirname(PROJECT_ROOT)
DOC = os.path.join(POW_ROOT, 'doc', '塔防数据配置')

XLSX = os.path.join(DOC, 'PVP-关卡.xlsx')
CLIENT_JSON = os.path.join(DOC, 'json', 'client', 'npcTeam.json')
REMOTE_REF = os.path.join(PROJECT_ROOT, 'assets', 'remoteRef', 'npcTeam.json')

SHEET_MEMBER = 'xl/worksheets/sheet2.xml'      # npcTeam 在这张表（sheet1 是 levelInfo）
ID_COLUMN = 'A'
CARD_COLUMN = 'D'
MINE_CARD_ID = 50002
MAX_CARDS = 8

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402


def load(path: str):
    with io.open(path, encoding='utf-8') as handle:
        data = json.load(handle)
    if isinstance(data, dict):
        return [dict(zip(data['k'], row)) for row in data['v']], data
    return data, None


def card_text(entries: list[dict]) -> str:
    """源表 `npcCard` 格子的文本口径（与既有行逐字一致：冒号 / 逗号后各一个空格）。"""
    return '[%s]' % ', '.join(
        '{"cardID": %d, "level": %d}' % (int(e['cardID']), int(e.get('level', 1)))
        for e in entries)


def card_ids(team: dict) -> list[int]:
    return [int(entry['cardID']) for entry in (team.get('npcCard') or [])]


def targets_of(teams: list[dict]) -> tuple[list[dict], list[str]]:
    """全是 5xxxx 怪物卡、且缺 50002 的队伍。别的 id 空间（68001 那批玩家阵容）不碰。"""
    picked: list[dict] = []
    skipped: list[str] = []
    for team in teams:
        ids = card_ids(team)
        if not ids:
            continue
        if not all(50000 <= card_id < 60000 for card_id in ids):
            continue                                   # 玩家阵容那一套，走 pvpCard id
        if MINE_CARD_ID in ids:
            continue                                   # 已经带了
        if len(ids) + 1 > MAX_CARDS:
            skipped.append('%s：已有 %d 张，补完超过上限 %d' % (team['npcTeamId'], len(ids), MAX_CARDS))
            continue
        picked.append(team)
    return picked, skipped


def xlsx_rows(xml: str) -> dict[int, str]:
    """npcTeamId → 工作表行号（列 A 是数字的才算）。"""
    result: dict[int, str] = {}
    for row_ref, body in re.findall(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S):
        cell = re.search(r'<c r="%s%s"[^>]*>\s*<v>(\d+)</v>' % (ID_COLUMN, row_ref), body)
        if cell:
            result.setdefault(int(cell.group(1)), row_ref)
    return result


def main(argv: list[str]) -> int:
    apply = '--apply' in argv
    client, _ = load(CLIENT_JSON)
    remote, remote_store = load(REMOTE_REF)
    picked, skipped = targets_of(client)

    print('客户端队伍 %d 支；需要补金矿的 %d 支' % (len(client), len(picked)))
    if skipped:
        for note in skipped:
            print('  ⚠️ ' + note)
    print('目标队伍号：%s' % ', '.join(str(t['npcTeamId']) for t in picked[:12])
          + (' …' if len(picked) > 12 else ''))

    xml = read_zip_rows(XLSX, SHEET_MEMBER)
    row_of = xlsx_rows(xml)
    missing_rows = [t['npcTeamId'] for t in picked if t['npcTeamId'] not in row_of]
    if missing_rows:
        raise SystemExit('源表里找不到这些队伍的行号：%s' % missing_rows)

    # 源表：只改 npcCard 那一格（zip 级手术，其余字节原样）。
    cells: dict[str, object] = {}
    for team in picked:
        team_id = team['npcTeamId']
        deck = list(team['npcCard']) + [{'cardID': MINE_CARD_ID, 'level': 1}]
        cells['%s%s' % (CARD_COLUMN, row_of[team_id])] = card_text(deck)
    print('源表待写 %d 格（%s 列）' % (len(cells), CARD_COLUMN))
    if picked:
        sample = next(iter(cells.items()))
        print('  样例 %s = %s' % (sample[0], sample[1]))

    if apply and cells:
        for ref, value in cells.items():
            xml = set_cell(xml, ref, value)
        backup_dir = os.path.join(PROJECT_ROOT, 'tmp', 'backup_mine_card_%s' % time.strftime('%Y%m%d_%H%M%S'))
        backup = write_zip(XLSX, SHEET_MEMBER, xml, backup_dir)
        print('源表已写 %d 格；备份 %s' % (len(cells), os.path.relpath(backup, PROJECT_ROOT)))

    # 两份产物：npcCard 是已解析的对象数组，直接追加一条。
    wanted = {t['npcTeamId'] for t in picked}
    total = 0
    for path, rows, store in ((CLIENT_JSON, client, None), (REMOTE_REF, remote, remote_store)):
        touched = 0
        for position, team in enumerate(rows):
            if team['npcTeamId'] not in wanted:
                continue
            deck = list(team.get('npcCard') or [])
            if any(int(e['cardID']) == MINE_CARD_ID for e in deck):
                continue
            deck.append({'cardID': MINE_CARD_ID, 'level': 1})
            if store is None:
                team['npcCard'] = deck
            else:
                store['v'][position][store['k'].index('npcCard')] = deck
            touched += 1
        if not touched:
            print('  %s：无差异（幂等）' % os.path.basename(path))
            continue
        if apply:
            #  列存原样 dump（保住 k/v/c 的顺序与 c 值），行数组按既有排版逐行拼。
            text = (json.dumps(store, ensure_ascii=False, indent=0, separators=(',', ':'))
                    if store is not None else
                    '[' + ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':'))
                                     for row in rows) + ']')
            with io.open(path, 'w', encoding='utf-8', newline='\n') as handle:
                handle.write(text)
            print('  %s：已写 %d 支' % (os.path.basename(path), touched))
        total += touched

    print('%s：队伍 %d 支 / 产物 %d 处%s'
          % ('已写盘' if apply else '待写', len(picked), total, '' if apply else '（加 --apply 真写）'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
