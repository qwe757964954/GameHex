# -*- coding: utf-8 -*-
"""给 `PVP-技能.xlsx`（pvpSkill）加一列 `impactEffectAnchor`，并同步两份产物。

背景（2026-11-18 第二轮，用户追问）：
  运动霸「气浪」的落点原本登记在代码常量 `ZCImpactEffectFx.ZC_IMPACT_MIDPOINT_PREFAB_PATHS`
  里 —— 按 **prefab 路径** 认。美术一换（`重骑兵_践踏` 被替换 / 改名），那条登记就静默失效，
  气浪又悄悄退回受击点。用户要求把它挪进配置表。

新列口径：
  `impactEffectAnchor` = 命中附加特效的圆心落点，**0~1 的比例**：
    · 0（或留空）= 受击点（默认，存量 77 行行为逐字不变）
    · 0.5        = 攻守双方中点（运动霸 30713）
    · 1          = 出手点
    · 其余       = 线性插值（0.25 = 从受击点往出手点方向 1/4）
  只在配了 `impactEffectPrefabPath` 的行上有意义。

为什么把「登记」放在技能行而不是代码常量：
  口径跟着**技能**走，不跟美术走。换美术时这一格不动；反过来想换落点时，也只改一格，
  不用重新发版。

涉及三份产物（与其余配表同一套三写口径）：
  ① 源表 `doc/塔防数据配置/PVP-技能.xlsx` 的 V 列
     （行 2=列宽提示位、行 3=中文名、行 4=说明、行 5=字段名、行 6=类型、数据行=值）
  ② 转表产物 `doc/塔防数据配置/json/client/pvpSkill.json`（行对象，没有的键不写）
  ③ 运行时 `assets/remoteRef/pvpSkill.json`（列存 `{k,v,c}`，**每行都要补一格**）

用法：
    python tools/config/add_pvp_skill_anchor_column.py            # 预演
    python tools/config/add_pvp_skill_anchor_column.py --apply     # 真写
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

XLSX = os.path.join(DOC, 'PVP-技能.xlsx')
CLIENT_JSON = os.path.join(DOC, 'json', 'client', 'pvpSkill.json')
REMOTE_REF = os.path.join(PROJECT_ROOT, 'assets', 'remoteRef', 'pvpSkill.json')
BACKUP_DIR = os.path.join(PROJECT_ROOT, 'tmp', 'backup_anchor_column_20261118')

SHEET_MEMBER = 'xl/worksheets/sheet1.xml'
COLUMN = 'V'
FIELD = 'impactEffectAnchor'
#  列头三行 + 唯一要填值的那条技能
HEADER_CN = '命中附加特效落点'
HEADER_NOTE = ('命中附加特效的圆心落点：0=受击点（默认，留空同 0）、0.5=攻守双方中点、1=出手点，'
               '其余按 0~1 线性插值；只在配了「命中附加特效」的行上有意义')
HEADER_TYPE = 'float'
VALUES = {30713: 0.5}          # 运动霸普攻（气浪）
COLUMN_HINT = '3'              # 第 2 行每列都是 3，跟着补一格，别让导出器看到参差


def find_row(xml: str, skill_id: int) -> int:
    """按 A 列的 skillId 找行号。"""
    for match in re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S):
        if '<v>%d</v>' % skill_id in match.group(2):
            return int(match.group(1))
    raise SystemExit('表里找不到 skillId=%d 的行' % skill_id)


def style_of(xml: str, ref: str) -> str | None:
    match = re.search(r'<c r="%s"(?: s="(\d+)")?' % ref, xml)
    return match.group(1) if match and match.group(1) else None


def upsert_cell(xml: str, ref: str, value, style: str | None) -> str:
    """有格子就原地替换，没有就插在 `</row>` 之前（V 是最后一列，插末尾正好是升序）。"""
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


def patch_xlsx(apply: bool) -> None:
    with zipfile.ZipFile(XLSX) as archive:
        xml = archive.read(SHEET_MEMBER).decode('utf-8')
    body_row = find_row(xml, min(VALUES))
    plan = [
        ('%s2' % COLUMN, COLUMN_HINT, style_of(xml, 'U2')),
        ('%s3' % COLUMN, HEADER_CN, style_of(xml, 'U3')),
        ('%s4' % COLUMN, HEADER_NOTE, style_of(xml, 'U4')),
        ('%s5' % COLUMN, FIELD, style_of(xml, 'U5')),
        ('%s6' % COLUMN, HEADER_TYPE, style_of(xml, 'U6')),
    ]
    for skill_id, value in sorted(VALUES.items()):
        plan.append(('%s%d' % (COLUMN, find_row(xml, skill_id)), value,
                     style_of(xml, 'U%d' % find_row(xml, skill_id))))
    #  幂等：列名与所有值都已经对得上 ⇒ 一个字都不写（别把 mtime 和备份目录刷一遍）。
    if already_done(xml, plan):
        print('  源表：%s 列已存在且取值一致（幂等，跳过写盘）' % FIELD)
        return
    for ref, value, style in plan:
        xml = upsert_cell(xml, ref, value, style)
        print('  源表 %-5s %s' % (ref, value))
    print('  （数据行 = %s%d）' % (COLUMN, body_row))
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


def patch_client(apply: bool) -> None:
    with io.open(CLIENT_JSON, encoding='utf-8') as handle:
        raw = handle.read()
    data = json.loads(raw)
    touched = 0
    for row in data:
        if row['skillId'] in VALUES:
            if row.get(FIELD) == VALUES[row['skillId']]:
                continue
            #  插在 `impactEffectPrefabPath` 后面：两格是同一件事（放什么、放哪）。
            rebuilt = {}
            for key, value in row.items():
                rebuilt[key] = value
                if key == 'impactEffectPrefabPath':
                    rebuilt[FIELD] = VALUES[row['skillId']]
            if FIELD not in rebuilt:
                rebuilt[FIELD] = VALUES[row['skillId']]
            row.clear()
            row.update(rebuilt)
            touched += 1
    text = '[' + ',\n'.join(
        json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in data) + ']'
    if text.count('\n') != raw.count('\n'):
        raise SystemExit('client 换行数变了，排版被改坏，中止')
    print('  client：%d 行补上 %s' % (touched, FIELD))
    if apply and touched:
        with io.open(CLIENT_JSON, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(text)


def patch_remote(apply: bool) -> None:
    with io.open(REMOTE_REF, encoding='utf-8') as handle:
        raw = handle.read()
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise SystemExit('remoteRef 不是列存格式，先核对')
    if FIELD in data['k']:
        print('  remoteRef：已有 %s（幂等）' % FIELD)
        return
    width = len(data['k'])
    if any(len(row) != width for row in data['v']):
        raise SystemExit('remoteRef 列宽不齐，先核对再插列')
    id_column = data['k'].index('skillId')
    data['k'].append(FIELD)
    filled = 0
    for row in data['v']:
        value = VALUES.get(row[id_column])
        row.append(value)
        if value is not None:
            filled += 1
    text = json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':')) + '\n'
    text = text.replace('\n', '\r\n')                      # 这份产物整份是 CRLF
    print('  remoteRef：k 追加 1 列、v 每行补 1 格（%d 行有值）' % filled)
    if apply:
        with io.open(REMOTE_REF, 'w', encoding='utf-8', newline='') as handle:
            handle.write(text)


def main(argv: list[str]) -> int:
    apply = '--apply' in argv
    print('pvpSkill 加列 %s（%s）' % (FIELD, '写盘' if apply else '预演'))
    patch_xlsx(apply)
    patch_client(apply)
    patch_remote(apply)
    if not apply:
        print('预演结束。确认无误后加 --apply；xlsx 会先备份到 %s'
              % os.path.relpath(BACKUP_DIR, PROJECT_ROOT))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
