import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const PAGE_TS = 'assets/script/app/friend/FriendApplyPage.ts';

interface IDeferred {
    resolve: (snapshot: unknown) => void;
}

/** 用真实 `FriendApplyPage.reload` 跑行为，只替换与本用例无关的框架依赖。 */
function loadPageClass(): new () => any {
    const exports: Record<string, unknown> = {};
    class PopupBase {
        isPopupOpen = true;
        node: { isValid: boolean } | null = null;
    }
    const code = ts.transpileModule(readFileSync(PAGE_TS, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, {
        exports,
        console,
        require: (name: string) => {
            if (name === 'cc') {
                return {
                    _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
                    Button: class {}, Label: class {}, Node: class {},
                };
            }
            if (name.endsWith('/PopupBase')) return { PopupBase };
            if (name.endsWith('/VScrollView')) return { VirtualScrollView: class {} };
            if (name.endsWith('/FriendRepository')) return { friendRepository: {} };
            if (name.endsWith('/FriendApplyRow')) return { FriendApplyRow: class {} };
            if (name.endsWith('/FriendTable')) {
                return { buildFriendRowView: () => ({}), FriendTab: { Add: 1 } };
            }
            if (name.endsWith('/FriendTexts')) {
                return new Proxy({}, { get: (_target, key) => String(key) });
            }
            if (name.endsWith('/FW')) return { FW: { showTip() {} } };
            return {};
        },
    });
    return exports.FriendApplyPage as new () => any;
}

function makePage(Page: new () => any) {
    const page: any = new Page();
    const loads: IDeferred[] = [];
    const presented: string[] = [];
    page.repo = { load: () => new Promise(resolve => loads.push({ resolve })) };
    page.present = () => {
        const id = page.snapshot?.applyRows?.[0]?.id;
        if (id) presented.push(id);
    };
    return { page, loads, presented };
}

const snapshot = (id: string) => ({ applyRows: [{ id }], now: 0, appliedIds: new Set(), leftSendTimes: 0 });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('关闭后迟到的申请列表结果不再铺界面', async () => {
    const Page = loadPageClass();
    const { page, loads, presented } = makePage(Page);

    const opening = page.onOpen();
    page.isPopupOpen = false;
    loads[0].resolve(snapshot('closed'));
    await opening;
    await flush();
    assert.deepEqual(presented, []);
});

test('重开不会把上一次打开的在途结果串进来', async () => {
    const Page = loadPageClass();
    const { page, loads, presented } = makePage(Page);

    const first = page.onOpen();
    page.isPopupOpen = false;
    page.isPopupOpen = true;
    const second = page.onOpen();

    loads[0].resolve(snapshot('old'));
    await first;
    await flush();
    assert.deepEqual(presented, [], '上一次打开的旧结果必须先被 revision 挡掉');

    loads[1].resolve(snapshot('current'));
    await second;
    await flush();
    assert.deepEqual(presented, ['current']);
});

test('同一存活期内乱序返回时只提交最新一次结果', async () => {
    const Page = loadPageClass();
    const { page, loads, presented } = makePage(Page);

    const earlier = page.reload();
    const later = page.reload();
    loads[1].resolve(snapshot('later'));
    await later;
    await flush();
    assert.deepEqual(presented, ['later']);

    loads[0].resolve(snapshot('earlier'));
    await earlier;
    await flush();
    assert.deepEqual(presented, ['later'], '先发后到的旧结果不得覆盖新结果');
});
