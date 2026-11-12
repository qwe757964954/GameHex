import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assetPath } from './helpers/asset-paths';

/**
 * 「宝箱详情」弹窗主按钮的**加速态**（2026-11-11 用户三条）：
 *  ① 加速按钮是绿色的（截图里栏位那颗绿底「加速」）；解锁 / 开启仍是黄色；
 *  ② 「加速」文案前面补播放 icon（栏位用的是 `chest_bolt.png`）；
 *  ③ 点「解锁」后详情按钮要**同步刷新**（旧实现只刷倒计时 ⇒ 停在黄色「解锁」）。
 *
 * 三层判据：绿色底图素材 → prefab 节点与绑定 → 组件全量赋值行为 → 页面下发的刷新参数。
 */

type Obj = Record<string, any>;
const PREFAB = assetPath('ui/main/ChestDetailPanel.prefab');
const PANEL_CID = 'fba93mSlUVEQ4N0/mw7tcEZ';
const ART_DIR = assetPath('image/main/chest');
const GREEN_UUID = 'b6c1e904-3a75-4b18-9a6c-d2f0e18b47a5';
const BOLT_UUID = '31c7e2c7-7dee-4402-b641-980f775118ea@f9941';

const objects = JSON.parse(readFileSync(PREFAB, 'utf8')) as Obj[];
const at = (ref: Obj | null | undefined): Obj | null => (
    ref && typeof ref === 'object' && typeof ref.__id__ === 'number' ? objects[ref.__id__] : null
);
const nodeOf = (name: string): Obj => objects.find((o) => o?.__type__ === 'cc.Node' && o._name === name)!;
const panelComp = objects.find((o) => o?.__type__ === PANEL_CID)!;

const pngSize = (path: string): [number, number] => {
    const buffer = readFileSync(path);
    assert.equal(buffer.subarray(1, 4).toString(), 'PNG', `${path} 不是 PNG`);
    return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
};

test('绿色主按钮底图：与 btn_open 同尺寸 / 同九宫格 / 只换 uuid', () => {
    const green = `${ART_DIR}/detail/btn_speed_up.png`;
    const yellow = `${ART_DIR}/detail/btn_open.png`;
    assert.deepEqual(pngSize(green), pngSize(yellow), '必须与黄色底逐像素同形（圆角 / 描边 / 高光）');
    assert.deepEqual(pngSize(green), [321, 108]);

    const meta = JSON.parse(readFileSync(`${green}.meta`, 'utf8')) as Obj;
    const base = JSON.parse(readFileSync(`${yellow}.meta`, 'utf8')) as Obj;
    assert.equal(meta.uuid, GREEN_UUID, 'uuid 固定 ⇒ 重跑生成脚本不会弄脏 prefab 引用');
    assert.equal(meta.subMetas.f9941.uuid, `${GREEN_UUID}@f9941`);
    assert.equal(meta.subMetas.f9941.userData.imageUuidOrDatabaseUri, `${GREEN_UUID}@6c48a`);
    assert.equal(meta.userData.redirect, `${GREEN_UUID}@6c48a`);
    // 几何 / 九宫格 / 顶点全部照抄黄色底，避免新图被拉伸成另一颗按钮。
    const strip = (m: Obj) => {
        const copy = JSON.parse(JSON.stringify(m.subMetas.f9941.userData));
        delete copy.imageUuidOrDatabaseUri;
        return copy;
    };
    assert.deepEqual(strip(meta), strip(base));
    assert.equal(meta.subMetas.f9941.displayName, 'btn_speed_up');
});

test('prefab：BtnPrimary 下挂 SpeedUpIcon（播放图 / 默认隐藏 / UI_2D / 42×44）', () => {
    const icon = nodeOf('SpeedUpIcon');
    assert.ok(icon, '缺 BtnPrimary/SpeedUpIcon');
    assert.equal(at(icon._parent)?._name, 'BtnPrimary');
    assert.equal(icon._active, false, '默认隐藏：只有加速态才显示');
    assert.equal(icon._layer, 33554432, 'UI_2D');
    const comps = (icon._components ?? []).map(at);
    const transform = comps.find((c) => c?.__type__ === 'cc.UITransform');
    const sprite = comps.find((c) => c?.__type__ === 'cc.Sprite');
    assert.ok(transform && sprite, '缺 UITransform / Sprite');
    assert.deepEqual(
        [transform!._contentSize.width, transform!._contentSize.height], [42, 44],
        '图标按弹窗字号放大到 42×44（栏位那颗是 28×29）',
    );
    assert.equal(sprite!._spriteFrame.__uuid__, BOLT_UUID, '复用栏位「加速」那颗播放图');

    const primary = nodeOf('BtnPrimary');
    const children = (primary._children ?? []).map(at).map((c) => c?._name);
    assert.deepEqual(children, ['Label', 'CostBg', 'CostLabel', 'SpeedUpIcon'],
        '新节点追加在末尾，既有子节点顺序不许动');
});

