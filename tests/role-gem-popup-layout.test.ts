/**
 * 宝石详情「左详情卡 / 右孔位列表」布局守卫（纯读 prefab JSON，零 `cc`）。
 *
 * 蓝湖「宝石镶嵌」稿的口径：
 * - 弹窗整体 655×475，左侧 316×475 道具信息卡，右侧 322×460 五孔位列表；
 * - 右侧 5 行 322×88，行距 93，行内有品质底 / 效果文案 / 行内「镶嵌」按钮，空槽有金色加号；
 * - 左卡头部品质底 + 名称 / 数量，正文「宝石效果」，底部单颗 131×54 金色「镶嵌」；
 * - 锁定按钮在卡片右上角，洗炼入口在新稿中不再出现（仍可在角色页弹窗操作）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { assetPath } from './helpers/asset-paths';
import { gemDetailHeaderKey } from '../assets/script/app/role/RoleArt';

type Obj = Record<string, any>;

const PREFAB = assetPath('ui/Role/RoleGemInfoPopup.prefab');
const load = (): Obj[] => JSON.parse(readFileSync(PREFAB, 'utf8')) as Obj[];
const res = (arr: Obj[], value: any): Obj | null =>
    value && typeof value === 'object' && '__id__' in value ? arr[value.__id__] ?? null : (value ?? null);

function findNode(arr: Obj[], root: Obj, name: string): Obj | null {
    if (root._name === name) return root;
    for (const child of root._children ?? []) {
        const node = res(arr, child);
        const hit = node ? findNode(arr, node, name) : null;
        if (hit) return hit;
    }
    return null;
}

const childNode = (arr: Obj[], node: Obj, name: string): Obj | null => {
    for (const entry of node._children ?? []) {
        const child = res(arr, entry);
        if (child?._name === name) return child;
    }
    return null;
};

const componentOf = (arr: Obj[], node: Obj, type: string): Obj | null =>
    (node._components ?? [])
        .map((entry: any) => res(arr, entry))
        .find((component: Obj | null) => component?.__type__ === type) ?? null;

const transformOf = (arr: Obj[], node: Obj): Obj => {
    const transform = componentOf(arr, node, 'cc.UITransform');
    assert.ok(transform, `${node._name} 缺 UITransform`);
    return transform!;
};

const rectOf = (arr: Obj[], node: Obj) => {
    const transform = transformOf(arr, node);
    return {
        x: node._lpos.x as number,
        y: node._lpos.y as number,
        w: transform._contentSize.width as number,
        h: transform._contentSize.height as number,
        ax: transform._anchorPoint.x as number,
        ay: transform._anchorPoint.y as number,
    };
};

const idOf = (value: any): number => value?.__id__ ?? -1;

test('★ 宝石详情按蓝湖稿：316×475 左卡 + 322×460 右五孔位，行内绑定效果 / 空槽 / 镶嵌按钮', () => {
    const arr = load();
    const root = res(arr, arr[0].data);
    assert.ok(root, 'RoleGemInfoPopup.prefab 根节点缺失');
    const panel = findNode(arr, root!, 'Panel');
    assert.ok(panel, 'Panel 缺失');
    const panelRect = rectOf(arr, panel!);
    assert.deepEqual({ w: panelRect.w, h: panelRect.h }, { w: 655, h: 475 });

    const card = findNode(arr, root!, 'PanelBg');
    assert.ok(card, '左侧道具信息卡缺失');
    const cardRect = rectOf(arr, card!);
    assert.deepEqual(
        { x: cardRect.x, y: cardRect.y, w: cardRect.w, h: cardRect.h },
        { x: -169.5, y: 0, w: 316, h: 475 },
        '左卡应为 316×475，居中偏左',
    );
    const cardSprite = componentOf(arr, card!, 'cc.Sprite');
    assert.equal(cardSprite?._spriteFrame?.__uuid__, '41c2166d-ae0c-4e08-92cb-6b2b09df06d6@f9941');

    const header = findNode(arr, root!, 'QualityHeader');
    assert.ok(header, '左侧品质底板缺失');
    const headerRect = rectOf(arr, header!);
    assert.deepEqual(
        { x: headerRect.x, y: headerRect.y, w: headerRect.w, h: headerRect.h, ax: headerRect.ax, ay: headerRect.ay },
        { x: -325.5, y: 237.5, w: 312, h: 116, ax: 0, ay: 1 },
        '品质底板应贴左卡顶部，312×116',
    );
    assert.equal(componentOf(arr, header!, 'cc.Sprite')?._spriteFrame?.__uuid__,
        '71192b2e-a7fe-43f8-a142-147ba37bb944@f9941', '设计态默认展示紫色底板');
    const popupComp = (root!._components ?? [])
        .map((entry: any) => res(arr, entry))
        .find((component: Obj | null) => component && 'qualityHeaderSprite' in component);
    assert.ok(popupComp, 'RoleGemInfoPopup 缺 qualityHeaderSprite 字段');
    assert.ok(res(arr, popupComp!.qualityHeaderSprite), 'qualityHeaderSprite 未绑定品质底板');
    const headerIndex = (panel!._children ?? []).findIndex((entry: any) => idOf(entry) === arr.indexOf(header!));
    const iconIndex = (panel!._children ?? []).findIndex((entry: any) =>
        idOf(entry) === arr.indexOf(findNode(arr, root!, 'IconFrame')!));
    assert.ok(headerIndex >= 0 && headerIndex < iconIndex, '品质底板必须渲染在图标 / 名称下方');

    const board = findNode(arr, root!, 'SocketBoard');
    assert.ok(board, 'SocketBoard 缺失');
    const boardRect = rectOf(arr, board!);
    assert.deepEqual(
        { x: boardRect.x, y: boardRect.y, w: boardRect.w, h: boardRect.h },
        { x: 1.5, y: 227.5, w: 322, h: 460 },
        '右侧孔位板应为 322×460，贴面板右上',
    );

    const tiles: Obj[] = [];
    for (const child of board!._children ?? []) {
        const node = res(arr, child);
        if (node && /^SocketTile\d$/.test(node._name ?? '')) tiles.push(node);
    }
    assert.equal(tiles.length, 5, `孔位行应为 5 个，实际 ${tiles.length}`);

    for (let index = 0; index < tiles.length; index++) {
        const tile = tiles[index];
        const tileId = arr.indexOf(tile);
        const rect = rectOf(arr, tile);
        assert.deepEqual(
            { x: rect.x, w: rect.w, h: rect.h },
            { x: 0, w: 322, h: 88 },
            `${tile._name} 应为 322×88`,
        );
        assert.equal(rect.y, index === 0 ? 0 : -index * 93, `${tile._name} 行距应为 93`);

        const script = (tile._components ?? [])
            .map((entry: any) => res(arr, entry))
            .find((component: Obj | null) => component && 'socketButton' in component);
        assert.ok(script, `${tile._name} 缺 RoleGemSocketTile`);

        for (const key of ['nameLabel', 'descLabel', 'emptyLabel', 'addIcon', 'inlayButton', 'inlaySprite', 'inlayLabel']) {
            assert.ok(res(arr, script![key]), `${tile._name} 的 ${key} 未绑定`);
        }
        const empty = res(arr, script!.emptyLabel)!;
        assert.equal(empty._string, '点击镶嵌宝石');
        const emptyNode = res(arr, empty.node)!;
        const emptySlot = index >= 2;
        assert.equal(emptyNode._active, emptySlot, `${tile._name} 的设计态空槽文案应为 ${emptySlot}`);

        const desc = res(arr, script!.descLabel)!;
        assert.equal(desc._enableWrapText, true);
        assert.equal(desc._overflow, 1);
        assert.equal(desc._fontSize, 18);

        const add = res(arr, script!.addIcon)!;
        assert.equal(add._active, emptySlot, `${tile._name} 的设计态空槽加号应为 ${emptySlot}`);
        assert.ok(componentOf(arr, add, 'cc.Sprite'), `${tile._name} 的空槽加号缺 Sprite`);
        assert.equal(componentOf(arr, add, 'cc.Graphics'), null,
            `${tile._name} 的空槽加号不能与 Graphics 同节点，否则 Sprite 不渲染`);

        const inlay = res(arr, script!.inlayButton)!;
        assert.equal(inlay.__type__, 'cc.Button');
        const btnNode = res(arr, inlay.node)!;
        const labelNode = res(arr, res(arr, script!.inlayLabel)!.node)!;
        assert.equal(idOf(labelNode._parent), arr.indexOf(btnNode),
            `${tile._name} 的行内按钮文字应挂在按钮节点下`);
        const labelRect = rectOf(arr, labelNode);
        assert.deepEqual({ x: labelRect.x, y: labelRect.y, ax: labelRect.ax, ay: labelRect.ay },
            { x: 49, y: -20, ax: 0.5, ay: 0.5 },
            `${tile._name} 的行内按钮文字应居中到按钮中心`);
        assert.equal(res(arr, script!.inlayLabel)!._overflow, 1,
            `${tile._name} 的行内按钮文字应固定宽度居中，不能 auto-size 贴左边`);

        assert.ok(componentOf(arr, tile, 'cc.Sprite'), `${tile._name} 缺孔位底色 Sprite`);
        assert.equal(componentOf(arr, tile, 'cc.Sprite')!._spriteFrame?.__uuid__,
            '58362bdc-7f5f-4331-9bd8-4097f9756fa4@f9941');
    }

    const effectBoard = findNode(arr, root!, 'EffectBoard');
    assert.ok(effectBoard, 'EffectBoard 缺失');
    const effectRect = rectOf(arr, effectBoard!);
    assert.deepEqual(
        { x: effectRect.x, y: effectRect.y, w: effectRect.w, h: effectRect.h },
        { x: -299.5, y: 76.5, w: 260, h: 90 },
        '左卡效果区应为 260×90',
    );

    const lock = findNode(arr, root!, 'LockBox');
    assert.ok(lock, 'LockBox 缺失');
    assert.equal(idOf(lock!._parent), arr.indexOf(panel!), '锁定按钮应移到卡片右上角');
    const lockRect = rectOf(arr, lock!);
    assert.deepEqual({ w: lockRect.w, h: lockRect.h }, { w: 44, h: 44 });

    const refine = findNode(arr, root!, 'BtnRefine');
    assert.ok(refine, 'BtnRefine 兼容节点缺失');
    assert.equal(refine!._active, false, '新稿不再展示洗炼按钮');

    const btnOn = findNode(arr, root!, 'BtnOn');
    assert.ok(btnOn, 'BtnOn 缺失');
    const btnRect = rectOf(arr, btnOn!);
    assert.deepEqual(
        { x: btnRect.x, y: btnRect.y, w: btnRect.w, h: btnRect.h },
        { x: -234.5, y: -159.5, w: 131, h: 54 },
    );
    assert.equal(componentOf(arr, btnOn!, 'cc.Sprite')!._spriteFrame?.__uuid__,
        '867aa4a9-6606-4f9e-bb8c-7a3a73e18615@f9941');
    const bottomLabel = childNode(arr, btnOn!, 'Label');
    assert.ok(bottomLabel, '底部镶嵌按钮缺 Label');
    const bottomLabelRect = rectOf(arr, bottomLabel!);
    assert.deepEqual({ x: bottomLabelRect.x, y: bottomLabelRect.y, ax: bottomLabelRect.ax, ay: bottomLabelRect.ay },
        { x: 65.5, y: -27, ax: 0.5, ay: 0.5 },
        '底部镶嵌按钮文字应居中到按钮中心');
    assert.equal(componentOf(arr, bottomLabel!, 'cc.Label')!._overflow, 1,
        '底部镶嵌按钮文字应固定宽度居中，不能 auto-size 贴左边');

    const iconFrame = rectOf(arr, findNode(arr, root!, 'IconFrame')!);
    const nameLabel = rectOf(arr, findNode(arr, root!, 'Name')!);
    assert.deepEqual({ w: iconFrame.w, h: iconFrame.h }, { w: 70, h: 70 });
    assert.ok(iconFrame.x + iconFrame.w <= nameLabel.x, '品质底与宝石名不应互相压住');

    for (const chip of ['PartChip', 'StatusChip']) {
        assert.equal(findNode(arr, root!, chip)!._active, false, `${chip} 在新稿中应隐藏`);
    }
});

test('宝石详情品质底板按 gemQuality 颜色映射：白隐藏，绿/蓝/紫/金/红顺次', () => {
    assert.equal(gemDetailHeaderKey(1), '');
    assert.equal(gemDetailHeaderKey(2), 'gemHeaderGreen');
    assert.equal(gemDetailHeaderKey(3), 'gemHeaderBlue');
    assert.equal(gemDetailHeaderKey(4), 'gemHeaderPurple');
    assert.equal(gemDetailHeaderKey(5), 'gemHeaderGold');
    assert.equal(gemDetailHeaderKey(6), 'gemHeaderRed');
    assert.equal(gemDetailHeaderKey(7), 'gemHeaderRed');
    assert.equal(gemDetailHeaderKey(0), '');
    assert.equal(gemDetailHeaderKey(99), 'gemHeaderRed');
});
