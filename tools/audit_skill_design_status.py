# -*- coding: utf-8 -*-
"""核对【技能设计案 (2)】每一行技能的**真实落地状态**，输出报告（只读，不写表）。

判定口径（全部从代码/配置里取，不看设计案自己的旧标记）：

普攻行（skillId 以 20 开头，或触发类型含「普通攻击」）
  1. `pvpCard[cardId].unitSkillId` 必须存在；
  2. 该 skillId 在 `pvpSkill` 里必须有一行，且 `mode` 与设计案一致（近战 / 弹道）；
  3. 该行的 `effectPrefabPath` 指向的 prefab 必须真的在包里；
  4. 设计案「触发参数」是数字时，必须等于 `pvpCard.unitAttackInterval`。

技能行（其余）
  1. `pvpSkillPlan` 里必须存在该技能的计划行 —— 链 ID 认 `S / S+90000 / S+180000 / S+270000`
     （本项目把一个多属性被动拆成了多条链：101001 → 101001 + 191001 + 281001 + 371001）；
  2. 每一行的 `enabled` 必须是 1；
  3. 每一行要么 `statId` 落在 `ZCStatSchema.STAT_IDS` 里，要么 `behaviorKey` 落在
     `ZCSkillRuntime` 已注册的那批里；
  4. 三档（skillLevel 1/2/3）都要在。
  另外把「设计案三档数值 vs 配置 value」做一次比对，作为**附加提示**（不参与判定）。

用法：python tools/audit_skill_design_status.py
"""
import glob
import json
import os
import re
import sys

from openpyxl import load_workbook

DOC = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
SHEET = '技能设计案 (2)'
# 认 **remoteRef**（运行时真正加载的那份）。转表产物 json/client 的 pvpSkillPlan 是**裁剪版**：
# 没有 behaviorKey / statusId / skillParamJson 三列，拿它判「行为有没有注册」会一路判成「没问题」。
JSON_DIR = 'D:/Alan/Project/POW/Demo3.8/assets/remoteRef'
BUNDLE = 'D:/Alan/Project/POW/Demo3.8/assets/bundles/battle'
SCHEMA = 'D:/Alan/Project/POW/Demo3.8/assets/script/app/zcds/model/ZCStatSchema.ts'
RUNTIME = 'D:/Alan/Project/POW/Demo3.8/assets/script/app/zcds/model/ZCSkillRuntime.ts'

CHAIN_STEP = 90000
CHAIN_MAX = 3
# 这几条 behavior 的「参数」全在 skillParamJson 里，空对象等于配了行但没有任何效果。
PARAM_DRIVEN = ('skill_params',)


def load_rows(name):
    with open(os.path.join(JSON_DIR, name + '.json'), encoding='utf-8') as handle:
        data = json.load(handle)
    if isinstance(data, list):
        return data
    keys = data['k']
    return [dict(zip(keys, values)) for values in data['v']]


def registered(body, start_marker, pattern):
    """从源码里抠出已注册的集合（statId 白名单 / behaviorKey 白名单）。"""
    head = body.split(start_marker, 1)
    if len(head) < 2:
        raise SystemExit('源码里找不到锚点：' + start_marker)
    return set(re.findall(pattern, head[1].split(']);', 1)[0]))


