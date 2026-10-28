# -*- coding: utf-8 -*-
"""PVP-卡牌 单位列体检（转表后第 5 步）。

背景（2026-09-20）：`PVP-单位` 表已**并入** `PVP-卡牌` —— 单位列内联在卡行上、一律加
`unit` 前缀，`unitId` 取「本行卡自己的 id」（同表自引用）。合表消掉了原先那张映射守卫
要防的「两张表行序不一致 → 卡名与所引用单位名对不上」整类问题。

但合表引入了新的失败模式，而且都只在运行时才炸。本脚本把体检前移到转表之后：

    1. 兵种卡（`unitPrefabPath` / `unitSkillId` 任一有值）两列必须**成对**出现
       —— 只填一半会让 `parseUnits` 抛错，整个对局预加载失败；
    2. 兵种卡的 `unitId` 必须等于本行 `id`（同表自引用契约），且全表唯一；
       **建筑卡（主城 / 金矿 / 防御塔 / 城墙）的 `unitId` 必须留空** ——
       客户端拿 `unitId == null` 认建筑卡（`findUnplayableDeckCards` 里
       `if (!card.unitId) continue;`），填上会把建筑判成「引用了不存在单位的出战卡」，
       让 `assertDeckUnitsPlayable()` 在预加载期抛错、整局进不去。
       （2026-09-20 合表时真踩了：合并脚本给所有行都填了 `unitId = 本行 id`。）
    3. `unitPrefabPath` 对应的 `.prefab` 必须真实存在；
    4. `unitSkillId` 必须在 `pvpSkill` 里存在；
    5. 兵种数值列（unitMaxHp / unitAttack / ...）不能缺；
    6. 卡名必须唯一 —— 运行时按中文名反查 id（`ZCModifierResolvers.unitIdByName`）。

用法：
    python tools/pvp_card_check.py            # 体检，有问题退出码 1
    python tools/pvp_card_check.py --quiet    # 只在失败时输出明细

与 `tests/pvp-card-unit-columns.test.ts` 同源同规则：那边守的是同一份
`assets/remoteRef/*.json`，本脚本是给策划/打包同学在转表后立刻看一眼用的。
"""
import argparse
import json
import os
import sys

# cmd(chcp 936) 下中文按 GBK 输出正常；只在编码不匹配时降级为替换，避免抛异常中断 bat。
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
REF_DIR = os.path.join(ROOT, "assets", "remoteRef")

# 单位 prefab 的候选根 —— 必须逐个查，不能只认首包。
# 2026-10-23 分包后 `units/` 从 `assets/resources` 迁到 battle 包（`BUNDLE_DIRECTORIES[BATTLE_BUNDLE]`
# 含 `units`，见 `core/asset/BundleCatalog.ts`），而 `skel/**` 仍在首包。只查 resources 会让
# 17 张走烘焙 prefab 的兵种卡全员假红（2026-10-28 实测：守卫报 17 条不存在，17/17 实际都在 battle 包）。
PREFAB_ROOTS = [
    os.path.join(ROOT, "assets", "resources"),
    os.path.join(ROOT, "assets", "bundles", "battle"),
]


def prefab_exists(path):
    return any(os.path.exists(os.path.join(root, path + ".prefab")) for root in PREFAB_ROOTS)


#  与 `ZCGameRuntimeConfig.parseUnits` 对齐：这些列在那边是**硬取**的，缺列即抛错。
REQUIRED_UNIT_NUMERIC_COLUMNS = [
    "unitMaxHp", "unitAttack", "unitMoveSpeed", "unitAttackRange",
    "unitAttackInterval", "unitAttackDuration", "unitAttackHitTime",
]


def load_rows(name):
    with open(os.path.join(REF_DIR, name + ".json"), "r", encoding="utf-8") as f:
        table = json.load(f)
    if isinstance(table, list):          # 未压缩行数组
        return table
    return [dict(zip(table["k"], row)) for row in table["v"]]


def is_unit_row(row):
    """与 `parseUnits` 同源：两列都空 = 建筑卡（不带单位列合法）。"""
    return bool(row.get("unitPrefabPath")) or row.get("unitSkillId") is not None


