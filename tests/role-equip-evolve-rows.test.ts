/**
 * 装备锻造「强化」页属性行（`EquipEvolvePage.renderGrowthData`）的数值口径。
 *
 * ## 为什么值得钉
 *
 * 2026-11-26 截图：0 级强化预览显示「生命百分比：10500 → 10505%」。两处口径一起错才拼出这个数：
 *
 *   · `hpPercent` 已经是百分数（`equipLevel.hpPer` 100 = 1%，Repository 已 /100），页面又 ×100 ⇒ 105 变 10500；
 *   · 右侧「下一级」不是查 `equipLevel[level+1]`，而是页面自己编的 `hpPercent + 0.05`（再 ×100）⇒ 10505。
 *
 * 两处都**不报错**，只是静默显示一个荒谬的数，所以这里两头都钉：
 * 页面按 Repository 给好的 `nextAttack` / `nextHpPercent` 出文案；Repository 的下一级取自 level+1 行。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ccStub, loadTsModule } from './helpers/cc-sandbox';
import { readSource } from './helpers/source-text';
import * as RoleTypes from '../assets/script/app/role/RoleTypes';

interface IStubNode {
    active: boolean;
    parent: IStubNode | null;
}

interface IStubLabel {
    node: IStubNode;
    string: string;
}

interface IAttrRow {
    name: string;
    cur: string;
    next?: string;
}

interface IAttrItem {
    node: IStubNode;
    rows: IAttrRow[];
    setData(name: string, cur: string, next?: string): void;
}

interface IStubPage {
    currentTab: RoleTypes.EquipEvolveTab;
    currentGrowth: unknown;
    goodsLevelLabel: IStubLabel;
    goodsRankLabel: IStubLabel;
    maxLvLabel: IStubLabel;
    curLvLabel: IStubLabel;
    nextLvLabel: IStubLabel;
    buildBtn: { node: IStubNode };
    buildAllBtn: { node: IStubNode };
    strengthenAttrItems: IAttrItem[];
    strengthenCostItems: Array<{ node: IStubNode; setCost(): void }>;
    renderGrowthData(): void;
}

const node = (): IStubNode => ({ active: true, parent: null });
const label = (): IStubLabel => ({ node: node(), string: '' });

function attrItem(): IAttrItem {
    return {
        node: node(),
        rows: [],
        setData(name: string, cur: string, next?: string): void {
            this.rows.push({ name, cur, next });
        },
    };
}

/** 沙箱里造一个只用到强化页字段的 `EquipEvolvePage` 实例。 */
function createStrengthenPage(): IStubPage {
    const { exports, unresolved } = loadTsModule<{ EquipEvolvePage: new () => IStubPage }>(
        'assets/script/app/role/EquipEvolvePage.ts',
        {
            modules: {
                cc: ccStub(),
                '/PopupBase': { PopupBase: class { popupOpenContext = null; } },
                '/AudioMgr': { AudioMgr: { instance: { playSound: async () => true } } },
                '/RedDot': { RedDot: class {} },
                '/EventMgr': { EventMgr: { instance: { on() {}, off() {}, emit() {} } } },
                '/FW': { FW: { showTip() {} } },
                '/ResConst': { GAME_AUDIO: { upgradeSuccess: 'upgradeSuccess' } },
                '/common/UiUpgradeFx': { UiUpgradeFx: class { load() {} play() {} step() {} reset() {} } },
                '/common/UiUpgradeFxTable': { UI_UPGRADE_ANIMATION: { levelUp: 'shengji', rankUp: 'shengjie', starUp: 'shengxing' } },
                '/RoleRepository': { roleRepository: {} },
                '/RoleEvents': { RoleEvent: {} },
                '/RoleTypes': RoleTypes,
                '/RoleTexts': { ROLE_TEXTS: { equipEmpty: '未装备', equipChanged: '装备已变更', failed: '操作失败', offline: '网络离线' } },
                '/RoleArtLoader': { loadRoleBagIconSprite: async () => null },
                '/itemdetail/ItemDetailArtLoader': { loadItemIconArt: async () => null },
                '/EquipWashPopup': { EquipWashPopup: { open() {} } },
                '/EquipEvolveAttrItem': { EquipEvolveAttrItem: class {} },
                '/EquipEvolveCostItem': { EquipEvolveCostItem: class {} },
                '/EquipEvolveSlotItem': { EquipEvolveSlotItem: class {} },
            },
        },
    );
    assert.deepEqual(unresolved, [], '漏桩会让用例测空气');

    const page = new exports.EquipEvolvePage();
    page.currentTab = RoleTypes.EquipEvolveTab.Strengthen;
    page.goodsLevelLabel = label();
    page.goodsRankLabel = label();
    page.maxLvLabel = label();
    page.curLvLabel = label();
    page.nextLvLabel = label();
    page.buildBtn = { node: node() };
    page.buildAllBtn = { node: node() };
    page.strengthenAttrItems = [attrItem(), attrItem()];
    page.strengthenCostItems = [];
    return page;
}

test('强化页生命百分比按百分数直出：105 → 115%，不是 10500 → 10505%', () => {
    const page = createStrengthenPage();
    page.currentGrowth = {
        level: 0, rank: 6, attack: 105, hpPercent: 105, nextAttack: 115, nextHpPercent: 115,
        levelCostFacts: [],
    };
    page.renderGrowthData();

    const [attackRow, hpRow] = page.strengthenAttrItems.map(item => item.rows.at(-1));
    assert.deepEqual(attackRow, { name: '全队攻击力：', cur: '+105', next: '+115' });
    assert.deepEqual(hpRow, { name: '生命百分比：', cur: '105', next: '115%' });
});

test('满级 / 表里没有 level+1 行时不显示下一级，也不许回填自造值', () => {
    const page = createStrengthenPage();
    page.currentGrowth = {
        level: 100, rank: 6, attack: 105, hpPercent: 105, nextAttack: undefined, nextHpPercent: undefined,
        levelCostFacts: [],
    };
    page.renderGrowthData();

    const [attackRow, hpRow] = page.strengthenAttrItems.map(item => item.rows.at(-1));
    assert.deepEqual(attackRow, { name: '全队攻击力：', cur: '+105', next: undefined });
    assert.deepEqual(hpRow, { name: '生命百分比：', cur: '105', next: undefined });
});

test('Repository 的下一级取自 equipLevel[level+1]，页面不再自己换算或编数值', () => {
    const repository = readSource('assets/script/app/role/RoleRepository.ts');
    assert.match(repository,
        /nextAttack:\s*nextLevel\s*\?\s*toCount\(nextLevel\.attack\)\s*\+\s*toCount\(rankRow\?\.attack\)\s*:\s*undefined/,
        '下一级攻击力 = equipLevel[level+1].attack + 当前阶行，缺行给 undefined');
    assert.match(repository,
        /nextHpPercent:\s*nextLevel\s*\?\s*\(toCount\(nextLevel\.hpPer\)\s*\+\s*toCount\(rankRow\?\.hpPer\)\)\s*\/\s*100\s*:\s*undefined/,
        '下一级生命百分比与 hpPercent 同口径（hpPer / 100）');

    const page = readSource('assets/script/app/role/EquipEvolvePage.ts');
    assert.doesNotMatch(page, /hpPercent\s*\*\s*100/, 'hpPercent 已是百分数，再 ×100 就是 10500');
    assert.doesNotMatch(page, /hpPercent\s*\+\s*0\.05/, '下一级不许用 +0.05 自造');
    assert.doesNotMatch(page, /attack\s*\*\s*1\.05/, '下一级攻击力不许用 ×1.05 自造');
});
