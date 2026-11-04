import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { CARD_HEAD_ART_ROOT } from '../assets/script/app/ArtPaths';
import { BOARD_HERO_ART, CARD_HERO_ART } from '../assets/script/app/card/CardLineupTypes';
import * as cardTypes from '../assets/script/app/card/CardLineupTypes';
import { assetPath } from './helpers/asset-paths';

test('卡牌专属立绘与布阵占位统一使用 cardHead，不保留 hero 和 char 重复资源', () => {
    for (const name of [...Object.values(CARD_HERO_ART), ...Object.values(BOARD_HERO_ART)]) {
        assert.ok(existsSync(assetPath(`${CARD_HEAD_ART_ROOT}/${name}.png`)), name);
    }
    assert.equal(existsSync('assets/bundles/main-pages/image/card/hero'), false);
    for (const name of ['char_01', 'char_02']) {
        assert.equal(existsSync(`assets/bundles/main-pages/icons/card/${name}.png`), false);
    }
    assert.equal(BOARD_HERO_ART.warrior, CARD_HERO_ART['68001']);
    assert.equal(BOARD_HERO_ART.mage, CARD_HERO_ART['68028']);
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
                loadCardHeroArt: async (name: string) => { heroRequests.push(name); return null; },
                loadIconArt: async (name: string) => { iconRequests.push(name); return null; },
                loadLineupArt: async () => null,
                loadFrameArt: async () => null,
                loadCardHeadArt: async () => null,
            };
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    const Provider = moduleExports.CardArtProvider as typeof import('../assets/script/app/card/CardArtProvider').CardArtProvider;
    const provider = new Provider();
    const card = { id: 'no-dedicated-art', rarity: '绿', traits: { attack: '法师' } } as Parameters<typeof provider.loadBoardSlot>[0];
    await provider.loadBoardSlot(card);
    await provider.loadBoardCard(card);
    for (const key of cardTypes.ZC_CARD_CAMPS) {
        const item = { kind: 'camp' as const, key, name: key, count: 1, reached: true };
        const first = provider.loadTallyFrames(item);
        assert.equal(provider.loadTallyFrames(item), first, '同阵营复用加载请求');
        await first;
        assert.ok(existsSync(assetPath(`icons/card/${cardTypes.CAMP_ICON_ON_ART[key]}.png`)), key);
    }
    assert.deepEqual(heroRequests, ['jiezhanshi', 'jiezhanshi']);
    assert.deepEqual(iconRequests, ['class_mage', 'class_mage',
        'common_img_huaguo', 'common_img_mogu', 'common_img_penzai', 'common_img_jiangshi']);
});
