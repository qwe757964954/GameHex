import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ZCBattlePresentationQueue, ZC_SKILL_ANNOUNCE_HOLD_SECONDS, ZC_SKILL_ANNOUNCE_SECONDS } from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';
import { ZCGameModel, stripSkillVariantSuffix } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig, type ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import {
    parseZCModifierCatalogs,
    type ZCCompiledModifierLoadout,
} from '../assets/script/app/zcds/model/ZCModifierRuntime';
import type { ZCCombatEvent, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZC_EFFECT_BEHAVIOR_KEYS } from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { assetPath } from './helpers/asset-paths';
import { loadViews } from './helpers/zcds-view-fixtures';
import {
    isZCActiveSkillCast,
    zcAnnounceActiveNames,
    zcAnnounceSkillNameIndex,
    zcIsAnnounceSkillKind,
    zcSkillAnnounceSlotCenterY,
    zcSkillAnnounceAnimationOf,
    zcSkillAnnounceArtWidth,
    zcSkillAnnounceGlowScale,
    zcSkillAnnounceOpacity,
    zcSkillAnnouncePopScale,
    zcSkillAnnounceProgress,
    ZC_SKILL_ANNOUNCE_ART_HEIGHT,
    ZC_SKILL_ANNOUNCE_BLOCK_HEIGHT,
    ZC_SKILL_ANNOUNCE_FADE_RATIO,
    ZC_SKILL_ANNOUNCE_FALLBACK_SECONDS,
    ZC_SKILL_ANNOUNCE_NAME_GAP,
    ZC_SKILL_ANNOUNCE_NAME_SIZE,
    ZC_SKILL_ANNOUNCE_OUTLINE_WIDTH,
    ZC_SKILL_ANNOUNCE_POP_FROM,
    ZC_SKILL_ANNOUNCE_SPINE_SCALE,
    ZC_SKILL_ANNOUNCE_STACK_GAP,
    ZC_SKILL_ANNOUNCE_STACK_MAX,
} from '../assets/script/app/zcds/model/ZCSkillAnnounceStyle';

/**
 * 传说卡首次放大招的通报（2026-11-25 需求）。
 *
 * 需求原文：「战斗中，玩家方的橙色品质的卡首次释放任意的主动技能时播放通报特效。
 * 在特效上叠加卡牌的形象图片（图片的目录在 cardhead），伴随特效出来的还有技能名字，
 * 在形象的下方，使用白色粗体字 + 黑色描边 2px，整个特效的比例贴近参考图」。
 *
 * 五层各自守一件事：
 *  ① 施法判据与战斗音效**同源**（同一套「真正施法那一拍」的四个门）；
 *  ② 一张卡一局只通报一次，记账在模型里（不是视图）；
 *  ③ 队列只收干净数据，坏坐标不许变成跨局幽灵节点；
 *  ④ 视图的比例 / 描边 / 透明度曲线与参考图口径一致；
 *  ⑤ 底光是可选增强：缺资源时「形象 + 名字」照常播。
 *
 * 2026-11-25 用户报「新加的橙色卡牌播放立绘动画没有展示」后补了两层：
 *  ⑥ 行为车道技（`fire_zone` / `trap_place` / `blink_strike`，基表 `pvpSkill` 里没有行）
 *     改在**车道回调返回成功**那一拍通报，名字取构筑期冻结的 `pvpSkillPlan.skillName`；
 *  ⑦ 上面这些在**真模型**上跑一遍（真表 → 真卡池 → 真队列），不只靠源码正则。
 *  ⑧ 美术交付物那份 prefab 与代码里的坐标 / 字号 / 描边逐项同值（prefab 不进运行时，
 *     只能靠用例对齐；漂了的表现是「图看着对、实机歪一截」，不会有任何报错）。
 *
 * 视图侧（`ZCSkillAnnounceFx`）依赖 `cc`，node 里 import 不进来 ⇒ 那部分走源码守卫；
 * 数值与曲线拆在 `ZCSkillAnnounceStyle`（零 `cc`），可以真跑。
 */

const ROOT = join(__dirname, '..');
const MODEL_SOURCE = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCGameModel.ts'), 'utf8');
const QUEUE_SOURCE = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCBattlePresentationQueue.ts'), 'utf8');
const WORLD_SOURCE = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCGameRenderWorld.ts'), 'utf8');
const FX_SOURCE = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCSkillAnnounceFx.ts'), 'utf8');
const GAME_SOURCE = readFileSync(join(ROOT, 'assets/script/app/zcds/ZCGame.ts'), 'utf8');
const PLAN_SOURCE = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCGameResourcePlan.ts'), 'utf8');

/* ------------------------------------------------------------------ ① 判据 */

