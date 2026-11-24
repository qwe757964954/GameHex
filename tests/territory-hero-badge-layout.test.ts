/**
 * 2026-11-22 用户口径修正：**只有卡牌可以升级（碎片 + 经验都满）才展示碎片与进度**，
 * 11-20 加的「本次进度涨了一截就播」回落通道实机变成「每次领奖都弹一个 26%」，已整条撤掉。
 *
 * 本文件锁两件事：
 * ① 触发口径回到 11-10 的 `detectTerritoryHeroBadges`（仅本次新达成，长满 100% + 刷光）；
 * ② 版面：icon 与进度条间隔 2px、整组摆在底栏「英雄 / 卡牌」按钮图标上方 10px、
 *    白色 `NN%` + 深灰槽 + 满进度刷光。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
    TERRITORY_HERO_BADGE_FADE_SECONDS,
    TERRITORY_HERO_BADGE_GROW_SECONDS,
    TERRITORY_HERO_BADGE_HOLD_SECONDS,
    TERRITORY_HERO_BADGE_SHINE_SECONDS,
    TERRITORY_HERO_BADGE_TOTAL_SECONDS,
    detectTerritoryHeroBadges,
    territoryHeroBadgeFrame,
    territoryHeroBadgeShineFrame,
    type ITerritoryHeroUpgradeState,
} from '../assets/script/app/territory/model/TerritoryHeroReward';

const MODEL = 'assets/script/app/territory/model/TerritoryHeroReward.ts';
const VIEW = 'assets/script/app/main/HeroFragmentBadge.ts';
const SOURCE = 'assets/script/app/bootstrap/main/TerritoryHeroProgressSource.ts';
const PREFAB = 'assets/resources/ui/main/HeroFragmentBadge.prefab';

const src = (path: string): string => readFileSync(path, 'utf8');
/** 去掉块 / 行注释，只留真代码 —— 防止「注释里写了就算接线」的假绿。 */
const body = (path: string): string => src(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

interface IPrefabObject {
    readonly __type__?: string;
    readonly _name?: string;
    readonly _string?: string;
    readonly _overflow?: number;
    readonly _isSystemFontUsed?: boolean;
    readonly _font?: unknown;
    readonly _fontSize?: number;
    readonly _lpos?: { readonly x: number; readonly y: number; readonly z: number };
    readonly _contentSize?: { readonly width: number; readonly height: number };
    readonly node?: { readonly __id__: number };
    readonly _parent?: { readonly __id__: number };
    readonly _children?: readonly { readonly __id__: number }[];
    readonly _components?: readonly { readonly __id__: number }[];
    readonly _prefab?: { readonly __id__: number };
}
const objects = (): IPrefabObject[] => JSON.parse(src(PREFAB)) as IPrefabObject[];
const named = (all: IPrefabObject[], name: string): IPrefabObject => {
    const found = all.find((item) => item._name === name);
    assert.ok(found, `prefab 缺节点 ${name}`);
    return found;
};
/** 节点对应的 cc.UITransform 组件对象。 */
const transformOf = (all: IPrefabObject[], node: IPrefabObject): IPrefabObject => {
    const ref = (node._components ?? []).find((item) => all[item.__id__]?.__type__ === 'cc.UITransform');
    assert.ok(ref, `${node._name} 缺 UITransform`);
    return all[ref.__id__];
};

// ============================================================
// ① 只有「本次新达成可升级」才入队（11-10 口径，11-22 再次确认）
// ============================================================

test('★ 仅本次新达成：领奖前已可升级 / 本次没凑齐 / 满级都不播', () => {
    const base: ITerritoryHeroUpgradeState = {
        cardId: 'A', priority: 0, cardOwned: 6, cardNeed: 10, iconResId: 18003,
        canUpgradeBefore: false, canUpgradeAfter: true, maxedOrUnconfigured: false,
    };
    const states: ITerritoryHeroUpgradeState[] = [
        base,
        { ...base, cardId: 'B', canUpgradeBefore: true },    // 领奖前就满了 ⇒ 不重复播
        { ...base, cardId: 'C', canUpgradeAfter: false },    // 本次没凑齐 ⇒ 不播
        { ...base, cardId: 'D', maxedOrUnconfigured: true },// 满级 / 没配 ⇒ 不播
        { ...base, cardId: 'E', priority: -1, cardOwned: 9, cardNeed: 10 },
    ];
    const items = detectTerritoryHeroBadges(states);
    assert.deepEqual(items.map((item) => item.cardId), ['E', 'A'], '按 priority 排好，只留新达成');
    assert.equal(items[0].from, 0.9);
    assert.equal(items[1].from, 0.6);
    assert.equal(items[1].iconResId, 18003);
    assert.deepEqual(detectTerritoryHeroBadges([]), []);
});

test('★ 每次领奖都展示是错的：组合层只接 detectTerritoryHeroBadges，回落通道已整条撤掉', () => {
    const source = body(SOURCE);
    assert.match(source, /return detectTerritoryHeroBadges\(states\);/, '判定出口只有这一条');
    assert.doesNotMatch(source, /detectTerritoryHeroBadgeProgress|cardOwnedAfter|expOwnedAfter/,
        '不许再按「本次进度涨了一截」补播');
    const model = body(MODEL);
    assert.doesNotMatch(model, /detectTerritoryHeroBadgeProgress|territoryHeroBadgeProgress|cardOwnedAfter/,
        'model 里也不许留回落通道死代码');
    const view = body(VIEW);
    assert.doesNotMatch(view, /territoryHeroBadgeProgress|item\.to|\.to \?\? 1/,
        '视图不许再按 to 演「没凑满的进度」');
});

test('进度仍从当前 owned/need 长到 100%，不是从 0 起', () => {
    const from = 0.6;
    assert.equal(territoryHeroBadgeFrame(from, 0)?.progress, from);
    let last = from - 1e-9;
    for (let t = 0; t < TERRITORY_HERO_BADGE_GROW_SECONDS; t += 0.02) {
        const fx = territoryHeroBadgeFrame(from, t);
        assert.ok(fx && fx.progress >= last && fx.progress <= 1, '进度单调涨到 1');
        assert.equal(fx.opacity, 1, '增长段不淡出');
        last = fx.progress;
    }
    assert.equal(territoryHeroBadgeFrame(from, TERRITORY_HERO_BADGE_GROW_SECONDS)?.progress, 1);
    assert.equal(territoryHeroBadgeFrame(from, TERRITORY_HERO_BADGE_TOTAL_SECONDS), null);
});

// ============================================================
// ② 满进度刷光
// ============================================================

test('★ 刷光时钟：长满那一刻起扫，扫完即收，时长正好等于 hold + fade', () => {
    assert.equal(TERRITORY_HERO_BADGE_SHINE_SECONDS,
        TERRITORY_HERO_BADGE_HOLD_SECONDS + TERRITORY_HERO_BADGE_FADE_SECONDS);
    assert.equal(TERRITORY_HERO_BADGE_GROW_SECONDS + TERRITORY_HERO_BADGE_SHINE_SECONDS,
        TERRITORY_HERO_BADGE_TOTAL_SECONDS, '刷光不许把整个徽标多留一帧');
    assert.equal(territoryHeroBadgeShineFrame(TERRITORY_HERO_BADGE_GROW_SECONDS - 0.01), null);
    const first = territoryHeroBadgeShineFrame(TERRITORY_HERO_BADGE_GROW_SECONDS);
    assert.ok(first && first.offset === 0 && first.opacity === 0, '从条左端淡入');
    const mid = territoryHeroBadgeShineFrame(
        TERRITORY_HERO_BADGE_GROW_SECONDS + TERRITORY_HERO_BADGE_SHINE_SECONDS / 2);
    assert.ok(mid && Math.abs(mid.offset - 0.5) < 1e-9 && Math.abs(mid.opacity - 1) < 1e-9);
    let last = -1;
    for (let t = TERRITORY_HERO_BADGE_GROW_SECONDS;
        t < TERRITORY_HERO_BADGE_GROW_SECONDS + TERRITORY_HERO_BADGE_SHINE_SECONDS; t += 0.01) {
        const shine = territoryHeroBadgeShineFrame(t);
        assert.ok(shine, `${t}s 刷光帧不该消失`);
        assert.ok(shine.offset >= last, '光带只向右扫');
        assert.ok(shine.opacity >= 0 && shine.opacity <= 1);
        last = shine.offset;
    }
    assert.equal(territoryHeroBadgeShineFrame(TERRITORY_HERO_BADGE_TOTAL_SECONDS), null,
        '浮点边界必须收干净（TOTAL = grow + SHINE，同一表达式）');
    for (const bad of [NaN, Infinity, -Infinity]) assert.equal(territoryHeroBadgeShineFrame(bad), null);
});

test('视图：每场都长满 ⇒ 每场都刷光，白字百分比、不补挂组件、不建 tween', () => {
    const view = body(VIEW);
    assert.match(view, /territoryHeroBadgeShineFrame\(this\.elapsed\)/, '长满后逐帧取刷光帧');
    assert.match(view, /this\.apply\(fx\.progress, fx\.opacity,/, '进度仍走 model 时间轴');
    assert.match(view, /Math\.round\(ratio \* 100\)/, '百分比数字');
    assert.match(view, /this\.percentLabel/);
    assert.match(view, /BAR_BG_COLOR = new Color\(62, 64, 72, 255\)/, '深灰槽底：白槽上白字看不见');
    assert.match(view, /this\.barFill\.rect\(/, '刷光复用同一支 Graphics，不新建节点');
    assert.doesNotMatch(view, /addComponent\(/, 'prefab 上已有组件，不许运行时补挂');
    assert.doesNotMatch(view, /ProgressBar|tween\(/, '按宽度重画，不用 ProgressBar / tween');
});

// ============================================================
// ③ 版面：间隔 2px + 图标上方 10px
// ============================================================

test('★ prefab：碎片 icon 与进度条间隔恰好 2px，百分比压在进度条正中央', () => {
    const all = objects();
    const icon = named(all, 'BadgeIcon');
    const bar = named(all, 'BadgeBarBg');
    const fill = named(all, 'BadgeBarFill');
    const percent = named(all, 'BadgePercent');
    const iconWidth = transformOf(all, icon)._contentSize?.width ?? 0;
    const barWidth = transformOf(all, bar)._contentSize?.width ?? 0;
    const iconRight = (icon._lpos?.x ?? 0) + iconWidth / 2;
    const barLeft = (bar._lpos?.x ?? 0) - barWidth / 2;
    assert.equal(iconWidth, 44);
    assert.equal(barWidth, 100);
    assert.equal(barLeft - iconRight, 2, 'icon 右缘到进度条左缘只能有 2px');
    assert.equal(fill._lpos?.x, bar._lpos?.x, '填充与槽底对齐');
    assert.equal(percent._lpos?.x, bar._lpos?.x, '百分比与进度条同一中心');
    assert.equal(percent._lpos?.y, bar._lpos?.y);
});

test('★ 位置：按图标顶边世界坐标 + 10px + 徽标半高，不再用固定 58 上抬', () => {
    const all = objects();
    const lift = named(all, 'LiftAnchor');
    assert.equal(lift._lpos?.y, 10, 'LiftAnchor.y 现在是「距图标顶边 10px」');
    const view = body(VIEW);
    assert.match(view, /new Vec3\(0, iconTransform\.height \/ 2, 0\)/,
        '必须取图标顶边，不是猜一个截图高度');
    assert.match(view, /navTransform\.convertToNodeSpaceAR\(iconTop, new Vec3\(\)\)/,
        '顶边也要换回 BottomNav 局部坐标');
    assert.match(view, /top\.y \+ this\.lift \+ rootTransform\.height \/ 2/,
        '徽标底边 = 图标顶边 + 10，中心再抬自身半高');
    assert.doesNotMatch(view, /local\.y \+ this\.lift/, '旧的「中心 + 58」写法不许留');
});

test('prefab：根节点 / BadgePercent 的 Label 版面，且四个既有节点一个不丢', () => {
    const all = objects();
    const root = all[1];
    assert.equal(root?._name, 'HeroFragmentBadge');
    const rootTransform = transformOf(all, root);
    assert.equal(rootTransform._contentSize?.width, 150);
    assert.equal(rootTransform._contentSize?.height, 44);
    const percent = named(all, 'BadgePercent');
    const index = all.indexOf(percent);
    assert.ok(root._children?.some((child) => child.__id__ === index), '必须挂在根节点下');
    const componentTypes = (percent._components ?? []).map((ref) => all[ref.__id__]?.__type__);
    assert.deepEqual(componentTypes, ['cc.UITransform', 'cc.Label']);
    const label = all[(percent._components ?? [])[1].__id__];
    assert.equal(label?._string, '0%');
    assert.equal(label?._fontSize, 20);
    assert.equal(label?._isSystemFontUsed, true);
    assert.equal(label?._font, null);
    assert.equal(label?._overflow, 0, 'SHRINK 会把字缩虚，用 NONE + 固定字号');
    assert.equal(all[percent._prefab?.__id__ ?? -1]?.__type__, 'cc.PrefabInfo');
    for (const name of ['BadgeIcon', 'BadgeBarBg', 'BadgeBarFill', 'LiftAnchor']) {
        assert.ok(all.some((item) => item._name === name), `${name} 还在`);
    }
});

test('视图：prefab 被外部回滚到旧版时软降级，不抛错、进度条照常', () => {
    const view = body(VIEW);
    assert.match(view, /getChildByName\('BadgePercent'\)/);
    assert.match(view, /percentNode \? percentNode\.getComponent\(Label\) : null/);
    assert.match(view, /if \(this\.percentLabel && this\.percentLabel\.string !== text\)/);
});
