import { ZC_RUNTIME_CONFIG } from '../assets/script/app/zcds/model/ZCRuntimeConfigStore';
/**
 * 布阵卡池（`loadPvpHeroCards`）的「缺配置」告警口径。
 *
 * 背景（2026-11-10 线上误报）：进布阵页时控制台稳定打一条
 *   `[CardLineupDecks] 后端英雄在 pvpCard 中没有对应配置 ["2002"]`
 * 2002 是 `pvpCard` 里的**主城** —— 它确实在表里，只是被 `isHqCard` 正常筛掉了
 * （主城是场地固有建筑，不是能打出去的卡）。老实现用「已收集到的卡」求差集，
 * 于是「表里有、但不可上阵」的卡被算成「表里没有」，看着像丢了张卡。
 *
 * 这里钉三件事：
 *  - 主城进后端列表 **不** 产生告警，也不进卡池；
 *  - 真正表里没有的 heroId **必须** 产生告警（别把判据改成永真）；
 *  - 卡池内容仍是「后端拥有的 ∩ 表」，图鉴那套（全表）不受影响。
 *
 * `CardLineupDecks` 依赖 `RefUtil`（引 `cc`），所以整模块跑在 `node:vm` 里，
 * 只把读表换成本地真表 —— 解析走的是**真** `parseCardCatalogRow`。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as Catalog from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { isHqCard, parseCardCatalogRow } from '../assets/script/app/zcds/model/ZCPvpTableParser';
import * as RuntimeConfig from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { resolveSelectedDeck } from '../assets/script/app/card/LineupPresets';

/** 真表：`assets/remoteRef/pvpCard.json`（列存 `{k,v}`）。 */
function readRows(name: string): Record<string, unknown>[] {
    const raw = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Record<string, unknown>[]
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(raw)) return raw;
    return raw.v.map((row) => Object.fromEntries(raw.k.map((key, i) => [key, row[i]])));
}

type Decks = {
    loadPvpHeroCards: (infos: ReadonlyArray<{ heroId: number }>) => Promise<ReadonlyArray<{ id: string; name: string }>>;
    loadPvpCatalogCards: () => Promise<ReadonlyArray<{ id: string; name: string }>>;
};

/** 把真实模块跑起来：`RefUtil` 换成喂真表的桩，解析用真 `ZCGameRuntimeConfig`。 */
function loadDecksModule(): { module: Decks; warnings: unknown[][] } {
    const warnings: unknown[][] = [];
    const moduleExports: Record<string, unknown> = {};
    const rows = { pvpCard: readRows('pvpCard'), pvpBond: readRows('pvpBond') } as Record<string, unknown[]>;

    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/card/CardLineupDecks.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, {
        exports: moduleExports,
        require: (id: string) => {
            if (id.endsWith('framework/ref/RefUtil')) {
                return { RefUtil: { instance: { getRefAllAsync: async (table: string) => rows[table] ?? [] } } };
            }
            if (id.endsWith('ZCRuntimeConfigStore')) return { ZC_RUNTIME_CONFIG };
            if (id.endsWith('ZCCombatCatalog')) return Catalog;
            if (id.endsWith('ZCGameRuntimeConfig')) return RuntimeConfig;
            throw new Error(`未预料的依赖：${id}`);
        },
        console: { log() {}, warn: (...args: unknown[]) => { warnings.push(args); } },
    });
    return { module: moduleExports as unknown as Decks, warnings };
}

test('主城（2002）在后端英雄列表里时不产生「没有对应配置」告警，也不进卡池', async () => {
    const { module, warnings } = loadDecksModule();
    const cards = await module.loadPvpHeroCards([{ heroId: 2002 }, { heroId: 68028 }]);

    //  vm 里造出来的数组原型与宿主不同，`deepEqual` 会因原型差异失败 ⇒ 逐个取值比。
    assert.equal(cards.length, 1, '只该有真正拥有且可上阵的卡');
    assert.equal(cards[0].id, '68028');
    assert.equal(cards[0].name, '饥饿战士');
    assert.equal(warnings.length, 0,
        `主城被 HQ 规则筛掉不该被当成「表里没配」，实际告警 ${JSON.stringify(warnings)}`);
});

