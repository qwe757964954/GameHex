# -*- coding: utf-8 -*-
"""蘑菇阵营（68011~68018）整族重排 · 第一段：面板 / 名称 / 已实现被动的数值。

本轮口径（用户 2026-11-15）：
  「根据现在的职业属性调整整个卡牌的数值，数值类的先同步配置源表；
    已实现的技能只是数值调整的，直接同步配置源表；
    绿卡价值 1 / 蓝卡 2 / 紫卡 4 / 金卡 10，职业互相克制持平，
    价值囊括技能和成长属性的。」

所以这里只做三件事，一行代码都不碰：
  ① `PVP-卡牌.xlsx`「卡牌配置」：8 张卡的显示名（对齐美术 prefab）+ 4 张卡的单位生命/攻击；
  ② `J-技能表.xlsx`「PVP技能配置」：6 条**已实现**被动的数值（33 行，含 skill 域与 unit 域子链）；
  ③ `K-卡牌升级.xlsx`「卡牌技能升级表」：同名 3 档描述同步（含 4 条历史遗留的描述漂移）。
  ④ `assets/remoteRef/*.json` 与 `doc/塔防数据配置/json/client/*.json` 同源回灌。

🔴 为什么必须回灌 JSON：`PVP-卡牌.xlsx` 已于 2026-11-15 17:33 把 68015 / 68016 的职业、
面板、射程整行对调（68015 战士 700/140 r45、68016 法师 600/130 r550），而两份 JSON
（11-13）还是对调前的老值。源表才是对的 —— 三条独立证据：
  · 源表 AJ 攻击类型：68015=1（近战）、68016=2（远程）；
  · 普攻技能：68015 指 30241「重骑兵普攻」= melee，68016 指 30231「**雷法师**普攻」= projectile；
  · 两份 JSON 自身矛盾（68015 标法师 r550 却 attackStyle=1 近战；68016 标战士 r45 却 attackStyle=2）。
  设计案的 E 列也是跟着老 JSON 写反的，由 `patch_mushroom_design.py` 一并改正。

用法：
    python tools/config/patch_mushroom_race.py --check
    python tools/config/patch_mushroom_race.py --write
"""

import argparse
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

from sync_treant_excel import ROOT, find_row_by, read_zip_rows, set_cell, write_zip      # noqa: E402
from patch_bullet_falloff import set_cell_safe                                          # noqa: E402
from patch_multi_target_falloff import dump_packed, dump_rows, read_packed, read_rows    # noqa: E402

DEMO = 'D:/Alan/Project/POW/Demo3.8'
REMOTE = os.path.join(DEMO, 'assets', 'remoteRef')
CLIENT = os.path.join(ROOT, 'json', 'client')
BACKUP = os.path.join(DEMO, 'tmp', 'backup_mushroom_race')

# ---------------------------------------------------------------- ① 卡牌：名称与面板

# 显示名以美术 prefab 为准（`unitPrefabPath` 就是「风炮菇 / 阿尔萨斯 / 毒箭菇」），
# 策划表 B 列停在改名前的老名，本轮一并改掉。
CARD_NAME = {
    68013: '风炮菇',      # 弹兵菇 → 风炮菇
    68015: '阿尔萨斯',    # 机甲菇 → 阿尔萨斯
    68017: '毒箭蘑菇',    # 毒箭菇 → 毒箭蘑菇
}

# 单位生命 / 单位攻击。取值 = 同职业同品级在配表里的既有档位：
#   绿战士 100/13（68019 窝瓜人、68028 饥饿战士两张一致）
#   紫法师 240/48（68022 雷蕉）⇒ 紫射手同为 DPS 档 240/48
#   紫战士 400/52（68005 椰蛋战士）
#   金法师 600/120（68024 急冻瓜 / 68026 麻辣铁锅 / 68034 魔术师 三张一致）
CARD_PANEL = {
    68012: (100, 13),
    68013: (240, 48),
    68014: (400, 52),
    # 68015 源表本来就是 700/140（金战士既有档，另一张是 68025 大威天芦）；
    # 写进来是为了把两份 JSON 里被对调的 600/130 拉回源表值。
    68015: (700, 140),
    68016: (600, 120),
}

