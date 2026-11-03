import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import {
    zcCombatEffectFlightOf,
    zcCombatEffectFacingDegrees,
    zcCombatEffectFacingOffsetOf,
    zcCombatEffectHeadingDegrees,
    zcCombatEffectTravelSeconds,
} from '../assets/script/app/zcds/model/ZCCombatEffectFlight';

/**
 * 猎头者普攻：特效**匹配射程、像子弹一样飞向目标**（需求 2026-11-02）。
 *
 * ## 为什么问题出在「近战行 + 远射程」这个组合
 *
 * `pvpCard` 68012 猎头者射程 **500**，但它的普攻走 `pvpSkill` 30271 —— 一条
 * `mode: 'melee'` 的行（名字还叫「斧盾兵普攻」，特效是 `斧盾兵_反击气刃` 的月牙气刃）。
 * melee 的表现有两条硬伤：`attackTravelSeconds` 固定 0.32s（不随距离变）、
 * `ZCCombatEffectView` 把特效钉在锚点上播一次（没有飞行过程）。
 *
 * ## 落地口径
 *
 * 不动表（表是远端下发的，单侧改会被覆盖），改**表现配置**：
 * `ZCCombatEffectFlight` 按 prefab 路径登记飞行段，逻辑层据此给更长的 `durationSeconds`，
 * 视图据此把特效沿 `from → to` 插值移动并转角朝目标。
 * 与 `ZCCombatEffectPlacement`（锚点，2026-10-30 巨力坚果）是同一套「按路径配表现」的做法。
 */

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const codeOf = (relative: string): string => read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const HUNTER_EFFECT = 'units/projectiles/斧盾兵_反击气刃/斧盾兵_反击气刃';
const HUNTER_PREFAB = 'assets/bundles/battle/units/projectiles/斧盾兵_反击气刃/斧盾兵_反击气刃.prefab';
const EFFECT_VIEW = 'assets/script/app/zcds/view/ZCCombatEffectView.ts';
const RESOLUTION = 'assets/script/app/zcds/model/systems/ZCAttackResolutionSystem.ts';

/** `combatDistanceScale = 0.3`（pvpGlobal）：射程 500 逻辑 ⇒ 150 世界 px。 */
const DISTANCE_SCALE = 0.3;
/** 猎头者（68012）的 `unitAttackRange`。 */
const HUNTER_RANGE = 500;

function readPvpRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(join(ROOT, `assets/remoteRef/${name}.json`), 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

/** 造一条 melee 战斗事件；`durationSeconds` 用真实函数算，避免测试自己编一个数。 */
function meleeEvent(fromX: number, fromY: number, toX: number, toY: number, path = HUNTER_EFFECT): Record<string, unknown> {
    const distance = Math.hypot(toX - fromX, toY - fromY);
    return {
        id: 1, type: 'melee', owner: 'player', sourceUnitId: 1, targetUnitId: 2,
        skillId: 30271, skillName: '斧盾兵普攻', effectKey: null, projectileKey: null,
        effectPrefabPath: path,
        fromX, fromY, toX, toY, radius: 0, damage: 10, empowered: false,
        startedAt: 0,
        durationSeconds: zcCombatEffectTravelSeconds('melee', distance, undefined, path),
    };
}

function buildEffectView(): any {
    const { load, FakeNode } = loadViews();
    const view = new (load('./ZCCombatEffectView').ZCCombatEffectView)();
    view.spriteNode = new FakeNode();
    view.sprite = {};
    view.graphics = { clear() {}, moveTo() {}, lineTo() {}, stroke() {} };
    return { view, FakeNode, load };
}

test('① 飞行表：只登记猎头者那条月牙气刃，其余近战特效保持原地播', () => {
    const spec = zcCombatEffectFlightOf(HUNTER_EFFECT);
    assert.ok(spec, '斧盾兵_反击气刃 要登记飞行段');
    assert.equal(spec!.speed, 420);
    assert.equal(spec!.minSeconds, 0.14);
    assert.equal(spec!.maxSeconds, 0.6);
    // 转角偏移 = 0：美术的**正面（亮白弧顶）画在 +X**，转角 = 弹道方向 ⇒ 箭头冲着目标飞。
    // 2026-11-02 第二轮：先前按「长轴的法线朝目标」登记成 90，实战里箭头是侧着飞的
    // （正面朝上、敌人却在右边），用户要求顺时针再转 90° ⇒ 改回 0。
    assert.equal(spec!.facingOffsetDegrees, 0);
    // 空路径 / 未登记 ⇒ null（22 条近战特效不能被顺手改成飞行）。
    for (const path of [null, undefined, '',
        'units/projectiles/巨力坚果_普攻/巨力坚果_普攻',
        'units/projectiles/民兵普攻_刀光/民兵普攻_刀光',
        'units/projectiles/刀盾兵普攻_刀光/刀盾兵普攻_刀光',
        'units/projectiles/普攻爆炸/普攻爆炸']) {
        assert.equal(zcCombatEffectFlightOf(path), null, `「${path}」不该被这张表命中`);
    }
});

test('② 表现时长：登记的特效按「距离 / 速度」算并夹在上下限之间', () => {
    // 满射程：500 逻辑 × 0.3 = 150 世界 px ⇒ 150 / 420 ≈ 0.357s。
    // 改前是固定 0.32s —— 现在「飞多远、飞多久」终于和射程挂上了钩。
    const full = zcCombatEffectTravelSeconds('melee', HUNTER_RANGE * DISTANCE_SCALE, undefined, HUNTER_EFFECT);
    assert.ok(Math.abs(full - 150 / 420) < 1e-9, `满射程应飞 ${150 / 420}s，实际 ${full}`);
    assert.ok(full > 0.32, '满射程要比原来的固定 0.32s 更久（否则看不出「匹配射程」）');

    // 贴脸：30px 只该飞 0.071s ⇒ 被 minSeconds 兜到 0.14s（0 秒会变成原地闪一下）。
    assert.equal(zcCombatEffectTravelSeconds('melee', 30, undefined, HUNTER_EFFECT), 0.14);
    assert.equal(zcCombatEffectTravelSeconds('melee', 0, undefined, HUNTER_EFFECT), 0.14);
    // 极远：不会无限飞（否则一发气刃盖住下一次普攻）。
    assert.equal(zcCombatEffectTravelSeconds('melee', 10000, undefined, HUNTER_EFFECT), 0.6);
    // 非法距离不能变 NaN（NaN 的 durationSeconds 会让事件永不回收）。
    assert.equal(zcCombatEffectTravelSeconds('melee', Number.NaN, undefined, HUNTER_EFFECT), 0.14);

    // ── 未登记的照旧：melee 固定 0.32s、projectile 按距离/速度 ──
    assert.equal(zcCombatEffectTravelSeconds('melee', 150, undefined, 'units/projectiles/普攻爆炸/普攻爆炸'), 0.32);
    assert.equal(zcCombatEffectTravelSeconds('melee', 150, undefined, null), 0.32);
    assert.equal(zcCombatEffectTravelSeconds('area', 150, undefined, HUNTER_EFFECT), 0.32, 'area 不吃飞行段');
    assert.equal(zcCombatEffectTravelSeconds('projectile', 150, 500, HUNTER_EFFECT), 150 / 500);
    assert.equal(zcCombatEffectTravelSeconds('projectile', 0, 0, null), 1e-6);
});

test('③ 视图：登记的 melee 从出手点飞到目标，箭头正面沿弹道指向目标，未登记的仍贴出手点', () => {
    const { view, load } = buildEffectView();
    const { mapToViewX, mapToViewY } = load('./ZCGameViewUtil');

    // 世界坐标：施法者 (100,100) 打 (220,160) —— 距离 135.9，方向右下。
    const event = meleeEvent(100, 100, 220, 160);
    const at = (progress: number): { x: number; y: number; rot: number } => {
        view.render(event, progress * (event.durationSeconds as number), undefined, 1);
        return { x: view.node.position.x, y: view.node.position.y, rot: view.node.rotation.z ?? 0 };
    };

    const start = at(0);
    assert.ok(Math.abs(start.x - mapToViewX(100)) < 1e-6, `起点应在出手点，实际 ${start.x}`);
    assert.ok(Math.abs(start.y - mapToViewY(100)) < 1e-6);

    const mid = at(0.5);
    assert.ok(Math.abs(mid.x - mapToViewX(160)) < 1e-6, `半程应在两端中点，实际 ${mid.x}`);
    assert.ok(Math.abs(mid.y - mapToViewY(130)) < 1e-6);

    const end = at(1);
    assert.ok(Math.abs(end.x - mapToViewX(220)) < 1e-6, `终点必须落在目标身上，实际 ${end.x}`);
    assert.ok(Math.abs(end.y - mapToViewY(160)) < 1e-6);

    // 转角 = **弹道方向本身**（偏移 0）：美术的正面（亮白弧顶）画在 `+X`，
    // 不额外转就是「箭头冲着目标飞」。2026-11-02 第二轮截图里箭头是侧着飞的
    // （正面朝上、敌人在右边），那正是 offset=90 的产物，用户要求顺时针再转 90°。
    const flightAngle = Math.atan2(mapToViewY(160 - 100), mapToViewX(220 - 100)) * 180 / Math.PI;
    const expected = flightAngle;
    assert.ok(Math.abs(mid.rot - expected) < 1e-6,
        `转角应等于弹道方向 ${flightAngle.toFixed(1)}°，实际 ${mid.rot}`);
    // 反过来说：箭头正面与弹道的夹角必须是 0（偏了就说明偏移配错）。
    assert.ok(Math.abs(mid.rot - flightAngle) < 1e-6,
        `箭头正面必须沿弹道，实际夹角 ${mid.rot - flightAngle}°`);
    // 纯函数单独钉一次（视图算错时能和「表配错」区分开）。
    assert.equal(zcCombatEffectFacingDegrees(flightAngle, zcCombatEffectFlightOf(HUNTER_EFFECT)), flightAngle);
    assert.equal(zcCombatEffectFacingDegrees(flightAngle, null), flightAngle, '未登记不偏移');
    assert.equal(zcCombatEffectFacingDegrees(Number.NaN, null), 0, 'NaN 不许流进 setRotationFromEuler');

    // 未登记的近战特效：仍贴出手点（caster），不跟着目标跑。
    const plain = meleeEvent(100, 100, 220, 160, 'units/projectiles/普攻爆炸/普攻爆炸');
    view.render(plain, 0.16, undefined, 1);
    assert.ok(Math.abs(view.node.position.x - mapToViewX(100)) < 1e-6,
        `未登记的特效该贴出手点，实际 ${view.node.position.x}`);
});

test('④ 逻辑层真的用上了这条时长（不是只在测试里自娱自乐）', () => {
    const source = codeOf(RESOLUTION);
    assert.match(source, /zcCombatEffectTravelSeconds\(/, '结算链路要按登记表算事件时长');
    assert.match(source, /activeProfile\.effectPrefabPath/, '要把特效路径喂进去（登记表按路径认）');
    // 旧的固定口径不能还留着 —— 留着就是「改了函数但没接上」。
    assert.doesNotMatch(source, /ZCCombatSystem\.attackTravelSeconds\(\s*\n?\s*activeProfile\.mode/,
        '`resolveAttack` 不该再直接调旧函数');

    const viewSource = codeOf(EFFECT_VIEW);
    assert.match(viewSource, /zcCombatEffectFlightOf\(event\.effectPrefabPath\)/, '视图要按路径判断飞不飞');
});

test('⑤ 数据事实：表里 30271 仍是 melee、猎头者射程 500、美术确实存在', () => {
    const skills = readPvpRows('pvpSkill');
    const row = skills.find((item) => item.skillId === 30271);
    assert.ok(row, 'pvpSkill 里要有 30271');
    // ⚠️ 这条同时是「我们**没有**去改远端表」的守卫：表是下发的，单侧改会被覆盖，
    // 所以飞行只能靠表现配置（`ZCCombatEffectFlight`）。哪天策划真把 mode 改成 projectile，
    // 这条会红 —— 那时该做的是把飞行表这条登记删掉，而不是把断言改成 projectile。
    assert.equal(row!.mode, 'melee');
    assert.equal(row!.effectPrefabPath, HUNTER_EFFECT);

    const cards = readPvpRows('pvpCard');
    const hunter = cards.find((item) => item.id === 68012);
    assert.ok(hunter, 'pvpCard 里要有猎头者');
    assert.equal(hunter!.unitSkillId, 30271);
    assert.equal(hunter!.unitAttackRange, HUNTER_RANGE, '射程 500 是「特效要匹配射程」的前提');

    // 美术：150×61 的横向月牙，朝右 ⇒ 转角朝目标即可当飞行物。
    assert.ok(readFileSync(join(ROOT, HUNTER_PREFAB)).length > 0, '特效 prefab 要存在');
});

// ------------------------------------------------------------------ ⑥ 原地播的特效转身

const BOXER_EFFECT = 'units/projectiles/消灭学霸_普攻/消灭学霸_普攻';
const BOXER_PREFAB = 'assets/bundles/battle/units/projectiles/消灭学霸_普攻/消灭学霸_普攻.prefab';

/**
 * 运动霸：特效**没有朝向目标、现在是反的**（需求 2026-11-02）。
 *
 * ## 为什么是「反的」
 *
 * `ZCCombatEffectView` 对 melee / area 原本一律 `setRotationFromEuler(0,0,0)` ——
 * 转角恒 0 就等于「美术朝哪边，屏上就朝哪边」。而这张图
 * （`消灭学霸_普攻`，228×256、15 帧）是一把**朝右扇开**的绿色气刃：亮白的汇聚点压在
 * 画布左侧（x≈35/228），刃口向右散。所以目标站右边时是对的，站左边时**正好反 180°**，
 * 站上下时是「横着扫」。
 *
 * ## 为什么只转、不飞
 *
 * 猎头者（`斧盾兵_反击气刃`）是隔着 150px 打的，特效必须飞过去才看得出「匹配射程」；
 * 运动霸是近战，冲刺到贴身才出手（`chargeDistance` 那段见 `zcds-charge.test.ts`），
 * 特效本来就该在原地炸。所以它只进 `FACING_BY_PREFAB_PATH`（只改转角），
 * 不进 `FLIGHT_BY_PREFAB_PATH`（那会**连带改事件寿命**）。
 */
test('⑥ 运动霸普攻/能量光束：特效转身对着目标，但仍在原地播（不飞）', () => {
    // ── 表：只登记转角，不能顺手把它变成飞行物 ──
    assert.equal(zcCombatEffectFlightOf(BOXER_EFFECT), null,
        '转身不等于会飞 —— 进了飞行表就会连带改掉事件寿命');
    assert.equal(zcCombatEffectFacingOffsetOf(BOXER_EFFECT), 0,
        '美术正前方就是 +X（刃口朝右）⇒ 偏移 0°，转角 = 弹道方向本身');
    // 飞行段自带偏移的优先，不许两张表给出两个答案。
    // 它的偏移是 0（正面朝向 = 弹道方向），与「只转身」那张表的语义对齐。
    assert.equal(zcCombatEffectFacingOffsetOf(HUNTER_EFFECT), 0);

    // ── 纯函数：四个方向 ──
    // 视图 y 与逻辑 y 同号（`mapToViewY` 是正系数）⇒「目标在上」= 视图 +y。
    assert.equal(zcCombatEffectHeadingDegrees(100, 0, BOXER_EFFECT), 0, '目标在右 ⇒ 0°');
    assert.equal(zcCombatEffectHeadingDegrees(0, 100, BOXER_EFFECT), 90, '目标在上 ⇒ 90°');
    assert.equal(Math.abs(zcCombatEffectHeadingDegrees(-100, 0, BOXER_EFFECT)!), 180, '目标在左 ⇒ 180°（就是改前出错的那一版）');
    assert.equal(zcCombatEffectHeadingDegrees(0, -100, BOXER_EFFECT), -90, '目标在下 ⇒ -90°');

    // 三个 null 出口：未登记 / 原地爆 / NaN
    assert.equal(zcCombatEffectHeadingDegrees(100, 0, 'units/projectiles/普攻爆炸/普攻爆炸'), null,
        '未登记的 22 条近战特效不能因为加了这张表就集体转向');
    assert.equal(zcCombatEffectHeadingDegrees(100, 0, null), null);
    assert.equal(zcCombatEffectHeadingDegrees(0, 0, BOXER_EFFECT), null,
        '原地爆（from === to）没有「朝向目标」可言 —— 气浪 / 扇形技 / 多点落点全走这一条');
    assert.equal(zcCombatEffectHeadingDegrees(Number.NaN, 0, BOXER_EFFECT), null,
        'NaN 不许泄进 setRotationFromEuler（那会让节点矩阵变 NaN、特效静默消失）');

    // ── 视图：目标在右下，节点真的转了 ──
    const { view, load } = buildEffectView();
    const { mapToViewX, mapToViewY } = load('./ZCGameViewUtil');
    const expected = Math.atan2(mapToViewY(60), mapToViewX(120)) * 180 / Math.PI;
    view.render(meleeEvent(100, 100, 220, 160, BOXER_EFFECT), 0.1, undefined, 1);
    assert.ok(Math.abs(view.node.rotation.z - expected) < 1e-6,
        `转角应等于弹道方向 ${expected.toFixed(1)}°，实际 ${view.node.rotation.z}`);
    // 转身**不改锚点**：近战特效仍贴出手点。
    assert.ok(Math.abs(view.node.position.x - mapToViewX(100)) < 1e-6,
        `转身不该把特效挪走，实际 ${view.node.position.x}`);
    assert.ok(Math.abs(view.node.position.y - mapToViewY(100)) < 1e-6);

    // 反证：目标反过来站，转角必须差 180°。
    view.render(meleeEvent(220, 160, 100, 100, BOXER_EFFECT), 0.1, undefined, 1);
    const back = view.node.rotation.z;
    assert.ok(Math.abs(Math.abs(back - expected) - 180) < 1e-6,
        `目标换到另一侧，转角必须差 180°（改前这里恒 0），实际 ${back}`);

    // 未登记的特效：转角仍恒 0（与改前逐字一致）。
    view.render(meleeEvent(100, 100, 220, 160, 'units/projectiles/普攻爆炸/普攻爆炸'), 0.1, undefined, 1);
    assert.equal(view.node.rotation.z, 0, '没登记的特效不许被顺手转向');

    // ── 数据事实：这张图确实被两条行共用（转身对两边都成立）──
    const skills = readPvpRows('pvpSkill');
    const users = skills
        .filter((row) => row.effectPrefabPath === BOXER_EFFECT)
        .map((row) => Number(row.skillId))
        .sort((a, b) => a - b);
    assert.deepEqual(users, [30713, 30852], '普攻（melee）与能量光束（area）共用同一张图');
    assert.ok(readFileSync(join(ROOT, BOXER_PREFAB)).length > 0, '特效 prefab 要存在');
});
