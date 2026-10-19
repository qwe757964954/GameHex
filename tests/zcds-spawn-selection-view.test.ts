import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 自选主城 HUD（`ZCSpawnSelectionView` + `ZCSpawnSelection.prefab`）的结构守卫。
 *
 * 这一版是**蓝湖「落点选择」稿**的切图版：顶部信息带 / 绿勾 / 左下「收回提示」全部用设计稿导出的
 * 单图（`image/gameui/` 下的 `bg_01`、`btn_01`、`btn_gou`、`jiantou_01`、`progress_b_01/02`），
 * 只有设计稿里没有的吐司仍用 `cc.Graphics` 画。
 *
 * 判据分四层：
 *   ① 源码里不许再退回「代码搭节点 / 代码画面板底」；
 *   ② prefab 的树形、尺寸、相对几何逐项等于**下面手抄的设计稿量测表**（独立于生成脚本，别让两边一起错）；
 *   ③ 每张切图都真的指到 `image/gameui/<名>.png`，且 `sizeMode=CUSTOM` + `trim=false`；
 *   ④ 视图的每个 `@property` 在 prefab 上都反解到正确类型的对象（漏绑 = 运行时空指针）。
 */
const viewSource = readFileSync('assets/script/app/zcds/view/ZCSpawnSelectionView.ts', 'utf8');
const gameSource = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
const loaderSource = readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8');
const viewMeta = JSON.parse(readFileSync('assets/script/app/zcds/view/ZCSpawnSelectionView.ts.meta', 'utf8'));
const prefabText = readFileSync('assets/resources/ui/game/ZCSpawnSelection.prefab', 'utf8');
const objects: any[] = JSON.parse(prefabText);

/** cid 由脚本 uuid 推出（前 5 hex 原样 + 每 3 hex → 2 个 base64 字符），与编辑器同一套规则。 */
const CID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function cidOf(uuid: string): string {
    const hex = uuid.replace(/-/g, '');
    return hex.slice(0, 5) + Array.from({ length: 9 }, (_, i) => {
        const value = parseInt(hex.slice(5 + i * 3, 8 + i * 3), 16);
        return CID_ALPHABET[value >> 6] + CID_ALPHABET[value & 0x3f];
    }).join('');
}

/** 反向断言前先剥注释：本文件的注释里就写着 `new Node`（规则 104）。 */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 设计稿量测表（蓝湖「落点选择」稿，画布 720×1610，与工程美术 1:1）——**手抄**，别由 prefab 反推。
 * cocosY = 805 − 设计y（y 反向）；子树坐标 = 子中心 − 父中心。顶栏/按钮另有 Widget 钉边。
 *
 * 2026-10-17 按线框图重排顶栏为**三行式**（倒计时数字 / 标题 / 进度条）：
 *   · 数字 30 → **48** 号、从中间挪到**第一行** `+35`，仍是水平居中；
 *   · 标题 28 → **25** 号（用户 2026-10-17 手定；行高同步 38 → 32，框仍 300×38 不触发 SHRINK），下移到第二行 `-9`；
 *   · 字号不能只比数字小、还要「**看着**小」：汉字满字高 ≈ 0.95em、数字只有大写高 ≈ 0.72em ——
 *     46 号数字 × 0.72 ≈ 33 与 34 号汉字 × 0.95 ≈ 32 几乎一样高（旧 28 号 vs 30 号更是**字比数大**），
 *     所以数字给到 48、标题压到 30，视觉高度 34.6 : 28.5 ≈ 0.82 才是「略小」；
 *   · 标题框 221 → **300** 宽 —— 旧的 221 装不下 8 个字 × 28 号，`SHRINK` 把实际字号压到了 22
 *     （prefab 里 `_actualFontSize: 22` 就是证据），不放宽等于「把字号调大也没用」；
 *   · 进度条先按需求**长度 −35%、高度 −5%**（398×32 → 259×30），随后用户两次手定为 **230×23** → **200×23**
 *     （填充 194×16），以最后一次手定值为准。
 */
