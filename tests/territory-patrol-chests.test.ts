import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { territoryNeighbors } from '../assets/script/app/territory/model/TerritoryMapConfig';

/**
 * `chapter_02~07` 的「巡逻宝箱野怪」地块（用户 2026-11-11）。
 *
 * > 「每个章节增加 5 关巡逻宝箱野怪地块，每关大约 4~6 个地块格子（在主格子上填写巡逻野怪的 id
 * >  和装饰宝箱 id 69021，参考 chapter01），新增的地块可以替代之前旧的随机格，
 * >  每章最多被替换的随机格不超过 15 个。」
 * > 「同步在 pvp 关卡表中的章节野怪巡逻宝箱 SHEET，补充章节 2~7 4 个等级的宝箱奖励
 * >  （1/2/3/4 级宝箱对应 1/2/3/7 个随机格的奖励数量，奖励类型需要对应所在章节的随机格奖励）。」
 *
 * 这条链路断在哪都不会报错，只会「表现不对」：
 *  · 一片巡逻区的格子 `site.id` 不一致 ⇒ 各算一片，占一格不通关；
 *  · `battleId` 写成 `levelInfo.levelId` ⇒ `TerritoryCampaignRepository` 查不到宝箱组，
 *    「开始挑战」恒灰、点格子弹「站点配置待补齐」；
 *  · 主格漏了 `patrolId` ⇒ 整片没有锚点，锁/银币/建筑一并不画（`territoryPatrolAnchorByCell`）；
 *  · 巡逻格没从 `randomSites.candidateCells` 里删掉 ⇒ 校验器直接拒（同格既固定又随机）。
 *
 * 所以这里逐条钉住：**分组 / 锚点 / 前置 / 随机格让位 / 宝箱表四档奖励**。
 *
 * 2026-11-20 补一条：**地图上展示的野怪 id 必须是该关真实会出的怪** ——
 * > 「在地图上展示的野怪 id 从对应关卡的 npc 队伍配置和塔防出怪表的波次中抽取 1 个」
 * 填一只这关根本不会出现的怪，画面照常出、控制台零报错，只有玩家能发现。
 */

interface ColumnTable {
    index: Map<string, number>;
    rows: unknown[][];
}

/** 读 `assets/remoteRef/*.json` 的列存格式（`{c:1,k:[…],v:[[…]]}`）。 */
function loadColumn(name: string): ColumnTable {
    const raw = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as {
        k: string[];
        v: unknown[][];
    };
    return { index: new Map(raw.k.map((key, offset) => [key, offset])), rows: raw.v };
}

interface RawSite {
    id: string;
    type: string;
    cellId: number;
    footprint: number[];
    battleId?: number;
    patrolId?: number;
    buildingId?: string;
    unlock: { requiredCells: number[]; silverCost: number; exploreSeconds: number; staminaCost: number };
}

interface RawMap {
    rows: number;
    columns: number;
    startCellId: number;
    sites: RawSite[];
    randomSites?: { candidateCells: number[]; rewardPoolId: string; buildingIds?: Record<string, string> };
}

interface MonsterBoxRow {
    monsterBoxId: number;
    monsterBoxGrade: number;
    monsterBoxVictoryRwrad: { resId: number; number: number; pro: number }[];
    monsterBoxLevel: number;
}

const CHAPTERS = [2, 3, 4, 5, 6, 7] as const;
const GROUPS_PER_CHAPTER = 5;
const CELLS_PER_GROUP = 4;
/** `chapter_01` 占掉的宝箱组 id，`chapter_02` 从它后面接。 */
const FIRST_BOX_ID = 1006;
const FIRST_PATROL_LEVEL = 60001;
const PATROL_LEVELS_PER_CHAPTER = 10;
const GRADE_STACK = [1, 2, 3, 7];
const CHEST_BUILDING = '69021';

function loadMap(chapter: number): RawMap {
    return JSON.parse(readFileSync(`assets/resources/config/territory-maps/chapter_0${chapter}.json`, 'utf8')) as RawMap;
}

