import assert from 'node:assert/strict';
import test from 'node:test';
import { ccStub, loadTsModule } from './helpers/cc-sandbox';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { RoleEvent } from '../assets/script/app/role/RoleEvents';
import { ROLE_TEXTS, roleQualityName } from '../assets/script/app/role/RoleTexts';
import type { IEquipWashPopupOpenParams } from '../assets/script/app/role/EquipWashPopup';

type Status = 'ok' | 'offline' | 'failed';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

class PopupStub {
    popupOpenContext = {
        cancelled: false,
        onCancel: () => () => {},
    };
    openParams = null;
    close(): void {
        this.popupOpenContext.cancelled = true;
    }
}

function loadPopup<T>(name: string, modules: Record<string, unknown>) {
    const tips: string[] = [];
    const { exports, unresolved } = loadTsModule<Record<string, new () => T>>(
        `assets/script/app/role/${name}.ts`,
        {
            modules: {
                cc: ccStub(),
                '/PopupBase': { PopupBase: PopupStub },
                '/PopupDef': { PopupCloseReason: { Manual: 'manual' } },
                '/EventMgr': { EventMgr },
                '/FW': { FW: { showTip: (text: string) => tips.push(text), playSound: () => undefined } },
                '/RoleEvents': { RoleEvent },
                '/RoleTexts': { ROLE_TEXTS, roleQualityName },
                '/RoleArtLoader': {},
                '../itemdetail/ItemDetailArtLoader': {},
                '../common/RedDot': { RedDot: class RedDot {} },
                // 装备升级 / 强化的成功反馈（2026-11-26）：通用音效 + 屏正中字特效
                '/audio/AudioMgr': { AudioMgr: { instance: { playSound: () => Promise.resolve(true) } } },
                '/ResConst': { GAME_AUDIO: { upgradeSuccess: 'upgradeSuccess' } },
                '/common/UiUpgradeFx': {
                    UiUpgradeFx: class {
                        load(): void { }
                        play(): boolean { return true; }
                        step(): void { }
                        reset(): void { }
                    },
                },
                '/common/UiUpgradeFxTable': {
                    UI_UPGRADE_ANIMATION: { levelUp: 'shengji', rankUp: 'shengjie', starUp: 'shengxing' },
                    UI_UPGRADE_FX_PREFAB: 'ui/territory/TerritoryMonsterBoxUpgradeFx',
                    UI_UPGRADE_FX_SECONDS: 1.12,
                },
                ...modules,
            },
        },
    );
    assert.deepEqual(unresolved, []);
    return { popup: new exports[name](), tips };
}

test('锻造切换部位后，洗炼回包仍使用请求装备及其原词条数值', async () => {
    let respond: (response: CmdEquipWashRspMsg) => void = () => assert.fail('洗炼请求未发出');
    const request = { equipId: 0 };
    const previews: IEquipWashPopupOpenParams[] = [];
    const { popup } = loadPopup<{
        currentGrowth: { baseId: number; name: string; rank: number; level: number; effects: string[]; washValues: number[] };
        onWashClick(): Promise<void>;
    }>('EquipEvolvePage', {
        '/RoleRepository': {
            roleRepository: {
                requestGrowth: (_proto: string, payload: typeof request, _caller: object, receive: typeof respond) => {
                    request.equipId = payload.equipId;
                    return new Promise<Status>(resolve => {
                        respond = response => {
                            receive(response);
                            resolve('ok');
                        };
                    });
                },
            },
        },
        '/EquipWashPopup': { EquipWashPopup: { open: ({ userData }: { userData: IEquipWashPopupOpenParams }) => previews.push(userData) } },
        '/EquipEvolveAttrItem': {},
        '/EquipEvolveCostItem': {},
        '/EquipEvolveSlotItem': {},
    });
    const helmet = { baseId: 1, name: '头盔', rank: 2, level: 4, effects: ['攻击 +25'], washValues: [25] };
    popup.currentGrowth = helmet;
    const requestPending = popup.onWashClick();
    assert.equal(request.equipId, 1);
    popup.currentGrowth = { ...helmet, baseId: 3, name: '武器', washValues: [70] };
    respond({ equipId: 1, tlLibs: [2] });
    await requestPending;
    assert.equal(previews.length, 1);
    assert.equal(previews[0].equipId, 1);
    assert.equal(previews[0].name, '头盔');
    assert.deepEqual(previews[0].washValues, [25]);

    const { popup: wash } = loadPopup<{
        nameLabel: { string: string };
        qualityLabel: { string: string };
        lvLabel: { string: string };
        onOpen(data: IEquipWashPopupOpenParams): Promise<void>;
        renderAttributeLists(): void;
        newEffects: readonly string[];
    }>('EquipWashPopup', {
        '/RoleRepository': { roleRepository: { equipmentWashAttributes: async (_ids: number[], values: number[]) => values.map(value => String(value)) } },
    });
    wash.nameLabel = wash.qualityLabel = wash.lvLabel = { string: '' };
    wash.renderAttributeLists = () => {};
    await wash.onOpen(previews[0]);
    assert.deepEqual(wash.newEffects, ['25']);
});

