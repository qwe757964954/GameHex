/**
 * 主界面顶栏（`ui/main/ArenaRoot.prefab` 的 `TopHud`）的三个几何不变量。
 *
 * 2026-10-19 用户拿美术图对照后提了三条（原话）：
 *  1. 「战力图标被战力数字条遮挡」；
 *  2. 「战力数字大小和背景条没有按美术图的大小匹配」；
 *  3. 「银币资源栏和体力资源栏没有按美术图的做右对齐」。
 *
 * 这三条都属于「不报错、只是看着不对」的问题，所以用**几何关系**钉死，而不是钉像素值
 * （美术微调位置时不会因为挪了 2px 就红）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const PREFAB_PATH = 'assets/resources/ui/main/ArenaRoot.prefab';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

interface Rect {
    readonly left: number;
    readonly right: number;
    readonly width: number;
}

const loadPrefab = (): Raw[] => JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as Raw[];

function findNode(objects: Raw[], name: string): Raw {
    const node = objects.find((item) => item.__type__ === 'cc.Node' && item._name === name);
    assert.ok(node, `prefab 里找不到节点 ${name}`);
    return node as Raw;
}

function componentOf(objects: Raw[], node: Raw, type: string): Raw | null {
    for (const ref of node._components ?? []) {
        const component = objects[ref.__id__];
        if (component.__type__ === type) return component;
    }
    return null;
}

/** 节点在父节点坐标系里的横向占位（anchor 以左为 0、中心 0.5 折算）。 */
function horizontalRect(objects: Raw[], name: string): Rect {
    const node = findNode(objects, name);
    const transform = componentOf(objects, node, 'cc.UITransform');
    assert.ok(transform, `${name} 没有 UITransform`);
    const width = transform._contentSize.width as number;
    const anchorX = transform._anchorPoint.x as number;
    const left = (node._lpos.x as number) - width * anchorX;
    return { left, right: left + width, width };
}

test('战力图标必须画在战力底条**之上**（不许被底条盖住）', () => {
    const objects = loadPrefab();
    const top = findNode(objects, 'TopHud');
    const order: string[] = (top._children ?? []).map((ref: { __id__: number }) => objects[ref.__id__]._name);
    const indexOf = (name: string): number => {
        const index = order.indexOf(name);
        assert.ok(index >= 0, `TopHud 下找不到 ${name}`);
        return index;
    };
    // 🔴 Cocos 里**后绘者在上**：底条要排在图标前面。
    assert.ok(indexOf('PowerBg') < indexOf('PowerIcon'),
        'PowerBg 必须排在 PowerIcon 之前（顺序反了就是「图标被底条遮挡」）');
    assert.ok(indexOf('PowerIcon') < indexOf('PowerLabel'),
        '数字要压在图标之上（美术图里数字盖住拳头的右半边）');
});

test('战力数字与图标不重叠，且底条刚好包住「拳头 + 数字」', () => {
    const objects = loadPrefab();
    const icon = horizontalRect(objects, 'PowerIcon');
    const label = horizontalRect(objects, 'PowerLabel');
    const bg = horizontalRect(objects, 'PowerBg');

    assert.ok(label.left >= icon.right - 0.5,
        `数字左缘(${label.left}) 必须落在图标右缘(${icon.right}) 之后，否则会压住拳头`);
    assert.ok(bg.left <= icon.left + 0.5, `底条左缘(${bg.left}) 要包住图标左缘(${icon.left})`);

    const labelComponent = componentOf(objects, findNode(objects, 'PowerLabel'), 'cc.Label');
    assert.ok(labelComponent, 'PowerLabel 上没有 cc.Label');
    // 文本宽按「字符数 × 字号 × 0.6」估算（数字/大写/点号的保守上界，够用来判「底条包不包得住」）。
    const text = String(labelComponent!._string ?? '');
    const fontSize = labelComponent!._fontSize as number;
    const textWidth = text.length * fontSize * 0.6;
    assert.ok(bg.right >= label.left + textWidth,
        `底条右缘(${bg.right}) 要包住数字（起点 ${label.left} + 估算宽 ${textWidth.toFixed(1)}）`);
    // 「背景条没有按美术图匹配」的另一半：底条不许比内容宽出一大截（右侧留白 ≤ 16）。
    const contentRight = label.left + textWidth;
    assert.ok(bg.right - contentRight <= 16,
        `底条右缘(${bg.right}) 相对数字右缘(${contentRight.toFixed(1)}) 的留白不应超过 16 —— 太宽就是「空一截」`);
    assert.equal(labelComponent!._overflow, 0, '战力数字要用 NONE（按文本自然宽排版），不许 SHRINK');
    assert.equal(labelComponent!._horizontalAlign, 0, '战力数字要左对齐（跟在拳头后面）');
    assert.ok(fontSize >= 22,
        `战力数字字号不小于 22（美术图里与昵称同级），实际 ${fontSize}`);
});