test('prefab：三处新引用都绑上（主按钮 Sprite / 绿色底 / 播放 icon 节点）', () => {
    assert.equal(at(panelComp.openFrame)?.__type__, 'cc.Sprite');
    assert.equal(at(panelComp.openFrame)?.node?.__id__, objects.indexOf(nodeOf('BtnPrimary')),
        'openFrame 必须是 BtnPrimary 自己那颗 Sprite，不是别的按钮');
    assert.equal(at(panelComp.openSpeedUpIcon)?._name, 'SpeedUpIcon');
    assert.equal(panelComp.openSpeedUpFrame?.__uuid__, `${GREEN_UUID}@f9941`);
    const meta = JSON.parse(readFileSync(`${ART_DIR}/detail/btn_speed_up.png.meta`, 'utf8')) as Obj;
    assert.equal(panelComp.openSpeedUpFrame.__uuid__, meta.subMetas.f9941.uuid);
    // 黄色底仍在 prefab 上（加速态结束要还原它，不是把绿底写死）。
    const primarySprite = at(panelComp.openFrame)!;
    assert.match(primarySprite._spriteFrame.__uuid__ as string, /^ec5cdf3c/, 'BtnPrimary 静态底仍是 btn_open（黄）');
});

// ─────────────────────────────── 组件行为 ───────────────────────────────

function loadPanelClass(): new () => Obj {
    const exports: Record<string, new () => Obj> = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/main/ChestDetailPanel.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, require: () => ({
        _decorator: { ccclass: () => (v: unknown) => v, property: () => () => undefined },
        Button: class { static EventType = { CLICK: 'click' }; },
        Node: class {}, Sprite: class {}, SpriteFrame: class {}, Label: class {},
        EventMgr: { instance: { emit: () => undefined } },
        PopupBase: class {}, RewardItemView: class {}, VirtualScrollView: class {},
        CHEST_EVENTS: { CLOSE: 'c', FAST_OPEN: 'f', OPEN: 'o' },
        formatChestCountdown: (seconds: number) => {
            const total = Math.max(0, Math.floor(seconds));
            const pad = (v: number) => String(v).padStart(2, '0');
            return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
        },
    }) });
    return Object.values(exports)[0];
}

const makeNode = (): Obj => {
    const node: Obj = { active: true, pos: [0, 0] as number[] };
    node.setPosition = (x: number, y: number) => { node.pos = [x, y]; };
    node.on = () => undefined;
    return node;
};
const makeLabel = (): Obj => ({ string: '', fontSize: 34, spacingX: 1.8, node: makeNode() });

function createPanel(): { panel: Obj; yellow: Obj; green: Obj } {
    const panel = new (loadPanelClass())();
    const yellow = { id: 'btn_open' };
    const green = { id: 'btn_speed_up' };
    panel.node = makeNode();
    for (const key of ['nameLabel', 'qualityLabel', 'countLabel', 'fastLabel', 'fastCostLabel', 'openLabel', 'openCostLabel']) {
        panel[key] = makeLabel();
    }
    panel.qualityFrame = { spriteFrame: null };
    panel.chestIcon = { spriteFrame: { id: 'chest' } };
    panel.fastCostIcon = { spriteFrame: null };
    panel.fastCostRoot = makeNode();
    panel.openCostRoot = makeNode();
    panel.openFrame = { spriteFrame: yellow };
    panel.openSpeedUpFrame = green;
    panel.openSpeedUpIcon = makeNode();
    for (const key of ['fastButton', 'openButton', 'closeButton']) {
        panel[key] = { node: makeNode(), interactable: true };
    }
    panel.dropList = { renderItemFn: null, setTotalCount: () => undefined };
    panel.closeByButton = () => undefined;
    panel.onInit();
    return { panel, yellow, green };
}

const content = (over: Obj): Obj => ({
    name: '幼苗中级箱', qualityText: '品质：普通', countText: '数量：1',
    icon: null, qualityFrame: null, rewards: [], fastOpenCost: 10,
    fastOpenEnabled: true, openCaption: '解锁', openCountdown: '00:00:28',
    openEnabled: true, openSpeedUp: false, costIcon: null, ...over,
});

