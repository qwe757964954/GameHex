import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { CARD_LINEUP_TEXTS } from '../assets/script/app/card/CardLineupTexts';
import { milestoneAnchorIndex, resolveDetailNeighbor } from '../assets/script/app/card/CardDetailPresenter';
import { formatCritDamageGain } from '../assets/script/app/card/CardDetailCritDamage';

const prefab = JSON.parse(readFileSync('assets/bundles/main-pages/ui/card/CardUpgrade.prefab', 'utf8'));
const pageBinding = prefab.find(item => 'closeButton' in item);
const component = (node, type) => node._components.map(ref => prefab[ref.__id__]).find(item => item.__type__ === type);

test('品质与职业使用对应完整切图，原尺寸显示且品质不重复叠字', () => {
    const quality = prefab.find(item => item._name === 'QualityDiamond');
    const tag = prefab.find(item => item._name === 'TagClass');
    assert.equal(prefab.some(item => item._name === 'QualityLabel'), false);
    assert.equal('qualityLabel' in pageBinding, false);
    for (const node of [quality, tag]) {
        const sprite = component(node, 'cc.Sprite');
        assert.equal(sprite._type, 0);
        assert.equal(sprite._sizeMode, 2, 'RAW 尺寸随当前切图更新，传说品质比其他品质宽 1px');
        assert.equal(sprite._isTrimmedMode, false);
    }
    assert.equal(prefab[pageBinding.tagClassSprite.__id__], component(tag, 'cc.Sprite'));
    assert.ok(prefab.find(item => item._name === 'TagClassLabel')._lpos.x > 0, '职业文字避开左侧图标');
    const folder = 'assets/bundles/main-pages/image/carddetail/identity';
    const images = readdirSync(folder).filter(name => name.endsWith('.png'));
    assert.equal(images.length, 8);
    for (const name of images) {
        const meta = JSON.parse(readFileSync(`${folder}/${name}.meta`, 'utf8'));
        assert.ok(meta.subMetas.f9941, `${name} 未导入 SpriteFrame`);
    }
    assert.equal(existsSync(`${folder}/auto-atlas.pac`), false);
});

test('新版详情的静态引用全部绑定，升级栏与详情同屏显示', () => {
    const source = readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8');
    for (const match of source.matchAll(/\n    (\w+): \w+ = null!;/g)) {
        assert.ok(pageBinding[match[1]], `${match[1]} 未绑定`);
        assert.ok(prefab[pageBinding[match[1]].__id__], `${match[1]} 引用丢失`);
    }
    assert.equal('folderTabButton' in pageBinding, false);
    assert.equal('backButton' in pageBinding, false);
    assert.equal('teamButton' in pageBinding, false, '队伍编辑入口已删除');
    assert.equal(prefab.some(item => item._name === 'BtnTeam' || item._name === 'BtnTeamLabel'), false);
    assert.equal(prefab.filter(item => item._name === 'CloseBtn').length, 1);
    const close = prefab[prefab[pageBinding.closeButton.__id__].node.__id__];
    assert.ok(close._lpos.x < 0, '关闭入口应位于左侧');
    const upgrade = prefab.find(item => item._name === 'UpgradePanel');
    assert.equal(upgrade._active, true);
    assert.equal(pageBinding.closeOnBlank, false);
    const root = prefab[prefab[0].data.__id__];
    assert.equal(component(root, 'cc.BlockInputEvents')._enabled, true,
        '禁止空白关闭时，全屏根节点仍拦截触摸，角色区域不能穿透到底层');
    for (const field of ['closeButton', 'previousButton', 'nextButton', 'upgradeButton']) {
        const button = prefab[pageBinding[field].__id__];
        assert.equal(button.__type__, 'cc.Button');
        assert.equal(button._transition, 0);
        assert.equal(button._target, null);
    }
    for (const node of prefab.filter(item => item.__type__ === 'cc.Node')) {
        assert.ok(component(node, 'cc.UITransform'), `${node._name} 缺少 UITransform`);
    }
    // 描述全空时的占位条：挂在遮罩视口里（不是 content），默认隐藏，四个方向撑满。
    const empty = prefab[pageBinding.milestoneEmpty.__id__];
    assert.equal(empty._name, 'MilestoneEmpty');
    assert.equal(prefab[empty._parent.__id__]._name, 'MilestoneViewport');
    assert.equal(empty._active, false, '默认隐藏，由 renderMilestones 开关');
    assert.equal(component(empty, 'cc.Widget')._alignFlags, 45);
    assert.equal(component(empty, 'cc.Label').__type__, 'cc.Label');
    assert.equal(prefab[pageBinding.milestoneEmptyLabel.__id__].__type__, 'cc.Label');
});

function nativeDriver(scroll) {
    assert.equal(scroll.__type__, '544earF5qRLB4JTuTnSr11+');
    assert.equal(scroll.useVirtualList, true);
    const native = prefab[scroll.nativeScrollView.__id__];
    assert.equal(native.__type__, 'cc.ScrollView');
    assert.equal(native.node.__id__, scroll.node.__id__);
    assert.equal(native._content.__id__, scroll.content.__id__);
    assert.equal(native.inertia, true);
    assert.equal(native.elastic, true);
    assert.equal(native.cancelInnerEvents, true);
    return native;
}

