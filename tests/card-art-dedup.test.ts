import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { CARD_HEAD_ART_ROOT } from '../assets/script/app/ArtPaths';
import { createIconArtResolver, type IconArtResolver, type IconArtTarget } from '../assets/script/app/HeadArtModel';
import { cardArtConfig } from './helpers/card-art-config';
import * as cardTypes from '../assets/script/app/card/CardLineupTypes';
import { assetPath } from './helpers/asset-paths';
import { readRefKvc, type IRefKvcTable as KvcTable } from './helpers/ref-kvc';

/** remoteRef 表按行读 —— 列存与行对象数组两种产物格式由 {@link readRefKvc} 收口。 */
const readKvc = readRefKvc;

/** 取列下标。列被导表冲掉时显式失败，避免 indexOf=-1 让数据驱动断言静默零执行。 */
function columnOf(table: KvcTable, name: string): number {
    const idx = table.k.indexOf(name);
    assert.ok(idx >= 0, `配置表缺少列 ${name}（导表把它冲掉了？）`);
    return idx;
}

/** pvpCard.json：卡 id → headIcon（图标名）。 */
function headIconOf(cardId: string, table: KvcTable = readKvc('assets/remoteRef/pvpCard.json')): string | null {
    const idIdx = columnOf(table, 'id');
    const hiIdx = columnOf(table, 'headIcon');
    for (const row of table.v) {
        if (String(row[idIdx]) === cardId) return typeof row[hiIdx] === 'string' ? row[hiIdx] : null;
    }
    return null;
}

/** 解析每条 headIcon；解析不到必须显式失败（配置漂移），不许静默 continue。 */
function headIconTargets(
    table: KvcTable,
    icons: IconArtResolver,
): Array<{ iconKey: string; target: IconArtTarget }> {
    const hiIdx = columnOf(table, 'headIcon');
    const out: Array<{ iconKey: string; target: IconArtTarget }> = [];
    for (const row of table.v) {
        const iconKey = row[hiIdx];
        if (typeof iconKey !== 'string' || !iconKey) continue;
        const target = icons.resolve(iconKey);
        assert.ok(target, `headIcon ${iconKey} 解析不到资源（图标名或直接路径无效）`);
        out.push({ iconKey, target });
    }
    return out;
}

test('卡牌专属立绘由 headIcon+icon.json 配置驱动且落配置目录，不保留 hero 和 char 重复资源', () => {
    for (const key of cardTypes.ZC_CARD_CLASSES) {
        const path = cardArtConfig.paths.get(`boardHero.${key}`);
        assert.ok(existsSync(assetPath(`${path}.png`)), path);
    }
    const iconTable = readKvc('assets/remoteRef/icon.json');
    columnOf(iconTable, 'key');
    columnOf(iconTable, 'path');
    const icons = cardArtConfig.heroIcons;
    const targets = headIconTargets(readKvc('assets/remoteRef/pvpCard.json'), icons);
    assert.ok(targets.length > 0, '至少要校验到一条 headIcon，否则整段存在性断言零执行（假绿）');
    for (const { iconKey, target } of targets) {
        assert.ok(existsSync(assetPath(`${target.root}/${target.art}.png`)), `${iconKey} -> ${target.root}/${target.art}`);
    }
    assert.equal(existsSync('assets/bundles/main-pages/image/card/hero'), false);
    for (const name of ['char_01', 'char_02']) {
        assert.equal(existsSync(`assets/bundles/main-pages/icons/card/${name}.png`), false);
    }
    // 布阵占位复用有专属立绘的卡：战士/射手用豌豆游侠（68001），法师/坦克用洁战狮（68028）。
    for (const [cardId, slot] of [['68001', 'warrior'], ['68028', 'mage']] as const) {
        const iconKey = headIconOf(cardId);
        assert.ok(iconKey, `${cardId} 必须有 headIcon`);
        const target = icons.resolve(iconKey);
        assert.ok(target, `${cardId} 的 headIcon ${iconKey} 必须能解析到资源`);
        assert.equal(cardArtConfig.paths.get(`boardHero.${slot}`), `${target.root}/${target.art}`);
        assert.equal(target.root, CARD_HEAD_ART_ROOT, `${cardId} 的兵种头像必须落 cardHead 目录`);
    }
});

