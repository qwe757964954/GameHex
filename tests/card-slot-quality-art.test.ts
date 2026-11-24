/**
 * 「阵容显示的品质 == 卡牌实际品质」的取图守卫。
 *
 * 2026-11-23 用户口径：「阵容显示的品质和卡牌实际的品质不符合」（截图圈的是僵尸站台：
 * 光圈绿的、卡库卡框紫的）。
 *
 * 真因：`loadLineupSlot` 的光圈按**职业**取图（金战士/蓝射手/绿坦克/紫法师，蓝湖稿原样），
 * 而卡库卡面框按**品级**取图；两套色板又是同一套四色（金/紫/绿/蓝）。玩家读色即读品级，
 * 于是同一屏上「光圈说职业、边框说品级」，八站台里正好一半两边矛盾。
 *
 * 这里真跑 `CardArtProvider`：把 `loadIconByArtPath` 桩成「原样回吐路径」，每个槽位拿到
 * 哪张图直接看返回值。锁三件事：
 *   1. 光圈只随**品级**变（同职业换品级要换图；同品级四职业共用一张）；
 *   2. 角标只随**职业**变，且站台与卡库同图；
 *   3. 光圈映射的键是品级而不是职业（防止改回按职业取图）。
 */
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import type { ICardArtConfig } from '../assets/script/app/card/CardArtConfig';
import type { ZCCardClass } from '../assets/script/app/card/CardLineupTypes';
import type { ZCCardRarity, ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';

const RARITIES: readonly ZCCardRarity[] = ['gold', 'purple', 'blue', 'green'];
const CLASSES: readonly ZCCardClass[] = ['warrior', 'mage', 'archer', 'tank'];

/** `traits.attack` 取值 = `cardUiArtClass.name`，也就是表里的中文职业名。 */
const CLASS_TRAIT: Record<ZCCardClass, string> = { warrior: '战士', mage: '法师', archer: '射手', tank: '坦克' };

/**
 * 卡面框（`cardUiArtRarity.face`）：01 金 / 02 紫 / 03 绿 / 04 蓝。
 * 注意这个顺序和光效图**不是**同一套 —— 下面单独维护一份，就是为了防止有人按下标搬。
 */
const FACE_BY_RARITY: Record<ZCCardRarity, string> = {
    gold: 'image/card/common_img_kp_01',
    purple: 'image/card/common_img_kp_02',
    green: 'image/card/common_img_kp_03',
    blue: 'image/card/common_img_kp_04',
};

/** 光效图下标对着 `yx_img_guang_0X` 的实测主色：01 金 (248,191,10) / 02 蓝 (55,132,247) / 03 绿 (155,231,60) / 04 紫 (189,80,238)。 */
const GLOW_BY_RARITY: Record<ZCCardRarity, string> = {
    gold: 'image/card_lineup/yx_img_guang_01',
    blue: 'image/card_lineup/yx_img_guang_02',
    green: 'image/card_lineup/yx_img_guang_03',
    purple: 'image/card_lineup/yx_img_guang_04',
};

/** 执行真实模块，只替换引擎与外部 I/O。 */
function loadModule<T>(file: string, dependencies: Record<string, unknown>): T {
    const exports = {};
    const code = ts.transpileModule(readFileSync(`assets/script/app/card/${file}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, {
        exports, setTimeout, clearTimeout,
        console: { log() {}, warn() {}, error() {} },
        require: (name: string) => {
            assert.ok(name in dependencies, `未声明的依赖：${name}`);
            return dependencies[name];
        },
    });
    return exports as T;
}

/** 装配一份 Provider + 只含 `face.*` 的美术配置（立绘/职业映射走真的 `resolveCardClass`）。 */
function buildProvider(): { provider: { loadLineupSlot: (c: ZCDeckCard, a: ICardArtConfig) => Promise<{ disc: string; hero: unknown; badge: string }>; loadLineupCard: (c: ZCDeckCard, a: ICardArtConfig) => Promise<{ face: string; hero: unknown; badge: string }> }; art: ICardArtConfig } {
    const lineupTypes = loadModule<{ resolveCardClass: Function; ZC_CARD_CLASSES: readonly string[] }>('CardLineupTypes', {
        '../zcds/model/ZCCombatCatalog': { ZCCardType: { Mine: 'mine' }, ZC_CARD_RARITIES: RARITIES },
        './CardLineupTexts': { CARD_LINEUP_TEXTS: new Proxy({}, { get: () => '' }) },
    });
    const mod = loadModule<{ CardArtProvider: new () => any }>('CardArtProvider', {
        //  原样回吐路径：断言直接看「拿到哪张图」，不必再反解 SpriteFrame。
        './CardLineupIcons': { loadCardDetailArt: async () => null, loadIconByArtPath: async (path: string) => path },
        './CardLineupTypes': lineupTypes,
    });
    const order = new Map(Object.entries(CLASS_TRAIT).map(([id, trait]) => [trait, id]));
    const art = {
        paths: new Map(Object.entries(FACE_BY_RARITY).map(([rarity, path]) => [`face.${rarity}`, path])),
        heroIcons: { resolve: () => null },
        lineup: {
            rarities: [], classes: [], camps: [],
            classOfTrait: (name: string) => order.get(name) ?? null,
            campOfTrait: () => null,
        },
    } as unknown as ICardArtConfig;
    return { provider: new mod.CardArtProvider(), art };
}

function makeCard(rarity: ZCCardRarity, cardClass: ZCCardClass): ZCDeckCard {
    return {
        id: `${rarity}-${cardClass}`,
        rarity,
        traits: { attack: CLASS_TRAIT[cardClass] },
    } as unknown as ZCDeckCard;
}

test('光圈按品级取图：同一职业换品级，光圈必须换（这是「阵容品质 == 卡牌品质」的前提）', async () => {
    const { provider, art } = buildProvider();
    for (const cardClass of CLASSES) {
        const seen = new Map<string, ZCCardRarity>();
        for (const rarity of RARITIES) {
            const frames = await provider.loadLineupSlot(makeCard(rarity, cardClass), art);
            assert.equal(frames.disc, GLOW_BY_RARITY[rarity], `${cardClass} 的 ${rarity} 光圈图`);
            assert.equal(seen.get(frames.disc), undefined,
                `${cardClass} 下 ${rarity} 与 ${seen.get(frames.disc)} 撞成同一张光圈`);
            seen.set(frames.disc, rarity);
        }
    }
});

test('光圈不随职业变：同品级四职业共用一张光效图（职业改由角标表达）', async () => {
    const { provider, art } = buildProvider();
    for (const rarity of RARITIES) {
        const discs = new Set<string>();
        for (const cardClass of CLASSES) {
            discs.add((await provider.loadLineupSlot(makeCard(rarity, cardClass), art)).disc);
        }
        assert.equal(discs.size, 1, `${rarity} 的光圈被职业拆成了 ${discs.size} 张：${[...discs].join(' / ')}`);
    }
});

test('角标只随职业变，且站台与卡库同图', async () => {
    const { provider, art } = buildProvider();
    for (const rarity of RARITIES) {
        const badges = new Set<string>();
        for (const cardClass of CLASSES) {
            const card = makeCard(rarity, cardClass);
            const slot = await provider.loadLineupSlot(card, art);
            const pool = await provider.loadLineupCard(card, art);
            assert.equal(slot.badge, pool.badge, `${card.id} 站台与卡库角标必须同图`);
            badges.add(slot.badge);
        }
        assert.equal(badges.size, CLASSES.length, `${rarity} 四职业的角标必须互不相同`);
    }
});

test('卡库卡面框仍然按品级取（别把两边一起改歪）', async () => {
    const { provider, art } = buildProvider();
    for (const rarity of RARITIES) {
        for (const cardClass of CLASSES) {
            const frames = await provider.loadLineupCard(makeCard(rarity, cardClass), art);
            assert.equal(frames.face, FACE_BY_RARITY[rarity], `${cardClass} 的 ${rarity} 卡面框`);
        }
    }
});

test('光圈映射的键必须是品级，不能改回职业', () => {
    const source = readFileSync('assets/script/app/card/CardArtProvider.ts', 'utf8');
    const block = source.match(/const LINEUP_SLOT_GLOW[^{]*\{([\s\S]*?)\};/);
    assert.ok(block, '找不到 LINEUP_SLOT_GLOW 定义');
    const keys = [...block[1].matchAll(/(\w+)\s*:/g)].map((match) => match[1]).sort();
    assert.deepEqual(keys, ['blue', 'gold', 'green', 'purple'],
        '光圈必须按品级取图；按职业取会和卡库的品级色打架（见文件头）');
});
