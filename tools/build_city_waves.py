# -*- coding: utf-8 -*-
"""按城池关卡 50001~50081 批量补塔防出怪（startId 5002~5081）与 NPC 队伍（6001~6081）。"""
import copy, json, os, shutil
import openpyxl

SRC = r"D:/Alan/Project/POW/doc/塔防数据配置/PVP-关卡.xlsx"
CARD = r"D:/Alan/Project/POW/doc/塔防数据配置/PVP-怪物卡牌.xlsx"
BAK = r"D:/Alan/Project/POW/Demo3.8/tmp/PVP-关卡_备份_before_city_waves.xlsx"

# ---------- 卡池：仅品级 1~2 的战斗单位 + 主城/金矿 ----------
wb_c = openpyxl.load_workbook(CARD, read_only=True)
ws_c = wb_c["怪物卡牌"]
pool = {1: [], 2: [], 3: [], 4: []}
for r in range(7, ws_c.max_row + 1):
    cid, ctype, rarity, enabled = (ws_c.cell(r, c).value for c in (1, 3, 4, 7))
    if not cid or enabled != 1:
        continue
    if int(ctype or 0) == 2:                          # 只取战斗单位（兵营卡）
        pool.setdefault(int(rarity), []).append(cid)
wb_c.close()
R1 = sorted(pool[1])          # 品级1
R2 = sorted(pool[2])          # 品级2
ALL = sorted(pool[1] + pool[2] + pool[3] + pool[4])

# ---------- 常量 ----------
CITY_LEVEL0 = 50000           # 城池关卡 levelId 50001~50081
NPC_ID0 = 6000                # 城池 NPC 队伍 6001~6081
WAVE_ID0 = 5001               # 出怪 startId 5001~5081（5001 已存在）
N_CITY = 81

RARITY_BY_WAVE = [1, 1, 2, 2, 3, 3, 3, 4, 4, 4]      # 品阶逐波抬升
NUM_BY_WAVE = [5, 10, 10, 15, 18, 20, 15, 18, 20, 1]  # 波次数量（沿用 5001 节奏，抹平中段凹口）
REST_BY_WAVE = [1, 1, 0, 1, 1, 1, 1, 1, 0, 1]        # 场景剩余提前出怪


def wave_seconds(city_idx):
    """总时长 180s ~ 260s（第1城 → 第81城），10 波等分。"""
    total = 180 + (city_idx - 1) * 1.0
    return [int(round(3 + (w - 1) * (total - 3) / 9)) for w in range(1, 11)]


BOSS_POOL = [50017, 50011, 50029, 50009, 50035, 50020, 50010, 50012]  # 血量/威胁最高的品级4单位


def monster_for(rarity, city_idx, wave):
    if wave == 10:                                     # 末波固定从 BOSS 池取
        return BOSS_POOL[(city_idx - 1) % len(BOSS_POOL)]
    src = pool[rarity] or pool[4]
    return src[(city_idx * 3 + wave * 5) % len(src)]


def build_waves(city_idx):
    rows, times = [], wave_seconds(city_idx)
    for w in range(1, 11):
        rarity = RARITY_BY_WAVE[w - 1]
        boss = (w == 10)
        mid = monster_for(rarity, city_idx, w)
        num = NUM_BY_WAVE[w - 1]
        if not boss:
            num = max(1, int(round(num * (1 + 0.008 * (city_idx - 1)))))
            hp = 0.8 + 0.01 * (city_idx - 1) + 0.05 * (w - 1)
            atk = 1.1 + 0.005 * (city_idx - 1) + 0.025 * (w - 1)
        else:
            hp = 1.0 + 0.015 * (city_idx - 1)
            atk = 1.0 + 0.008 * (city_idx - 1)
        rows.append([WAVE_ID0 + city_idx - 1, w, times[w - 1], mid,
                     2 if boss else 1, num, round(hp, 2), round(atk, 2),
                     REST_BY_WAVE[w - 1]])
    return rows


def build_team(city_idx):
    level = 1 + (city_idx - 1) // 9                   # 1 → 9 级，逐城提升
    n_unit = 2 + (city_idx - 1) // 20                 # 2 → 6 只，越大城越多
    order = (R1 + R2) if city_idx <= 27 else (R2 + R1)  # 后段城池优抽取品级2
    units = [order[(city_idx + k * 5) % len(order)] for k in range(n_unit)]
    cards = [50001, 50002] + units                    # 主城 + 金矿 + 兵种
    return level, cards


def cards_json(cards, level):
    return "[" + ", ".join('{"cardID": %d, "level": %d}' % (c, level) for c in cards) + "]"


# ---------- 写入 ----------
if "--dry" in __import__("sys").argv:
    for idx in (1, 2, 3, 20, 40, 60, 81):
        print("== 第%d城 关卡%d 出怪%d NPC%d" % (idx, CITY_LEVEL0 + idx, WAVE_ID0 + idx - 1, NPC_ID0 + idx))
        for w in build_waves(idx):
            print("   ", w)
        lv, cs = build_team(idx)
        print("    NPC lv%d" % lv, cards_json(cs, lv), "时长", wave_seconds(idx)[-1], "s")
    raise SystemExit(0)

os.makedirs(os.path.dirname(BAK), exist_ok=True)
shutil.copy2(SRC, BAK)

wb = openpyxl.load_workbook(SRC)

# 塔防出怪表
ws = wb["塔防出怪表"]
tpl_style = [copy.copy(ws.cell(21, c)._style) for c in range(1, 10)]
r = ws.max_row
while r > 7 and ws.cell(r, 1).value is None:
    r -= 1
r += 1
for city_idx in range(2, N_CITY + 1):
    for row in build_waves(city_idx):
        for c in range(1, 10):
            cell = ws.cell(r, c)
            cell._style = copy.copy(tpl_style[c - 1])
            cell.value = row[c - 1]
        r += 1
wave_last = r - 1

# NPC队伍配置
ws2 = wb["NPC队伍配置"]
tpl2 = [copy.copy(ws2.cell(18, c)._style) for c in range(1, 6)]
r2 = ws2.max_row
while r2 > 7 and ws2.cell(r2, 1).value is None:
    r2 -= 1
r2 += 1
for city_idx in range(1, N_CITY + 1):
    level, cards = build_team(city_idx)
    lid = CITY_LEVEL0 + city_idx
    vals = [NPC_ID0 + city_idx, 2, "[%d,%d]" % (lid, lid), cards_json(cards, level),
            "大地图城池据点-%d（出怪%d）" % (lid, WAVE_ID0 + city_idx - 1)]
    for c in range(1, 6):
        cell = ws2.cell(r2, c)
        cell._style = copy.copy(tpl2[c - 1])
        cell.value = vals[c - 1]
    r2 += 1
npc_last = r2 - 1

wb.save(SRC)
print("出怪 行 %d~%d（%d 行）" % (31, wave_last, wave_last - 30))
print("NPC  行 %d~%d（%d 行）" % (81, npc_last, npc_last - 80))
print("备份", BAK)
