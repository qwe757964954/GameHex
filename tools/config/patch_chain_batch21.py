# -*- coding: utf-8 -*-
"""闪电链 102203 第二版（2026-11-19 第 21 批）：传导上限 3/4/6 → **4/6/8**。

用户原话：
> 卡牌发射的射线接触到目标1后，产生1个150px的圆形判定范围（绿色），范围内有其他目标敌人
> （又会产生1个目标2为圆心的判定范围），就会被判定为传导，最多传导给4/6/8 个敌人，
> 范围内没有目标就不会被传导，（受击目标数达到上限也不会再传导）

口径
────
· 「最多传导给 4/6/8 个敌人」= **受击目标总数**的上限（含射线打到的目标 1）——
  用户同一句里紧跟着的就是「受击目标数达到上限也不会再传导」，上限数的是「受击目标数」，
  不是「额外弹射几个」。所以 `chainTargetCount` 直接从 3/4/6 改成 4/6/8；
· `chainJumpRadius` **仍然是 150**，只是语义从「跳到最近目标的距离」变成
  「以每个已命中目标为圆心的判定半径」。数值一个字节都不用动；
· 伤害倍率 / 递减 / 终跳必暴 / 冷却**全部不动**（这一批只改「能打到几个、怎么算够得着」）。

改哪些格子
──────────
1. `pvpSkillPlan` 两份（remoteRef 列存 + client 行对象）：`chainTargetCount` 与 `desc`；
2. `armySkillLevelUp` 两份：`desc`（卡牌 UI 真读的是这张表）；
3. 源表 `K-卡牌升级.xlsx` 的 `xl/worksheets/sheet2.xml`（卡牌技能升级表）——三行 desc 是
   `t="inlineStr"` 的内联文本，直接按「旧整句 → 新整句」替换，替换条数必须正好 3 条。

🔴 幂等靠「按 skillLevel 定目标值」，而不是「把 3 换成 4」：
   3→4 之后，4 又是 II 级的起点，按值替换第二遍就会把 I 级再推到 6。
   所以每个档位写死自己的目标数（I=4 / II=6 / III=8），当前值等于目标值就跳过。

用法：python tools/config/patch_chain_batch21.py
"""
import io
import json
import os
import re
import shutil
import zipfile
from datetime import datetime

ROOT = 'D:/Alan/Project/POW'
REMOTE_PLAN = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef', 'pvpSkillPlan.json')
CLIENT_PLAN = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client', 'pvpSkillPlan.json')
REMOTE_K = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef', 'armySkillLevelUp.json')
CLIENT_K = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client', 'armySkillLevelUp.json')
K_XLSX = os.path.join(ROOT, 'doc', '塔防数据配置', 'K-卡牌升级.xlsx')
K_MEMBER = 'xl/worksheets/sheet2.xml'          # 卡牌技能升级表
BACKUP_DIR = os.path.join(ROOT, 'Demo3.8', 'tmp', 'config_backup')

CHAIN = 102203
#  档位 → 受击目标总数上限（含目标 1）。三档都写死，方便幂等比对。
TARGET_COUNT = {1: 4, 2: 6, 3: 8}
#  🔴 K 表 sheet2 的 D 列是**兵种解锁等级**（9/18/27），不是 1/2/3 档位号。
UNLOCK_TO_LEVEL = {9: 1, 18: 2, 27: 3}

COUNT_PATTERN = re.compile(r'连锁命中 (\d+) 个敌人')


def dumps_params(params):
    return json.dumps(params, ensure_ascii=False, separators=(',', ':'))


def patch_params(raw, level):
    """把 `chainTargetCount` 改成该档的目标值；已经是目标值就返回 None。"""
    params = json.loads(raw)
    want = TARGET_COUNT[level]
    if params.get('chainTargetCount') == want:
        return None
    rebuilt = {}
    for key, value in params.items():
        rebuilt[key] = want if key == 'chainTargetCount' else value
    if 'chainTargetCount' not in rebuilt:
        rebuilt['chainTargetCount'] = want
    return dumps_params(rebuilt)


def patch_desc(text, level):
    """把「连锁命中 N 个敌人」里的 N 换成该档的目标值；本来就是就返回 None。"""
    if not text:
        return None
    want = TARGET_COUNT[level]
    match = COUNT_PATTERN.search(text)
    if not match:
        return None
    if int(match.group(1)) == want:
        return None
    return COUNT_PATTERN.sub('连锁命中 %d 个敌人' % want, text, count=1)


def read_text(path):
    with io.open(path, encoding='utf-8', newline='') as handle:
        return handle.read()


def write_text(path, text):
    with io.open(path, 'w', encoding='utf-8', newline='') as handle:
        handle.write(text)