const DESIGN = {
    band: { w: 663, h: 130, top: 78 },
    hint: { w: 300, h: 38, y: -9, fontSize: 25 },
    clock: { w: 120, h: 56, y: 35, fontSize: 48 },
    progress: { w: 200, h: 23, x: 0.5, y: -46 },
    fill: { w: 194, h: 16, x: -0.5, y: -0.5 },
    confirm: { w: 80, h: 82, bottom: 200, centerX: 28 },
    toggle: { w: 194, h: 69, left: 9, bottom: 114 },
    toggleLabel: { w: 109, h: 27, x: -20.5, y: 0, fontSize: 28 },
    arrow: { w: 32, h: 22, x: 60, y: -0.5 },
    toast: { w: 520, h: 64 },
};

/** 上一版进度条（398×32 / 填充 387×21）——本次缩到「长度 −35%、高度 −5%」。 */
const PREV_PROGRESS = { w: 398, h: 32, fillW: 387, fillH: 21 };

const nodes = objects.filter((o) => o.__type__ === 'cc.Node');
const nodeNamed = (name: string, parentName?: string) => nodes.find((node) => {
    if (node._name !== name) return false;
    if (parentName === undefined) return node._parent === null;
    return objects[node._parent.__id__]._name === parentName;
});
const componentOf = (node: any, type: string) =>
    node._components.map((ref: any) => objects[ref.__id__]).find((c: any) => c.__type__ === type);
const sizeOf = (node: any): [number, number] => {
    const transform = componentOf(node, 'cc.UITransform');
    return [transform._contentSize.width, transform._contentSize.height];
};
const positionOf = (node: any): [number, number] => [node._lpos.x, node._lpos.y];
const childrenOf = (node: any): string[] => node._children.map((ref: any) => objects[ref.__id__]._name);
const widgetOf = (node: any) => componentOf(node, 'cc.Widget');
const spriteOf = (node: any) => componentOf(node, 'cc.Sprite');
const labelOf = (node: any) => componentOf(node, 'cc.Label');

/** 美术名 → SpriteFrame uuid（`.meta` 的 subMetas uuid **已自带 `@f9941`**，别再拼）。 */
const frameOf = (art: string): string =>
    JSON.parse(readFileSync(`assets/resources/image/gameui/${art}.png.meta`, 'utf8')).subMetas.f9941.uuid;

