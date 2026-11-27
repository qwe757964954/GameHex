import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    ZC_MONSTER_AWAKE_BLUE,
    ZC_MONSTER_AWAKE_GREEN,
    ZC_MONSTER_AWAKE_RED,
    ZC_MONSTER_FOCUS_GAP_ABOVE_BAR,
    ZC_MONSTER_FOCUS_SPINE_SCALE,
    ZC_MONSTER_SLEEP_ALPHA,
    ZC_MONSTER_SLEEP_GRAY,
    ZC_MONSTER_TINTS,
    zcMonsterFocusButtonY,
    zcMonsterFocusSpineArtLiftPx,
    zcMonsterFocusSpineScale,
    zcMonsterFocusSpineY,
    zcMonsterIdleTimeScale,
    zcMonsterTintStateOf,
} from '../assets/script/app/zcds/model/ZCMonsterPresentation';

/**
 * 野怪格：集火特效贴血条 3px + 身体三态染色 + 被玩家方打下补出生特效（2026-11-26 第 53 批）。
 *
 * 需求原文：「1. 野怪按钮特效的位置应该在血条的上方 3px；2. 野怪未激活整体叠加一层灰色
 * 不透明度为 35%；3. 野怪激活后去掉灰色，改成叠加暗色（类似敌方卡牌）；4. 野怪被玩家方击败，
 * 播放卡牌单位生成特效，把颜色改回正常颜色，去掉叠加的暗红色」。
 */

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const HEX_SOURCE = read('assets/script/app/zcds/view/ZCHexView.ts');
const WORLD_SOURCE = read('assets/script/app/zcds/view/ZCGameRenderWorld.ts');

test('① 三态判据：归属优先、血空不算能打、非野怪一律 null', () => {
    //  非野怪格：这一批一个字节都不该碰（宝箱 / 金矿 / 兵营 / 空地全走这里）。
    for (const owner of ['neutral', 'player', 'enemy']) {
        assert.equal(zcMonsterTintStateOf({ monster: false, owner, awake: true, hp: 50 }), null);
        assert.equal(zcMonsterTintStateOf({ monster: false, owner, awake: false, hp: 0 }), null);
    }
    //  未激活 = 中立 + 没被集火（用户口径的「灰色 35%」）。
    assert.equal(zcMonsterTintStateOf({ monster: true, owner: 'neutral', awake: false, hp: 900 }), 'sleep');
    //  激活 = 中立 + 集火过 + 还有血（暗红）。
    assert.equal(zcMonsterTintStateOf({ monster: true, owner: 'neutral', awake: true, hp: 900 }), 'awake');
    //  🔴 血空了就不是「能打」的了：`awake` 不会自己复位，判据必须自己看 hp。
    assert.equal(zcMonsterTintStateOf({ monster: true, owner: 'neutral', awake: true, hp: 0 }), 'sleep');
    //  🔴 归属优先：野怪被玩家方打下来后 `neutralResourceId` 是**故意留着**的
    //  （`ZCDevelopmentSystem`：「出生格的生命值仍由中立野怪战斗结算持有」）⇒ 这一格还会画那只野怪，
    //  这时必须回正常色，而不是继续挂着暗红。
    assert.equal(zcMonsterTintStateOf({ monster: true, owner: 'player', awake: true, hp: 0 }), 'captured');
    assert.equal(zcMonsterTintStateOf({ monster: true, owner: 'player', awake: true, hp: 900 }), 'captured');
    //  敌方打下别人的野怪也算「改归属」：回正常色（但不该播我方出生特效，见 ④ 的 owner 判据）。
    assert.equal(zcMonsterTintStateOf({ monster: true, owner: 'enemy', awake: true, hp: 0 }), 'captured');
});

