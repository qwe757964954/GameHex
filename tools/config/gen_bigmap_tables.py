#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BigMap 配置表一次性生成器（数值推算稿）。

背景：正式流程是「策划 Excel -> eSon 导表 -> assets/remoteRef/*.json」。
本机没有 `D:/City1001/doc/塔防数据配置`，所以这里用脚本把**推算数值**一次性写成
项目统一的 `{"k":[字段...],"v":[[值...]]}` 压缩格式，落到 remoteRef，供客户端 RefUtil 读取。

- 表名规则（用户 2026-10-17 指定）：`BigMap-<中文表名>`，12 张全部同前缀。
- 字段名 camelCase，端标记沿用原稿：1=服务端与客户端都读，3=仅客户端读，0=策划备注。
- 数值口径见 `docs/bigmap-系统实现说明.md` §2「数值推算」，改公式重跑本脚本即可。
- 重跑是**幂等覆盖**；已被策划改动过的表请先备份，或把该表从 TABLES 里摘掉。
"""

import json
import math
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "remoteRef")

# ---------------------------------------------------------------- 建筑

BUILDINGS = [
    # id, 名称, 类型, 占格, 数量上限, 解锁章节, 队列类型, 排序, 说明
    (71001, "主城", 1, 1, 1, 1, 1, 0, "控制全玩法产出进度、其他建筑等级上限与资源存储上限，随等级提升大地图伤害"),
    (71002, "粮食田", 2, 1, 3, 2, 1, 10, "产出建造资源：粮食"),
    (71003, "木材田", 2, 1, 3, 2, 1, 11, "产出建造资源：木材"),
    (71004, "铁矿田", 2, 1, 3, 2, 1, 12, "产出建造资源：铁矿"),
    (71005, "货币田", 3, 1, 1, 3, 1, 20, "产出大地图专用货币"),
    (71006, "科技树", 4, 1, 1, 4, 1, 30, "提供科技研发入口（本期只做建筑本体与属性加成）"),
    (71007, "建造队列", 5, 1, 1, 5, 1, 40, "提升可同时进行的建造队列数量"),
    (71008, "装饰雕像", 6, 1, 2, 6, 1, 50, "装饰建筑，提供微弱经济加成"),
]

# 各建筑升级曲线参数：id -> (基础粮, 基础木, 基础铁, 基础耗时秒, 属性加成千分比/级)
COST_CURVE = {
    71001: (200, 150, 100, 30, 50),
    71002: (120, 90, 60, 20, 0),
    71003: (120, 90, 60, 20, 0),
    71004: (120, 90, 60, 20, 0),
    71005: (150, 100, 80, 25, 0),
    71006: (300, 250, 200, 40, 20),
    71007: (400, 300, 250, 45, 0),
    71008: (100, 80, 60, 15, 10),
}
MAX_LEVEL = {71001: 6, 71002: 5, 71003: 5, 71004: 5, 71005: 5, 71006: 5, 71007: 5, 71008: 5}

# 资源田产出：id -> (初始每小时产量, 可累积小时数)
PRODUCE_CURVE = {
    71002: ("grain", 40, 12),
    71003: ("wood", 30, 12),
    71004: ("iron", 20, 12),
    71005: ("coin", 15, 12),
}


def building_levels():
    rows = []
    for bid, (grain, wood, iron, seconds, bonus) in COST_CURVE.items():
        is_main = bid == 71001
        for level in range(1, MAX_LEVEL[bid] + 1):
            scale = level ** 1.6
            rows.append([
                bid, level,
                int(grain * scale), int(wood * scale), int(iron * scale),
                int(10 * level),                                    # instantCost 钻石
                0 if is_main else 71001,                            # preBuildId
                0 if is_main else level,                            # preBuildLevel（其他建筑不得超过主城等级）
                int(seconds * level * level),                       # buildTime 秒
                int(800 * level ** 1.5) if is_main else level,      # maxOtherLevel（主城=其他建筑上限）
                int(800 * level ** 1.5) if is_main else 0,          # resCap（主城等级决定资源上限）
                bonus * (level - 1),                                # attrBonus 千分比
            ])
    return rows


def building_produce():
    rows = []
    for bid, (res, base, hours) in PRODUCE_CURVE.items():
        for level in range(1, MAX_LEVEL[bid] + 1):
            rows.append([bid, level, res, base * level, base * level * hours, "economy"])
    return rows


# ---------------------------------------------------------------- 城池

CITY_NAMES = ["前哨营地", "藤蔓哨塔", "废弃谷仓", "枯木岗", "碎石坡", "旧石桥",
              "铁栅关", "苔原驿站", "腐叶渠", "风车废墟", "松脂台", "雾隐堡"]

# 四条并行链，每条 3 座：链头立即开放，后两座各自依赖前一座被占领。
CITY_CHAINS = [
    # (cityId, chainIndex, step, level, slot, 解锁章节, 开放天数)
    (101, 0, 0, 1, 0, 2, 0), (102, 0, 1, 1, 1, 3, 0), (103, 0, 2, 2, 2, 4, 1),
    (104, 1, 0, 1, 3, 2, 0), (105, 1, 1, 1, 4, 3, 0), (106, 1, 2, 2, 5, 4, 1),
    (107, 2, 0, 1, 6, 2, 0), (108, 2, 1, 2, 7, 4, 1), (109, 2, 2, 2, 8, 5, 2),
    (110, 3, 0, 1, 9, 3, 0), (111, 3, 1, 2, 10, 4, 1), (112, 3, 2, 2, 11, 5, 2),
]

# 内层城池：slot 是**该环自己的**槽位序号，slotCount = 该环槽位总数。
# 三层环（内城 4 层结构：个人 / 军团 / 战盟 / 王座）分别落在大地图半径 18 / 12 / 6 / 0。
INNER_CITIES = [
    # 军团层（layer 2，本期不开放）
    *[(200 + i, 2, "军团壁垒", 2, 8, i) for i in range(8)],
    # 战盟层（layer 3）
    *[(300 + i, 3, "战盟王城", 3, 4, i) for i in range(4)],
    # 王座（layer 4，唯一）
    (401, 4, "王座", 4, 1, 0),
]

CITY_LEVEL = {
    # level: (战功倍率, 占领积分, 上榜战力门槛, 城池等级系数, 行动力消耗, 最低占领战功, 城防HP)
    1: (1.5, 300, 800, 1.1, 20, 800, 1600),
    2: (2.0, 600, 1500, 1.2, 30, 1600, 2600),
    3: (3.0, 1200, 2600, 1.3, 45, 3200, 4200),
    4: (5.0, 2400, 4200, 1.4, 60, 6400, 7000),
    5: (8.0, 4800, 6000, 1.5, 80, 12000, 11000),
}


def cities():
    rows = []
    prev_in_chain = {}
    for city_id, chain, step, level, slot, chapter, open_day in CITY_CHAINS:
        war, occupy, power, coeff, stamina, min_war, hp = CITY_LEVEL[level]
        rows.append([
            city_id, CITY_NAMES[city_id - 101], 1, 1, level, 1,
            chapter, open_day, stamina, hp, 10, coeff,
            prev_in_chain.get(chain, 0), int(round(hp * 0.15)), f"{CITY_NAMES[city_id - 101]}：占领后资源产出 +{int(round((coeff - 1) * 100))}%，战功倍率 ×{war}",
            slot, 12,
        ])
        prev_in_chain[chain] = city_id
    for city_id, layer, name, level, ring_slots, slot in INNER_CITIES:  # ring_slots = slotCount
        war, occupy, power, coeff, stamina, min_war, hp = CITY_LEVEL[level]
        rows.append([
            city_id, name, layer, 0, level, 0,
            99, 9999, stamina, hp, 10, coeff,
            0, 0, "联盟 / 战盟玩法本期不开放",
            slot, ring_slots,
        ])
    return rows


# ---------------------------------------------------------------- 野怪

MONSTERS = [
    # level, 名称, 占格, 行动力, 战功, 城防HP, 刷新秒
    (1, "腐化幼苗", 1, 10, 200, 600, 120),
    (2, "腐化藤蔓", 1, 15, 400, 1200, 180),
    (3, "腐化蘑菇", 2, 20, 800, 2400, 300),
    (4, "腐化树精", 2, 30, 1600, 4800, 600),
    (5, "腐化巨花", 4, 40, 3200, 9000, 900),
]
MONSTER_COUNT = {1: 6, 2: 5, 3: 4, 4: 3, 5: 2}


def monsters():
    rows = []
    mid = 8001
    for level, name, occupy, stamina, war, hp, respawn in MONSTERS:
        for _ in range(MONSTER_COUNT[level]):
            rows.append([
                mid, name, level, occupy, max(0, level - 1), stamina, war, hp, respawn,
                100 * level, 80 * level, 60 * level, 40 * level,
            ])
            mid += 1
    return rows


# ---------------------------------------------------------------- 静态表

WORLD_MAP = [[1, "植物大地图", 40, 40, 18, 12, 10, 18, 16, 11]]

RESOURCES = [
    ["grain", "粮食", "ui/bigmap/icon_grain", 800, 1],
    ["wood", "木材", "ui/bigmap/icon_wood", 800, 1],
    ["iron", "铁矿", "ui/bigmap/icon_iron", 800, 1],
    ["coin", "大地图货币", "ui/bigmap/icon_coin", 200, 1],
    ["stamina", "行动力", "ui/bigmap/icon_stamina", 120, 1],
]

QUEUE = [[1, 3, 1, 120, 360, 1.0, 8, 3, 5, 5]]

RANKS = [[1, 100], [2, 90], [3, 85], [4, 80], [5, 75],
         [6, 71], [7, 68], [8, 65], [9, 62], [10, 60]]

# 积分规则：伤害转战功的边际递减上限、名次外延、拥挤系数、越界伤害削减
# 字段顺序 = scoreRuleId, marginalDamageCap, rankExtendStepPct, rankExtendMinPct,
#           crowdBase, crowdK, offRangeDamageCutPct, npcScoreRatio
SCORE_RULES = [[1, 3000, 3, 30, 0.5, 0.5, 20, 0.3]]

# 字段顺序 = configId, staminaMax, recoverInterval, buyTimesDaily, buyCost, overflowKeep
# 行动力 240 = 12 次攻城：Demo 里一次会话能连下 2~3 座城，不会刚上手就被卡住。
STAMINA = [[1, 240, 360, 3, 50, 1]]


def write(name, key, rows):
    # 字段数与值个数不一致 → 解压后整行错位，客户端会读到「字段名对、值串行」的脏数据。
    # 这类错误在运行时极难发现，所以写盘前必须硬拦。
    for index, row in enumerate(rows):
        if len(row) != len(key):
            raise ValueError(f"{name} 第 {index + 1} 行有 {len(row)} 个值，但表头有 {len(key)} 个字段：{row}")
    path = os.path.join(OUT_DIR, name + ".json")
    payload = {"k": key, "v": rows}
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=0, separators=(",", ":"))
        handle.write("\n")
    print(f"{name}.json  {len(rows)} 行")


def main():
    write("BigMap-世界地图配置",
          ["worldId", "worldName", "rows", "cols", "cityRing1", "cityRing2",
           "baseRadiusMin", "baseRadiusMax", "npcBaseCount", "monsterRingMax"], WORLD_MAP)

    write("BigMap-建筑配置",
          ["id", "baseBuildName", "baseBuildType", "occupyHex", "maxOwnNum",
           "unlockChapter", "queueType", "sort", "baseBuildInfo"],
          [[b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8]] for b in BUILDINGS])

    write("BigMap-建筑升级",
          ["id", "buildLevel", "costGrain", "costWood", "costIron", "instantCost",
           "preBuildId", "preBuildLevel", "buildTime", "maxOtherLevel", "resCap", "attrBonus"],
          building_levels())

    write("BigMap-建筑产出",
          ["id", "buildLevel", "resType", "producePerHour", "produceCap", "techGroup"],
          building_produce())

    write("BigMap-资源定义",
          ["resType", "resName", "icon", "startAmount", "showInBar"], RESOURCES)

    write("BigMap-队列配置",
          ["id", "maxBuildQueue", "initBuildQueue", "queueUnlockCost2", "queueUnlockCost3",
           "cancelReturnRate", "offlineMaxHours", "upgradeUnlockChapter", "plotRows", "plotCols"],
          QUEUE)

    write("BigMap-城池配置",
          ["cityId", "cityName", "layer", "available", "cityLevel", "exclusive",
           "unlockChapter", "openDay", "staminaCost", "defenseHp", "radiateCapacity", "cityLevelCoeff",
           "prevCityId", "rewardCoin", "cityDesc", "slot", "slotCount"],
          cities())

    write("BigMap-城池等级",
          ["cityLevel", "warScoreRate", "occupyScore", "powerThreshold", "cityLevelCoeff",
           "staminaCost", "minOccupyWarScore", "defenseHp"],
          [[lv, *CITY_LEVEL[lv]] for lv in sorted(CITY_LEVEL)])

    write("BigMap-名次系数", ["rank", "coeffPct"], RANKS)

    write("BigMap-积分规则",
          ["scoreRuleId", "marginalDamageCap", "rankExtendStepPct", "rankExtendMinPct",
           "crowdBase", "crowdK", "offRangeDamageCutPct", "npcScoreRatio"],
          SCORE_RULES)

    write("BigMap-野怪配置",
          ["monsterId", "monsterName", "monsterLevel", "occupyHex", "preLevel",
           "staminaCost", "warScore", "defenseHp", "respawnSeconds",
           "rewardGrain", "rewardWood", "rewardIron", "rewardCoin"],
          monsters())

    write("BigMap-行动力配置",
          ["configId", "staminaMax", "recoverInterval", "buyTimesDaily", "buyCost", "overflowKeep"],
          STAMINA)


if __name__ == "__main__":
    main()
