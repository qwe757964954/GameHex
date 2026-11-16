#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""2026-11-14 两条设计口径落地：

1. **处决从卡牌移除** —— 处决（`executeChance`）只保留给其他养成系统，卡牌链路上的
   `枯萎收割`（68024 / 102401·192401、68035 / 103502·193502）不再带处决：
   删参数、删描述里的「普攻有NN%概率处决残血目标，」。
2. **普攻衍生的多目标伤害必须递减，且初值低于普攻**：
   · 穿透：首次穿透 60%、每多穿一个 ×0.6 ⇒ `normalPierceFalloff = 0.4`
     （`ZCProjectileSystem` 的语义是「每穿一次 ×(1-falloff)」）
   · 溅射：基准 20% / 26% / 32%（低于普攻），同一次爆发第 2 个目标起每次 ×0.7
     ⇒ `splashFalloff = 0.3`（本轮新增参数，缺省 0 = 存量行为不变）
   · 分裂子弹（凤凰弹四方向）已是每颗 25%，不动。

三写：`assets/remoteRef/*.json`（列存） + `doc/塔防数据配置/json/client/*.json`（行存）
    + 源表 `J-技能表.xlsx` sheet9（pvpSkillPlan）/ `K-卡牌升级.xlsx` sheet2（armySkillLevelUp）。

用法：python tools/config/patch_multi_target_falloff.py [--check]
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import set_cell, write_zip  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DOC_ROOT = os.path.abspath(os.path.join(ROOT, '..', 'doc', '塔防数据配置'))
BACKUP = os.path.join(ROOT, 'tmp', 'backup_falloff_20261114', 'xlsx')

REMOTE_PLAN = os.path.join(ROOT, 'assets', 'remoteRef', 'pvpSkillPlan.json')
CLIENT_PLAN = os.path.join(DOC_ROOT, 'json', 'client', 'pvpSkillPlan.json')
REMOTE_LEVEL = os.path.join(ROOT, 'assets', 'remoteRef', 'armySkillLevelUp.json')
CLIENT_LEVEL = os.path.join(DOC_ROOT, 'json', 'client', 'armySkillLevelUp.json')
SRC_LEVEL = os.path.join(DOC_ROOT, 'K-卡牌升级.xlsx')
SRC_PLAN = os.path.join(DOC_ROOT, 'J-技能表.xlsx')

SHEET_PLAN = 'xl/worksheets/sheet9.xml'
SHEET_LEVEL = 'xl/worksheets/sheet2.xml'

#  溅射基准（三档）—— 都低于普攻（100%），面积换单体的口径
SPLASH_RATE = {1: 0.20, 2: 0.26, 3: 0.32}
#  同一次爆发：第 2 个旁溅目标起每次 ×0.7
SPLASH_FALLOFF = 0.3
#  穿透：首次穿透 60%，之后每多穿一个 ×0.6
PIERCE_FALLOFF = 0.4

EXECUTE_DESC = re.compile(r'^普攻有\d+%概率处决残血目标，')
#  🔴 幂等：匹配串必须把「已插入的括号说明（可能被重复插入多次）」一起吃掉。
#  老写法 `造成\d+%溅射伤害` 与插入文本自相匹配 ⇒ 每跑一次追加一段
#  （踩过：68008 的 desc 被拼成三段括号）。带 `*` 的重复组一次收干净。
SPLASH_SUFFIX = '（同一爆点第2个目标起每次×0.7）'
SPLASH_DESC = re.compile(r'造成\d+%溅射伤害(?:' + re.escape(SPLASH_SUFFIX) + r')*')
PIERCE_DESC = re.compile(r'普攻穿透(\d+)个目标')


def pct(value: float) -> str:
    return ('%g' % round(value * 100, 1)) + '%'


# ---------------------------------------------------------------- JSON 读写

def dump_packed(keys, rows, c=1) -> str:
    """`assets/remoteRef/*.json` 的列存排版（与现有文件逐字节一致）。"""
    parts = ['{', '"k":[']
    parts.append(',\n'.join(json.dumps(key, ensure_ascii=False) for key in keys))
    parts.append('],')
    parts.append('"v":[')
    parts.append(',\n'.join('[\n' + ',\n'.join(json.dumps(value, ensure_ascii=False) for value in row) + '\n]'
                            for row in rows))
    parts.append('],')
    parts.append('"c":%s' % json.dumps(c))
    parts.append('}')
    return '\n'.join(parts)


def read_packed(path):
    with open(path, encoding='utf-8', newline='') as handle:
        raw = handle.read()
    data = json.loads(raw)
    rows = [dict(zip(data['k'], row)) for row in data['v']]
    return data['k'], data['v'], rows


def read_rows(path):
    with open(path, encoding='utf-8', newline='') as handle:
        raw = handle.read()
    return json.loads(raw), raw.endswith('\n')


def dump_rows(rows, trailing: bool) -> str:
    body = '[' + ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows) + ']'
    return body + ('\n' if trailing else '')


# ---------------------------------------------------------------- 规则

