# -*- coding: utf-8 -*-
"""按大地图 json 的 label 补全 DM-城池配置.xlsx 到 81 城，保持原有格式。"""
import json, copy, os
import openpyxl

SRC = r"D:/Alan/Project/POW/doc/塔防数据配置/DM-城池配置.xlsx"
MAP = r"D:/Alan/Project/POW/Demo3.8/tools/map-editor/presets/bigmap/dadi_tuchugao.json"
OUT_DIR = r"D:/Alan/占城玩法/策划文档/大地图"
OUT = os.path.join(OUT_DIR, "DM-城池配置_81城池.xlsx")

wb = openpyxl.load_workbook(SRC)
ws = wb["城池配置"]

# ---------- 读现有数据 ----------
COLS = 27
existing = {}
for r in range(7, ws.max_row + 1):
    vals = [ws.cell(r, c).value for c in range(1, COLS + 1)]
    if vals[0] is None:
        continue
    existing[(vals[2], vals[3])] = vals

# ---------- json 城池 ----------
data = json.load(open(MAP, encoding="utf-8"))
cities = data["cities"]
id2label = {c["cityId"]: c["label"] for c in cities}


def parse_label(text):
    """label → (章节, 关卡)。两种写法都认：新口径 `111`（= 1-11）、旧口径 `1-11`。

    2026-10-27 起 `gen_bigmap_draft.ts` 出的是**纯数字拼接**（章节 + 关卡补两位），
    于是 label 的数值就等于下面 KEY2ID 的结果；旧存档里的 `1-11` 仍要能跑。
    """
    text = str(text).strip()
    if "-" in text:
        ch, g = text.split("-", 1)
        return int(ch), int(g)
    value = int(text)
    return value // 100, value % 100


by_key = {}
for c in cities:
    by_key[parse_label(c["label"])] = c

KEY2ID = lambda ch, g: ch * 100 + g          # 章节*100 + 关卡序号
LABEL2ID = {lb: KEY2ID(*parse_label(lb)) for lb in id2label.values()}

# ---------- 章节模板（沿用现有行的数值口径，逐章递进） ----------
PLACEHOLDER = "联盟 / 战盟玩法本期不开放"
TPL = {
    # ch: (occupyType, rallyOpen, openDay, dailyLimit, stamina, rankMin, rate, dmgMax, occupyScore, minOccupy, resetDays, warReset, reward, buffCon, iconBase, iconCount, campName)
    2: (2, 1, 2, 5, 20, 8100, 2, 3600000, 600, 8200, 7, 8000, 201, 8, 200, 8, "雾隐堡"),
    3: (2, 1, 2, 5, 20, 16100, 3, 6600000, 1200, 16200, 7, 16000, 301, 4, 300, 4, "军团壁垒"),
    4: (2, 1, 2, 5, 20, 16100, 3, 6600000, 1200, 16200, 7, 16000, 301, 4, 300, 4, "深渊地堡"),
    5: (2, 1, 5, 5, 20, 16100, 3, 6600000, 1200, 16200, 7, 16000, 301, 4, 300, 4, "腐化高塔"),
    6: (2, 1, 10, 5, 20, 24100, 3.5, 7600000, 1800, 24000, 7, 24000, 301, 4, 300, 4, "熔岩要塞"),
    7: (2, 1, 18, 5, 20, 29000, 4, 8100000, 2100, 28000, 7, 28000, 401, 2, 300, 4, "苍穹圣城"),
}
CH8_ID, CH8_GATE = 8, 1

# ---------- 组装 81 行 ----------
rows = []
battle = 50000
for ch in range(1, 9):
    gates = sorted(g for (c, g) in by_key if c == ch)
    for g in gates:
        cid = KEY2ID(ch, g)
        if (ch, g) in existing:
            v = list(existing[(ch, g)])
            v[0] = cid                                    # 第3章 300->301 偏移修正
            v[2], v[3] = ch, g
            if ch in (3, 4):
                v[5] = 2                                  # 非第一章统一为联盟占领
        else:
            (otype, rally, openDay, daily, stam, rankMin, rate, dmgMax,
             occScore, minOcc, resetD, warReset, reward, buffCon, iBase, iCnt, name) = TPL[ch]
            node = by_key[(ch, g)]
            icon = "ui/bigmap/camp/%d" % (iBase + (g - 1) % iCnt)
            if ch == CH8_ID:
                pass
            v = [cid, name, ch, g, 0, otype, rally, 4, [], openDay, daily, stam,
                 rankMin, rate, dmgMax, 0.8, occScore, minOcc, resetD, warReset,
                 "[11]", "[11]", reward, buffCon, 0.5, icon, PLACEHOLDER]
        # 相邻城池ID：按 json 的 label 映射成新 campId
        adj = sorted(LABEL2ID[id2label[x]] for x in by_key[(ch, g)]["adjacentCityIds"])
        v[8] = json.dumps(adj, separators=(",", ":"))
        battle += 1
        v[4] = battle
        rows.append(v)

assert len(rows) == 81, len(rows)
assert len({r[0] for r in rows}) == 81, "campId 冲突"
assert len({r[4] for r in rows}) == 81, "campBattleId 冲突"

# ---------- 写回（样式克隆自原数据行） ----------
STYLE = [copy.copy(ws.cell(7, c)._style) for c in range(1, COLS + 1)]
for i, v in enumerate(rows):
    r = 7 + i
    ws.row_dimensions[r].height = 16.5
    for c in range(1, COLS + 1):
        cell = ws.cell(r, c)
        cell._style = copy.copy(STYLE[c - 1])
        cell.value = v[c - 1]

# 清掉残留的旧行
last = 7 + len(rows)
if ws.max_row >= last:
    for r in range(last, ws.max_row + 1):
        for c in range(1, COLS + 1):
            ws.cell(r, c).value = None

ws.freeze_panes = "A7"
os.makedirs(OUT_DIR, exist_ok=True)
wb.save(OUT)
print("saved", OUT, "rows", len(rows))
for ch in range(1, 9):
    sub = [r for r in rows if r[2] == ch]
    print("ch%d %2d 座  榜门槛%s 占领积分%s 战功线%s 模式%s 开服天%s" % (
        ch, len(sub), sub[0][12], sub[0][16], sub[0][19], sub[0][5], sub[0][9]))
