# -*- coding: utf-8 -*-
"""`armySkillLevelUp` 里 101603 / 101604 六行的 `desc` 同步（2026-11-11 第三轮）。

文案与 `tools/config/patch_magdi_mushroom.js` 的 `PANEL_DESC`、
`patch_magdi_mushroom_k.py` 的 `SKILLS`、以及设计案 K/L/M 列是**同一份**，三处必须逐字一致。

本轮改的：
  · 五雷轰顶：每道间隔 30 → 45px，并补「出现间隔 0.18 秒」；
  · 磁电冲击：从「在身前释放雷电冲击波」改成「朝目标方向喷出一道长 N、宽 108 的雷电束」。

只改 `desc` 一列，其余字段不碰。两份产物排版不同（remoteRef 列存 CRLF / client 整份一行），
写入前各做一次**逐字节 round-trip 自检**。幂等。
"""
import io
import json
import os
import shutil
from datetime import datetime

ROOT = 'D:/Alan/Project/POW'
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef', 'armySkillLevelUp.json')
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client', 'armySkillLevelUp.json')
BACKUP_DIR = os.path.join(ROOT, 'Demo3.8', 'tmp', 'config_backup')

DESC = {
    101603: {
        1: '冷却12秒：对目标释放1道雷电并沿其背朝向再落2道（每道间隔45px、出现间隔0.18秒），'
           '每道造成160%伤害，30%概率使目标麻痹3秒',
        2: '冷却12秒：对目标释放1道雷电并沿其背朝向再落3道（每道间隔45px、出现间隔0.18秒），'
           '每道造成200%伤害，30%概率使目标麻痹3秒',
        3: '冷却12秒：对目标释放1道雷电并沿其背朝向再落4道（每道间隔45px、出现间隔0.18秒），'
           '每道造成250%伤害，30%概率使目标麻痹3秒',
    },
    101604: {
        1: '累计8次普攻：朝目标方向喷出一道长320、宽108的雷电束（起点在自身中心），'
           '持续3秒、每秒造成250%伤害，每波最多命中5个敌人',
        2: '累计8次普攻：朝目标方向喷出一道长360、宽108的雷电束（起点在自身中心），'
           '持续3秒、每秒造成300%伤害，每波最多命中5个敌人',
        3: '累计8次普攻：朝目标方向喷出一道长400、宽108的雷电束（起点在自身中心），'
           '持续3秒、每秒造成350%伤害，每波最多命中5个敌人',
    },
}


def main():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    for path in (REMOTE, CLIENT):
        shutil.copy2(path, os.path.join(BACKUP_DIR, '%s.desc-%s' % (os.path.basename(path), stamp)))

    # ── remoteRef ──
    with io.open(REMOTE, encoding='utf-8', newline='') as fh:
        raw = fh.read()
    data = json.loads(raw)
    replay = json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':')).replace('\n', '\r\n')
    if replay != raw:
        raise SystemExit('[fail] remoteRef 序列化无法逐字节还原，拒绝写入')
    keys = data['k']
    col_id, col_level, col_desc = keys.index('id'), keys.index('skilllevel'), keys.index('desc')
    changed = 0
    for row in data['v']:
        text = DESC.get(row[col_id], {}).get(row[col_level])
        if text is None or row[col_desc] == text:
            continue
        row[col_desc] = text
        changed += 1
    if changed:
        with io.open(REMOTE, 'w', encoding='utf-8', newline='') as fh:
            fh.write(json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
                     .replace('\n', '\r\n'))
    print('remoteRef 改 %d 行' % changed)

    # ── client json ──
    with io.open(CLIENT, encoding='utf-8', newline='') as fh:
        raw_client = fh.read()
    rows = json.loads(raw_client)
    #  ⚠️ 这张表的 client 产物是 **2 空格 pretty + 末尾换行**（`pvpSkillPlan` 才是整份一行），
    #  不要照抄那边的 `separators`。改排版会让 5990 行全变 diff。
    def dump_client(value):
        return json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    if dump_client(rows) != raw_client:
        raise SystemExit('[fail] client json 序列化无法逐字节还原，拒绝写入')
    changed_client = 0
    for row in rows:
        text = DESC.get(row.get('id'), {}).get(row.get('skilllevel'))
        if text is None or row.get('desc') == text:
            continue
        row['desc'] = text
        changed_client += 1
    if changed_client:
        with io.open(CLIENT, 'w', encoding='utf-8', newline='') as fh:
            fh.write(dump_client(rows))
    print('client 改 %d 行' % changed_client)

    # ── 回读 ──
    _, check = (lambda r: (r, json.loads(r)))(io.open(REMOTE, encoding='utf-8', newline='').read())
    keys = check['k']
    col_id, col_level, col_desc = keys.index('id'), keys.index('skilllevel'), keys.index('desc')
    got = {(row[col_id], row[col_level]): row[col_desc] for row in check['v']
           if row[col_id] in DESC}
    for skill_id, tiers in DESC.items():
        for level, text in tiers.items():
            assert got[(skill_id, level)] == text, '%s L%s 未写入' % (skill_id, level)
    print('[ok] 回读通过：六行描述全部是新口径')


if __name__ == '__main__':
    main()
