# -*- coding: utf-8 -*-
"""给 `PVP-怪物卡牌.xlsx` 里「单位碰撞半径」为空的塔防怪补 `unitBodyRadius`。

## 为什么补

命中判定是 `projectile.collisionRadius + bodyRadius * combatDistanceScale`：

    collisionRadius = pvpSkill.collisionRadius ?? 3        （逻辑 px）
    bodyRadius      = unitBodyRadius ?? 0                  （逻辑 px）
    combatDistanceScale = 0.3

所以 `unitBodyRadius` 为空时，命中圈只有 **3 逻辑 px = 2.3 屏上 px**。
屏上怪物身宽 50~60 px ⇒ 远程弹道基本要从「靶心」穿过才算命中，
表现就是「子弹明明穿过去了却不掉血、也没有受击特效」（68026 麻辣铁锅普攻）。

## 填多少

玩家卡 `pvpCard.unitBodyRadius` 的实际分布是 **24 占 32/37 行**（26 两行、18 一行、空两行），
所以新增行**统一填 24**（= 中位数也是众数），不再拿 18/24/26 造档位——
现有 5 行（50003=26 / 50004=18 / 50005=24 / 50006=24 / 50007=26）的取值与
`atkRange`、`maxHp`、体型任何一列都不相关，是历史手填，本脚本**不动它们**。

## 三写

1. `D:/Alan/Project/POW/doc/塔防数据配置/PVP-怪物卡牌.xlsx` 的 AA 列（第 27 列）；
2. `assets/remoteRef/monsterCard.json`（列存 `{k,v,c}`、逐元素换行）；
3. `D:/Alan/Project/POW/doc/塔防数据配置/json/client/monsterCard.json`（行数组、紧凑无换行）。

两份 JSON 的行尾都是 **LF + 无末尾换行**。remoteRef 那份的排版任何 `json.dumps(indent=…)`
都复现不出来（`{`、`"k":[`、每个键/值各占一行、逗号留行尾…），所以这里自带 `dump_record()`
序列化器，**改动前先拿它跑一遍原文，逐字节相等才允许写**（round-trip 自检）。

用法：
    python tools/config/patch_monster_body_radius.py            # 试跑，只报告
    python tools/config/patch_monster_body_radius.py --write    # 落盘（先备份 xlsx）
"""

import json
import os
import re
import shutil
import sys
import zipfile

ROOT = 'D:/Alan/Project/POW/doc/塔防数据配置'
XLSX = os.path.join(ROOT, 'PVP-怪物卡牌.xlsx')
SHEET = 'xl/worksheets/sheet1.xml'
CLIENT_JSON = os.path.join(ROOT, 'json', 'client', 'monsterCard.json')
REMOTE_JSON = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'assets', 'remoteRef', 'monsterCard.json')
BACKUP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'tmp', 'monster_body_radius_backup')

# 表头第 5 行（`id / name / …`）里 unitBodyRadius 的位置 = 第 27 列 = AA
BODY_COL = 'AA'
BODY_FIELD = 'unitBodyRadius'
FILL_VALUE = 24
# 数据行从第 7 行起；50001/50002 是主城/金矿（卡牌类型 5/1，不是单位），跳过
DATA_FIRST_ROW = 7
SKIP_IDS = {50001, 50002}


# ---------------------------------------------------------------- remoteRef 序列化器

def _scalar(value):
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return json.dumps(value)
    return json.dumps(value, ensure_ascii=False)


def _dump_value(value, trailing_comma):
    """一个值占几行就返回几行；`trailing_comma` 决定末行是否带逗号。"""
    if isinstance(value, dict):
        items = list(value.items())
        out = ['{']
        for i, (key, val) in enumerate(items):
            sub = _dump_value(val, i < len(items) - 1)
            if len(sub) != 1:
                raise SystemExit('monsterCard 里出现嵌套容器，序列化器需扩展')
            out.append('"%s":%s' % (key, sub[0]))
        out.append('},' if trailing_comma else '}')
        return out
    if isinstance(value, list):
        out = ['[']
        for i, item in enumerate(value):
            out.extend(_dump_value(item, i < len(value) - 1))
        out.append(']' + (',' if trailing_comma else ''))
        return out
    return [_scalar(value) + (',' if trailing_comma else '')]


def dump_remote(data):
    """整份 remoteRef 风格（`{"k":[..],"v":[..],"c":n}` 列存、逐元素换行、LF、无末尾换行）。"""
    keys = data['k']
    rows = data['v']
    lines = ['{', '"k":[']
    for i, key in enumerate(keys):
        lines.append('"%s"%s' % (key, ',' if i < len(keys) - 1 else ''))
    lines.append('],')
    lines.append('"v":[')
    for i, row in enumerate(rows):
        lines.extend(_dump_value(row, i < len(rows) - 1))
    lines.append('],')
    lines.append('"c":%s' % data['c'])
    lines.append('}')
    return '\n'.join(lines)


def dump_client(rows):
    """client 风格：行数组，每行紧凑无空格，行间 `,\\n`，LF，无末尾换行。"""
    body = [json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows]
    return '[' + ',\n'.join(body) + ']'