test('技能说明由原生 ScrollView 驱动虚拟列表，长行按真实高度排版', () => {
    const scroll = prefab[pageBinding.milestoneScroll.__id__];
    const native = nativeDriver(scroll);
    assert.equal(native.vertical, true);
    assert.equal(native.horizontal, false);
    assert.equal(scroll.useDynamicSize, true);
    const viewport = prefab[scroll.node.__id__];
    assert.ok(component(viewport, 'cc.Mask'));
    const content = prefab[scroll.content.__id__];
    assert.equal(component(content, 'cc.Layout'), undefined);
    assert.equal(content._children.length, 0);
    assert.equal(component(content, 'cc.UITransform')._anchorPoint.y, 1);
    assert.equal(scroll.itemNodes.length, 1);
    const template = prefab[scroll.itemNodes[0].__id__];
    assert.equal(prefab[template._parent.__id__]._active, false);
    const row = template._components.map(ref => prefab[ref.__id__]).find(c => c.rowBg);
    // 描述要分数字两色 ⇒ DescLabel 是 RichText；宽度靠 maxWidth（RichText 没有 overflow/wrap）。
    const desc = prefab[row.descLabel.__id__];
    assert.equal(desc.__type__, 'cc.RichText');
    assert.equal(desc._maxWidth, prefab[row.descTransform.__id__]._contentSize.width);
    assert.equal(desc._lineHeight, 28);
    // RichText 默认拦触摸，压在文字上会划不动列表。
    assert.equal(desc._handleTouchEvent, false);
});

test('SkillChain 在原生 ScrollView 上挂单模板虚拟列表，保留技能样式与引擎点击取消', () => {
    const scroll = prefab[pageBinding.chainScroll.__id__];
    const native = nativeDriver(scroll);
    assert.equal(native.horizontal, true);
    assert.equal(native.vertical, false);
    assert.equal(scroll.direction, 1);
    assert.equal(scroll.useDynamicSize, false);
    assert.equal(scroll.spacing, 16);
    assert.equal(scroll.headerSpacing, 6);
    assert.equal(scroll.itemNodes.length, 0);
    const content = prefab[scroll.content.__id__];
    assert.equal(component(content, 'cc.Layout'), undefined);
    assert.equal(content._children.length, 0);
    const template = prefab[scroll.itemNode.__id__];
    assert.equal(template._name, 'HexTemplate');
    assert.equal(prefab[template._parent.__id__]._active, false);
    assert.equal(component(template, 'cc.Widget'), undefined);
    assert.equal(prefab.some(n => n._name === 'ActiveHexTemplate'), false);
    const source = readFileSync('assets/script/app/card/CardDetailHexSlot.ts', 'utf8');
    assert.doesNotMatch(source, /_onTouch|propagationStopped/);
});

test('切图已导入为 spriteFrame，复用父目录图集，没有重复子图集', () => {
    const folder = 'assets/bundles/main-pages/image/carddetail';
    assert.deepEqual(readdirSync(folder).filter(name => name.endsWith('.png')), [], '旧版顶层切图已全部退役');
    assert.equal(existsSync(`${folder}/slices.json`), false, '旧版切图清单已退役');
    const uuids = new Set<string>();
    for (const sub of ['upgrade', 'skill', 'identity']) {
        for (const name of readdirSync(`${folder}/${sub}`).filter(name => name.endsWith('.png.meta'))) {
            const meta = JSON.parse(readFileSync(`${folder}/${sub}/${name}`, 'utf8'));
            assert.ok(meta.subMetas.f9941, `${sub}/${name} 未导入 SpriteFrame`);
            uuids.add(meta.subMetas.f9941.uuid);
        }
    }
    assert.deepEqual(readdirSync(`${folder}/upgrade`).filter(name => name.endsWith('.pac')), []);
    assert.deepEqual(readdirSync(folder).filter(name => name.endsWith('.pac')), ['auto-atlas.pac']);
    const imageRefs = prefab.filter(item => item._spriteFrame).map(item => item._spriteFrame.__uuid__);
    assert.ok(imageRefs.filter(id => uuids.has(id)).length >= 20);
});

test('切卡边界：首尾循环，单卡、空卡库和未知当前卡保持原界面', () => {
    const cards = [{ id: '1' }, { id: '2' }, { id: '3' }];
    assert.equal(resolveDetailNeighbor(cards, '1', -1), cards[2]);
    assert.equal(resolveDetailNeighbor(cards, '3', 1), cards[0]);
    assert.equal(resolveDetailNeighbor(cards, 'missing', 1), null);
    assert.equal(resolveDetailNeighbor([], '1', 1), null);
    assert.equal(resolveDetailNeighbor(cards.slice(0, 1), '1', 1), null);
});