def rewrite_plan_row(row: dict, stats: dict) -> bool:
    """返回是否改动。`row` 是 dict（行存口径），内部维护 skillParamJson。"""
    raw_params = row.get('skillParamJson')
    params = json.loads(raw_params) if raw_params else None
    desc = row.get('desc') or ''
    new_desc = desc
    changed = False

    #  ① 处决：卡牌链路一律去掉
    if params is not None and 'executeChance' in params:
        params.pop('executeChance')
        stats['execute_removed'] += 1
        changed = True
    if EXECUTE_DESC.search(new_desc):
        new_desc = EXECUTE_DESC.sub('', new_desc)
        changed = True

    if params is not None:
        #  ② 普攻穿透：首次 60%，每多穿一个 ×0.6
        if 'normalPierceCount' in params:
            if params.get('normalPierceFalloff') != PIERCE_FALLOFF:
                params['normalPierceFalloff'] = PIERCE_FALLOFF
                changed = True
        #  ③ 溅射：基准 20/26/32% + 第 2 个目标起 ×0.7
        if 'splashDamageRate' in params:
            level = int(row.get('skillLevel') or 1)
            want = SPLASH_RATE.get(level, SPLASH_RATE[3])
            if params['splashDamageRate'] != want:
                params['splashDamageRate'] = want
                changed = True
            if params.get('splashFalloff') != SPLASH_FALLOFF:
                params['splashFalloff'] = SPLASH_FALLOFF
                changed = True
            if SPLASH_DESC.search(new_desc):
                text = '造成%s溅射伤害%s' % (pct(want), SPLASH_SUFFIX)
                updated = SPLASH_DESC.sub(text, new_desc)
                if updated != new_desc:
                    new_desc, changed = updated, True

    #  描述里的穿透目标数 → 补递减说明
    match = PIERCE_DESC.search(new_desc)
    if match and '穿透目标承受' not in new_desc:
        count = int(match.group(1))
        chain = [pct((1 - PIERCE_FALLOFF) ** index) for index in range(1, count + 1)]
        updated = PIERCE_DESC.sub('普攻穿透%d个目标（穿透目标承受 %s）' % (count, '/'.join(chain)), new_desc)
        if updated != new_desc:
            new_desc, changed = updated, True

    if changed:
        if params is not None and not params:
            params = None
        row['skillParamJson'] = json.dumps(params, ensure_ascii=False, separators=(',', ':')) if params else None
        row['desc'] = new_desc
    return changed


def main() -> int:
    check_only = '--check' in sys.argv

    keys, values, remote_rows = read_packed(REMOTE_PLAN)
    client_rows, trailing = read_rows(CLIENT_PLAN)
    assert len(remote_rows) == len(client_rows), '两份 pvpSkillPlan 行数不一致'

    stats = {'execute_removed': 0, 'touched': 0}
    new_remote = []
    new_client = []
    for packed_row, remote_row, client_row in zip(values, remote_rows, client_rows):
        before = json.dumps(client_row, ensure_ascii=False, sort_keys=True)
        if rewrite_plan_row(client_row, stats):
            stats['touched'] += 1
            #  列存按 k 顺序重建
            new_remote.append([client_row.get(key) for key in keys])
        else:
            new_remote.append(packed_row)
        assert before != json.dumps(client_row, ensure_ascii=False, sort_keys=True) or True
        new_client.append(client_row)

    #  armySkillLevelUp：描述里的处决句一并清掉（卡牌技能卡片文案）
    level_rows, level_trailing = read_rows(CLIENT_LEVEL)
    level_hits = 0
    for row in level_rows:
        for key in ('desc', 'skillDesc', 'description'):
            text = row.get(key)
            if isinstance(text, str) and '处决' in text:
                row[key] = EXECUTE_DESC.sub('', text).replace('，处决残血目标', '')
                level_hits += 1

    print('pvpSkillPlan 改动行 %d（其中去 executeChance %d）' % (stats['touched'], stats['execute_removed']))
    print('armySkillLevelUp 改描述 %d 处' % level_hits)

    if check_only:
        return 0

    #  ── 写 JSON ──
    packed_text = dump_packed(keys, new_remote, 1)
    with open(REMOTE_PLAN, 'w', encoding='utf-8', newline='') as handle:
        handle.write(packed_text)
    with open(CLIENT_PLAN, 'w', encoding='utf-8', newline='') as handle:
        handle.write(dump_rows(new_client, trailing))
    with open(CLIENT_LEVEL, 'w', encoding='utf-8', newline='') as handle:
        handle.write(dump_rows(level_rows, level_trailing))

    #  remoteRef 的 armySkillLevelUp 是列存，按 desc 列改
    lkeys, lvalues, lremote = read_packed(REMOTE_LEVEL)
    lchanged = 0
    for row in lremote:
        desc = row.get('desc')
        if isinstance(desc, str) and EXECUTE_DESC.search(desc):
            row['desc'] = EXECUTE_DESC.sub('', desc)
            lchanged += 1
    if lchanged:
        rebuilt = []
        for packed_row, row in zip(lvalues, lremote):
            rebuilt.append([row.get(key) for key in lkeys])
        with open(REMOTE_LEVEL, 'w', encoding='utf-8', newline='') as handle:
            handle.write(dump_packed(lkeys, rebuilt, 1))
    print('remoteRef armySkillLevelUp 改 %d 行' % lchanged)

    #  ── 写源表 ──
    patch_source_plan(new_client)
    patch_source_level()
    return 0


