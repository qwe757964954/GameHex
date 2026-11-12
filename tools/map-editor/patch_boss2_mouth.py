# -*- coding: utf-8 -*-
"""把 `chapter_02` 的 2-10（`levelId 10020` / `boss_2`）改成「裂开的笑嘴」（方案 D3）。

用户 2026-11-11：

    「修改第2关的2-10的boss 关卡形状，像裂开的笑嘴（绿框范围），
     保持正确的解锁关系，用随机格或者固定格填充替换缺失的地块」

随后在 shape_C 预览上画了绿箭头（三个箭头都从两个上翘的嘴角往中间/下方收），
并在 A/B/C 与 D1/D2/D3 里选了 **D3 下唇连起来（10 格）**。

## 目标形状（D3，10 格）

      c6   c7   c8   c9   c10  c11  c12  c13
r12   [246]                                  ← 退出 boss，改成固定格
r13        267  268  269  270  271  272  273  ← 嘴身（270 = 承载格）
r14                  289  290  291            ← 下唇连成一条

* **嘴角不再外翘**：`246`（r12c6）退出 boss ⇒ 嘴身上沿是一条直线，两端不外凸。
* **下唇连成一条**：`289/290/291` 三格并进来，比嘴身低一层 ⇒ 中间下凹 = 张嘴笑。
* 没有裂口（裂口版是 A 方案，用户没选）。

## 🔴 为什么 `270` 必须留在 boss 里

`270` 是 `boss_2` 的 `cellId`（承载格），且 **17 个站点把它写进 `requiredCells`**
（`asyncPvp_3`、`fixedResource_10/11/16/17/18/19/20/21/22/27/30/36/38/46/48/63`）——
它是通往下半区的唯一关口。`isPrerequisiteComplete` 对固定资源格有「可解锁即算完成」的特例，
`270` 一旦变成资源格，那 17 格会在开局全部可解锁，推进线直接塌。
⇒ `270` 保持 boss 格 + 承载格，`unlock.requiredCells` 保持 `[314, 292]` 不动。

## 改动清单（一处预设 → 发布三处）

| 对象 | 动作 |
| :-- | :-- |
| `boss_2.footprint` | `[246, 267..273]` → `[267..273, 289, 290, 291]`（10 格） |
| `boss_2.cellId` | 不变（`270`，嘴身正中） |
| `boss_2.unlock.requiredCells` | 不变（`[314, 292]`，两个前置都还在，无环） |
| `fixedResource_38`（cell 290） | 删除站点，格子并进 boss |
| `fixedResource_46`（cell 289） | 删除站点，格子并进 boss |
| `fixedResource_48`（cell 291） | 删除站点，格子并进 boss |
| **新增** `fixedResource_90`（cell 246） | 顶替退出的 `246`：`rewardId 1023` + `buildingId 69020` + `silverCost 15` + `requiredCells [270]` |

### 为什么新格用 1023 / 69020 而不是 1017

被并掉的 `289`（`fixedResource_46`）恰好是本章一个 **1023 银币宝箱（建筑 69020）**。
若新格用默认的 `1017`，本章 1023 宝箱会从 **27 个变 26 个**（七章合计 148 → 147），
等于顺手删掉了一个设计好的银币宝箱。所以把那个 1023 宝箱**挪到 246**，数量与美术都不变。

`requiredCells` 用 `[270]` —— 与 246 周围所有固定格一致（`fixedResource_19/21/27/30/36/38/46/48`
全部 `[270]`），保证「打完 boss 才能开这一圈」的口径不变。

⚠️ **站点总数**：104 → **102**（吞 3 个固定格、补 1 个）⇒ 章节完成度分母少 2。

用法：

    python tools/map-editor/patch_boss2_mouth.py --dry-run   # 只打印计划，不写盘
    python tools/map-editor/patch_boss2_mouth.py             # 写预设 + 发布三处

⚠️ 幂等：footprint 已是目标值时直接跳过。
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

import copy_territory_maps as publisher
from territory_format import TerritoryValidationError, validate_territory_map

PRESET = publisher.SOURCE / 'chapter_02.json'
SITE_ID = 'boss_2'
#: 目标 footprint；**包含承载格 270**（与既有写法一致：footprint 里含 cellId）。
TARGET_CELLS = [267, 268, 269, 270, 271, 272, 273, 289, 290, 291]
#: 退出 boss、改回固定格的格子。
FREED_CELL = 246
#: 新固定格站点（顶替 FREED_CELL）。
NEW_SITE_ID = 'fixedResource_90'
NEW_SITE_REWARD = 1023
NEW_SITE_BUILDING = '69020'
NEW_SITE_SILVER = 15
NEW_SITE_REQUIRED = [270]


def find_site(data: dict, site_id: str) -> dict:
    for site in data.get('sites') or []:
        if site.get('id') == site_id:
            return site
    raise SystemExit(f'找不到站点 {site_id}')


def plan(data: dict) -> dict:
    boss = find_site(data, SITE_ID)
    current = sorted({int(boss['cellId'])} | {int(c) for c in boss.get('footprint') or []})
    target = sorted(TARGET_CELLS)
    absorbed = [s for s in (data.get('sites') or [])
                if s.get('type') == 'fixedResource' and int(s['cellId']) in set(target)]
    return {
        'current': current,
        'target': target,
        'added': sorted(set(target) - set(current)),
        'removed': sorted(set(current) - set(target)),
        'absorbed': [(s['id'], int(s['cellId']), s.get('rewardId'), s.get('buildingId') or '') for s in absorbed],
        'freed_cell': FREED_CELL,
        'new_site': NEW_SITE_ID,
        'required': list(boss['unlock']['requiredCells']),
    }


def apply(data: dict, info: dict) -> None:
    boss = find_site(data, SITE_ID)
    boss['footprint'] = sorted(TARGET_CELLS)

    drop_ids = {sid for sid, _, _, _ in info['absorbed']}
    sites = [s for s in data.get('sites') or [] if s.get('id') not in drop_ids]

    if not any(s.get('cellId') == FREED_CELL for s in sites):
        sites.append({
            'id': NEW_SITE_ID,
            'type': 'fixedResource',
            'cellId': FREED_CELL,
            'footprint': [FREED_CELL],
            'unlock': {
                'requiredCells': list(NEW_SITE_REQUIRED),
                'combatPower': 0,
                'silverCost': NEW_SITE_SILVER,
                'exploreSeconds': 1,
                'staminaCost': 1,
            },
            'configId': f'fixedResource_{FREED_CELL}',
            'buildingId': NEW_SITE_BUILDING,
            'rewardId': NEW_SITE_REWARD,
        })
    data['sites'] = sites


def assert_only_expected(before: dict, after: dict, info: dict) -> None:
    """硬断言：只允许动 boss_2.footprint、增删那几个站点，别的字段一律不许变。"""
    drop_ids = {sid for sid, _, _, _ in info['absorbed']}
    drop_ids.add(NEW_SITE_ID)
    b, a = copy.deepcopy(before), copy.deepcopy(after)
    for payload in (b, a):
        payload['sites'] = [s for s in payload['sites'] if s.get('id') not in drop_ids]
        for site in payload['sites']:
            if site.get('id') == SITE_ID:
                site.pop('footprint', None)
    if b != a:
        raise SystemExit('❌ 除预期字段外还有别的地方变了 —— 中止，别写盘')


def main() -> int:
    parser = argparse.ArgumentParser(description='把 chapter_02 的 2-10 首领做成「裂开的笑嘴」')
    parser.add_argument('--dry-run', action='store_true', help='只打印计划，不写盘')
    parser.add_argument('--no-publish', action='store_true', help='只改预设，不发布到资源目录 / 策划 JSON')
    args = parser.parse_args()

    before = json.loads(PRESET.read_text(encoding='utf-8'))
    data = copy.deepcopy(before)
    info = plan(data)

    print(f'目标 footprint {len(info["target"])} 格：{info["target"]}')
    print(f'当前 footprint {len(info["current"])} 格：{info["current"]}')
    print(f'  并进来：{info["added"]}')
    print(f'  退出去：{info["removed"]}')
    print(f'  吞掉的固定格站点：{info["absorbed"]}')
    print(f'  新建固定格：{info["new_site"]} @ cell {info["freed_cell"]}')
    print(f'  boss requiredCells 不变：{info["required"]}')

    if info['removed'] != [FREED_CELL]:
        raise SystemExit(f'❌ 预期只退出 {FREED_CELL}，实际 {info["removed"]} —— 中止')
    for sid, cell, reward, building in info['absorbed']:
        if reward == 1023 and building != NEW_SITE_BUILDING:
            raise SystemExit(f'❌ {sid} 是 1023 宝箱但建筑不是 {NEW_SITE_BUILDING}，先对账')

    apply(data, info)

    try:
        validate_territory_map(data, PRESET.stem)
    except TerritoryValidationError as error:
        raise SystemExit(f'chapter_02 校验没过：{error}') from error
    assert_only_expected(before, data, info)

    chest_1023 = sum(1 for s in data['sites']
                     if s.get('type') == 'fixedResource' and s.get('rewardId') == 1023)
    chest_before = sum(1 for s in before['sites']
                       if s.get('type') == 'fixedResource' and s.get('rewardId') == 1023)
    print(f'\n1023 宝箱：{chest_before} → {chest_1023}（应持平）')
    print(f'站点总数：{len(before["sites"])} → {len(data["sites"])}')
    if chest_1023 != chest_before:
        raise SystemExit('❌ 1023 宝箱数量变了 —— 检查新格的 rewardId')

    if args.dry_run:
        print('\n[dry-run] 校验通过、硬断言通过，未写盘')
        return 0

    payload = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    PRESET.write_bytes(payload.encode('utf-8'))
    print(f'\n已写 {PRESET}')
    if not args.no_publish:
        targets, warnings = publisher.copy_one(PRESET, dry_run=False)
        for warning in warnings:
            print(f'  ⚠️ {warning}')
        print(f'已发布 {len(targets)} 处：')
        for target in targets:
            print(f'  {target}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
