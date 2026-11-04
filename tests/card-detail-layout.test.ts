import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { CARD_LINEUP_TEXTS } from '../assets/script/app/card/CardLineupTexts';
import { resolveDetailNeighbor } from '../assets/script/app/card/CardDetailPresenter';

const prefab = JSON.parse(readFileSync('assets/bundles/main-pages/ui/card/CardUpgrade.prefab', 'utf8'));
const pageBinding = prefab.find(item => 'closeButton' in item);
const component = (node, type) => node._components.map(ref => prefab[ref.__id__]).find(item => item.__type__ === type);

test('新版详情的静态引用全部绑定，升级栏与详情同屏显示', () => {
    const source = readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8');
    for (const match of source.matchAll(/\n    (\w+): \w+ = null!;/g)) {
        assert.ok(pageBinding[match[1]], `${match[1]} 未绑定`);
        assert.ok(prefab[pageBinding[match[1]].__id__], `${match[1]} 引用丢失`);
    }
    assert.equal('folderTabButton' in pageBinding, false);
    assert.equal('backButton' in pageBinding, false);
    assert.equal(prefab.filter(item => item._name === 'CloseBtn').length, 1);
    const close = prefab[prefab[pageBinding.closeButton.__id__].node.__id__];
    assert.ok(close._lpos.x < 0, '关闭入口应位于左侧');
    const upgrade = prefab.find(item => item._name === 'UpgradePanel');
    assert.equal(upgrade._active, true);
    assert.equal(pageBinding.closeOnBlank, false);
    const root = prefab[prefab[0].data.__id__];
    assert.equal(component(root, 'cc.BlockInputEvents')._enabled, true,
        '禁止空白关闭时，全屏根节点仍拦截触摸，角色区域不能穿透到底层');
    for (const field of ['closeButton', 'previousButton', 'nextButton', 'teamButton', 'upgradeButton']) {
        const button = prefab[pageBinding[field].__id__];
        assert.equal(button.__type__, 'cc.Button');
        assert.equal(button._transition, 0);
        assert.equal(button._target, null);
    }
    for (const node of prefab.filter(item => item.__type__ === 'cc.Node')) {
        assert.ok(component(node, 'cc.UITransform'), `${node._name} 缺少 UITransform`);
    }
});

test('技能说明滚动裁切，内容锚点固定在顶部，行文字按实际高度排版', () => {
    const scroll = prefab[pageBinding.milestoneScroll.__id__];
    const viewport = prefab[scroll.node.__id__];
    assert.ok(component(viewport, 'cc.Mask'));
    assert.equal(component(viewport, 'cc.UITransform')._anchorPoint.y, 1);
    assert.equal(scroll.__type__, '544earF5qRLB4JTuTnSr11+');
    assert.equal(scroll.useVirtualList, true);
    assert.equal(scroll.useDynamicSize, true);
    assert.equal(scroll.itemCreationMode, 0);
    assert.equal(scroll.direction, 0);
    assert.equal(component(viewport, 'cc.ScrollView'), undefined);
    assert.equal(scroll.itemNodes.length, 1);
    const content = prefab[scroll.content.__id__];
    assert.equal(content._children.length, 0, '列表不预建所有行');
    assert.equal(content._lpos.y, 0, '虚拟列表零滚动量对应顶部');
    const template = prefab[scroll.itemNodes[0].__id__];
    assert.equal(prefab[template._parent.__id__]._active, false);
    const transform = component(content, 'cc.UITransform');
    assert.equal(transform._anchorPoint.y, 1);
    const rows = prefab.filter(item => 'rowBg' in item);
    assert.equal(rows.length, 1);
    for (const row of rows) {
        assert.equal(prefab[row.descLabel.__id__]._overflow, 3);
        assert.equal(prefab[row.descLabel.__id__]._enableWrapText, true);
        for (const key of ['rowTransform', 'backgroundTransform', 'descTransform']) {
            assert.equal(prefab[row[key].__id__].__type__, 'cc.UITransform');
        }
    }
});