function loadMonsterBox(): MonsterBoxRow[] {
    const raw = JSON.parse(readFileSync('assets/remoteRef/monsterBox.json', 'utf8')) as {
        k: string[];
        v: unknown[][];
    };
    const index = new Map(raw.k.map((key, offset) => [key, offset]));
    return raw.v.map((row) => ({
        monsterBoxId: Number(row[index.get('monsterBoxId')!]),
        monsterBoxGrade: Number(row[index.get('monsterBoxGrade')!]),
        monsterBoxVictoryRwrad: row[index.get('monsterBoxVictoryRwrad')!] as MonsterBoxRow['monsterBoxVictoryRwrad'],
        monsterBoxLevel: Number(row[index.get('monsterBoxLevel')!]),
    }));
}

function loadRewardPool(rewardId: number): { resId: number; number: number; pro: number }[] {
    const raw = JSON.parse(readFileSync('assets/remoteRef/levelMapGrideReward.json', 'utf8')) as {
        k: string[];
        v: unknown[][];
    };
    const index = new Map(raw.k.map((key, offset) => [key, offset]));
    const row = raw.v.find((item) => Number(item[index.get('rewardId')!]) === rewardId);
    assert.ok(row, `levelMapGrideReward 里没有奖励池 ${rewardId}`);
    return row[index.get('rewardGroup')!] as { resId: number; number: number; pro: number }[];
}

test('★★★chapter_02~07：每章 5 片巡逻宝箱，每片 4 格同一 site.id，且只有一个锚点', () => {
    for (const chapter of CHAPTERS) {
        const map = loadMap(chapter);
        const patrol = map.sites.filter((site) => site.type === 'patrolChest');
        assert.equal(patrol.length, GROUPS_PER_CHAPTER * CELLS_PER_GROUP,
            `chapter_0${chapter} 应有 ${GROUPS_PER_CHAPTER} 片 × ${CELLS_PER_GROUP} 格巡逻格，实际 ${patrol.length}`);

        const groups = new Map<string, RawSite[]>();
        for (const site of patrol) {
            const list = groups.get(site.id) ?? [];
            list.push(site);
            groups.set(site.id, list);
        }
        assert.equal(groups.size, GROUPS_PER_CHAPTER, `chapter_0${chapter} 的巡逻片数不对：${[...groups.keys()]}`);

        for (const [groupId, sites] of groups) {
            assert.equal(sites.length, CELLS_PER_GROUP, `${groupId} 应正好 ${CELLS_PER_GROUP} 格`);
            const cells = sites.map((site) => site.cellId);
            // 主格（锚点）= 唯一配了 patrolId 的那格，且必须带装饰宝箱建筑。
            const anchors = sites.filter((site) => (site.patrolId ?? 0) > 0);
            assert.equal(anchors.length, 1, `${groupId} 必须且只能有一个锚点（配 patrolId 的格）`);
            assert.equal(anchors[0].buildingId, CHEST_BUILDING,
                `${groupId} 的锚点应配装饰宝箱 ${CHEST_BUILDING}（与 chapter_01 同款）`);
            for (const site of sites) {
                if (site === anchors[0]) continue;
                assert.equal(String(site.buildingId ?? ''), '',
                    `${groupId}@${site.cellId} 不是锚点，不该配 buildingId（否则一片长两栋建筑）`);
            }
            // 整片共用一个宝箱组 id（= 一场战斗）。
            const battleIds = new Set(sites.map((site) => site.battleId ?? 0));
            assert.equal(battleIds.size, 1, `${groupId} 的 battleId 必须整片一致：${[...battleIds]}`);
            assert.ok((sites[0].battleId ?? 0) >= FIRST_BOX_ID, `${groupId} 的 battleId 应是宝箱组 id`);
            // 整片共用一个前置格 + 同一套解锁价（与 chapter_01 一样「一格解锁一片」）。
            const required = new Set(sites.map((site) => site.unlock.requiredCells.join(',')));
            assert.equal(required.size, 1, `${groupId} 的前置格必须整片一致：${[...required]}`);
            for (const site of sites) {
                assert.equal(site.unlock.silverCost, 10, `${groupId}@${site.cellId} 解锁银币应为 10`);
                assert.equal(site.unlock.staminaCost, 5, `${groupId}@${site.cellId} 解锁体力应为 5`);
                assert.equal(site.unlock.exploreSeconds, 2, `${groupId}@${site.cellId} 探索秒数应为 2`);
            }
            // 连通（校验器也查，但它是软警告来源，用例里自己再算一遍）。
            const seen = new Set([cells[0]]);
            const stack = [cells[0]];
            while (stack.length) {
                const current = stack.pop()!;
                for (const near of territoryNeighbors(current, map)) {
                    if (cells.includes(near) && !seen.has(near)) {
                        seen.add(near);
                        stack.push(near);
                    }
                }
            }
            assert.equal(seen.size, CELLS_PER_GROUP, `${groupId} 的 ${CELLS_PER_GROUP} 格不连通：${cells}`);
        }
    }
});