function createPage() {
    const itemRows: Array<{ id: number; resolve: (value: unknown) => void }> = [];
    const itemIcons: Array<{ path: string; resolve: (value: unknown) => void }> = [];
    const exports: Record<string, any> = {};
    const heroLoads: Array<(value: unknown) => void> = [];
    const modelLoads: Array<(value: unknown) => void> = [];
    const shown: unknown[] = [];
    const releases: Array<() => void> = [];
    const intents: unknown[] = [];
    let cleared = 0;
    class PopupBase {
        node = { isValid: true, on() {}, off() {} };
        resourceScope = { disposed: false, defer: release => releases.push(release) };
        assets = { load: () => new Promise(resolve => modelLoads.push(resolve)) };
    }
    const rowExports: Record<string, any> = {};
    // 描述行的数字着色是独立纯模块，行组件直接 require 真实实现（不复制算法）。
    const markupExports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/card/CardSkillDescMarkup.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports: markupExports, require: () => ({}) });
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/card/CardDetailMilestoneRow.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports: rowExports, require: name => name === 'cc' ? {
        _decorator: { ccclass: () => value => value, property: () => () => {} }, Component: class {}, Color: class {},
    } : name === './CardSkillDescMarkup' ? markupExports : { CARD_LINEUP_TEXTS } });
    const makeRow = () => {
        const row: any = Object.assign(new rowExports.CardDetailMilestoneRow(), {
            rowTransform: {}, backgroundTransform: {}, descTransform: { height: 100, width: 514 }, rowBg: {},
            levelLabel: {}, unlockedColor: 'unlocked', lockedColor: 'locked',
            descLabel: { string: '', maxWidth: 0, fontColor: null },
            boostNumberColor: { r: 24, g: 115, b: 30 },
            plainNumberColor: { r: 28, g: 74, b: 168 },
        });
        row.node = { active: true, setPosition(_x, y) { row.y = y; }, getComponent: () => row };
        return row;
    };
    const code = ts.transpileModule(readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, console, require: name => {
        if (name === 'cc') return {
            _decorator: { ccclass: () => value => value, property: () => () => {} },
            Color: class {}, Button: { EventType: { CLICK: 'click' } }, Node: { EventType: { SIZE_CHANGED: 'size-changed' } },

        };
        if (name.endsWith('/PopupBase')) return { PopupBase };
        if (name.endsWith('/EventMgr')) return { EventMgr: { instance: { emit: (_event, payload) => intents.push(payload) } } };
        if (name === './CardPopupEvents') return { CardPopupEvent: { UpgradeIntent: 'upgrade-intent' } };
        if (name === '../itemdetail/ItemDetailRepository') return { itemDetailRepository: {
            loadItemRow: id => new Promise(resolve => itemRows.push({ id, resolve })),
        } };
        if (name === '../itemdetail/ItemDetailArtLoader') return {
            loadItemIconArt: path => new Promise(resolve => itemIcons.push({ path, resolve })),
        };
        if (name === './CardArtProvider') return { cardArtProvider: {
            loadLineupCard: () => new Promise(resolve => heroLoads.push(resolve)),
        } };
        if (name === './CardUnitPreviewAssets') return { CardUnitPreviewAssets: class {
            constructor(private loader) {}
            load(card) { return this.loader(card.unitPrefabPath); }
        } };
        if (name === './CardUnitPreview') return { CardUnitPreview: class {
            show(prefab) { shown.push(prefab); return Boolean(prefab); }
            clear() { cleared++; }
        } };
        if (name === './CardLineupTexts') return { CARD_LINEUP_TEXTS };
        if (name === './CardUpgradeCost') return { upgradeButtonText: () => '升级' };
        if (name === './CardDetailPresenter') return { milestoneAnchorIndex };
        if (name === './CardDetailCritDamage') return { formatCritDamageGain };
        return {};
    } });
    const page = new exports.CardUpgradePage();
    for (const field of ['statHpValue', 'statAttackValue', 'statBuildHpValue', 'statSpawnValue', 'statRangeValue',
        'statSpeedValue', 'statHpGain', 'statAttackGain', 'statBuildHpGain', 'statRangeGain', 'statSpeedGain', 'levelBigLabel']) page[field] = {};
    page.qualitySprite = { spriteFrame: null };
    page.tagClassSprite = { spriteFrame: null };
    const counts: number[] = [];
    const chainCounts: number[] = [];
    const anchors: number[] = [];
    page.milestoneScroll = { refreshList: count => counts.push(count), scrollToIndex: index => anchors.push(index) };
    page.milestoneEmpty = { active: true };
    page.milestoneEmptyLabel = { string: '' };
    page.chainScroll = { refreshList: count => chainCounts.push(count) };
    page.upgradeLabel = { color: { clone: () => 'label-color' } };
    page.upgradeButtonSprite = { grayscale: false };
    for (const field of ['closeButton', 'previousButton', 'nextButton', 'upgradeButton']) {
        page[field] = { node: { on() {} } };
    }
    page.onInit();
    page.heroSprite = {};
    return { page, counts, chainCounts, anchors, intents, makeRow, heroLoads, modelLoads, shown, releases, itemRows, itemIcons, clearCount: () => cleared };
}

test('材料图标复用物品表与共用加载器，通用经验缺图时取兵种经验，迟到结果不能覆盖', async () => {
    const { page, itemRows, itemIcons } = createPage();
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const sprite = { spriteFrame: 'old' };
    page.renderMaterialIcon(sprite, [{ id: '16000', owned: 0 }, { id: '16003', owned: 0 }]);
    assert.equal(sprite.spriteFrame, 'old', '新图标就绪前保留当前图标');
    assert.equal(itemRows[0].id, 16000);
    itemRows[0].resolve({ icon: '' }); await flush();
    assert.equal(itemRows[1].id, 16003);
    itemRows[1].resolve({ icon: 'icons/item/army-exp' }); await flush();
    assert.equal(itemIcons[0].path, 'icons/item/army-exp');
    itemIcons[0].resolve('shared-exp'); await flush();
    assert.equal(sprite.spriteFrame, 'shared-exp');
    page.renderMaterialIcon(sprite, [{ id: '18003', owned: 0 }]);
    assert.equal(sprite.spriteFrame, 'shared-exp');
    itemRows[2].resolve({ icon: 'icons/item/card' }); await flush();
    page.renderRevision++;
    page.renderMaterialIcon(sprite, [{ id: '18004', owned: 0 }]);
    itemRows[3].resolve({ icon: 'icons/item/current-card' }); await flush();
    itemIcons[2].resolve('current'); itemIcons[1].resolve('stale'); await flush();
    assert.equal(sprite.spriteFrame, 'current');
    page.renderMaterialIcon(sprite, [{ id: '18005', owned: 0 }]);
    itemRows[4].resolve({ icon: 'icons/item/late' }); await flush();
    page.onClose(); itemIcons[3].resolve('closed'); await flush();
    assert.equal(sprite.spriteFrame, 'current');
    const { page: emptyPage } = createPage();
    const emptySprite = { spriteFrame: 'old' };
    emptyPage.renderMaterialIcon(emptySprite, []); await flush();
    assert.equal(emptySprite.spriteFrame, null, '没有材料时仍须清除旧图标');
    for (const [field, name] of [['matCardIcon', 'CardIcon'], ['matExpIcon', 'ExpIcon']]) {
        const bound = prefab[pageBinding[field].__id__];
        assert.equal(bound.__type__, 'cc.Sprite');
        assert.equal(prefab[bound.node.__id__]._name, name);
        assert.equal(bound._spriteFrame, null);
    }
});