# 两份 JSON 里 68015 / 68016 的职业与射程纠偏（对齐源表）
CARD_TRAITS = {
    68015: {'attack': '战士', 'camp': '蘑菇'},
    68016: {'attack': '法师', 'camp': '蘑菇'},
}
CARD_RANGE = {68015: 45, 68016: 550}

# ---------------------------------------------------------------- ② 已实现被动的数值

# 溅射必须同卡同值：`skillParamJson` 按「同 unitId:pvpSkillId 参数叠加」合并，
# 68015 的 101501 / 101502 都挂在 30241 上、68016 的 101601 / 101602 都挂在 30231 上，
# 两条写不同的 splashDamageRate ⇒ 生效值取决于合并顺序（等于随机）。
# 所以「主词缀不同、溅射值强制相等」是硬约束，改一条必须同步另一条。
# `splashRadius` 一律不动 —— 那是判定半径，与特效尺寸同步过，只调倍率不调范围。
PLAN = {
    # ---- 68015 阿尔萨斯（金 · 战士）目标 297 VP
    # 101501 爆囊扩散：溅射 32/40/48（96）+ 攻速 16/22/28（26.6）+ 伤害 10/14/18（21.6）= 144.2
    94015011: {'attackSpeed': 0.16, 'splash': 0.32,
               'desc': '命中对周围造成32%溅射伤害（同一爆点第2个目标起每次×0.7），攻击速度提高16%，伤害提高10%'},
    94015012: {'attackSpeed': 0.22, 'splash': 0.40,
               'desc': '命中对周围造成40%溅射伤害（同一爆点第2个目标起每次×0.7），攻击速度提高22%，伤害提高14%'},
    94015013: {'attackSpeed': 0.28, 'splash': 0.48,
               'desc': '命中对周围造成48%溅射伤害（同一爆点第2个目标起每次×0.7），攻击速度提高28%，伤害提高18%'},
    94915011: {'damageRate': 0.10},
    94915012: {'damageRate': 0.14},
    94915013: {'damageRate': 0.18},
    # 101502 吸养根须：溅射 32/40/48（96）+ 吸血 30/38/46（41.4）+ 伤害 6/8/10（12）= 149.4
    94015021: {'lifestealRate': 0.30, 'splash': 0.32,
               'desc': '造成伤害的30%转化为自身生命，命中对周围造成32%溅射伤害（同一爆点第2个目标起每次×0.7），伤害提高6%'},
    94015022: {'lifestealRate': 0.38, 'splash': 0.40,
               'desc': '造成伤害的38%转化为自身生命，命中对周围造成40%溅射伤害（同一爆点第2个目标起每次×0.7），伤害提高8%'},
    94015023: {'lifestealRate': 0.46, 'splash': 0.48,
               'desc': '造成伤害的46%转化为自身生命，命中对周围造成48%溅射伤害（同一爆点第2个目标起每次×0.7），伤害提高10%'},
    94915021: {'damageRate': 0.06},
    94915022: {'damageRate': 0.08},
    94915023: {'damageRate': 0.10},

    # ---- 68016 磁电菇（金 · 法师）目标 297 VP
    # 101601 裂变暴击：暴击率 34/42/50（25）+ 溅射 30/38/46（92）= 117
    # 🔴 暴伤已从单卡链路删除（memory：`critDamage` 只来自全队链 109001，owner 级唯一值），
    #    保留「暴击伤害提高 90/120/150%」的文案会让玩家以为本卡给暴伤 —— 本轮连文案一起去掉。
    94016011: {'critRate': 34, 'splash': 0.30,
               'desc': '暴击率提高34%，命中对周围造成30%溅射伤害（同一爆点第2个目标起每次×0.7）'},
    94016012: {'critRate': 42, 'splash': 0.38,
               'desc': '暴击率提高42%，命中对周围造成38%溅射伤害（同一爆点第2个目标起每次×0.7）'},
    94016013: {'critRate': 50, 'splash': 0.46,
               'desc': '暴击率提高50%，命中对周围造成46%溅射伤害（同一爆点第2个目标起每次×0.7）'},
    # 101602 爆囊扩散：溅射 30/38/46（92）+ 攻速 26/34/42（39.9）+ 伤害 18/24/30（36）= 167.9
    94016021: {'attackSpeed': 0.26, 'splash': 0.30,
               'desc': '命中对周围造成30%溅射伤害（同一爆点第2个目标起每次×0.7），攻击速度提高26%，伤害提高18%'},
    94016022: {'attackSpeed': 0.34, 'splash': 0.38,
               'desc': '命中对周围造成38%溅射伤害（同一爆点第2个目标起每次×0.7），攻击速度提高34%，伤害提高24%'},
    94016023: {'attackSpeed': 0.42, 'splash': 0.46,
               'desc': '命中对周围造成46%溅射伤害（同一爆点第2个目标起每次×0.7），攻击速度提高42%，伤害提高30%'},
    94916021: {'damageRate': 0.18},
    94916022: {'damageRate': 0.24},
    94916023: {'damageRate': 0.30},

    # ---- 68017 毒箭蘑菇（金 · 射手）目标 297 VP
    # 101701 孢子弹幕不动（弹数 2 发 110 + 攻速 24.7 + 伤害 19.2 = 153.9）
    # 101702 爆囊扩散：溅射 12/16/20（40）+ 攻速 30/38/46（43.7）+ 伤害 20/26/32（38.4）= 122.1
    # 射手已有「多弹」在摊薄单体，溅射降到低档做收割，预算让给 101701。
    94017021: {'attackSpeed': 0.30, 'splash': 0.12,
               'desc': '命中对周围造成12%溅射伤害（同一爆点第2个目标起每次×0.7），攻击速度提高30%，伤害提高20%'},
    94017022: {'attackSpeed': 0.38, 'splash': 0.16,
               'desc': '命中对周围造成16%溅射伤害（同一爆点第2个目标起每次×0.7），攻击速度提高38%，伤害提高26%'},
    94017023: {'attackSpeed': 0.46, 'splash': 0.20,
               'desc': '命中对周围造成20%溅射伤害（同一爆点第2个目标起每次×0.7），攻击速度提高46%，伤害提高32%'},
    94917021: {'damageRate': 0.20},
    94917022: {'damageRate': 0.26},
    94917023: {'damageRate': 0.32},

    # ---- 68018 诅咒菇（金 · 战士）目标 297 VP
    # 101801 蔓生连打不动（连击 1 段 100 + 攻速 32.3 + 移速 12 = 144.3）
    # 101802 裂变凿击：附加 50/64/78（117）+ 攻速 20/26/32（30.4）+ 移速 6/8/10（5）= 152.4
    # 🔴 原「攻击范围 8/12/16%」是白给：战士 panel range = 45，+16% 只到 52.2，
    #    11.2 VP 买不到任何实战收益（memory §职业属性基准：战士 range 45 是固定档）。
    #    改成移动速度（追人 = 战士真正吃得到的东西），键走 95818021~23 的 statId。
    94918021: {'attackSpeed': 0.20},
    94918022: {'attackSpeed': 0.26},
    94918023: {'attackSpeed': 0.32},
    95818021: {'statId': 'moveSpeed', 'value': 0.06,
               'desc': '命中额外附加50%伤害，攻击速度提高20%，移动速度提高6%'},
    95818022: {'statId': 'moveSpeed', 'value': 0.08,
               'desc': '命中额外附加64%伤害，攻击速度提高26%，移动速度提高8%'},
    95818023: {'statId': 'moveSpeed', 'value': 0.10,
               'desc': '命中额外附加78%伤害，攻击速度提高32%，移动速度提高10%'},
}

