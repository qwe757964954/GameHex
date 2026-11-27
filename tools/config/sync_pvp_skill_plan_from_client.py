# -*- coding: utf-8 -*-
"""把 `assets/remoteRef/pvpSkillPlan.json` 同步到转表产物（`json/client/pvpSkillPlan.json`）。

## 现场（2026-11-25 20:30）

- 设计案真源 `D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx`（11-25 17:43）
  与转表产物 client（11-25 16:21）**逐链一致**（140 条链级技能名零差异）；
- 只有 `assets/remoteRef/pvpSkillPlan.json` 停在 11-17 的快照（= SVN HEAD r1704，2209 行）：
  - 210 行 `skillName` 还是旧名（饥饿缠身 / 格挡 / 破阵术 / 腾云驾雾 …），
  - 34 条链、102 行整行缺失（68011~68027 那批卡的主动技，含 `fire_zone` / `trap_place` / `self_aura` 车道），
  - 405 行伴随改名的参数改动（`statId` / `operation` / `value` / `behaviorKey` / `skillParamJson`）也一并缺。
- 而运行期真正读的是 `remoteRef`（`RefUtil`）⇒ 游戏里这几张卡的技能名、车道、参数全是旧的，
  橙卡大招通报取 `pvpSkillPlan.skillName` 与 `behaviorKey` 建索引，于是**一条都不播**（§45.1）。

## 只做一件事

`remoteRef/pvpSkillPlan.json` := client 那份（2311 行、28 字段、键序不变）。
**不碰** `armySkillLevelUp`（已是最新，0 差异）与 `pvpCard`（除描述里的一个旧名，另见
`sync_pvp_card_desc.py`）—— 那两张表的 remoteRef 有只在线上调过的数值（§44），整表覆盖会抹掉。

## 格式

沿用 remoteRef 该表现有形态：`[` + 每行一个对象、`,\\n` 分隔、`]` 结尾、无尾换行
（**不是** `{k,v,c}` 列存 —— 该表在 SVN HEAD 里就是行对象数组，`RefUtil` 对行数组原样透传）。

## 自检

写入前先证明「按本文件的序列化方式重建 client 能得到与 client 原文**逐字节相同**的文本」，
再写 remoteRef；写完回读比对行数、键集合、逐格相等。
"""
import json
import os
import shutil
import sys
from collections import Counter

ROOT = 'D:/Alan/Project/POW'
CLIENT = f'{ROOT}/doc/塔防数据配置/json/client/pvpSkillPlan.json'
REMOTE = 'assets/remoteRef/pvpSkillPlan.json'
BACKUP_DIR = 'tmp/config_backup'


def render_rows(rows, sep):
    """单个对象的序列化口径（紧凑、不转义中文）——与转表产物逐字节同形。"""
    return '[' + sep.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in rows) + ']'


def dump(rows):
    """remoteRef 该表的排版：`[` + 每行一个对象 + `,\\n` + `]`，无尾换行。"""
    return render_rows(rows, ',\n')


def identity(row):
    """行身份：一张卡的一条链的一档（与 `tests/zcds-model` 的 `modifierId` 键等价，这里按业务键更好读）。"""
    return (str(row.get('unitId')), str(row.get('skillChainId')), row.get('skillLevel'))


def main():
    client_raw = open(CLIENT, encoding='utf-8').read()
    client = json.loads(client_raw)
    remote_raw = open(REMOTE, encoding='utf-8').read()
    remote = json.loads(remote_raw)

    # 自检：序列化方式必须能逐字节还原 client 原文（client 是单行、无分隔换行），
    # 否则说明「我加工过数据」，写出去的就不是转表产物了。
    if render_rows(client, ',') != client_raw:
        raise SystemExit('[fail] 序列化自检失败：重建文本与 client 原文不一致，拒绝写入')
    print(f'[ok] 序列化自检通过（{len(client)} 行 / {len(client_raw)} 字节）')

    if len(json.loads(remote_raw)) == len(client) and remote_raw == dump(client):
        print('[skip] remoteRef 已是最新，无需写入')
        return

    ck = {identity(r): r for r in client}
    rk = {identity(r): r for r in remote}
    only_c = sorted(set(ck) - set(rk))
    only_r = sorted(set(rk) - set(ck))
    fields = Counter()
    renamed = []
    for key in set(ck) & set(rk):
        a, b = rk[key], ck[key]
        for f in set(a) | set(b):
            if a.get(f) != b.get(f):
                fields[f] += 1
        if a.get('skillName') != b.get('skillName'):
            renamed.append((key, a.get('skillName'), b.get('skillName')))

    print(f'[plan] 现状 {len(remote)} 行 → 目标 {len(client)} 行')
    print(f'[plan] 新增 {len(only_c)} 行 / 只存在于 remote 的 {len(only_r)} 行')
    print(f'[plan] 改名 {len(renamed)} 行；其它字段差异：' + '、'.join(f'{k}×{v}' for k, v in fields.most_common()))
    for key, old, new in sorted(renamed)[:12]:
        print(f'    {key[0]} {key[1]}#{key[2]}  {old} → {new}')
    if len(renamed) > 12:
        print(f'    … 其余 {len(renamed) - 12} 行')

    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = f'{BACKUP_DIR}/pvpSkillPlan.20261125-2030.json'
    if not os.path.exists(backup):
        shutil.copyfile(REMOTE, backup)
        print(f'[backup] {backup}')

    with open(REMOTE, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(dump(client))

    # 回读校验
    after = json.load(open(REMOTE, encoding='utf-8'))
    if len(after) != len(client):
        raise SystemExit(f'[fail] 行数不符：{len(after)} != {len(client)}')
    if {identity(r) for r in after} != set(ck):
        raise SystemExit('[fail] 行集合不符')
    drift = 0
    for row in after:
        target = ck[identity(row)]
        if {k: row.get(k) for k in set(row) | set(target)} != {k: target.get(k) for k in set(row) | set(target)}:
            drift += 1
    if drift:
        raise SystemExit(f'[fail] 逐格比对有 {drift} 行不一致')
    print(f'[ok] 写入完成：{len(after)} 行，行集合与逐格内容均与 client 一致')

    left = sorted({n for n in ({r.get('skillName') for r in remote} - {r.get('skillName') for r in client})
                   if any(n in (r.get('desc') or '') for r in after)})
    if left:
        print('[warn] 新表 desc 里仍含旧技能名（来自 client 原文，本脚本不擅自改写）：' + '、'.join(left))


if __name__ == '__main__':
    sys.exit(main())
