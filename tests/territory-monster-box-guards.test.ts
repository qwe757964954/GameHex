/**
 * 巡逻宝箱「守护怪」头像 —— 真表链路：`levelMonsterGroup` → `monsterCard.headIcon` → `icon.json` → 资源。
 *
 * 用户原话（2026-11-22，配图 = `GuardRow` 三个格子）：
 * 「守护怪要读取 levelInfo.json 中的 `levelMonsterGroup` 字段，展示对应 id 的头像 `headIcon`」。
 *
 * ## 为什么必须拿真表钉
 *
 * 这条链有**四跳**，每一跳错了都零报错、只是「格子空着」或「图不对」：
 *
 * 1. `monsterBox.monsterBoxLevel`（宝箱这一级打哪一关）→ 2. `levelInfo[levelId].levelMonsterGroup`
 * （这一关出哪些怪）→ 3. `monsterCard[id].headIcon`（中文图标名，**不是路径**）
 * → 4. `icon.json[名字].path` = `ui://图标_兵种_头像/<拼音>` ⇒ 资源在 `icons/cardHead/<拼音>.png`。
 *
 * 用假数据测不出第 1、4 跳：真表里 `monsterBoxLevel` 是 `600xx`（不是 `100xx`），
 * 而第 4 跳的包名映射（`图标_兵种_头像` → `icons/cardHead`）只在 `ArtPaths` 里有一份。
 *
 * ## 判据
 *
 * 全部 70 个巡逻关卡（`60001~60070`，= `monsterBox` 表里用到的全部等级行）都要满足：
 * 守护怪 ≥ 面板格数（3）、每一只都能解析出 `headIcon`、`headIcon` 能在 `icon.json` 里查到、
 * 查到的资源文件真的在盘上。少一条就是「上线后格子里只有占位图」。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readRefRows } from './helpers/ref-kvc';
import { assetExists } from './helpers/asset-paths';
import { createIconArtResolver } from '../assets/script/app/HeadArtModel';
import {
    readLevelMonsterGroup,
    readTerritoryGuardMonsters,
    type TerritoryCardRow,
    type TerritoryLevelRow,
} from '../assets/script/app/territory/model/TerritoryCampaignConfig';
import { TERRITORY_MONSTER_BOX_SPEC } from '../assets/script/app/territory/model/TerritoryMonsterBoxSpec';
import { readTerritoryMonsterBoxGroups } from '../assets/script/app/territory/model/TerritoryMonsterBoxConfig';

/** `monsterBox` 表里所有「这一级的关卡」—— 宝箱面板可能落到的全部关卡。 */
function patrolLevelIds(): number[] {
    const groups = readTerritoryMonsterBoxGroups(readRefRows('monsterBox'));
    const ids = new Set<number>();
    for (const group of groups.values()) {
        for (const grade of group.grades) {
            if (grade.levelId > 0) ids.add(grade.levelId);
        }
    }
    return Array.from(ids).sort((a, b) => a - b);
}

test('★★70 个巡逻关卡都有 ≥3 只守护怪，且每只都能查到 headIcon', () => {
    const levels = readRefRows('levelInfo') as unknown as TerritoryLevelRow[];
    const monsters = readRefRows('monsterCard') as unknown as TerritoryCardRow[];
    const byLevel = readTerritoryGuardMonsters(levels, monsters);

    const levelIds = patrolLevelIds();
    assert.ok(levelIds.length >= 70, `monsterBox 表只有 ${levelIds.length} 个关卡，表被删了？`);

    const missingGroup: number[] = [];
    const missingIcon: string[] = [];
    for (const levelId of levelIds) {
        const guards = byLevel.get(levelId);
        if (!guards || guards.length < TERRITORY_MONSTER_BOX_SPEC.guardCount) {
            missingGroup.push(levelId);
            continue;
        }
        for (const guard of guards.slice(0, TERRITORY_MONSTER_BOX_SPEC.guardCount)) {
            // 空串就是「这一格没有头像」⇒ 面板只能显示占位图，等于需求没做到
            if (guard.headIcon === '') missingIcon.push(`${levelId}:${guard.monsterId}`);
        }
    }
    assert.deepEqual(missingGroup, [], '这些巡逻关的 levelMonsterGroup 少于 3 只怪');
    assert.deepEqual(missingIcon, [], '这些怪的 monsterCard.headIcon 是空的');
});

test('★★每只守护怪的 headIcon 都能在 icon.json 里解析出真实存在的图', () => {
    const levels = readRefRows('levelInfo') as unknown as TerritoryLevelRow[];
    const monsters = readRefRows('monsterCard') as unknown as TerritoryCardRow[];
    const byLevel = readTerritoryGuardMonsters(levels, monsters);
    const resolver = createIconArtResolver(readRefRows('icon'));

    const unresolved: string[] = [];
    const noAsset: string[] = [];
    for (const levelId of patrolLevelIds()) {
        for (const guard of byLevel.get(levelId) ?? []) {
            const target = resolver.resolve(guard.headIcon);
            if (!target) {
                unresolved.push(`${levelId}:${guard.headIcon}`);
                continue;
            }
            // 兵种头像走 `icons/cardHead`（main-pages 分包），资源名 = ui:// 路径末段
            if (!assetExists(`${target.root}/${target.art}.png`)) {
                noAsset.push(`${levelId}:${target.root}/${target.art}.png`);
            }
        }
    }
    assert.deepEqual(unresolved, [], '这些 headIcon 在 icon 表里查不到（图标名写错 / 表没导）');
    assert.deepEqual(noAsset, [], '这些头像在分包目录里找不到文件');
});

test('levelMonsterGroup 的脏条目只丢那一条（不整列丢）', () => {
    assert.deepEqual(readLevelMonsterGroup([{ monsterId: 50014, number: 44 }, { monsterId: 0 }, { number: 3 }]), [50014]);
    // 转表器把空列表写成 `{}` 的老坑：不能抛，只能当没配
    assert.deepEqual(readLevelMonsterGroup({}), []);
    assert.deepEqual(readLevelMonsterGroup(null), []);
});

test('守护怪顺序照表走（面板三格按 levelMonsterGroup 的先后）', () => {
    const rows = [{
        levelId: 60001,
        levelMonsterGroup: [{ monsterId: 50014 }, { monsterId: 50021 }, { monsterId: 50022 }],
    }] as unknown as TerritoryLevelRow[];
    const monsters = [
        { id: 50022, name: 'C', type: 1, enabled: 1, headIcon: '头像C' },
        { id: 50014, name: 'A', type: 1, enabled: 1, headIcon: '头像A' },
        { id: 50021, name: 'B', type: 1, enabled: 1, headIcon: '头像B' },
    ] as unknown as TerritoryCardRow[];
    assert.deepEqual(readTerritoryGuardMonsters(rows, monsters).get(60001), [
        { monsterId: 50014, headIcon: '头像A' },
        { monsterId: 50021, headIcon: '头像B' },
        { monsterId: 50022, headIcon: '头像C' },
    ]);
});