test('② 染色数值：未激活只压亮不压透 / 激活暗红 / 打下不染', () => {
    const sleep = ZC_MONSTER_TINTS.sleep;
    //  灰色：三通道同值（乘算做不出真灰度，见模块注释）。
    assert.equal(sleep.r, ZC_MONSTER_SLEEP_GRAY);
    assert.equal(sleep.g, ZC_MONSTER_SLEEP_GRAY);
    assert.equal(sleep.b, ZC_MONSTER_SLEEP_GRAY);
    //  🔴 未激活**不透明**（2026-11-26 用户：「叠加一层带透明度的颜色，不是整个颜色变透」）：
    //  之前 35% alpha 让整只怪半透明、地皮网格透出来，读成幽灵而不是「没激活」。
    assert.equal(sleep.a, ZC_MONSTER_SLEEP_ALPHA);
    assert.equal(sleep.a, 255, '本体必须不透明');
    //  灰但不是全黑：全黑会读成「死了」，用户要的是「没激活」。
    assert.ok(sleep.r > 0x80 && sleep.r < 0xFF);

    const awake = ZC_MONSTER_TINTS.awake;
    //  暗红：红通道明显高于绿蓝（绿蓝同值 = 中性轴），整体压暗（都 < 0xFF）。
    assert.ok(awake.r > awake.g && awake.g === awake.b, '暗红 = 红高一截、绿蓝同值');
    assert.ok(awake.r !== awake.g, '不许退化成灰色');
    assert.ok(awake.r < 0xFF && awake.g < 0xFF && awake.b < 0xFF, '是「暗」红，不是原色');
    assert.equal(awake.r, ZC_MONSTER_AWAKE_RED);
    assert.equal(awake.g, ZC_MONSTER_AWAKE_GREEN);
    assert.equal(awake.b, ZC_MONSTER_AWAKE_BLUE);
    //  激活态也必须不透明（三态都靠 rgb 乘法表达，不许有一个偷偷改 alpha）。
    assert.equal(awake.a, 255);

    //  被玩家方打下：不染色 = 白。
    assert.deepEqual({ ...ZC_MONSTER_TINTS.captured }, { r: 255, g: 255, b: 255, a: 255 });

    //  待机倍速：只有未激活是慢的；`captured` 若留 0.35，打下来的野怪像还在睡。
    assert.equal(zcMonsterIdleTimeScale('sleep'), 0.35);
    assert.equal(zcMonsterIdleTimeScale('awake'), 1);
    assert.equal(zcMonsterIdleTimeScale('captured'), 1);
    assert.equal(zcMonsterIdleTimeScale(null), 1);
});

test('③ 头顶布局：特效**美术底边** = 血条顶边 + 3，按钮底边也在同一条线', () => {
    assert.equal(ZC_MONSTER_FOCUS_GAP_ABOVE_BAR, 3);
    const barTopY = 100;
    const halfButton = 21;   // prefab 的点击区 150×42
    const buttonY = zcMonsterFocusButtonY(barTopY, halfButton);
    //  按钮**底边**贴血条顶边 + 3（不是中心距）。
    assert.equal(buttonY - halfButton, barTopY + ZC_MONSTER_FOCUS_GAP_ABOVE_BAR);
    //  🔴 特效节点原点**不是**可见底边：骨架美术整体画在原点之上（`bounds.y`），
    //  所以「压到那条线」的是「原点 + 抬升」这条边（2026-11-26 第 56 批：
    //  之前漏了这一段，实测飘在血条上方约 100px）。
    assert.equal(zcMonsterFocusSpineArtLiftPx(200, 0.5), 100, '抬升 = bounds.y × 节点缩放');
    assert.equal(zcMonsterFocusSpineArtLiftPx(null, 1), 200, '读不到骨架（单测桩）走兜底常量');
    assert.equal(zcMonsterFocusSpineArtLiftPx(-200, 0.5), 100, '符号约定不稳定，取绝对值');
    const spineY = zcMonsterFocusSpineY(barTopY, zcMonsterFocusSpineArtLiftPx(200, 0.5));
    assert.equal(spineY, barTopY + ZC_MONSTER_FOCUS_GAP_ABOVE_BAR - 100, '原点要让出美术高度');
    assert.equal(spineY - buttonY, -halfButton - 100);
    //  放大 1.5 倍：乘在 prefab 原始缩放上（0.5 ⇒ 0.75），美术更高 ⇒ 原点再往下让一截。
    assert.equal(ZC_MONSTER_FOCUS_SPINE_SCALE, 1.5);
    assert.equal(zcMonsterFocusSpineScale(0.5), 0.75);
    assert.equal(zcMonsterFocusSpineScale(1), 1.5);
    assert.equal(zcMonsterFocusSpineScale(0), 1.5, '缩放缺失 / 为 0 时按 1 算，别把特效拍成 0');
    assert.equal(zcMonsterFocusSpineArtLiftPx(200, zcMonsterFocusSpineScale(0.5)), 150, '放大后美术也跟着高');
    //  间隙可覆写（第三条参数）：两条线一起跟着走。
    assert.equal(zcMonsterFocusSpineY(barTopY, 0, 6), barTopY + 6);
    assert.equal(zcMonsterFocusButtonY(barTopY, halfButton, 6) - halfButton, barTopY + 6);
});

