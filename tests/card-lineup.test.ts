import * as combatCatalog from '../assets/script/app/zcds/model/ZCCombatCatalog';
import * as runtimeConfig from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { ZC_RUNTIME_CONFIG } from '../assets/script/app/zcds/model/ZCRuntimeConfigStore';
import { cardArtConfig } from './helpers/card-art-config';
/** 卡牌解析、固定阵容的职业/阵营计数与羁绊展示。线上卡库与预览取数另验真实实现。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import {
    activeBondTitle,
    bondPercentTotal,
    resolveCardCamp,
    resolveCardClass,
    tallyDeckClasses,
    tallyDeckIcons,
    visibleIconTallies,
    ZC_CARD_CAMPS,
    ZC_CARD_CLASSES,
} from '../assets/script/app/card/CardLineupTypes';
import { CARD_LINEUP_TEXTS } from '../assets/script/app/card/CardLineupTexts';
import {
    calculateDeckBonuses,
    cardTypeToBuilding,
    ZCCardType,
    ZCDeckBonuses,
    ZCDeckCard,
} from '../assets/script/app/zcds/model/ZCCombatCatalog';
import {
    isHqCard,
    normalizeCardRow,
    parseCardCatalogRow,
    parseBondRules,
    parseCard,
    parseUnits,
} from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { assetPath } from './helpers/asset-paths';

/** 读 remoteRef 的列存表（`{k, v, c}`）→ 行对象数组。 */
function readPvpRef(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as { k: string[]; v: unknown[][] };
    return source.v.map((row) => {
        const entry: Record<string, unknown> = {};
        source.k.forEach((key, index) => { entry[key] = row[index]; });
        return entry;
    });
}

/** 固定八卡夹具验证计数与羁绊；线上卡组已改由后端下发，不再从已删除的 deck 列推导。 */
function deckRows(): Array<Record<string, unknown>> {
    const players: Array<[string, string, string, number]> = [
        ['2001', '金矿', '', 6], ['66001', '熊猫人', '战士', 8],
        ['60016', '火法师', '法师', 6], ['66003', '精灵弓箭手', '射手', 13],
        ['66011', '测试射手', '射手', 8], ['66007', '测试战士', '战士', 8],
        ['68006', '测试坦克', '坦克', 8], ['68004', '骷髅战士', '坦克', 8],
    ];
    const row = (id: string, name: string, attack: string, camp: string, cycle: number, index: number) => ({
        id, name, enabled: 1, type: id === '2001' ? 1 : 2, rarity: index % 4 + 1,
        unitId: id === '2001' ? null : id, baseHp: 100,
        traits: attack ? { attack, camp } : undefined,
        goldDigTime: cycle, soilderAddTime: cycle, buildAttackTime: cycle,
    });
    return [
        ...players.map(([id, name, attack, cycle], index) => row(id, name, attack, '花果', cycle, index)),
        ...Array.from({ length: 8 }, (_, index) => row(String(69002 + index), `敌方${index}`,
            index < 2 ? '战士' : index < 6 ? '法师' : '射手', index < 3 ? '花果' : '蘑菇', 40, index)),
        { id: '2002', name: '主城', enabled: 1, type: 5, rarity: 1, baseHp: 100, cycleSeconds: 1 },
    ];
}

function buildFixtureDecks(): { player: ZCDeckCard[]; enemy: ZCDeckCard[] } {
    const parse = (row: Record<string, unknown>) => parseCard(normalizeCardRow(row));
    return { player: deckRows().slice(0, 8).map(parse), enemy: deckRows().slice(8, 16).map(parse) };
}

const neutral = (): ZCDeckBonuses => ({
    activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
    moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1,
});

test('normalizeCardRow 把表里的数字 enabled 归一化成布尔（否则整表被过滤空）', () => {
    const rows = readPvpRef('pvpCard');
    // 36 张卡池（含末行 enabled=0 的占位卡「民兵」）+ 16 张出战卡 + 1 行主城 = 38 行
    assert.equal(rows.length, 37);
    assert.equal(deckRows().length, 17, '固定夹具含玩家 8 + 敌方 8 + 主城 1');

    // 原始行直接交给 parseCard：enabled 是数字 1，严格判等拿不到 true —— 这就是当初的坑
    const rawParsed = deckRows().map(parseCard);
    assert.ok(rawParsed.every((card) => card.enabled === false), '原始行应当全部被判为未启用（说明必须先归一化）');

    // 归一化后：17 行全部启用（主城也带 enabled=1，它在下游再被 isHqCard 摘掉）
    const fixed = deckRows().map((row) => parseCard(normalizeCardRow(row)));
    assert.equal(fixed.filter((card) => card.enabled).length, 17);

    // 主城行确实混在「玩家默认」里 —— 所以下游那道 isHqCard 不能省
    assert.equal(fixed.filter(isHqCard).length, 1, '表里恰好一行主城');
    assert.equal(buildFixtureDecks().player.length, 8, '摘掉主城后玩家才是 8 张');

    // 归一化的具体口径
    const normalized = normalizeCardRow({ deck: '玩家默认', enabled: 1, unitId: '', description: '' });
    assert.equal(normalized.enabled, true);
    assert.equal(normalized.unitId, null, '空串 ref 应归一成 null');
    assert.equal(normalized.description, null);
    assert.equal(normalizeCardRow({ enabled: 0 }).enabled, false);
    assert.equal(normalizeCardRow({ enabled: '1' }).enabled, true);
    assert.equal(normalizeCardRow({ enabled: null }).enabled, false);
});

