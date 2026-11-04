/**
 * 英雄 tab 切页成本的三条护栏（2026-11-03 实测归因后加的）。
 *
 * 背景：英雄页没有页面缓存，每切一次 = 整页重建 + `presentLineup` 原子提交。
 * 实测（`tmp/_hero_tab_cost_probe.mjs`、`tmp/_bench_cardlevelup.mjs`）：
 *   - 8 个 `sp.Skeleton` 单位模型实例化 11.1~18.0ms（资源已缓存也要付）；
 *   - 36 张卡各建一次 `cardLevelUp` 表（1785 行）共 12.03ms，复用一张表 0.40ms；
 *   - 切 tab 的预取与页面自己取数各发一次 `CmdFormationInfo`。
 *
 * 三处都改成「别再重复干」，这里用源码形态守住，防止被顺手改回去：
 * 服务层（`FormationService`）经 `GameNet` 拉进 `cc`，在 Node 里 import 就炸，
 * 所以和 `formation-board.test.ts` 同一套做法 —— 只读源码断言关键写法。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string => readFileSync(path, 'utf8');
const count = (source: string, pattern: RegExp): number => (source.match(pattern) ?? []).length;

test('卡库升级状态复用同一张 cardLevelUp 表（36 张卡不建 36 次）', () => {
    const repository = read('assets/script/app/card/CardRepository.ts');

    // 建表只能有一处（在 `levelUpTableOf` 里）；解析到 0 处说明改名/搬走了，这条就失效了。
    const builds = count(repository, /buildCardLevelUpTable\(/g);
    assert.ok(builds >= 1, '找不到 buildCardLevelUpTable 调用，护栏已失效');
    assert.equal(builds, 1, '建表只允许一处：`loadUpgradeStatus` 每张卡建一次会白烧 12ms');

    // 缓存按 rows 引用命中：`RefUtil` 返回同一份冻结数组，换对象自然重建。
    assert.match(repository, /cached\.rows === rows/, '表缓存必须按 rows 引用判定，否则永远不命中');
    assert.match(repository, /evaluateUpgrade\(this\.levelUpTableOf\(rows\)/, '`loadUpgradeStatus` 要走缓存入口');
});

test('上阵单位模型逐帧补，不和整页数据挤在同一帧', () => {
    const page = read('assets/script/app/card/CardLineupPage.ts');

    // 每帧补几个必须是个正数常量；0 或缺失意味着退回「一帧全建」。
    const limit = page.match(/SLOT_PREVIEWS_PER_FRAME\s*=\s*(\d+)/);
    assert.ok(limit, '找不到 SLOT_PREVIEWS_PER_FRAME');
    assert.ok(Number(limit[1]) > 0, '每帧补的模型数必须 > 0');
    assert.ok(Number(limit[1]) <= 4, '每帧补太多就等于没分帧');

    // 提交那一帧只画静态立绘：prefab 进队列，不进 render。
    assert.match(page, /pendingPreviews\.push\(\{ slot: slots\[index\], prefab \}\)/,
        'commitSlots 必须把 prefab 放进待补队列');
    assert.doesNotMatch(page, /\.render\(item\.card, item\.frames, this\.levelOf\(item\.card\), item\.prefab\)/,
        'prefab 不能直接传给 render —— 八个 Spine 模型会回到同一帧');

    // 新一轮提交要作废上一轮没补完的模型，否则旧卡的模型会挂到新阵容上。
    assert.match(page, /this\.pendingPreviews\.length = 0;\s*\n\s*for \(let index = 0/, 'commitSlots 必须先清空队列');
    assert.match(page, /this\.schedule\(this\.flushPreviews\)/,
        '必须使用逐帧调度；scheduleOnce 回调重注册自身会被引擎删除，后六个模型永远不补');
    assert.match(page, /this\.unschedule\(this\.flushPreviews\)/, '队列耗尽后必须停止调度');
    assert.doesNotMatch(page, /this\.scheduleOnce\(this\.flushPreviews\)/);
});

test('站台把「补模型」拆成独立入口，静态立绘兜底还在', () => {
    const slot = read('assets/script/app/card/CardLineupSlot.ts');

    assert.match(slot, /applyPreview\(prefab: Prefab \| null\): boolean/,
        '`applyPreview` 是分帧补模型的入口，签名不能变（页面据此判断成没成）');
    assert.match(slot, /if \(!this\.applyPreview\(prefab \?\? null\)\) applyCardHeroArt\(this\.hero, this\.heroTransform, frames\.hero\)/,
        '给不出待机动画时必须回落到静态立绘（与拆分前同口径）');
});

test('阵容页复用切 tab 预取的阵型，不再为同一份数据多等一个 RTT', () => {
    const service = read('assets/script/app/card/FormationService.ts');
    const repository = read('assets/script/app/card/CardRepository.ts');

    assert.match(service, /readonly maxAgeMs\?: number/, '`fetchFormations` 必须支持新鲜期');
    assert.match(service, /maxAgeMs > 0 && cachedFormations !== null && Date\.now\(\) - cachedAt <= maxAgeMs/,
        '新鲜期判定要在发请求之前');
    // 缓存被写过的每一处都要刷新时间戳，否则新鲜期会拿旧数据的年龄算。
    assert.ok(count(service, /cachedAt = Date\.now\(\);/g) >= 3,
        'cachedAt 必须在 requestFormations / applyFormation / selectFormation 三处都刷新');

    assert.match(repository, /fetchFormations\(\{ label: '阵容页首屏阵型', maxAgeMs: FORMATION_PREFETCH_FRESH_MS \}\)/,
        '`loadLineup` 必须带 maxAgeMs，否则 prefetchHero 那次就白拉了');
});
