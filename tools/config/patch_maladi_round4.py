# -*- coding: utf-8 -*-
"""麻辣铁锅 68026 第四轮口径（2026-11-11 18:1x 用户），三条一次改完：

1. **凤凰降临 102604：4 颗子弹改成「4 个方向」**
   `projectileSpreadDeg` 90 → **360**。
   90 是「扇形张角」：4 颗摊在 ±45° 里（-45/-15/+15/+45），全打向目标那一侧，
   实测**四发全部脱靶**（±15° 在 140px 处横向偏 37.5px > 身圈 27px）。
   360 走 `ZCAttackResolutionSystem` 新加的「全向均分」分支 ⇒ 0/90/180/270 四向，
   与用户图例里那四个绿色箭头一致。

2. **喷射火焰 102603：特效要贴住角色**
   补 `auraFaceTarget: 1`（出生点与美术朝向都按「本体 → 目标」的方位角），
   配合预制体根节点的 `_lpos` 从 (-190.08, 116.19) 改成 (-269.08, 45.00)
   —— 前半段负责「火焰尾巴从施法者脚下起」、后半段负责「抬到身体中心而不是半空」。

3. **两份描述**（`pvpSkillPlan.desc` + `armySkillLevelUp.desc`）跟着改口径。

写入两份产物（`remoteRef` 列存 CRLF / `client` 按原排版），各做逐字节 round-trip 自检。幂等。
"""
import io
import json
import os
import shutil
from datetime import datetime

ROOT = 'D:/Alan/Project/POW'
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef', 'pvpSkillPlan.json')
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client', 'pvpSkillPlan.json')
K_REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef', 'armySkillLevelUp.json')
K_CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client', 'armySkillLevelUp.json')
BACKUP_DIR = os.path.join(ROOT, 'Demo3.8', 'tmp', 'config_backup')

SPREAD_IDS = (94026041, 94026042, 94026043)   # 102604 三档
SPRAY_IDS = (94026031, 94026032, 94026033)    # 102603 三档
WANT = SPREAD_IDS + SPRAY_IDS

#  描述里要换的片段（两条技能各一句，三档都命中）
DESC_REPLACES = [
    ('发射4颗夹角90°的凤凰弹（速度150、持续4秒）',
     '向四周各发射1颗凤凰弹（4个方向、相邻90°，速度150、持续4秒）'),
    ('发射 4 颗夹角 90° 的凤凰弹（速度 150、持续 4 秒）',
     '向四周各发射 1 颗凤凰弹（4 个方向、相邻 90°，速度 150、持续 4 秒）'),
    ('跳起向前喷出火焰柱，持续3秒、每秒对身前350px处',
     '跳起朝目标方向喷出火焰柱（起点在自身中心），持续3秒、每秒对前方350px处'),
    ('跳起向前喷出火焰柱，持续 3 秒、每秒对身前 350px 处',
     '跳起朝目标方向喷出火焰柱（起点在自身中心），持续 3 秒、每秒对前方 350px 处'),
]


def rebuild(params, updates, append):
    """按原键序重建：`updates` 就地改值、`append` 补在末尾（已有的键不重复加）。"""
    out = {}
    for key, value in params.items():
        out[key] = updates.get(key, value)
    for key, value in append.items():
        if key not in out:
            out[key] = value
    return out


def patch_params(modifier_id, params):
    if modifier_id in SPREAD_IDS:
        if params.get('projectileSpreadDeg') == 360:
            return None
        out = rebuild(params, {'projectileSpreadDeg': 360}, {})
        return json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    if modifier_id in SPRAY_IDS:
        if (params.get('auraFaceTarget') or 0) == 1:
            return None
        out = rebuild(params, {}, {'auraFaceTarget': 1})
        return json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    return None


def patch_desc(text):
    if not text:
        return text
    for old, new in DESC_REPLACES:
        if old in text:
            return text.replace(old, new, 1)
    return text


