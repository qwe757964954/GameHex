/**
 * 通用弹窗外壳 `ui/common/CommonDialog` 的结构守卫。
 *
 * ## 为什么要有这条
 *
 * 这个 prefab 是**生成脚本产出**的（`tmp/_gen_common_dialog.py`），不是编辑器里手拖的。
 * 生成类 prefab 的事故特征很统一：**一条错都不报，只是打开后某块没了**——
 *
 *   · 三个 `@property` 指错对象（`__id__` 指到 Node 而不是组件）⇒ 运行时空指针；
 *   · `Widget._alignFlags` 写错位掩码 ⇒ 长屏下弹窗不跟着拉／不居中，编辑器里看不出来；
 *   · `cc.PrefabInfo.asset` 写成 `null` ⇒ 层级面板整棵子树标红（技能 §23）；
 *   · 底图 `capInsets` 没配 ⇒ `SLICED` 退化成拉伸，面板一改高度边框就糊。
 *
 * 这几条都只能靠读文件断言（跑引擎太重，而且 `capture_screenshot` 也看不出位掩码对不对）。
 *
 * ## 判据口径
 *
 * 纯读 `.prefab` JSON，零 `cc` 依赖 —— 与 `tests/prefab-root-script.test.ts` 同一套写法。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const PREFAB = path.join(ROOT, 'assets/resources/ui/common/CommonDialog.prefab');
const SCRIPT = path.join(ROOT, 'assets/script/app/common/CommonDialog.ts');
const BUST_META = path.join(ROOT, 'assets/resources/image/main/popup/bg.png.meta');

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Cocos 的 uuid → 23 位压缩 cid。 */
function compressUuid(uuid: string): string {
    const s = String(uuid).replace(/-/g, '');
    assert.equal(s.length, 32, `不是合法 uuid: ${uuid}`);
    let out = s.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const a = parseInt(s[i], 16);
        const b = parseInt(s[i + 1], 16);
        const c = parseInt(s[i + 2], 16);
        out += B64[(a << 2) | (b >> 2)] + B64[((b & 3) << 4) | c];
    }
    return out;
}

interface IObj {
    __type__?: string;
    _name?: string;
    _parent?: { __id__: number } | null;
    _children?: { __id__: number }[];
    _components?: { __id__: number }[];
    _layer?: number;
    _contentSize?: { width: number; height: number };
    _alignFlags?: number;
    _prefab?: { __id__: number };
    asset?: { __id__: number } | null;
    fileId?: string;
    [k: string]: unknown;
}

const OBJS = JSON.parse(readFileSync(PREFAB, 'utf8')) as IObj[];
const CID = compressUuid(JSON.parse(readFileSync(`${SCRIPT}.meta`, 'utf8')).uuid as string);

const nodeIdx = (name: string): number => {
    const i = OBJS.findIndex((o) => o.__type__ === 'cc.Node' && o._name === name);
    assert.ok(i >= 0, `找不到节点 ${name}`);
    return i;
};
const compsOf = (i: number): IObj[] => (OBJS[i]._components ?? []).map((c) => OBJS[c.__id__]);
const compOf = (i: number, type: string): IObj => {
    const c = compsOf(i).find((x) => x.__type__ === type);
    assert.ok(c, `节点 ${OBJS[i]._name} 上没有 ${type}`);
    return c;
};

test('根节点挂着 CommonDialog 脚本组件', () => {
    const root = nodeIdx('CommonDialog');
    assert.ok(
        compsOf(root).some((c) => c.__type__ === CID),
        `根节点没有 ${CID}（脚本改动后要同步刷新 prefab）`,
    );
    // 反向：Root 下必须只有 Dim / Panel 两个业务子节点（__BlankClose 是运行时补的）
    const kids = (OBJS[root]._children ?? []).map((x) => OBJS[x.__id__]._name);
    assert.deepEqual(kids, ['Dim', 'Panel']);
});