test('材料状态渲染入口将真实消耗 ID 交给两个已绑定图标', () => {
    const { page } = createPage();
    for (const field of ['matCardCountLabel', 'matCardItemLabel', 'matExpCountLabel', 'matExpItemLabel',
        'levelTransitionLabel', 'hintLabel', 'matCardIcon', 'matExpIcon']) page[field] = {};
    // 入参口径：每件材料是 `{ id, owned }`（`owned` 给「点图标开道具信息」用），不再是裸 id 串。
    const calls: Array<{ sprite: unknown; entries: { id: string; owned: number }[] }> = [];
    page.renderMaterialIcon = (sprite, entries) => calls.push({ sprite, entries: Array.from(entries) });
    page.renderStatus({ configured: true, maxed: false, level: 1, targetLevel: 2,
        requirements: [{ key: 'card', itemId: '18003', owned: 100, need: 53, enough: true },
            { key: 'exp', itemId: '16000', owned: 200, need: 160, enough: true }],
        generalExpItemId: '16000', armyExpItemId: '16003', generalExpOwned: 100, armyExpOwned: 100,
        canUpgrade: true }, 'ready');
    // ⚠️ 页面是在 `vm` 沙箱里加载的，那边 new 的对象字面量与本地 Object 原型不同，
    //    直接 deepEqual 会报「same structure but not reference-equal」⇒ 拍平成字符串再比。
    assert.deepEqual(calls.map(call => ({
        sprite: call.sprite,
        entries: call.entries.map(entry => `${entry.id}:${entry.owned}`),
    })), [
        { sprite: page.matCardIcon, entries: ['18003:100'] },
        { sprite: page.matExpIcon, entries: ['16000:100', '16003:100'] },
    ]);
});

test('材料不足时升级按钮置灰，材料齐备后恢复原色并可点', () => {
    const { page } = createPage();
    for (const field of ['matCardCountLabel', 'matCardItemLabel', 'matExpCountLabel', 'matExpItemLabel',
        'levelTransitionLabel', 'hintLabel', 'matCardIcon', 'matExpIcon']) page[field] = {};
    page.renderMaterialIcon = () => {};
    const status = (enough: boolean) => ({ configured: true, maxed: false, level: 1, targetLevel: 2,
        requirements: [{ key: 'card', itemId: '18003', name: '卡牌', owned: enough ? 100 : 0, need: 53, enough },
            { key: 'exp', itemId: '16000', name: '', owned: 200, need: 160, enough: true }],
        generalExpItemId: '16000', armyExpItemId: '16003', generalExpOwned: 100, armyExpOwned: 100,
        canUpgrade: enough, blockedReason: enough ? '' : '卡牌不足（0/53）' });
    page.renderStatus(status(false), 'ready');
    assert.equal(page.hintLabel.string, '', '这一栏不再报「材料不足」，改由按钮置灰 + 材料数字表达');
    assert.equal(page.upgradeButton.interactable, false);
    assert.equal(page.upgradeButtonSprite.grayscale, true, '材料不足时按钮整体置灰');
    assert.equal(page.upgradeLabel.color, page.disabledUpgradeLabelColor);
    page.renderStatus(status(true), 'ready');
    assert.equal(page.upgradeButton.interactable, true);
    assert.equal(page.upgradeButtonSprite.grayscale, false);
    assert.equal(page.upgradeLabel.color, 'label-color', '可点时回到 prefab 里的文字颜色');
    page.renderStatus({ ...status(true), maxed: true }, 'ready');
    assert.equal(page.upgradeButtonSprite.grayscale, true, '满级不可点同样置灰');
});

test('奖励条显示「升级增加全队暴击伤害」，数值取卡牌下一级的真实增量', () => {
    const { page } = createPage();
    for (const field of ['matCardCountLabel', 'matCardItemLabel', 'matExpCountLabel', 'matExpItemLabel',
        'levelTransitionLabel', 'hintLabel', 'matCardIcon', 'matExpIcon']) page[field] = {};
    page.renderMaterialIcon = () => {};
    const status = { configured: true, maxed: false, level: 12, targetLevel: 13,
        requirements: [{ key: 'card', itemId: '68003', name: '火焰树妖', owned: 21, need: 325, enough: false }],
        generalExpItemId: '16000', armyExpItemId: '16003', generalExpOwned: 6108, armyExpOwned: 0,
        canUpgrade: false, blockedReason: '卡牌不足（21/325）' };
    page.renderDetail({ stats: [], chain: [], critDamageGain: 1, milestones: [] });
    page.renderStatus(status, 'ready');
    assert.equal(page.hintLabel.string, '升级增加全队暴击伤害：1%');
    assert.equal(page.hintLabel.color, page.critColor);
    page.renderDetail({ stats: [], chain: [], critDamageGain: 0.5, milestones: [] });
    page.renderStatus(status, 'ready');
    assert.equal(page.hintLabel.string, '升级增加全队暴击伤害：0.5%');
    page.renderDetail({ stats: [], chain: [], critDamageGain: 0, milestones: [] });
    page.renderStatus(status, 'ready');
    assert.equal(page.hintLabel.string, '', '链上没有下一档时不显示');
    page.renderStatus({ ...status, canUpgrade: true, blockedReason: '' }, 'failed');
    assert.equal(page.hintLabel.string, CARD_LINEUP_TEXTS.upgradeFailed, '失败/未连接仍占用这一栏');
});