test('④ 视图接线：三态染色走纯函数、特效单独落位、被打下置一次性通知', () => {
    //  旧口径（蓝灰 130/150/180）必须彻底消失，否则「灰」会被它盖回去。
    assert.doesNotMatch(HEX_SOURCE, /MONSTER_SLEEP_TINT/, '旧的蓝灰染色常量必须删干净');
    assert.doesNotMatch(HEX_SOURCE, /130,\s*150,\s*180/, '旧的蓝灰数值不许以字面量残留');

    assert.match(HEX_SOURCE, /const tintState = zcMonsterTintStateOf\(\{/);
    assert.match(HEX_SOURCE, /const monsterTint = tintState \? MONSTER_TINT_COLORS\[tintState\] : Color\.WHITE;/,
        '态 → Color 的唯一出口');
    assert.match(HEX_SOURCE, /const idleScale = zcMonsterIdleTimeScale\(tintState\);/, '倍速也按三态');
    assert.match(HEX_SOURCE, /skeleton\.color = monsterTint;/, '骨架染色只在这里写');
    assert.doesNotMatch(HEX_SOURCE, /sleepingMonster/, '旧的两态变量必须删掉（否则三态判据被绕过）');

    //  特效单独落位：局部 y = 目标线 − 按钮中心，且要先放大 1.5 倍再算美术高度。
    assert.match(HEX_SOURCE,
        /const spineScale = zcMonsterFocusSpineScale\(this\.monsterSpineBaseScale\.y\);/,
        '放大倍率必须乘在 prefab 原始缩放上，不能写死绝对值');
    assert.match(HEX_SOURCE,
        /const artLift = zcMonsterFocusSpineArtLiftPx\(this\.monsterFocusSpineArtLiftValue\(\), spineScale\);/,
        '美术抬升要按**放大后**的缩放算，否则放大后底边又飘上去');
    assert.match(HEX_SOURCE,
        /spine\.setPosition\(spine\.position\.x, zcMonsterFocusSpineY\(barTopY, artLift\) - buttonY, spine\.position\.z\)/,
        '集火特效的**美术底边**要压到血条顶边 + 3 那条线');
    assert.match(HEX_SOURCE, /const buttonY = zcMonsterFocusButtonY\(barTopY, halfButton\);/, '按钮仍走同一个纯函数');
    //  离开野怪态要还原（池化复用，否则下一个非野怪格的特效会停在被压过 / 放大的状态）。
    assert.match(HEX_SOURCE, /if \(this\.monsterSpineBase && this\.monsterFocusSpine\) this\.monsterFocusSpine\.node\.setPosition\(this\.monsterSpineBase\);/,
        'restoreMonsterHeader 必须还原特效局部坐标');
    assert.match(HEX_SOURCE, /this\.monsterSpineBase \?\?= spine\.position\.clone\(\);/, '进态前先存基准');
    assert.match(HEX_SOURCE, /this\.monsterSpineBaseScale \?\?= spine\.scale\.clone\(\);/, '放大前先存基准缩放');
    assert.match(HEX_SOURCE,
        /this\.monsterFocusSpine\.node\.setScale\(this\.monsterSpineBaseScale\.x, this\.monsterSpineBaseScale\.y, this\.monsterSpineBaseScale\.z\);/,
        '放大 1.5 倍也必须还原');

    //  「刚被玩家方打下」→ 一次性标志：上一帧中立、这一帧不是、归属是玩家。
    assert.match(HEX_SOURCE, /if \(this\.monsterNeutralLastFrame === true && !neutralNow/, '只认「中立 → 非中立」那一拍');
    assert.match(HEX_SOURCE, /&& tintState === 'captured' && owner === ZCOwner\.Player\) \{/, '只给玩家方，敌方打下不播我方特效');
    assert.match(HEX_SOURCE, /this\.monsterCapturedFxPending = true;/);
    //  取走即空：先清标志再 return true（顺序反了会连播两帧）。
    assert.match(HEX_SOURCE,
        /if \(!this\.monsterCapturedFxPending\) return false;\s*this\.monsterCapturedFxPending = false;\s*return true;/,
        'consume 必须「取走即空」');
    //  每局复位（池化复用会把上一局的 true 带回来）。
    assert.match(HEX_SOURCE, /this\.monsterNeutralLastFrame = null;\s*this\.monsterCapturedFxPending = false;/);
});

test('④ 渲染层只在一个地方消费它，且播的是出生特效', () => {
    //  宿主 = 野怪身体节点。
    assert.match(HEX_SOURCE, /get monsterFxHost\(\): Node \| null \{/, '宿主访问器');
    assert.match(HEX_SOURCE, /return this\.resourceUnitNodes\.length \? this\.resourceUnitNodes\[0\] : null;/);

    const consumes = WORLD_SOURCE.match(/consumeMonsterCapturedFx\(\)/g) ?? [];
    assert.equal(consumes.length, 1, '全工程只许一处消费（多一处就是有人又给别的地块播了一次）');
    assert.match(WORLD_SOURCE,
        /if \(monsterView\.consumeMonsterCapturedFx\(\)\) \{\s*const host = monsterView\.monsterFxHost;\s*if \(host\) this\.effectPool\.playSpawnFx\(host, now\);/,
        '取到通知就播一次出生特效（卡牌单位生成同一份 prefab）');
    //  它与集火按钮的刷新在同一个分支里：状态只在这一处拿得到。
    assert.match(WORLD_SOURCE,
        /monsterView\.renderMonsterFocus\(hex, now\);\s*monsterView\.renderMonsterAttack\(/);
});
