# -*- coding: utf-8 -*-
"""急冻瓜「冰山陨落」102403：释放位置从「自身」改成「受击目标」（2026-11-19 用户口径）。

用户原话：
> 急冻瓜的【冰山陨落】的释放位置应该是受击目标的位置，不是自身，
> 区域效果和冰锥都是落在目标身上 同步修改源表和设计案

落地口径（只动这一条链，别的 `self_aura` 一动不动）
──────────────────────────────────────────────────
· 新键 `auraAtTarget = 1`（三档同值）—— 判定圆心直接搬到**当前受击目标**脚下，
  并且**不跟随本体**（`auraFollow` 的缺省 1 会把圆心每帧拽回施法者，等于没搬，
  所以这条在 `castSelfAura` 里由 `auraAtTarget` 隐含关闭，不额外写一格 `auraFollow: 0`）；
· 没有目标 ⇒ 拒放、不消费 CD（`castSelfAura` 返回 false）；
· 区域的表现（`effectPrefabPath` / `holdVisual`）挂在区域圆心 ⇒ 圆心搬到目标身上，
  光圈与判定同源，一起过去，不需要另开一个「表现落点」口径；
· `desc` 三档（`pvpSkillPlan` 两份 + `armySkillLevelUp` 两份）统一把
  「在自身位置引爆冰山」改成「在受击目标位置引爆冰山」。

幂等：`auraAtTarget` 已存在且为 1、`desc` 已经是新文案 ⇒ 不重写。
写入前对两份产物做**逐字节 round-trip 自检**，还原不回来直接拒绝写。

用法：python tools/config/patch_ice_at_target.py
"""
import io
import json
import os
import shutil
from datetime import datetime

ROOT = 'D:/Alan/Project/POW'
REMOTE_PLAN = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef', 'pvpSkillPlan.json')
CLIENT_PLAN = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client', 'pvpSkillPlan.json')
REMOTE_K = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef', 'armySkillLevelUp.json')
CLIENT_K = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client', 'armySkillLevelUp.json')
BACKUP_DIR = os.path.join(ROOT, 'Demo3.8', 'tmp', 'config_backup')

CHAIN = 102403
OLD_TEXT = '在自身位置引爆冰山'
NEW_TEXT = '在受击目标位置引爆冰山'
NEW_KEYS = {'auraAtTarget': 1}


def dumps_params(params):
    return json.dumps(params, ensure_ascii=False, separators=(',', ':'))


def patch_params(raw):
    """在 `auraSlowRatio` 后面补 `auraAtTarget`（保持原键序，值已对就返回 None）。"""
    params = json.loads(raw)
    changed = False
    rebuilt = {}
    for key, value in params.items():
        rebuilt[key] = NEW_KEYS.get(key, value)
        changed = changed or key in NEW_KEYS
        if key == 'auraSlowRatio':
            for new_key, new_value in NEW_KEYS.items():
                if new_key not in params:
                    rebuilt[new_key] = new_value
                    changed = True
    for new_key, new_value in NEW_KEYS.items():
        if new_key not in rebuilt:
            rebuilt[new_key] = new_value
            changed = True
    return None if not changed else dumps_params(rebuilt)


def patch_desc(text):
    if OLD_TEXT not in text:
        return None
    return text.replace(OLD_TEXT, NEW_TEXT)