test('说明交给虚拟列表，复用行完整覆盖颜色、文字和高度', () => {
    const { page, counts, makeRow } = createPage();
    const milestones = Array.from({ length: 100 }, (_, index) => ({ unlockLevel: index + 1, desc: '技能说明 ' + index, unlocked: index < 2 }));
    page.renderDetail({ stats: [], chain: [], milestones });
    assert.deepEqual(counts, [100]);
    assert.equal(page.milestoneEmpty.active, false, '有行时不占位');
    const row = makeRow();
    page.milestoneScroll.renderItemFn(row.node, 99);
    assert.equal(row.rowTransform.height, 120);
    // 「技能说明 99」的 99 不是增益百分比 ⇒ 蓝色（绿色只给「提高/增加/提升 + %」）。
    assert.equal(row.descLabel.string, '技能说明 <color=#1C4AA8>99</color>');
    assert.equal(row.descLabel.maxWidth, 514, 'RichText 靠 maxWidth 换行，宽度要跟节点一致');
    assert.equal(row.descLabel.fontColor, 'locked');
    row.descTransform.height = 14;
    page.milestoneScroll.renderItemFn(row.node, 0);
    assert.equal(row.rowTransform.height, 61);
    assert.equal(row.descLabel.fontColor, 'unlocked');
    page.renderDetail(null);
    assert.equal(counts.at(-1), 0);
    assert.equal(page.milestones.length, 0);
});

test('技能描述一条都没有时显示空态占位（如分裂菇 68014 四个技能全未填）', () => {
    const { page, counts, anchors } = createPage();
    page.renderDetail({ stats: [], chain: [], critDamageGain: 0, milestones: [] });
    assert.deepEqual(counts, [0]);
    assert.equal(page.milestoneEmpty.active, true);
    assert.equal(page.milestoneEmptyLabel.string, CARD_LINEUP_TEXTS.detailMilestoneEmpty);
    assert.deepEqual(anchors, [0], '空列表落点回 0，不残留上次卡牌的滚动位置');
    page.renderDetail({ stats: [], chain: [], critDamageGain: 0, milestones: [
        { name: '魔力塑能', unlockLevel: 1, desc: '攻击提高10%', unlocked: true },
    ] });
    assert.equal(page.milestoneEmpty.active, false, '换到有描述的卡要收起来');
    page.renderDetail(null);
    assert.equal(page.milestoneEmpty.active, false, '详情还没到（加载中）不显示占位');
});

test('描述行带技能名，首档（解锁等级 0）显示「1级」，打开时落在最新解锁档', () => {
    const { page, anchors, makeRow } = createPage();
    const milestones = [
        { name: '魔力塑能', unlockLevel: 0, desc: '攻击提高10%（三级同值，不叠加）', unlocked: true },
        { name: '魔力回路', unlockLevel: 6, desc: '射程提高10%（三级同值，不叠加）', unlocked: true },
        { name: '灼热地带', unlockLevel: 12, desc: '灼热35%', unlocked: false },
    ];
    page.renderDetail({ stats: [], chain: [], critDamageGain: 0, milestones });
    assert.deepEqual(anchors, [1], '落在最新解锁的那一档');
    const row = makeRow();
    page.milestoneScroll.renderItemFn(row.node, 0);
    assert.equal(row.levelLabel.string, '1级', '表里 0 = 开局即解锁，按「1级」展示');
    assert.equal(row.descLabel.string, '魔力塑能：攻击提高<color=#18731E>10%</color>（三级同值，不叠加）');
    assert.equal(row.descLabel.fontColor, 'unlocked');
    page.milestoneScroll.renderItemFn(row.node, 1);
    assert.equal(row.levelLabel.string, '6级');
    page.milestoneScroll.renderItemFn(row.node, 2);
    assert.equal(row.descLabel.fontColor, 'locked');
});

test('升级等待新消耗时保留原材料展示，刷新技能不清空列表或重置滚动', () => {
    const { page, counts, anchors } = createPage();
    for (const field of ['nameLabel', 'levelTransitionLabel', 'tagClassLabel', 'powerLabel',
        'matCardCountLabel', 'matCardItemLabel', 'matExpCountLabel', 'matExpItemLabel', 'hintLabel',
        'matCardIcon', 'matExpIcon', 'campTagRoot']) page[field] = {};
    page.renderMaterialIcon = () => {};
    const detail = { stats: [], chain: [], critDamageGain: 0, milestones: [{ name: '技能', unlockLevel: 2, desc: '技能', unlocked: false }] };
    const state = { data: { cardId: '1', level: 1 }, cardId: '1', level: 1, detail, phase: 'ready', status: {
        configured: true, maxed: false, level: 1, targetLevel: 2, canUpgrade: true,
        requirements: [{ key: 'card', itemId: '18003', name: '卡牌', owned: 100, need: 53, enough: true }],
        generalExpItemId: '16000', armyExpItemId: '16003', generalExpOwned: 100, armyExpOwned: 100,
    } };
    page.render({ ...state, status: null, phase: 'loading' });
    assert.equal(page.matCardCountLabel.string, '', '首次加载仍清除占位材料');
    assert.deepEqual(anchors, [0], '首次铺列表时落到锚点行');
    page.render(state);
    assert.equal(page.matCardCountLabel.string, '100/53');
    page.render({ ...state, phase: 'submitting' });
    page.render({ ...state, status: null, phase: 'loading', level: 2 });
    assert.equal(page.matCardCountLabel.string, '100/53', '刷新期间不能闪空');
    assert.equal(page.upgradeButton.interactable, false, '新消耗未就绪时禁止再次升级');
    page.render({ ...state, level: 2, status: { ...state.status, level: 2, targetLevel: 3,
        requirements: [{ ...state.status.requirements[0], owned: 47, need: 60, enough: false }], canUpgrade: false } });
    assert.equal(page.matCardCountLabel.string, '47/60');
    assert.equal(page.upgradeButton.interactable, false);
    assert.ok(counts.every(count => count === 1));
    assert.deepEqual(anchors, [0], '落点没变就不重复滚动，同弹窗刷新保留当前阅读位置');
});