test('洗炼对比词条写到行内文字节点，不被装饰圆点抢占', () => {
    const { popup } = loadPopup<{
        oldEffects: readonly string[];
        newEffects: readonly string[];
        nowAttrList: { children: unknown[] };
        nextAttrList: { children: unknown[] };
        renderAttributeLists(): void;
    }>('EquipWashPopup', { '/RoleRepository': {} });

    // 真实 prefab 的 item 子节点顺序是 Dot / Label / Line，且 Dot 自身也是 Label（内容 `●`）。
    // 这里让 getComponentInChildren 返回圆点，复现「文字被写进圆点、真正的文字节点空白」的旧行为。
    const makeRow = () => {
        const text = { string: '' };
        const dot = { string: '●' };
        const row = {
            active: true,
            getComponentInChildren: () => dot,
            getChildByName: (name: string) => (name === 'Label' ? { getComponent: () => text } : null),
            getComponent: () => null,
        };
        return { row, text, dot };
    };
    const now = [makeRow(), makeRow()];
    const next = [makeRow(), makeRow()];
    popup.nowAttrList = { children: now.map(value => value.row) };
    popup.nextAttrList = { children: next.map(value => value.row) };
    popup.oldEffects = ['攻击 +25', '防御 +10'];
    popup.newEffects = ['攻击 +30'];

    popup.renderAttributeLists();

    assert.equal(now[0].text.string, '攻击 +25');
    assert.equal(now[1].text.string, '防御 +10');
    assert.equal(next[0].text.string, '攻击 +30');
    assert.equal(next[1].row.active, false);
    assert.deepEqual([now[0].dot.string, next[0].dot.string], ['●', '●']);
});

test('装备详情的背包操作入口传递当前装备 ID', () => {
    const { popup } = loadPopup<{ currentBagId: string; onForgeClick(): void }>('RoleEquipInfoPopup', {
        '/RoleRepository': {},
        '/RoleEquipGemItem': {},
        '/RoleStatRow': {},
    });
    const owner = {};
    const intents: unknown[] = [];
    EventMgr.instance.on(RoleEvent.Intent, (intent: unknown) => intents.push(intent), owner);
    try {
        popup.currentBagId = 'gear-123';
        popup.onForgeClick();
        assert.deepEqual(intents.map(value => ({ ...value as object })), [{ kind: 'equip', id: 'gear-123', manage: true }]);
    } finally {
        EventMgr.instance.offTarget(owner);
    }
});

test('清空宝石首孔失败和部分成功时分别反馈，且停止后续卸下', async () => {
    for (const { outcomes, expected, reloads } of [
        { outcomes: ['offline'], expected: ROLE_TEXTS.offline, reloads: 0 },
        { outcomes: ['ok', 'failed'], expected: ROLE_TEXTS.gemPlanPartiallyCleared, reloads: 1 },
    ]) {
        const orders: number[] = [];
        let loads = 0;
        const { popup, tips } = loadPopup<{
            currentTab: string; currentPartId: number; btnDestroyGems: { interactable: boolean };
            onDestroyOrDownClick(): Promise<void>; refresh(): Promise<void>;
        }>('RoleEquipInfoPopup', {
            '/RoleRepository': {
                roleRepository: {
                    equipParts: () => [{ partId: 3, sockets: [1, 2, 3].map(order => ({ order, gemId: `gem-${order}` })) }],
                    changeGem: async ({ payload }: { payload: { order: number } }) => {
                        orders.push(payload.order);
                        return outcomes[orders.length - 1];
                    },
                    load: async () => { loads++; },
                },
            },
            '/RoleEquipGemItem': {},
            '/RoleStatRow': {},
        });
        popup.currentTab = 'gem';
        popup.currentPartId = 3;
        popup.btnDestroyGems = { interactable: true };
        popup.refresh = async () => {};
        await popup.onDestroyOrDownClick();
        assert.deepEqual(orders, outcomes.map((_, index) => index + 1));
        assert.deepEqual(tips, [expected]);
        assert.equal(loads, reloads);
        assert.equal(popup.btnDestroyGems.interactable, true);
    }
});