test('pvpCard 三类工作倒计时按卡牌类型同步到 cycleSeconds', () => {
    const parsed = deckRows().map((row) => parseCard(normalizeCardRow(row)));
    const byId = (id: string) => parsed.find((card) => card.id === id)!;

    assert.equal(byId('2001').cycleSeconds, 6, '金矿读取 goldDigTime');
    assert.equal(byId('66001').cycleSeconds, 8, '兵营读取 soilderAddTime');
    assert.equal(byId('60016').cycleSeconds, 6, '兵营读取 soilderAddTime');
    assert.equal(byId('66003').cycleSeconds, 13, '兵营读取 soilderAddTime');
    assert.equal(byId('69002').cycleSeconds, 40, '2026-09-16 起敌方首卡也改成了兵营');

    // 表里现在全是 barracks，没有 tower 卡了 —— 用合成行锁住「按 type 取对应列」这条逻辑
    const source = deckRows().find((row) => String(row.id) === '66001')!;
    const distinguishColumns = parseCard(normalizeCardRow({
        ...source,
        soilderAddTime: 9,
        buildAttackTime: 3,
        goldDigTime: 4,
    }));
    assert.equal(distinguishColumns.cycleSeconds, 9, '兵营不能误读其它两类倒计时');

    const towerRow = parseCard(normalizeCardRow({
        ...source, type: ZCCardType.Tower, soilderAddTime: 0, buildAttackTime: 0.8, goldDigTime: 0,
    }));
    assert.equal(towerRow.cycleSeconds, 0.8, '防御塔读 buildAttackTime');

    //  必须显式标注成 Record：展开 `Record<string, unknown>` 时 TS 只会保留显式写出的键，
    //    不标注就会被推成 `{ cycleSeconds: number }`，下面 delete 三列会报 TS2339。
    const legacy: Record<string, unknown> = { ...source, cycleSeconds: 5 };
    delete legacy.soilderAddTime;
    delete legacy.buildAttackTime;
    delete legacy.goldDigTime;
    assert.equal(parseCard(normalizeCardRow(legacy)).cycleSeconds, 5, '继续兼容旧 cycleSeconds 字段');
});

test('type 是数字 1=金矿 2=兵营 3=防御塔 4=城墙 5=主城，且城墙不落地为建筑', () => {
    const rows = deckRows();
    const byId = (id: string) => rows.find((row) => String(row.id) === id)!;

    assert.equal(parseCard(normalizeCardRow(byId('2001'))).type, ZCCardType.Mine, '金矿行 type=1');
    assert.equal(parseCard(normalizeCardRow(byId('66001'))).type, ZCCardType.Barracks, '兵营行 type=2');

    for (const type of ['mine', 'hq']) {
        assert.throws(() => parseCard(normalizeCardRow({ ...byId('2001'), type })), /type 必须是/);
    }

    // 卡类型 → 格子建筑：城墙的耐久挂在「边」上，不占 hex.building
    assert.equal(cardTypeToBuilding(ZCCardType.Mine), 'mine');
    assert.equal(cardTypeToBuilding(ZCCardType.Barracks), 'barracks');
    assert.equal(cardTypeToBuilding(ZCCardType.Tower), 'tower');
    assert.equal(cardTypeToBuilding(ZCCardType.Hq), 'hq');
    assert.equal(cardTypeToBuilding(ZCCardType.Wall), null);

    // 认不出的类型要当场报错，别静默当成兵营
    assert.throws(() => parseCard(normalizeCardRow({ ...byId('2001'), type: 9 })), /type 必须是/);
});