test('详情使用当前卡模型待机，迟到的上一张模型与关闭后的加载均不能挂回页面', async () => {
    const { page, heroLoads, modelLoads, shown, releases, clearCount } = createPage();
    page.renderHero({ unitPrefabPath: 'old' }, 'old-art');
    page.renderHero({ unitPrefabPath: 'current' }, 'current-art');
    modelLoads[1]('current-model');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(shown, ['current-model']);
    assert.equal(page.heroSprite.spriteFrame, 'current-art');
    modelLoads[0]('old-model');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(shown, ['current-model']);
    assert.equal(page.heroSprite.spriteFrame, 'current-art');
    page.renderHero({ unitPrefabPath: 'late' }, 'late-art');
    page.onClose();
    assert.equal(clearCount(), 2, '切卡与关闭分别清除预览');
    assert.equal(page.previewAssets, null);
    modelLoads[2]('late-model');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(shown, ['current-model']);
    releases.forEach(release => release());
    assert.equal(clearCount(), 3, '资源作用域销毁也释放模型实例');
});

test('详情立绘先显示，不等待骨骼；同卡刷新不重复备图或挂载模型', async () => {
    const { page, heroLoads, modelLoads, shown } = createPage();
    const card = { id: '1', unitPrefabPath: 'current' };
    page.renderHero(card, 'ready-art');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.heroSprite.spriteFrame, 'ready-art');
    assert.equal(shown.length, 0, '骨骼尚未加载完时保留立绘');
    page.renderHero({ ...card }, 'ready-art');
    assert.equal(heroLoads.length, 0, 'View 不再发起卡牌图或配置加载');
    assert.equal(modelLoads.length, 1);
    modelLoads[0]('ready-model');
    await new Promise(resolve => setImmediate(resolve));
    page.renderHero(card, 'ready-art');
    assert.deepEqual(shown, ['ready-model']);
});

test('详情没有兵种模型时保留当前卡立绘，空卡清除旧模型', async () => {
    const { page, heroLoads, modelLoads, shown, clearCount } = createPage();
    page.renderHero({ unitPrefabPath: null }, 'fallback');
    modelLoads[0](null);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(shown, [null]);
    assert.equal(page.heroSprite.spriteFrame, 'fallback');
    page.renderHero(null, null);
    assert.equal(clearCount(), 1);
    assert.equal(page.heroSprite.spriteFrame, null);
});


test('详情使用顶底分区约束：技能列表背景填充中段，升级和提示跟随底部', () => {
    const named = name => prefab.find(item => item.__type__ === 'cc.Node' && item._name === name);
    const widget = name => component(named(name), 'cc.Widget');
    assert.equal(widget('Layout')._alignFlags, 45);
    assert.equal(widget('TopRegion')._alignFlags, 17, '上方展示按顶边与水平居中对齐');
    assert.equal(widget('TopRegion')._top, 0);
    assert.equal(widget('BottomRegion')._alignFlags, 45);
    assert.equal(widget('BottomRegion')._bottom, 0);
    for (const name of ['Layout', 'TopRegion', 'BottomRegion']) {
        assert.equal(named(name)._lscale.x, 1);
        assert.equal(named(name)._lscale.y, 1);
    }
    for (const name of ['Header', 'StatsPanel']) {
        assert.equal(prefab[named(name)._parent.__id__]._name, 'TopRegion');
    }
    for (const name of ['TitleBar', 'UpgradePanel', 'RewardStrip']) {
        assert.equal(prefab[named(name)._parent.__id__]._name, 'BottomRegion');
    }
    for (const name of ['CloseBtn', 'LevelTab']) assert.equal(prefab[named(name)._parent.__id__]._name, 'TitleBar');
    assert.equal(prefab[named('Hint')._parent.__id__]._name, 'RewardStrip');
    const viewport = widget('MilestoneViewport');
    assert.equal(viewport._alignFlags, 45);
    const panel = named('SkillsPanel');
    assert.equal(prefab[panel._parent.__id__]._name, 'Layout');
    assert.equal(component(panel, 'cc.Sprite')._type, 1, '完整背景使用九宫格拉伸');
    assert.equal(widget('SkillsPanel')._alignFlags, 45);
    assert.equal(prefab[named('SkillHeader')._parent.__id__]._name, 'SkillsPanel');
    assert.equal(prefab[named('SkillChain')._parent.__id__]._name, 'SkillHeader');
    assert.equal(prefab[named('MilestoneViewport')._parent.__id__]._name, 'SkillsPanel');
    assert.equal(named('SkillsListBackground'), undefined);
    assert.equal(named('MilestonePaper'), undefined);
    const headerHeight = component(named('SkillHeader'), 'cc.UITransform')._contentSize.height;
    assert.ok(Math.abs(headerHeight - viewport._top) < 0.001, '列表紧接技能栏底边');
    const meta = JSON.parse(readFileSync('assets/bundles/main-pages/image/carddetail/upgrade/kp_bg.png.meta', 'utf8')); // 当前详情页九宫格底板
    for (const key of ['borderTop', 'borderBottom', 'borderLeft', 'borderRight']) {
        assert.ok(meta.subMetas.f9941.userData[key] > 0, `${key} 保留完整边框`);
    }
    const source = readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8');
    assert.doesNotMatch(source, /fitLayout|alignDesignLayout|setScale|SIZE_CHANGED|pageTransform|skillsWidget|paperWidget/);
});

