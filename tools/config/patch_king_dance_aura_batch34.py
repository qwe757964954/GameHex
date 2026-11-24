# -*- coding: utf-8 -*-
"""舞王 103103：阵位半径推出去 + 本体脚底持续光环（2026-11-20 第 34 批）。

用户口径（三句，逐条对应本脚本的改动）：
  1. 「分裂菇和艺术家释放分身技能，只有分身有透明度，本体是 100% 实心的」
     → 阵位半径 60 → **120**：60 表值只投到 46 屏上 px，本体美术归一化后约 69 高，
       4 个 60% 的舞伴全压在本体身上，看起来就是「本体跟着变透」。
  2. 「艺术家释放分身时，在本体脚底没有同步播放【持续光环伤害效果】预制体特效，
     改特效的范围需要囊括本体和 4 个分身」
     → 新增 `summonAuraRadius = 200`：本体脚下一圈纯表现光环。200 表值 → 307.5 屏上 px 直径，
       正好把「92px 的阵位环 + 两侧各约 35px 的美术」包进去。
  3. 「纯表现、无伤害」
     → 只写半径，不写任何 `auraDamageRate` / `auraInterval`；模型侧那条区域
       `wavesLeft = 0` / 无 `contactRadius` / `expireDamage = 0`。

三写口径（本仓的红线）：源表 `J-技能表.xlsx / PVP技能配置` + `assets/remoteRef` 列存 +
`doc/.../json/client` 行对象。本脚本负责前两份 JSON，源表由
`tools/config/sync_plan_rows_to_j_excel.py 103103` 按 client 回灌。

幂等：只按 (skillChainId = 103103) 命中行改两个键 + desc 后缀，重复跑结果一致。
"""
import json
import os
import sys
from datetime import datetime

CHAIN_ID = 103103
SLOT_RADIUS = 120
AURA_RADIUS = 200
DESC_SUFFIX = '；本体脚底同时展开持续光环（纯表现，覆盖本体与 4 个舞伴）'

ROOT = 'D:/Alan/Project/POW'
PLAN_FILES = [
    (os.path.join(ROOT, 'Demo3.8/assets/remoteRef/pvpSkillPlan.json'), 0, True),
    (os.path.join(ROOT, 'doc/塔防数据配置/json/client/pvpSkillPlan.json'), None, False),
]
LEVEL_UP_FILES = [
    (os.path.join(ROOT, 'Demo3.8/assets/remoteRef/armySkillLevelUp.json'), 0, True),
    (os.path.join(ROOT, 'doc/塔防数据配置/json/client/armySkillLevelUp.json'), None, False),
]
BACKUP_DIR = os.path.join(ROOT, 'doc/塔防数据配置_历史备份')


def load(path):
    raw = open(path, 'rb').read().decode('utf-8')
    return json.loads(raw), raw


def save(path, obj, indent, crlf):
    text = json.dumps(obj, ensure_ascii=False, indent=indent, separators=(',', ':'))
    if crlf:
        text = text.replace('\n', '\r\n')
    open(path, 'wb').write(text.encode('utf-8'))


def rows_of(obj):
    """列存 `{k,v,c}` / 行对象数组 ⇒ (行列表, 写回函数)。"""
    if isinstance(obj, dict) and 'k' in obj and 'v' in obj:
        cols = obj['k']
        return [dict(zip(cols, values)) for values in obj['v']], 'column'
    return obj, 'rows'


def write_back(obj, rows, shape):
    if shape == 'column':
        cols = obj['k']
        obj['v'] = [[row.get(col) for col in cols] for row in rows]
        return obj
    return rows