test('★★★巡逻格的前置格必须是「有站点占着」的格，而且不能是本片自己', () => {
    for (const chapter of CHAPTERS) {
        const map = loadMap(chapter);
        const byCell = new Map(map.sites.map((site) => [site.cellId, site]));
        for (const site of map.sites) {
            if (site.type !== 'patrolChest') continue;
            const cell = site.unlock.requiredCells[0];
            assert.ok(cell !== undefined, `${site.id}@${site.cellId} 没有前置格`);
            assert.ok(byCell.has(cell), `${site.id}@${site.cellId} 的前置格 ${cell} 没有站点占着 —— 永远解锁不了`);
            assert.ok(!site.footprint.includes(cell), `${site.id}@${site.cellId} 不能拿自己当前置`);
            // 前置指到 `fixedResource` 会被 `isPrerequisiteComplete` 的「可解锁即完成」特例放大
            // （整条推进线塌掉），所以只允许主线站点。
            const prerequisite = byCell.get(cell)!;
            assert.ok(['stage', 'boss'].includes(prerequisite.type),
                `${site.id}@${site.cellId} 的前置格应是主线站点，实际 ${prerequisite.type}`);
        }
    }
});

test('★★★巡逻格必须从随机池里让位（不许同格既固定又随机），且每章替换不超过 15 个', () => {
    for (const chapter of CHAPTERS) {
        const map = loadMap(chapter);
        assert.ok(map.randomSites, `chapter_0${chapter} 应有 randomSites`);
        const candidates = new Set(map.randomSites!.candidateCells);
        const patrolCells = new Set(
            map.sites.filter((site) => site.type === 'patrolChest').map((site) => site.cellId),
        );
        for (const cell of patrolCells) {
            assert.ok(!candidates.has(cell), `chapter_0${chapter} 的 ${cell} 同时是巡逻格和随机格`);
        }
        // `buildingIds` 的 key 必须是候选格，否则那一条配置永远不生效（静默失效）。
        for (const key of Object.keys(map.randomSites!.buildingIds ?? {})) {
            assert.ok(candidates.has(Number(key)),
                `chapter_0${chapter} 的 randomSites.buildingIds.${key} 不是候选格`);
        }
        // 每片 4 格里最多 3 格来自随机池 ⇒ 5 片最多吃掉 15 个随机格。
        assert.ok(candidates.size >= 20,
            `chapter_0${chapter} 随机格只剩 ${candidates.size} 个 —— 被巡逻片吃超了`);
    }
});