test('加速态：换绿底 + 显示播放 icon + 文案与 icon 整组居中（倒计时胶囊不动）', () => {
    const { panel, green } = createPanel();
    panel.applyContent(content({ openCaption: '加速', openSpeedUp: true, openCountdown: '00:00:24', openEnabled: false }));
    assert.equal(panel.openFrame.spriteFrame, green, '加速 ⇒ 绿色底');
    assert.equal(panel.openSpeedUpIcon.active, true, '加速 ⇒ 播放 icon 出现');
    assert.equal(panel.openLabel.string, '加速');
    assert.equal(panel.openCostRoot.active, true);
    assert.equal(panel.openCostLabel.string, '00:00:24');
    assert.equal(panel.openButton.interactable, false, '没有加速协议 ⇒ 仍禁用');

    // 2 字 × 34 + 字距 1.8 = 69.8；icon 42 + 间隙 6 ⇒ 整组 117.8，围绕 x=4 居中。
    const textWidth = 2 * 34 + 1.8;
    const left = 4 - (42 + 6 + textWidth) / 2;
    assert.ok(Math.abs(panel.openSpeedUpIcon.pos[0] - (left + 21)) < 1e-9);
    assert.ok(Math.abs(panel.openLabel.node.pos[0] - (left + 42 + 6 + textWidth / 2)) < 1e-9);
    assert.equal(panel.openLabel.node.pos[1], 21.5, 'icon 与文案同一条两行态上半位');
});

test('解锁 / 开启态：还原黄色底、隐藏播放 icon、文案回到设计稿 x=4', () => {
    const { panel, yellow, green } = createPanel();
    panel.applyContent(content({ openCaption: '加速', openSpeedUp: true, openCountdown: '00:00:24' }));
    assert.equal(panel.openFrame.spriteFrame, green);
    panel.applyContent(content({ openCaption: '解锁', openCountdown: '00:00:28' }));
    assert.equal(panel.openFrame.spriteFrame, yellow, '不能把上一态的绿底留下来');
    assert.equal(panel.openSpeedUpIcon.active, false);
    assert.deepEqual(panel.openLabel.node.pos, [4, 21.5]);

    // 幂等：连续两次全量赋值不累加位移。
    panel.applyContent(content({ openCaption: '开启', openCountdown: '' }));
    panel.applyContent(content({ openCaption: '开启', openCountdown: '' }));
    assert.deepEqual(panel.openLabel.node.pos, [4, 0], '无倒计时 ⇒ 文案回到按钮正中');
    assert.equal(panel.openCostRoot.active, false);
});

test('★ 点「解锁」后的轻量刷新会整颗按钮同步切态，不是只改倒计时', () => {
    const { panel, yellow, green } = createPanel();
    panel.applyContent(content({ openCaption: '解锁', openCountdown: '00:00:28' }));
    assert.equal(panel.openFrame.spriteFrame, yellow);
    assert.equal(panel.openSpeedUpIcon.active, false);

    // `MainPage.refreshChestDetailCountdown` 现在把当前槽位状态一起下发。
    panel.updateCountdown(11, true, { caption: '加速', speedUp: true });
    assert.equal(panel.openLabel.string, '加速', '文案必须跟着切，不能停在「解锁」');
    assert.equal(panel.openFrame.spriteFrame, green, '底图必须跟着切，不能停在黄色');
    assert.equal(panel.openSpeedUpIcon.active, true, '播放 icon 必须跟着出现');
    assert.equal(panel.openCostLabel.string, '00:00:11');
    assert.equal(panel.openButton.interactable, false);

    // 等完了：回到黄色「开启」，胶囊隐藏、按钮可点。
    panel.updateCountdown(0, false, { caption: '开启', speedUp: false });
    assert.equal(panel.openLabel.string, '开启');
    assert.equal(panel.openFrame.spriteFrame, yellow);
    assert.equal(panel.openSpeedUpIcon.active, false);
    assert.equal(panel.openCostRoot.active, false);
    assert.equal(panel.openButton.interactable, true);
    assert.deepEqual(panel.openLabel.node.pos, [4, 0]);
});

test('源码守卫：文案 / 加速态判据都来自页面，弹窗不自造文案也不建 tween', () => {
    const panelSrc = readFileSync('assets/script/app/main/ChestDetailPanel.ts', 'utf8');
    const pageSrc = readFileSync('assets/script/app/main/MainPage.ts', 'utf8');
    assert.doesNotMatch(panelSrc, /'加速'/, '弹窗不许自己写死「加速」文案');
    assert.match(panelSrc, /content\.openSpeedUp === true/);
    assert.match(panelSrc, /state\?\.caption \?\? this\.openCaption/);
    assert.match(panelSrc, /state\?\.speedUp \?\? this\.openSpeedUp/);
    // 页面：内容构造与每秒刷新都从 `chestActionCaption` / `detail.action` 取，不另写一份。
    assert.match(pageSrc, /openSpeedUp: counting/);
    assert.match(pageSrc, /caption: chestActionCaption\(detail\.action\)/);
    assert.match(pageSrc, /const speedUp = detail\.action === ChestSlotAction\.SpeedUp/);
    assert.match(pageSrc, /this\.treasureRepository\.load\(this, \(\) => this\.refreshTreasureDisplay\(\)\)/);
    assert.doesNotMatch(panelSrc, /tween\(|cc\.tween/);
});