def collect_issues(cards, skill_ids):
    issues = []
    seen = {}
    for row in cards:
        label = "%s 「%s」" % (row.get("id"), row.get("name"))
        unit_id = row.get("unitId")
        unit_row = is_unit_row(row)

        # unitId = 「本行产出的兵种」的引用：
        #   兵种卡 → 填本行卡自己的 id；建筑卡 → **必须留空**。
        # ⚠️ 建筑卡填上 unitId 会被客户端的预加载闸判成「引用了不存在单位的出战卡」
        #    （`findUnplayableDeckCards` 里 `if (!card.unitId) continue;`），直接拦死整局。
        if unit_row and unit_id is None:
            issues.append("%s 是兵种卡却没填 unitId（应为本行卡自己的 id=%s）" % (label, row.get("id")))
        elif not unit_row and unit_id is not None:
            issues.append("%s 是建筑卡（没有单位预设）却填了 unitId=%s —— 客户端以 `unitId == null` 判建筑卡"
                          % (label, unit_id))
        elif unit_row and unit_id != row.get("id"):
            issues.append("%s 的 unitId=%s 与本行 id 不一致（同表自引用契约）" % (label, unit_id))
        elif unit_id is not None:
            if unit_id in seen:
                issues.append("%s 的 unitId=%s 与 %s 重复" % (label, unit_id, seen[unit_id]))
            else:
                seen[unit_id] = label

        if not unit_row:
            continue

        prefab, skill = row.get("unitPrefabPath"), row.get("unitSkillId")
        if not prefab:
            issues.append("%s 只配了 unitSkillId=%s，缺 unitPrefabPath（两列必须成对）" % (label, skill))
        if skill is None:
            issues.append("%s 只配了 unitPrefabPath=%s，缺 unitSkillId（两列必须成对）" % (label, prefab))
        if prefab and not prefab_exists(prefab):
            issues.append("%s 的 unitPrefabPath=%s 对应的 .prefab 不存在" % (label, prefab))
        if skill is not None and skill not in skill_ids:
            issues.append("%s 的 unitSkillId=%s 在 pvpSkill 里不存在" % (label, skill))

        missing = [c for c in REQUIRED_UNIT_NUMERIC_COLUMNS if row.get(c) is None]
        if missing:
            issues.append("%s 缺单位数值列：%s" % (label, "、".join(missing)))

    counts = {}
    for row in cards:
        counts[row.get("name")] = counts.get(row.get("name"), 0) + 1
    for name, count in counts.items():
        if count > 1:
            issues.append("卡名「%s」出现 %d 次（破坏「按名反查 id」的解析）" % (name, count))

    return issues


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quiet", action="store_true", help="只在失败时输出明细")
    args = parser.parse_args()

    cards = load_rows("pvpCard")
    skill_ids = {row.get("skillId") for row in load_rows("pvpSkill")}

    issues = collect_issues(cards, skill_ids)
    unit_rows = [r for r in cards if is_unit_row(r)]
    shared = {}
    for row in unit_rows:
        shared.setdefault(row.get("unitPrefabPath"), []).append(row.get("name"))
    shared_groups = [names for names in shared.values() if len(names) > 1]

    if not args.quiet or issues:
        print("PVP-卡牌 单位列体检：全表 %d 行 = 兵种卡 %d + 建筑卡 %d"
              % (len(cards), len(unit_rows), len(cards) - len(unit_rows)))
        if shared_groups:
            # 美术资源复用是合法的（只有卡名是唯一真源），这里只报数，不当问题。
            print("（其中 %d 组共享同一份单位 Prefab，例如：%s）"
                  % (len(shared_groups), "、".join("+".join(n) for n in shared_groups[:3])))

    if issues:
        print()
        print("!! 发现 %d 条问题：" % len(issues))
        for issue in issues:
            print("   " + issue)
        print()
        print("修法：单位列加 `unit` 前缀内联在卡行上，两列（unitPrefabPath / unitSkillId）必须成对；")
        print("      `unitId` 兵种卡填本行 id、建筑卡留空。")
        return 1

    print("单位列体检通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
