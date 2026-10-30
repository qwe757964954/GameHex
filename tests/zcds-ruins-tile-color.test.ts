import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

/**
 * 废墟地块的底色必须跟**归属方**一致（2026-10-29 用户口径）。
 *
 * > 「战斗中形成废墟后，废墟的地块颜色需要和归属玩家的一致」
 *
 * 改前 `ZCHexView.territoryTint` 对废墟是无条件 `ZC_CLIENT_COLORS.ruins`（#5E656C 一块中立灰）——
 * 谁的地被打成废墟都变成同一块灰，`state.owner` 完全没参与取色。
 * 现在走 `zcRuinsFactionColor(owner)`：**阵营色往废墟灰里混**，既认得出是谁的地、也看得出已经废了。
 */

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
/** 去掉注释再守卫：文档里的示例代码会让"写死灰"的守卫误绿。 */
const codeOf = (relative: string): string => read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const HEX_VIEW = 'assets/script/app/zcds/view/ZCHexView.ts';
const THEME = 'assets/script/app/zcds/view/ZCTheme.ts';
const SEATS = ['player', 'enemy', 'enemy2', 'enemy3'] as const;

function channels(color: { r: number; g: number; b: number; a: number }): number[] {
    return [color.r, color.g, color.b, color.a];
}

test('① 纯函数：废墟色 = 阵营色往废墟灰里混，中立原样返回废墟灰', () => {
    const theme = loadViews().load('./ZCTheme');
    const { zcRuinsFactionColor, zcFactionColor, ZC_CLIENT_COLORS, ZC_RUINS_GRAY_MIX } = theme;
    const ruins = ZC_CLIENT_COLORS.ruins;

    assert.ok(ZC_RUINS_GRAY_MIX > 0 && ZC_RUINS_GRAY_MIX < 1,
        '混合比例必须严格在 (0,1)：0 = 跟完好领地一样（看不出废墟），1 = 退回"全都一块灰"的老 bug');

    // 中立废墟：没有阵营色可混，原样返回废墟灰（不参与混合）。
    assert.deepEqual(channels(zcRuinsFactionColor('neutral')), [ruins.r, ruins.g, ruins.b, 255]);

    for (const seat of SEATS) {
        const base = zcFactionColor(seat);
        const mixed = zcRuinsFactionColor(seat);
        // 逐通道都在 [阵营色, 废墟灰] 之间（混合而不是替换）。
        for (const channel of ['r', 'g', 'b'] as const) {
            const expect = Math.round(base[channel] + (ruins[channel] - base[channel]) * ZC_RUINS_GRAY_MIX);
            assert.equal(mixed[channel], expect,
                `${seat}.${channel} 必须是「阵营色 + 灰」的线性混合（写死任何一个分量都会在换肤时漂）`);
        }
        assert.equal(mixed.a, 255, 'alpha 由视图给，函数默认不透明');
        assert.notDeepEqual(channels(mixed), channels(ruins), `${seat} 的废墟不能退化成中立灰`);
        assert.notDeepEqual(channels(mixed), channels(base), `${seat} 的废墟必须明显"蒙灰"，不能跟完好领地同色`);
        // 透传 alpha。
        assert.equal(zcRuinsFactionColor(seat, 150).a, 150);
    }

    // 四个席位的废墟色两两不同 —— 否则「废墟色跟归属玩家一致」这条需求等于没做。
    const seen = new Set(SEATS.map((seat) => channels(zcRuinsFactionColor(seat)).join(',')));
    assert.equal(seen.size, SEATS.length, '四个席位的废墟底色必须互不相同');
});

test('② 视图：废墟格真的用 `state.owner` 取色，且 alpha 与普通领地同一口径', () => {
    const { load, cc, bar } = loadViews();
    const { ZCHexView } = load('./ZCHexView');
    const { zcRuinsFactionColor } = load('./ZCTheme');

    const makeView = (): any => {
        const view = new ZCHexView();
        const sprite = () => ({ node: bar().node, enabled: true, spriteFrame: null, color: null });
        for (const key of ['tileSprite', 'buildingSprite', 'iconSprite', 'priceIcon']) view[key] = sprite();
        view.groundGlow = { ...sprite(), color: { r: 255, g: 255, b: 255, a: 180 }, customMaterial: null };
        for (const key of ['tileFrame', 'mineIconFrame', 'barracksIconFrame', 'mysteryFrame',
            'mineFrame', 'ruinsFrame', 'enemyDevelopFrame',
            'goldResourceFrame', 'mineResourceFrame', 'chestResourceFrame']) view[key] = { name: key };
        view.buildingLayer = bar().node;
        view.iconLabel = { node: bar().node, string: '', enabled: true, color: null };
        view.outlineGraphics = new cc.Graphics();
        view.healthBar = bar();
        view.cooldownBar = bar();
        return view;
    };

    const alpha = ZCHexView.TERRITORY_FILL_ALPHA;
    for (const seat of [...SEATS, 'neutral'] as const) {
        const view = makeView();
        const state = {
            owner: seat, state: 'ruins', building: 'none', cardId: null,
            tileType: 'none', developmentCost: 0, developmentResolved: true,
            hp: 0, maxHp: 0, tier: 0,
        };
        view.render({ state, canDevelop: false, playerGold: 999, cooldown: null });
        const expected = zcRuinsFactionColor(seat, alpha);
        assert.deepEqual(channels(view.tileSprite.color), channels(expected),
            `${seat} 的废墟地块底色必须等于 zcRuinsFactionColor('${seat}') + 领地统一 alpha`);
    }
});

test('③ 源码守卫：废墟分支不许再写死中立灰', () => {
    const body = codeOf(HEX_VIEW);
    assert.match(body, /if \(state\.state === 'ruins'\) \{\s*[\s\S]{0,700}?zcRuinsFactionColor\(state\.owner\)/,
        '废墟分支必须按 state.owner 取色');
    assert.doesNotMatch(body, /ZC_CLIENT_COLORS\.ruins\.[rgb]/,
        '写死 ZC_CLIENT_COLORS.ruins 的 RGB 就是把"谁的地"这条信息丢了（老 bug 的样子）');
    // 取色口径只能有一处定义。
    assert.match(codeOf(THEME), /export function zcRuinsFactionColor\(owner: ZCFaction, alpha = 255\): Color \{/,
        '废墟色必须由 ZCTheme.zcRuinsFactionColor 统一提供（预览 / 小地图不许各写一份灰）');
    const view = codeOf(HEX_VIEW);
    assert.doesNotMatch(view, /new Color\(94, 101, 108/,
        '别把废墟灰的数值直接抄进视图');
});