def main():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    for path in (REMOTE_PLAN, CLIENT_PLAN, REMOTE_K, CLIENT_K):
        shutil.copy2(path, os.path.join(
            BACKUP_DIR, '%s.chain21-%s' % (os.path.basename(path), stamp)))

    # ── pvpSkillPlan 两份（remoteRef 列存）──
    raw = read_text(REMOTE_PLAN)
    data = json.loads(raw)
    if json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':')).replace('\n', '\r\n') != raw:
        raise SystemExit('[fail] remoteRef/pvpSkillPlan.json 序列化无法逐字节还原，拒绝写入')
    keys = data['k']
    chain = keys.index('skillChainId')
    level_col = keys.index('skillLevel')
    param_col = keys.index('skillParamJson')
    desc_col = keys.index('desc')
    changed = 0
    for row in data['v']:
        if str(row[chain]) != str(CHAIN):
            continue
        level = int(row[level_col])
        new_raw = patch_params(row[param_col], level)
        if new_raw is not None:
            row[param_col] = new_raw
            changed += 1
            print('  [remoteRef] L%d 参数 → %s' % (level, new_raw))
        new_desc = patch_desc(row[desc_col], level)
        if new_desc is not None:
            row[desc_col] = new_desc
            changed += 1
            print('  [remoteRef] L%d 描述 → %s' % (level, new_desc))
    if changed:
        write_text(REMOTE_PLAN, json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
                   .replace('\n', '\r\n'))
    else:
        print('  [remoteRef] 已是新口径')

    # ── pvpSkillPlan 两份（client 行对象）──
    raw = read_text(CLIENT_PLAN)
    rows = json.loads(raw)
    if json.dumps(rows, ensure_ascii=False, separators=(',', ':')) != raw:
        raise SystemExit('[fail] client/pvpSkillPlan.json 序列化无法逐字节还原，拒绝写入')
    changed = 0
    for row in rows:
        if str(row.get('skillChainId')) != str(CHAIN):
            continue
        level = int(row['skillLevel'])
        new_raw = patch_params(row['skillParamJson'], level)
        if new_raw is not None:
            row['skillParamJson'] = new_raw
            changed += 1
            print('  [client] L%d 参数 → %s' % (level, new_raw))
        new_desc = patch_desc(str(row.get('desc') or ''), level)
        if new_desc is not None:
            row['desc'] = new_desc
            changed += 1
            print('  [client] L%d 描述 → %s' % (level, new_desc))
    if changed:
        write_text(CLIENT_PLAN, json.dumps(rows, ensure_ascii=False, separators=(',', ':')))
    else:
        print('  [client] 已是新口径')

    # ── armySkillLevelUp 两份（只改描述）──
    for path, label in ((REMOTE_K, 'remoteRef'), (CLIENT_K, 'client')):
        raw = read_text(path)
        data = json.loads(raw)
        if isinstance(data, dict):
            keys = data['k']
            chain = keys.index('id')
            level_col = keys.index('skilllevel')
            desc_col = keys.index('desc')
            target_rows = [row for row in data['v'] if str(row[chain]) == str(CHAIN)]
        else:
            target_rows = [row for row in data if str(row.get('id')) == str(CHAIN)]
        changed = 0
        for row in target_rows:
            level = int(row[level_col] if isinstance(data, dict) else row['skilllevel'])
            current = row[desc_col] if isinstance(data, dict) else row['desc']
            new_desc = patch_desc(str(current or ''), level)
            if new_desc is None:
                continue
            if isinstance(data, dict):
                row[desc_col] = new_desc
            else:
                row['desc'] = new_desc
            changed += 1
            print('  [%s] armySkillLevelUp L%d 描述已改' % (label, level))
        if not changed:
            print('  [%s] armySkillLevelUp 已是新口径' % label)
            continue
        if isinstance(data, dict):
            write_text(path, json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':'))
                       .replace('\n', '\r\n'))
        else:
            write_text(path, json.dumps(data, ensure_ascii=False, separators=(',', ':')))

    # ── 源表 K-卡牌升级.xlsx（sheet2 卡牌技能升级表，inlineStr 整句替换）──
    with zipfile.ZipFile(K_XLSX) as source:
        xml = source.read(K_MEMBER).decode('utf-8')
    #  只在该行的描述格「连锁命中 N 个敌人」这一小段上替换，句子其余部分（倍率 / 递减 /
    #  终跳必暴）逐字保留。档位取同一行 D 列的缓存值（skilllevel）。
    #  从后往前改，前面行的偏移量才不会失效。
    row_pattern = re.compile(r'<c r="A(\d+)"[^>]*>\s*<v>102203</v>', re.S)
    edits = []
    for match in row_pattern.finditer(xml):
        row_number = match.group(1)
        start = match.start()
        end = xml.find('</row>', start)
        block = xml[start:end]
        desc = COUNT_PATTERN.search(block)
        if not desc:
            continue
        level_match = re.search(r'<c r="D%s"[^>]*>.*?<v>(\d+)</v>' % row_number, block, re.S)
        if not level_match:
            continue
        level = UNLOCK_TO_LEVEL.get(int(level_match.group(1)))
        if level is None:
            continue
        want = TARGET_COUNT[level]
        if int(desc.group(1)) == want:
            continue
        new_block = COUNT_PATTERN.sub('连锁命中 %d 个敌人' % want, block, count=1)
        edits.append((start, end, new_block, row_number, level))
    for start, end, new_block, row_number, level in reversed(edits):
        xml = xml[:start] + new_block + xml[end:]
        print('  [xlsx] K 表第 %s 行（L%d）描述已改' % (row_number, level))
    if edits:
        shutil.copy2(K_XLSX, os.path.join(BACKUP_DIR, 'K-卡牌升级.xlsx.chain21-%s' % stamp))
        tmp = K_XLSX + '.tmp'
        with zipfile.ZipFile(K_XLSX) as source, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as target:
            for info in source.infolist():
                payload = source.read(info.filename)
                if info.filename == K_MEMBER:
                    payload = xml.encode('utf-8')
                target.writestr(info, payload)
        os.replace(tmp, K_XLSX)
        print('  [xlsx] K 表写入 %d 行' % len(edits))
    else:
        print('  [xlsx] K 表已是新口径')

    # ── 验收 ──
    print('\n[verify]')
    for path, chain_key in ((REMOTE_PLAN, 'skillChainId'), (CLIENT_PLAN, 'skillChainId')):
        data = json.loads(read_text(path))
        if isinstance(data, dict):
            keys = data['k']
            plan_rows = [dict(zip(keys, row)) for row in data['v']
                         if str(row[keys.index(chain_key)]) == str(CHAIN)]
        else:
            plan_rows = [row for row in data if str(row.get(chain_key)) == str(CHAIN)]
        assert len(plan_rows) == 3, '%s 行数变了：%d' % (path, len(plan_rows))
        for row in sorted(plan_rows, key=lambda item: int(item['skillLevel'])):
            level = int(row['skillLevel'])
            params = json.loads(row['skillParamJson'])
            assert params['chainTargetCount'] == TARGET_COUNT[level], \
                '%s L%d chainTargetCount=%s' % (path, level, params['chainTargetCount'])
            assert params['chainJumpRadius'] == 150, '%s L%d 传导半径必须仍是 150' % (path, level)
            assert COUNT_PATTERN.search(row['desc']).group(1) == str(TARGET_COUNT[level]), \
                '%s L%d 描述没改：%s' % (path, level, row['desc'])
        print('  %s：3 档 ×（4/6/8 + 150 半径 + 新描述）通过' % os.path.basename(path))

    plan = json.loads(read_text(CLIENT_PLAN))
    want_desc = {
        int(row['skillLevel']): row['desc'] for row in plan if str(row.get('skillChainId')) == str(CHAIN)
    }
    for path in (REMOTE_K, CLIENT_K):
        data = json.loads(read_text(path))
        if isinstance(data, dict):
            keys = data['k']
            rows = [dict(zip(keys, row)) for row in data['v'] if str(row[keys.index('id')]) == str(CHAIN)]
        else:
            rows = [row for row in data if str(row.get('id')) == str(CHAIN)]
        assert len(rows) == 3, '%s 行数变了：%d' % (path, len(rows))
        for row in rows:
            level = int(row['skilllevel'])
            assert row['desc'] == want_desc[level], \
                '%s L%d 描述与 pvpSkillPlan 不一致：%s' % (path, level, row['desc'])
        print('  %s：3 档描述与 pvpSkillPlan 逐字一致' % os.path.basename(path))

    with zipfile.ZipFile(K_XLSX) as source:
        sheet = source.read(K_MEMBER).decode('utf-8')
    seen = {}
    for match in row_pattern.finditer(sheet):
        row_number = match.group(1)
        block = sheet[match.start():sheet.find('</row>', match.start())]
        desc = COUNT_PATTERN.search(block)
        level_match = re.search(r'<c r="D%s"[^>]*>.*?<v>(\d+)</v>' % row_number, block, re.S)
        if not desc or not level_match:
            continue
        level = UNLOCK_TO_LEVEL.get(int(level_match.group(1)))
        if level is not None:
            seen[level] = int(desc.group(1))
    for level, want in TARGET_COUNT.items():
        assert seen.get(level) == want, 'K 表源表 L%d 是 %s，应为 %d' % (level, seen.get(level), want)
    print('  K 表源表：4/6/8 三档都在')


if __name__ == '__main__':
    main()
