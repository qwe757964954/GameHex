/**
 * 「声明了 `static prefabPath` 的脚本，其 prefab 根节点上必须真的挂着这个脚本」的回归网。
 *
 * ## 为什么要有这条
 *
 * `PopupManager._openNew()` 里有一段**兜底补挂**：
 *
 * ```ts
 * let popup = node.getComponent(cls) as T | null;
 * if (!popup) {
 *   console.warn(`[PopupManager] ${opening.path} 根节点没有 ${cls.name} 组件，已自动补挂`);
 *   popup = node.addComponent(cls) as T;
 * }
 * ```
 *
 * 补挂**只补组件本身**，`@property` 在 Inspector 里拖的引用**一个都回不来** ⇒ 补完是个
 * 「引用全 null 的空壳页」。而项目口径是「已绑定的 `@property` 一律不判空」（`MEMORY.md` 规则 109）
 * ⇒ 接下来就是打开即抛 `Cannot read properties of null (reading 'on')`。
 *
 * 2026-09-26 实测：`ui/PlayerInfo/ChangeHead.prefab` 根节点**只有 `cc.UITransform`**
 * （生成器漏挂），打开即打那条 warn。修完后加本测试兜住同类回归。
 *
 * ## 判据
 *
 * 脚本组件在 prefab 里存的是**压缩 cid**（23 位，`.ts.meta` 的 uuid 压来的）⇒
 * 「根节点的 `_components` 里有这个 cid」就是「挂上了」。
 *
 * ⚠️ 两处必须做对，否则会误报（都是实战踩过的）：
 *   ① **先剥注释**：`PopupBase` 的文档注释里就写着 `static prefabPath = 'ui/game/GameRunAway';`
 *      当例子，不剥注释会把它当成一个真声明；
 *   ② **跳过基类本身**：`PopupBase.prefabPath` 只是默认值 `''`。
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';

const ROOT = path.resolve(import.meta.dirname, '..');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Cocos 的 uuid → 23 位压缩 cid（前 5 个 hex 原样保留，其余每 3 个 hex → 2 个 base64 字符）。 */
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

/** 剥掉块注释与行注释（规则 104：反向断言先剥注释）。 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walkScripts(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name !== 'node_modules') walkScripts(p, out);
        } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
            out.push(p);
        }
    }
    return out;
}

interface IDecl {
    readonly cls: string;
    readonly file: string;
    readonly prefabPath: string;
    readonly cid: string;
}

/** 扫出全部「带 prefabPath 的页面脚本」。 */
function collectDeclarations(): readonly IDecl[] {
    const out: IDecl[] = [];
    for (const file of walkScripts(path.join(ROOT, 'assets/script'))) {
        if (file.endsWith(`PopupBase.ts`)) continue; // 基类只有默认值 ''
        const src = stripComments(readFileSync(file, 'utf8'));
        const pm = /static\s+prefabPath\s*(?::\s*string\s*)?=\s*['"]([^'"]+)['"]/.exec(src);
        if (!pm || !pm[1]) continue;
        const cm = /@ccclass\('([^']+)'\)/.exec(src);
        const meta = `${file}.meta`;
        assert.ok(existsSync(meta), `${path.relative(ROOT, file)} 没有 .ts.meta`);
        const uuid = JSON.parse(readFileSync(meta, 'utf8')).uuid as string;
        out.push({
            cls: cm?.[1] ?? path.basename(file),
            file: path.relative(ROOT, file),
            prefabPath: pm[1],
            cid: compressUuid(uuid),
        });
    }
    return out;
}

const DECLS = collectDeclarations();

test('扫描口径：拿得到一批声明（防正则写错导致空跑全绿）', () => {
    assert.ok(DECLS.length >= 20, `只扫到 ${DECLS.length} 个声明，正则大概率写错了`);
    // 反向断言：这一批里必须包含 ChangeHead（2026-09-26 真出过问题的那个）
    assert.ok(
        DECLS.some((d) => d.cls === 'ChangeHeadPage'),
        '没扫到 ChangeHeadPage —— 正则或目录遍历有问题',
    );
    assert.ok(
        DECLS.some((d) => d.cls === 'RolePage'),
        '没扫到 RolePage —— 正则或目录遍历有问题',
    );
});

test('每个 prefabPath 指向的 .prefab 都存在', () => {
    const missing = DECLS.filter((d) => !existsSync(path.join(ROOT, 'assets/resources', `${d.prefabPath}.prefab`)));
    assert.deepEqual(missing.map((d) => `${d.cls} → ${d.prefabPath}`), []);
});

test('每个页面 prefab 的根节点都挂着对应脚本组件（缺了 PopupManager 会补出「引用全 null 的空壳页」）', () => {
    const bad: string[] = [];
    for (const d of DECLS) {
        const prefabFile = path.join(ROOT, 'assets/resources', `${d.prefabPath}.prefab`);
        if (!existsSync(prefabFile)) continue; // 上一条测试已单独断言
        const objects = JSON.parse(readFileSync(prefabFile, 'utf8')) as Array<Record<string, unknown>>;
        const root = objects[1] as { _components?: Array<{ __id__: number }> } | undefined;
        assert.ok(root, `${d.prefabPath}.prefab 第 1 个对象不是根节点`);
        const types = (root._components ?? []).map((c) => objects[c.__id__]?.__type__ as string);
        if (!types.includes(d.cid)) {
            bad.push(`${d.cls} (${d.prefabPath}.prefab) 根节点缺该组件；现有: ${types.join(', ') || '(无)'}`);
        }
        if (types.includes('cc.MissingScript')) {
            bad.push(`${d.cls} (${d.prefabPath}.prefab) 根节点有 cc.MissingScript`);
        }
    }
    assert.deepEqual(bad, []);
});