def main():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    for path in (REMOTE, CLIENT, K_REMOTE, K_CLIENT):
        shutil.copy2(path, os.path.join(BACKUP_DIR, '%s.round4-%s' % (os.path.basename(path), stamp)))

    # ── pvpSkillPlan · remoteRef ──
    with io.open(REMOTE, encoding='utf-8', newline='') as fh:
        raw = fh.read()
    data = json.loads(raw)
    if json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':')).replace('\n', '\r\n') != raw:
        raise SystemExit('[fail] remoteRef 序列化无法逐字节还原')
    keys = data['k']
    col_mod, col_param, col_desc = keys.index('modifierId'), keys.index('skillParamJson'), keys.index('desc')
    changed_param = changed_desc = 0
    for row in data['v']:
        modifier_id = row[col_mod]
        if modifier_id not in WANT:
            continue
        if row[col_param]:
            new_param = patch_params(modifier_id, json.loads(row[col_param]))
            if new_param is not None:
                row[col_param] = new_param
                changed_param += 1
        new_desc = patch_desc(row[col_desc])
        if new_desc != row[col_desc]:
            row[col_desc] = new_desc
            changed_desc += 1
    if changed_param or changed_desc:
        with io.open(REMOTE, 'w', encoding='utf-8', newline='') as fh:
            fh.write(json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
                     .replace('\n', '\r\n'))
    print('remoteRef 参数改 %d 行、描述改 %d 行' % (changed_param, changed_desc))

    # ── pvpSkillPlan · client（整份一行）──
    with io.open(CLIENT, encoding='utf-8', newline='') as fh:
        raw_client = fh.read()
    rows = json.loads(raw_client)
    if json.dumps(rows, ensure_ascii=False, separators=(',', ':')) != raw_client:
        raise SystemExit('[fail] client 序列化无法逐字节还原')
    cp = cd = 0
    for row in rows:
        modifier_id = row.get('modifierId')
        if modifier_id not in WANT:
            continue
        if row.get('skillParamJson'):
            new_param = patch_params(modifier_id, json.loads(row['skillParamJson']))
            if new_param is not None:
                row['skillParamJson'] = new_param
                cp += 1
        new_desc = patch_desc(row.get('desc'))
        if new_desc != row.get('desc'):
            row['desc'] = new_desc
            cd += 1
    if cp or cd:
        with io.open(CLIENT, 'w', encoding='utf-8', newline='') as fh:
            fh.write(json.dumps(rows, ensure_ascii=False, separators=(',', ':')))
    print('client   参数改 %d 行、描述改 %d 行' % (cp, cd))

    # ── armySkillLevelUp（remoteRef 列存 + client 2 空格 pretty）──
    with io.open(K_REMOTE, encoding='utf-8', newline='') as fh:
        kraw = fh.read()
    kdata = json.loads(kraw)
    if json.dumps(kdata, ensure_ascii=False, indent=0, separators=(',', ':')).replace('\n', '\r\n') != kraw:
        raise SystemExit('[fail] armySkillLevelUp remoteRef 无法逐字节还原')
    kkeys = kdata['k']
    kcol_id, kcol_desc = kkeys.index('id'), kkeys.index('desc')
    kchanged = 0
    for row in kdata['v']:
        if row[kcol_id] in (102603, 102604):
            new_desc = patch_desc(row[kcol_desc])
            if new_desc != row[kcol_desc]:
                row[kcol_desc] = new_desc
                kchanged += 1
    if kchanged:
        with io.open(K_REMOTE, 'w', encoding='utf-8', newline='') as fh:
            fh.write(json.dumps(kdata, ensure_ascii=False, indent=0, separators=(',', ':'))
                     .replace('\n', '\r\n'))

    with io.open(K_CLIENT, encoding='utf-8', newline='') as fh:
        kraw_client = fh.read()
    krows = json.loads(kraw_client)
    def dump_k(value):
        return json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    if dump_k(krows) != kraw_client:
        raise SystemExit('[fail] armySkillLevelUp client 无法逐字节还原（应是 2 空格 pretty）')
    kc = 0
    for row in krows:
        if row.get('id') in (102603, 102604):
            new_desc = patch_desc(row.get('desc'))
            if new_desc != row.get('desc'):
                row['desc'] = new_desc
                kc += 1
    if kc:
        with io.open(K_CLIENT, 'w', encoding='utf-8', newline='') as fh:
            fh.write(dump_k(krows))
    print('K 表    remoteRef 改 %d 行、client 改 %d 行' % (kchanged, kc))
    verify()


def verify():
    _, remote = (lambda r: (r, json.loads(r)))(io.open(REMOTE, encoding='utf-8', newline='').read())
    keys = remote['k']
    col_mod, col_param, col_desc = keys.index('modifierId'), keys.index('skillParamJson'), keys.index('desc')
    got = {row[col_mod]: row for row in remote['v'] if row[col_mod] in WANT}
    client = {row['modifierId']: row for row in json.loads(io.open(CLIENT, encoding='utf-8').read())
              if row.get('modifierId') in WANT}
    assert sorted(got) == sorted(client) == sorted(WANT), '两份产物行集合不一致'
    for modifier_id in SPREAD_IDS:
        assert json.loads(got[modifier_id][col_param])['projectileSpreadDeg'] == 360, modifier_id
        assert '向四周各发射' in got[modifier_id][col_desc], modifier_id
        assert json.loads(client[modifier_id]['skillParamJson'])['projectileSpreadDeg'] == 360
    for modifier_id in SPRAY_IDS:
        params = json.loads(got[modifier_id][col_param])
        assert params['auraFaceTarget'] == 1 and params['auraForward'] == 350, modifier_id
        assert '朝目标方向' in got[modifier_id][col_desc], modifier_id
    print('[ok] 回读通过：凤凰 360° 全向、火焰 faceTarget=1，两份产物一致')

    kdata = json.loads(io.open(K_REMOTE, encoding='utf-8', newline='').read())
    kkeys = kdata['k']
    kid, kdesc = kkeys.index('id'), kkeys.index('desc')
    for row in kdata['v']:
        if row[kid] == 102604:
            assert '向四周各发射1颗凤凰弹' in row[kdesc]
        if row[kid] == 102603:
            assert '朝目标方向喷出火焰柱' in row[kdesc]
    print('[ok] 回读通过：armySkillLevelUp 六行描述同步')


if __name__ == '__main__':
    main()