test('① 施法判据必须与战斗音效同源：四个门一个都不能少', () => {
    const modelStart = MODEL_SOURCE.indexOf('private isActiveSkillCast(');
    assert.ok(modelStart > 0, 'ZCGameModel 必须保留 isActiveSkillCast');
    assert.match(MODEL_SOURCE.slice(modelStart, modelStart + 300), /isZCActiveSkillCast\(/,
        'ZCGameModel.isActiveSkillCast 必须复用共享判据 isZCActiveSkillCast');
    const audioSource = readFileSync('assets/script/app/zcds/application/ZCBattleAudio.ts', 'utf8');
    assert.match(audioSource, /isZCActiveSkillCast\(/,
        'ZCBattleAudio.clipOf 必须复用共享判据 isZCActiveSkillCast');

    const src = { attackSkillId: 100, activeSkillIds: [200] };
    assert.equal(isZCActiveSkillCast({ type: 'projectile', skillId: 200, beamHold: true }, src), false, '定格光束不是施法');
    assert.equal(isZCActiveSkillCast({ type: 'area', skillId: 200, effectKey: 'hit', damage: 50 }, src), false, '命中余韵不是施法');
    assert.equal(isZCActiveSkillCast({ type: 'projectile', skillId: 100, empowered: true }, src), true, '武将技直接算');
    assert.equal(isZCActiveSkillCast({ type: 'projectile', skillId: 100 }, src), false, '普攻行必须被排除');
    assert.equal(isZCActiveSkillCast({ type: 'projectile', skillId: 999 }, src), false, '非主动技能行排除');
    assert.equal(isZCActiveSkillCast({ type: 'area', skillId: 200, damage: 0 }, src), false, '0 伤害地面表现排除');
    assert.equal(isZCActiveSkillCast({ type: 'area', skillId: 200, damage: 12 }, src), true, '有伤害主动技能通过');
});

test('① 技能名取技能表真名，不取「普攻名·强化」这类变体后缀', () => {
    assert.equal(stripSkillVariantSuffix('天降神拳'), '天降神拳');
    assert.equal(stripSkillVariantSuffix('豌豆游侠·强化'), '豌豆游侠');
    assert.equal(stripSkillVariantSuffix('长枪兵·投枪'), '长枪兵');
    // 正式技能名里本来就有「·」，不能按第一个「·」截断。
    assert.equal(stripSkillVariantSuffix('冰霜·霜冻建筑'), '冰霜·霜冻建筑');
    // 只有后缀、没有本体时不要返回空串把通报整条抹掉。
    assert.equal(stripSkillVariantSuffix('·强化'), '·强化');
    assert.equal(stripSkillVariantSuffix(''), '');

    const start = MODEL_SOURCE.indexOf('private announceSkillNameOf(');
    assert.ok(start > 0, 'ZCGameModel 必须保留 announceSkillNameOf');
    assert.match(MODEL_SOURCE.slice(start, start + 700), /empoweredProfile\?\.name/,
        '武将技名必须取 empoweredProfile.name（事件里的名字是「普攻名·强化」）');
});

/* ------------------------------------------------- ② 每条主动技一次 / 品质门 */

test('② 同卡一局只通报一次：记账键 = cardId，重开清空', () => {
    //  用户口径（2026-11-25 最新）：「技能触发类型是主动冷却 / 主动累计普攻的都播报 1 次，
    //  同卡只放 1 次」⇒ 记账粒度回到「卡」：同一张卡第二个主动技不再弹。
    //  （中间一版曾落到「卡 + 技能」，那是「两个主动技按顺序弹」的旧口径，别改回去。）
    assert.match(MODEL_SOURCE, /private readonly announcedActiveSkills = new Set<string>\(\)/,
        '去重必须记在模型里（视图去重会在丢节点后重播）');
    assert.match(MODEL_SOURCE, /this\.announcedActiveSkills\.clear\(\)/, '重开一局必须清空');
    assert.match(MODEL_SOURCE, /this\.announcedActiveSkills\.has\(unit\.cardId\)/, '事件路径按卡记');
    assert.match(MODEL_SOURCE, /this\.announcedActiveSkills\.has\(cardId\)/, '车道路径按卡记');
    assert.match(MODEL_SOURCE, /this\.announcedActiveSkills\.add\(unit\.cardId\)/);
    assert.match(MODEL_SOURCE, /this\.announcedActiveSkills\.add\(cardId\)/);
    assert.doesNotMatch(MODEL_SOURCE, /announcedActiveSkills\.(?:has|add)\(`/,
        '记账键里不许再拼 skillId / behaviorKey（拼了就变回「每条技能一次」）');
});

test('② 只认本机玩家席位 + 顶档品级（gold）', () => {
    const start = MODEL_SOURCE.indexOf('private announceLegendSkillCasts(');
    assert.ok(start > 0, '必须保留 announceLegendSkillCasts');
    const body = MODEL_SOURCE.slice(start, start + 2200);
    assert.match(body, /event\.owner !== ZCOwner\.Player/, '敌方放技能不通报');
    assert.match(body, /card\.rarity !== 'gold'/, '只有顶档（gold）卡通报');
    assert.match(body, /event\.id < scanFromEventId/, '必须按事件 id 水位扫描');
    assert.match(MODEL_SOURCE, /const announceScanFromId = this\.state\.nextCombatEventId/, 'advance 里必须取水位');
    assert.match(MODEL_SOURCE, /this\.announceLegendSkillCasts\(announceScanFromId\)/, 'advance 末尾必须调用扫描');
    // 位置取施法者，不取受击方：通报是「我放了什么」。
    assert.match(body, /x: event\.fromX/, '坐标必须是施法者位置');
});

/* ------------------------------------------------------------ ③ 队列行为 */

function push(queue: ZCBattlePresentationQueue, overrides: Record<string, unknown> = {}): void {
    queue.pushSkillAnnounce({
        now: 1,
        cardId: '68007',
        skillId: 100204,
        skillName: '天降神拳',
        x: 3,
        y: 4,
        ...overrides,
    } as never);
}

test('③ 队列按 id 递增入队，并带满生命周期字段（2.3s）', () => {
    const queue = new ZCBattlePresentationQueue();
    push(queue);
    push(queue, { cardId: '68008', skillName: '崩山', now: 1.5 });
    const items = queue.skillAnnounces;
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((item) => item.id), [1, 2]);
    assert.equal(items[0].durationSeconds, ZC_SKILL_ANNOUNCE_SECONDS);
    assert.equal(ZC_SKILL_ANNOUNCE_SECONDS, 2.3, '用户口径「每次展示 2.3s」');
    assert.equal(items[0].startedAt, 1);
    assert.equal(items[1].skillName, '崩山');
    // 全显段 = 总长 ×（1 − 淡出占比），与 Style 的曲线对齐；两者各写一份常量，靠这条兜住。
    assert.ok(Math.abs(ZC_SKILL_ANNOUNCE_HOLD_SECONDS
        - ZC_SKILL_ANNOUNCE_SECONDS * (1 - ZC_SKILL_ANNOUNCE_FADE_RATIO)) < 0.02,
        '全显段必须等于 总时长 − 淡出段（否则名字还没看清就开始淡）');
});

test('③ 并列展示 + 纵向排队：同时触发的两条都从 now 起播，槽位按块高 + 3px 步进', () => {
    //  用户口径（2026-11-25 改口径）：「播报在玩家名字的下方，往下依次排队不重叠，间隔 3px」。
    //  旧口径是串行（第二条排到第一条播完），那时屏幕上永远只有一条，排不出「队列」。
    const queue = new ZCBattlePresentationQueue();
    push(queue, { now: 5, skillName: '文明之火' });
    push(queue, { now: 5, skillName: '精密陷阱' });
    const [first, second] = queue.skillAnnounces;
    assert.equal(first.startedAt, 5);
    assert.equal(second.startedAt, 5, '并列起播，不许被上一条拖到未来');
    assert.equal(second.durationSeconds, ZC_SKILL_ANNOUNCE_SECONDS);

    //  几何：0 号位的顶边 = 锚点（玩家列表底边），往下每格 = 块高 + 3px，净空正好 3px。
    const top = 360;
    const slotTop = (slot: number): number =>
        zcSkillAnnounceSlotCenterY(top, slot) + ZC_SKILL_ANNOUNCE_BLOCK_HEIGHT / 2;
    assert.equal(slotTop(0), top, '0 号位的顶边就是锚点');
    const gap = slotTop(0) - (slotTop(1) + ZC_SKILL_ANNOUNCE_BLOCK_HEIGHT);
    assert.ok(Math.abs(gap - 3) < 1e-6, `上下两条的净空必须正好 3px，实际 ${gap}`);
    assert.equal(ZC_SKILL_ANNOUNCE_STACK_GAP, 3);
    assert.equal(ZC_SKILL_ANNOUNCE_STACK_MAX, 3, '用户口径「超过 3 个时后面的不展示」');
    assert.ok(ZC_SKILL_ANNOUNCE_BLOCK_HEIGHT > ZC_SKILL_ANNOUNCE_ART_HEIGHT, '块高含形象 + 间距 + 名字');

    //  视图口径：起点未到 / 已过期都不渲染。
    assert.equal(zcSkillAnnounceProgress(4.9, first.startedAt, first.durationSeconds), 0);
    assert.equal(zcSkillAnnounceProgress(first.startedAt + ZC_SKILL_ANNOUNCE_SECONDS,
        first.startedAt, first.durationSeconds), 1);
});

test('③ 坏坐标 / 空名一律拒收（否则会变成跨局幽灵节点）', () => {
    const queue = new ZCBattlePresentationQueue();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        push(queue, { x: bad });
        push(queue, { y: bad });
    }
    assert.equal(queue.skillAnnounces.length, 0, '非有限坐标必须全拒');
    push(queue, { cardId: '' });
    push(queue, { skillName: '' });
    assert.equal(queue.skillAnnounces.length, 0, '没有卡面 id 或技能名的通报没有意义');
    push(queue);
    assert.equal(queue.skillAnnounces.length, 1, '正常数据照常入队');
});

test('③ 过期即出队；同时最多 3 条，第 4 条丢**新来的**；reset 清空', () => {
    const queue = new ZCBattlePresentationQueue();
    push(queue, { now: 0 });
    queue.prune(ZC_SKILL_ANNOUNCE_SECONDS - 0.01);
    assert.equal(queue.skillAnnounces.length, 1, '没到时长不许摘');
    queue.prune(ZC_SKILL_ANNOUNCE_SECONDS);
    assert.equal(queue.skillAnnounces.length, 0, '到点必须摘');

    for (let index = 0; index < 12; index += 1) push(queue, { cardId: `6800${index}`, now: 0 });
    const capped = queue.skillAnnounces;
    assert.equal(capped.length, 3, '并列上限 3 条（口径「超过 3 个时，后面的不展示了」）');
    assert.deepEqual(capped.map((item) => item.cardId), ['68000', '68001', '68002'],
        '留下最早的 3 条，后来的直接丢（不掐断已经在演的那条）');

    //  🔴 并列之后没有「串行游标」帮忙自清 ⇒ 过期必须摘，否则 3 条永久占位、后面一辈子进不来
    //  （症状是「再也不弹了」，而且零报错）。
    push(queue, { cardId: '68099', now: ZC_SKILL_ANNOUNCE_SECONDS + 0.1 });
    assert.equal(queue.skillAnnounces.length, 1, '过期的先摘掉，新来的才进得来');
    assert.equal(queue.skillAnnounces[0].cardId, '68099');

    queue.reset();
    assert.equal(queue.skillAnnounces.length, 0);
    push(queue, { now: 0 });
    assert.equal(queue.skillAnnounces[0].startedAt, 0);
    assert.equal(queue.skillAnnounces[0].id, 1, 'reset 后 id 从 1 重新编');
});

test('③ 渲染帧必须把通报暴露出去，渲染层必须按玩家列表锚点排队', () => {
    assert.match(QUEUE_SOURCE, /get skillAnnounces\(\)/, '队列要暴露 skillAnnounces');
    const frame = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCGameRenderFrame.ts'), 'utf8');
    assert.match(frame, /readonly skillAnnounces: readonly DeepReadonly<ZCSkillAnnounce>\[\]/);
    assert.match(MODEL_SOURCE, /skillAnnounces: this\.presentation\.skillAnnounces/, 'createRenderFrame 必须带上');
    assert.match(WORLD_SOURCE, /this\.renderSkillAnnounces\(frame\)/, 'renderDynamic 必须调用');

    //  位置口径（2026-11-25 改）：不再贴施法者/棋盘层，改成 HUD 上「玩家名字下方」的纵向队列。
    const start = WORLD_SOURCE.indexOf('private createSkillAnnounce(');
    const body = WORLD_SOURCE.slice(start, start + 1400);
    assert.match(body, /const layer = this\.options\.overlayLayer;/, '通报挂全屏演出层，不挂 mapLayer');
    assert.match(body, /node\.setParent\(layer\)/);
    assert.doesNotMatch(body, /mapToViewX\(announce\.x\)/, '不再用棋盘坐标定位');
    assert.match(WORLD_SOURCE, /private skillAnnounceAnchorLocal\(/, '锚点必须取玩家列表底边');
    assert.match(WORLD_SOURCE, /options\.skillAnnounceAnchor/, '锚点节点由 ZCGame 注入');
    assert.match(WORLD_SOURCE, /zcSkillAnnounceSlotCenterY\(anchor\.topY, slot\)/, '槽位按存活顺序往下排');
    assert.match(WORLD_SOURCE, /ZC_SKILL_ANNOUNCE_STACK_MAX/, '超过 3 条不再占位');
    assert.match(GAME_SOURCE, /skillAnnounceAnchor: this\.hudView\.playerList/, 'ZCGame 必须把玩家列表传进来');
    // 过期必须销毁：不进对象池就靠这一句回收，漏了就是「通报永远挂在 HUD 上」。
    assert.match(WORLD_SOURCE, /parts\.root\.destroy\(\)/, '过期必须销毁节点');
});

/* ------------------------------------------------------- ④ 视图比例 / 样式 */

test('④ 形象比例贴近参考图：占屏高约 13%，方形图等比', () => {
    // 参考图 323×691 上形象约 90×73（原图 px）⇒ 720 宽设计稿下高约 165（占屏高 13%）。
    assert.equal(ZC_SKILL_ANNOUNCE_ART_HEIGHT, 165);
    const square = { originalSize: { width: 256, height: 256 } } as never;
    assert.equal(zcSkillAnnounceArtWidth(square), ZC_SKILL_ANNOUNCE_ART_HEIGHT);
    // 宽高比 2:1 的图按高度归一，宽度跟着翻倍（不拉扁）。
    const wide = { originalSize: { width: 512, height: 256 } } as never;
    assert.equal(zcSkillAnnounceArtWidth(wide), ZC_SKILL_ANNOUNCE_ART_HEIGHT * 2);
    // 拿不到图也不能返回 0（0 尺寸节点看不到）。
    assert.equal(zcSkillAnnounceArtWidth(null), ZC_SKILL_ANNOUNCE_ART_HEIGHT);
    assert.equal(zcSkillAnnounceArtWidth({ originalSize: { width: 0, height: 0 } } as never),
        ZC_SKILL_ANNOUNCE_ART_HEIGHT);
});

test('④ 技能名与布局由 Prefab + ZCSkillAnnounceView 主导，代码不自建节点也不兜底拼装', () => {
    assert.equal(ZC_SKILL_ANNOUNCE_OUTLINE_WIDTH, 2, '描边就是 2px');
    assert.equal(ZC_SKILL_ANNOUNCE_NAME_SIZE, 30);
    assert.match(FX_SOURCE, /instantiate\(prefab\)/, '必须直接实例化 prefab');
    assert.match(FX_SOURCE, /getComponent\(ZCSkillAnnounceView\)/, '必须通过 ZCSkillAnnounceView 取绑定引用');
    assert.doesNotMatch(FX_SOURCE, /\bnew Node\(/, 'Prefab 主导后不许代码自建节点');
    assert.doesNotMatch(FX_SOURCE, /\.addComponent\(/, 'Prefab 主导后不许代码动态挂组件');
    assert.doesNotMatch(FX_SOURCE, /(add|get)Component\(\s*LabelOutline\s*\)/, '不许回退到已废弃的 LabelOutline');
    const viewSource = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCSkillAnnounceView.ts'), 'utf8');
    assert.match(viewSource, /glowSpine:\s*sp\.Skeleton/);
    assert.match(viewSource, /headSprite:\s*Sprite/);
    assert.match(viewSource, /nameLabel:\s*Label/);
});

test('④ 运行时实例化递归设层、到帧后补刷宽高、静止段跳过重复组件赋值', () => {
    const { load, FakeNode, cc } = loadViews();
    const { ZCSkillAnnounceView } = load('./ZCSkillAnnounceView');
    const {
        createZCSkillAnnounceNode,
        refreshZCSkillAnnounceFrame,
        renderZCSkillAnnounce,
    } = load('./ZCSkillAnnounceFx');
    const skeletonData = {
        getRuntimeData: () => ({ height: 352, animations: [{ name: 'glow_idle' }] }),
    };
    const animationCalls: Array<[number, string, boolean]> = [];
    const prefab = {
        make() {
            const root = new FakeNode('大招技能提示特效');
            root.addComponent(cc.UITransform).setContentSize(165, 207);
            const glowNode = new FakeNode('Glow');
            const spine = glowNode.addComponent(cc.sp.Skeleton);
            spine.node = glowNode;
            spine.skeletonData = skeletonData;
            spine.loop = true;
            spine.setAnimation = (track: number, name: string, loop: boolean) => {
                animationCalls.push([track, name, loop]);
            };
            const headNode = new FakeNode('Head');
            headNode.addComponent(cc.UITransform).setContentSize(165, 165);
            const headSprite = headNode.addComponent(cc.Sprite);
            headSprite.node = headNode;
            headSprite.spriteFrame = null;
            headSprite.getComponent = (type: unknown) => headNode.getComponent(type);
            const nameNode = new FakeNode('Name');
            const nameLabel = nameNode.addComponent(cc.Label);
            nameLabel.node = nameNode;
            root.addChild(glowNode);
            root.addChild(headNode);
            root.addChild(nameNode);
            const view = root.addComponent(ZCSkillAnnounceView);
            view.glowSpine = spine;
            view.headSprite = headSprite;
            view.nameLabel = nameLabel;
            return root;
        },
    };

    const announce = createZCSkillAnnounceNode(prefab, '68010', '天降神拳', null, 33554432);
    assert.equal(announce.root.layer, 33554432);
    for (const child of announce.root.children) assert.equal(child.layer, 33554432);
    assert.equal(announce.label.string, '天降神拳');
    assert.equal(announce.head.getComponent(cc.UITransform).width, 165);
    assert.equal(announce.spine.node.scale.x, zcSkillAnnounceGlowScale(skeletonData as never, 165));
    assert.deepEqual(animationCalls, [[0, 'glow_idle', true]]);

    const lateFrame = { originalSize: { width: 200, height: 100 } };
    refreshZCSkillAnnounceFrame(announce, lateFrame);
    assert.equal(announce.head.spriteFrame, lateFrame);
    assert.equal(announce.head.getComponent(cc.UITransform).width, 330);
    assert.equal(announce.root.getComponent(cc.UITransform).width, 330);
    assert.equal(announce.root.getComponent(cc.UITransform).height, 207);

    refreshZCSkillAnnounceFrame(announce, lateFrame);
    refreshZCSkillAnnounceFrame(announce, null);
    assert.equal(announce.head.spriteFrame, lateFrame);

    let colorWrites = 0;
    const trackColor = (comp: { _color?: unknown }) => Object.defineProperty(comp, 'color', {
        configurable: true,
        get: () => comp._color,
        set(v) { colorWrites++; comp._color = v; },
    });
    trackColor(announce.head);
    trackColor(announce.label);
    trackColor(announce.spine);
    const scratch = new cc.Color(255, 255, 255, 255);
    renderZCSkillAnnounce(announce, 0.5, scratch);
    assert.equal(colorWrites, 3);
    renderZCSkillAnnounce(announce, 0.6, scratch);
    assert.equal(colorWrites, 3, '全显平台期 scale/alpha 未变时必须跳过重复赋值');
});

test('④ 出入场曲线：从 0.72 弹出、尾段淡出、非法值不产生 NaN', () => {
    assert.equal(zcSkillAnnouncePopScale(0), ZC_SKILL_ANNOUNCE_POP_FROM);
    assert.equal(zcSkillAnnouncePopScale(1), 1);
    assert.ok(zcSkillAnnouncePopScale(0.5) > ZC_SKILL_ANNOUNCE_POP_FROM);
    for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY]) {
        const scale = zcSkillAnnouncePopScale(bad);
        assert.ok(Number.isFinite(scale) && scale > 0, `${String(bad)} 不能返回 NaN/0`);
    }

    assert.equal(zcSkillAnnounceOpacity(0), 0, '起始全透明');
    assert.equal(zcSkillAnnounceOpacity(0.5), 1, '中段全显');
    assert.equal(zcSkillAnnounceOpacity(1), 0, '结束淡出到底');
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.ok(Number.isFinite(zcSkillAnnounceOpacity(bad)));
    }

    // 进度：起点之前 0、超时 1、时长非法按缺省值。
    assert.equal(zcSkillAnnounceProgress(1, 2, 1.5), 0);
    assert.equal(zcSkillAnnounceProgress(5, 2, 1.5), 1);
    assert.ok(zcSkillAnnounceProgress(2.75, 2, 1.5) > 0.4 && zcSkillAnnounceProgress(2.75, 2, 1.5) < 0.6);
    assert.ok(Number.isFinite(zcSkillAnnounceProgress(2.75, 2, 0)));
    //  缺省时长与队列生命周期常量必须同值：`ZCSkillAnnounceStyle` 刻意**不** import 队列
    //  （视图夹具只按 `zcds/view|ui` 解析相对模块，反向引用会让整组渲染用例报
    //  「Missing view fixture module」一起红）⇒ 改一处漏改另一处只能靠这条兜住。
    assert.equal(
        ZC_SKILL_ANNOUNCE_FALLBACK_SECONDS,
        ZC_SKILL_ANNOUNCE_SECONDS,
        'Style 的缺省时长必须与队列的生命周期常量同值，否则淡出段和出队时刻会错位',
    );
});

test('④ 三层共用一份颜色实例：透明度不会各走各的', () => {
    assert.match(FX_SOURCE, /node\.head\.color = alphaScratch/);
    assert.match(FX_SOURCE, /node\.label\.color = alphaScratch/);
    assert.match(FX_SOURCE, /node\.spine\.color = alphaScratch/);
    // 每帧新建 Color 属于 update 路径分配，工程禁；同一个实例由渲染世界持有。
    assert.match(WORLD_SOURCE, /private readonly skillAnnounceTint = new Color\(255, 255, 255, 255\)/);
    assert.doesNotMatch(FX_SOURCE, /new Color\(255, 255, 255, Math\.round/, '不许在每帧路径里 new Color');
});

/* ------------------------------------------------------------ ⑤ 资源链路 */

test('⑤ 全子树必须递归写 UI 层，且卡面异步到货能补刷上屏节点', () => {
    assert.match(FX_SOURCE, /function applyLayerRecursive\(node: Node, layer: number\): void/);
    assert.match(FX_SOURCE, /applyLayerRecursive\(root, layer\);/);
    assert.match(WORLD_SOURCE, /createZCSkillAnnounceNode\([\s\S]{0,220}layer\.layer,/,
        'createSkillAnnounce 必须把 mapLayer.layer 传给节点组装');
    assert.match(WORLD_SOURCE, /refreshZCSkillAnnounceFrame\(parts,/, 'refreshLegendCardArt 必须补刷仍在播的通报卡面');
});

test('⑤ 底光骨架由 prefab 持有：缺骨架数据时跳过起播，形象与名字照常', () => {
    assert.match(FX_SOURCE, /if \(spine && spine\.skeletonData\) \{/, '骨架数据为空时跳过动画与缩放设置');
    assert.match(FX_SOURCE, /readonly spine: sp\.Skeleton \| null/);
    // 动画名取不到时返回空串（不抛错），由调用方决定不播。
    assert.equal(zcSkillAnnounceAnimationOf(null), '');
    assert.equal(zcSkillAnnounceAnimationOf(undefined), '');
    // 动画名必须走 getRuntimeData，`SkeletonData.animations` 在 3.8.8 不存在。
    const style = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSkillAnnounceStyle.ts'), 'utf8');
    assert.match(style, /data\.getRuntimeData\(true\)/, '动画名必须走 getRuntimeData(true)');
    // 底光缩放必须按骨架画布高反算：`landscape_tab_anim` 画布 352×352，照抄 1.35 会把
    // 165 高的卡面整个盖住（实测 352 × 1.35 = 475）。这条是真跑，不是结构守卫。
    assert.equal(zcSkillAnnounceGlowScale(null), 1, '缺骨架时退回原尺寸，不能是 0');
    assert.equal(zcSkillAnnounceGlowScale({ getRuntimeData: () => ({ height: 352 }) } as never),
        ZC_SKILL_ANNOUNCE_ART_HEIGHT * ZC_SKILL_ANNOUNCE_SPINE_SCALE / 352);
    assert.equal(zcSkillAnnounceGlowScale({ getRuntimeData: () => null } as never), 1, '读不到画布高按原尺寸');
    assert.equal(zcSkillAnnounceGlowScale({ getRuntimeData: () => { throw new Error('x'); } } as never), 1,
        'getRuntimeData 抛错不能让通报整层消失');
    assert.match(FX_SOURCE, /spine\.node\.setScale\(glowScale, glowScale, 1\)/, 'Glow 必须用反算出来的缩放');
});

test('⑤ 通报预制体路径登记在资源计划里，并按 Prefab 加载（不进 Prefab 预热清单）', () => {
    assert.match(PLAN_SOURCE, /skillAnnounce: `\$\{BATTLE_EFFECTS_DIRECTORY\}\/大招技能提示特效\/大招技能提示特效`/,
        '大招通报路径必须在 ZC_BATTLE_FX_PATHS 里唯一声明');
    for (const name of ['ZC_BATTLE_COMMON_FX_PREFABS', 'ZC_BATTLE_COMMON_PREFABS']) {
        const start = PLAN_SOURCE.indexOf(`const ${name}`);
        assert.ok(start > 0, `ZCGameResourcePlan 必须保留 ${name}`);
        const body = PLAN_SOURCE.slice(start, start + 320);
        assert.doesNotMatch(body, /skillAnnounce/,
            `${name} 是首包预热清单，通报改为随开局异步加载，不应进入首包`);
    }
    assert.match(GAME_SOURCE, /assets\.load\(path, Prefab,/, '必须按 Prefab 加载');
    assert.match(GAME_SOURCE, /this\.loadSkillAnnouncePrefab\(\)/, 'createGame 里要发起加载');
    // 异步到货：presentationArt 给读函数而不是值，否则会把「那一刻的 null」永久固化。
    assert.match(GAME_SOURCE, /skillAnnouncePrefab: \(\) => this\.skillAnnouncePrefab/);
    assert.match(WORLD_SOURCE, /art\.skillAnnouncePrefab \? art\.skillAnnouncePrefab\(\) : null/);
});

test('⑤ 卡面图复用本局 cardHead 帧表，不另开加载通道', () => {
    const start = WORLD_SOURCE.indexOf('private createSkillAnnounce(');
    const body = WORLD_SOURCE.slice(start, start + 900);
    assert.match(body, /cardArtFrames\.get\(announce\.cardId\)/,
        '形象必须取本局 cardHead 帧表（= pvpCard.headIcon）');
    assert.doesNotMatch(body, /resources\.load|assets\.load/, '视图不许自己加载卡面图');
});

/* --------------------------------------------------- ⑥ 行为车道（新加的橙卡） */

/**
 * 2026-11-25 用户补的现场：「战斗中，新加的橙色卡牌播放立绘动画没有展示」。
 *
 * 根因不是视图，是**判据只认 `pvpSkill` 行**：科学家「文明之火」/「精密陷阱」、魔术师
 * 「移形换影」这些主动技是 `fire_zone` / `trap_place` / `blink_strike` 车道，基表里
 * 根本没有行 —— 结算套的是本卡普攻行（`definition.attackProfile`）⇒ 事件 `skillId` 就是
 * `attackSkillId`、`skillName` 是「科学家普攻」，`isActiveSkillCast` 直接当普攻丢掉；
 * `empoweredEvery` 又是 0 ⇒ 强化那一击永远不来 ⇒ **一次都不播、零报错**。
 *
 * ⇒ 通报改在「车道回调返回成功」那一刻发起，名字从构筑期冻结的 `pvpSkillPlan.skillName` 取。
 */

/** 真表（`assets/remoteRef/<表>.json`：列存 `{k,v}` 或行对象数组）。*/
function readTableRows(name: string): Record<string, unknown>[] {
    const raw = JSON.parse(readFileSync(join(ROOT, `assets/remoteRef/${name}.json`), 'utf8')) as
        | Record<string, unknown>[]
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(raw)) return raw;
    return raw.v.map((row) => Object.fromEntries(raw.k.map((key, index) => [key, row[index]])));
}

test('⑥ 技能名来自 pvpSkillPlan：基表 pvpSkill 里查不到「精密陷阱 / 移形换影」这类车道技', () => {
    const plans = parseZCModifierCatalogs(null, null, { pvpSkillPlan: readTableRows('pvpSkillPlan') })
        .adapters.skillPlans;
    const index = zcAnnounceSkillNameIndex(plans);

    // 科学家 / 魔术师的主动技：只能从计划行拿到名字。
    assert.equal(index.get('68035:trap_place'), '精密陷阱');
    assert.equal(index.get('68034:blink_strike'), '移形换影');
    //  ⚠️ 2026-11-25 复核：三源（设计案 17:43 / client 16:21 / pvpSkillPlan）都是
    //  「文明之火 / fire_zone」。`pvpSkill` 30856「射线集束」是**机甲菇 68015 的 101504**
    //  （plan 里三档同名、active_cd），没有任何计划行把它当自己的 pvpSkillId —— 它只是
    //  科学家普攻行（30709）的 `secondarySkillId`，副轨借用不等于改名。
    //  它是 active_cd ⇒ 照样进通报索引（本轮新加的类型筛不会把它筛掉）。
    assert.equal(index.get('68035:fire_zone'), '文明之火');

    // 为什么必须新开一条取名通道：这两个名字在 pvpSkill 里一条都没有。
    const skillRowNames = new Set(readTableRows('pvpSkill').map((row) => String(row.name ?? '')));
    for (const name of ['精密陷阱', '移形换影']) {
        assert.ok(!skillRowNames.has(name), `${name} 不该出现在 pvpSkill —— 出现了就说明基表补了行，本用例要复核`);
    }
});

test('⑥ 名字索引：缺名字 / 缺行为键 / 被动类型一律不进索引（不许拿普攻名或车道键冒充）', () => {
    const index = zcAnnounceSkillNameIndex([
        { unitId: '68035', behaviorKey: 'fire_zone', skillName: '文明之火', skillKind: 'active_cd' },
        { unitId: '68035', behaviorKey: 'fire_zone', skillName: '文明之火·Lv3', skillKind: 'active_cd' },
        { unitId: '68034', behaviorKey: 'blink_strike' },
        { unitId: '', behaviorKey: 'fire_zone', skillName: '无主', skillKind: 'active_cd' },
        { unitId: '68032', skillName: '缺行为键', skillKind: 'active_cd' },
        //  被动行与主动行共用 `skill_params` 时，先出现的是被动那条 ⇒ 不筛类型就会被它抢走名字。
        { unitId: '68032', behaviorKey: 'skill_params', skillName: '穿甲苔刺', skillKind: 'passive_stat' },
        { unitId: '68032', behaviorKey: 'skill_params', skillName: '豌豆机关枪', skillKind: 'active_cd' },
    ]);
    assert.equal(index.size, 2, '只留 68035:fire_zone 与 68032:skill_params');
    assert.equal(index.get('68035:fire_zone'), '文明之火', '同名多级行取先出现的那个');
    assert.equal(index.get('68034:blink_strike'), undefined, '缺名字的不要');
    assert.equal(index.get('68032:skill_params'), '豌豆机关枪', '被动那条必须先被类型筛掉');
    //  类型判据本身：只有主动冷却 / 主动累计普攻该播。
    assert.equal(zcIsAnnounceSkillKind('active_cd'), true);
    assert.equal(zcIsAnnounceSkillKind('active_attack'), true);
    assert.equal(zcIsAnnounceSkillKind('passive_stat'), false);
    assert.equal(zcIsAnnounceSkillKind(undefined), false, '缺字段按不播处理');
});

test('⑥ 事件路径按「全表主动技能名」放行：普攻名 / 被动名进不来，跨卡副轨放得进来', () => {
    const plans = parseZCModifierCatalogs(null, null, { pvpSkillPlan: readTableRows('pvpSkillPlan') })
        .adapters.skillPlans;
    const names = zcAnnounceActiveNames(plans);
    assert.ok(names.has('文明之火'), '主动冷却要在名单里');
    assert.ok(names.has('天降神拳'), '主动累计普攻要在名单里');
    assert.ok(!names.has('穿甲苔刺'), '被动不在名单里');
    assert.equal(names.has('科学家普攻'), false, '普攻名不在名单里');
    //  🔴 不按 unitId 分桶：射线集束登记在机甲菇 68015 名下，但科学家靠普攻行的
    //  secondarySkillId 借来施法（真机放得出来）⇒ 按卡分桶会把这一发挡掉。
    assert.ok(names.has('射线集束'), '跨卡副轨的名字必须在名单里');
});

test('⑥ 施法成功那一拍就通报：三条车道全都包了 castWithAnnounce / announceActiveCast', () => {
    const start = MODEL_SOURCE.indexOf('private buildSkillTriggerContext(');
    assert.ok(start > 0);
    const context = MODEL_SOURCE.slice(start, start + 7000);
    // 科学家：燃烧区域 / 陷阱（事件层套的是普攻行，只能从回调这里判断）
    assert.match(context, /castFireZone: \(unit\) => this\.castWithAnnounce\(ZC_EFFECT_BEHAVIOR_KEYS\.fireZone, unit,/);
    assert.match(context, /castTrap: \(unit\) => this\.castWithAnnounce\(ZC_EFFECT_BEHAVIOR_KEYS\.trapPlace, unit,/);
    // 魔术师：「移形换影」是内联在触发系统里的，唯一外呼是 blinkTo（行为键由调用方透传）。
    assert.match(context, /blinkTo: \(unit, x, y, behaviorKey\) => \{\s*this\.announceActiveCast\(unit, behaviorKey \?\? ZC_EFFECT_BEHAVIOR_KEYS\.blinkStrike\);/);

    const gate = MODEL_SOURCE.slice(
        MODEL_SOURCE.indexOf('private announceActiveCast('),
        MODEL_SOURCE.indexOf('private announceSkillNamesOf('),
    );
    assert.match(gate, /unit\.owner !== ZCOwner\.Player/, '只听玩家方');
    assert.match(gate, /card\.rarity !== 'gold'/, '只认顶档品级（橙色 / 传说）');
    assert.match(gate, /announcedActiveSkills\.has\(cardId\)/, '同卡一局只播一次');
    assert.match(gate, /if \(!skillName\) \{/, '取不到名字不播（不许拿「XX普攻」冒充技能名）');
    assert.match(gate, /announcedActiveSkills\.add\(cardId\)/, '只有真正入队才算播过');
    //  三个失败门都要留一行日志：不播时没有异常，光看屏幕分不清是哪一道。
    assert.match(gate, /announceLogOnce\(`\$\{cardId\}:notgold`/, '品级门要留痕');
    assert.match(gate, /announceLogOnce\(`\$\{cardId\}:\$\{skillKey\}:noname`/, '取不到名字要留痕');
    assert.match(gate, /announceLogOnce\(`\$\{cardId\}:\$\{skillKey\}:rejected`/, '被队列拒收要留痕');
    assert.match(gate, /announceLog\(`车道路径通报入队/, '入队成功要留痕（现场用来确认「到底弹没弹」）');
});

test('⑥ 名字索引随构筑冻结：模型读 config.modifiers 里的 skillPlans，不回头查全局表', () => {
    const start = MODEL_SOURCE.indexOf('private announceSkillNamesOf(');
    assert.ok(start > 0);
    const body = MODEL_SOURCE.slice(start, start + 700);
    assert.match(body, /this\.config\.modifiers/, '必须读本局冻结的构筑产物');
    assert.match(body, /loadout\.skillPlans/, '技能计划行就在 loadout 上');
    assert.doesNotMatch(body, /ZC_RUNTIME_CONFIG|readFileSync|getZCModifierCatalogs/,
        '战斗中不许回头读全局表（跨局复用会让通报写到别的卡上）');
});

test('⑥ 取名必须走 Map.get：写成 map[key] 编译器不报、运行期恒 undefined', () => {
    //  🔴 本批真踩过：`announceSkillNamesOf()` 返回 `ReadonlyMap`，`map["68035:fire_zone"]`
    //  在 JS 里永远取不到值 ⇒ 三道门全过、一条都不播、零报错。
    //  这条守的是「下标访问」这个写法本身，不依赖上面那堆结构守卫。
    assert.match(MODEL_SOURCE, /const nameKey = `\$\{unit\.unitId\}:\$\{behaviorKey\}`/, '命名键必须是 unitId:behaviorKey');
    assert.match(MODEL_SOURCE, /announceSkillNamesOf\(\)\.get\(nameKey\)/, '车道取名必须 .get()');
    assert.doesNotMatch(MODEL_SOURCE, /announceSkillNamesOf\(\)\s*\[/,
        '不许用下标访问 ReadonlyMap（恒 undefined，且没有任何信号）');
});

test('⑥ blinkTo 被五条车道共用：行为键必须由调用方透传，不许写死 blink_strike', () => {
    //  这条回调同时服务「移形换影」（blink_strike）、「腾云驾雾」（dash_chain）、
    //  single_strike / charge_shield / legacy_dash。写死一个键的后果是其它车道
    //  「查不到名字 ⇒ 静默不播」，与本次 bug 同一种死法。
    const triggerSource = readFileSync(
        join(ROOT, 'assets/script/app/zcds/model/systems/ZCSkillTriggerSystem.ts'), 'utf8');
    assert.match(triggerSource, /blinkTo\?\(unit: ZCUnitState, x: number, y: number, behaviorKey\?: string\): void/,
        '回调签名必须带行为键');

    //  不变式：触发系统里**每一次** blinkTo 都带自己的行为键（漏一个就有一条车道静默不播）。
    const calls = triggerSource.match(/blinkTo\((?:[^()]|\([^()]*\))*\)/g) ?? [];
    assert.ok(calls.length >= 4, `blinkTo 调用点应当有多处，实际 ${calls.length}`);
    for (const call of calls) {
        assert.ok(/ZC_EFFECT_BEHAVIOR_KEYS\.\w+/.test(call),
            `\`${call.replace(/\s+/g, ' ')}\` 没带行为键 —— 通报会查到别的技能名，或一条都查不到`);
    }

    //  并且键要跟车道对得上（传错键 = 播了别张卡/别的技能的通报）。
    const laneKeyOf = (name: string): string => {
        const start = triggerSource.indexOf(`private static ${name}(`);
        assert.ok(start > 0, `找不到车道方法 ${name}`);
        const next = triggerSource.indexOf('private static ', start + 10);
        const body = triggerSource.slice(start, next > 0 ? next : undefined);
        const keys = [...body.matchAll(/blinkTo\([\s\S]*?ZC_EFFECT_BEHAVIOR_KEYS\.(\w+)\)/g)]
            .map((match) => match[1]);
        assert.ok(keys.length > 0, `${name} 里必须调 blinkTo`);
        assert.equal(new Set(keys).size, 1, `${name} 里出现了多个不同的行为键：${keys.join('/')}`);
        return keys[0];
    };
    assert.equal(laneKeyOf('applyDashChain'), 'dashChain');
    assert.equal(laneKeyOf('applyBlinkStrike'), 'blinkStrike');
    assert.equal(laneKeyOf('applySingleStrike'), 'singleStrike');
    assert.equal(laneKeyOf('applyChargeShield'), 'chargeShield');
    assert.equal(laneKeyOf('applyLegacyDash'), 'legacyDash');
});

test('⑥ self_cast / random_strike 没有回调可包：靠 announceCast 钩子，且必须挂在「真放出去」那一拍', () => {
    const triggerSource = readFileSync(
        join(ROOT, 'assets/script/app/zcds/model/systems/ZCSkillTriggerSystem.ts'), 'utf8');
    const laneBody = (name: string): string => {
        const start = triggerSource.indexOf(`private static ${name}(`);
        assert.ok(start > 0, `找不到车道方法 ${name}`);
        const next = triggerSource.indexOf('private static ', start + 10);
        return triggerSource.slice(start, next > 0 ? next : undefined);
    };

    // self_cast：CD 已消费（markCastAction）之后才算放出去。
    const selfCast = laneBody('applySelfCast');
    const selfAnnounce = selfCast.indexOf('announceCast?.(unit, ZC_EFFECT_BEHAVIOR_KEYS.selfCast)');
    assert.ok(selfAnnounce > 0, 'applySelfCast 必须回报通报');
    assert.ok(selfAnnounce > selfCast.indexOf('this.markCastAction('), '通报要在 CD 消费之后，不能抢在门上');

    // random_strike：必须带 `hits > 0` —— 空放（半径内没目标）不算施法，冷却也不推进。
    const struck = laneBody('applyRandomStrike');
    assert.match(struck, /if \(hits > 0\) context\.announceCast\?\.\(unit, ZC_EFFECT_BEHAVIOR_KEYS\.randomStrike\);/,
        'random_strike 的通报必须绑在命中上（打空不算施法）');

    // 行为键得先在目录里登记，否则取到 undefined、索引永远查不到。
    assert.equal(ZC_EFFECT_BEHAVIOR_KEYS.selfCast, 'self_cast');
    assert.equal(ZC_EFFECT_BEHAVIOR_KEYS.randomStrike, 'random_strike');
});

/* ------------------------------------------------ ⑦ 真模型全链路（真表 → 真队列） */

/**
 * 上面 ⑥ 全是源码正则 —— 能挡住「包装被删掉」，挡不住「包装写着但取不到名字」。
 * 这一组把真表装进运行时、造一个真 `ZCGameModel`，从车道回调一路走到 `presentation`。
 */

const ANNOUNCE_TABLE_NAMES = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams'];

loadPvpTables(Object.fromEntries(ANNOUNCE_TABLE_NAMES.map((name) => [name, readTableRows(name)])) as unknown as ZCPvpTables);
//  `castFireZone` / `blinkTo` 只碰目标点与地图几何，装一张真地图免得取到空表。
configureZCMap(JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/zcds-legacy-map.json'), 'utf8')) as never);

const ANNOUNCE_BASE = captureZCMatchConfig();
/** 科学家（68035）、魔术师（68034）、仙桃行者（68009）、毒箭菇（68017）的真实技能计划行。*/
const ANNOUNCE_PLANS = parseZCModifierCatalogs(null, null, { pvpSkillPlan: readTableRows('pvpSkillPlan') })
    .adapters.skillPlans
    .filter((plan) => ['68035', '68034', '68009', '68017'].includes(plan.unitId));

/** 本局构筑：把两位的技能计划挂在 68035 这一份 loadout 上（其余字段留空 = 不加属性）。*/
const ANNOUNCE_LOADOUT: ZCCompiledModifierLoadout = {
    sourceKey: 'test:announce', sourceKind: 'skill', targetUnitId: '68035',
    appliedModifierIds: [], rawAttributes: {}, statPatch: {}, typedModifiers: [],
    skillPlans: ANNOUNCE_PLANS, breakdown: [], effects: [], unsupportedAttributes: [], configHash: 'test',
};

const ANNOUNCE_CONFIG: ZCMatchConfig = {
    ...ANNOUNCE_BASE,
    modifiers: { player: [ANNOUNCE_LOADOUT], enemy: [] },
} as ZCMatchConfig;

interface IAnnounceInternals {
    announceActiveCast(unit: ZCUnitState, behaviorKey: string): void;
    announceLegendSkillCasts(scanFromEventId: number): void;
    buildSkillTriggerContext(): {
        blinkTo(unit: ZCUnitState, x: number, y: number, behaviorKey?: string): void;
        announceCast(unit: ZCUnitState, behaviorKey: string): void;
    };
    presentation: { skillAnnounces: readonly { cardId: string; skillId: number; skillName: string; x: number; y: number }[] };
}

/** 往真快照里塞一条战斗事件并返回 id；`announceLegendSkillCasts` 按这个水位扫。*/
function pushCombatEvent(model: ZCGameModel, overrides: Partial<ZCCombatEvent> & Pick<ZCCombatEvent, 'sourceUnitId' | 'skillId' | 'skillName'>): number {
    const state = model.snapshot as unknown as ZCSnapshot;
    const id = state.nextCombatEventId++;
    const originX = model.snapshot.units.find((unit) => unit.id === overrides.sourceUnitId)?.freeX ?? 0;
    state.combatEvents.push({
        id, type: 'area', owner: 'player', sourceUnitId: overrides.sourceUnitId,
        targetUnitId: null, skillId: overrides.skillId, skillName: overrides.skillName,
        effectKey: null, projectileKey: null, fromX: originX, fromY: 0, toX: originX, toY: 0,
        radius: 10, damage: 100, empowered: false, startedAt: state.elapsedSeconds, durationSeconds: 0.3,
        ...overrides,
    } as ZCCombatEvent);
    return id;
}

function announceUnit(id: number, owner: 'player' | 'enemy', cardId: string, x: number): ZCUnitState {
    return {
        id, owner, unitId: cardId, cardId, tier: 1,
        sourceHexId: ANNOUNCE_BASE.map.playerHomeId, targetHexId: null, progress: 0,
        hp: 500, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 10000, waitUntil: 10000, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    } as unknown as ZCUnitState;
}

function announceModel(units: ZCUnitState[]): { model: ZCGameModel; internals: IAnnounceInternals } {
    const snapshot = ZCGameModel.createInitialState(() => 0.1, ANNOUNCE_CONFIG);
    snapshot.units = units;
    snapshot.nextUnitId = 10;
    const model = new ZCGameModel(snapshot, () => 0.1, ANNOUNCE_CONFIG);
    return { model, internals: model as unknown as IAnnounceInternals };
}

test('⑦ 真模型：车道路径先弹；同卡第二条（事件路径）不再弹 —— 同卡只放 1 次', () => {
    //  先确认夹具本身没跑偏：真表里 68035 就是橙卡、名字索引能查到「精密陷阱」。
    const { model, internals } = announceModel([announceUnit(1, 'player', '68035', 10)]);
    const unit = model.snapshot.units[0];
    assert.equal((model as unknown as { cards: { player: Map<string, { rarity: string }> } })
        .cards.player.get('68035')?.rarity, 'gold', '68035 必须是顶档品级，否则本用例失去意义');

    //  ① 车道路径：精密陷阱（trap_place）在基表里没有独立行，名字只能取构筑期计划。
    internals.announceActiveCast(unit, 'trap_place');
    const items = internals.presentation.skillAnnounces;
    assert.equal(items.length, 1, '车道施法成功必须入队一条通报');
    assert.equal(items[0].cardId, '68035');
    assert.equal(items[0].skillName, '精密陷阱', '名字必须是计划行里的真名，不是「科学家普攻」');
    assert.equal(items[0].skillId, 0, '车道技在基表没有独立行，没有可记的 skillId');
    assert.deepEqual([items[0].x, items[0].y], [10, 0], '坐标仍带施法者位置（只作日志，位置由 HUD 槽位定）');

    //  ② 同卡第二条主动技：不再入队（用户口径「同卡只放 1 次」）。
    const scanFrom = pushCombatEvent(model, { sourceUnitId: unit.id, skillId: 30856, skillName: '射线集束' });
    internals.announceLegendSkillCasts(scanFrom);
    assert.equal(internals.presentation.skillAnnounces.length, 1, '同卡只放 1 次，事件路径那条不再入队');
    //  换一条车道也不弹。
    internals.announceActiveCast(unit, 'fire_zone');
    assert.equal(internals.presentation.skillAnnounces.length, 1, '换技能也还是同一张卡');
    //  名字索引里确实有「精密陷阱」—— 上面那条不是「查不到所以不播」蒙对的。
    assert.equal(ANNOUNCE_PLANS.some((plan) => plan.unitId === '68035'
        && plan.behaviorKey === 'trap_place' && plan.skillName === '精密陷阱'), true);

    //  ③ 普攻副轨不算「主动技」：30856「射线集束」是科学家普攻行（30709）的
    //  `secondarySkillId`，计划行登记在机甲菇 68015 名下 ⇒ 本局构筑里根本没有这条主动技
    //  的名字，事件路径必须一条都不弹（用户口径「普通攻击和特效名字不需要」）。
    //  事件路径的正向用例见下面「仙桃行者·腾云驾雾（武将技那一击）」那条。
    const fresh = announceModel([announceUnit(1, 'player', '68035', 10)]);
    const freshUnit = fresh.model.snapshot.units[0];
    const from = pushCombatEvent(fresh.model, { sourceUnitId: freshUnit.id, skillId: 30856, skillName: '射线集束' });
    fresh.internals.announceLegendSkillCasts(from);
    assert.equal(fresh.internals.presentation.skillAnnounces.length, 0,
        '普攻副轨（射线集束）不属于本卡主动技，不许弹');
});

test('⑦ 真模型：普攻名 / 被动名走事件路径一条都不入队', () => {
    const { model, internals } = announceModel([announceUnit(1, 'player', '68035', 10)]);
    const unit = model.snapshot.units[0];
    //  「科学家普攻」是事件的默认名字，不在主动技名单里 ⇒ 必须挡掉（否则每次普攻都弹）。
    const from = pushCombatEvent(model, { sourceUnitId: unit.id, skillId: 30709, skillName: '科学家普攻' });
    internals.announceLegendSkillCasts(from);
    assert.equal(internals.presentation.skillAnnounces.length, 0, '普攻名不许进入通报');
    //  被动技名字（穿甲苔刺）同样挡掉：它 skillKind=passive_stat。
    const passive = pushCombatEvent(model, { sourceUnitId: unit.id, skillId: 30856, skillName: '穿甲苔刺' });
    internals.announceLegendSkillCasts(passive);
    assert.equal(internals.presentation.skillAnnounces.length, 0, '被动名不许进入通报');
});

test('⑦ 真模型：绿卡 / 敌方单位放同样的车道技，一条都不入队', () => {
    const green = announceUnit(1, 'player', '68001', 10);
    const foe = announceUnit(2, 'enemy', '68035', 20);
    const { internals } = announceModel([green, foe]);
    internals.announceActiveCast(green, 'trap_place');
    internals.announceActiveCast(foe, 'trap_place');
    assert.equal(internals.presentation.skillAnnounces.length, 0,
        '绿卡不算橙卡、敌方不进本机通报（敌方也没有本机构筑的 loadout，判据不该靠这个兜住）');
});

test('⑦ 真模型：魔术师「移形换影」走真车道（blinkTo）—— 通报与位移同一拍', () => {
    const magician = announceUnit(1, 'player', '68034', 20);
    const { internals } = announceModel([magician]);
    internals.buildSkillTriggerContext().blinkTo(magician, 55, 66);
    const items = internals.presentation.skillAnnounces;
    assert.equal(items.length, 1, '闪现是内联在触发系统里的车道，唯一外呼就是 blinkTo');
    assert.equal(items[0].skillName, '移形换影');
    //  通报点位是**起手位置**（闪现前的站位）：通报讲的是「我放了什么」，不是落点。
    assert.deepEqual([items[0].x, items[0].y], [20, 0]);
    //  位移照常发生（包装不许把副作用吃掉）。
    assert.deepEqual([magician.freeX, magician.freeY], [55, 66]);
});

test('⑦ 真模型：仙桃行者「腾云驾雾」是武将技那一击 —— 事件路径取 empoweredProfile.name', () => {
    //  2026-11-25 表 V5-20261117：`dash_chain` 计划行已删除，腾云驾雾改成 68009 的
    //  武将技（`pvpSkill 30718.empoweredSkillId = 30844`，每 5 次普攻放一次）。
    //  这条只能走事件路径；名字必须是技能表真名，不是事件里的「仙桃行者普攻·强化」。
    const walker = announceUnit(1, 'player', '68009', 30);
    const { model, internals } = announceModel([walker]);
    const scanFrom = pushCombatEvent(model, {
        sourceUnitId: walker.id, skillId: 30844, skillName: '仙桃行者普攻·强化', empowered: true,
    });
    internals.announceLegendSkillCasts(scanFrom);
    const items = internals.presentation.skillAnnounces;
    assert.equal(items.length, 1);
    assert.equal(items[0].skillName, '腾云驾雾');
    assert.notEqual(items[0].skillName, '移形换影');
    assert.notEqual(items[0].skillName, '仙桃行者普攻·强化');
});

test('⑦ 真模型：没有 castXxx 回调的两条车道（self_cast / random_strike）也通报', () => {
    //  仙桃行者「迅击」= self_cast、毒箭菇「群星坠落」= random_strike：
    //  这两条车道一个自己挂增益、一个走 `strike`，没有 castXxx 可以包 ⇒ 由触发系统的
    //  `announceCast` 钩子在「CD 已消费 / 开火命中」那一拍回调过来。
    const quick = announceUnit(1, 'player', '68009', 10);
    const fall = announceUnit(2, 'player', '68017', 20);
    const { internals } = announceModel([quick, fall]);
    const context = internals.buildSkillTriggerContext();
    context.announceCast(quick, 'self_cast');
    context.announceCast(fall, 'random_strike');
    const names = internals.presentation.skillAnnounces.map((item) => [item.cardId, item.skillName]);
    assert.deepEqual(names, [['68009', '迅击'], ['68017', '群星坠落']]);
});

/* ---------------------------------------- ⑧ 预制体（美术 / 策划可打开的交付物） */

/**
 * `大招技能提示特效` 预制体。
 *
 * 它**不参与出图** —— 运行时那条通报是 `ZCSkillAnnounceFx.createZCSkillAnnounceNode`
 * 就地 `new Node` 组装的（播放内容 100% 运行时才定，prefab 只能给空壳）。
 * 但美术 / 策划要能打开一个文件看见「底光 + 形象 + 名字」长什么样，所以这份 prefab
 * 必须与代码里那份坐标 / 字号**逐项同值**：图看着对、实机歪一截，不会有任何用例变红。
 *
 * 三个「开了编辑器才会踩」的点：
 *  ① 动画名留空（运行时取骨架第一段）。写死名字 ⇒ 美术换骨架后骨架一动不动，且不报错。
 *  ② `_lscale` 必须 1：缩放由 `renderZCSkillAnnounce` 每帧按 progress 覆盖，烘进 prefab 会被抹掉。
 *  ③ 三层颜色必须纯白：透明度是三层共用一份 `Color` 实例写的，prefab 自带色会乘进去。
 */

const PREFAB_DIR = 'units/effects/大招技能提示特效';
const PREFAB_NAME = '大招技能提示特效';
const PREFAB_FILE = assetPath(`${PREFAB_DIR}/${PREFAB_NAME}.prefab`);
/** `cc.Layers.Enum.UI_2D`：层写错的表现是「节点在、就是看不见」（相机剔除，无异常）。 */
const UI_2D_LAYER = 33554432;

/** 名字段的实际高度：字号 + 上下各一道描边（与 `createZCSkillAnnounceNode` 同式）。 */
const NAME_BOX_H = ZC_SKILL_ANNOUNCE_NAME_SIZE + ZC_SKILL_ANNOUNCE_OUTLINE_WIDTH * 2;
/** root 总高：形象 + 间距 + 名字段。 */
const ANNOUNCE_BOX_H = ZC_SKILL_ANNOUNCE_ART_HEIGHT + ZC_SKILL_ANNOUNCE_NAME_GAP + NAME_BOX_H;
/** 形象顶边贴 root 顶边 ⇒ 中心 = (名字段 + 间距) / 2。 */
const HEAD_Y = (NAME_BOX_H + ZC_SKILL_ANNOUNCE_NAME_GAP) / 2;
/** 名字底边贴 root 底边 ⇒ 中心 = -(形象高 + 间距) / 2。 */
const NAME_Y = -(ZC_SKILL_ANNOUNCE_ART_HEIGHT + ZC_SKILL_ANNOUNCE_NAME_GAP) / 2;

interface IPrefabItem {
    __type__: string;
    node?: { __id__: number };
    _children?: Array<{ __id__: number }>;
    [key: string]: unknown;
}

interface IPrefabNode extends IPrefabItem {
    _name?: string;
    _layer?: number;
    _lpos?: { x: number; y: number };
    _lscale?: { x: number; y: number };
}

function readPrefabItems(): IPrefabItem[] {
    return JSON.parse(readFileSync(PREFAB_FILE, 'utf8')) as IPrefabItem[];
}

/** 节点 id（= 它在序列化数组里的下标）→ 该节点。`__id__` 指的是整个数组的下标，不是第几个 Node。 */
function prefabNodeIdOf(items: readonly IPrefabItem[], name: string): number {
    const id = items.findIndex((item) => item.__type__ === 'cc.Node' && (item as IPrefabNode)._name === name);
    assert.ok(id > 0, `prefab 里没有名为 ${name} 的节点`);
    return id;
}

function componentOn(items: readonly IPrefabItem[], nodeId: number, type: string): IPrefabItem {
    const found = items.find((item) => item.__type__ === type && item.node?.__id__ === nodeId);
    assert.ok(found, `节点 #${nodeId} 上没有 ${type}`);
    return found;
}

test('⑧ 预制体：根 Node + 三层（Glow / Head / Name），坐标由样式常量反算', () => {
    const items = readPrefabItems();
    const nodes = items.filter((item) => item.__type__ === 'cc.Node') as unknown as IPrefabNode[];
    assert.equal(nodes.length, 4, '根 + 三层：底光 / 形象 / 名字（与 createZCSkillAnnounceNode 同构）');

    const root = nodes[0];
    assert.equal(root._name, PREFAB_NAME, '根节点名 = 文件名（编辑器里 `syncNodeName` 依赖它）');
    //  根节点不位移：落点由 `createSkillAnnounce` 按施法者格心写，prefab 再带偏移就是「每次都偏一截」。
    assert.deepEqual([root._lpos?.x, root._lpos?.y], [0, 0]);

    //  子节点顺序即绘制顺序（自下而上）：底光在形象下面，名字压在形象上面。
    const childIds = (root._children ?? []).map((child) => child.__id__);
    assert.equal(childIds.length, 3);
    const childNames = childIds.map((id) => (items[id] as IPrefabNode)._name);
    assert.deepEqual(childNames, ['Glow', 'Head', 'Name'], '顺序反了的表现是「底光盖住卡面」或「名字被卡面盖住」');

    //  子节点坐标与运行时组装同式反算（不是抄一遍数字，改动任一边另一边立刻红）。
    assert.deepEqual([nodes[1]._lpos?.x, nodes[1]._lpos?.y], [0, 0], '底光居中，比形象大一圈靠自身缩放');
    assert.deepEqual([nodes[2]._lpos?.x, nodes[2]._lpos?.y], [0, HEAD_Y]);
    assert.deepEqual([nodes[3]._lpos?.x, nodes[3]._lpos?.y], [0, NAME_Y]);

    //  缩放一律留 1：`renderZCSkillAnnounce` 每帧 `root.setScale(pop)` 覆盖宿主缩放。
    for (const node of nodes) {
        assert.equal(node._lscale?.x, 1, `${node._name} 的 _lscale 不许烘数值`);
        assert.equal(node._lscale?.y, 1, `${node._name} 的 _lscale 不许烘数值`);
        assert.equal(node._layer, UI_2D_LAYER, `${node._name} 的 layer 不是 UI_2D ⇒ 挂上去也看不见`);
    }

    //  root 内容尺寸 = 形象宽 × (形象高 + 间距 + 名字段)；空壳时形象按正方形算。
    const rootSize = componentOn(items, prefabNodeIdOf(items, PREFAB_NAME), 'cc.UITransform')
        ._contentSize as { width: number; height: number };
    assert.deepEqual([rootSize.width, rootSize.height], [ZC_SKILL_ANNOUNCE_ART_HEIGHT, ANNOUNCE_BOX_H]);
});

test('⑧ 预制体：底光是本目录的骨架，动画名留空、循环播、预乘关闭（与运行时同值）', () => {
    const items = readPrefabItems();
    const glowId = prefabNodeIdOf(items, 'Glow');
    const skeleton = componentOn(items, glowId, 'sp.Skeleton');

    //  骨架 uuid 必须与同目录 `.skel.meta` 一致 —— 不一致的表现在屏幕上什么都没有，且不报错。
    const skelMeta = JSON.parse(readFileSync(`${assetPath(`${PREFAB_DIR}/landscape_tab_anim.skel`)}.meta`, 'utf8')) as
        { importer: string; uuid: string };
    assert.equal(skelMeta.importer, 'spine-data');
    assert.equal((skeleton._skeletonData as { __uuid__: string }).__uuid__, skelMeta.uuid);

    //  动画名留空：运行时用 `zcSkillAnnounceAnimationOf(skeleton)` 取骨架里第一段再 setAnimation。
    assert.equal(skeleton.defaultAnimation, '', '写死动画名 ⇒ 美术换骨架后一动不动，且不报错');
    //  通报 2.3s 比底光 clip 长，必须循环：不循环会停在末帧，看起来像「播到一半卡住」。
    assert.equal(skeleton.loop, true);
    assert.equal(skeleton.defaultSkin, 'default');
    //  预乘关闭：底光是普通（非预乘）atlas，开预乘会在描边外压出一圈黑边。
    assert.equal(skeleton._premultipliedAlpha, false);
    //  颜色必须纯白：三层透明度共用一份 Color 实例写，prefab 自带色会乘进去。
    assert.deepEqual(skeleton._color, { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 });
});

test('⑧ 预制体：形象是空 Sprite（CUSTOM 尺寸）、名字白粗体 + 黑描边 2px，并挂载 ZCSkillAnnounceView', () => {
    const items = readPrefabItems();

    const headId = prefabNodeIdOf(items, 'Head');
    const head = componentOn(items, headId, 'cc.Sprite');
    //  CUSTOM：尺寸由 UITransform 定（165 方图）。AUTO 会按卡面原图撑开，通报大小随素材乱飘。
    assert.equal(head._sizeMode, 0, 'sizeMode 必须是 CUSTOM');
    assert.equal(head._isTrimmedMode, false, '不裁边：卡面带透明留白时也要按 165 摆');
    assert.equal(head._spriteFrame, null, '空壳：卡面图运行时按 cardId 从 cardHead 帧表填');
    const headSize = componentOn(items, headId, 'cc.UITransform')._contentSize as { width: number; height: number };
    assert.deepEqual([headSize.width, headSize.height],
        [ZC_SKILL_ANNOUNCE_ART_HEIGHT, ZC_SKILL_ANNOUNCE_ART_HEIGHT], '形象目标高 = 占屏高约 13%');

    const nameId = prefabNodeIdOf(items, 'Name');
    const label = componentOn(items, nameId, 'cc.Label');
    assert.equal(label._string, '', '空壳：技能名运行时写入');
    assert.equal(label._fontSize, ZC_SKILL_ANNOUNCE_NAME_SIZE);
    assert.equal(label._lineHeight, ZC_SKILL_ANNOUNCE_NAME_SIZE + 4, '与视图 `fontSize + 4` 同式');
    //  用户口径原文：「白色粗体字 + 黑色描边 2px」。
    assert.equal(label._isBold, true);
    assert.equal(label._enableOutline, true);
    assert.equal(label._outlineWidth, ZC_SKILL_ANNOUNCE_OUTLINE_WIDTH);
    assert.deepEqual(label._color, { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 });
    assert.deepEqual(label._outlineColor, { __type__: 'cc.Color', r: 0, g: 0, b: 0, a: 255 });
    //  NONE 而不是 SHRINK：SHRINK 还要拿「盒子高 ÷ lineHeight」再折一次字号，改盒子就会悄悄变小。
    assert.equal(label._overflow, 0);
    const nameSize = componentOn(items, nameId, 'cc.UITransform')._contentSize as { width: number; height: number };
    assert.equal(nameSize.height, NAME_BOX_H, '名字盒子高 = 字号 + 上下描边');

    //  ZCSkillAnnounceView 必须挂在根节点并把 glowSpine / headSprite / nameLabel 绑到对应组件。
    const viewMeta = JSON.parse(readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCSkillAnnounceView.ts.meta'), 'utf8')) as { uuid: string };
    const hex = viewMeta.uuid.replace(/-/g, '');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const cid = hex.slice(0, 5) + Array.from({ length: 9 }, (_, i) => {
        const value = parseInt(hex.slice(5 + i * 3, 8 + i * 3), 16);
        return alphabet[value >> 6] + alphabet[value & 0x3f];
    }).join('');
    const viewComp = componentOn(items, prefabNodeIdOf(items, PREFAB_NAME), cid);
    assert.equal(items[(viewComp.glowSpine as { __id__: number }).__id__], componentOn(items, prefabNodeIdOf(items, 'Glow'), 'sp.Skeleton'));
    assert.equal(items[(viewComp.headSprite as { __id__: number }).__id__], head);
    assert.equal(items[(viewComp.nameLabel as { __id__: number }).__id__], label);

    //  资源计划里的路径必须与该 prefab 同目录同名。
    const dirLeaf = PREFAB_DIR.slice(PREFAB_DIR.lastIndexOf('/') + 1);
    assert.ok(PLAN_SOURCE.includes(`${dirLeaf}/${PREFAB_NAME}`),
        '资源计划里的路径必须指向大招技能提示特效.prefab');
});
