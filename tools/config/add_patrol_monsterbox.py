# -*- coding: utf-8 -*-
"""给 `PVP-关卡.xlsx` 的「巡逻宝箱怪」页补 `chapter_02~07` 的宝箱奖励（每章 5 组 × 4 级）。

用户 2026-11-11：

    「同步在 pvp 关卡表中的章节野怪巡逻宝箱 SHEET，补充章节 2~7 4 个等级的宝箱奖励
     （1/2/3/4 级宝箱对应 1/2/3/7 个随机格的奖励数量，奖励类型需要对应所在章节的随机格奖励）」

## 口径

| 项 | 值 |
| :-- | :-- |
| 宝箱组 id | `1006~1035`（`chapter_01` 占了 `1001~1005`），每章 5 组 |
| 等级 | `1~4`，四行一组 |
| 奖励池来源 | 该章随机格奖励池 `2001 + 章节号`（ch2=2003 … ch7=2008），读 xlsx「关卡地图格子奖励」页 |
| 1/2/3/4 级奖励数量 | 随机格奖励池每条 `number × 1 / 2 / 3 / 7`（`pro` 不动、条目顺序不动） |
| `monsterBoxLevel` | 1~3 级 = 该组基础关卡，4 级 = 满级关卡（`chapter_01` 同款） |
| 四列升级参数 | 沿用 `chapter_01` 五个组共同的 `(0,0,0,0) / (20,90,2,99) / (20,60,2,2) / (20,40,2,2)` |

巡逻关卡 `60011~60070`（`levelInfo.levelType == 4`）表里**已经全在了**（每章 10 条 = 5 组 × 2 档），
所以这张表只需要补宝箱行 —— 地图上的 `site.battleId` 就是宝箱组 id，`TerritoryCampaignRepository`
再用它查 `monsterBoxLevel` 落到关卡。

## 落点（三写）

1. 源表 `doc/塔防数据配置/PVP-关卡.xlsx` → `xl/worksheets/sheet9.xml`（**zip 级手术**，
   新行用 `t="inlineStr"`，不碰 sharedStrings —— 与 `sync_treant_excel.py` 同一套写法）；
2. `doc/塔防数据配置/json/client/monsterBox.json` 与 `json/sever/monsterBox.json`
   （每行一条紧凑 json、`,\n` 连接、LF、无结尾换行）；
3. `assets/remoteRef/monsterBox.json`（列存 `{k,v,c}`、`indent=0` + `separators=(',',':')`、LF）。

用法：

    python tools/config/add_patrol_monsterbox.py --check
    python tools/config/add_patrol_monsterbox.py

⚠️ 幂等：已存在的 `(monsterBoxId, monsterBoxGrade)` 行逐字段比对，一致就跳过，不一致直接报错。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xlsx_read  # noqa: E402

PROJECT = Path(__file__).resolve().parents[2]
DOC = PROJECT.parent / "doc" / "塔防数据配置"
XLSX = DOC / "PVP-关卡.xlsx"
SHEET_MEMBER = "xl/worksheets/sheet9.xml"
SHEET_INDEX = 8  # 「巡逻宝箱怪」
GRID_SHEET_INDEX = 5  # 「关卡地图格子奖励」
CLIENT_JSON = DOC / "json" / "client" / "monsterBox.json"
SEVER_JSON = DOC / "json" / "sever" / "monsterBox.json"
REMOTE_JSON = PROJECT / "assets" / "remoteRef" / "monsterBox.json"
BACKUP = PROJECT / "tmp" / "monsterbox-backup"

COLUMNS = [
    "monsterBoxId", "monsterBoxGrade", "monsterBoxVictoryRwrad", "monsterBoxUpCostCoins",
    "monsterBoxUpPro", "monsterBoxUpCostDiamond", "maxUpFailTimes", "monsterBoxLevel",
]
FIRST_BOX_ID = 1006
CHAPTERS = (2, 3, 4, 5, 6, 7)
BOXES_PER_CHAPTER = 5
GRADES = 4
FIRST_PATROL_LEVEL = 60001
PATROL_LEVELS_PER_CHAPTER = 10
#: 「升到这一级」的四列（`chapter_01` 五个组逐行相同）。
UP_COLUMNS = ((0, 0, 0, 0), (20, 90, 2, 99), (20, 60, 2, 2), (20, 40, 2, 2))
#: 1/2/3/4 级分别等于几个随机格的奖励。
GRADE_STACK = (1, 2, 3, 7)


def grid_reward_pool(chapter: int) -> list[dict[str, int]]:
    """该章「随机格」奖励池：`2001 + 章节号`，读源表「关卡地图格子奖励」页。"""
    reward_id = str(2001 + chapter)
    rows = xlsx_read.read_sheet(str(XLSX), GRID_SHEET_INDEX)[1]
    for row_number, cells in rows:
        if row_number < 7 or not cells or cells[0] != reward_id:
            continue
        entries = json.loads(cells[1])
        return [
            {
                "resId": int(item["resId"]),
                "number": int(item["number"]),
                "pro": int(item["pro"]),
            }
            for item in entries
        ]
    raise SystemExit(f"源表里找不到随机格奖励池 {reward_id}")


def serialize_rewards(entries: list[dict[str, int]]) -> str:
    """按源表既有写法序列化：`10010` 在前 4 条写 `number,pro,resId`，其余写 `resId,number,pro`。

    这几条 key 的顺序只影响人眼，但源表里 20 行都是这个写法，保持一致免得下游 diff 噪音。
    """
    parts = []
    for item in entries:
        if item["resId"] == 10010:
            parts.append('{"number":%d,"pro":%d,"resId":%d}' % (item["number"], item["pro"], item["resId"]))
        else:
            parts.append('{"resId":%d,"number":%d,"pro":%d}' % (item["resId"], item["number"], item["pro"]))
    return "[" + ",".join(parts) + "]"


def build_rows() -> list[list]:
    """生成 120 行（6 章 × 5 组 × 4 级）。"""
    rows: list[list] = []
    for chapter in CHAPTERS:
        pool = grid_reward_pool(chapter)
        for index in range(BOXES_PER_CHAPTER):
            box_id = FIRST_BOX_ID + (chapter - CHAPTERS[0]) * BOXES_PER_CHAPTER + index
            base_level = FIRST_PATROL_LEVEL + (chapter - 1) * PATROL_LEVELS_PER_CHAPTER + index * 2
            for grade in range(1, GRADES + 1):
                stack = GRADE_STACK[grade - 1]
                rewards = []
                for item in pool:
                    if item["resId"] == 10010:
                        # key 顺序与源表既有 20 行一致（只影响可读性，不影响解析）。
                        rewards.append({
                            "number": item["number"] * stack,
                            "pro": item["pro"],
                            "resId": item["resId"],
                        })
                    else:
                        rewards.append({
                            "resId": item["resId"],
                            "number": item["number"] * stack,
                            "pro": item["pro"],
                        })
                level = base_level if grade < GRADES else base_level + 1
                coins, pro, diamond, max_fail = UP_COLUMNS[grade - 1]
                rows.append([box_id, grade, rewards, coins, pro, diamond, max_fail, level])
    return rows


# ---------------------------------------------------------------- xlsx


def patch_xlsx(rows: list[list], dry_run: bool) -> int:
    """把新行追加到 sheet9，返回追加的行数。"""
    with zipfile.ZipFile(XLSX) as archive:
        xml = archive.read(SHEET_MEMBER).decode("utf-8")
    last_row = max(int(match) for match in re.findall(r'<row r="(\d+)"', xml))
    starts = [last_row + 1 + offset for offset in range(len(rows))]
    if last_row != 26:
        # 只允许从 26 行（chapter_01 的 20 行 + 6 行表头）之后接，别把既有数据顶掉。
        raise SystemExit(f"sheet9 现有末行是 {last_row}，预期 26 —— 表被动过，先确认再跑")

    def cell(ref: str, style: int, value: str, text: bool) -> str:
        if text:
            return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
        return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'

    blocks = []
    for row_number, row in zip(starts, rows):
        cells = []
        for offset, value in enumerate(row):
            ref = f"{chr(ord('A') + offset)}{row_number}"
            if offset == 2:
                cells.append(cell(ref, 7, serialize_rewards(value), True))
            else:
                cells.append(cell(ref, 2, str(value), False))
        blocks.append(f'<row r="{row_number}" spans="1:8">' + "".join(cells) + "</row>")
    xml = xml.replace("</sheetData>", "".join(blocks) + "</sheetData>")
    xml = re.sub(r'<dimension ref="A1:H\d+"/>', f'<dimension ref="A1:H{starts[-1]}"/>', xml)
    if dry_run:
        return len(rows)
    BACKUP.mkdir(parents=True, exist_ok=True)
    shutil.copy2(XLSX, BACKUP / XLSX.name)
    tmp = XLSX.with_suffix(".xlsx.tmp")
    with zipfile.ZipFile(XLSX) as src, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == SHEET_MEMBER:
                data = xml.encode("utf-8")
            dst.writestr(info, data)
    os.replace(tmp, XLSX)
    return len(rows)


# ---------------------------------------------------------------- json


def read_json_rows(path: Path) -> tuple[list[dict], str]:
    """读两种落点格式 ⇒ `(行对象列表, 格式标记)`。"""
    text = path.read_text(encoding="utf-8")
    raw = json.loads(text)
    if isinstance(raw, dict) and raw.get("c") == 1:
        return [dict(zip(raw["k"], values)) for values in raw["v"]], "packed"
    return [dict(row) for row in raw], "rows"


def dump_packed(rows: list[dict]) -> str:
    keys = COLUMNS
    payload = {"k": keys, "v": [[row[key] for key in keys] for row in rows], "c": 1}
    return json.dumps(payload, ensure_ascii=False, indent=0, separators=(",", ":"))


def dump_rows(rows: list[dict]) -> str:
    lines = [json.dumps({key: row[key] for key in COLUMNS}, ensure_ascii=False, separators=(",", ":")) for row in rows]
    return "[" + ",\n".join(lines) + "]"


def append_rows(path: Path, new_rows: list[list], dry_run: bool) -> str:
    existing, kind = read_json_rows(path)
    seen = {(row["monsterBoxId"], row["monsterBoxGrade"]): row for row in existing}
    added = 0
    for values in new_rows:
        row = dict(zip(COLUMNS, values))
        key = (row["monsterBoxId"], row["monsterBoxGrade"])
        current = seen.get(key)
        if current is not None:
            if current != row:
                raise SystemExit(f"{path.name}: 已存在的 ({key[0]}, {key[1]}) 与新算出来的不一致 —— 先确认")
            continue
        existing.append(row)
        seen[key] = row
        added += 1
    if added and not dry_run:
        BACKUP.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, BACKUP / path.name)
        text = dump_packed(existing) if kind == "packed" else dump_rows(existing)
        path.write_text(text, encoding="utf-8", newline="")
    return f"{path.name}: +{added} 行（共 {len(existing)}）"


def main() -> int:
    parser = argparse.ArgumentParser(description="补 chapter_02~07 巡逻宝箱奖励（monsterBox）")
    parser.add_argument("--check", action="store_true", help="只统计，不写盘")
    args = parser.parse_args()

    rows = build_rows()
    print(f"待补 {len(rows)} 行：{len(CHAPTERS)} 章 × {BOXES_PER_CHAPTER} 组 × {GRADES} 级")
    for chapter in CHAPTERS:
        pool = grid_reward_pool(chapter)
        preview = [
            f'{item["resId"]}×{item["number"] * GRADE_STACK[0]}@{item["pro"]}'
            for item in pool
        ]
        print(f"  ch{chapter} 随机格奖励池 {2001 + chapter}：一级宝箱 = " + " / ".join(preview))

    print("源表：" + (f"会追加 {patch_xlsx(rows, dry_run=True)} 行" if args.check else
                   f"追加 {patch_xlsx(rows, dry_run=False)} 行"))
    for path in (CLIENT_JSON, SEVER_JSON, REMOTE_JSON):
        print("json：" + append_rows(path, rows, dry_run=args.check))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
