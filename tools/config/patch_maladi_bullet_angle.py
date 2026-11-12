# -*- coding: utf-8 -*-
"""把麻辣铁锅 68026「孢子弹幕」的 `bulletAngle` 从 20° 收到 0°。

## 为什么

`ZCAttackResolutionSystem.createProjectiles` 的扇形语义：

    halfSpan = bulletAngle / 2
    spread   = count == 1 ? 0 : (index / (count - 1)) * 2 - 1     // -1 … +1
    heading  = aim + spread * halfSpan

`bulletNum` 在这张卡上配的是 **+1 / +1 / +2**（`skillChainId 282601`），普攻基数 1 发
⇒ 弹数是 **2 / 2 / 3**。前两档是**偶数**，`spread` 只有 −1 和 +1，
于是两发分别偏 **−10° / +10°**，**没有一发对准目标**。

实测（`tmp/diag_maladi_fan.ts`，attackRange 550 逻辑 px，目标 68001 命中圈 29 逻辑 px）：

    Lv 1 ~ Lv20   弹数 2  角度 [-10, +10]     命中 0 发  伤害 0
    Lv25 / Lv30   弹数 3  角度 [-10, 0, +10]  命中 1 发  伤害 156（应为 468）

550 逻辑 px 处横向偏 `550 × tan10° = 97` 逻辑 px，远超 29 的命中圈 —— 两发从目标两侧
飞过去，既不结算伤害也不触发受击特效。这就是「普攻穿透目标不掉血、没有受击特效」。

张角收到 0 后 `halfSpan = 0`，全部子弹走 `aim` 方向 ⇒ 任何距离都必中。

## 改哪

- `assets/remoteRef/pvpSkillPlan.json`（列存 `{k,v,c}`、**CRLF**、逐元素换行）
- `D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json`（行数组、**单行紧凑**）

两处都先拿自带序列化器跑一遍原文，**逐字节相等才允许写**。

⚠️ `97026011~13` 这三行目前**只在 JSON 里**，源表 `J-技能表.xlsx` 的「PVP技能配置」
页签还没有它们（68026 那 9 行修改器都缺），所以本脚本不碰 xlsx。

用法：
    python tools/config/patch_maladi_bullet_angle.py            # 试跑
    python tools/config/patch_maladi_bullet_angle.py --write    # 落盘
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REMOTE_JSON = os.path.join(ROOT, 'assets', 'remoteRef', 'pvpSkillPlan.json')
CLIENT_JSON = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json'

TARGET_IDS = (97026011, 97026012, 97026013)
NEW_VALUE = 0
NEW_DESC = '普攻多发的子弹同线飞出（张角 0°：偶数弹的扇形没有一发对准目标，实测全脱靶）'


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
    if isinstance(value, dict):
        items = list(value.items())
        out = ['{']
        for i, (key, val) in enumerate(items):
            sub = _dump_value(val, i < len(items) - 1)
            if len(sub) != 1:
                raise SystemExit('pvpSkillPlan 出现嵌套容器，序列化器需扩展')
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


def dump_remote(data, newline):
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
    return newline.join(lines)


def dump_client(rows):
    return json.dumps(rows, ensure_ascii=False, separators=(',', ':'))


# ---------------------------------------------------------------- 主流程

def main():
    write = '--write' in sys.argv

    remote_raw = open(REMOTE_JSON, encoding='utf-8', newline='').read()
    newline = '\r\n' if '\r\n' in remote_raw else '\n'
    remote = json.loads(remote_raw)
    if dump_remote(remote, newline) != remote_raw:
        raise SystemExit('remoteRef/pvpSkillPlan.json round-trip 不一致，拒绝写入')

    client_raw = open(CLIENT_JSON, encoding='utf-8', newline='').read()
    client = json.loads(client_raw)
    if dump_client(client) != client_raw:
        raise SystemExit('client/pvpSkillPlan.json round-trip 不一致，拒绝写入')

    keys = remote['k']
    index_of = {key: i for i, key in enumerate(keys)}
    changed = 0
    for row in remote['v']:
        if row[index_of['modifierId']] in TARGET_IDS:
            print('  %d  %s  value %s → %s' % (
                row[index_of['modifierId']], row[index_of['statId']],
                row[index_of['value']], NEW_VALUE))
            row[index_of['value']] = NEW_VALUE
            row[index_of['desc']] = NEW_DESC
            changed += 1

    changed_client = 0
    for row in client:
        if row.get('modifierId') in TARGET_IDS:
            row['value'] = NEW_VALUE
            row['desc'] = NEW_DESC
            changed_client += 1

    if changed != len(TARGET_IDS) or changed_client != len(TARGET_IDS):
        raise SystemExit('只命中 %d / %d 行，目标行可能已被改过' % (changed, changed_client))

    # 两份产物同值核对
    client_values = {row['modifierId']: row['value'] for row in client if row.get('modifierId') in TARGET_IDS}
    remote_values = {row[index_of['modifierId']]: row[index_of['value']]
                     for row in remote['v'] if row[index_of['modifierId']] in TARGET_IDS}
    if client_values != remote_values:
        raise SystemExit('两份产物不一致：%s vs %s' % (remote_values, client_values))

    print('命中 %d 行，两份产物同为 %s' % (changed, sorted(set(remote_values.values()))))

    if not write:
        print('（未写盘；加 --write 落盘）')
        return

    with open(REMOTE_JSON, 'w', encoding='utf-8', newline='') as fh:
        fh.write(dump_remote(remote, newline))
    with open(CLIENT_JSON, 'w', encoding='utf-8', newline='') as fh:
        fh.write(dump_client(client))
    print('已写入')


if __name__ == '__main__':
    main()