test('parseUnits 只收「预设 + 技能」齐备的兵种卡行（建筑卡不进单位目录）', () => {
    const skills = new Map([
        [30151, { skillId: 30151, name: '测试普攻', mode: 'melee' as const }],
    ]);
    // 合表（2026-09-20）后单位属性内联在**卡行**上，列名统一加 `unit` 前缀。
    const units = parseUnits([
        {
            id: '1001', name: '测试射手', unitId: '1001',
            unitMaxHp: 60, unitAttack: 12, unitMoveSpeed: 32,
            unitAttackRange: 300, unitAttackInterval: 2, unitAttackDuration: 0.667, unitAttackHitTime: 0.345,
            unitPrefabPath: 'units/测试射手/测试射手', unitSkillId: 30151,
        },
        // 建筑卡（主城 / 金矿）单位列两列都空 → 照旧跳过；建筑耐久已改由卡表 `baseHp` 提供，
        // 单位目录里不再有「建筑行」这条岔路。
        { id: '2001', name: '金矿', unitId: null, baseHp: 420 },
    ], skills);

    assert.equal(units.size, 1, '建筑卡不进单位目录');
    assert.equal(units.has('2001'), false);
    assert.equal(units.has('1001'), true);

    // 「只填一半」必须当场抛错 —— 这是合表后最容易犯的错（加新卡时漏一列），
    // 且崩点会被推到很远（第一次出兵才炸）。守卫见 `tests/pvp-card-unit-columns.test.ts`。
    assert.throws(
        () => parseUnits([
            { id: '1002', name: '半张卡', unitId: '1002', unitMaxHp: 60, unitAttack: 12, unitMoveSpeed: 32,
                unitAttackRange: 300, unitAttackInterval: 2, unitAttackDuration: 0.667,
                unitAttackHitTime: 0.345, unitPrefabPath: 'units/半张卡/半张卡' },
        ], skills),
        /unitSkillId 缺失/,
    );
});

test('固定八卡夹具按 traits.attack 推出职业计数 战士2 / 法师1 / 射手2 / 坦克3', () => {
    const { player, enemy } = buildFixtureDecks();
    assert.equal(player.length, 8);
    assert.equal(enemy.length, 8);

    const tallies = tallyDeckClasses(player, cardArtConfig.lineup);
    assert.deepEqual(tallies.map((entry) => entry.cardClass), [...ZC_CARD_CLASSES]);
    assert.deepEqual(tallies.map((entry) => entry.count), [2, 1, 2, 3]);
    assert.ok(tallies.every((entry) => entry.reached));

    // 分类口径：表里 traits.attack 直接就是职业名（一一对应），不再按 type 推导
    const byName = (name: string) => player.find((card) => card.name === name)!;
    assert.equal(resolveCardClass(byName('熊猫人'), cardArtConfig.lineup), 'warrior', 'attack=战士 → 战士');
    assert.equal(resolveCardClass(byName('火法师'), cardArtConfig.lineup), 'mage', 'attack=法师 → 法师');
    assert.equal(resolveCardClass(byName('精灵弓箭手'), cardArtConfig.lineup), 'archer', 'attack=射手 → 射手');
    assert.equal(resolveCardClass(byName('骷髅战士'), cardArtConfig.lineup), 'tank', 'attack=坦克 → 坦克');
    assert.equal(resolveCardClass(byName('金矿'), cardArtConfig.lineup), 'tank', '没有 traits 的卡（金矿）归坦克占位');

    // 八张卡各自引用的单位 id（2026-09-17 起 **卡 id == 它代表的单位源表 id**：
    // 武将卡=general.id、兵种卡=army.id、怪物卡=monster.id、近卫卡=guards.id、建筑=2001/2002）
    assert.deepEqual(
        player.map((card) => [card.id, card.unitId]),
        [
            ['2001', undefined],
            ['66001', '66001'], ['60016', '60016'], ['66003', '66003'],
            ['66011', '66011'], ['66007', '66007'], ['68006', '68006'],
            ['68004', '68004'],
        ],
    );

    // 四职业各自使用对应的营地雕像
    assert.equal(cardArtConfig.paths.get('hero.warrior'), 'icons/card/camp_warrior');
    assert.equal(cardArtConfig.paths.get('hero.tank'), 'icons/card/camp_tank');
    assert.equal(cardArtConfig.paths.get('hero.archer'), 'icons/card/camp_archer');
    assert.equal(cardArtConfig.paths.get('hero.mage'), 'icons/card/camp_mage');

    // 品级是中文色名（表里是 1/2/3/4）
    assert.deepEqual([...new Set(player.map((card) => card.rarity))].sort(), ['green', 'blue', 'purple', 'gold'].sort() as never);
});

