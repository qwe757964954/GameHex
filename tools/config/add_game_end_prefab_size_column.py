# -*- coding: utf-8 -*-
"""给 `PVP-卡牌.xlsx`（pvpCard）加一列 `gameEndPrefabSize`，并同步两份产物。

背景（2026-11-20，用户要求）：
  结算页 MVP 立绘位把角色画得比设计稿大一倍。根因是 `prefabSize` 这一列在两条链路上
  归一化的**分母不同**：

    · 战场 `ZCUnitView` / 阵容 `CardPreviewScale`：按**骨架 canvas 高**归一。
      磁电菇 canvas 1798 里 idle 本体只占 980（54.5%），所以要配 1.8 才跟别人一样高。
    · 结算 `ZCSettlementMvpActor`：按 **idle 首帧美术包围盒**归一，本身已对齐到本体，
      同一个 1.8 搬过去就成了实打实放大 1.8 倍
      （显示高 = 立绘框 265 × 1.09 × 系数 = 288.9 × 1.8 ≈ 520，框只有 265）。

所以结算要单独吃一个「不超过上限」的值。上限按卡配在表里，调数值不用改代码。

新列口径：
  `gameEndPrefabSize` = 结算页立绘位的体型**上限**，实际值 = `min(prefabSize, 本列)`。
    · 留空 ⇒ 解析层兜底 1.2（见 `ZCPvpTableParser.GAME_END_PREFAB_SIZE_LIMIT`）
    · 只有兵种卡（表里配了「模型大小」的行）才有这一列的值，主城/金矿留空
  战场与阵容**不吃这一列**，行为逐字不变。

三份产物（与其余配表同一套三写口径）：
  ① 源表 `doc/塔防数据配置/PVP-卡牌.xlsx` 的 AN 列
     （行 2=列宽提示位、行 3=中文名、行 4=说明、行 5=字段名、行 6=类型、数据行=值）
  ② 转表产物 `doc/塔防数据配置/json/client/pvpCard.json`（行对象，插在 `prefabSize` 后面）
  ③ 运行时 `assets/remoteRef/pvpCard.json`（**2026-11-20 起也是行对象数组**，同一套写法）

用法：
    python tools/config/add_game_end_prefab_size_column.py            # 预演
    python tools/config/add_game_end_prefab_size_column.py --apply     # 真写
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import cell_xml, write_zip  # noqa: E402

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
POW_ROOT = os.path.dirname(PROJECT_ROOT)
DOC = os.path.join(POW_ROOT, 'doc', '塔防数据配置')

XLSX = os.path.join(DOC, 'PVP-卡牌.xlsx')
CLIENT_JSON = os.path.join(DOC, 'json', 'client', 'pvpCard.json')
REMOTE_REF = os.path.join(PROJECT_ROOT, 'assets', 'remoteRef', 'pvpCard.json')
BACKUP_DIR = os.path.join(PROJECT_ROOT, 'tmp', 'backup_game_end_prefab_size_20261120')

SHEET_MEMBER = 'xl/worksheets/sheet1.xml'
COLUMN = 'AN'                 # 现有最后一列是 AM（unitValueFactor），接着往后加
SIZE_COLUMN = 'AH'            # 「模型大小」= prefabSize，只有它非空的行才需要结算上限
FIELD = 'gameEndPrefabSize'
HEADER_CN = '结算体型上限'
HEADER_NOTE = ('结算页（战斗结束）MVP 立绘位使用的体型上限，实际值 = min(模型大小, 本列)，'
               '留空按 1.2。战场与阵容不吃这一列 —— prefabSize 里有一部分是补「画布虚大」的，'
               '搬到按美术包围盒归一的立绘位会变成纯放大')
HEADER_TYPE = 'float'
LIMIT = 1.2
COLUMN_HINT = '3'             # 第 2 行每列都是 3，跟着补一格，别让导出器看到参差


def style_of(xml: str, ref: str) -> str | None:
    match = re.search(r'<c r="%s"(?: s="(\d+)")?' % ref, xml)
    return match.group(1) if match and match.group(1) else None


def cell_refs(xml: str, row_num: int) -> dict[str, str]:
    """取某一行所有格子：列字母 → 原始 xml。"""
    row = re.search(r'<row r="%d"[^>]*>(.*?)</row>' % row_num, xml, re.S)
    if not row:
        return {}
    return {m.group(1): m.group(0)
            for m in re.finditer(r'<c r="([A-Z]+)%d"[^>]*?(?:/>|>.*?</c>)' % row_num, row.group(1), re.S)}


def value_of(cell: str | None) -> str | None:
    if not cell:
        return None
    found = re.search(r'<v>([^<]*)</v>', cell)
    return found.group(1) if found else None


def upsert_cell(xml: str, ref: str, value, style: str | None) -> str:
    """有格子就原地替换，没有就插在 `</row>` 之前（AN 是最后一列，插末尾正好是升序）。"""
    pattern = r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref
    cell = cell_xml(ref, style, value)
    match = re.search(pattern, xml, re.S)
    if match:
        return xml[:match.start()] + cell + xml[match.end():]
    row_num = int(re.sub(r'[A-Z]', '', ref))
    row = re.search(r'<row r="%d"[^>]*>.*?</row>' % row_num, xml, re.S)
    if not row:
        raise SystemExit('行 %d 不存在，加不了 %s' % (row_num, ref))
    text = row.group(0)
    assert text.endswith('</row>')
    return xml[:row.start()] + text[:-len('</row>')] + cell + '</row>' + xml[row.end():]


def target_rows(xml: str) -> list[int]:
    """有「模型大小」的数据行（兵种卡）。主城/金矿那两行 AJ 为空，跳过。"""
    rows = []
    for num in range(7, 200):
        cells = cell_refs(xml, num)
        if not cells:
            break
        size = value_of(cells.get(SIZE_COLUMN))
        if size not in (None, ''):
            rows.append(num)
    return rows


def patch_xlsx(apply: bool) -> None:
    with zipfile.ZipFile(XLSX) as archive:
        xml = archive.read(SHEET_MEMBER).decode('utf-8')
    rows = target_rows(xml)
    if not rows:
        raise SystemExit('找不到任何配了「模型大小」的数据行，先核对表结构')
    plan = [
        ('%s2' % COLUMN, COLUMN_HINT, style_of(xml, 'AM2')),
        ('%s3' % COLUMN, HEADER_CN, style_of(xml, 'AM3')),
        ('%s4' % COLUMN, HEADER_NOTE, style_of(xml, 'AM4')),
        ('%s5' % COLUMN, FIELD, style_of(xml, 'AM5')),
        ('%s6' % COLUMN, HEADER_TYPE, style_of(xml, 'AM6')),
    ]
    for num in rows:
        plan.append(('%s%d' % (COLUMN, num), LIMIT, style_of(xml, 'AM%d' % num)))
    #  幂等：列名与所有值都已经对得上 ⇒ 一个字都不写（别把 mtime 和备份目录刷一遍）。
    if already_done(xml, plan):
        print('  源表：%s 列已存在且取值一致（幂等，跳过写盘）' % FIELD)
        return
    for ref, value, style in plan:
        xml = upsert_cell(xml, ref, value, style)
    print('  源表：%s 列写入 %d 行（行 %d..%d，值 %s）' % (COLUMN, len(rows), rows[0], rows[-1], LIMIT))
    if apply:
        write_zip(XLSX, SHEET_MEMBER, xml, BACKUP_DIR)
        print('  源表已写（备份 %s）' % os.path.relpath(BACKUP_DIR, PROJECT_ROOT))


def already_done(xml: str, plan: list) -> bool:
    for ref, value, _style in plan:
        match = re.search(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, xml, re.S)
        if not match:
            return False
        cell = match.group(0)
        if isinstance(value, (int, float)):
            found = re.search(r'<v>([^<]*)</v>', cell)
            if not found or abs(float(found.group(1)) - float(value)) > 1e-9:
                return False
        else:
            found = re.search(r'<t[^>]*>(.*?)</t>', cell, re.S)
            if not found or found.group(1) != str(value):
                return False
    return True


def dump_rows(data: list) -> str:
    """两份产物的排版：`[` + 行间 `,\\n` + `]`，无末尾换行（原文件就是这个格式）。"""
    return '[' + ',\n'.join(
        json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in data) + ']'


def patch_rows_json(path: str, label: str, apply: bool) -> None:
    with io.open(path, encoding='utf-8', newline='') as handle:
        raw = handle.read()
    data = json.loads(raw)
    if not isinstance(data, list):
        raise SystemExit('%s 不是行对象数组，先核对格式' % path)
    if dump_rows(data) != raw:
        #  排版对不上就先停：写回去会把整份文件的缩进/换行改掉（diff 一片红）。
        raise SystemExit('%s 的既有排版与 dump_rows 不一致，先核对再插列' % path)
    touched = 0
    for row in data:
        if 'prefabSize' not in row:
            continue
        if row.get(FIELD) == LIMIT:
            continue
        rebuilt = {}
        for key, value in row.items():
            rebuilt[key] = value
            if key == 'prefabSize':
                rebuilt[FIELD] = LIMIT
        if FIELD not in rebuilt:
            rebuilt[FIELD] = LIMIT
        row.clear()
        row.update(rebuilt)
        touched += 1
    print('  %s：%d 行插上 %s' % (label, touched, FIELD))
    if apply and touched:
        with io.open(path, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(dump_rows(data))


def main(argv: list[str]) -> int:
    apply = '--apply' in argv
    print('pvpCard 加列 %s（%s）' % (FIELD, '写盘' if apply else '预演'))
    patch_xlsx(apply)
    patch_rows_json(CLIENT_JSON, 'client', apply)
    patch_rows_json(REMOTE_REF, 'remoteRef', apply)
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
