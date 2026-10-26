import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 自选地图局：中立资源格不许暴露"是什么"，一律盖问号（`image/gameui/whh`）。
 *
 * 需求（2026-10-23 山猫）：*「自选的时候，中立资源，使用这个图标，不让玩家看到箱子是什么，
 * 因为中立资源是进游戏根据随机」*。
 *
 * 现状链路：`ZCGameRenderWorld` 早就有开关
 * `hideNeutralResourceLabel: mapConfig.cityMode === 'select'`，但它的实现是**把图标也一起藏掉**
 * （`neutralResourceId && !hideNeutralResourceLabel && … ? frameForResource() : null`）⇒
 * 自选局里那些资源格看起来就是普通空地。本次把"藏掉"改成"盖问号"。
 *
 * 首版曾错误地把 `whh` 用在 HUD 底部神器按钮上（那是玩家自己的神器、不该遮蔽），已回退，
 * 反向守卫在 `zcds-hud-artifact-icon.test.ts` 里。
 */

const read = (path: string): string => readFileSync(path, 'utf8');
/** 剥注释再断言（规则 104）：注释里抄的旧表达式不该被当成实现。 */
const stripComments = (source: string): string => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const UNKNOWN_ART = 'assets/resources/image/gameui/whh.png';

test('占位图入库 + 资源名单一出口（`whh`）', () => {
    assert.ok(existsSync(UNKNOWN_ART), `占位图必须入库：${UNKNOWN_ART}`);
    const art = read('assets/script/app/ArtPaths.ts');
    assert.match(art, /NEUTRAL_RESOURCE_UNKNOWN_ICON_NAME\s*=\s*'whh'/,
        '资源名要有单一出口（ArtPaths），别在 loader / 视图里硬写字符串');
    // 反向守卫：不许留着"神器按钮占位"那个旧名字（首版改错的痕迹）。
    assert.ok(!/ARTIFACT_UNKNOWN_ICON_NAME/.test(art),
        '旧的 `ARTIFACT_UNKNOWN_ICON_NAME` 必须改名 —— 它遮蔽的对象是中立资源，不是 HUD 神器按钮');
});

test('loader 预加载 + 进 prepared（视图里不许直调 resources.load）', () => {
    const loader = read('assets/script/app/zcds/application/ZCGameLoader.ts');
    assert.match(loader, /loadUnknownResourceFrame\s*\(scope\?: ResourceScope\)/);
    assert.match(loader, /spriteFramePath\(GAMEUI_ART_ROOT,\s*NEUTRAL_RESOURCE_UNKNOWN_ICON_NAME\)/,
        '路径必须由 ArtPaths 常量拼');
    assert.equal((loader.match(/unknownResourceFrame,/g) ?? []).length, 2,
        'prepared 的解构 + return 两处都要带上 unknownResourceFrame');
    assert.match(loader, /this\.loadUnknownResourceFrame\(scope\)/,
        '必须挂在 prepare 的 Promise.all 里（否则首屏没有这张图）');
});

test('接线：ZCGame → renderWorld options → 每个地块视图', () => {
    const game = stripComments(read('assets/script/app/zcds/ZCGame.ts'));
    assert.match(game, /unknownResourceFrame:\s*prepared\.unknownResourceFrame/,
        'ZCGame 要把占位图交给渲染层');

    const world = stripComments(read('assets/script/app/zcds/view/ZCGameRenderWorld.ts'));
    assert.match(world, /unknownResourceFrame\?:\s*SpriteFrame\s*\|\s*null/,
        'renderWorld options 要声明这个字段（缺省 = 退回旧表现）');
    assert.match(world, /view\.setUnknownResourceFrame\(this\.options\.unknownResourceFrame \?\? null\)/,
        '建地块视图时必须逐个注入（地块是池化复用的，注入一次覆盖不到池里其它实例）');
});

test('ZCHexView.renderSpawnSelection：选点阶段的中立资源格一律返回问号帧', () => {
    const hex = stripComments(read('assets/script/app/zcds/view/ZCHexView.ts'));
    // ① 注入入口要作废 contentKey（帧晚到时格子已经渲染过，不作废就一直空着）。
    assert.match(hex, /setUnknownResourceFrame\(frame: SpriteFrame \| null\)/);
    assert.match(hex, /setUnknownResourceFrame\(frame: SpriteFrame \| null\): void \{[\s\S]{0,160}?this\.contentKey = '';/,
        '注入后必须作废 contentKey');

    // ② 遮蔽只落在**选点渲染**这一段（`renderSpawnSelection`），不是整个对局。
    const start = hex.indexOf('renderSpawnSelection(presentation: Readonly<IZCSpawnHexPresentation>)');
    const end = hex.indexOf('private frameForSpawnResource');
    assert.ok(start > 0 && end > start, '没读到 renderSpawnSelection');
    const body = hex.slice(start, end);
    assert.match(body, /const visual = neutralResourceVisualOf\(presentation\.resourceItemId\);/,
        '选点阶段的表现键由资源项 id 查表得出（别再把 id 当字符串用）');
    assert.match(body, /const maskResource = presentation\.resourcePoint && !!visual\s*&&\s*!!this\.unknownResourceFrame/,
        '遮蔽判据 = 有资源点 + 有占位图');
    assert.match(body, /maskResource\s*\? this\.unknownResourceFrame/,
        '遮蔽时要返回问号帧，不能返回具体资源图');
    // ③ 兵力资源点（骨骼）也要一起遮 —— 骨骼本身就是"这格是兵力"的剧透。
    assert.match(body, /const unitPoint = !maskResource && presentation\.resourcePoint/,
        '遮蔽时不许再摆兵力待机骨骼');

    // ④ 反向守卫：正式对局那段（`renderContent`）**不许**跟着遮蔽 ——
    //    那里的 `hideNeutralResourceLabel` 是 select 局全隐藏的既有口径，改它等于改整局表现。
    assert.ok(!/maskResource/.test(hex.replace(body, '')),
        'maskResource 只许出现在 renderSpawnSelection，不许扩散到 renderContent');
});

test('占位图的体量：乘一个修正系数压回和资源图一致（否则问号大一圈）', () => {
    const hex = stripComments(read('assets/script/app/zcds/view/ZCHexView.ts'));
    assert.match(hex, /const UNKNOWN_RESOURCE_ICON_RATIO = 0\.7;/,
        '占位图（118×138，内容几乎占满）与资源图（212×212，内容约 67%）同一归一系数会大一圈');
    assert.match(hex, /resourceFrame === this\.unknownResourceFrame[\s\S]{0,80}?base \* UNKNOWN_RESOURCE_ICON_RATIO/,
        '缩放要乘在 resourceIconScale 的结果上，别去改那个公共纯函数');
});

test('遮蔽开关的唯一来源：`cityMode === select`（自选主城局）', () => {
    const world = stripComments(read('assets/script/app/zcds/view/ZCGameRenderWorld.ts'));
    const hits = world.match(/hideNeutralResourceLabel:\s*frame\.mapConfig\.cityMode === 'select'/g) ?? [];
    assert.equal(hits.length, 1, `自选判据只许一处（现有 ${hits.length} 处）—— 两处会漂移`);
    // 文字兜底也必须一起吃这个开关：自选局不许写出「宝箱 / 金矿」这类中文。
    const hex = stripComments(read('assets/script/app/zcds/view/ZCHexView.ts'));
    assert.ok(/resourceVisual && !hideNeutralResourceLabel && !resourceFrame/.test(hex),
        '文字兜底那条仍要保留 `!hideNeutralResourceLabel`（遮蔽时不许写资源名）');
});