test('视图脚本不再自己建节点 / 不再用 Graphics 画面板底', () => {
    const code = stripComments(viewSource);
    assert.doesNotMatch(code, /new Node\(/, '节点必须来自 prefab，不再 new Node');
    assert.doesNotMatch(code, /\.addComponent\(/, '组件必须挂在 prefab 上，不再 addComponent');
    assert.doesNotMatch(code, /removeAllChildren/, '宿主节点由 prefab 提供，不再清空子节点');
    // 面板底 / 进度条 / 按钮底都换成设计稿切图 ⇒ 只剩吐司还用 Graphics
    assert.doesNotMatch(code, /drawPanelBackground|drawProgress/, '面板底与进度条不再由 Graphics 画');
    assert.match(code, /toastBackground\.roundRect/, '吐司底仍归 Graphics（设计稿里没有吐司）');
    // 反过来正面确认：脚本确实按 @property 消费这些引用。
    for (const key of ['hintLabel', 'progressFill', 'confirmIcon', 'toggleArrow', 'toastNode']) {
        assert.match(code, new RegExp(`this\\.${key}\\b`), `${key} 应当被直接使用（而不是先判空）`);
    }
});

test('ZCSpawnSelection.prefab：12 个节点、四块结构、尺寸与相对几何按设计稿', () => {
    assert.equal(nodes.length, 12);
    const root = nodeNamed('ZCSpawnSelection')!;
    assert.deepEqual(childrenOf(root), ['SpawnInfoBand', 'ConfirmSpawn', 'ToggleHints', 'SpawnToast'],
        '子节点顺序 = 渲染顺序');
    assert.deepEqual(sizeOf(root), [720, 1280]);

    const band = nodeNamed('SpawnInfoBand', 'ZCSpawnSelection')!;
    assert.deepEqual(childrenOf(band), ['Hint', 'Clock', 'Progress']);
    assert.deepEqual(sizeOf(band), [DESIGN.band.w, DESIGN.band.h]);
    assert.deepEqual(positionOf(band), [0, 640 - DESIGN.band.top - DESIGN.band.h / 2], '顶栏静态落位（720×1280 根）');

    const progress = nodeNamed('Progress', 'SpawnInfoBand')!;
    assert.deepEqual(sizeOf(progress), [DESIGN.progress.w, DESIGN.progress.h]);
    assert.deepEqual(positionOf(progress), [DESIGN.progress.x, DESIGN.progress.y]);
    const fill = nodeNamed('ProgressFill', 'Progress')!;
    assert.deepEqual(sizeOf(fill), [DESIGN.fill.w, DESIGN.fill.h]);
    assert.deepEqual(positionOf(fill), [DESIGN.fill.x, DESIGN.fill.y]);

    assert.deepEqual(sizeOf(nodeNamed('Hint', 'SpawnInfoBand')!), [DESIGN.hint.w, DESIGN.hint.h]);
    assert.deepEqual(positionOf(nodeNamed('Hint', 'SpawnInfoBand')!), [0, DESIGN.hint.y]);
    assert.deepEqual(positionOf(nodeNamed('Clock', 'SpawnInfoBand')!), [0, DESIGN.clock.y]);

    const confirm = nodeNamed('ConfirmSpawn', 'ZCSpawnSelection')!;
    assert.deepEqual(sizeOf(confirm), [DESIGN.confirm.w, DESIGN.confirm.h]);
    assert.deepEqual(positionOf(confirm), [DESIGN.confirm.centerX, -640 + DESIGN.confirm.bottom + DESIGN.confirm.h / 2]);

    const toggle = nodeNamed('ToggleHints', 'ZCSpawnSelection')!;
    assert.deepEqual(childrenOf(toggle), ['Label', 'Arrow'], '箭头要压在按钮底上面');
    assert.deepEqual(sizeOf(toggle), [DESIGN.toggle.w, DESIGN.toggle.h]);
    assert.deepEqual(positionOf(toggle), [-360 + DESIGN.toggle.left + DESIGN.toggle.w / 2,
        -640 + DESIGN.toggle.bottom + DESIGN.toggle.h / 2]);
    assert.deepEqual(sizeOf(nodeNamed('Label', 'ToggleHints')!), [DESIGN.toggleLabel.w, DESIGN.toggleLabel.h]);
    assert.deepEqual(positionOf(nodeNamed('Label', 'ToggleHints')!), [DESIGN.toggleLabel.x, DESIGN.toggleLabel.y]);
    assert.deepEqual(sizeOf(nodeNamed('Arrow', 'ToggleHints')!), [DESIGN.arrow.w, DESIGN.arrow.h]);
    assert.deepEqual(positionOf(nodeNamed('Arrow', 'ToggleHints')!), [DESIGN.arrow.x, DESIGN.arrow.y]);

    assert.deepEqual(sizeOf(nodeNamed('SpawnToast', 'ZCSpawnSelection')!), [DESIGN.toast.w, DESIGN.toast.h]);
    assert.deepEqual(positionOf(nodeNamed('SpawnToast', 'ZCSpawnSelection')!), [0, 360]);
});

test('字号取自渲染图墨迹实测（设计稿 textLayer 没有 raw_style）', () => {
    assert.equal(labelOf(nodeNamed('Hint', 'SpawnInfoBand')!)._fontSize, DESIGN.hint.fontSize);
    assert.equal(labelOf(nodeNamed('Clock', 'SpawnInfoBand')!)._fontSize, DESIGN.clock.fontSize);
    assert.equal(labelOf(nodeNamed('Label', 'ToggleHints')!)._fontSize, DESIGN.toggleLabel.fontSize);
    for (const path of [['Hint', 'SpawnInfoBand'], ['Clock', 'SpawnInfoBand'], ['Label', 'ToggleHints']]) {
        const label = labelOf(nodeNamed(path[0], path[1])!);
        assert.equal(label._overflow, 2, 'SHRINK：定宽框里只缩字不折行');
        assert.equal(label._enableWrapText, false);
        assert.equal(label._horizontalAlign, 1);
        assert.equal(label._verticalAlign, 1);
    }
});

test('顶栏三行式：数字第一行居中 / 标题第二行略小 / 进度条 200×23（2026-10-17 线框图）', () => {
    const clock = nodeNamed('Clock', 'SpawnInfoBand')!;
    const hint = nodeNamed('Hint', 'SpawnInfoBand')!;
    const progress = nodeNamed('Progress', 'SpawnInfoBand')!;
    const clockLabel = labelOf(clock)!;
    const hintLabel = labelOf(hint)!;

    // ① 第一行 = 倒计时数字：三个子节点里 y 最大，且水平居中（x=0 + 锚点 0.5 + 居中对齐）
    const ys = [clock, hint, progress].map((node) => positionOf(node)[1]);
    assert.equal(Math.max(...ys), positionOf(clock)[1], '倒计时数字必须在第一行（最上）');
    assert.deepEqual(positionOf(clock), [0, DESIGN.clock.y], '数字水平居中（x = 0）');
    assert.equal(clockLabel._horizontalAlign, 1, '数字居中对齐');
    assert.ok(positionOf(clock)[1] > positionOf(hint)[1], '标题落在数字下方');
    assert.ok(positionOf(hint)[1] > positionOf(progress)[1], '进度条落在标题下方');

    // ② 文字比数字略小 —— 判**视觉高度**而不是字号：
    //    汉字满字高 ≈ 0.95em，阿拉伯数字只有大写高 ≈ 0.72em（无降部）。
    //    所以「数字 30 / 文字 28」实际是文字看着更大（28×0.95=26.6 > 30×0.72=21.6），
    //    屏幕上那个「7 比标题还小」就是这么来的；只比 fontSize 的判据拦不住这种错。
    //    现配比 48 : 25 ⇒ 34.56 : 23.75 ≈ 0.69（用户手定 25 号后从 0.82 再往下走了一档）。
    const visualClock = clockLabel._fontSize * 0.72;
    const visualHint = hintLabel._fontSize * 0.95;
    assert.ok(visualHint < visualClock, '文字的视觉高度必须小于数字');
    assert.ok(visualHint >= visualClock * 0.6, '「略小」不是砍半：文字视觉高度不低于数字的 60%');

    // ③ 三行都在 130 高的信息带内（不越界 / 不压边）
    const half = DESIGN.band.h / 2;
    assert.ok(positionOf(clock)[1] + clockLabel._lineHeight / 2 <= half, '数字行不得溢出带顶');
    assert.ok(positionOf(progress)[1] - DESIGN.progress.h / 2 >= -half, '进度条不得溢出带底');

    // ④ SHRINK 的几何闸门：框高 < 行高、或框宽装不下整句 ⇒ 引擎静默把字缩回去。
    //    旧版标题框 221 宽装不下 8 字 × 28 号，prefab 里 `_actualFontSize` 实测被压到 22 —— 调大字号等于白调。
    assert.ok(sizeOf(clock)[1] >= clockLabel._lineHeight, '数字框高必须 ≥ 行高，否则 SHRINK 会缩字');
    assert.ok(sizeOf(hint)[1] >= hintLabel._lineHeight, '标题框高必须 ≥ 行高，否则 SHRINK 会缩字');
    assert.ok(sizeOf(hint)[0] >= '选择己方主城位置'.length * hintLabel._fontSize,
        '标题框宽必须装得下 8 个字，否则 SHRINK 把字号压回旧值');

    // ⑤ 进度条：用户 2026-10-17 直接定尺寸，几版手调依次是 259×30（−35% / −5%）→ 230×23 → **200×23**，
    //    现以最后一版为准；下面留一条可复算的历史记录。填充 194×16 = 左右各留 3、上下各留 3.5。
    assert.equal(DESIGN.progress.w, 200);
    assert.equal(DESIGN.progress.h, 23);
    assert.equal(Math.round(PREV_PROGRESS.w * 0.65), 259, '历史值：−35% 那一版是 259');
    assert.equal(Math.round(PREV_PROGRESS.h * 0.95), 30, '历史值：−5% 那一版是 30');
    assert.deepEqual(sizeOf(progress), [DESIGN.progress.w, DESIGN.progress.h]);
    const fill = nodeNamed('ProgressFill', 'Progress')!;
    assert.deepEqual(sizeOf(fill), [DESIGN.fill.w, DESIGN.fill.h]);

    // ⑤′ 填充必须**整块落在条内**且四边留 2~6px（留白太小会盖住条的黑边、太大露底）：
    //     这条挡的是「改条尺寸忘了改填充」——那种错不报错，只是填充溢出/缩成一条线。
    const [bw, bh] = sizeOf(progress);
    const [fw, fh] = sizeOf(fill);
    const insetX = (bw - fw) / 2;
    const insetY = (bh - fh) / 2;
    assert.ok(fw < bw && fh < bh, '填充必须小于条（否则盖住黑边）');
    for (const [name, inset] of [['左右', insetX], ['上下', insetY]] as const) {
        assert.ok(inset >= 2 && inset <= 6, `${name}留白应在 2~6px，实测 ${inset}`);
    }

    // ⑥ 倒计时数字**加粗**（2026-10-17 用户口径），标题保持常规字重 ——
    //    两边都加粗会把「数字 / 标题」的层级抹平，所以这是一条成对判据。
    assert.equal(clockLabel._isBold, true, '倒计时数字必须加粗');
    assert.equal(hintLabel._isBold, false, '标题不加粗（否则与数字的层级被抹平）');
});

test('ZCSpawnSelection.prefab：Toast 出厂隐藏，layer 全 UI_2D，Widget 位掩码对得上', () => {
    assert.equal(nodeNamed('SpawnToast', 'ZCSpawnSelection')!._active, false, '吐司出厂必须隐藏');
    for (const node of nodes) {
        assert.equal(node._layer, 33554432, `${node._name} layer 必须是 UI_2D`);
    }
    // 位掩码 TOP1/MID2/BOT4/LEFT8/CENTER16/RIGHT32；根四边对齐 = 45。
    const rootWidget = widgetOf(nodeNamed('ZCSpawnSelection')!);
    assert.equal(rootWidget._alignFlags, 45);
    assert.deepEqual([rootWidget._left, rootWidget._right, rootWidget._top, rootWidget._bottom], [0, 0, 0, 0]);

    const bandWidget = widgetOf(nodeNamed('SpawnInfoBand', 'ZCSpawnSelection')!);
    assert.equal(bandWidget._alignFlags, 17, '信息带 = TOP + 水平居中');
    assert.equal(bandWidget._top, DESIGN.band.top);

    const confirmWidget = widgetOf(nodeNamed('ConfirmSpawn', 'ZCSpawnSelection')!);
    assert.equal(confirmWidget._alignFlags, 20, '绿勾 = BOT + 水平居中');
    assert.equal(confirmWidget._bottom, DESIGN.confirm.bottom);
    assert.equal(confirmWidget._horizontalCenter, DESIGN.confirm.centerX, '设计稿绿勾比屏心偏右 28');

    const toggleWidget = widgetOf(nodeNamed('ToggleHints', 'ZCSpawnSelection')!);
    assert.equal(toggleWidget._alignFlags, 12, '收回提示 = BOT + LEFT');
    assert.equal(toggleWidget._left, DESIGN.toggle.left);
    assert.equal(toggleWidget._bottom, DESIGN.toggle.bottom);
});

test('六张切图逐张指到 image/gameui 下的对应美术，且 sizeMode=CUSTOM + trim=false', () => {
    const expected: Record<string, string> = {
        'ZCSpawnSelection/SpawnInfoBand': 'bg_01',
        'ZCSpawnSelection/SpawnInfoBand/Progress': 'progress_b_02',
        'ZCSpawnSelection/SpawnInfoBand/Progress/ProgressFill': 'progress_b_01',
        'ZCSpawnSelection/ConfirmSpawn': 'btn_gou',
        'ZCSpawnSelection/ToggleHints': 'btn_01',
        'ZCSpawnSelection/ToggleHints/Arrow': 'jiantou_01',
    };
    const find = (path: string) => {
        const [name, parent] = path.split('/').reverse();
        return nodeNamed(name, parent)!;
    };
    for (const [path, art] of Object.entries(expected)) {
        const node = find(path);
        assert.ok(node, `${path} 不存在`);
        const sprite = spriteOf(node);
        assert.ok(sprite, `${path} 上应当有 cc.Sprite`);
        assert.equal(sprite._spriteFrame.__uuid__, frameOf(art), `${path} 的图应当是 ${art}.png`);
        // 定尺寸的 UI 图：默认 TRIMMED 会用贴图裁框改写节点尺寸（技能 §1 的「改尺寸没反应」）
        assert.equal(sprite._sizeMode, 0, `${path} sizeMode 必须 CUSTOM`);
        assert.equal(sprite._isTrimmedMode, false, `${path} 必须关掉裁剪模式`);
    }
    // 进度填充用 FILLED + HORIZONTAL：只改 fillRange，贴图与圆角都不被拉伸
    const fillSprite = spriteOf(nodeNamed('ProgressFill', 'Progress')!);
    assert.equal(fillSprite._type, 3, 'ProgressFill 必须是 FILLED');
    assert.equal(fillSprite._fillType, 0, 'FILLED 的 fillType 必须是 HORIZONTAL');
    assert.equal(fillSprite._fillStart, 0);
    // 全篇只允许一个 FILLED（其余都是 SIMPLE）
    assert.equal(objects.filter((o) => o.__type__ === 'cc.Sprite' && o._type === 3).length, 1);
    // 空对象形态的 spriteFrame 会让引擎抛 uv[0] 读 undefined（技能 §0 铁律 3）
    assert.doesNotMatch(prefabText, /"_spriteFrame":\s*\{\s*\}/);
    assert.equal(objects.filter((o) => o.__type__ === 'cc.Sprite' && !o._spriteFrame?.__uuid__).length, 0);
});

test('prefab 的 prefabInfo / fileId 形态正确（手改 JSON 最容易崩的两处）', () => {
    const rootIndex = objects[0].data.__id__;
    assert.equal(objects[rootIndex].__type__, 'cc.Node');
    assert.equal(rootIndex, objects.findIndex((o) => o?.__type__ === 'cc.Node'), '根必须是第一个 cc.Node');
    const fileIds = objects.filter((o) => typeof o?.fileId === 'string').map((o) => o.fileId);
    for (const id of fileIds) assert.equal(id.length, 22, `fileId 必须 22 位：${id}`);
    assert.equal(new Set(fileIds).size, fileIds.length, 'fileId 不许重复');
    for (const node of nodes) {
        const info = objects[node._prefab.__id__];
        assert.equal(info.asset.__id__, 0, `${node._name} 的 PrefabInfo.asset 必须指本 prefab`);
        assert.equal(info.root.__id__, rootIndex);
    }
});

test('prefab 上 12 个 @property 全部绑到正确类型的对象', () => {
    const cid = cidOf(viewMeta.uuid);
    assert.equal(cid, 'b4482r88UpOjZZJQIWKostE', 'cid 必须与生成脚本里写的那个一致');
    const script = objects.find((o) => o.__type__ === cid);
    assert.ok(script, `prefab 里应当挂 ${cid}（ZCSpawnSelectionView）`);

    const expected: Record<string, string> = {
        hintLabel: 'cc.Label',
        clockLabel: 'cc.Label',
        progressNode: 'cc.Node',
        progressFill: 'cc.Sprite',
        confirmButton: 'cc.Node',
        confirmIcon: 'cc.Sprite',
        toggleButton: 'cc.Node',
        toggleLabel: 'cc.Label',
        toggleArrow: 'cc.Node',
        toastNode: 'cc.Node',
        toastBackground: 'cc.Graphics',
        toastLabel: 'cc.Label',
    };
    for (const [prop, type] of Object.entries(expected)) {
        const ref = script[prop];
        assert.ok(ref && typeof ref.__id__ === 'number', `${prop} 未绑定`);
        assert.equal(objects[ref.__id__].__type__, type, `${prop} 应指向 ${type}`);
    }
    // 「按钮与它的底同节点」是这组引用的硬约束（隐藏/染色针对的是那一块）。
    // ⚠️ 引用有两种形态：`cc.Node` 就是节点本身，组件要看 `.node`（规则 105）。
    const ownerNodeId = (id: number) => {
        const target = objects[id];
        return target.__type__ === 'cc.Node' ? id : target.node.__id__;
    };
    const sameNode = (a: string, b: string) => ownerNodeId(script[a].__id__) === ownerNodeId(script[b].__id__);
    assert.ok(sameNode('confirmButton', 'confirmIcon'), 'confirmButton 与 confirmIcon 必须同节点');
    assert.ok(sameNode('toastNode', 'toastBackground'), 'toastNode 与 toastBackground 必须同节点');
    // 进度填充在进度节点**下**：隐藏整条时填充要跟着走。
    const fillOwner = objects[script.progressFill.__id__].node.__id__;
    assert.equal(objects[fillOwner]._name, 'ProgressFill');
    assert.equal(objects[fillOwner]._parent.__id__, script.progressNode.__id__, 'progressFill 必须挂在 progressNode 下');
    // 箭头在收回提示按钮**下**（`toggleButton` 控制点击，箭头只做方向）。
    const arrowOwner = objects[script.toggleArrow.__id__]._parent.__id__;
    assert.equal(arrowOwner, script.toggleButton.__id__);
    // 吐司的 Label 在子节点上（`toastNode` 控制整块显隐，`toastLabel` 只写文案）。
    const toastLabelOwner = objects[script.toastLabel.__id__].node.__id__;
    assert.equal(objects[toastLabelOwner]._parent.__id__, script.toastNode.__id__);
});

test('两态口径：文案只有两条、等待态收掉倒计时/进度/绿勾、标题回到居中', () => {
    const code = stripComments(viewSource);
    // 设计稿只给了两条文案 —— 不许再冒出「已确认 · 等待对方」这类第三条。
    assert.match(code, /waiting: '等待其他玩家'/);
    assert.match(code, /picking: '选择己方主城位置'/);
    assert.doesNotMatch(code, /已确认|对方已锁定|最后 3 秒/, '文案只照设计稿的两条');
    assert.match(code, /SPAWN_HINT_PICKING_Y = -9/, '选择态标题落在三行式的第二行（数字 +35 / 标题 -9 / 进度条 -46）');
    assert.match(code, /SPAWN_HINT_CENTER_Y = 0/, '等待态只剩一行 ⇒ 垂直居中（设计稿「落点选择2」）');
    assert.doesNotMatch(code, /SPAWN_HINT_OFFSET_Y/, '顶栏改成三行式后旧常量名（上部 +35.5）必须删干净');
    // 等待态 = 已确认；三处显隐必须成对（规则：显隐要成对复位，否则复用到下一局会残留）
    assert.match(code, /const waiting = mine\.confirmedHexId !== null/);
    for (const key of ['clockLabel.node', 'progressNode', 'confirmButton']) {
        assert.match(code, new RegExp(`this\\.${key.replace('.', '\\.')}\\.active = !waiting`), `${key} 等待态必须隐藏`);
    }
    // 进度按剩余时间归一化，且只写 fillRange（几何归 prefab）
    assert.match(code, /this\.progressFill\.fillRange = Math\.max\(0, Math\.min\(1, ratio\)\)/);
    assert.match(code, /const ratio = snapshot\.remainingSeconds \/ COUNTDOWN_SECONDS/);
    // 箭头方向：收起朝上（设计稿 ∧），显示提示翻转
    assert.match(code, /this\.toggleArrow\.setRotationFromEuler\(0, 0, hintsVisible \? 0 : 180\)/);
});

test('自选主城 HUD 走实例化路径，并进了对局预加载清单', () => {
    const game = stripComments(gameSource);
    //  preload 改造后 prefab 由 `ZCGamePreparedResources` 带进来（`prepared.spawnSelectionPrefab`），
    //  `this.cachedSpawnSelectionPrefab` 那套缓存字段已经删了 ⇒ 断言同步到新写法（口径不变：必须实例化、禁运行时挂脚本）。
    assert.match(game, /instantiate\(prepared\.spawnSelectionPrefab\)/, '必须实例化 prefab');
    assert.doesNotMatch(game, /addComponent\(ZCSpawnSelectionView\)/, '不再运行时挂脚本');
    assert.match(game, /getComponent\(ZCSpawnSelectionView\)!/, '取组件失败应当场抛');

    assert.match(loaderSource, /const SPAWN_SELECTION_URL = 'ui\/game\/ZCSpawnSelection'/);
    assert.match(loaderSource, /this\.assets\.load\(SPAWN_SELECTION_URL, Prefab/);
    assert.match(loaderSource, /spawnSelectionPrefab: Prefab;/);
});


test('选点展示计时走 scheduleOnce，不许在 update 里拿 dt 累加（2026-10-16）', () => {
    // 「全部确认后停留 1 秒展示主城落点」原先写在 `update` 里 `spawnShowcaseLeft -= dt`：
    // 手写倒计时在低帧率下会被拉长，而且把"还要等多久"藏进逐帧状态里。
    // 口径 = 计时交给引擎调度器（同 `ZCGameHUDView` 的金币栏闪烁、`ZCSpawnSelectionView` 的吐司）。
    const game = stripComments(gameSource);
    assert.match(game, /this\.scheduleOnce\(this\.finishSpawnSelection, SPAWN_SHOWCASE_SECONDS\)/,
        '展示计时必须是 scheduleOnce 排的');
    assert.match(game, /private scheduleSpawnShowcase\(\): void \{\s*if \(this\.spawnShowcaseScheduled\) return;/,
        '逐帧检测会反复命中"已完成" ⇒ 必须有幂等标记，否则每帧重排、永远不到期');
    assert.match(game, /private cancelSpawnShowcase\(\): void \{\s*this\.spawnShowcaseScheduled = false;\s*this\.unschedule\(this\.finishSpawnSelection\);/,
        '进战斗 / 拆对局都要撤定时器');
    assert.match(game, /if \(this\.spawnSelection\.snapshot\.finished\) this\.scheduleSpawnShowcase\(\);/,
        'update 只负责检测"已完成"，计时另计');
    assert.doesNotMatch(game, /spawnShowcaseLeft/, '旧的 dt 累加字段必须删干净');
    assert.doesNotMatch(game, /spawnShowcaseLeft -= dt/, '不许再出现 dt 累加式倒计时');
});


test('选点的两个意图走事件派发（视图 emit + 控制器订阅），不再传回调（2026-10-16）', () => {
    const view = stripComments(viewSource);
    const game = stripComments(gameSource);
    // 视图侧：监听是「具名方法 + this target」（规范 §7.5 配套第 3 条），意图在**根节点** emit。
    // 旧写法 `this.confirmButton.on(TOUCH_END, () => this.actions?.confirm(), this)` 既内联箭头
    // 又持有上层回调 —— 两个问题一起消掉。
    assert.match(view, /this\.toggleButton\.on\(Node\.EventType\.TOUCH_END, this\.onToggleHintsClick, this\)/);
    assert.match(view, /this\.confirmButton\.on\(Node\.EventType\.TOUCH_END, this\.onConfirmClick, this\)/);
    // 视图侧：不再持有总线（也不自己 new），意图直接交给全局中控。
    assert.doesNotMatch(view, /EventBus/, '视图不该再持有总线实例');
    assert.match(view, /initialize\(\): void \{/);
    assert.match(view, /private onConfirmClick\(\): void \{\s*EventMgr\.instance\.emit\(ZCGameUiEvent\.SpawnConfirm\);/);
    assert.match(view, /private onToggleHintsClick\(\): void \{\s*EventMgr\.instance\.emit\(ZCGameUiEvent\.SpawnToggleHints\);/);
    assert.ok(!/IZCSpawnSelectionActions/.test(view), '视图不该再有回调契约');
    assert.ok(!/TOUCH_END, \(\) =>/.test(view), '按钮监听不许再用内联箭头闭包');
    // 控制器侧：两个意图都要订阅上（少一个就是那个按钮点了没反应、且零报错）。
    assert.match(game, /this\.spawnSelectionView\.initialize\(\);/);
    for (const [event, handler] of [['SpawnConfirm', 'onSpawnConfirm'], ['SpawnToggleHints', 'onSpawnToggleHints']] as const) {
        assert.ok(
            new RegExp(`EventMgr\\.instance\\.on\\(ZCGameUiEvent\\.${event}, this\\.${handler}, this\\)`).test(game),
            `★ZCGame 必须订阅 ZCGameUiEvent.${event} → ${handler}`,
        );
    }
    assert.match(game, /private onSpawnConfirm\(\): void \{\s*this\.confirmSpawnSelection\(\);/);
    assert.match(game, /private onSpawnToggleHints\(\): void \{\s*this\.spawnHintsVisible = !this\.spawnHintsVisible;\s*this\.renderSpawnSelection\(\);/);
});
