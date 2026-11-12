# -*- coding: utf-8 -*-
"""磁电冲击 101604：判定由**圆**改**长方形**（2026-11-11 用户口径）。

原话：「把判定改成长方形，尽可能贴合特效范围」。

为什么要改：`units/projectiles/雷电冲击` 是一道**横向束**，美术可见范围
（6 帧并集 485×143 画布 px × `_lscale` 0.575963）折成逻辑 px 是 **363×107**。
原来塞在半径 160/180/200 的圆里 —— 圆的上 / 下缘各空出一大块，
站在光束上方 150px 的人也会被打到，玩家看不出「为什么我没被烧到」。

新形状：**与坐标轴对齐的矩形**，半长跟随 `auraRadius`（L2 = 180 ⇒ 360 ≈ 美术 363），
半宽写死 **54**（⇒ 108 逻辑 px = 屏上 83.0px ≈ 美术 82.4px）。

落到配表就是给三档 `skillParamJson` 加一个键：
    "auraRectHalfHeight": 54
键插在 `auraRadius` 后面（形状参数挨在一起），其余键的**顺序与数值一个字都不动**。

两份产物、两种排版，都必须逐字节保持原样（`pvpSkillPlan` 是整份一行的紧凑 JSON，
`remoteRef` 是 `{k,v,c}` 列存 + `indent=0` + CRLF）。本脚本先做一次
「不改任何数据」的 round-trip 自检，序列化结果必须与原文件**完全一致**才继续写，
否则直接报错退出。

幂等：键已存在且值相同 ⇒ 整份文件不重写。
"""
import io
import json
import os
import shutil
from datetime import datetime

ROOT = 'D:/Alan/Project/POW'
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef', 'pvpSkillPlan.json')
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client', 'pvpSkillPlan.json')
BACKUP_DIR = os.path.join(ROOT, 'Demo3.8', 'tmp', 'config_backup')

CHAIN_ID = 101604
INSERT_AFTER = 'auraRadius'
NEW_KEY = 'auraRectHalfHeight'
NEW_VALUE = 54


def dumps_params(params):
    """与表里既有写法一致：紧凑、不转义中文。"""
    return json.dumps(params, ensure_ascii=False, separators=(',', ':'))


def apply_params(raw):
    """在 `auraRadius` 后面插入 `auraRectHalfHeight`；已有且同值 ⇒ 原样返回。"""
    params = json.loads(raw)
    if params.get(NEW_KEY) == NEW_VALUE:
        return None
    rebuilt = {}
    for key, value in params.items():
        if key == NEW_KEY:
            continue
        rebuilt[key] = value
        if key == INSERT_AFTER:
            rebuilt[NEW_KEY] = NEW_VALUE
    if NEW_KEY not in rebuilt:
        rebuilt[NEW_KEY] = NEW_VALUE
    return dumps_params(rebuilt)


# ---------------------------------------------------------------- remoteRef（列存）

def read_remote():
    with io.open(REMOTE, encoding='utf-8', newline='') as fh:
        raw = fh.read()
    return raw, json.loads(raw)


def write_remote(data):
    text = json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
    with io.open(REMOTE, 'w', encoding='utf-8', newline='') as fh:
        fh.write(text.replace('\n', '\r\n'))


def patch_remote():
    raw, data = read_remote()
    #  自检：不改数据时必须能逐字节还原，否则说明序列化参数不对，写出去会把 2209 行全刷掉。
    replay = json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':')).replace('\n', '\r\n')
    if replay != raw:
        raise SystemExit('[fail] remoteRef 序列化无法逐字节还原，拒绝写入')

    keys = data['k']
    chain = keys.index('skillChainId')
    column = keys.index('skillParamJson')
    changed = 0
    for row in data['v']:
        if row[chain] != CHAIN_ID:
            continue
        new_raw = apply_params(row[column])
        if new_raw is None:
            print('  remoteRef mod=%s 已是新口径' % row[keys.index('modifierId')])
            continue
        row[column] = new_raw
        changed += 1
        print('  remoteRef mod=%s → %s' % (row[keys.index('modifierId')], new_raw))
    if changed:
        write_remote(data)
    return changed


# ---------------------------------------------------------------- client json（整份一行）

def patch_client():
    with io.open(CLIENT, encoding='utf-8', newline='') as fh:
        raw = fh.read()
    rows = json.loads(raw)
    if json.dumps(rows, ensure_ascii=False, separators=(',', ':')) != raw:
        raise SystemExit('[fail] client json 序列化无法逐字节还原，拒绝写入')
    changed = 0
    for row in rows:
        if row.get('skillChainId') != CHAIN_ID:
            continue
        new_raw = apply_params(row['skillParamJson'])
        if new_raw is None:
            print('  client mod=%s 已是新口径' % row.get('modifierId'))
            continue
        row['skillParamJson'] = new_raw
        changed += 1
        print('  client mod=%s → %s' % (row.get('modifierId'), new_raw))
    if changed:
        with io.open(CLIENT, 'w', encoding='utf-8', newline='') as fh:
            fh.write(json.dumps(rows, ensure_ascii=False, separators=(',', ':')))
    return changed


def main():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    for path in (REMOTE, CLIENT):
        shutil.copy2(path, os.path.join(BACKUP_DIR, '%s.bak-%s' % (os.path.basename(path), stamp)))

    total = patch_remote() + patch_client()
    print('[ok] 共改 %d 行；备份在 %s' % (total, BACKUP_DIR))

    #  回读校验：两份产物必须都带上新键，且值一致。
    _, data = read_remote()
    keys = data['k']
    chain = keys.index('skillChainId')
    column = keys.index('skillParamJson')
    remotes = [json.loads(row[column]) for row in data['v'] if row[chain] == CHAIN_ID]
    clients = [json.loads(row['skillParamJson'])
               for row in json.loads(io.open(CLIENT, encoding='utf-8').read())
               if row.get('skillChainId') == CHAIN_ID]
    assert len(remotes) == 3 and len(clients) == 3, '两边的 101604 行数必须都是 3'
    assert remotes == clients, '两份产物的 skillParamJson 不一致'
    assert all(p.get(NEW_KEY) == NEW_VALUE for p in remotes), '新键没写进去'
    print('[ok] 回读通过：三档 = %s' % [p[NEW_KEY] for p in remotes])


if __name__ == '__main__':
    main()
