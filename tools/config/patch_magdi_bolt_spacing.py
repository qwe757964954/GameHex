# -*- coding: utf-8 -*-
"""68016 五雷轰顶：让「一道一道落」看得见 —— 间距 45 → 60px、逐道间隔 0.18 → 0.15s。

## 为什么

用户 2026-11-12 口径：

> 「68016 的五雷轰顶还是技能效果还是没有做出明显的出现时间间隔差异，和距离间隔，
>   增加每道落雷的间隔 15px，每道特效播放时间间隔 0.15s」

上一轮（45px / 0.18s）不够明显，原因是**两个量都被别的东西盖住了**：

- `boltSpacing` 是**表值逻辑 px**，进模型要 × `combatDistanceScale 0.3`、进视图再 × 2.5625
  ⇒ 45 表值 px 在屏幕上只有 **34.6px**；而一道雷的特效本身有 193×231 屏上 px
  ⇒ 五个落点几乎完全叠在一起，读不出「排开」；
- `boltInterval 0.18s` 比特效自身时长（`ZC_BOLT_EFFECT_SECONDS` 0.667s）短得多，
  前一道还没消散后一道就来了，叠成一团亮。

所以按用户给的新值：`boltSpacing = 60`（屏上 46.1px）、`boltInterval = 0.15`。
`boltDelay` **不动**（0.15 = 特效第 5 帧的判伤锚点，与逐道间隔是两件事，改它会把判伤打早/打晚）。

## 三写

`pvpSkillPlan` 的 `skillParamJson` + `desc`，`armySkillLevelUp` 的 `desc`，
两个目录各一份（`assets/remoteRef` 列存 + `doc/塔防数据配置/json/client`），共四份文件。
每份先跑 round-trip 逐字节自检，不一致就拒绝写入。

用法：
    python tools/config/patch_magdi_bolt_spacing.py            # 试跑
    python tools/config/patch_magdi_bolt_spacing.py --write    # 落盘
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CLIENT_DIR = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client'
REMOTE_PLAN = os.path.join(ROOT, 'assets', 'remoteRef', 'pvpSkillPlan.json')
CLIENT_PLAN = os.path.join(CLIENT_DIR, 'pvpSkillPlan.json')
REMOTE_ARMY = os.path.join(ROOT, 'assets', 'remoteRef', 'armySkillLevelUp.json')
CLIENT_ARMY = os.path.join(CLIENT_DIR, 'armySkillLevelUp.json')

TARGET_IDS = (94016031, 94016032, 94016033)
BOLT_SPACING = 60        # 表值逻辑 px（屏上 ×0.76875 = 46.1px）
BOLT_INTERVAL = 0.15     # 逐道出现间隔（秒）
ARMY_CHAIN_ID = 101603

#  `skillParamJson` 的键序跟 `patch_magdi_mushroom.js` 一致 —— 顺序不影响语义，
#  但两边不一致会让「跑哪个脚本」留下不同字节，对拍全是噪音。
PARAM_KEY_ORDER = ('boltCooldown', 'boltCount', 'boltSpacing', 'boltInterval', 'boltDelay',
                   'boltDamageRate', 'boltRadius', 'boltNumbChance', 'boltNumbSeconds')

ARMY_RATE_TEXT = {1: '160%', 2: '200%', 3: '250%'}
ARMY_EXTRA_TEXT = {1: '2', 2: '3', 3: '4'}


def plan_desc_of(level, rate):
    return ('冷却 12 秒：对锁定目标释放 1 道雷电，并沿其背朝向再落 %s 道'
            '（每道间隔 %dpx、逐道间隔 %s 秒），每道造成 %d%% 攻击力伤害，'
            '每道独立判定 30%% 概率使目标麻痹 3 秒（只禁攻击、移速 −50%%）'
            % (ARMY_EXTRA_TEXT[level], BOLT_SPACING,
               ('%g' % BOLT_INTERVAL), round(rate * 100)))


def army_desc_of(level):
    return ('冷却12秒：对目标释放1道雷电并沿其背朝向再落%s道'
            '（每道间隔%dpx、出现间隔%g秒），每道造成%s伤害，30%%概率使目标麻痹3秒'
            % (ARMY_EXTRA_TEXT[level], BOLT_SPACING, BOLT_INTERVAL, ARMY_RATE_TEXT[level]))


# ---------------------------------------------------------------- 序列化器

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
        out = ['{']
        for key, val in value.items():
            sub = _dump_value(val, False)
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


def dump_remote_plan(data, newline):
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


def dump_client_plan(rows):
    return json.dumps(rows, ensure_ascii=False, separators=(',', ':'))


def _emit_per_line(value):
    if isinstance(value, list):
        if not value:
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


def dump_remote_army(data, newline):
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


def dump_client_army(rows, raw):
    text = json.dumps(rows, ensure_ascii=False, indent=2)
    return text + ('\n' if raw.endswith('\n') else '')


def patch_params(raw_text):
    params = json.loads(raw_text)
    params['boltSpacing'] = BOLT_SPACING
    params['boltInterval'] = BOLT_INTERVAL
    ordered = {key: params[key] for key in PARAM_KEY_ORDER if key in params}
    ordered.update({key: value for key, value in params.items() if key not in ordered})
    return ordered


def main():
    write = '--write' in sys.argv

    plan_raw = open(REMOTE_PLAN, encoding='utf-8', newline='').read()
    plan_nl = '\r\n' if '\r\n' in plan_raw else '\n'
    plan = json.loads(plan_raw)
    if dump_remote_plan(plan, plan_nl) != plan_raw:
        raise SystemExit('remoteRef/pvpSkillPlan.json round-trip 不一致，拒绝写入')
    cplan_raw = open(CLIENT_PLAN, encoding='utf-8', newline='').read()
    cplan = json.loads(cplan_raw)
    if dump_client_plan(cplan) != cplan_raw:
        raise SystemExit('client/pvpSkillPlan.json round-trip 不一致，拒绝写入')

    index = {key: i for i, key in enumerate(plan['k'])}
    touched = 0
    for row in plan['v']:
        if row[index['modifierId']] not in TARGET_IDS:
            continue
        params = patch_params(row[index['skillParamJson']])
        row[index['skillParamJson']] = json.dumps(params, ensure_ascii=False, separators=(',', ':'))
        level = row[index['skillLevel']]
        row[index['desc']] = plan_desc_of(level, params['boltDamageRate'])
        print('  %d L%s  间距 %dpx / 逐道 %gs' % (
            row[index['modifierId']], level, params['boltSpacing'], params['boltInterval']))
        touched += 1

    touched_client = 0
    for row in cplan:
        if row.get('modifierId') not in TARGET_IDS:
            continue
        params = patch_params(row['skillParamJson'])
        row['skillParamJson'] = json.dumps(params, ensure_ascii=False, separators=(',', ':'))
        row['desc'] = plan_desc_of(row['skillLevel'], params['boltDamageRate'])
        touched_client += 1

    if touched != 3 or touched_client != 3:
        raise SystemExit('pvpSkillPlan 只命中 %d / %d 行' % (touched, touched_client))

    army_raw = open(REMOTE_ARMY, encoding='utf-8', newline='').read()
    army_nl = '\r\n' if '\r\n' in army_raw else '\n'
    army = json.loads(army_raw)
    if dump_remote_army(army, army_nl) != army_raw:
        raise SystemExit('remoteRef/armySkillLevelUp.json round-trip 不一致，拒绝写入')
    carmy_raw = open(CLIENT_ARMY, encoding='utf-8', newline='').read()
    carmy = json.loads(carmy_raw)
    if dump_client_army(carmy, carmy_raw) != carmy_raw:
        raise SystemExit('client/armySkillLevelUp.json round-trip 不一致，拒绝写入')

    ai = {key: i for i, key in enumerate(army['k'])}
    army_touched = 0
    for row in army['v']:
        if row[ai['id']] != ARMY_CHAIN_ID:
            continue
        row[ai['desc']] = army_desc_of(row[ai['skilllevel']])
        print('  K表 %d L%d  %s' % (ARMY_CHAIN_ID, row[ai['skilllevel']], row[ai['desc']][:34] + '…'))
        army_touched += 1
    army_client_touched = 0
    for row in carmy:
        if row.get('id') != ARMY_CHAIN_ID:
            continue
        row['desc'] = army_desc_of(row['skilllevel'])
        army_client_touched += 1
    if army_touched != 3 or army_client_touched != 3:
        raise SystemExit('K 表只命中 %d / %d 行' % (army_touched, army_client_touched))

    if not write:
        print('（未写盘；加 --write 落盘）')
        return

    with open(REMOTE_PLAN, 'w', encoding='utf-8', newline='') as fh:
        fh.write(dump_remote_plan(plan, plan_nl))
    with open(CLIENT_PLAN, 'w', encoding='utf-8', newline='') as fh:
        fh.write(dump_client_plan(cplan))
    with open(REMOTE_ARMY, 'w', encoding='utf-8', newline='') as fh:
        fh.write(dump_remote_army(army, army_nl))
    with open(CLIENT_ARMY, 'w', encoding='utf-8', newline='') as fh:
        fh.write(dump_client_army(carmy, carmy_raw))
    print('已写入')


if __name__ == '__main__':
    main()