test('图标行 8 项 = 4 职业 + 4 阵营（阵营按 traits.camp 算，顺序即 ZC_CARD_CAMPS）', () => {
    const { player, enemy } = buildFixtureDecks();
    const items = tallyDeckIcons(player, cardArtConfig.lineup);

    assert.equal(items.length, 8, '4 职业 + 4 阵营');
    assert.deepEqual(items.slice(0, 4).map((item) => item.kind), ['class', 'class', 'class', 'class']);
    assert.deepEqual(items.slice(0, 4).map((item) => item.key), Array.from(ZC_CARD_CLASSES));
    assert.deepEqual(items.slice(4).map((item) => item.kind), ['camp', 'camp', 'camp', 'camp']);
    assert.deepEqual(items.slice(4).map((item) => item.key), Array.from(ZC_CARD_CAMPS));
    assert.deepEqual(items.slice(4).map((item) => item.name), ['花果', '蘑菇', '盆栽', '僵尸']);

    // 玩家八卡 = 金矿 + 七个兵营（68001..68007），兵营全带 `camp=花果`。
    //  职业这一维沿用既有口径：**没有 traits 的卡（金矿）落坦克占位**，所以坦克是 3 不是 2。
    //  阵营这一维没有占位一说 —— 金矿不计入任何阵营，所以阵营计数之和是 7、不是 8。
    //  两个维度是「一张卡同时贡献一格职业 + 一格阵营」的关系，别指望两类相加等于卡数。
    assert.deepEqual(items.map((item) => item.count), [2, 1, 2, 3, 7, 0, 0, 0]);
    assert.deepEqual(items.map((item) => item.reached), [true, true, true, true, true, false, false, false]);
    assert.equal(items.slice(0, 4).reduce((sum, item) => sum + item.count, 0), 8);
    assert.equal(items.slice(4).reduce((sum, item) => sum + item.count, 0), 7);

    // 敌方八卡（68008..68015）花果 3 / 蘑菇 5 —— 阵营这一维确实是按表算出来的，不是恒定值
    assert.deepEqual(tallyDeckIcons(enemy, cardArtConfig.lineup).slice(4).map((item) => item.count), [3, 5, 0, 0]);

    // 取维度值的口径
    assert.equal(resolveCardCamp(player.find((card) => card.name === '熊猫人')!, cardArtConfig.lineup), 'huaguo');
    const noTraits = player.find((card) => card.name === '金矿')!;
    assert.equal(resolveCardCamp(noTraits, cardArtConfig.lineup), null, '没有 traits 的卡没有阵营');
    assert.equal(resolveCardCamp({ ...noTraits, traits: { camp: '没这个阵营' } } as unknown as ZCDeckCard, cardArtConfig.lineup), null,
        '认不出的 camp 取值不落默认档（宁可空着，也不要瞎归一类）');

    // 四个阵营均有独立图标，不与职业图标混用。
    const campOn = ZC_CARD_CAMPS.map((camp) => cardArtConfig.paths.get(`camp.${camp}`));
    assert.equal(campOn.length, 4);
    assert.ok(campOn.every((name) => typeof name === 'string' && name.length > 0));
    assert.equal(new Set(campOn).size, campOn.length);
    const classOn = ZC_CARD_CLASSES.map((cardClass) => cardArtConfig.paths.get(`iconOn.${cardClass}`));
    assert.equal(campOn.filter((name) => classOn.includes(name)).length, 0, '阵营与职业不能共用同一张图');
});

test('图标行只列卡数 > 0 的维度（0 项不进虚拟列表）', () => {
    const { player, enemy } = buildFixtureDecks();

    // 职业那 4 维在玩家八卡里全部命中；阵营只有花果 7，后 3 个是 0 → 整项不出现。
    const items = visibleIconTallies(player, cardArtConfig.lineup);
    assert.equal(items.length, 5, '4 职业 + 1 阵营（花果）——条数跟着阵容走，不是固定 8');
    assert.deepEqual(items.slice(0, 4).map((item) => item.key), Array.from(ZC_CARD_CLASSES));
    assert.deepEqual(items.slice(4).map((item) => item.key), ['huaguo']);
    assert.deepEqual(items.map((item) => item.count), [2, 1, 2, 3, 7]);
    assert.ok(items.every((item) => item.count > 0), '列出来的每一项都必须是命中的');

    // 全量统计口径不受影响：`tallyDeckIcons` 仍然是 8 项，过滤只发生在展示层
    assert.equal(tallyDeckIcons(player, cardArtConfig.lineup).length, 8);

    // 敌方八卡（68008..68015）职业是 战士2 / 法师4 / 射手2 —— **没有坦克**，
    //  所以职业侧也只列 3 项；阵营侧花果 3 / 蘑菇 5 命中 → 共 5 项。
    //  顺序仍是 `ZC_CARD_CLASSES` 的序（warrior→mage→archer→tank），
    //  坦克被滤掉不会让它后面的项前移或重排。
    const enemyItems = visibleIconTallies(enemy, cardArtConfig.lineup);
    assert.equal(enemyItems.length, 5);
    assert.deepEqual(enemyItems.map((item) => `${item.kind}|${item.key}`), [
        'class|warrior', 'class|mage', 'class|archer', 'camp|huaguo', 'camp|mogu',
    ]);
    assert.deepEqual(enemyItems.map((item) => item.count), [2, 4, 2, 3, 5]);

    // 顺序与全量口径一致：过滤是「保持原序挑出命中项」，不是重排
    assert.deepEqual(items.map((item) => `${item.kind}|${item.key}`),
        ['class|warrior', 'class|mage', 'class|archer', 'class|tank', 'camp|huaguo']);

    // 空阵容 → 0 项 → 列表要清空（`refreshList(0)`），不能回退成 8 个占位
    assert.deepEqual(visibleIconTallies([], cardArtConfig.lineup), []);
});

type PrefabObject = Record<string, unknown>;

// 下面几处 `assert.ok(x)` 之后仍要补 `x!`：本项目 tsconfig 没开
// `allowSyntheticDefaultImports`，`node:assert/strict` 的默认导入拿不到 `asserts` 签名
//（全 tests/ 里那 91 处 TS1259 就是这件事），于是 tsc 不会跟着 assert 收窄，得自己补。
// 运行时的守卫是真的，`!` 只是给 tsc 看的。