test('三个 @property 引用指向正确类型的组件', () => {
    const root = nodeIdx('CommonDialog');
    const script = compsOf(root).find((c) => c.__type__ === CID) as Record<string, { __id__: number } | null>;
    assert.ok(script, '根节点上找不到脚本组件');

    const expect = (prop: string, type: string): void => {
        const ref = script[prop];
        assert.ok(ref && typeof ref.__id__ === 'number', `${prop} 没有绑定`);
        assert.equal(OBJS[ref.__id__].__type__, type, `${prop} 指向的不是 ${type}`);
    };
    expect('titleLabel', 'cc.Label');
    expect('closeButton', 'cc.Button');
    expect('contentRoot', 'cc.Node');
});

test('Widget 对齐按「根四边 / Panel 居中 / Content 四边」配置', () => {
    const flags = (name: string): number => {
        const w = compOf(nodeIdx(name), 'cc.Widget');
        return w._alignFlags as number;
    };
    // TOP1 | BOT4 | LEFT8 | RIGHT32 = 45；MID2 | CENTER16 = 18
    assert.equal(flags('CommonDialog'), 45, '根节点必须四边对齐，否则长屏上下露底');
    assert.equal(flags('Dim'), 45, '遮罩必须四边对齐');
    assert.equal(flags('Panel'), 18, 'Panel 必须水平+垂直居中');
    assert.equal(flags('Content'), 45, 'Content 必须四边对齐，才随 Panel 尺寸自适应');
});

test('层级顺序：背景在下、内容在上', () => {
    const panel = nodeIdx('Panel');
    const kids = (OBJS[panel]._children ?? []).map((x) => OBJS[x.__id__]._name);
    assert.deepEqual(kids, ['TitlePlate', 'TitleLabel', 'CloseBtn', 'Content'],
        '顺序即渲染序：文字必须在牌匾之上，内容区压在最上层');
});

test('底图配了九宫格（否则 SLICED 退化成长边拉伸，边框会糊）', () => {
    const meta = JSON.parse(readFileSync(BUST_META, 'utf8')) as {
        subMetas: Record<string, { userData: Record<string, number> }>;
    };
    const ud = meta.subMetas.f9941.userData;
    assert.ok(
        (ud.borderTop ?? 0) > 0 && (ud.borderLeft ?? 0) > 0,
        'bg.png 没配 border，Panel 改尺寸时边框会被拉变形',
    );
});

test('所有节点 layer = UI_2D，且都带 UITransform', () => {
    for (const o of OBJS) {
        if (o.__type__ !== 'cc.Node') continue;
        assert.equal(o._layer, 33554432, `${o._name} 的 layer 不是 UI_2D（整棵子树不渲染）`);
        assert.ok(
            compsOf(OBJS.indexOf(o)).some((c) => c.__type__ === 'cc.UITransform'),
            `${o._name} 缺 cc.UITransform`,
        );
    }
});

test('cc.Prefab.data 指向第一个 cc.Node（技能 §10.1 天条）', () => {
    const firstNode = OBJS.findIndex((o) => o.__type__ === 'cc.Node');
    const data = (OBJS[0] as unknown as { data: { __id__: number } }).data;
    assert.equal(data.__id__, firstNode, 'data 没指向根节点 ⇒ 层级面板会少掉整棵子树');
    assert.equal(OBJS[firstNode]._parent, null, '根节点的 _parent 必须是 null');
});

test('fileId 全 22 位且唯一（重复会让编辑器命中错对象）', () => {
    const ids = OBJS.filter((o) => o.__type__ === 'cc.PrefabInfo' || o.__type__ === 'cc.CompPrefabInfo')
        .map((o) => o.fileId as string);
    assert.ok(ids.length > 0, '没扫到 fileId');
    for (const id of ids) assert.equal(id.length, 22, `fileId 长度不对: ${id}`);
    assert.equal(new Set(ids).size, ids.length, 'fileId 有重复');
});

test('普通节点的 PrefabInfo.asset 指向本 prefab（写成 null 会让节点名标红）', () => {
    for (let i = 0; i < OBJS.length; i++) {
        const o = OBJS[i];
        if (o.__type__ !== 'cc.Node') continue;
        const info = OBJS[o._prefab?.__id__ as number];
        assert.ok(info, `${o._name} 没有 PrefabInfo`);
        assert.deepEqual(info.asset, { __id__: 0 }, `${o._name} 的 PrefabInfo.asset 不是 {__id__:0}`);
    }
});