test('银币 / 体力两格必须右对齐到按钮条右缘', () => {
    const objects = loadPrefab();
    const entry = horizontalRect(objects, 'EntryBar');
    const gold = horizontalRect(objects, 'CoinGold');
    const gem = horizontalRect(objects, 'CoinGem');

    // 最右一格（CoinGem）的右缘贴住按钮条右缘 —— 这就是「右对齐」。
    assert.ok(Math.abs(gem.right - entry.right) < 0.5,
        `体力栏右缘(${gem.right}) 应等于按钮条右缘(${entry.right})`);
    // 两格之间等间距（判定：银币右缘 + GAP == 体力左缘）。
    assert.ok(gold.right <= gem.left + 0.5, '银币栏不能压到体力栏上');
    assert.ok(gem.left - gold.right <= 16,
        `两格间距 ${(gem.left - gold.right).toFixed(1)} 太大，美术图里是紧挨着的一排`);
    // 银币栏要排在体力栏左边（美术图顺序：先银币后体力）。
    assert.ok(gold.left < gem.left, '银币栏应在体力栏左侧');
});

/**
 * 两处「按美术图做文字样式」的判据（2026-10-19 用户口径）：
 *  1. 【快速寻敌】按钮文案要白字 + 加粗 + 深色描边 + 更大字号；
 *  2. 左侧征收图标的倒计时要是**黄色加粗 + 描边**，字号与美术对得上（且不许被压成一条）。
 */
test('快速寻敌：白字 + 加粗 + 描边 + 字号放大', () => {
    const objects = loadPrefab();
    const button = findNode(objects, 'BeginGame');
    const buttonSprite = componentOf(objects, button, 'cc.Sprite');
    assert.ok(buttonSprite, 'BeginGame 上没有快速寻敌底图');
    const artUuid = (JSON.parse(readFileSync('assets/resources/image/main/city/btn_quick_fight.png.meta', 'utf8')) as { uuid: string }).uuid;
    assert.equal(buttonSprite!._spriteFrame?.__uuid__, `${artUuid}@f9941`,
        '快速寻敌要用蓝湖稿的橙金放射按钮底图');
    const buttonTransform = componentOf(objects, button, 'cc.UITransform');
    assert.ok(buttonTransform, 'BeginGame 没有 UITransform');
    assert.ok(buttonTransform!._contentSize.width >= 260 && buttonTransform!._contentSize.width <= 290,
        `按钮宽度应贴近蓝湖稿，实际 ${buttonTransform!._contentSize.width}`);
    assert.ok(buttonTransform!._contentSize.height >= 100 && buttonTransform!._contentSize.height <= 125,
        `按钮高度应贴近蓝湖稿，实际 ${buttonTransform!._contentSize.height}`);
    assert.equal(button._lpos.x, 0, '快速寻敌按钮应居中于地图 HUD');
    const label = componentOf(objects, findNode(objects, 'LoginLab'), 'cc.Label');
    assert.ok(label, 'LoginLab 上没有 cc.Label');
    const fill = label!._color as { r: number; g: number; b: number };
    assert.deepEqual([fill.r, fill.g, fill.b], [255, 255, 255], '按钮文案必须是纯白（美术图取色）');
    assert.equal(label!._isBold, true, '按钮文案要加粗');
    assert.equal(label!._enableOutline, true, '按钮文案要开描边');
    assert.ok((label!._outlineWidth as number) >= 2,
        `描边宽度至少 2，实际 ${label!._outlineWidth}`);
    const outline = label!._outlineColor as { r: number; g: number; b: number };
    // 描边要比填充暗得多（深棕），否则等于没描。
    assert.ok(outline.r + outline.g + outline.b < 300,
        `描边色应是深色，实际 rgb(${outline.r},${outline.g},${outline.b})`);
    assert.ok((label!._fontSize as number) >= 46,
        `字号要贴近美术（≥46），实际 ${label!._fontSize}`);
});

test('征收倒计时：黄色 + 加粗 + 描边，且节点宽度放得下 8 个字', () => {
    const objects = loadPrefab();
    const label = componentOf(objects, findNode(objects, 'HangTime'), 'cc.Label');
    assert.ok(label, 'HangTime 上没有 cc.Label');
    const fill = label!._color as { r: number; g: number; b: number };
    // 美术取色 ≈ (234,195,37) 的黄金色：红高、绿中、蓝很低。
    assert.ok(fill.r >= 210 && fill.g >= 170 && fill.b <= 80,
        `倒计时要走黄色，实际 rgb(${fill.r},${fill.g},${fill.b})`);
    assert.equal(label!._isBold, true, '倒计时要加粗');
    assert.equal(label!._enableOutline, true, '倒计时要开描边');
    assert.ok((label!._fontSize as number) >= 20,
        `倒计时字号至少 20，实际 ${label!._fontSize}`);
    // 8 个字符（00:00:01）要放得下：窄节点 + SHRINK 会把字压成一条，这里按几何兜住。
    const rect = horizontalRect(objects, 'HangTime');
    const textWidth = 8 * (label!._fontSize as number) * 0.5;
    assert.ok(rect.width >= textWidth,
        `倒计时节点宽 ${rect.width} 放不下 8 个字（估算 ${textWidth}）`);
});
