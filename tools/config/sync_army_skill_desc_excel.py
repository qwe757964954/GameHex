# -*- coding: utf-8 -*-
"""把 `pvpSkillPlan.desc` 的文案同步到《K-卡牌升级.xlsx / 卡牌技能升级表》（2026-11-25 21:00）。

## 为什么

用户口径「（技能名改了）同步最新的名字」「一起改」：

- `pvpSkillPlan.desc` 是**技能面板**的描述，由设计案主表产出；
- `armySkillLevelUp.desc` 是**卡牌 UI 真读**的那一份（卡面技能条目），由本表 C 列产出；
- 两份原本各写各的，技能重做后只改了一边 ⇒ 27 条对不上。实测这不是「措辞不同」，
  有几条**数值都冲突**，且**全部以计划行为准**（与 `skillParamJson` / 子链 `damageRate` 对得上）：

  | 链 | 计划行（对） | 升级表（旧） | 依据 |
  | :--- | :--- | :--- | :--- |
  | `101502` 吸养根须 | 溅射 32/40/48%、伤害 +6/8/10% | 溅射 20/28/36%、伤害 +15/20/25% | `skillParamJson.splashDamageRate` = 0.32/0.40/0.48；子链 `191502.damageRate` = 0.06/0.08/0.10 |
  | `102701` 噬血蔓延 | 溅射 20/26/32% | 溅射 20/28/36% | `splashDamageRate` = 0.20/0.26/0.32；子链 `192701.damageRate` = 0.15/0.20/0.25 |
  | `103103` 舞王召唤 | 末尾「本体脚底同时展开持续光环（纯表现…）」 | 少了这句 | 功能已实现（第 34 批 `pushSummonAuraZone`） |

  其余 21 条是同一件事的措辞/细节差异（「（穿透目标承受 60%）」「每道独立判定 30% 概率使目标麻痹
  3 秒（只禁攻击、移速 −50%）」这类），一律取计划行。

## 口径

- **只写 C 列（技能描述）**，A 列 id + E 列技能等级定位行；其它列不碰；
- 前置闸：命中的行，B 列技能名必须与计划行 `skillName` 一致，C 列现值必须与
  `armySkillLevelUp.json` 现值一致（否则说明有人已经手改过 xlsx，停下来人工确认）；
- zip 级手术（只替换命中的 `<c>` 节点，其余成员逐字节复制）；改前备份；
- 幂等：内容一致就不写盘。
用法：python tools/config/sync_army_skill_desc_excel.py
"""
import io
import json
import os
import re
import shutil
import sys
import zipfile
from datetime import datetime
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xlsx_read import read_sheet  # noqa: E402

XLSX = 'D:/Alan/Project/POW/doc/塔防数据配置/K-卡牌升级.xlsx'
BACKUP_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置/_backup'
MEMBER = 'xl/worksheets/sheet2.xml'
SHEET_INDEX = 1
FIRST_DATA_ROW = 7  # 1=文件名 2=类型行 3=中文列名 4=填写说明 5=英文列名 6=字段类型 7 起才是数据

COL_ID = 1
COL_NAME = 2
COL_DESC = 3
COL_LEVEL = 5

ARMY_REMOTE = 'assets/remoteRef/armySkillLevelUp.json'
PLAN_REMOTE = 'assets/remoteRef/pvpSkillPlan.json'


def col_letter(index):
    letters = ''
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def cell_pattern(ref):
    return re.compile(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, re.S)


def get_cell_text(xml, ref):
    m = cell_pattern(ref).search(xml)
    if not m:
        return None
    body = m.group(0)
    texts = re.findall(r'<t[^>]*>(.*?)</t>', body, re.S)
    if not texts:
        texts = re.findall(r'<v>(.*?)</v>', body, re.S)
    if not texts:
        return ''
    return (texts[0]
            .replace('&lt;', '<').replace('&gt;', '>')
            .replace('&quot;', '"').replace('&apos;', "'")
            .replace('&amp;', '&'))


def set_cell(xml, ref, value):
    m = cell_pattern(ref).search(xml)
    if not m:
        raise SystemExit('[fail] 单元格 %s 不存在（set_cell 不建格）' % ref)
    style = re.search(r's="(\d+)"', m.group(0))
    style_attr = ' s="%s"' % style.group(1) if style else ''
    new = '<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (
        ref, style_attr, escape(str(value)))
    return xml[:m.start()] + new + xml[m.end():]