def patch_plan(path, indent, crlf):
    obj, raw = load(path)
    rows, shape = rows_of(obj)
    touched = 0
    for row in rows:
        if int(row.get('skillChainId') or 0) != CHAIN_ID:
            continue
        bag = json.loads(row['skillParamJson'])
        #  顺序固定：…… summonFollow → summonSlotRadius → summonAuraRadius → summonAlpha
        #  （重排成一份新 dict，保证两档产物逐字一致，diff 只落在改动的两格上）
        rebuilt = {}
        for key, value in bag.items():
            if key == 'summonSlotRadius':
                rebuilt['summonSlotRadius'] = SLOT_RADIUS
                rebuilt['summonAuraRadius'] = AURA_RADIUS
                continue
            if key == 'summonAuraRadius':
                continue
            rebuilt[key] = value
        if 'summonAuraRadius' not in rebuilt:
            rebuilt['summonAuraRadius'] = AURA_RADIUS
        if 'summonSlotRadius' not in rebuilt:
            rebuilt['summonSlotRadius'] = SLOT_RADIUS
        row['skillParamJson'] = json.dumps(rebuilt, ensure_ascii=False, separators=(',', ':'))
        desc = str(row.get('desc') or '')
        if DESC_SUFFIX not in desc:
            row['desc'] = desc + DESC_SUFFIX
        touched += 1
    assert touched == 3, f'{path}: 期望 3 档，实际命中 {touched}'
    result = write_back(obj, rows, shape)
    text = json.dumps(result, ensure_ascii=False, indent=indent, separators=(',', ':'))
    if crlf:
        text = text.replace('\n', '\r\n')
    if text != raw:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        backup = os.path.join(BACKUP_DIR, f'{os.path.basename(path)}.{stamp}.bak')
        open(backup, 'wb').write(raw.encode('utf-8'))
        open(path, 'wb').write(text.encode('utf-8'))
        print(f'[写入] {path}（备份 {os.path.basename(backup)}）')
    else:
        print(f'[跳过] {path} 已是目标状态')
    return [str(row['desc']) for row in rows if int(row.get('skillChainId') or 0) == CHAIN_ID]


def patch_level_up(path, indent, crlf, descs):
    obj, raw = load(path)
    rows, shape = rows_of(obj)
    touched = 0
    for row in rows:
        if int(row.get('id') or 0) != CHAIN_ID:
            continue
        row['desc'] = descs[touched]
        touched += 1
    assert touched == 3, f'{path}: 期望 3 档，实际命中 {touched}'
    result = write_back(obj, rows, shape)
    text = json.dumps(result, ensure_ascii=False, indent=indent, separators=(',', ':'))
    if crlf:
        text = text.replace('\n', '\r\n')
    if text != raw:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        backup = os.path.join(BACKUP_DIR, f'{os.path.basename(path)}.{stamp}.bak')
        open(backup, 'wb').write(raw.encode('utf-8'))
        open(path, 'wb').write(text.encode('utf-8'))
        print(f'[写入] {path}（备份 {os.path.basename(backup)}）')
    else:
        print(f'[跳过] {path} 已是目标状态')


def main():
    descs = []
    for path, indent, crlf in PLAN_FILES:
        descs = patch_plan(path, indent, crlf)
    #  plan 两份改完的顺序一致（skillLevel 1/2/3），armySkillLevelUp 也按同样顺序写
    for path, indent, crlf in LEVEL_UP_FILES:
        patch_level_up(path, indent, crlf, descs)

    #  回读自检
    for path, _indent, _crlf in PLAN_FILES:
        obj, _ = load(path)
        rows, _shape = rows_of(obj)
        for row in rows:
            if int(row.get('skillChainId') or 0) != CHAIN_ID:
                continue
            bag = json.loads(row['skillParamJson'])
            assert bag['summonSlotRadius'] == SLOT_RADIUS, (path, bag)
            assert bag['summonAuraRadius'] == AURA_RADIUS, (path, bag)
            assert 'auraDamageRate' not in bag and 'auraInterval' not in bag, '纯表现不许带伤害参数'
            assert DESC_SUFFIX in str(row['desc']), (path, row['desc'])
        print(f'[回读] {path} 103103 三档 OK')
    print('完成。下一步：python tools/config/sync_plan_rows_to_j_excel.py %d' % CHAIN_ID)


if __name__ == '__main__':
    sys.exit(main())