test('配置护栏：导表冲掉列时显式失败，不让数据驱动断言静默零执行', () => {
    assert.throws(() => columnOf({ k: ['key'], v: [] }, 'path'), /缺少列 path/);
    assert.equal(columnOf({ k: ['key', 'path'], v: [] }, 'path'), 1);
});

test('配置护栏：headIcon 解析不到时显式失败，不许静默跳过', () => {
    const icons = createIconArtResolver([{ key: '已知图标', path: 'ui://图标_兵种_头像/wandouyouxia' }]);
    const good: KvcTable = { k: ['id', 'headIcon'], v: [['68001', '已知图标'], ['68002', 'icons/cardHead/wandouyouxia']] };
    assert.equal(headIconTargets(good, icons).length, 2);
    const drifted: KvcTable = { k: ['id', 'headIcon'], v: [['68001', '被改名_不存在']] };
    assert.throws(() => headIconTargets(drifted, icons), /解析不到/);
    assert.throws(() => headIconTargets({ k: ['id'], v: [['68001']] }, icons), /缺少列 headIcon/);
});

test('专属立绘加载器使用 cardHead 根目录', async () => {
    const requested: Array<[string, string]> = [];
    const moduleExports: Record<string, unknown> = {};
    const source = readFileSync('assets/script/app/card/CardLineupIcons.ts', 'utf8');
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
        exports: moduleExports,
        require: (id: string) => {
            if (id === '../ArtPaths') return { CARD_HEAD_ART_ROOT };
            if (id === '../common/SpriteFrameCache') return { createRoutedSpriteFrameCache: () => ({
                loadNamed: async (name: string, root: string) => { requested.push([name, root]); return null; },
            }) };
            if (id === '../HeadArt') return { HeadArt: {} };
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    await (moduleExports.loadCardHeroArt as (name: string) => Promise<unknown>)('wandouyouxia');
    assert.deepEqual(requested, [['wandouyouxia', CARD_HEAD_ART_ROOT]]);
});

test('布阵缺少专属图时复用 cardHead 角色，职业角标仍走图标加载器', async () => {
    const heroRequests: string[] = [];
    const iconRequests: string[] = [];
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/card/CardArtProvider.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, {
        exports: moduleExports,
        require: (id: string) => {
            if (id === './CardLineupTypes') return cardTypes;
            if (id === './CardLineupIcons') return {
                loadIconByArtPath: async (path: string) => {
                    if (path.startsWith('icons/cardHead/')) heroRequests.push(path.slice('icons/cardHead/'.length));
                    if (path.startsWith('icons/card/')) iconRequests.push(path.slice('icons/card/'.length));
                    return null;
                },
            };
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    const Provider = moduleExports.CardArtProvider as typeof import('../assets/script/app/card/CardArtProvider').CardArtProvider;
    const provider = new Provider();
    const card = { id: 'no-dedicated-art', rarity: 'green', traits: { attack: '法师' } } as Parameters<typeof provider.loadBoardSlot>[0];
    await provider.loadBoardSlot(card, cardArtConfig);
    await provider.loadBoardCard(card, cardArtConfig);
    const campIcons = {
        huaguo: 'common_img_hg',
        mogu: 'common_img_mg',
        penzai: 'common_img_pz',
        jiangshi: 'common_img_js',
    } as const;
    for (const key of cardTypes.ZC_CARD_CAMPS) {
        const item = { kind: 'camp' as const, key, name: key, count: 1, reached: true };
        await provider.loadTallyFrames(item);
        await provider.loadTallyFrames(item);
        assert.ok(existsSync(assetPath(`icons/card/${campIcons[key]}.png`)), key);
    }
    assert.deepEqual(heroRequests, ['jiezhanshi', 'jiezhanshi']);
    assert.deepEqual(iconRequests, ['yx_zhiye_fs', 'yx_zhiye_fs',
        'common_img_hg', 'common_img_hg',
        'common_img_mg', 'common_img_mg',
        'common_img_pz', 'common_img_pz',
        'common_img_js', 'common_img_js']);
});