test('切图已导入为 spriteFrame，复用父目录图集，没有重复子图集', () => {
    const folder = 'assets/bundles/main-pages/image/carddetail';
    const manifest = JSON.parse(readFileSync(`${folder}/slices.json`, 'utf8'));
    const uuids = new Set<string>();
    for (const name of Object.keys(manifest.slices)) {
        const meta = JSON.parse(readFileSync(`${folder}/${name}.png.meta`, 'utf8'));
        assert.ok(meta.subMetas.f9941, `${name} 未导入 SpriteFrame`);
        uuids.add(meta.subMetas.f9941.uuid);
    }
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
    const pending: Array<(value: unknown) => void> = [];
    const exports: Record<string, any> = {};
    const heroLoads: Array<(value: unknown) => void> = [];
    const modelLoads: Array<(value: unknown) => void> = [];
    const shown: unknown[] = [];
    const releases: Array<() => void> = [];
    let cleared = 0;
    class PopupBase {
        node = { isValid: true };
        resourceScope = { disposed: false, defer: release => releases.push(release) };
        assets = { load: () => new Promise(resolve => modelLoads.push(resolve)) };
    }
    const rowExports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/card/CardDetailMilestoneRow.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports: rowExports, require: name => name === 'cc' ? {
        _decorator: { ccclass: () => value => value, property: () => () => {} }, Component: class {}, Color: class {},
    } : { CARD_LINEUP_TEXTS } });
    const makeRow = () => {
        const row: any = Object.assign(new rowExports.CardDetailMilestoneRow(), {
            rowTransform: {}, backgroundTransform: {}, descTransform: { height: 100 },
            levelLabel: {}, unlockedColor: 'unlocked', lockedColor: 'locked',
            descLabel: { string: '', updateRenderData() {} },
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
            Color: class {}, Button: { EventType: { CLICK: 'click' } },
        };
        if (name.endsWith('/PopupBase')) return { PopupBase };
        if (name === '../itemdetail/ItemDetailRepository') return { itemDetailRepository: {
            loadItemRow: id => new Promise(resolve => itemRows.push({ id, resolve })),
        } };
        if (name === '../itemdetail/ItemDetailArtLoader') return {
            loadItemIconArt: path => new Promise(resolve => itemIcons.push({ path, resolve })),
        };
        if (name === './CardArtProvider') return { cardArtProvider: {
            loadLineupCard: () => new Promise(resolve => heroLoads.push(resolve)),
        } };
        if (name === './CardHeroView') return { applyCardHeroArt: (hero, _transform, frame) => { hero.spriteFrame = frame; } };
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
        if (name === './CardLineupIcons') return { loadCardDetailArt: () => new Promise(resolve => pending.push(resolve)) };
        return {};
    } });
    const page = new exports.CardUpgradePage();
    for (const field of ['statHpValue', 'statAttackValue', 'statBuildHpValue', 'statSpawnValue', 'statRangeValue',
        'statSpeedValue', 'statHpGain', 'statAttackGain', 'statBuildHpGain', 'statRangeGain', 'statSpeedGain', 'levelBigLabel']) page[field] = {};
    page.hexSlots = [];
    const counts: number[] = [];
    page.milestoneScroll = { refreshList: count => counts.push(count), scrollToTop() {} };
    page.chainRoot = { getComponentsInChildren: () => [] };
    page.upgradeLabel = {};
    for (const field of ['closeButton', 'teamButton', 'previousButton', 'nextButton', 'upgradeButton']) {
        page[field] = { node: { on() {} } };
    }
    page.onInit();
    page.heroSprite = {};
    page.heroTransform = {};
    return { page, counts, makeRow, pending, heroLoads, modelLoads, shown, releases, itemRows, itemIcons, clearCount: () => cleared };
}