test('表里真没有的 heroId 仍然要告警（判据不能改成永真）', async () => {
    const { module, warnings } = loadDecksModule();
    const cards = await module.loadPvpHeroCards([{ heroId: 68028 }, { heroId: 999999 }]);

    assert.equal(cards.length, 1, '坏 id 只是告警，不影响其余卡');
    assert.equal(cards[0].id, '68028');
    assert.equal(warnings.length, 1, '应当且只应当告警一次');
    const [message, ids] = warnings[0] as [string, ArrayLike<string>];
    assert.equal(message, '[CardLineupDecks] 后端英雄在 pvpCard 中没有对应配置');
    //  展开成宿主数组再比，同时确认是 id 数组而不是被降级的 `[Set]`
    assert.deepEqual(Array.from(ids), ['999999'], '告警里只报真正缺配置的 id，且必须是数组');
});

test('图鉴口径不受影响：全表可浏览（含未拥有的卡）', async () => {
    const { module } = loadDecksModule();
    const catalog = await module.loadPvpCatalogCards();
    const ids = catalog.map((card) => card.id);

    assert.ok(ids.includes('68028'), '饥饿战士必须出现在图鉴里');
    assert.ok(!ids.includes('2002'), '主城不是卡，图鉴里也不该有');
    // 图鉴 = 全表减主城：真表 37 行，去掉主城 2002 应是 36
    const tableCount = readRows('pvpCard').filter((row) => String(row.id) !== '2002').length;
    assert.equal(ids.length, tableCount, '图鉴应包含表里每一张非主城的启用卡');
});

/**
 * 现场症状：「某张卡的站台空着 / 阵容少一格」，看起来像这张卡丢了。
 *
 * 实际成因：后端选中阵型里含一个**客户端解不出**的 id（最典型是老阵型里的主城 `2002` ——
 * 它是 `pvpCard` 的一行，后端当英雄下发，客户端 `isHqCard` 当建筑摘掉）。
 * `resolveHeroIds` 是**压缩**而不是留空：跳过之后后面的卡整体前移，空出来的永远是最后几格。
 * 八卡按位置铺（`slots[index] = deck[index]`），所以第 8 格 `setEmpty()` 整格收起。
 */
test('阵型里带主城（2002）⇒ 八卡只剩七张，最后一格被收起（不是卡丢了）', () => {
    const cards = readRows('pvpCard')
        .map((row) => parseCardCatalogRow(row))
        .filter((card) => !isHqCard(card));
    // 真表里的七张可用卡 + 老阵型里那个解不出的主城 id
    const realIds = ['68001', '68002', '68003', '68004', '68005', '68006', '68007'];
    for (const id of realIds) assert.ok(cards.some((card) => card.id === id), `${id} 应能解析`);

    const warnings: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    let picked: readonly { id: string }[] | null;
    try {
        picked = resolveSelectedDeck({
            deck: cards,
            pool: cards,
            formations: [{ formationId: 1, heroIds: [2002, ...realIds.map(Number)], selected: true }],
        });
    } finally {
        console.warn = original;
    }

    assert.ok(picked, '选中的阵型应当解析出卡组');
    assert.equal(picked.length, 7, '主城被摘掉 ⇒ 八卡只剩七张，第 8 个站台会被 setEmpty');
    //  压缩而不是留空：后面的卡整体前移，第一格是 68001 而不是空
    assert.equal(picked[0].id, '68001', '跳过会左移，空出来的是最后一格');
    assert.equal(picked[6].id, '68007');

    assert.equal(warnings.length, 1, '必须有一条告警把现场引到正确方向');
    const [message, formationId, missing] = warnings[0] as [string, number, ArrayLike<number>];
    assert.match(message, /卡位会被跳过/);
    assert.match(message, /不是卡丢了/, '这条日志的作用就是防止把「少一格」误读成「卡丢了」');
    assert.equal(formationId, 1);
    assert.deepEqual(Array.from(missing), [2002]);
});
