# -*- coding: utf-8 -*-
"""磁电菇两条技能的第三轮口径（2026-11-11 17:20 用户）：

1. **磁电冲击 101604**：特效「起始位置要在角色的中心点，终点要朝向目标方向」
   · `auraForward` 由 1 改成**等于同档的 `auraRadius`**（160/180/200）—— 光束中心前移半个身位，
     于是整条束正好覆盖「角色中心 → 前方 2×半径」，起点贴角色中心、终点朝目标；
   · 新增 `auraFaceTarget: 1` —— 出生点偏移与矩形朝向都用「本体 → 当前目标」的方位角，
     不再固定朝右（美术本身就是朝右画的，不转的话目标在左边也朝右喷）；
   · 新增 `auraVisualLiftPx: 30` —— 单位根节点是逻辑脚点，抬一个「脚点 → 身体中心」的高度
     （一屏上一格 90px、一个兵可见高 ≈ 67px ⇒ 30px，与 `zcCombatEffectLiftY` 同量级）。

2. **五雷轰顶 101603**：连续特效「出现间隔 0.18s，有明显的先后顺序，同时间距增加 15px」
   · `boltInterval` 0.1 → **0.18**
   · `boltSpacing` 30 → **45**（30 + 15，表值逻辑 px ⇒ 世界 13.5px）

两份产物、两种排版（`remoteRef` 列存 + CRLF / `client` 整份一行），写入前先做
**逐字节 round-trip 自检**，不一致直接拒绝写。幂等：值已对就不重写。
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


def dumps_params(params):
    return json.dumps(params, ensure_ascii=False, separators=(',', ':'))


def rebuild(params, updates, insert_after, append):
    """按原键序重建：`updates` 就地改值、`insert_after[key]` 后面插新键、`append` 补在末尾。"""
    rebuilt = {}
    for key, value in params.items():
        rebuilt[key] = updates.get(key, value)
        for new_key, new_value in insert_after.get(key, []):
            if new_key not in params:
                rebuilt[new_key] = new_value
    for key, value in append.items():
        if key not in params:
            rebuilt[key] = value
    #  `updates` 里原表没有的键（例如给旧行补字段）也补上。
    for key, value in updates.items():
        if key not in rebuilt:
            rebuilt[key] = value
    return rebuilt


def patch_shock(params):
    """101604 磁电冲击：前移半个身位 + 朝目标 + 抬到身体中心。"""
    radius = params.get('auraRadius')
    updates = {'auraForward': radius}
    new = rebuild(params, updates,
                  insert_after={'auraFollow': [('auraFaceTarget', 1)]},
                  append={'auraVisualLiftPx': 30})
    return None if new == params else dumps_params(new)


def patch_bolt(params):
    """101603 五雷轰顶：出现间隔 0.18s、间距 +15。"""
    new = rebuild(params, {'boltInterval': 0.18, 'boltSpacing': 45}, insert_after={}, append={})
    return None if new == params else dumps_params(new)


PATCHERS = {101604: patch_shock, 101603: patch_bolt}


# ---------------------------------------------------------------- 两份产物

def read_remote():
    with io.open(REMOTE, encoding='utf-8', newline='') as fh:
        raw = fh.read()
    return raw, json.loads(raw)


def round_trips_remote(data, raw):
    replay = json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
    return replay.replace('\n', '\r\n') == raw


def main():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    for path in (REMOTE, CLIENT):
        shutil.copy2(path, os.path.join(BACKUP_DIR, '%s.facing-%s' % (os.path.basename(path), stamp)))

    # ── remoteRef ──
    raw, data = read_remote()
    if not round_trips_remote(data, raw):
        raise SystemExit('[fail] remoteRef 序列化无法逐字节还原，拒绝写入')
    keys = data['k']
    chain = keys.index('skillChainId')
    column = keys.index('skillParamJson')
    remote_changed = 0
    for row in data['v']:
        patch = PATCHERS.get(row[chain])
        if patch is None:
            continue
        new_raw = patch(json.loads(row[column]))
        if new_raw is None:
            print('  remoteRef chain=%s mod=%s 已是新口径' % (row[chain], row[keys.index('modifierId')]))
            continue
        row[column] = new_raw
        remote_changed += 1
        print('  remoteRef mod=%s → %s' % (row[keys.index('modifierId')], new_raw))
    if remote_changed:
        with io.open(REMOTE, 'w', encoding='utf-8', newline='') as fh:
            fh.write(json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
                     .replace('\n', '\r\n'))

    # ── client json ──
    with io.open(CLIENT, encoding='utf-8', newline='') as fh:
        raw_client = fh.read()
    rows = json.loads(raw_client)
    if json.dumps(rows, ensure_ascii=False, separators=(',', ':')) != raw_client:
        raise SystemExit('[fail] client json 序列化无法逐字节还原，拒绝写入')
    client_changed = 0
    for row in rows:
        patch = PATCHERS.get(row.get('skillChainId'))
        if patch is None:
            continue
        new_raw = patch(json.loads(row['skillParamJson']))
        if new_raw is None:
            print('  client mod=%s 已是新口径' % row.get('modifierId'))
            continue
        row['skillParamJson'] = new_raw
        client_changed += 1
        print('  client mod=%s → %s' % (row.get('modifierId'), new_raw))
    if client_changed:
        with io.open(CLIENT, 'w', encoding='utf-8', newline='') as fh:
            fh.write(json.dumps(rows, ensure_ascii=False, separators=(',', ':')))

    print('[ok] remoteRef 改 %d 行、client 改 %d 行；备份 %s' % (remote_changed, client_changed, BACKUP_DIR))
    verify()


def verify():
    """两份产物逐档对拍：键顺序 + 数值都必须一模一样。"""
    _, data = read_remote()
    keys = data['k']
    chain = keys.index('skillChainId')
    column = keys.index('skillParamJson')
    remote = {}
    for row in data['v']:
        if row[chain] in PATCHERS:
            remote.setdefault(row[chain], []).append((row[keys.index('skillLevel')], json.loads(row[column])))
    client = {}
    for row in json.loads(io.open(CLIENT, encoding='utf-8').read()):
        if row.get('skillChainId') in PATCHERS:
            client.setdefault(row['skillChainId'], []).append(
                (row['skillLevel'], json.loads(row['skillParamJson'])))
    for chain_id in PATCHERS:
        remote[chain_id].sort()
        client[chain_id].sort()
        assert [p for _, p in remote[chain_id]] == [p for _, p in client[chain_id]], \
            '两份产物的 %s 不一致' % chain_id
        print('  %s 三档 = %s' % (chain_id, [p for _, p in remote[chain_id]]))


if __name__ == '__main__':
    main()