test('材料图标复用物品表与共用加载器，通用经验缺图时取兵种经验，迟到结果不能覆盖', async () => {
    const { page, itemRows, itemIcons } = createPage();
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const sprite = { spriteFrame: 'old' };
    page.renderMaterialIcon(sprite, ['16000', '16003']);
    assert.equal(sprite.spriteFrame, null);
    assert.equal(itemRows[0].id, 16000);
    itemRows[0].resolve({ icon: '' }); await flush();
    assert.equal(itemRows[1].id, 16003);
    itemRows[1].resolve({ icon: 'icons/item/army-exp' }); await flush();
    assert.equal(itemIcons[0].path, 'icons/item/army-exp');
    itemIcons[0].resolve('shared-exp'); await flush();
    assert.equal(sprite.spriteFrame, 'shared-exp');
    page.renderMaterialIcon(sprite, ['18003']);
    itemRows[2].resolve({ icon: 'icons/item/card' }); await flush();
    page.renderRevision++;
    page.renderMaterialIcon(sprite, ['18004']);
    itemRows[3].resolve({ icon: 'icons/item/current-card' }); await flush();
    itemIcons[2].resolve('current'); itemIcons[1].resolve('stale'); await flush();
    assert.equal(sprite.spriteFrame, 'current');
    page.renderMaterialIcon(sprite, ['18005']);
    itemRows[4].resolve({ icon: 'icons/item/late' }); await flush();
    page.onClose(); itemIcons[3].resolve('closed'); await flush();
    assert.equal(sprite.spriteFrame, null);
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
    const calls: Array<{ sprite: unknown; ids: string[] }> = [];
    page.renderMaterialIcon = (sprite, ids) => calls.push({ sprite, ids: Array.from(ids) });
    page.renderStatus({ configured: true, maxed: false, level: 1, targetLevel: 2,
        requirements: [{ key: 'card', itemId: '18003', owned: 100, need: 53, enough: true },
            { key: 'exp', itemId: '16000', owned: 200, need: 160, enough: true }],
        generalExpItemId: '16000', armyExpItemId: '16003', generalExpOwned: 100, armyExpOwned: 100,
        canUpgrade: true }, 'ready');
    assert.deepEqual(calls, [
        { sprite: page.matCardIcon, ids: ['18003'] },
        { sprite: page.matExpIcon, ids: ['16000', '16003'] },
    ]);
});

test('里程碑交给虚拟列表：百条数据不逐条建节点，复用行完整覆盖颜色、文字和高度', () => {
    const { page, counts, makeRow } = createPage();
    const milestones = Array.from({ length: 100 }, (_, index) => ({
        unlockLevel: index + 1, desc: `技能说明 ${index}`, unlocked: index < 2,
    }));
    page.renderDetail({ stats: [], chain: [], milestones });
    assert.deepEqual(counts, [0, 100]);
    const row = makeRow();
    page.milestoneScroll.renderItemFn(row.node, 99);
    assert.equal(row.rowTransform.height, 118);
    assert.equal(row.backgroundTransform.height, 118);
    assert.equal(row.descLabel.string, '技能说明 99');
    assert.equal(row.levelLabel.string, `${CARD_LINEUP_TEXTS.detailMilestonePrefix}100`);
    assert.equal(row.descLabel.color, 'locked');
    row.descTransform.height = 14;
    page.milestoneScroll.renderItemFn(row.node, 0);
    assert.equal(row.descLabel.string, '技能说明 0');
    assert.equal(row.descLabel.color, 'unlocked');
    assert.equal(row.rowTransform.height, 52, '长行复用成短行时恢复高度');
    page.renderDetail(null);
    assert.equal(counts.at(-1), 0);
    assert.equal(page.milestones.length, 0);
});

test('旧技能切图迟到或弹窗关闭后，不覆盖当前渲染', async () => {
    const { page, pending } = createPage();
    const applied: unknown[] = [];
    page.loadDetailFrame('old-lock', frame => applied.push(frame));
    page.renderRevision++;
    page.loadDetailFrame('new-open', frame => applied.push(frame));
    pending[1]('open'); pending[0]('lock');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(applied, ['open']);
    page.loadDetailFrame('late', frame => applied.push(frame));
    page.onClose(); pending[2]('late');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(applied, ['open']);
});