def main():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    for path in (REMOTE_PLAN, CLIENT_PLAN, REMOTE_K, CLIENT_K):
        shutil.copy2(path, os.path.join(
            BACKUP_DIR, '%s.iceat-%s' % (os.path.basename(path), stamp)))

    # ── remoteRef 两份（列存）──
    for path, chain_key, param_key, desc_key in (
        (REMOTE_PLAN, 'skillChainId', 'skillParamJson', 'desc'),
        (REMOTE_K, 'id', None, 'desc'),
    ):
        with io.open(path, encoding='utf-8', newline='') as handle:
            raw = handle.read()
        data = json.loads(raw)
        replay = json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
        if replay.replace('\n', '\r\n') != raw:
            raise SystemExit('[fail] %s 序列化无法逐字节还原，拒绝写入' % os.path.basename(path))
        keys = data['k']
        chain = keys.index(chain_key)
        param = keys.index(param_key) if param_key else None
        desc = keys.index(desc_key)
        changed = 0
        for row in data['v']:
            if str(row[chain]) != str(CHAIN):
                continue
            if param is not None:
                new_raw = patch_params(row[param])
                if new_raw is not None:
                    row[param] = new_raw
                    changed += 1
                    print('  %s mod=%s 参数 → %s' % (
                        os.path.basename(path), row[keys.index('modifierId')], new_raw))
            new_desc = patch_desc(row[desc])
            if new_desc is not None:
                row[desc] = new_desc
                changed += 1
                print('  %s skilllevel=%s 描述已改' % (
                    os.path.basename(path), row[keys.index('skilllevel')] if 'skilllevel' in keys else '?'))
        if changed:
            with io.open(path, 'w', encoding='utf-8', newline='') as handle:
                handle.write(json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
                             .replace('\n', '\r\n'))
        else:
            print('  %s 已是新口径' % os.path.basename(path))

    # ── client 两份（行对象）──
    for path in (CLIENT_PLAN, CLIENT_K):
        with io.open(path, encoding='utf-8', newline='') as handle:
            raw = handle.read()
        rows = json.loads(raw)
        if json.dumps(rows, ensure_ascii=False, separators=(',', ':')) != raw:
            raise SystemExit('[fail] %s 序列化无法逐字节还原，拒绝写入' % os.path.basename(path))
        changed = 0
        for row in rows:
            if str(row.get('skillChainId', row.get('id'))) != str(CHAIN):
                continue
            new_raw = patch_params(row['skillParamJson']) if 'skillParamJson' in row else None
            if new_raw is not None:
                row['skillParamJson'] = new_raw
                changed += 1
                print('  %s mod=%s 参数 → %s' % (
                    os.path.basename(path), row.get('modifierId'), new_raw))
            new_desc = patch_desc(str(row.get('desc') or ''))
            if new_desc is not None:
                row['desc'] = new_desc
                changed += 1
                print('  %s 描述已改' % os.path.basename(path))
        if changed:
            with io.open(path, 'w', encoding='utf-8', newline='') as handle:
                handle.write(json.dumps(rows, ensure_ascii=False, separators=(',', ':')))
        else:
            print('  %s 已是新口径' % os.path.basename(path))

    # ── 验收 ──
    print('\n[verify]')
    for path, chain_key in ((REMOTE_PLAN, 'skillChainId'), (CLIENT_PLAN, 'skillChainId')):
        with io.open(path, encoding='utf-8') as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            keys = data['k']
            idx = {name: keys.index(name) for name in ('skillChainId', 'skillParamJson', 'desc')}
            rows = [{name: row[col] for name, col in idx.items()} for row in data['v']]
        else:
            rows = data
        hits = [row for row in rows if str(row.get(chain_key)) == str(CHAIN)]
        assert len(hits) == 3, '%s 行数变了：%d' % (path, len(hits))
        for row in hits:
            params = json.loads(row['skillParamJson']) if isinstance(row['skillParamJson'], str) \
                else row['skillParamJson']
            assert params.get('auraAtTarget') == 1, '%s 缺 auraAtTarget' % path
            assert NEW_TEXT in row['desc'], '%s 描述没改：%s' % (path, row['desc'])
    print('  pvpSkillPlan 两份：3 行 ×（auraAtTarget=1 + 新描述）通过')
    for path in (REMOTE_K, CLIENT_K):
        with io.open(path, encoding='utf-8') as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            keys = data['k']
            desc = keys.index('desc')
            chain = keys.index('id')
            texts = [row[desc] for row in data['v'] if str(row[chain]) == str(CHAIN)]
        else:
            texts = [row['desc'] for row in data if str(row.get('id')) == str(CHAIN)]
        assert len(texts) == 3, '%s 行数变了：%d' % (path, len(texts))
        assert all(NEW_TEXT in text for text in texts), '%s 描述没改全' % path
    print('  armySkillLevelUp 两份：3 行描述通过')


if __name__ == '__main__':
    main()