test('★★★宝箱表 chapter_02~07：每组 4 个等级，1/2/3/4 级 = 1/2/3/7 个随机格的奖励', () => {
    const boxes = loadMonsterBox();
    const byId = new Map<number, MonsterBoxRow[]>();
    for (const row of boxes) {
        const list = byId.get(row.monsterBoxId) ?? [];
        list.push(row);
        byId.set(row.monsterBoxId, list);
    }
    for (const chapter of CHAPTERS) {
        const pool = loadRewardPool(2001 + chapter);
        for (let index = 0; index < GROUPS_PER_CHAPTER; index += 1) {
            const boxId = FIRST_BOX_ID + (chapter - CHAPTERS[0]) * GROUPS_PER_CHAPTER + index;
            const baseLevel = FIRST_PATROL_LEVEL + (chapter - 1) * PATROL_LEVELS_PER_CHAPTER + index * 2;
            const grades = (byId.get(boxId) ?? []).slice().sort((a, b) => a.monsterBoxGrade - b.monsterBoxGrade);
            assert.equal(grades.length, GRADE_STACK.length, `宝箱组 ${boxId} 应配 4 个等级`);
            for (const row of grades) {
                const stack = GRADE_STACK[row.monsterBoxGrade - 1];
                // 1~3 级打基础关卡，满级（4 级）换下一关 —— 与 chapter_01 的 1001 组同款。
                const expectedLevel = row.monsterBoxGrade < GRADE_STACK.length ? baseLevel : baseLevel + 1;
                assert.equal(row.monsterBoxLevel, expectedLevel,
                    `宝箱组 ${boxId} 的 ${row.monsterBoxGrade} 级应打关卡 ${expectedLevel}`);
                assert.equal(row.monsterBoxVictoryRwrad.length, pool.length,
                    `宝箱组 ${boxId} 的 ${row.monsterBoxGrade} 级奖励条数与章节随机池不一致`);
                row.monsterBoxVictoryRwrad.forEach((entry, offset) => {
                    assert.equal(entry.resId, pool[offset].resId,
                        `宝箱组 ${boxId} 的 ${row.monsterBoxGrade} 级第 ${offset + 1} 条资源类型应与章节随机池一致`);
                    assert.equal(entry.number, pool[offset].number * stack,
                        `宝箱组 ${boxId} 的 ${row.monsterBoxGrade} 级第 ${offset + 1} 条数量应为随机格的 ${stack} 倍`);
                    assert.equal(entry.pro, pool[offset].pro,
                        `宝箱组 ${boxId} 的 ${row.monsterBoxGrade} 级第 ${offset + 1} 条概率不该被放缩`);
                });
            }
        }
    }
});

test('★★★地图上的 battleId 全部能在宝箱表里查到（查不到就是「开始挑战」恒灰）', () => {
    const boxes = new Set(loadMonsterBox().map((row) => row.monsterBoxId));
    for (const chapter of CHAPTERS) {
        for (const site of loadMap(chapter).sites) {
            if (site.type !== 'patrolChest') continue;
            assert.ok(boxes.has(site.battleId ?? 0),
                `chapter_0${chapter} 的 ${site.id}@${site.cellId} battleId=${site.battleId} 不在 monsterBox 表里`);
        }
    }
});

test('★★★七章的 battleId 互不重复（一片带一片，串了就是两章打同一关）', () => {
    const owner = new Map<number, string>();
    for (const chapter of CHAPTERS) {
        for (const site of loadMap(chapter).sites) {
            if (site.type !== 'patrolChest') continue;
            const key = `${site.id}@chapter_0${chapter}`;
            const previous = owner.get(site.battleId ?? 0);
            if (previous) {
                // 同一片的多格共享 battleId 是正常的；不同片撞了才是错。
                assert.equal(previous, key, `battleId ${site.battleId} 被两片巡逻区共用：${previous} / ${key}`);
                continue;
            }
            owner.set(site.battleId ?? 0, key);
        }
    }
    assert.equal(owner.size, CHAPTERS.length * GROUPS_PER_CHAPTER, '七章应共有 30 个互不相同的宝箱组');
});

/**
 * 用户 2026-11-20：「在地图上展示的野怪 id 从对应关卡的 npc 队伍配置和塔防出怪表的波次中抽取 1 个」。
 *
 * 链路：`site.battleId`（宝箱组）→ `monsterBox` 最低等级行的 `monsterBoxLevel` →
 * `levelInfo` 的 `extraCards.enemy`（NPC 队伍）+ `levelModValue`（塔防出怪组）。
 *
 * 断在哪都不报错：
 *  · 填了别的关的怪 ⇒ 地图上站的和实际打的对不上；
 *  · 填了 `monsterCard` 里没 `unitPrefabPath` 的 id ⇒ `TerritoryChapterLoader` 抛
 *    「巡逻野怪 X 缺少 unitPrefabPath」，整章加载失败；
 *  · 只对了一半（比如只取 `levelMonsterGroup` 不看出怪表）⇒ 波次改过就对不上。
 */
