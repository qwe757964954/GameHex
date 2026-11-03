import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { BigMapUiEvent } from '../assets/script/app/bigmap/application/BigMapEvents';

const objects = JSON.parse(readFileSync('assets/bundles/bigmap/ui/bigmap/BigMapInfoPopup.prefab', 'utf8'));
const node = (name: string) => objects.find((item: any) => item.__type__ === 'cc.Node' && item._name === name);
const component = (name: string, type: string) => node(name)._components.map((ref: any) => objects[ref.__id__]).find((item: any) => item.__type__ === type);

test('详情排版由Prefab Widget和Layout管理，正文自动增高，引用与按钮完整', () => {
    assert.equal(component('Dim', 'cc.Widget')._alignFlags, 18);
    assert.equal(component('Dim', 'cc.Layout')._layoutType, 2);
    assert.equal(component('Dim', 'cc.Layout')._resizeMode, 1);
    assert.equal(component('Actions', 'cc.Layout')._layoutType, 1);
    assert.equal(component('InfoBody', 'cc.Label')._overflow, 3);
    assert.equal(component('InfoBody', 'cc.Label')._horizontalAlign, 1);
    const popup = objects.find((item: any) => 'infoTitle' in item);
    assert.equal(component('BigMapInfoPopup', 'cc.Layout'), undefined, '空白接收层不参与卡片Layout');
    assert.equal(objects[popup.contentNodes[0].__id__]._name, 'Dim');
    for (const field of ['infoTitle', 'infoBody', 'infoThumbnail', 'closeButton', 'primaryButton', 'secondaryButton']) assert.ok(objects[popup[field].__id__], field);
    for (const name of ['Close', 'Primary', 'Secondary']) {
        assert.equal(component(name, 'cc.Button')._transition, 0);
        assert.equal(component(name, 'cc.Button')._target, null);
        const art = node(name)._children.map((ref: any) => objects[ref.__id__]).find((child: any) => child._name === 'ButtonArt');
        assert.equal(art._active, true, name + ' 的底图必须在 prefab 激活，原生 Button 不会替代旧 setSkin 激活它');
        const sprite = art._components.map((ref: any) => objects[ref.__id__]).find((item: any) => item.__type__ === 'cc.Sprite');
        assert.equal(sprite._enabled, true);
        assert.ok(sprite._spriteFrame);
        assert.ok(sprite._color.a > 0);
    }
    const dim = component('Dim', 'cc.Sprite');
    assert.equal(dim._spriteFrame.__uuid__, 'fbe1f245-51ca-46cb-a726-e3bda54f8dd6@f9941');
    assert.ok(dim._color.a > 0 && dim._color.a < 255);
    assert.ok(!objects.some((item: any) => ['82bc1TQXaNPzLvdeWx0YiQx', 'b8a05X1iStIKZKq2Ksls5lW'].includes(item.__type__)));
    for (const field of ['closeButton', 'primaryButton', 'secondaryButton']) assert.equal(objects[popup[field].__id__].__type__, 'cc.Button');
    for (const item of objects.filter((item: any) => item.__type__ === 'cc.Node')) {
        assert.equal(item._layer, 33554432, item._name);
        assert.ok(item._components.some((ref: any) => objects[ref.__id__].__type__ === 'cc.UITransform'));
    }
});

test('详情脚本只写内容和状态，不设置尺寸、坐标、缩放、字号或额外布局', () => {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapInfoPopup.ts', 'utf8');
    assert.doesNotMatch(source, /setPosition|setContentSize|setScale|fontSize\s*=|lineHeight\s*=|bigMapInfoLayout|view\.getVisibleSize/);
    assert.match(source, /extends PopupBase/);
    const page = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    assert.match(page, /Toast.show\(feedback.message\)/);
    assert.doesNotMatch(page, /toastUntil|toastLabel|enterMask|infoDim|applyInfoLayout/);
});