test('详情使用当前卡模型待机，迟到的上一张模型与关闭后的加载均不能挂回页面', async () => {
    const { page, heroLoads, modelLoads, shown, releases, clearCount } = createPage();
    page.renderHero({ unitPrefabPath: 'old' });
    page.renderHero({ unitPrefabPath: 'current' });
    modelLoads[1]('current-model'); heroLoads[1]({ hero: 'current-art' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(shown, ['current-model']);
    assert.equal(page.heroSprite.spriteFrame, 'current-art');
    modelLoads[0]('old-model'); heroLoads[0]({ hero: 'old-art' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(shown, ['current-model']);
    assert.equal(page.heroSprite.spriteFrame, 'current-art');
    page.renderHero({ unitPrefabPath: 'late' });
    page.onClose();
    assert.equal(clearCount(), 2, '切卡与关闭分别清除预览');
    assert.equal(page.previewAssets, null);
    modelLoads[2]('late-model'); heroLoads[2]({ hero: 'late-art' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(shown, ['current-model']);
    releases.forEach(release => release());
    assert.equal(clearCount(), 3, '资源作用域销毁也释放模型实例');
});

test('详情立绘先显示，不等待骨骼；同卡刷新不重复备图或挂载模型', async () => {
    const { page, heroLoads, modelLoads, shown } = createPage();
    const card = { id: '1', unitPrefabPath: 'current' };
    page.renderHero(card);
    heroLoads[0]({ hero: 'ready-art' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.heroSprite.spriteFrame, 'ready-art');
    assert.equal(shown.length, 0, '骨骼尚未加载完时保留立绘');
    page.renderHero({ ...card });
    assert.equal(heroLoads.length, 1);
    assert.equal(modelLoads.length, 1);
    modelLoads[0]('ready-model');
    await new Promise(resolve => setImmediate(resolve));
    page.renderHero(card);
    assert.deepEqual(shown, ['ready-model']);
});

test('详情没有兵种模型时保留当前卡立绘，空卡清除旧模型', async () => {
    const { page, heroLoads, modelLoads, shown, clearCount } = createPage();
    page.renderHero({ unitPrefabPath: null });
    modelLoads[0](null); heroLoads[0]({ hero: 'fallback' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(shown, [null]);
    assert.equal(page.heroSprite.spriteFrame, 'fallback');
    page.renderHero(null);
    assert.equal(clearCount(), 1);
    assert.equal(page.heroSprite.spriteFrame, null);
});


test('详情使用顶底分区约束：技能列表背景填充中段，升级和提示跟随底部', () => {
    const named = name => prefab.find(item => item.__type__ === 'cc.Node' && item._name === name);
    const widget = name => component(named(name), 'cc.Widget');
    assert.equal(widget('Layout')._alignFlags, 45);
    assert.equal(widget('TopRegion')._alignFlags, 41);
    assert.equal(widget('TopRegion')._top, 0);
    assert.equal(widget('BottomRegion')._alignFlags, 44);
    assert.equal(widget('BottomRegion')._bottom, 0);
    for (const name of ['Layout', 'TopRegion', 'BottomRegion']) {
        assert.equal(named(name)._lscale.x, 1);
        assert.equal(named(name)._lscale.y, 1);
    }
    for (const name of ['TitleBar', 'Header', 'StatsPanel']) {
        assert.equal(prefab[named(name)._parent.__id__]._name, 'TopRegion');
    }
    for (const name of ['UpgradePanel', 'Hint']) {
        assert.equal(prefab[named(name)._parent.__id__]._name, 'BottomRegion');
    }
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
    const meta = JSON.parse(readFileSync('assets/bundles/main-pages/image/carddetail/skills_panel.png.meta', 'utf8'));
    for (const key of ['borderTop', 'borderBottom', 'borderLeft', 'borderRight']) {
        assert.ok(meta.subMetas.f9941.userData[key] > 0, `${key} 保留完整边框`);
    }
    const source = readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8');
    assert.doesNotMatch(source, /fitLayout|layoutRoot\.setScale/);
});


test('真实技能渲染请求的动态切图均在扁平目录存在', () => {
    const { page } = createPage();
    const names: string[] = [];
    page.loadDetailFrame = name => names.push(name);
    const slot = { node: { name: 'Hex0' }, nameLabel: {}, hexSprite: {} };
    page.renderHexSlot(slot, null);
    page.renderHexSlot(slot, { unlocked: true, empty: false, unlockLevel: 0, name: '克制' });
    slot.node.name = 'Hex1';
    page.renderHexSlot(slot, { unlocked: true, empty: false, unlockLevel: 0, name: '被动' });
    page.renderHexSlot(slot, { unlocked: false, empty: false, unlockLevel: 3, name: '锁定' });
    assert.deepEqual(names, ['hex_lock', 'hex_counter', 'hex_passive', 'hex_lock']);
    for (const name of names) assert.ok(existsSync(`assets/bundles/main-pages/image/carddetail/${name}.png`), name);
});