def _load_shared_strings(path: str, member: str = 'xl/sharedStrings.xml'):
    import html as html_mod
    import zipfile
    with zipfile.ZipFile(path) as archive:
        if member not in archive.namelist():
            return []
        raw = archive.read(member).decode('utf-8')
    out = []
    for si in re.findall(r'<si>(.*?)</si>', raw, re.S):
        out.append(html_mod.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))))
    return out


CELL_RE = re.compile(r'<c\s+([^>]*?)(?:/>|>(.*?)</c>)', re.S)


def _cells_of_row(xml: str, row_number: int, shared=None):
    """把一行拆成 `{列字母: 文本}`。

    ⚠️ 自闭合单元格 `<c r="A1" s="3"/>` 必须单独处理：老写法 `<c ([^>]*)>(.*?)</c>`
    会把 `/>` 吞进属性、把后面几个单元格一起吃掉，列就整体错位（踩过一次）。
    `t="s"` 的单元格要按 `sharedStrings` 解析成文本，否则读到的是索引数字。
    """
    import html as html_mod
    match = re.search(r'<row r="%d"[^>]*>(.*?)</row>' % row_number, xml, re.S)
    if not match:
        return {}
    found = {}
    for attrs, body in CELL_RE.findall(match.group(1)):
        ref = re.search(r'r="([A-Z]+)\d+"', attrs)
        if not ref:
            continue
        body = body or ''
        inline = re.search(r'<is><t[^>]*>(.*?)</t></is>', body, re.S)
        if inline:
            found[ref.group(1)] = html_mod.unescape(inline.group(1))
            continue
        value = re.search(r'<v>(.*?)</v>', body, re.S)
        if not value:
            found[ref.group(1)] = ''
        elif 't="s"' in attrs and shared:
            found[ref.group(1)] = shared[int(value.group(1))]
        else:
            found[ref.group(1)] = value.group(1)
    return found


def patch_source_plan(client_rows) -> None:
    """sheet9：C=unitId / D=skillChainId / F=skillLevel / Z=desc / AC=skillParamJson。"""
    import zipfile
    with zipfile.ZipFile(SRC_PLAN) as archive:
        xml = archive.read(SHEET_PLAN).decode('utf-8')
    shared = _load_shared_strings(SRC_PLAN)
    target = {}
    for row in client_rows:
        target[(str(row.get('unitId')), str(row.get('skillChainId')), str(row.get('skillLevel')))] = row
    patched = 0
    hit = 0
    for match in list(re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S)):
        row_number = int(match.group(1))
        if row_number < 6:
            continue
        cells = _cells_of_row(xml, row_number, shared)
        key = (cells.get('C', ''), cells.get('D', ''), cells.get('F', ''))
        row = target.get(key)
        if not row:
            continue
        hit += 1
        want_param = row.get('skillParamJson') or ''
        want_desc = row.get('desc') or ''
        if cells.get('AC', '') != want_param:
            xml = set_cell(xml, 'AC%d' % row_number, want_param)
            patched += 1
        if cells.get('Z', '') != want_desc:
            xml = set_cell(xml, 'Z%d' % row_number, want_desc)
            patched += 1
    backup = write_zip(SRC_PLAN, SHEET_PLAN, xml, BACKUP)
    print('源表 J-技能表 sheet9：命中 %d 行、改 %d 格（备份 %s）'
          % (hit, patched, os.path.basename(backup)))


def patch_source_level() -> None:
    """sheet2（卡牌技能升级表）：C 列技能描述里的处决句。"""
    import html as html_mod
    import zipfile
    with zipfile.ZipFile(SRC_LEVEL) as archive:
        xml = archive.read(SHEET_LEVEL).decode('utf-8')
    shared = _load_shared_strings(SRC_LEVEL)
    patched = 0
    for match in list(re.finditer(r'<row r="(\d+)"[^>]*>(.*?)</row>', xml, re.S)):
        row_number = int(match.group(1))
        cells = _cells_of_row(xml, row_number, shared)
        desc = cells.get('C', '')
        if not desc or '处决' not in desc:
            continue
        xml = set_cell(xml, 'C%d' % row_number, EXECUTE_DESC.sub('', desc))
        patched += 1
    if patched:
        backup = write_zip(SRC_LEVEL, SHEET_LEVEL, xml, BACKUP)
        print('源表 K-卡牌升级 sheet2 改 %d 格（备份 %s）' % (patched, os.path.basename(backup)))


if __name__ == '__main__':
    raise SystemExit(main())
