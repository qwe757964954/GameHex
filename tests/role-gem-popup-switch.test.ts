/**
 * 宝石详情「右栏孔位行」交互守卫。
 *
 * 效果图的体验是「右栏 5 行就是该部位 5 颗宝石」，点别的宝石先切详情，再点当前宝石才卸下。
 * 这里用 cc 沙箱跑 `RoleGemInfoPopup`：
 * - 打开 A（背包内未镶嵌）→ 右栏出现已镶嵌的 B；
 * - 点 B 行 → 左栏切到 B，`数量 / 已镶嵌` 跟着变，不弹卸下确认；
 * - 再点 B 行 → 弹卸下确认（`卸下`）；
 * - 打开技能宝石 C → 「生效技能：惊雷咒」条打开。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ccStub, loadTsModule } from './helpers/cc-sandbox';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { RoleEvent } from '../assets/script/app/role/RoleEvents';
import { ROLE_TEXTS, roleQualityName } from '../assets/script/app/role/RoleTexts';
import { getGemChange } from '../assets/script/app/role/RoleTable';
import type { IRoleGemEntry, IRoleGemSocket } from '../assets/script/app/role/RoleTypes';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

class PopupStub {
    popupOpenContext = { cancelled: false, onCancel: () => () => {} };
    openParams = { layer: 0 };
    contentNodes: unknown[] = [];
    isValid = true;
    isPopupOpen = true;
    close(): void {
        this.popupOpenContext.cancelled = true;
    }
}

function node(): Record<string, unknown> {
    return { active: true, parent: { active: false }, on: () => undefined };
}

function label(): Record<string, unknown> {
    return { string: '' };
}

function sprite(): Record<string, unknown> {
    return { node: node(), spriteFrame: null, color: null };
}

function gemOf(
    gemId: string,
    equipId: number,
    quality: number,
    count: number,
    equipped: boolean,
    skillId = 0,
): IRoleGemEntry {
    return {
        id: Number(gemId),
        gemId,
        equipId,
        resId: 1000000,
        kind: 'gem',
        iconKey: '',
        iconPath: '',
        name: `宝石${gemId}`,
        desc: `效果${gemId}`,
        quality,
        rank: 0,
        count,
        equipped,
        attrType: 1,
        skillId,
        upMark: false,
        masked: false,
    } as IRoleGemEntry;
}

function socketOf(gemId: string, order: number): IRoleGemSocket {
    return { page: 0, equipId: 1, order, gemId };
}

function loadPopup() {
    const opens: Array<Record<string, any>> = [];
    const tips: string[] = [];
    const gems = new Map<string, IRoleGemEntry>([
        ['A', gemOf('A', 1, 4, 2, false)],
        ['B', gemOf('B', 1, 5, 1, true)],
        ['C', gemOf('C', 1, 6, 1, false, 30031)],
    ]);
    const sockets = [socketOf('B', 1), socketOf('', 2), socketOf('', 3), socketOf('', 4), socketOf('', 5)];
    const tiles = Array.from({ length: 5 }, (_unused, index) => ({
        viewed: '',
        data: null as IRoleGemSocket | null,
        setData: (_socket: IRoleGemSocket | null, _click: unknown, viewed: string, _inlay: unknown) => {
            tiles[index].viewed = viewed;
        },    }));

    const repository = {
        findGem: (id: string) => gems.get(id) ?? null,
        gemGrowth: async () => ({ lock: 2, refineCost: 1, pendingAttribute: '' }),
        gemFilters: async () => [{ id: 1, name: '头盔' }],
        equipParts: () => [{ partId: 1, sockets }],
        gemSkillName: async (id: number) => (id === 30031 ? '惊雷咒' : ''),
    };

    const { exports, unresolved } = loadTsModule<{ RoleGemInfoPopup: new () => any }>(
        'assets/script/app/role/RoleGemInfoPopup.ts',
        {
            modules: {
                cc: ccStub(),
                '/PopupBase': { PopupBase: PopupStub },
                '/PopupDef': { PopupCloseReason: { Manual: 'manual' } },
                '/EventMgr': { EventMgr },
                '/FW': { FW: { showTip: (text: string) => tips.push(text), playSound: () => undefined } },
                // 镶嵌成功的通用音效（2026-11-26）：只取 key，不真播
                '/ResConst': { GAME_AUDIO: { upgradeSuccess: 'upgradeSuccess' } },
                '/CommonTips': {
                    CommonTips: {
                        open: (options: Record<string, any>) => {
                            opens.push(options);
                            return Promise.resolve({ close: () => undefined });
                        },
                    },
                },
                '/RoleEvents': { RoleEvent },
                '/RoleTexts': { ROLE_TEXTS, roleQualityName },
                '/RoleArtLoader': {
                    loadRoleBagIconSprite: async () => null,
                    loadRoleQualityFrame: async () => null,
                    loadGemDetailHeader: async () => null,
                    hasGemDetailHeader: (quality: number) => quality > 1,
                },
                '/RoleTable': { getGemChange },
                '/RoleRepository': { roleRepository: repository },
                '/RoleGemSocketTile': { RoleGemSocketTile: class {} },
                '/RoleGemReplacePanel': { RoleGemReplacePanel: { open: async () => undefined } },
            },
        },
    );
    assert.deepEqual(unresolved, []);

    const popup = new exports.RoleGemInfoPopup();
    Object.assign(popup, {
        popBg: node(),
        nameLabel: label(),
        qualityHeaderSprite: sprite(),
        iconFrame: sprite(),
        iconSprite: sprite(),
        effectTitleLabel: label(),
        subLabel: label(),
        effectLabel: label(),
        socketTiles: tiles,
        btnLock: { node: node(), interactable: true },
        lockIconSprite: sprite(),
        btnOn: { node: node(), interactable: true },
        btnOnLabel: label(),
        replacePanel: { ...node(), parent: { active: false } } as any,
        replaceListRoot: node(),
        replaceMask: node(),
        replaceButtons: [],
        replaceLabels: [],
        currentGemId: '',
        currentGem: null,
        currentGrowth: null,
        currentPartName: '通用',
        currentSkillName: '',
        currentSockets: [],
        replaceSockets: [],
        downBusy: false,
        refreshRevision: 0,
    });
    return { popup, opens, tips, tiles, sockets };
}

test('宝石详情：点别的孔位先切详情，再点当前孔位才进卸下确认', async () => {
    const { popup, opens, tiles, sockets } = loadPopup();

    await popup.onOpen({ gemId: 'A' });
    assert.equal(popup.currentGemId, 'A');
    assert.equal(popup.subLabel.string, '数量：2');
    assert.equal(popup.btnOnLabel.string, '镶嵌');
    assert.equal(popup.btnOn.interactable, true);
    assert.equal(tiles[0].viewed, 'A');

    popup.onSocketClick(sockets[0]);
    await tick();
    assert.equal(popup.currentGemId, 'B', '点非当前查看的孔位应切成查看对象');
    assert.equal(popup.subLabel.string, '数量：1');
    assert.equal(popup.btnOnLabel.string, '已镶嵌');
    assert.equal(popup.btnOn.interactable, false);
    assert.equal(tiles[0].viewed, 'B');
    assert.equal(opens.length, 0, '切详情不应弹卸下确认');

    popup.onSocketClick(sockets[0]);
    await tick();
    assert.equal(opens.length, 1, '再点当前孔位应弹卸下确认');
    assert.equal(opens[0].userData.sureText, ROLE_TEXTS.gemDown);
    assert.match(String(opens[0].userData.content), new RegExp(ROLE_TEXTS.gemDownPrompt));
});

test('宝石详情：技能类宝石把「生效技能」并入效果文案', async () => {
    const { popup } = loadPopup();
    await popup.onOpen({ gemId: 'C' });
    assert.equal(popup.currentSkillName, '惊雷咒');
    assert.match(popup.effectLabel.string, new RegExp(ROLE_TEXTS.gemSkill('惊雷咒')));
});