# ---------------------------------------------------------------- ③ K 表描述同步

# `K-卡牌升级.xlsx` 的 desc 是卡面真读的文案，历史上一直落后于 pvpSkillPlan：
#   101501 写 30/40/50（运行时 20/26/32）、101601 写 32/40/48 + 暴伤、
#   101602 / 101702 写 30/40/50、101802 写「攻击范围」、101301 缺「（穿透目标承受 60%）」。
# 本轮统一以 pvpSkillPlan 为准。
K_DESC = {
    101301: ['普攻穿透1个目标（穿透目标承受 60%）'] * 3,
    101302: ['命中对周围造成20%溅射伤害（同一爆点第2个目标起每次×0.7）',
             '命中对周围造成26%溅射伤害（同一爆点第2个目标起每次×0.7）',
             '命中对周围造成32%溅射伤害（同一爆点第2个目标起每次×0.7）'],
    101501: [PLAN[94015011]['desc'], PLAN[94015012]['desc'], PLAN[94015013]['desc']],
    101502: [PLAN[94015021]['desc'], PLAN[94015022]['desc'], PLAN[94015023]['desc']],
    101601: [PLAN[94016011]['desc'], PLAN[94016012]['desc'], PLAN[94016013]['desc']],
    101602: [PLAN[94016021]['desc'], PLAN[94016022]['desc'], PLAN[94016023]['desc']],
    101702: [PLAN[94017021]['desc'], PLAN[94017022]['desc'], PLAN[94017023]['desc']],
    101802: [PLAN[95818021]['desc'], PLAN[95818022]['desc'], PLAN[95818023]['desc']],
}