def read_rows(path):
    data = json.load(open(path, encoding='utf-8'))
    if isinstance(data, list):
        return data
    return [dict(zip(data['k'], row)) for row in data['v']]


def main():
    plan = {(str(r['skillChainId']), int(r['skillLevel'])): r for r in read_rows(PLAN_REMOTE)}
    army = {(str(r['id']), int(r['skilllevel'])): r for r in read_rows(ARMY_REMOTE)}

    targets = {}
    for key, row in army.items():
        source = plan.get(key)
        if not source:
            continue
        if (row.get('desc') or '') == (source.get('desc') or ''):
            continue
        targets[key] = {'name': source.get('skillName'), 'old': row.get('desc') or '',
                        'new': source.get('desc') or ''}
    if not targets:
        print('[skip] 升级表与计划行描述已一致')
        return

    _, rows = read_sheet(XLSX, SHEET_INDEX)
    locate = {}
    for row_no, cells in rows:
        if row_no < FIRST_DATA_ROW or not cells:
            continue
        cid = str(cells[COL_ID - 1] if len(cells) >= COL_ID else '').replace('\r', '').strip()
        lvl = str(cells[COL_LEVEL - 1] if len(cells) >= COL_LEVEL else '').replace('\r', '').strip()
        if cid and lvl:
            locate[(cid, int(float(lvl)))] = (row_no, cells)

    missing = [k for k in targets if k not in locate]
    if missing:
        raise SystemExit(f'[fail] 这 {len(missing)} 行在 K 表里找不到：{missing}')

    # 前置闸：技能名一致 + 表里现值与 JSON 现值一致（防止覆盖别人刚改的文案）。
    conflict = []
    for key, info in targets.items():
        row_no, cells = locate[key]
        name = str(cells[COL_NAME - 1]).replace('\r', '').strip()
        current = str(cells[COL_DESC - 1]).replace('\r', '')
        if name != info['name']:
            conflict.append(f'{key} 技能名不符：表里「{name}」/ 计划「{info["name"]}」')
        elif current.strip() != info['old'].strip():
            conflict.append(f'{key} 描述现值与 JSON 不同（可能已手改）：表「{current[:24]}…」')
    if conflict:
        for line in conflict:
            print('  ' + line)
        raise SystemExit('[fail] 前置闸未过，未写盘')

    with zipfile.ZipFile(XLSX) as z:
        xml = z.read(MEMBER).decode('utf-8')
        members = [(item, z.read(item.filename)) for item in z.infolist()]

    for key, info in sorted(targets.items()):
        row_no = locate[key][0]
        ref = '%s%d' % (col_letter(COL_DESC), row_no)
        xml = set_cell(xml, ref, info['new'])
        print(f'[patch] {ref} {key[0]}#{key[1]} {info["name"]}\n   - {info["old"][:60]}\n   + {info["new"][:60]}')

    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, 'K-卡牌升级.%s.xlsx' % datetime.now().strftime('%Y%m%d-%H%M%S'))
    shutil.copyfile(XLSX, backup)
    print('[backup] ' + backup)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as out:
        for item, payload in members:
            out.writestr(item, xml.encode('utf-8') if item.filename == MEMBER else payload)
    try:
        with open(XLSX, 'wb') as fh:
            fh.write(buffer.getvalue())
    except PermissionError:
        raise SystemExit('[fail] 文件被占用（WPS/Excel 打开着？）关掉再跑；本次未写盘')

    # 回读逐字比对
    _, after = read_sheet(XLSX, SHEET_INDEX)
    for row_no, cells in after:
        if row_no < FIRST_DATA_ROW or not cells:
            continue
        cid = str(cells[COL_ID - 1]).replace('\r', '').strip()
        lvl = str(cells[COL_LEVEL - 1]).replace('\r', '').strip()
        if not cid or not lvl:
            continue
        key = (cid, int(float(lvl)))
        if key in targets:
            got = str(cells[COL_DESC - 1]).replace('\r', '')
            if got.strip() != targets[key]['new'].strip():
                raise SystemExit(f'[fail] 回读不一致 {key}：{got[:40]}')
    print(f'[ok] 写入 {len(targets)} 行描述，回读一致')


if __name__ == '__main__':
    main()