test('展示栏压缩 90px 全部让给技能描述列表，底边仍钉在奖励条上沿', () => {
    const named = name => prefab.find(item => item.__type__ === 'cc.Node' && item._name === name);
    const size = name => component(named(name), 'cc.UITransform')._contentSize;
    const widget = name => component(named(name), 'cc.Widget');
    const cardTop = size('CardUpgrade').height / 2;
    const COMPACT = 90;
    // 展示栏 = 卡顶到米色纸面上沿（立绘 / 名字 / 品质职业 / 战力都在这段里）。
    const paperTop = cardTop - widget('BodyPaper')._top;
    assert.equal(cardTop - paperTop, 512, '展示栏由 602 压到 512');
    assert.equal(602 - (cardTop - paperTop), COMPACT, '让出的高度就是 90（70 + 立绘再让 20）');

    // 技能面板顶边随之上移，底边（0~1 比例，钉在奖励条上沿）不动 ⇒ 整体长高 90。
    const panelTop = cardTop - widget('SkillsPanel')._top;
    const panelHeight = size('SkillsPanel').height;
    assert.equal(panelHeight, 183.73913043478262 + COMPACT, '技能面板整体长高 90');
    assert.equal(widget('SkillsPanel')._bottom, 0.21739130434782608, '底边比例不变，跟着画布底部走');

    // 描述视口吃满「面板高 - 技能栏高」，正是多出来的那 90px。
    const headerHeight = size('SkillHeader').height;
    assert.equal(size('MilestoneViewport').height, panelHeight - headerHeight);
    assert.equal(size('MilestoneViewport').height, 42.73913043478262 + COMPACT, '描述视口由 42.74 涨到 132.74');
    assert.equal(size('MilestoneEmpty').height, size('MilestoneViewport').height, '空态占位跟着视口一起长');

    // 展示栏内部：顶边仍贴卡顶，战力牌与纸面上沿、属性区与纸面上沿的相对间距不因压缩而变化。
    const regionHeight = size('TopRegion').height;
    const regionCenter = cardTop - regionHeight / 2;
    assert.equal(regionCenter, named('TopRegion')._lpos.y, 'TopRegion 位置与顶边对齐一致');
    const headerCenter = regionCenter + named('Header')._lpos.y;
    assert.equal(cardTop, headerCenter + size('Header').height / 2, '名字/立绘栏顶边仍贴住卡顶');
    assert.equal(size('Header').height, cardTop - paperTop, '展示栏高度 = Header 高度');
    const barBottom = regionCenter + named('PowerBar')._lpos.y - size('PowerBar').height / 2;
    assert.equal(barBottom - paperTop, 17, '战力牌底边仍距纸面上沿 17');
    const statsTop = regionCenter + named('StatsPanel')._lpos.y + size('StatsPanel').height / 2;
    assert.equal(paperTop - statsTop, 7, '属性区顶边仍在纸面以内 7');
    assert.ok(panelTop < statsTop - size('StatsPanel').height, '属性区整体落在纸面以内');

    // 上排（名字 / 品质 / 职业）到卡顶留 40 空：把上一版挤到 24 的留白还回来。
    const rowTop = headerCenter + named('NameLabel')._lpos.y + size('NameLabel').height / 2;
    assert.equal(cardTop - rowTop, 40, '上排留空 40');

    // 立绘等比缩小，高度贴着「战力牌顶 → 上排底」那段可用带（原版 390 对 388.5 的带）。
    // 锚点是 (0.5, 0)：`_lpos.y` 就是脚点，不是中心。
    const hero = named('Hero');
    const heroHeight = size('Hero').height * hero._lscale.y;
    const bandBottom = regionCenter + named('PowerBar')._lpos.y + size('PowerBar').height / 2;
    const bandTop = headerCenter + named('QualityDiamond')._lpos.y - size('QualityDiamond').height / 2;
    assert.equal(heroHeight, 318, '立绘可见高度 390 → 318');
    assert.ok(Math.abs(heroHeight - (bandTop - bandBottom)) <= 1, '立绘高度 ≈ 可用带高度');
    assert.equal(hero._lscale.x, hero._lscale.y, '等比缩放，别拉扁');
    assert.equal(headerCenter + hero._lpos.y - bandBottom, 12, '脚点仍距战力牌顶 12');

    // spine 预览只认代码里的归一高度（`cardPreviewFactor` 会抵消节点缩放），
    // 静态立绘只认节点缩放 ⇒ 两处必须是同一个 318。
    const source = readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8');
    assert.match(source, /const HERO_PREVIEW_HEIGHT = 318;/, 'spine 归一高度要跟着立绘高度');
});


function makeHexSlot() {
    return {
        skillId: 0, interactable: false,
        node: { name: 'pooled-slot' }, nameLabel: { string: '' }, nameTransform: { width: 0 }, hexSprite: { spriteFrame: 'gray' },
        skillArt: { node: { active: true } }, lockRoot: { active: false }, namePlate: { spriteFrame: '', node: { active: true } },
        badgeSprite: { node: { active: true } }, badgeLabel: { string: '' }, unlockedColor: 'unlocked',
        normalNamePlateFrame: 'blue', activeNamePlateFrame: 'purple',
        namePlateTransform: { width: 0, height: 0, setContentSize(width, height) { this.width = width; this.height = height; } },
        badgeTransform: { width: 0, height: 0, setContentSize(width, height) { this.width = width; this.height = height; } },
        badgeWidget: { left: 0, updateAlignment() {} },
    };
}