# ---------------------------------------------------------------- xlsx zip 级读写

def read_sheet():
    with zipfile.ZipFile(XLSX) as z:
        return z.read(SHEET).decode('utf-8')


def write_sheet(xml):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, os.path.basename(XLSX))
    shutil.copy2(XLSX, backup)
    tmp = XLSX + '.tmp'
    with zipfile.ZipFile(XLSX) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == SHEET:
                data = xml.encode('utf-8')
            dst.writestr(info, data)
    os.replace(tmp, XLSX)
    return backup


def cell_text(xml, ref):
    m = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if m is None:
        return None
    inner = m.group(1)
    if not inner:
        return None
    v = re.search(r'<v>(.*?)</v>', inner, re.S)
    return v.group(1) if v else None


def set_number(xml, ref, value):
    """写整数，沿用该格既有的 `s=` 样式；不写 `t="n"`（与表内邻居一致）。"""
    pattern = r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref
    m = re.search(pattern, xml, re.S)
    if m is None:
        raise SystemExit('单元格 %s 不存在' % ref)
    style = re.search(r's="(\d+)"', m.group(0))
    cell = '<c r="%s"%s><v>%d</v></c>' % (
        ref, ' s="%s"' % style.group(1) if style else '', value)
    return xml[:m.start()] + cell + xml[m.end():]


def scan_rows(xml):
    """返回 [(row, id, type, bodyRadius|None)]，只取数据行。"""
    out = []
    for hit in re.finditer(r'<row r="(\d+)"', xml):
        row = int(hit.group(1))
        if row < DATA_FIRST_ROW:
            continue
        raw_id = cell_text(xml, 'A%d' % row)
        if raw_id is None:
            continue
        raw_type = cell_text(xml, 'C%d' % row)
        body = cell_text(xml, '%s%d' % (BODY_COL, row))
        out.append((row, int(float(raw_id)), raw_type, int(body) if body not in (None, '') else None))
    return out


# ---------------------------------------------------------------- 主流程

def main():
    write = '--write' in sys.argv

    xml = read_sheet()
    rows = scan_rows(xml)
    print('源表 %s：%d 行数据' % (os.path.basename(XLSX), len(rows)))

    pending = [r for r in rows if r[3] is None and r[1] not in SKIP_IDS]
    print('碰撞半径为空：%d 行（%s）' % (
        len(pending), ' '.join(str(r[1]) for r in pending) or '-'))

    for row, card_id, _type, body in rows:
        if body is not None:
            print('  已有  %5d  row=%-3d %s' % (card_id, row, body))

    for row, card_id, _type, _body in pending:
        xml = set_number(xml, '%s%d' % (BODY_COL, row), FILL_VALUE)

    # 主城/金矿不是单位，`unitBodyRadius` 保持空
    final = {r[1]: (FILL_VALUE if r[3] is None else r[3])
             for r in rows if r[1] not in SKIP_IDS}
    print('目标值：%d 只补 %d；已有 %d 只不动；跳过建筑 %s' % (
        len(pending), FILL_VALUE, len(rows) - len(pending) - len(SKIP_IDS),
        '/'.join(str(i) for i in sorted(SKIP_IDS))))

    # ---- 两份 JSON：先 round-trip 自检，再镜像源表
    remote_raw = open(REMOTE_JSON, encoding='utf-8', newline='').read()
    remote = json.loads(remote_raw)
    if dump_remote(remote) != remote_raw:
        raise SystemExit('remoteRef/monsterCard.json round-trip 不一致，拒绝写入')

    client_raw = open(CLIENT_JSON, encoding='utf-8', newline='').read()
    client = json.loads(client_raw)
    if dump_client(client) != client_raw:
        raise SystemExit('client/monsterCard.json round-trip 不一致，拒绝写入')

    body_index = remote['k'].index(BODY_FIELD)
    changed_remote = 0
    for row in remote['v']:
        target = final.get(row[0])
        if target is not None and row[body_index] != target:
            row[body_index] = target
            changed_remote += 1

    changed_client = 0
    for row in client:
        target = final.get(row['id'])
        if target is not None and row.get(BODY_FIELD) != target:
            row[BODY_FIELD] = target
            changed_client += 1

    # 三处一致性核对：源表 / remoteRef / client 必须同值
    client_map = {row['id']: row.get(BODY_FIELD) for row in client}
    remote_map = {row[0]: row[body_index] for row in remote['v']}
    mismatch = [i for i in final if client_map.get(i) != final[i] or remote_map.get(i) != final[i]]
    if mismatch:
        raise SystemExit('三写不一致：%s' % mismatch)

    print('remoteRef 改动 %d 行 / client 改动 %d 行' % (changed_remote, changed_client))

    if not write:
        print('（未写盘；加 --write 落盘）')
        return

    backup = write_sheet(xml)
    with open(REMOTE_JSON, 'w', encoding='utf-8', newline='') as fh:
        fh.write(dump_remote(remote))
    with open(CLIENT_JSON, 'w', encoding='utf-8', newline='') as fh:
        fh.write(dump_client(client))
    print('已写入。xlsx 备份：%s' % backup)


if __name__ == '__main__':
    main()