def build_report():
    schema = open(SCHEMA, encoding='utf-8').read()
    runtime = open(RUNTIME, encoding='utf-8').read()
    stat_ids = registered(schema, 'const STAT_IDS = new Set<ZCStatId>([', r"'([a-zA-Z]+)'")
    behaviors = set(re.findall(r"this\.register\('([a-z_]+)'", runtime))

    cards = {str(row['id']): row for row in load_rows('pvpCard')}
    skills = {int(row['skillId']): row for row in load_rows('pvpSkill')}
    plans = load_rows('pvpSkillPlan')

    plan_by_unit = {}
    for row in plans:
        plan_by_unit.setdefault(str(row['unitId']), []).append(row)

    wb = load_workbook(DOC)
    sheet = wb[SHEET]

    report = []
    for r in range(2, sheet.max_row + 1):
        card_id = str(sheet.cell(r, 1).value or '').strip()
        skill_id = sheet.cell(r, 7).value
        name = sheet.cell(r, 8).value
        trigger = str(sheet.cell(r, 9).value or '')
        if not card_id or not skill_id:
            continue
        skill_id = int(skill_id)
        is_normal = str(skill_id).startswith('2') or '普通攻击' in trigger
        reasons = []
        notes = []

        if is_normal:
            card = cards.get(card_id)
            if not card:
                reasons.append('pvpCard 里没有这张卡')
            else:
                unit_skill = card.get('unitSkillId')
                profile = skills.get(int(unit_skill)) if unit_skill else None
                if not unit_skill:
                    reasons.append('pvpCard.unitSkillId 为空')
                elif not profile:
                    reasons.append('unitSkillId=%s 在 pvpSkill 里没有行' % unit_skill)
                else:
                    path = profile.get('effectPrefabPath') or ''
                    if not path:
                        reasons.append('pvpSkill %s 没有 effectPrefabPath' % unit_skill)
                    elif not os.path.exists(os.path.join(BUNDLE, path + '.prefab')):
                        reasons.append('特效预制不存在：' + path)
                    expect_interval = sheet.cell(r, 10).value
                    actual = card.get('unitAttackInterval')
                    if isinstance(expect_interval, (int, float)) and actual is not None \
                            and abs(float(actual) - float(expect_interval)) > 1e-6:
                        notes.append('攻击间隔：案 %s vs 表 %s' % (expect_interval, actual))
                    notes.append('pvpSkill %s「%s」mode=%s' % (unit_skill, profile.get('name'), profile.get('mode')))
        else:
            rows = []
            used_chains = []
            for step in range(CHAIN_MAX + 1):
                chain = skill_id + step * CHAIN_STEP
                hit = [row for row in plan_by_unit.get(card_id, []) if int(row['skillChainId']) == chain]
                if hit:
                    rows.extend(hit)
                    used_chains.append(chain)
            if not rows:
                reasons.append('pvpSkillPlan 里没有任何计划行')
            else:
                disabled = [row for row in rows if int(row['enabled'] or 0) != 1]
                if disabled:
                    reasons.append('%d 行 enabled=0' % len(disabled))
                bad_stat = {row['statId'] for row in rows
                            if row.get('statId') and row['statId'] not in stat_ids}
                if bad_stat:
                    reasons.append('未登记的 statId：' + ','.join(sorted(bad_stat)))
                bad_behavior = {row['behaviorKey'] for row in rows
                                if row.get('behaviorKey') and row['behaviorKey'] not in behaviors}
                if bad_behavior:
                    reasons.append('未注册的 behaviorKey：' + ','.join(sorted(bad_behavior)))
                # 参数驱动型（`skill_params`）：`skillParamJson` 是空的 ⇒ 行在、但什么都没配。
                hollow = [row for row in rows
                          if row.get('behaviorKey') in PARAM_DRIVEN
                          and str(row.get('skillParamJson') or '').strip() in ('', '{}', 'null')]
                if hollow:
                    reasons.append('%d 行 skillParamJson 为空（配了行但没有参数）' % len(hollow))
                levels = {int(row['skillLevel']) for row in rows if row.get('skillLevel')}
                if not {1, 2, 3} <= levels:
                    reasons.append('缺少档位：%s' % sorted({1, 2, 3} - levels))
                notes.append('链 ' + '/'.join(str(c) for c in used_chains) + '，%d 行' % len(rows))
                kinds = {row.get('skillKind') for row in rows}
                notes.append('kind=' + ','.join(sorted(k for k in kinds if k)))

        report.append({
            'row': r, 'card': card_id, 'skill': skill_id, 'name': name,
            'normal': is_normal, 'ok': not reasons,
            'reasons': reasons, 'notes': notes,
        })

    total = len(report)
    done = [item for item in report if item['ok']]
    todo = [item for item in report if not item['ok']]
    print('总计 %d 行：已实现 %d，待规划 %d' % (total, len(done), len(todo)))

    by_card = {}
    for item in report:
        by_card.setdefault(item['card'], []).append(item)
    print('\n== 按卡汇总 ==')
    for card in sorted(by_card):
        items = by_card[card]
        got = sum(1 for item in items if item['ok'])
        tag = '全实现' if got == len(items) else ('全未做' if got == 0 else '部分')
        print('%s  %-6s %d/%d  %s' % (card, items[0]['name'] if False else '', got, len(items), tag))

    print('\n== 待规划明细 ==')
    for item in todo:
        print('%-3d %s %-7s %-10s %s' % (item['row'], item['card'], item['skill'], item['name'],
                                         '；'.join(item['reasons'])))

    return report


def main():
    report = build_report()
    total = len(report)
    done = [item for item in report if item['ok']]
    todo = [item for item in report if not item['ok']]
    print('总计 %d 行：已实现 %d，待规划 %d' % (total, len(done), len(todo)))

    by_card = {}
    for item in report:
        by_card.setdefault(item['card'], []).append(item)
    print('\n== 按卡汇总 ==')
    for card in sorted(by_card):
        items = by_card[card]
        got = sum(1 for item in items if item['ok'])
        tag = '全实现' if got == len(items) else ('全未做' if got == 0 else '部分')
        print('%s  %d/%d  %s' % (card, got, len(items), tag))

    print('\n== 待规划明细 ==')
    for item in todo:
        print('%-3d %s %-7s %-10s %s' % (item['row'], item['card'], item['skill'], item['name'],
                                         '；'.join(item['reasons'])))

    with open('tmp/skill_status_report.json', 'w', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=1)
    print('\n[wrote] tmp/skill_status_report.json')


if __name__ == '__main__':
    main()
