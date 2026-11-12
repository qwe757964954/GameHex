# -*- coding: utf-8 -*-
"""麻辣铁锅 102603「喷射火焰」：触发距离由**特效全长**定，火焰从角色头部喷出。

## 为什么

用户 2026-11-11 第五轮口径：

> 「喷火技能的位置还是不正确，如果是目标距离的问题，根据特效的最长像素作为触发该技能的实际距离，
>   并把触发距离补充到技能描述中，特效的起始位置在角色的头部（绿框位置对准）」

上一版（第四轮）把特效**拉伸**到 `auraForward 350 + 半径 50 = 400 逻辑 px`，尾部按本地坐标
钉在 +45 屏上 px。两个问题叠在一起：

1. **拉伸换来的长度是虚的** —— 只要「可见并集」的量法差一点，尾巴就离开角色一大截；
2. 🔴 **本地 y 会被旋转成侧移** —— 宿主节点每帧 `setRotationFromEuler(朝向)`，
   `_lpos` 是子节点本地坐标，local +y 在朝右下时会变成「垂直于火焰的偏移」。
   所以只有「正中朝右」那一次看起来是对的，其它朝向尾巴都会飘走 —— 这正是截图里的样子。

## 现在（2026-11-12 第八轮定稿）

- 尾部取**稳态尾部**（各帧可见左缘的中位，源 x=238），稳态可见长度 421 源 px = 210.5 画布 px；
- 🔴 **触发距离由用户定死 350 表值 px**（< 普攻 `unitAttackRange 550`，折后 495）：
  用户口径「触发距离应该小于普通攻击的距离，和特效的 350px 范围相匹配，
  只有敌人处于 350px 这个距离才会被攻击」；
- 缩放**反算**成「可见长度 = 350」：`350 × 0.76875 ÷ 210.5 = 1.278207`
  （第五轮是反向的「长度定距离」⇒ 274，敌人站 300 时空放，见下）；
- 🔴 **判定形状改矩形**（用户口径「改矩形：加 auraRectHalfHeight（半长跟随 auraRadius），
  像磁电冲击 101604 那样做成从脚点到 350 的锥/矩形」）：
  `auraRadius = 175`（同时就是半长，缺省跟随）、`auraForward = 175` ⇒ 沿朝向覆盖 **0~350**、
  `auraRectHalfHeight = 70` ⇒ 宽 140（量出来火焰垂直于朝向的可见厚度约 145 表值）；
  圆改矩形是为了消掉「贴脸 <250 打不到」的盲区（第七轮的圆是 250~350）；
- 新增 `auraTriggerRange = 350`：最近目标还在 350 之外 ⇒ **待触发、不消费 CD**
  （`ZCSkillTriggerSystem.applySelfAura` 的第三道闸门）；
- ⚠️ 第五轮曾锚「全序列可见并集左缘 68」⇒ 384/334。那撮起势火苗只占 2/39 帧，
  锚上去等于让 95% 时长的火焰实体退到角色身后 85 屏上 px —— 即用户报的「目标在右侧时离角色 60px」。
- ⚠️ 第六轮曾把触发距离收到 274（由长度反推），但普攻闸门仍是 550，
  敌人站 280~350 时技能会放、火焰够不到。
- ⚠️ 第七轮是「身前 300 处直径 100 的圆」（250~350），贴脸 <250 打不到，故第八轮改矩形。
- 尾部本地坐标钉 `(−auraForward, 0)`（`build_maladi_guo_fx.py` 算），**竖直方向交给
  `auraVisualLiftPx`**（视图层在 `mapToViewY` 之后加，屏幕竖直、不跟旋转）；
- `auraVisualLiftPx = 97` = 一个兵可见高 67（`ZCCombatEffectPlacement` 既有口径）
  + 30（`casterLiftPx` 施法抬升；抬升挂在地面区域上，与火焰同寿，全程都在）。

## 三写

`assets/remoteRef/pvpSkillPlan.json`（列存 + CRLF）、
`D:/Alan/Project/POW/doc/塔防数据配置/json/client/pvpSkillPlan.json`（单行紧凑）。
两份都先跑 round-trip 逐字节自检，不一致就拒绝写入。

**描述有两份，都要改**（`docs §15`）：`pvpSkillPlan.desc` 是给人看的，
卡片 UI 真正读的是 **`armySkillLevelUp.desc`**（`CardSkillDescMarkup`）——
只改前者，玩家看到的还是「身前 350px」。所以这里连 K 表一起改。

用法：
    python tools/config/patch_maladi_spray_range.py            # 试跑
    python tools/config/patch_maladi_spray_range.py --write    # 落盘
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CLIENT_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client'
REMOTE_JSON = os.path.join(ROOT, 'assets', 'remoteRef', 'pvpSkillPlan.json')
CLIENT_JSON = os.path.join(CLIENT_DIR, 'pvpSkillPlan.json')
REMOTE_ARMY = os.path.join(ROOT, 'assets', 'remoteRef', 'armySkillLevelUp.json')
CLIENT_ARMY = os.path.join(CLIENT_DIR, 'armySkillLevelUp.json')

TARGET_IDS = (94026031, 94026032, 94026033)
#  K 表里 102603 的三行（按 `id` + `skilllevel` 定位，不用行号）。
ARMY_CHAIN_ID = 102603
#  🔴 2026-11-12 第八轮：判定从「身前 300 处直径 100 的圆」改成**矩形**（用户口径「改矩形：
#  加 auraRectHalfHeight（半长跟随 auraRadius），像磁电冲击 101604 那样做成从脚点到 350 的锥/矩形」）。
#  矩形沿朝向覆盖 `auraForward ± auraRadius` ⇒ 要让左边缘正好落在脚点（0）、右边缘落在 350：
AURA_RADIUS = 175           # 半长（表值 px）；半长缺省跟随 radius，所以 = auraRadius
AURA_FORWARD = 175          # 中心前移 = 350 − 175 ⇒ 覆盖 0~350
AURA_RECT_HALF_HEIGHT = 70  # 半宽（表值 px）⇒ 宽 140；量出来火焰垂直于朝向的可见厚度约 145
AURA_VISUAL_LIFT = 97       # 67(一个兵可见高) + 30(casterLiftPx)
REACH_LOGIC = 350           # 用户 2026-11-12：小于普攻 495、与特效长度对齐
AURA_TRIGGER_RANGE = 350    # 最近目标还在这个表值 px 之外 ⇒ 待触发，不消费 CD


def desc_of(rate):
    return ('冷却 12 秒：跳起朝目标方向喷出火焰柱（起点在角色头部），持续 3 秒、'
            '每秒对身前 0~%dpx 的矩形（宽 %d）内所有敌人造成 %d%% 攻击力伤害'
            '（触发距离 %dpx：敌人进入 %dpx 内才会释放，与火焰特效等长）'
            % (REACH_LOGIC, AURA_RECT_HALF_HEIGHT * 2, round(rate * 100),
               REACH_LOGIC, AURA_TRIGGER_RANGE))


ARMY_RATE_TEXT = {1: '120%', 2: '150%', 3: '200%'}


def army_desc_of(level):
    """K 表那份（卡片 UI 读它）：沿用原文案的紧排风格，只换判定形状并补触发距离。"""
    return ('冷却12秒：跳起向前喷出火焰柱（起点在角色头部），持续3秒、'
            '每秒对身前0~%dpx的矩形（宽%d）内所有敌人造成%s伤害'
            '（触发距离%dpx：敌人进入%dpx内才会释放，与火焰特效等长）'
            % (REACH_LOGIC, AURA_RECT_HALF_HEIGHT * 2, ARMY_RATE_TEXT[level],
               REACH_LOGIC, AURA_TRIGGER_RANGE))


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


# ---------------------------------------------------------------- armySkillLevelUp 序列化器

def _emit_per_line(value):
    """把一个标量 / 数组展开成多行（不含尾逗号）。`modfiy` 这类嵌套数组也逐元素占一行。"""
    if isinstance(value, list):
        if not value:
            #  转表把空数组压成一行 `[]`，不拆成两行。
            return ['[]']
        out = ['[']
        for i, item in enumerate(value):
            sub = _emit_per_line(item)
            if i < len(value) - 1:
                sub[-1] += ','
            out.extend(sub)
        out.append(']')
        return out
    return [_scalar(value)]


def dump_column_store_per_line(data, newline):
    """`armySkillLevelUp` 的转表排版：**每个标量独占一行**（与 `pvpSkillPlan` 的逐行数组不同）。"""
    lines = ['{', '"k":[']
    keys = data['k']
    for i, key in enumerate(keys):
        lines.append('"%s"%s' % (key, ',' if i < len(keys) - 1 else ''))
    lines.append('],')
    lines.append('"v":[')
    rows = data['v']
    for ri, row in enumerate(rows):
        lines.append('[')
        for ci, value in enumerate(row):
            sub = _emit_per_line(value)
            if ci < len(row) - 1:
                sub[-1] += ','
            lines.extend(sub)
        lines.append('],' if ri < len(rows) - 1 else ']')
    lines.append('],')
    lines.append('"c":%s' % data['c'])
    lines.append('}')
    return newline.join(lines)


def dump_client_army(rows):
    with open(CLIENT_ARMY, encoding='utf-8', newline='') as fh:
        raw = fh.read()
    text = json.dumps(rows, ensure_ascii=False, indent=2)
    return text + ('\n' if raw.endswith('\n') else '')


#  `skillParamJson` 的键序跟 `patch_maladi_guo.js` 对齐 —— 一个键是字符串字段，
#  顺序不影响语义，但两边不一致会让「跑哪个脚本」留下不同的字节，对拍时全是噪音。
PARAM_KEY_ORDER = ('auraCooldown', 'auraSeconds', 'auraInterval', 'auraRadius', 'auraDamageRate',
                   'auraForward', 'auraTriggerRange', 'auraRectHalfHeight', 'auraVisualLiftPx',
                   'auraFollow', 'casterLiftPx', 'auraFaceTarget')


def patch_params(raw_text):
    params = json.loads(raw_text)
    #  判定改成矩形：半长跟着 `auraRadius`（175），半宽由 `auraRectHalfHeight` 给。
    params['auraRadius'] = AURA_RADIUS
    params['auraForward'] = AURA_FORWARD
    params['auraRectHalfHeight'] = AURA_RECT_HALF_HEIGHT
    #  触发距离上限（表值逻辑 px）：最近敌人还在它外面 ⇒ 待触发、不消费 CD。
    params['auraTriggerRange'] = AURA_TRIGGER_RANGE
    #  竖直播放在视图层补（`mapToViewY` 之后）——写进 prefab `_lpos.y` 会被旋转成侧移。
    params['auraVisualLiftPx'] = AURA_VISUAL_LIFT
    ordered = {key: params[key] for key in PARAM_KEY_ORDER if key in params}
    ordered.update({key: value for key, value in params.items() if key not in ordered})
    return ordered


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

    index_of = {key: i for i, key in enumerate(remote['k'])}
    touched = 0
    for row in remote['v']:
        if row[index_of['modifierId']] not in TARGET_IDS:
            continue
        params = patch_params(row[index_of['skillParamJson']])
        row[index_of['skillParamJson']] = json.dumps(params, ensure_ascii=False, separators=(',', ':'))
        row[index_of['desc']] = desc_of(params['auraDamageRate'])
        print('  %d  auraForward=%d  lift=%d  %s' % (
            row[index_of['modifierId']], params['auraForward'], params['auraVisualLiftPx'],
            row[index_of['desc']][:34] + '…'))
        touched += 1

    touched_client = 0
    for row in client:
        if row.get('modifierId') not in TARGET_IDS:
            continue
        params = patch_params(row['skillParamJson'])
        row['skillParamJson'] = json.dumps(params, ensure_ascii=False, separators=(',', ':'))
        row['desc'] = desc_of(params['auraDamageRate'])
        touched_client += 1

    if touched != 3 or touched_client != 3:
        raise SystemExit('只命中 %d / %d 行' % (touched, touched_client))

    #  ── K 表（卡片 UI 真正读的那份描述）──
    army_raw = open(REMOTE_ARMY, encoding='utf-8', newline='').read()
    army_nl = '\r\n' if '\r\n' in army_raw else '\n'
    army = json.loads(army_raw)
    if dump_column_store_per_line(army, army_nl) != army_raw:
        raise SystemExit('remoteRef/armySkillLevelUp.json round-trip 不一致，拒绝写入')
    army_client_raw = open(CLIENT_ARMY, encoding='utf-8', newline='').read()
    army_client = json.loads(army_client_raw)
    if dump_client_army(army_client) != army_client_raw:
        raise SystemExit('client/armySkillLevelUp.json round-trip 不一致，拒绝写入')

    army_index = {key: i for i, key in enumerate(army['k'])}
    army_touched = 0
    for row in army['v']:
        if row[army_index['id']] != ARMY_CHAIN_ID:
            continue
        level = row[army_index['skilllevel']]
        row[army_index['desc']] = army_desc_of(level)
        print('  K表 %d L%d  %s' % (ARMY_CHAIN_ID, level, row[army_index['desc']][:40] + '…'))
        army_touched += 1

    army_client_touched = 0
    for row in army_client:
        if row.get('id') != ARMY_CHAIN_ID:
            continue
        row['desc'] = army_desc_of(row['skilllevel'])
        army_client_touched += 1

    if army_touched != 3 or army_client_touched != 3:
        raise SystemExit('K 表只命中 %d / %d 行' % (army_touched, army_client_touched))

    if not write:
        print('（未写盘；加 --write 落盘）')
        return

    with open(REMOTE_JSON, 'w', encoding='utf-8', newline='') as fh:
        fh.write(dump_remote(remote, newline))
    with open(CLIENT_JSON, 'w', encoding='utf-8', newline='') as fh:
        fh.write(dump_client(client))
    with open(REMOTE_ARMY, 'w', encoding='utf-8', newline='') as fh:
        fh.write(dump_column_store_per_line(army, army_nl))
    with open(CLIENT_ARMY, 'w', encoding='utf-8', newline='') as fh:
        fh.write(dump_client_army(army_client))
    print('已写入')


if __name__ == '__main__':
    main()