test('民兵激活连点只提交一次，关闭后忽略迟到结果', async () => {
    const owners: object[] = [];
    let finish: (status: Status) => void = () => assert.fail('升级请求未发出');
    const { popup, tips } = loadPopup<PopupStub & {
        isValid: boolean;
        detail: { activatable: boolean; canAfford: boolean };
        activateButton: { interactable: boolean };
        onActivateClick(): Promise<void>;
    }>('MilitiaTalentPage', {
        '/TabButton': {},
        '/VScrollView': {},
        '/RefUtil': {},
        '/ItemDetailArtLoader': {},
        '/MilitiaRepository': {
            militiaRepository: { requestLevelUp: (caller: object) => {
                owners.push(caller);
                return new Promise<Status>(resolve => { finish = resolve; });
            } },
        },
        '/MilitiaTalentOverviewPage': {},
        '/MilitiaTalentItem': {},
        '/MilitiaTalentCostItem': {},
        '/TableNames': {},
    });
    const button = { interactable: true };
    popup.isValid = true;
    popup.activateButton = button;
    popup.detail = { activatable: true, canAfford: true };
    const pending = popup.onActivateClick();
    await popup.onActivateClick();
    assert.equal(owners.length, 1);
    assert.equal(owners[0], popup);
    assert.equal(button.interactable, false);
    popup.close();
    finish('ok');
    await pending;
    assert.deepEqual(tips, []);
});

test('民兵详情快速换选或收起后忽略旧详情图标', async () => {
    const pendingIcons = new Map<string, (frame: string) => void>();
    const { popup } = loadPopup<PopupStub & Record<string, any>>('MilitiaTalentPage', {
        '/TabButton': {},
        '/VScrollView': {},
        '/RefUtil': {},
        '/MilitiaRepository': {},
        '/MilitiaTalentOverviewPage': {},
        '/MilitiaTalentItem': {},
        '/MilitiaTalentCostItem': {},
        '/TableNames': {},
        '/RoleArtLoader': {
            loadMilitiaTalentIcon: (key: string) => new Promise<string>(resolve => pendingIcons.set(key, resolve)),
        },
    });
    const detailNode = { active: false };
    const renderedCosts: Array<[string | null, number, number]> = [];
    popup.isValid = true;
    popup.infoNodes = [detailNode];
    popup.maskButton = { node: { active: false } };
    popup.activateButton = { node: { active: false } };
    popup.skillName = { string: '' };
    popup.skillDesc = { string: '' };
    popup.skillIcon = { spriteFrame: null };
    popup.goldCost = { render() {} };
    popup.itemCost = { render: (frame: string | null, owned: number, need: number) => renderedCosts.push([frame, owned, need]) };
    popup.loadCostItemIcon = async (id: number) => `cost-${id}`;
    const showInfo = (iconKey: string, itemId: number): Promise<void> => popup.showInfo({
        iconKey, itemId, effectName: iconKey, effectDesc: '', activatable: itemId === 2,
        goldOwned: 0, goldNeed: 0, itemOwned: itemId, itemNeed: 3,
    });

    const first = showInfo('first', 1);
    assert.equal(popup.activateButton.node.active, false);
    const second = showInfo('second', 2);
    pendingIcons.get('second')!('icon-2');
    await second;
    pendingIcons.get('first')!('icon-1');
    await first;
    assert.equal(popup.skillName.string, 'second');
    assert.equal(popup.skillIcon.spriteFrame, 'icon-2');
    assert.deepEqual(renderedCosts.at(-1), ['cost-2', 2, 3]);

    const closing = showInfo('closing', 3);
    popup.hideInfo();
    pendingIcons.get('closing')!('icon-3');
    await closing;
    assert.equal(detailNode.active, false);
    assert.equal(popup.maskButton.node.active, false);
    assert.equal(popup.activateButton.node.active, false);
    assert.equal(popup.skillIcon.spriteFrame, null);
    assert.deepEqual(renderedCosts.at(-1), [null, 3, 3]);
});

