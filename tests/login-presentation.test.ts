import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const prefab = JSON.parse(readFileSync('assets/resources/ui/login/LoginRoot.prefab', 'utf8'));
const node = (name: string) => prefab.find(value => value.__type__ === 'cc.Node' && value._name === name);
const component = (name: string, type: string) => node(name)._components
    .map((ref: { __id__: number }) => prefab[ref.__id__]).find(value => value.__type__ === type);

test('account login keeps controls within the lower panel and prebinds visible agreement/password controls', () => {
    const card = node('LoginCard');
    const size = component('LoginCard', 'cc.UITransform')._contentSize;
    assert.equal(component('LoginCard', 'cc.Widget')._bottom, 70);
    assert.equal(node('PlatformLoginBtn')._active, false);
    assert.equal(node('AgreementCheck')._active, false);
    assert.ok(component('AgreementMark', 'cc.Sprite')._spriteFrame);
    assert.ok(component('AgreementBox', 'cc.Sprite')._spriteFrame);
    assert.ok(component('PasswordEye', 'cc.Sprite')._spriteFrame);
    assert.equal(component('PasswordToggleLabel', 'cc.Label')._string, '╱');
    const script = prefab.find(value => value.accountInput);
    assert.equal(prefab[script.passwordToggleLabel.__id__], component('PasswordToggleLabel', 'cc.Label'));
    assert.equal(component('PasswordAccount', 'cc.EditBox')._inputFlag, 0);
    for (const name of ['AccountEdit', 'PasswordAccount', 'LoginBtn', 'RegisterBtn', 'ServerBtn', 'AgreementToggle', 'PasswordToggleBtn', 'StatusLabel']) {
        const child = node(name), bounds = component(name, 'cc.UITransform')._contentSize;
        assert.equal(prefab[child._parent.__id__], card, name);
        assert.ok(Math.abs(child._lpos.x) + bounds.width / 2 <= size.width / 2, `${name} horizontal bounds`);
        assert.ok(Math.abs(child._lpos.y) + bounds.height / 2 <= size.height / 2, `${name} vertical bounds`);
    }
    for (const name of ['LoginBtn', 'RegisterBtn', 'ServerBtn', 'AgreementToggle', 'PasswordToggleBtn']) {
        const button = component(name, 'cc.Button');
        assert.equal(button._transition, 0, name);
        assert.equal(button._target, null, name);
    }
    for (const sprite of prefab.filter(value => value.__type__ === 'cc.Sprite' && value._sizeMode === 0)) {
        assert.equal(sprite._isTrimmedMode, false);
    }
});

test('browser, WeChat and Douyin all expose account login while channel login is unconfigured', () => {
    const source = ts.transpileModule(readFileSync('assets/script/app/bootstrap/login/LoginComposition.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    for (const platform of ['browser', 'wechat', 'douyin']) {
        const exports: { resolve?: () => { platformLoginVisible: boolean; gmVisible: boolean } } = {};
        runInNewContext(source + '\nexports.resolve = resolveChannelConfig;', { exports, require(name: string) {
            if (name.endsWith('/ControllerBase')) return { ControllerBase: class {} };
            if (name.endsWith('/EngineMain')) return { EngineMain: { isMiniGameWeiXin: platform === 'wechat', isMiniGameDouyin: platform === 'douyin' } };
            if (name.endsWith('/WxUtil')) return { WxUtil: { isDevelop: () => false, isTrial: () => false } };
            if (name.endsWith('/TTUtil')) return { TTUtil: { isDevelop: () => false, isTrial: () => false } };
            return {};
        } });
        const config = exports.resolve();
        assert.equal(config.platformLoginVisible, false, platform);
        assert.equal(config.gmVisible, platform === 'browser', platform);
    }
});