test('★★★地图上的野怪 id 必须来自对应关卡的 NPC 队伍 ∧ 塔防波次', () => {
    const box = loadColumn('monsterBox');
    const level = loadColumn('levelInfo');
    const team = loadColumn('npcTeam');
    const wave = loadColumn('defenceModWave');
    const card = loadColumn('monsterCard');

    // 宝箱组 → 最低等级那行（`patrolLevelIdMapOf` 同口径）。
    const lowestLevelOfBox = new Map<number, { grade: number; levelId: number }>();
    for (const row of box.rows) {
        const boxId = Number(row[box.index.get('monsterBoxId')!]);
        const grade = Number(row[box.index.get('monsterBoxGrade')!]);
        const levelId = Number(row[box.index.get('monsterBoxLevel')!]);
        const current = lowestLevelOfBox.get(boxId);
        if (!current || grade < current.grade) lowestLevelOfBox.set(boxId, { grade, levelId });
    }

    const levelById = new Map(level.rows.map((row) => [Number(row[level.index.get('levelId')!]), row]));
    const cardsByTeam = new Map(
        team.rows.map((row) => [
            Number(row[team.index.get('npcTeamId')!]),
            ((row[team.index.get('npcCard')!] as Array<number | { cardID: number }>) ?? []).map((entry) =>
                Number(typeof entry === 'number' ? entry : entry.cardID)),
        ]),
    );
    const wavesByStart = new Map<number, { waveId: number; monsterId: number }[]>();
    for (const row of wave.rows) {
        const startId = Number(row[wave.index.get('startId')!]);
        const list = wavesByStart.get(startId) ?? [];
        list.push({
            waveId: Number(row[wave.index.get('waveId')!]),
            monsterId: Number(row[wave.index.get('monsterId')!]),
        });
        wavesByStart.set(startId, list);
    }
    const hasPrefab = new Set(
        card.rows
            .filter((row) => typeof row[card.index.get('unitPrefabPath')!] === 'string'
                && (row[card.index.get('unitPrefabPath')!] as string).length > 0)
            .map((row) => Number(row[card.index.get('id')!])),
    );

    let checked = 0;
    for (const chapter of [1, ...CHAPTERS]) {
        for (const site of loadMap(chapter).sites) {
            if (site.type !== 'patrolChest' || !site.patrolId) continue;
            const lowest = lowestLevelOfBox.get(site.battleId ?? 0);
            assert.ok(lowest, `chapter_0${chapter} 的 ${site.id} battleId=${site.battleId} 不在 monsterBox 里`);
            const levelRow = levelById.get(lowest!.levelId);
            assert.ok(levelRow, `关卡 ${lowest!.levelId} 不在 levelInfo 里`);

            const extra = levelRow![level.index.get('extraCards')!] as { enemy?: number } | undefined;
            const npcCards = cardsByTeam.get(Number(extra?.enemy ?? 0)) ?? [];
            const waves = (wavesByStart.get(Number(levelRow![level.index.get('levelModValue')!])) ?? [])
                .slice()
                .sort((a, b) => a.waveId - b.waveId)
                .map((item) => item.monsterId);

            assert.ok(npcCards.length > 0 || waves.length > 0,
                `关卡 ${lowest!.levelId} 既没有 NPC 队伍也没有塔防波次 —— 巡逻怪无处可取`);

            const where = `${site.id}@chapter_0${chapter}（关卡 ${lowest!.levelId}）`;
            assert.ok(npcCards.includes(site.patrolId!) || waves.includes(site.patrolId!),
                `${where} 的 patrolId=${site.patrolId} 既不在 NPC 队伍 ${JSON.stringify(npcCards)}`
                + ` 也不在塔防波次 ${JSON.stringify(waves)} 里`);
            // 两个来源有交集时取交集里的最后一只（= BOSS 波，与 `patrol_monster_source.pick_patrol_id` 同口径）。
            const common = waves.filter((monsterId) => npcCards.includes(monsterId));
            if (common.length > 0) {
                assert.equal(site.patrolId, common[common.length - 1],
                    `${where} 应取「NPC 队伍 ∧ 塔防最后一波」的那只 ${common[common.length - 1]}`);
            }
            assert.ok(hasPrefab.has(site.patrolId!),
                `${where} 的 patrolId=${site.patrolId} 在 monsterCard 里没有 unitPrefabPath（整章加载会抛错）`);
            checked += 1;
        }
    }
    assert.equal(checked, 7 * GROUPS_PER_CHAPTER, `七章应有 ${7 * GROUPS_PER_CHAPTER} 片巡逻区各一只怪`);
});