SPLASH_KEY = 'splashDamageRate'


def _dump_value(value):
    """`assets/remoteRef/pvpCard.json` 的嵌套排版：数组与对象也换行、冒号后不留空格。

    `patch_multi_target_falloff.dump_packed` 只处理标量行，遇到 `traits`（对象）与
    `skillList`（数组）会写成 JSON 单行压缩 —— pvpCard 里这两列逐行存在，直接用它
    会把文件从 10245 字节改成 10176 字节（格式全变）。这里按原排版递归还原。
    """
    if value is None:
        return 'null'
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, (int, float)):
        return json.dumps(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        if not value:
            return '[]'
        return '[\n' + ',\n'.join(_dump_value(item) for item in value) + '\n]'
    if isinstance(value, dict):
        if not value:
            return '{}'
        return '{\n' + ',\n'.join(
            json.dumps(k, ensure_ascii=False) + ':' + _dump_value(v) for k, v in value.items()) + '\n}'
    raise TypeError('不支持的值类型 %r' % (value,))


def dump_rich(keys, rows, c=1):
    parts = ['{', '"k":[']
    parts.append(',\n'.join(json.dumps(key, ensure_ascii=False) for key in keys))
    parts.append('],')
    parts.append('"v":[')
    parts.append(',\n'.join('[\n' + ',\n'.join(_dump_value(row[key]) for key in keys) + '\n]'
                            for row in rows))
    parts.append('],')
    parts.append('"c":%s' % json.dumps(c))
    parts.append('}')
    return '\n'.join(parts)

# ---------------------------------------------------------------- 写入


def plan_targets():
    """返回 {modifierId: 新字段 dict}，字段已换算成 pvpSkillPlan 的列口径。

    PLAN 里用「statId 名字」当键（attackSpeed / critRate / ...），这里统一压成
    `statId` + `value` 两列；`splash` 单独留给 skillParamJson 合并。
    """
    out = {}
    for mid, patch in PLAN.items():
        fields = {}
        for key, value in patch.items():
            if key in ('splash', 'desc', 'statId', 'value'):
                fields[key] = value
            else:
                fields['statId'] = key
                fields['value'] = value
        out[mid] = fields
    return out


def _group_of(modifier_id):
    """一链三档在 `pvpSkillPlan` 里被拆成 3 条子链（94x / 95x / 96x），

    `94015011` → (1501, 1)：前 3 位是域前缀、中 4 位是链尾、末位是档位。
    同一条技能的三个子链行**各自带一份 desc**，历史上就是各写各的（所以 94915011
    还留着 30/40/50 的老口径），改文案必须整组一起改，否则卡面读的是哪份看运气。
    """
    text = str(modifier_id)
    if len(text) != 8 or text[:3] not in ('940', '949', '958', '910', '967', '970'):
        return None
    return text[3:7], text[7]


def apply_group_desc(rows):
    """把 K_DESC 的每档文案写到该链**所有子链行**上。返回改动行数。"""
    wanted = {str(chain)[2:]: descs for chain, descs in K_DESC.items()}
    count = 0
    for row in rows:
        group = _group_of(row['modifierId'])
        if group is None or group[0] not in wanted:
            continue
        descs = wanted[group[0]]
        level = int(group[1])
        if 1 <= level <= len(descs):
            row['desc'] = descs[level - 1]
            count += 1
    return count


def apply_plan_rows(rows, keys, check):
    """`rows` 是 read_packed 出来的 dict 列表，原地改。"""
    targets = plan_targets()
    by_id = {str(row['modifierId']): row for row in rows}
    touched = []
    for mid, fields in sorted(targets.items()):
        row = by_id.get(str(mid))
        if row is None:
            raise SystemExit('pvpSkillPlan 里找不到 modifierId=%s' % mid)
        if 'statId' in fields:
            row['statId'] = fields['statId']
        if 'value' in fields:
            row['value'] = fields['value']
        if 'splash' in fields:
            raw = row.get('skillParamJson')
            params = json.loads(raw) if raw else {}
            params[SPLASH_KEY] = fields['splash']
            row['skillParamJson'] = json.dumps(params, ensure_ascii=False, separators=(',', ':'))
        touched.append((mid, row['statId'], row['value']))
    apply_group_desc(rows)
    return touched


def write_pvp_card(check):
    path = os.path.join(ROOT, 'PVP-卡牌.xlsx')
    member = 'xl/worksheets/sheet1.xml'
    xml = read_zip_rows(path, member)
    changes = []
    for cid, name in CARD_NAME.items():
        row = find_row_by(xml, 'A', cid)
        assert row, 'PVP-卡牌 找不到 %s' % cid
        changes.append((cid, 'B', row, name))
    for cid, (hp, atk) in CARD_PANEL.items():
        row = find_row_by(xml, 'A', cid)
        assert row, 'PVP-卡牌 找不到 %s' % cid
        changes.append((cid, 'U', row, hp))
        changes.append((cid, 'V', row, atk))

    for cid, col, row, value in changes:
        print('  %s %s%d = %s' % (cid, col, row, value))
    if check:
        return len(changes)
    for cid, col, row, value in changes:
        xml = set_cell_safe(xml, '%s%d' % (col, row), value)
    write_zip(path, member, xml, BACKUP)
    print('  写入 PVP-卡牌.xlsx（%d 格）' % len(changes))
    return len(changes)


def write_pvp_plan(check):
    path = os.path.join(ROOT, 'J-技能表.xlsx')
    member = 'xl/worksheets/sheet9.xml'
    xml = read_zip_rows(path, member)

    remote = os.path.join(REMOTE, 'pvpSkillPlan.json')
    keys, values, rows = read_packed(remote)
    apply_plan_rows(rows, keys, check)

    # 列口径（sheet9 表头行 3/5 已核）：B=modifierId P=statId Q=operation R=value Z=desc AC=skillParamJson
    targets = plan_targets()
    count = 0
    for mid, fields in sorted(targets.items()):
        row_num = find_row_by(xml, 'B', mid)
        assert row_num, 'J-技能表 找不到 modifierId=%s' % mid
        row = next(r for r in rows if str(r['modifierId']) == str(mid))
        if 'statId' in fields:
            xml = set_cell_safe(xml, 'P%d' % row_num, row['statId'])
        if 'value' in fields:
            xml = set_cell_safe(xml, 'R%d' % row_num, row['value'])
        if SPLASH_KEY in (row.get('skillParamJson') or ''):
            xml = set_cell_safe(xml, 'AC%d' % row_num, row['skillParamJson'])
        count += 1
        print('  %s → statId=%s value=%s' % (mid, row['statId'], row['value']))

    # desc 按「链尾 + 档位」整组写：同一条技能的 94x / 95x / 96x 三个子链行各存一份文案
    group_rows = {}
    for match in re.finditer(r'<c r="B(\d+)"[^>]*>\s*<v>(\d+)</v>', xml):
        group = _group_of(match.group(2))
        if group:
            group_rows.setdefault(group, []).append(int(match.group(1)))
    wanted = {str(chain)[2:]: descs for chain, descs in K_DESC.items()}
    desc_count = 0
    for (key4, level), row_nums in sorted(group_rows.items()):
        if key4 not in wanted:
            continue
        index = int(level) - 1
        descs = wanted[key4]
        if not (0 <= index < len(descs)):
            continue
        for row_num in row_nums:
            xml = set_cell_safe(xml, 'Z%d' % row_num, descs[index])
            desc_count += 1
    print('  desc 整组同步 %d 格（%d 条链 × 3 档 × 子链）' % (desc_count, len(K_DESC)))

    if not check:
        write_zip(path, member, xml, BACKUP)
        print('  写入 J-技能表.xlsx（%d 行）' % count)
    return count


def write_json(check):
    total = 0

    # ---- pvpCard
    for base, dumper, reader in ((REMOTE, dump_packed, read_packed), (CLIENT, dump_rows, read_rows)):
        path = os.path.join(base, 'pvpCard.json')
        if base is REMOTE:
            keys, values, rows = read_packed(path)
            idx = {k: n for n, k in enumerate(keys)}
            for row in rows:
                cid = int(str(row['id']))
                if cid in CARD_NAME:
                    row['name'] = CARD_NAME[cid]
                if cid in CARD_PANEL:
                    row['unitMaxHp'], row['unitAttack'] = CARD_PANEL[cid]
                if cid in CARD_TRAITS:
                    row['traits'] = CARD_TRAITS[cid]
                if cid in CARD_RANGE:
                    row['unitAttackRange'] = CARD_RANGE[cid]
            if not check:
                body = dump_rich(keys, rows)
                with io.open(path, 'w', encoding='utf-8', newline='') as handle:
                    handle.write(body)
        else:
            data, trailing = read_rows(path)
            for row in data:
                cid = int(str(row['id']))
                if cid in CARD_NAME:
                    row['name'] = CARD_NAME[cid]
                if cid in CARD_PANEL:
                    row['unitMaxHp'], row['unitAttack'] = CARD_PANEL[cid]
                if cid in CARD_TRAITS:
                    row['traits'] = CARD_TRAITS[cid]
                if cid in CARD_RANGE:
                    row['unitAttackRange'] = CARD_RANGE[cid]
            if not check:
                with io.open(path, 'w', encoding='utf-8', newline='') as handle:
                    handle.write(dump_rows(data, trailing))
        total += 1
        print('  %s' % path)

    # ---- pvpSkillPlan（remoteRef 只在 --write 时按已改过的 rows 重序列化）
    remote_plan = os.path.join(REMOTE, 'pvpSkillPlan.json')
    keys, values, rows = read_packed(remote_plan)
    apply_plan_rows(rows, keys, check)
    if not check:
        with io.open(remote_plan, 'w', encoding='utf-8', newline='') as handle:
            handle.write(dump_rich(keys, rows))
    print('  %s' % remote_plan)
    total += 1

    client_plan = os.path.join(CLIENT, 'pvpSkillPlan.json')
    data, trailing = read_rows(client_plan)
    by_id = {str(row['modifierId']): row for row in rows}
    for row in data:
        src = by_id.get(str(row.get('modifierId')))
        if src is None:
            continue
        for field in ('statId', 'value', 'skillParamJson', 'desc'):
            row[field] = src[field]
    if not check:
        with io.open(client_plan, 'w', encoding='utf-8', newline='') as handle:
            handle.write(dump_rows(data, trailing))
    print('  %s' % client_plan)
    total += 1
    return total


def write_k_desc(check):
    path = os.path.join(ROOT, 'K-卡牌升级.xlsx')
    member = 'xl/worksheets/sheet2.xml'
    xml = read_zip_rows(path, member)
    cell_re = re.compile(r'<c r="A(\d+)"[^>]*>\s*<v>(\d+)</v>')
    rows_of = {}
    for match in cell_re.finditer(xml):
        rows_of.setdefault(int(match.group(2)), []).append(int(match.group(1)))
    count = 0
    for chain, descs in K_DESC.items():
        targets = rows_of.get(chain) or []
        if len(targets) != 3:
            raise SystemExit('K 表链 %s 找到 %d 行（应为 3）' % (chain, len(targets)))
        for level, desc in enumerate(descs, start=1):
            xml = set_cell_safe(xml, 'C%d' % targets[level - 1], desc)
            count += 1
    if not check:
        write_zip(path, member, xml, BACKUP)
        print('  写入 K-卡牌升级.xlsx（%d 行描述）' % count)
    return count


def write_card_levelup_name(check):
    """`K-卡牌升级.xlsx`「卡牌升级表」B 列：全表只剩 68013 一个卡名对不上 pvpCard。

    它写的是「玛法」—— 那是头像资源名（`兵种_头像_玛法`）被误填进名称列，全表 35 张卡
    只此一处；不修的话升级页的材料位会把 68013 显示成「玛法」。
    """
    path = os.path.join(ROOT, 'K-卡牌升级.xlsx')
    member = 'xl/worksheets/sheet1.xml'
    xml = read_zip_rows(path, member)
    cell_re = re.compile(r'<c r="A(\d+)"[^>]*>\s*<v>(\d+)</v>')
    targets = [int(m.group(1)) for m in cell_re.finditer(xml) if int(m.group(2)) == 68013]
    if len(targets) != 51:
        raise SystemExit('卡牌升级表 68013 找到 %d 行（应为 51）' % len(targets))
    if not check:
        for row_num in targets:
            xml = set_cell_safe(xml, 'B%d' % row_num, CARD_NAME[68013])
        write_zip(path, member, xml, BACKUP)

    for base, dumper, reader in ((REMOTE, dump_rich, read_packed), (CLIENT, dump_rows, read_rows)):
        target = os.path.join(base, 'cardLevelUp.json')
        if base is REMOTE:
            keys, values, rows = read_packed(target)
            for row in rows:
                if int(str(row['id'])) == 68013:
                    row['name'] = CARD_NAME[68013]
            if not check:
                with io.open(target, 'w', encoding='utf-8', newline='') as handle:
                    handle.write(dump_rich(keys, rows))
        else:
            data, trailing = read_rows(target)
            for row in data:
                if int(str(row['id'])) == 68013:
                    row['name'] = CARD_NAME[68013]
            if not check:
                with io.open(target, 'w', encoding='utf-8', newline='') as handle:
                    handle.write(dump_rows(data, trailing))
    return len(targets)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    check = not args.write

    print('== ① PVP-卡牌 名称与面板 ==')
    write_pvp_card(check)
    print('== ② J-技能表 已实现被动数值 ==')
    write_pvp_plan(check)
    print('== ③ K-卡牌升级 描述同步 ==')
    count = write_k_desc(check)
    if check:
        print('  将改 %d 行 C 列（%d 条链 × 3 档）' % (count, len(K_DESC)))
    print('== ④ JSON 回灌 ==')
    write_json(check)
    print('== ⑤ 卡牌升级表 名称对齐 ==')
    total = write_card_levelup_name(check)
    print('  改 %d 行（cardLevelUp 全表只剩 68013 一处与 pvpCard 不一致）' % total)
    print('== %s ==' % ('干跑完成，未落盘' if check else '已落盘'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