test('ChangeHead 的 8 个槽位都挂着 ChangeHeadItem，且 4 个引用形态正确', () => {
    // `HeadGridList.slots` 直接取 `content.children`（**不查组件**），而 `ChangeHeadPage.renderItem`
    // 第一句就是 `node.getComponent(ChangeHeadItem); if (!item) return;` —— 槽位没挂组件 = 列表永远空白，
    // **不报错、单测也测不出**（2026-09-26 实测：生成器只铺了节点树、没挂组件）。
    const objects = JSON.parse(
        readFileSync(path.join(ROOT, assetPath('ui/PlayerInfo/ChangeHead.prefab')), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const itemCid = compressUuid(
        JSON.parse(readFileSync(path.join(ROOT, 'assets/script/app/playerinfo/ChangeHeadItem.ts.meta'), 'utf8')).uuid as string,
    );

    const content = objects.find(
        (o) => o.__type__ === 'cc.Node' && o._name === 'Content' && (o._children as unknown[] | undefined)?.length === 8,
    ) as { _children: Array<{ __id__: number }> } | undefined;
    assert.ok(content, '没找到带 8 个子节点的 Content 节点');

    const bad: string[] = [];
    content._children.forEach((ref, i) => {
        const slot = objects[ref.__id__] as { _name: string; _components?: Array<{ __id__: number }> };
        const comps = (slot._components ?? []).map((c) => objects[c.__id__] as Record<string, { __id__: number }> & { __type__: string });
        const item = comps.find((c) => c.__type__ === itemCid);
        if (!item) {
            bad.push(`${slot._name ?? `#${i}`} 没有 ChangeHeadItem 组件`);
            return;
        }
        const headIcon = objects[item.headIcon.__id__] as { __type__: string };
        const headFrame = objects[item.headFrame.__id__] as { __type__: string };
        const selectedFrame = objects[item.selectedFrame.__id__] as { __type__: string; _name: string };
        const redDot = objects[item.redDot.__id__] as { __type__: string; _name: string };
        if (headIcon.__type__ !== 'cc.Sprite') bad.push(`${slot._name}.headIcon 不是 Sprite`);
        if (headFrame.__type__ !== 'cc.Sprite') bad.push(`${slot._name}.headFrame 不是 Sprite`);
        if (selectedFrame.__type__ !== 'cc.Node' || selectedFrame._name !== 'SelectedFrame') bad.push(`${slot._name}.selectedFrame 指向了 ${selectedFrame.__type__}:${selectedFrame._name}`);
        if (redDot.__type__ !== 'cc.Node' || redDot._name !== 'RedDot') bad.push(`${slot._name}.redDot 指向了 ${redDot.__type__}:${redDot._name}`);
    });
    assert.deepEqual(bad, []);
});

test('ChangeHead 根节点的 5 个 @property 都指向了正确形态（节点 / 组件）', () => {
    const objects = JSON.parse(
        readFileSync(path.join(ROOT, assetPath('ui/PlayerInfo/ChangeHead.prefab')), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const decl = DECLS.find((d) => d.cls === 'ChangeHeadPage');
    assert.ok(decl, '没扫到 ChangeHeadPage');
    const page = objects.find((o) => o.__type__ === decl.cid) as Record<string, { __id__?: number }> | undefined;
    assert.ok(page, 'prefab 里没有 ChangeHeadPage 组件对象');

    // 声明 Node 的两个：字段值必须是 cc.Node
    for (const field of ['closeButton', 'confirmButton'] as const) {
        const target = objects[page[field].__id__ as number];
        assert.equal(target.__type__, 'cc.Node', `${field} 应指向 cc.Node`);
    }
    // 声明 Sprite / Label 的两个：字段值必须是【组件】（不是节点 —— 规则 105 的两形态）
    assert.equal(objects[page.headIcon.__id__ as number].__type__, 'cc.Sprite', 'headIcon 应是组件');
    assert.equal(objects[page.descLabel.__id__ as number].__type__, 'cc.Label', 'descLabel 应是组件');
    // grid 是自定义脚本组件（HeadGridList 不是页面，没有 prefabPath ⇒ 不能从 DECLS 里找，直接压 cid）
    const grid = objects[page.grid.__id__ as number] as { __type__: string } & Record<string, { __id__: number }>;
    const gridMeta = path.join(ROOT, 'assets/script/app/playerinfo/HeadGridList.ts.meta');
    assert.ok(existsSync(gridMeta), 'HeadGridList.ts.meta 不存在');
    const gridCid = compressUuid(JSON.parse(readFileSync(gridMeta, 'utf8')).uuid as string);
    assert.equal(grid.__type__, gridCid, 'grid 应指向 HeadGridList 组件');
    // HeadGridList.content 必须在（否则槽位容器丢了，8 个槽位不与数据对账）
    assert.equal(objects[grid.content.__id__ as number].__type__, 'cc.Node', 'HeadGridList.content 应指向 cc.Node');
});