/** 读 prefab JSON —— assetPath(`ui/card`) 下这两张 prefab 是本页外观的唯一真源。 */
function readPrefab(path: string): PrefabObject[] {
    return JSON.parse(readFileSync(path, 'utf8')) as PrefabObject[];
}

/** 取首个同名节点。 */
function prefabNode(prefab: PrefabObject[], name: string): PrefabObject {
    const node = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === name);
    assert.ok(node, `prefab 里找不到节点 ${name}`);
    return node!;
}

/**
 * 按「含某个标志字段」取组件。
 *
 * 脚本组件在 prefab JSON 里的 `__type__` 是压缩 uuid（本次是 `544earF5qRLB4JTuTnSr11+`），
 * 写死它等于把用例绑在脚本资产的 uuid 上 —— 脚本一改名就红一片，且红得没意义。
 */
function prefabComponent(prefab: PrefabObject[], node: PrefabObject, marker: string): PrefabObject {
    const refs = node._components as Array<{ __id__: number }>;
    const found = refs.map((ref) => prefab[ref.__id__]).find((comp) => marker in comp);
    assert.ok(found, `节点 ${String(node._name)} 上找不到含 ${marker} 的组件`);
    return found!;
}

/** 取节点上的 cc.UITransform（内置组件的 `__type__` 就是 `cc.UITransform`，可直接比）。 */
function prefabTransform(prefab: PrefabObject[], node: PrefabObject): PrefabObject {
    const refs = node._components as Array<{ __id__: number }>;
    const found = refs.map((ref) => prefab[ref.__id__]).find((comp) => comp.__type__ === 'cc.UITransform');
    assert.ok(found, `节点 ${String(node._name)} 上没有 UITransform`);
    return found!;
}

