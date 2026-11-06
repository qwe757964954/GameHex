import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { CARD_ART_TABLES, REQUIRED_CARD_ART_KEYS, parseCardArtConfig } from '../assets/script/app/card/CardArtConfig';
import type { ICardArtTableRows } from '../assets/script/app/card/CardArtConfig';
import * as configModule from '../assets/script/app/card/CardArtConfig';
import { cardArtConfig, readCardArtTables } from './helpers/card-art-config';
import { assetPath } from './helpers/asset-paths';
import * as cardTypes from '../assets/script/app/card/CardLineupTypes';
import type { RuntimeCardRepository } from '../assets/script/app/card/CardRepository';
import type { CardArtProvider } from '../assets/script/app/card/CardArtProvider';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';

function runtime<T>(name: string, dependencies: Record<string, unknown>): T {
    const exports = {};
    const code = ts.transpileModule(readFileSync(`assets/script/app/card/${name}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    runInNewContext(code, { exports, console, require: (name: string) => dependencies[name] ?? {} });
    return exports as T;
}

test('三张矩阵表解析出全部映射且资源真实存在', () => {
    assert.equal(cardArtConfig.paths.size, REQUIRED_CARD_ART_KEYS.length);
    for (const [key, path] of cardArtConfig.paths) assert.ok(assetPath(`${path}.png`), key);
});

test('卡牌配置模块的正则不依赖原生 V8 的 ICU 属性转义', () => {
    const source = ts.createSourceFile('CardArtConfig.ts',
        readFileSync('assets/script/app/card/CardArtConfig.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
        if (ts.isRegularExpressionLiteral(node)) assert.doesNotMatch(node.text, /\\[pP]\{/);
        ts.forEachChild(node, visit);
    };
    visit(source);
});

test('路径支持中英文、数字、下划线及连字符，并拒绝越界或带后缀的路径', () => {
    const tables = readCardArtTables();
    const withFace = (face: string): ICardArtTableRows => ({
        ...tables,
        rarity: [{ ...(tables.rarity[0] as Record<string, unknown>), face }, ...tables.rarity.slice(1)],
    });
    const valid = 'icons/card/中文_Az09-头像';
    assert.ok([...parseCardArtConfig(withFace(valid), []).paths.values()].includes(valid));
    for (const path of ['image/../bad', 'other/card/a', 'icons//a', 'icons/card/a.png',
        'icons/card/a/spriteFrame', 'icons/card/a b', 'icons/card/a\\b', 'icons/card/a/']) {
        assert.throws(() => parseCardArtConfig(withFace(path), []), /路径无效/, path);
    }
});

for (const [name, change, error] of [
    ['缺键', (tables: ICardArtTableRows) => ({ ...tables, camp: tables.camp.slice(1) }), /缺少映射/],
    ['重复品级', (tables: ICardArtTableRows) => ({ ...tables, rarity: [...tables.rarity, tables.rarity[0]] }), /重复品级/],
    ['未知品级', (tables: ICardArtTableRows) => ({
        ...tables,
        rarity: [...tables.rarity, { ...(tables.rarity[0] as Record<string, unknown>), rarity: '红' }],
    }), /未知品级/],
    ['中文品级被拒绝', (tables: ICardArtTableRows) => ({
        ...tables,
        rarity: [{ ...(tables.rarity[0] as Record<string, unknown>), rarity: '金' }, ...tables.rarity.slice(1)],
    }), /未知品级/],
    ['非法路径', (tables: ICardArtTableRows) => ({
        ...tables,
        rarity: [{ ...(tables.rarity[0] as Record<string, unknown>), face: 'image/../bad' }, ...tables.rarity.slice(1)],
    }), /路径无效/],
] as const) {
    test(`配置${name}在边界明确报错`, () => assert.throws(
        () => parseCardArtConfig(change(readCardArtTables()), []), error));
}

test('表内 name / sort 列解析成维度元数据，traits 中文可反查', () => {
    const lineup = cardArtConfig.lineup;
    assert.deepEqual(lineup.classes.map((meta) => meta.id), cardTypes.ZC_CARD_CLASSES);
    assert.deepEqual(lineup.camps.map((meta) => meta.id), cardTypes.ZC_CARD_CAMPS);
    assert.equal(lineup.classes.length, 4);
    assert.equal(lineup.camps.length, 4);
    assert.equal(new Set(lineup.classes.map((meta) => meta.name)).size, 4, '职业名唯一');
    assert.equal(new Set(lineup.classes.map((meta) => meta.sort)).size, 4, '职业排序权重唯一');
    assert.deepEqual(lineup.rarities.map((meta) => meta.id), cardTypes.ZC_CARD_RARITIES);
    assert.equal(new Set(lineup.rarities.map((meta) => meta.name)).size, 4, '品级名唯一');
    assert.equal(new Set(lineup.rarities.map((meta) => meta.sort)).size, 4, '品级排序权重唯一');
    assert.equal(lineup.rarities.find((meta) => meta.id === 'gold')?.name, '传说');
    assert.equal(new Set(lineup.camps.map((meta) => meta.name)).size, 4, '阵营名唯一');
    assert.equal(lineup.classOfTrait('战士'), 'warrior');
    assert.equal(lineup.classOfTrait('法师'), 'mage');
    assert.equal(lineup.campOfTrait('花果'), 'huaguo');
    assert.equal(lineup.campOfTrait('僵尸'), 'jiangshi');
    assert.equal(lineup.classOfTrait('未知'), null);
    assert.equal(lineup.campOfTrait(''), null);
});

for (const [name, change, error] of [
    ['职业名重复', (tables: ICardArtTableRows) => ({
        ...tables,
        cardClass: [{ ...(tables.cardClass[0] as Record<string, unknown>), name: (tables.cardClass[1] as any).name }, ...tables.cardClass.slice(1)],
    }), /name 重复/],
    ['职业排序权重重复', (tables: ICardArtTableRows) => ({
        ...tables,
        cardClass: [{ ...(tables.cardClass[0] as Record<string, unknown>), sort: (tables.cardClass[1] as any).sort }, ...tables.cardClass.slice(1)],
    }), /sort 重复/],
    ['排序权重非整数', (tables: ICardArtTableRows) => ({
        ...tables,
        rarity: [{ ...(tables.rarity[0] as Record<string, unknown>), sort: 1.5 }, ...tables.rarity.slice(1)],
    }), /sort 无效/],
    ['阵营名缺失', (tables: ICardArtTableRows) => ({
        ...tables,
        camp: [{ ...(tables.camp[0] as Record<string, unknown>), name: '' }, ...tables.camp.slice(1)],
    }), /name 无效/],
] as const) {
    test(`配置${name}在边界明确报错`, () => assert.throws(
        () => parseCardArtConfig(change(readCardArtTables()), []), error));
}

test('Repository 合并配置请求，失败后可重试，成功后只复用已校验的配置', async () => {
    let reads = 0, bad = true;
    const { RuntimeCardRepository: Repository } = runtime<{ RuntimeCardRepository: new () => RuntimeCardRepository }>('CardRepository', {
        '../../framework/ref/RefUtil': { RefUtil: { instance: { getRefAllAsync: async (name: string) => {
            reads++;
            if (name === 'icon') return [];
            if (bad) return [];
            const tables = readCardArtTables();
            if (name === CARD_ART_TABLES.rarity) return tables.rarity;
            if (name === CARD_ART_TABLES.cardClass) return tables.cardClass;
            return tables.camp;
        } } } },
        './CardArtConfig': configModule,
        '../zcds/model/ZCCombatCatalog': { setCardRarityMeta: () => {}, getPlayerDeck: () => [] },
    });
    const repository = new Repository();
    const first = repository.loadArtConfig();
    assert.equal(repository.loadArtConfig(), first);
    await assert.rejects(first, /缺少映射/);
    bad = false;
    const ready = await repository.loadArtConfig();
    assert.equal(ready.paths.size, REQUIRED_CARD_ART_KEYS.length);
    assert.equal(await repository.loadArtConfig(), ready);
    assert.equal(reads, 8, '两次尝试各读四张表，缓存命中不再读表');
});

test('美术组合器只消费注入的映射与头像解析器，专属图缺失时回退配置路径', async () => {
    const requested: string[] = [];
    const { CardArtProvider: Provider } = runtime<{ CardArtProvider: new () => CardArtProvider }>('CardArtProvider', {
        './CardLineupTypes': cardTypes,
        './CardLineupIcons': { loadIconByArtPath: async (path: string) => {
            requested.push(path);
            return path.endsWith('/missing') ? null : path;
        } },
    });
    const provider = new Provider();
    const art = parseCardArtConfig(readCardArtTables(), [{ key: '专属图', path: 'ui://图标_兵种_头像/missing' }]);
    const card = { id: '1', rarity: 'green', traits: { attack: '法师' }, headIcon: '专属图' } as ZCDeckCard;
    const result = await provider.loadDetail(card, art);
    assert.equal(result.hero, art.paths.get('hero.mage'));
    assert.equal(result.diamond, art.paths.get('diamond.green'));
    assert.ok(requested.includes('icons/cardHead/missing'));
    const tables = readCardArtTables();
    const different = parseCardArtConfig({
        ...tables,
        cardClass: tables.cardClass.map((row: any) => (row.class === 'mage' ? { ...row, hero: 'icons/card/另一个占位' } : row)),
    }, []);
    assert.equal((await provider.loadDetail(card, different)).hero, 'icons/card/另一个占位');
    assert.equal((await provider.loadDetail(card, art)).hero, art.paths.get('hero.mage'), '不同宿主的配置不能串用');
});
