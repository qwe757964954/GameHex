# -*- coding: utf-8 -*-
#  ⚠️ 历史脚本，口径已被后续轮次覆盖（101603 = 60px/0.15s；101604 = 矩形 + 跟随角色）。
#     重跑会把 pvpSkillPlan 的描述**回滚**到第三轮文案。当前真源：
#       · 配表：tools/config/patch_magdi_mushroom.js（整块重写，已与线上一致）
#       · 描述：patch_magdi_shock_follow.js（两份 JSON）+ patch_skill_k_desc_excel.py
#       · 设计案：patch_skill_design_magdi_follow.py
"""`pvpSkillPlan.desc` 里 101603 / 101604 六行的描述同步（2026-11-11 第三轮补漏）。

⚠️ 为什么要单独一个脚本：`armySkillLevelUp.desc` 那张表（卡片 UI 读它）已经由
`patch_magdi_desc_round3.py` 改完，但 **`pvpSkillPlan` 也有一列 `desc`**，
前两轮只改了数值没改文案，于是同一行里「`boltSpacing: 45`」配着「每道间隔 30px」——
自己跟自己矛盾。本轮补上。

`pvpSkillPlan.desc` 目前**没有任何运行时代码消费**（`CardSkillDescMarkup` 读的是
`armySkillLevelUp.desc`；`ZCModifierEngine` 的 `desc` 来自 `skillAttrModifier` 即 J 表），
所以它只是「表里的人读的说明」，但正因为会被人读，口径必须一致。

只改 `desc` 一列，其余字段不碰；按 `modifierId` 定位（`pvpSkillId` 30231 被两条链共用，不唯一），
在原文上做**定点替换**并 `assert` 命中。两份产物排版不同，写入前各做一次逐字节 round-trip 自检。幂等。
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

#  modifierId → [(旧片段, 新片段), …]，每条都必须在原文里命中一次。
REPLACE = {
    #  五雷轰顶：间距 30 → 45px，逐道间隔 0.1 → 0.18 秒
    94016031: [('每道间隔 30px、逐道间隔 0.1 秒', '每道间隔 45px、逐道间隔 0.18 秒')],
    94016032: [('每道间隔 30px、逐道间隔 0.1 秒', '每道间隔 45px、逐道间隔 0.18 秒')],
    94016033: [('每道间隔 30px、逐道间隔 0.1 秒', '每道间隔 45px、逐道间隔 0.18 秒')],
    #  磁电冲击：从「身前 1 像素的圆」改成「朝目标方向的雷电束」，长度跟同档 auraRadius ×2
    94016041: [('在身前 1 像素处释放 1 道雷电冲击波',
                '朝目标方向喷出一道长 320、宽 108 的雷电束（起点在自身中心）')],
    94016042: [('在身前 1 像素处释放 1 道雷电冲击波',
                '朝目标方向喷出一道长 360、宽 108 的雷电束（起点在自身中心）')],
    94016043: [('在身前 1 像素处释放 1 道雷电冲击波',
                '朝目标方向喷出一道长 400、宽 108 的雷电束（起点在自身中心）')],
}

#  新口径的判据（回读时校验，即使原文已经是新文案也不再替换）
EXPECT = {
    94016031: '每道间隔 45px、逐道间隔 0.18 秒',
    94016032: '每道间隔 45px、逐道间隔 0.18 秒',
    94016033: '每道间隔 45px、逐道间隔 0.18 秒',
    94016041: '长 320、宽 108',
    94016042: '长 360、宽 108',
    94016043: '长 400、宽 108',
}


def patch_text(modifier_id, text):
    """返回 (新文本, 是否改动)；旧片段已不在但新口径已在 ⇒ 视为无需改。"""
    if EXPECT[modifier_id] in text:
        return text, False
    updated = text
    for old, new in REPLACE[modifier_id]:
        assert old in updated, '%s 的 desc 里找不到旧片段「%s」' % (modifier_id, old)
        updated = updated.replace(old, new, 1)
    return updated, True


def main():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    for path in (REMOTE, CLIENT):
        shutil.copy2(path, os.path.join(BACKUP_DIR, '%s.plandesc-%s' % (os.path.basename(path), stamp)))

    # ── remoteRef（列存 + CRLF）──
    with io.open(REMOTE, encoding='utf-8', newline='') as fh:
        raw = fh.read()
    data = json.loads(raw)
    replay = json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':')).replace('\n', '\r\n')
    if replay != raw:
        raise SystemExit('[fail] remoteRef 序列化无法逐字节还原，拒绝写入')
    keys = data['k']
    col_mod, col_desc = keys.index('modifierId'), keys.index('desc')
    remote_changed = 0
    for row in data['v']:
        modifier_id = row[col_mod]
        if modifier_id not in REPLACE:
            continue
        new_text, changed = patch_text(modifier_id, row[col_desc] or '')
        if not changed:
            print('  remoteRef mod=%s 已是新文案' % modifier_id)
            continue
        row[col_desc] = new_text
        remote_changed += 1
        print('  remoteRef mod=%s → %s' % (modifier_id, new_text))
    if remote_changed:
        with io.open(REMOTE, 'w', encoding='utf-8', newline='') as fh:
            fh.write(json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
                     .replace('\n', '\r\n'))

    # ── client json（整份一行、无末尾换行）──
    with io.open(CLIENT, encoding='utf-8', newline='') as fh:
        raw_client = fh.read()
    rows = json.loads(raw_client)
    if json.dumps(rows, ensure_ascii=False, separators=(',', ':')) != raw_client:
        raise SystemExit('[fail] client json 序列化无法逐字节还原，拒绝写入')
    client_changed = 0
    for row in rows:
        modifier_id = row.get('modifierId')
        if modifier_id not in REPLACE:
            continue
        new_text, changed = patch_text(modifier_id, row.get('desc') or '')
        if not changed:
            print('  client mod=%s 已是新文案' % modifier_id)
            continue
        row['desc'] = new_text
        client_changed += 1
        print('  client mod=%s → %s' % (modifier_id, new_text))
    if client_changed:
        with io.open(CLIENT, 'w', encoding='utf-8', newline='') as fh:
            fh.write(json.dumps(rows, ensure_ascii=False, separators=(',', ':')))

    print('[ok] remoteRef 改 %d 行、client 改 %d 行；备份 %s' % (remote_changed, client_changed, BACKUP_DIR))
    verify()


def verify():
    """两份产物逐档对拍，且新口径真的在里面。"""
    with io.open(REMOTE, encoding='utf-8', newline='') as fh:
        data = json.loads(fh.read())
    keys = data['k']
    col_mod, col_desc = keys.index('modifierId'), keys.index('desc')
    remote = {row[col_mod]: row[col_desc] for row in data['v'] if row[col_mod] in EXPECT}
    client = {row['modifierId']: row.get('desc') for row in json.loads(io.open(CLIENT, encoding='utf-8').read())
              if row.get('modifierId') in EXPECT}
    assert remote == client, '两份产物的 desc 不一致：\n%s\n%s' % (remote, client)
    for modifier_id, needle in EXPECT.items():
        assert needle in (remote[modifier_id] or ''), '%s 的新文案没写进去' % modifier_id
        print('  %s %s' % (modifier_id, remote[modifier_id]))
    print('[ok] 回读通过：六行描述与两份产物逐字一致')


if __name__ == '__main__':
    main()