test('图标行虚拟列表：节奏 82px（40 图标 + 42 间距），条目模板已合并图标、参数与接线对齐', () => {
    const prefab = readPrefab(assetPath('ui/card/CardLineup.prefab'));
    const itemPrefab = readPrefab(assetPath('ui/card/CardLineupBond.prefab'));
    const itemMeta = JSON.parse(
        readFileSync(assetPath('ui/card/CardLineupBond.prefab.meta'), 'utf8'),
    ) as { uuid: string };

    const list = prefabNode(prefab, 'BondList');
    const view = prefabComponent(prefab, list, 'useVirtualList');

    // 条目尺寸 / 锚点必须取自条目 prefab 的根节点 —— VScrollView.start() 就是这么读的
    //（`itemMainSize = uit.width`），所以这里也照着读，不写死 42。
    const itemTf = prefabTransform(itemPrefab, itemPrefab[1]);
    const itemSize = itemTf._contentSize as { width: number; height: number };
    const itemAnchor = itemTf._anchorPoint as { x: number; y: number };
    assert.equal(itemSize.width, itemSize.height, '条目是正方形（图标直径 + 数字标签悬挑在外）');
    assert.equal(itemAnchor.x, 0.5);

    // ── 条目 prefab：图标已合并成一枚（2026-09-22）─────────────────────────
    // `IconOff`（木条上方那枚灰态）删除，条目只剩「一枚图标 + 数字」。
    //  零项不进列表后「可选但未命中」这个状态在图标行里不存在，灰态图没有出场机会；
    //  留着只会多一个永远不可见的节点 + 一个永远绑不上图的属性。
    const itemRoot = itemPrefab[1];
    const itemChildIds = itemRoot._children as Array<{ __id__: number }>;
    assert.deepEqual(itemChildIds.map((ref) => String(itemPrefab[ref.__id__]._name)), ['Icon', 'CountLabel'],
        '条目只剩一枚图标 + 数字（Icon 在前、数字在后，渲染序即子节点序）');
    assert.ok(!itemPrefab.some((entry) => entry._name === 'IconOff'), 'IconOff 应已合并掉');

    const itemScript = prefabComponent(itemPrefab, itemRoot, 'countLabel');
    assert.equal('iconOff' in itemScript, false, 'iconOff 属性已删，序列化里不该残留空引用');
    const iconSprite = itemPrefab[(itemScript.icon as { __id__: number }).__id__];
    assert.equal(iconSprite.__type__, 'cc.Sprite');
    assert.equal(String(itemPrefab[(iconSprite.node as { __id__: number }).__id__]._name), 'Icon',
        'icon 要绑在 Icon 节点上的 Sprite，不是别的节点');
    const countLabel = itemPrefab[(itemScript.countLabel as { __id__: number }).__id__];
    assert.equal(countLabel.__type__, 'cc.Label');
    assert.equal((countLabel.node as { __id__: number }).__id__, (itemChildIds[1] as { __id__: number }).__id__,
        'countLabel 要绑在 CountLabel 节点上的 Label');
    // 条目 prefab 里全是完整节点（无嵌套 prefab 实例），`_layer` 必须逐个复核
    assert.equal(
        itemPrefab.filter((entry) => entry.__type__ === 'cc.Node' && '_layer' in entry && entry._layer !== 33554432).length,
        0, '条目 prefab 的 UI 节点同样要落在 33554432（UI_2D）',
    );

    // 横向 + 从 prefab 建条目 + 单行
    assert.equal(view.direction, 1, 'direction=1 HORIZONTAL');
    assert.equal(view.itemCreationMode, 1, 'itemCreationMode=1 PREFAB');
    assert.equal((view.itemPrefab as { __uuid__: string }).__uuid__, itemMeta.uuid,
        '条目模板必须指向 ui/card/CardLineupBond');
    assert.equal(view.gridCount, 1);
    assert.equal(view.autoCenter, false,
        '横向等大小模式不能开 autoCenter：它的居中偏移会整体把条目推离原来的起始位');
    // 滚动手感要跟齐项目里其它「真能滚」的列表（`VSListTemplate_H` / `CardGrid` / `LineupBoard`）：
    //   disableBounce=false → 越界回弹；pixelAlign=true → 滚动中位置取整，文字不发糊。
    // 本项目里 disableBounce=true 的那个横向列表是 `MatchPlayerItem`（内容不比视口宽、压根不该拖）。
    assert.equal(view.disableBounce, false, '最坏情况（8 个维度全命中）内容 847 > 视口 476，是真能滚的');
    assert.equal(view.pixelAlign, true, '与项目其它列表一致（条目局部坐标本来就是整数，取整只影响滚动中的落点）');

    // ── 节奏 ────────────────────────────────────────────────────────────
    // 蓝湖「卡牌阵容-新」：图标 40、步进 82（40 + 42），与新效果图统计条一致。
    assert.equal(Number(view.headerSpacing), 0);
    const stride = Number(view.spacing) + itemSize.width;
    assert.equal(stride, 82, '条目节奏必须等于新版设计统计条的 82px');

    // ── 起始对位 ─────────────────────────────────────────────────────────
    // BondList 锚点 x=0（左对齐）+ 静止时 content.x=0（横向模式 _boundsMax=0），
    // 于是条目 i 的 MidBar 坐标 = BondList.x + i*stride + itemMainSize*anchorX。
    const listTf = prefabTransform(prefab, list);
    assert.equal((listTf._anchorPoint as { x: number }).x, 0, 'BondList 必须左对齐，否则整条会随条目数漂移');
    const originX = (list._lpos as { x: number }).x;
    // 新版统计条：BondList 左缘 -340、条目 40、步进 82。
    const pageX = (index: number) => Number((originX + index * stride + itemSize.width * itemAnchor.x).toFixed(2));
    assert.equal(pageX(0), -320, '首项图标中心 = BondList 左缘 -340 + 20');
    assert.equal(pageX(1), -238);
    assert.equal(pageX(2), -156);
    assert.equal(pageX(3), -74);

    // ── 视口与滚动 ───────────────────────────────────────────────────────
    // 源码 2468 行：等大小模式 content 主尺寸 = header + n*stride - spacing + footer。
    //  条目数是**动态**的（`visibleIconTallies` 滤掉 0 项），所以这里算的是
    //  「8 个维度全命中」的**上界**，同时钉住玩家默认阵容的 5 项实况。
    const viewport = (listTf._contentSize as { width: number }).width;
    const listWidth = (count: number) => count * stride - Number(view.spacing);
    assert.equal(listWidth(8), 614, '4 职业 + 4 阵营全命中时的上界');
    assert.ok(listWidth(8) > viewport, '上界 614 装不进 512 → 列表确实要能横滑');
    assert.equal(listWidth(8) - viewport, 102, '上界下的可滚动距离');

    // 玩家默认阵容实际只列 5 项（战士2 / 法师1 / 射手2 / 坦克3 + 花果7）：
    //  5 项 368 宽，装得进 512 视口，静止时不再切边。
    assert.equal(listWidth(5), 368, '玩家默认阵容（5 项）的实际宽度');
    assert.equal(listWidth(5) - viewport, -144, '5 项完整放进 512 视口');

    // 视口区间 = BondList 局部 [0, viewport]，也就是 MidBar 的 [-340, 172]
    //（右缘接 TeamEdit 左缘 180，留 8px）。
    const localX = (index: number) => index * stride + itemSize.width * itemAnchor.x;
    const half = itemSize.width / 2;
    assert.ok(localX(3) + half <= viewport, '第 4 项完整可见');
    assert.equal(Number((localX(4) - half).toFixed(2)), 328);
    assert.ok(localX(4) + half <= viewport, '第 5 项（满编最后一项）完整可见');
    assert.equal(Number((localX(4) + half).toFixed(2)), 368);

    // ── 接线 ─────────────────────────────────────────────────────────────
    const page = prefab.find((entry) => 'iconList' in entry);
    assert.ok(page, 'CardLineupPage 上必须有 iconList');
    assert.equal((page!.iconList as { __id__: number }).__id__, prefab.indexOf(view),
        'iconList 要指到 BondList 上的那个 VScrollView');
    assert.equal('bondBar' in page!, false, '4 个写死的职业项已删除，bondBar 引用不该残留');
    for (const stale of ['Bond1', 'Bond2', 'Bond3', 'Bond4']) {
        assert.ok(!prefab.some((entry) => entry._name === stale), `${stale} 应已被虚拟列表取代`);
    }

    // ── 存盘复核（项目铁律 2）─────────────────────────────────────────────
    // 只有「完整节点」（带 `_children`）才有 `_layer`；嵌套 prefab 实例在本文件里只是
    // 带 `_parent` / `_prefab` 的桩，真正的节点属性在各自的 asset 里。
    const strayLayer = prefab.filter(
        (entry) => entry.__type__ === 'cc.Node' && '_children' in entry && entry._layer !== 33554432,
    );
    assert.equal(strayLayer.length, 0, 'UI 节点必须落在 33554432（UI_2D），否则编辑器里看不见 / 排序错乱');
});