test('技能链按真实解锁状态切换标签、锁和角标，重复渲染不会残留上一种状态', () => {
    const { page } = createPage();
    const slot = makeHexSlot();
    page.renderHexSlot(slot, null, 0);
    assert.equal(slot.nameLabel.string, CARD_LINEUP_TEXTS.detailChainLocked);
    assert.equal(slot.lockRoot.active, true);
    assert.equal(slot.skillArt.node.active, true, '图标统一共用，未配置格也不留灰底');
    assert.equal(slot.namePlate.node.active, false);
    assert.equal(slot.badgeSprite.node.active, false);
    assert.equal(slot.interactable, false);
    page.renderHexSlot(slot, { unlocked: true, empty: false, unlockLevel: 3, name: '灵巧投掷' }, 0);
    assert.equal(slot.nameLabel.string, '灵巧投掷');
    assert.equal(slot.nameTransform.width, 64);
    assert.equal(slot.lockRoot.active, false);
    assert.equal(slot.namePlate.node.active, true);
    assert.equal(slot.badgeSprite.node.active, true);
    assert.equal(slot.badgeLabel.string, '3');
    assert.equal(slot.interactable, true);
    page.renderHexSlot(slot, { unlocked: false, empty: false, unlockLevel: 6, name: '铁质飞镖' }, 1);
    assert.equal(slot.nameLabel.string, '6级解锁');
    assert.equal(slot.nameTransform.width, 114);
    assert.equal(slot.skillArt.node.active, true);
    assert.equal(slot.lockRoot.active, true);
    assert.equal(slot.namePlate.node.active, false);
    assert.equal(slot.badgeSprite.node.active, false);
    assert.equal(slot.badgeLabel.string, '');
    page.renderHexSlot(slot, { unlocked: true, empty: false, unlockLevel: 0, name: '克制' }, 1);
    assert.equal(slot.nameLabel.string, '克制');
    assert.equal(slot.nameTransform.width, 60);
    assert.equal(slot.lockRoot.active, false);
    assert.equal(slot.namePlate.node.active, true);
    assert.equal(slot.badgeSprite.node.active, false);
    page.renderHexSlot(slot, { unlocked: true, empty: true, unlockLevel: 99, name: '占位' }, 1);
    assert.equal(slot.nameLabel.string, CARD_LINEUP_TEXTS.detailChainLocked);
    assert.equal(slot.lockRoot.active, true);
    assert.equal(slot.namePlate.node.active, false);
    assert.equal(slot.interactable, false);
    assert.equal(slot.hexSprite.spriteFrame, 'gray', '底图预绑，运行时不再覆盖为旧绿色技能图');
});

test('技能格子按列表索引复用，切卡后点击当前技能，空态清空列表', () => {
    const { page, chainCounts, intents } = createPage();
    const chain = Array.from({ length: 5 }, (_, index) => ({
        skillId: 100 + index, name: `技能${index}`, unlocked: index < 2, unlockLevel: index * 3, empty: false,
    }));
    page.renderDetail({ stats: [], chain, milestones: [] });
    assert.deepEqual(chainCounts, [5]);
    const slot = makeHexSlot();
    const handlers = new Set<Function>();
    const node = { getComponent: () => slot, on: (_event, callback) => handlers.add(callback) };
    page.chainScroll.onItemInitFn(node);
    page.renderHexSlot(slot, chain[4], 4);
    assert.equal(slot.nameLabel.string, '12级解锁');
    assert.equal(slot.skillArt.node.active, true);
    page.renderHexSlot(slot, chain[0], 0);
    assert.equal(slot.nameLabel.string, '技能0');
    assert.equal(slot.skillArt.node.active, true, '首格也共用同一张技能图标（暂无专属图）');
    page.renderHexSlot(slot, chain[1], 1);
    assert.equal(slot.namePlate.spriteFrame, 'purple');
    assert.equal(slot.namePlateTransform.width, 68);
    assert.equal(slot.namePlateTransform.height, 31);
    assert.equal(slot.badgeTransform.width, 32.4);
    assert.equal(slot.badgeWidget.left, 75.8);
    page.renderHexSlot(slot, chain[0], 0);
    assert.equal(slot.namePlate.spriteFrame, 'blue');
    assert.equal(slot.namePlateTransform.width, 72);
    assert.equal(slot.namePlateTransform.height, 35);
    assert.equal(slot.badgeTransform.width, 36);
    assert.equal(slot.badgeWidget.left, 73);
    for (const handler of handlers) handler(slot);
    assert.equal((intents.at(-1) as { skillId: number }).skillId, 100);
    page.renderDetail({ stats: [], chain: [{ ...chain[0], skillId: 900, name: '新卡技能' }], milestones: [] });
    page.chainScroll.onItemInitFn(node);
    page.chainScroll.renderItemFn(node, 0);
    assert.equal(handlers.size, 1, '复用时不重复绑定 CLICK');
    for (const handler of handlers) handler(slot);
    assert.equal((intents.at(-1) as { skillId: number }).skillId, 900);
    page.onSkillClick();
    assert.equal((intents.at(-1) as { skillId: number }).skillId, 900, '独立技能入口从当前数据选择技能');
    page.renderDetail(null);
    assert.deepEqual(chainCounts, [5, 1, 0]);
});