function makePopup() {
    class Button { static EventType = { CLICK: 'click' }; interactable = true; }
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bigmap/view/BigMapInfoPopup.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require: (id: string) => {
        if (id === 'cc') return { _decorator: { ccclass: () => (v: unknown) => v, property: () => () => undefined }, Button };
        if (id.endsWith('/PopupBase')) return { PopupBase: class { close(reason: number) { this.onClose(reason); } onClose(_reason: number) {} } };
        if (id.endsWith('/PopupDef')) return { PopupCloseReason: { Force: 3, CloseButton: 2 } };
        if (id.endsWith('/EventMgr')) return { EventMgr };
        if (id.endsWith('/BigMapEvents')) return { BigMapUiEvent };
        if (id.endsWith('/BigMapSkin')) return { BIGMAP_HUD_COLORS: { ink: {} } };
        return {};
    } });
    const popup = new exports.BigMapInfoPopup();
    popup.infoTitle = { string: '' }; popup.infoBody = { string: '' };
    popup.infoThumbnail = { spriteFrame: null, node: { active: false } };
    const handlers: Record<string, () => void> = {};
    const nativeButtons: Record<string, any> = {};
    const button = (name: string) => {
        const value = new Button();
        Object.assign(value, { node: { active: true,
            on: (_event: string, callback: () => void, caller: object) => { handlers[name] = callback.bind(caller); } } });
        nativeButtons[name] = value;
        return value;
    };
    popup.primaryButton = button('primary'); popup.secondaryButton = button('secondary'); popup.closeButton = button('close');
    popup.primaryLabel = { string: '' }; popup.secondaryLabel = { string: '' };
    return { popup, handlers, nativeButtons };
}

test('详情复用全量覆盖内容与按钮状态，操作派发既有意图，强制关闭不清除新目标', () => {
    const { popup, handlers, nativeButtons } = makePopup();
    const calls: string[] = [];
    EventMgr.instance.on(BigMapUiEvent.Intent, (event: { intent: { kind: string } }) => calls.push(event.intent.kind), popup);
    try {
        popup.onInit();
        popup.render({ title: '建筑', body: '升级条件', icon: {}, buttonFrame: null,
            primary: { text: '升级', enabled: true }, secondary: { text: '移动', enabled: true } });
        handlers.primary(); handlers.secondary();
        popup.render({ title: '野怪', body: '等待刷新', icon: null, buttonFrame: null,
            primary: { text: '等待刷新', enabled: false }, secondary: null });
        assert.equal(popup.infoTitle.string, '野怪');
        assert.equal(popup.infoThumbnail.node.active, false);
        assert.equal(popup.infoThumbnail.spriteFrame, null);
        assert.equal(nativeButtons.primary.interactable, false);
        assert.equal(popup.secondaryButton.node.active, false);
        assert.equal(popup.secondaryLabel.string, '');
        popup.onClose(3);
        assert.deepEqual(calls, ['primary', 'secondary']);
        handlers.close();
        assert.deepEqual(calls, ['primary', 'secondary', 'clear']);
    } finally { EventMgr.instance.offTarget(popup); }
});

test('详情加载期间换目标只打开一次并使用最新内容，关闭取消在途弹窗；反馈使用公共Toast', async () => {
    let finish: (popup: object) => void = () => {};
    let opens = 0;
    const rendered: string[] = [];
    const cancelled: unknown[] = [];
    const tips: string[] = [];
    const InfoPopup = { open: () => { opens++; return new Promise((resolve) => { finish = resolve; }); } };
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, require: (id: string) => {
        if (id === 'cc') return { _decorator: { ccclass: () => (v: unknown) => v }, Component: class { isValid = true; } };
        if (id.endsWith('/BigMapInfoPopup')) return { BigMapInfoPopup: InfoPopup };
        if (id.endsWith('/PopupManager')) return { PopupManager: { inst: { get: () => null,
            closeByClass: (type: unknown) => cancelled.push(type) } } };
        if (id.endsWith('/PopupDef')) return { PopupCloseReason: { Force: 3 } };
        if (id.endsWith('/Toast')) return { Toast: { show: (text: string) => tips.push(text) } };
        return {};
    } });
    const page = new exports.BigMapPage();
    const pending = page.showInfoPopup({ title: '旧目标' });
    await page.showInfoPopup({ title: '新目标' });
    assert.equal(opens, 1);
    finish({ render: (content: { title: string }) => rendered.push(content.title) });
    await pending;
    assert.deepEqual(rendered, ['新目标']);
    const closed = page.showInfoPopup({ title: '关闭的目标' });
    page.closeInfoPopup();
    finish({ render: (content: { title: string }) => rendered.push(content.title) });
    await closed;
    assert.deepEqual(cancelled, [InfoPopup]);
    assert.deepEqual(rendered, ['新目标']);
    page.feedback({ ok: false, message: '资源不足' });
    page.feedback({ ok: true, message: '' });
    assert.deepEqual(tips, ['资源不足']);
});