test('加成条标题取 activeBonds 里的羁绊名（不是按 pvpBond.id 查）', () => {
    const bonuses = neutral();
    bonuses.activeBonds = ['王国军阵', '森林同盟'];
    assert.equal(activeBondTitle(bonuses), `王国军阵${CARD_LINEUP_TEXTS.bondTitleSuffix}`);

    // 回归点：activeBonds 存的是名字，若按 id 查会恒定退回兜底文案
    assert.notEqual(activeBondTitle(bonuses), CARD_LINEUP_TEXTS.bondBonusTitle);
    assert.equal(neutral().activeBonds.length, 0);
    assert.equal(activeBondTitle(neutral()), CARD_LINEUP_TEXTS.bondBonusTitle);
});

test('加成条百分比只累加倍率型效果，金币收入不进百分比', () => {
    const bonuses = neutral();
    assert.equal(bondPercentTotal(bonuses), 0);

    bonuses.unitHpMultiplier = 1.08;
    bonuses.unitAttackMultiplier = 1.08;
    bonuses.moveSpeedMultiplier = 1.08;
    bonuses.towerAttackMultiplier = 1.12;
    bonuses.incomeBonus = 1;              // 绝对值，不应影响百分比
    bonuses.spawnIntervalMultiplier = 1;  // 未生效
    assert.ok(Math.abs(bondPercentTotal(bonuses) - 0.36) < 1e-9);
    assert.equal((bondPercentTotal(bonuses) * 100).toFixed(2), '36.00');

    bonuses.spawnIntervalMultiplier = 0.9;  // -10% 产兵间隔 → 计 +10%
    assert.ok(Math.abs(bondPercentTotal(bonuses) - 0.46) < 1e-9);
});

test('真实 pvpBond + 固定八卡夹具算出两条生效羁绊与 16.00% 合计', () => {
    const { player, enemy } = buildFixtureDecks();
    ZC_RUNTIME_CONFIG.updateCatalogs({ playerDeck: player, enemyDeck: enemy as never,
        bonds: parseBondRules(readPvpRef('pvpBond')) });

    // 玩家八卡：七个兵营全是「花果」，攻击标签 射手2 / 坦克2 / 法师1 / 战士2
    const bonuses = calculateDeckBonuses(player);
    assert.deepEqual([...bonuses.activeBonds], ['花果同心', '破阵先锋']);
    assert.equal(bonuses.incomeBonus, 0, '「万箭齐发」要任一攻击标签满 3 张，玩家只有 2');
    assert.ok(!bonuses.activeBonds.includes('蘑菇军团'), '玩家阵容里没有蘑菇标签');

    // 页面横幅实际显示的两个值：生命 +8% + 移速 +8% = 16%
    assert.equal(activeBondTitle(bonuses), `花果同心${CARD_LINEUP_TEXTS.bondTitleSuffix}`);
    assert.equal(`${(bondPercentTotal(bonuses) * 100).toFixed(2)}%`, '16.00%');

    // 敌方八卡：花果 3 / 蘑菇 5，法系 4 张 → 四条生效，其中「万箭齐发」+1 金币/秒
    const enemyBonuses = calculateDeckBonuses(enemy);
    assert.deepEqual([...enemyBonuses.activeBonds], ['花果同心', '蘑菇军团', '破阵先锋', '万箭齐发']);
    assert.equal(enemyBonuses.incomeBonus, 1, '万箭齐发：任一同攻击标签满 3 张 → 基础金币收入 +1/秒');

    // 「僵尸狂潮」= 产兵间隔倍率 -10%，effectValue 必须是 -0.1。
    // 2026-09-16 修过一次：`assets/remoteRef/pvpBond.json` 与 `doc/json/client/pvpBond.json`
    // 曾落成 0（而 PVP-克制羁绊.xlsx「羁绊」sheet 里一直是 -0.1），
    // 于是 `ZCCombatCatalog` 的 `spawnIntervalMultiplier += effectValue` 加了个 0，
    // 这条羁绊在游戏里**完全无效**。这里钉的是代码真正消费的那条规则，
    // 而不是原始行 —— 免得哪天两侧又被改回去还没人发现。
    const jiangshi = parseBondRules(readPvpRef('pvpBond')).find((rule) => rule.id === 'jiangshi-2')!;
    assert.equal(jiangshi.effectType, 'spawnInterval');
    assert.equal(jiangshi.effectValue, -0.1);
});

