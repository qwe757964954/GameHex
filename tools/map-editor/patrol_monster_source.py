# -*- coding: utf-8 -*-
"""巡逻宝箱野怪 `patrolId` 的**唯一真源**：对应关卡的「NPC 队伍」+「塔防出怪表波次」。

用户 2026-11-20：

    「在地图上展示的野怪 id 从对应关卡的 npc 队伍配置和塔防出怪表的波次中抽取 1 个」

## 为什么必须从表里推，不能手填、更不能按顺序轮转

`patrolId` 直连 `monsterCard.id` —— `TerritoryChapterLoader` 按它取 `monsterCard.unitPrefabPath`
去生成巡逻野怪预制。填一只**这张关卡里根本不会出现**的怪，画面照常出、控制台零报错，
只有玩家发现「打的关和地图上站的怪对不上」。这类错只能靠数据推导 + 用例盯。

（`chapter_01` 就是手工填的：`1002/1003/1004` 三片填了 `50005/50007/50005`，
三个都不在对应关卡 `60003/60005/60007` 的队伍与波次里，见 `reassign_patrol_ids.py` 的修复记录。）

## 「对应关卡」怎么算

`site.battleId` 是**宝箱组 id**（`monsterBox.monsterBoxId`），不是关卡 id：
`TerritoryCampaignRepository.patrolLevelIdMapOf` 取该组**最低等级**那行的
`monsterBox.monsterBoxLevel`，才落到 `levelInfo.levelId`。这一跳写错的表现是
「开始挑战」恒灰、点格子弹「站点配置待补齐」，同样零报错。

## 两个来源

- **NPC 队伍**：`levelInfo.extraCards.enemy` → `npcTeam.npcTeamId` → `npcCard[].cardID`。
  领地巡逻关卡都是 `levelMod == 2`（塔防），`buildTerritoryCampaign` 的 `defence` 分支
  只认 `extraCards.enemy` 这一支队伍，不走 `npcTeamMatch` 匹配。
- **塔防出怪表**：`defenceModWave` 里 `startId == levelInfo.levelModValue` 的行，
  按 `waveId` 升序取 `monsterId`。

两张表的 id 域都是 `monsterCard.id`（`50001~50039`），可以直接落到同一只怪；
`levelInfo.levelMonsterGroup` 的 `monsterId` 也是同一个域（它只是出怪表的汇总）。

## 抽哪一个

优先级见 {@link pick_patrol_id}：

1. **波次里出现、同时也在 NPC 队伍里**的最后一只 —— 实数据里就是 BOSS 波那只
   （`defenceModWave` 收尾怪物），**两个来源交叉命中**，单边改表时最不容易漂；
2. 否则波次最后一波；
3. 否则 NPC 队伍最后一张卡；
4. 三个都空 ⇒ 抛错（这关没有怪，配不成巡逻）。

## 幂等

纯读表 + 纯函数：重复跑结果逐字节一致。{@link assert_monster_card} 顺带确认选出来的 id
在 `monsterCard` 里有 `unitPrefabPath` —— 缺了 `TerritoryChapterLoader` 会抛
「巡逻野怪 X 缺少 monsterCard.unitPrefabPath」，这里先拦住。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[1]
REMOTE_REF = PROJECT / "assets" / "remoteRef"

MONSTER_BOX = REMOTE_REF / "monsterBox.json"
LEVEL_INFO = REMOTE_REF / "levelInfo.json"
NPC_TEAM = REMOTE_REF / "npcTeam.json"
DEFENCE_WAVE = REMOTE_REF / "defenceModWave.json"
MONSTER_CARD = REMOTE_REF / "monsterCard.json"

#: `defenceModWave.monsterType` 的 BOSS 档（`1` 普通 / `2` 精英 / `3` BOSS；表里目前写的是 2）。
BOSS_MONSTER_TYPE = 2


def read_column_store(path: Path) -> tuple[dict[str, int], list[list[Any]]]:
    """读 `{c:1,k:[…],v:[[…]]}` 列存 json，返回 `(列名→下标, 行列表)`。"""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("c") != 1:
        raise SystemExit(f"{path.name} 不是列存格式（c != 1）")
    keys = list(raw["k"])
    return {key: index for index, key in enumerate(keys)}, [list(row) for row in raw.get("v") or []]


def _dedup(values: list[int]) -> list[int]:
    """去重但**保持表内顺序**（顺序本身就是「第几波」的语义）。"""
    out: list[int] = []
    for value in values:
        if value not in out:
            out.append(value)
    return out


def pick_patrol_id(npc_cards: list[int], wave_ids: list[int]) -> tuple[int, str]:
    """从「NPC 队伍卡牌」与「波次怪物」里抽 1 只，返回 `(monsterCardId, 判据说明)`。

    判据写进返回值的第二项，`reassign_patrol_ids.py` 直接打出来 —— 改了表以后一眼能看出
    这只怪是被哪条规则抽中的，不用再读一遍代码。
    """
    npc_set = set(npc_cards)
    common = [monster for monster in wave_ids if monster in npc_set]
    if common:
        # 波次顺序里的最后一只 —— 收尾 BOSS 波，且 NPC 队伍里也有它。
        return common[-1], "塔防最后一波 ∧ NPC 队伍"
    if wave_ids:
        return wave_ids[-1], "塔防最后一波"
    if npc_cards:
        return npc_cards[-1], "NPC 队伍最后一张卡"
    return 0, "该关没有任何怪"


def assert_monster_card(ids: set[int]) -> None:
    """选出来的 id 必须能生成预制（`monsterCard.unitPrefabPath` 非空）。"""
    index, rows = read_column_store(MONSTER_CARD)
    if "unitPrefabPath" not in index:
        raise SystemExit(f"{MONSTER_CARD.name} 缺少 unitPrefabPath 列（表结构变了）")
    by_id = {int(row[index["id"]]): row[index["unitPrefabPath"]] for row in rows}
    for monster_id in sorted(ids):
        row = by_id.get(monster_id)
        if row is None:
            raise SystemExit(f"巡逻野怪 {monster_id} 不在 monsterCard 表里（地图上会生不出怪）")
        if not isinstance(row, str) or not row:
            raise SystemExit(f"巡逻野怪 {monster_id} 缺 monsterCard.unitPrefabPath（加载会抛错）")


def load_sources() -> dict[int, dict[str, Any]]:
    """`monsterBoxId → 该组的巡逻野怪真源`。

    返回的每一项：

    | 键 | 含义 |
    | :-- | :-- |
    | `levelId` | 必打关卡（该组**最低等级**行的 `monsterBoxLevel`，与游戏侧同口径） |
    | `maxLevelId` | 满级那行的 `monsterBoxLevel` |
    | `chapter` | `levelInfo.levelChapter` |
    | `npcTeamId` | `levelInfo.extraCards.enemy` |
    | `npcCards` | 该队伍 `npcCard[].cardID`（表内顺序） |
    | `waveIds` | 该关 `defenceModWave` 的 `monsterId`（按 `waveId`，去重） |
    | `pool` | 两个来源的并集，保持「队伍在前、波次在后」 |
    | `patrolId` | 抽中的那只 |
    | `basis` | 抽中判据（见 {@link pick_patrol_id}） |

    🔴 宝箱组只有**最低等级**那行决定地图上的巡逻怪：四档奖励都能打同一片巡逻区，
    锚点只有一个，取最低等级与 `patrolLevelIdMapOf` 完全一致。
    """
    box_index, box_rows = read_column_store(MONSTER_BOX)
    level_index, level_rows = read_column_store(LEVEL_INFO)
    team_index, team_rows = read_column_store(NPC_TEAM)
    wave_index, wave_rows = read_column_store(DEFENCE_WAVE)

    # 宝箱组 → 各等级行的关卡 id（保持行顺序，最低等级另行取 min）
    grades_of: dict[int, dict[int, int]] = {}
    for row in box_rows:
        box_id = int(row[box_index["monsterBoxId"]])
        grade = int(row[box_index["monsterBoxGrade"]])
        grades_of.setdefault(box_id, {})[grade] = int(row[box_index["monsterBoxLevel"]])

    levels = {int(row[level_index["levelId"]]): row for row in level_rows}
    teams = {int(row[team_index["npcTeamId"]]): row for row in team_rows}

    waves_of: dict[int, list[dict[str, Any]]] = {}
    for row in wave_rows:
        waves_of.setdefault(int(row[wave_index["startId"]]), []).append(row)

    out: dict[int, dict[str, Any]] = {}
    for box_id, grades in sorted(grades_of.items()):
        if not grades:
            continue
        level_id = min(grades.values())
        max_level_id = max(grades.values())
        level = levels.get(level_id)
        if level is None:
            raise SystemExit(f"宝箱组 {box_id} 的关卡 {level_id} 不在 levelInfo 里")
        extra = level[level_index["extraCards"]] or {}
        team_id = int(extra.get("enemy") or 0) if isinstance(extra, dict) else 0
        team = teams.get(team_id)
        npc_cards: list[int] = []
        for entry in (team[team_index["npcCard"]] if team else []) or []:
            raw = entry if isinstance(entry, dict) else {"cardID": entry}
            card_id = int(raw.get("cardID") or 0)
            if card_id:
                npc_cards.append(card_id)
        npc_cards = _dedup(npc_cards)

        start_id = int(level[level_index["levelModValue"]])
        ordered = sorted(waves_of.get(start_id) or [], key=lambda row: int(row[wave_index["waveId"]]))
        wave_ids = _dedup([int(row[wave_index["monsterId"]]) for row in ordered])

        patrol_id, basis = pick_patrol_id(npc_cards, wave_ids)
        out[box_id] = {
            "battleId": box_id,
            "levelId": level_id,
            "maxLevelId": max_level_id,
            "chapter": int(level[level_index["levelChapter"]]),
            "levelType": int(level[level_index["levelType"]]),
            "levelMod": int(level[level_index["levelMod"]]),
            "levelModValue": start_id,
            "npcTeamId": team_id,
            "npcCards": npc_cards,
            "waveIds": wave_ids,
            "pool": _dedup(npc_cards + wave_ids),
            "bossWaveIds": _dedup([
                int(row[wave_index["monsterId"]])
                for row in ordered
                if wave_index.get("monsterType") is not None
                and int(row[wave_index["monsterType"]] or 0) == BOSS_MONSTER_TYPE
            ]),
            "patrolId": patrol_id,
            "basis": basis,
        }
    return out


def describe(source: dict[str, Any]) -> str:
    """一行摘要，供脚本打印与人工核对。"""
    return (
        f"关卡 {source['levelId']}（满级 {source['maxLevelId']}，第 {source['chapter']} 章）"
        f" 队伍 {source['npcTeamId']}{source['npcCards']}"
        f" 波次 {source['waveIds']} ⇒ 巡逻怪 {source['patrolId']}（{source['basis']}）"
    )