test('CardLineupCard binds level and card fragment progress to the prefab', () => {
    const src = readFileSync('assets/script/app/card/CardLineupCard.ts', 'utf8');
    const page = readFileSync('assets/script/app/card/CardLineupPage.ts', 'utf8');
    const prefab = JSON.parse(readFileSync(assetPath('ui/card/CardLineupCard.prefab'), 'utf8')) as Array<Record<string, any>>;
    const node = (name: string) => prefab.find((item) => item.__type__ === 'cc.Node' && item._name === name);
    const track = node('CardFragmentProgress');
    const plate = node('LevelPlate');
    const label = node('LevelLabel');
    assert.ok(track && plate && label);
    assert.equal(label._parent.__id__, prefab.indexOf(plate));
    assert.match(page, /item\.key === 'card'/);
    assert.match(src, /this\.levelPlate\.active = normalizedLevel > 0/);
    const bar = track._components.map((ref: { __id__: number }) => prefab[ref.__id__])
        .find((component: Record<string, unknown>) => component.__type__ === 'cc.ProgressBar');
    assert.ok(bar?._barSprite?.__id__ != null);
    const script = prefab.find((item) => item.__type__ === '501ccr5l81NCICYhHQoq0U7');
    assert.ok(script?.levelPlate?.__id__ != null && script?.levelLabel?.__id__ != null);
    assert.ok(script?.progressBar?.__id__ != null && script?.cardFragmentLabel?.__id__ != null);
});

test('编辑器预览读取真实卡表，跳过主城、禁用与损坏行，双方数组独立', () => {
    const source = readFileSync('assets/script/app/card/CardLineupDecks.ts', 'utf8');
    const ast = ts.createSourceFile('CardLineupDecks.ts', source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'parseDecks');
    assert.ok(declaration);
    const script = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const warnings: unknown[][] = [];
    const parse = runInNewContext(`${script}; parseDecks`, {
        normalizeCardRow, parseCard, isHqCard, console: { warn: (...args: unknown[]) => warnings.push(args) },
    }) as (rows: unknown[]) => { player: ZCDeckCard[]; enemy: ZCDeckCard[] };
    const rows = readPvpRef('pvpCard');
    const expected = rows.map(normalizeCardRow).map(parseCard).filter((card) => card.enabled && !isHqCard(card));
    const { player, enemy } = parse([...rows, { ...rows[0], enabled: 0 }, { type: 9 }]);
    assert.deepEqual(Array.from(player, (card) => card.id), expected.map((card) => card.id));
    assert.deepEqual(Array.from(enemy, (card) => card.id), expected.map((card) => card.id));
    assert.notEqual(player, enemy);
    assert.equal(warnings.length, 1);
});

test('阵容预览迟到结果不能在 reset 后重新发布目录', async () => {
    for (const change of ['reset', 'install', 'appearance']) {
        ZC_RUNTIME_CONFIG.reset();
        const completions: Array<(rows: unknown[]) => void> = [];
        const dependencies: Record<string, unknown> = {
            '../zcds/model/ZCRuntimeConfigStore': { ZC_RUNTIME_CONFIG },
            '../zcds/model/ZCCombatCatalog': combatCatalog,
            '../zcds/model/ZCGameRuntimeConfig': runtimeConfig,
            '../../framework/ref/RefUtil': { RefUtil: { instance: {
                getRefAllAsync: () => new Promise(resolve => completions.push(resolve)),
            } } },
        };
        const context = { exports: {} as { ensureLineupDecks(): Promise<readonly ZCDeckCard[]> },
            require: (name: string) => dependencies[name], console };
        const code = ts.transpileModule(readFileSync('assets/script/app/card/CardLineupDecks.ts', 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        }).outputText;
        runInNewContext(code, context);
        const pending = context.exports.ensureLineupDecks();
        if (change === 'appearance') combatCatalog.setCardRarityMeta([]);
        else ZC_RUNTIME_CONFIG.reset();
        if (change === 'install') ZC_RUNTIME_CONFIG.updateCatalogs({ playerDeck: buildFixtureDecks().player });
        const current = ZC_RUNTIME_CONFIG.snapshot;
        completions[0](readPvpRef('pvpCard'));
        completions[1](readPvpRef('pvpBond'));
        assert.deepEqual(await pending, combatCatalog.getPlayerDeck());
        if (change === 'appearance') assert.ok(combatCatalog.getPlayerDeck().length > 0);
        else assert.strictEqual(ZC_RUNTIME_CONFIG.snapshot, current);
    }
    ZC_RUNTIME_CONFIG.reset();
});
