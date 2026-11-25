import { formatBattleFloatAmount } from '../assets/script/core/math/CompactNumber';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadViews } from './helpers/zcds-view-fixtures';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { captureZCMatchConfig, type ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCDamageSource, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { assetPath } from './helpers/asset-paths';

/**
 * 战斗中扣血飘字的显示口径（2026-11-20 用户，同日二改）。
 *
 * > 「玩家造成的伤害用白色，出现暴击就用 1.7 倍大的数字字体，克制增伤也是白色，
 * >  只有受到其他玩家的攻击、玩家卡牌被扣除血量显示红色（负号+数字的表达形式 -5），
 * >  两个非玩家的卡牌对战只展示血条的变化，不展示具体的数字 UI」
 *
 * > 二改：「我方被 NPC 打和被另一个玩家打是**一个样式**，红字、无前缀、只有 -血量。」
 *
 * > 三改（2026-11-23）：「暴击时我方被扣血仍然按 1.7 倍字号放大」—— 挨打那条连放大也不要，
 * >  字号一并压平成默认号，`takenFromPlayer` 同时盖掉 kind 的颜色与字号。
 *
 * 拆成两层，各自钉死：
 *
 * | 层 | 判据 | 真源 |
 * | --- | --- | --- |
 * | 模型（谁打谁） | 非玩家互打 ⇒ 一条都不推；**本机席位被扣血**（攻方是谁都一样）⇒ `takenFromPlayer` | `ZCGameModel.floatTextToneOf` |
 * | 视图（怎么画） | 白字 / 红字 + 负号 + 默认字号 / 暴击 1.7 倍字号 / 克制白字；前缀与放大只在我方打出去时出现 | `ZCFloatTextView` |
 *
 * 🔴 「玩家」= 真人席位，不是「owner 是不是 player」：PVP 4 人局里另外三个席位也是真人，
 * 拿 owner 反推会让白色 / 红色两档都判错。真源是 `ZCMatchConfig.npcOwners`（关卡 PVE 才写）。
 */

const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus',
];

function rows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

loadPvpTables(Object.fromEntries(tableNames.map((name) => [name, rows(name)])) as unknown as ZCPvpTables);
configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));

interface IDamageHarness {
    spawnUnit(owner: ZCUnitState['owner'], card: ZCDeckCard, tier: number, hexId: number): ZCUnitState | null;
    damageUnit(target: ZCUnitState, damage: number, source: ZCDamageSource): unknown;
}

/**
 * 两个席位的对局：一个我方单位 + 一只敌方单位。
 * `npcOwners` 传了就是关卡 PVE（敌方是 NPC 队伍），不传就是 PVP 匹配（敌方也是真人）。
 */
function buildBattle(npcOwners?: readonly ZCOwner[]) {
    const base = captureZCMatchConfig();
    const config: ZCMatchConfig = captureZCMatchConfig(
        npcOwners ? { ...base, npcOwners } : base);
    const model = new ZCGameModel(null, () => .25, config);
    const combat = model as unknown as IDamageHarness;
    const playerCard = config.playerDeck.find((card) => card.unitId);
    const enemyCard = config.enemyDeck.find((card) => card.unitId);
    assert.ok(playerCard && enemyCard, '需要双方各一张能出兵的卡');
    const playerUnit = combat.spawnUnit('player', playerCard, 1, config.map.playerHomeId);
    const enemyUnit = combat.spawnUnit('enemy', enemyCard, 1, config.map.enemyHomeId);
    assert.ok(playerUnit && enemyUnit, '双方各要有一只单位当靶子');
    return { model, combat, playerUnit, enemyUnit };
}

const PLAYER_HIT: ZCDamageSource = { owner: 'player', kind: 'unit' };
const ENEMY_HIT: ZCDamageSource = { owner: 'enemy', kind: 'unit' };
/** 中立野怪打人走的就是这一支（见 `ZCGameModel` 里 `neutralFeatures` 的 `damageUnit` 回调）。*/
const MONSTER_HIT: ZCDamageSource = { owner: 'neutral', kind: 'building' };

test('玩家打 NPC：白字，不带负号（takenFromPlayer 缺省）', () => {
    const { model, combat, playerUnit, enemyUnit } = buildBattle();
    combat.damageUnit(enemyUnit, 5, { ...PLAYER_HIT, unitId: playerUnit.id });
    const text = model.floatTexts.at(-1);
    assert.ok(text, '玩家造成的伤害要出数字');
    assert.equal(text.kind, 'damage');
    assert.equal(text.value, 5);
    assert.equal(text.takenFromPlayer, undefined, '只有「我方被扣血」才走红字负号');
});

test('两个非玩家互打：一条飘字都不推，只留血条变化', () => {
    // 关卡 PVE 里 `enemy` 才是 NPC；PVP 局里它是真人席位，不适用这条。
    const { model, combat, enemyUnit } = buildBattle(['enemy']);
    const before = model.floatTexts.length;
    // 中立野怪 vs 敌方波次怪：两边都不是真人席位。
    combat.damageUnit(enemyUnit, 5, MONSTER_HIT);
    assert.equal(model.floatTexts.length, before, '非玩家互打不许出数字');
});

test('关卡 PVE：NPC 打我方卡同样是红字负号（和 PVP 挨打一个样式）', () => {
    // 2026-11-20 二改用户口径：「我方被 NPC 打和被另一个玩家打是一个样式，
    // 红字、无前缀、只有 -血量」。攻方是不是玩家**不参与**这一判定。
    const { model, combat, playerUnit, enemyUnit } = buildBattle(['enemy']);
    combat.damageUnit(playerUnit, 5, { ...ENEMY_HIT, unitId: enemyUnit.id });
    const text = model.floatTexts.at(-1);
    assert.ok(text, '塔防里整局都是 NPC 在打我方卡，数字要照常出');
    assert.equal(text.takenFromPlayer, true, '我方被扣血：不分攻方，统一红字负号');
    assert.equal(text.dealtByPlayer, undefined, 'NPC 打出来的不带前缀');

    // 反过来：我方打 NPC 仍然是白字无负号。
    combat.damageUnit(enemyUnit, 5, { ...PLAYER_HIT, unitId: playerUnit.id });
    const mine = model.floatTexts.at(-1);
    assert.ok(mine);
    assert.equal(mine.takenFromPlayer, undefined, '我方打出去不是红字');
});

test('PVP：玩家卡被另一个玩家扣血 ⇒ 红字负号（暴击同样是这一档）', () => {
    const { model, combat, playerUnit, enemyUnit } = buildBattle();
    combat.damageUnit(playerUnit, 5, { ...ENEMY_HIT, unitId: enemyUnit.id });
    const plain = model.floatTexts.at(-1);
    assert.ok(plain);
    assert.equal(plain.takenFromPlayer, true);
    assert.equal(plain.kind, 'damage');

    // 暴击不改口径：颜色照旧走红、字号也不放大（视图层 takenFromPlayer 压平）。
    combat.damageUnit(playerUnit, 7, {
        ...ENEMY_HIT, unitId: enemyUnit.id, floatTextKind: 'critical',
    });
    const crit = model.floatTexts.at(-1);
    assert.ok(crit);
    assert.equal(crit.kind, 'critical');
    assert.equal(crit.takenFromPlayer, true, '被别的玩家暴击也要红字负号');
});

test('前缀只标我方战果：玩家打 NPC 带标记，NPC 打我方卡不带', () => {
    const { model, combat, playerUnit, enemyUnit } = buildBattle(['enemy']);
    combat.damageUnit(enemyUnit, 5, { ...PLAYER_HIT, unitId: playerUnit.id, floatTextKind: 'restraint' });
    const mine = model.floatTexts.at(-1);
    assert.ok(mine);
    assert.equal(mine.kind, 'restraint');
    assert.equal(mine.dealtByPlayer, true, '我方对别人造成伤害才带暴击 / 克制 / 抵抗标记');
    assert.equal(mine.takenFromPlayer, undefined, '打别人不是红字');

    combat.damageUnit(playerUnit, 5, { ...ENEMY_HIT, unitId: enemyUnit.id, floatTextKind: 'restraint' });
    const theirs = model.floatTexts.at(-1);
    assert.ok(theirs, 'NPC 打我方卡照常出数字');
    assert.equal(theirs.kind, 'restraint', '档位照旧（颜色 / 字号还要用）');
    assert.equal(theirs.dealtByPlayer, undefined, 'NPC 打出来的不带【克】');
    assert.equal(theirs.takenFromPlayer, true, '我方被扣血 ⇒ 红字负号（不分攻方）');
});

test('PVP 被另一个玩家扣血：不带任何前缀，只有负号 + 血量', () => {
    const { model, combat, playerUnit, enemyUnit } = buildBattle();
    combat.damageUnit(playerUnit, 6, { ...ENEMY_HIT, unitId: enemyUnit.id, floatTextKind: 'restraint' });
    const text = model.floatTexts.at(-1);
    assert.ok(text);
    assert.equal(text.kind, 'restraint', '档位照旧，颜色 / 字号还要用');
    assert.equal(text.takenFromPlayer, true);
    assert.equal(text.dealtByPlayer, undefined, '我方被扣血不带【克】');
});

/** 视图夹具：`cc` 全桩，曲线转发真模块（同 `zcds-float-text-gold-*` 的做法）。*/
function createView() {
    class Color {
        constructor(public r = 0, public g = 0, public b = 0, public a = 255) {}
        set(r: number, g: number, b: number, a = 255) {
            this.r = r; this.g = g; this.b = b; this.a = a;
            return this;
        }
    }
    class UIOpacity { opacity = 255; }
    class UITransform { width = 0; }
    const cc = {
        _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
        Component: class {}, Label: class {}, Sprite: class {}, Color, UIOpacity, UITransform,
    };
    const compiled = ts.transpileModule(
        readFileSync('assets/script/app/zcds/view/ZCFloatTextView.ts', 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true } },
    ).outputText;
    const util = loadViews().load('./ZCGameViewUtil');
    const loaded = { exports: {} as Record<string, any> };
    new Function('require', 'module', 'exports', compiled)((name: string) => {
        if (name === 'cc') return cc;
        if (name.endsWith('/CompactNumber')) return { formatBattleFloatAmount };
        assert.equal(name, './ZCGameViewUtil');
        return { ...util, mapToViewX: (x: number) => x, mapToViewY: (y: number) => y };
    }, loaded, loaded.exports);

    /** Text 子节点每帧的局部坐标（`[x, y, z]`）：纵向两档只差符号，靠它逐帧比。*/
    const positions: Array<[number, number, number]> = [];
    const textNode = {
        // Text 的 UITransform：模拟「引擎已在上一帧按文字内容刷新过」。
        getComponent: (type: unknown) => (type === UITransform ? { width: 40 } : null),
        setPosition: (...args: unknown[]) => { positions.push(args as [number, number, number]); },
        setScale: () => {},
    };
    const prefixNode = { active: true, setPosition() {} };
    const view = new loaded.exports.ZCFloatTextView();
    view.node = { setPosition() {} };
    view.textLabel = { string: '', fontSize: 30, color: null, enabled: true, node: textNode };
    view.prefixLabel = { string: '', fontSize: 15, color: null, enabled: true, node: prefixNode };
    return { view, textLabel: view.textLabel, prefixLabel: view.prefixLabel, positions };
}

/** 一条伤害飘字；`durationSeconds` 1s ⇒ 取 `now = 0.2` 落在入场段内（还看得见）。 */
function damageText(over: Record<string, unknown> = {}) {
    // 缺省当成「我方打出去的」：前缀闸门看 `dealtByPlayer`，不补这个字段就一条前缀都不出。
    return { id: 1, kind: 'damage', owner: 'player', value: 16, x: 0, y: 0, startedAt: 0, durationSeconds: 1, dealtByPlayer: true, ...over } as never;
}

const WHITE = [255, 255, 255];
const RED = [255, 72, 62];

test('伤害数字：普通 / 克制都是白字，暴击白字且字号 1.7 倍', () => {
    const { view, textLabel } = createView();
    const size = () => (textLabel as unknown as { fontSize: number }).fontSize;
    const rgb = () => {
        const color = (textLabel as unknown as { color: { r: number; g: number; b: number } }).color;
        return [color.r, color.g, color.b];
    };
    const prefixOf = () => (view.prefixLabel as unknown as { string: string; node: { active: boolean } });

    view.render(damageText(), 0.2);
    assert.equal((textLabel as unknown as { string: string }).string, '16');
    assert.deepEqual(rgb(), WHITE, '普通伤害白字');
    assert.equal(size(), 30);
    assert.equal(prefixOf().string, '', '普通伤害没有前缀');

    for (const [value, expected] of [[999.1, '1K'], [1_250, '1.3K'], [100_500, '101K'], [1e9, '1B'], [1e12, '1T']] as const) {
        view.render(damageText({ value }), 0.2);
        assert.equal((textLabel as unknown as { string: string }).string, expected);
    }

    view.render(damageText({ kind: 'restraint' }), 0.2);
    assert.deepEqual(rgb(), WHITE, '克制增伤也是白字');
    assert.equal(size(), 30, '克制不放大，靠「克制」前缀区分');
    assert.equal(prefixOf().string, '克制', '我方打出去的克制增伤要挂【克制】');
    assert.equal(prefixOf().node.active, true);

    view.render(damageText({ kind: 'critical' }), 0.2);
    assert.deepEqual(rgb(), WHITE, '暴击只改字号，颜色仍是白');
    assert.equal(size(), 51, '暴击字号 = 30 × 1.7');
    assert.equal(prefixOf().string, '暴击');
    assert.equal(prefixOf().node.active, true);
});

test('玩家卡被别的玩家扣血：红字 + 负号，暴击也不放大，且一律不带前缀', () => {
    const { view, textLabel } = createView();
    const label = textLabel as unknown as {
        string: string; fontSize: number; color: { r: number; g: number; b: number };
    };

    view.render(damageText({ takenFromPlayer: true }), 0.2);
    assert.equal(label.string, '-16', '负号拼进数值，与数字同字号连成「-5」');
    assert.deepEqual([label.color.r, label.color.g, label.color.b], RED);
    assert.equal(label.fontSize, 30);

    // 2026-11-23 用户：「暴击时我方被扣血仍然按 1.7 倍字号放大」—— 这一档连放大也不要。
    // 挨打那条只说「我掉了多少血」，放大数字会被读成「我方打出暴击」。
    view.render(damageText({ takenFromPlayer: true, kind: 'critical' }), 0.2);
    assert.equal(label.string, '-16');
    assert.equal(label.fontSize, 30, '我方被暴击击中的字号与普通挨打一样');
    assert.deepEqual([label.color.r, label.color.g, label.color.b], RED, '红字优先于 kind 取色');

    for (const kind of ['critical', 'execute']) {
        view.render(damageText({ takenFromPlayer: true, kind }), 0.2);
        assert.equal(label.fontSize, 30, `我方被 ${kind} 击中不许放大字号`);
    }

    // 2026-11-20 用户：「我方被伤害扣血的 UI 只有 负号 + 血量」。
    // 暴击 / 克制 / 抵抗 / 秒杀 都是我方的战果标记，被打到的那一下一个都不许挂。
    const prefix = view.prefixLabel as unknown as { string: string; node: { active: boolean } };
    assert.equal(prefix.string, '', '被扣血时前缀必须清空');
    assert.equal(prefix.node.active, false, '被扣血时前缀节点要藏掉（空串虽不显示，但别留旧文案）');

    for (const kind of ['critical', 'restraint', 'resisted', 'execute']) {
        view.render(damageText({ takenFromPlayer: true, kind }), 0.2);
        assert.equal((view.prefixLabel as unknown as { string: string }).string, '',
            `被扣血的 ${kind} 不许带前缀`);
        assert.equal((view.prefixLabel as unknown as { node: { active: boolean } }).node.active, false);
    }
});

test('我方被 NPC 打：红字 + 负号，同样不带【克制】【暴击】', () => {
    // 塔防局里整局都是 NPC 在打我方卡；按 kind 直接出前缀的话屏幕上全是标记。
    const { view, textLabel } = createView();
    const label = textLabel as unknown as { string: string; color: { r: number; g: number; b: number } };
    for (const kind of ['critical', 'restraint', 'resisted', 'execute']) {
        // NPC 打我方的真实形状：`takenFromPlayer`（模型按席位判）+ 没有 `dealtByPlayer`。
        view.render(damageText({ kind, takenFromPlayer: true, dealtByPlayer: undefined }), 0.2);
        const prefix = view.prefixLabel as unknown as { string: string; node: { active: boolean } };
        assert.equal(prefix.node.active, false, `${kind}：NPC 打出来的不许带前缀`);
        assert.equal(label.string, '-16', `${kind}：我方被扣血只有负号 + 血量`);
        assert.deepEqual([label.color.r, label.color.g, label.color.b], RED, `${kind}：和 PVP 挨打同一个红`);
    }
});

test('红色只认 takenFromPlayer：同样的暴击，没人打玩家卡就还是白字', () => {
    const { view, textLabel } = createView();
    view.render(damageText({ kind: 'critical' }), 0.2);
    const color = (textLabel as unknown as { color: { r: number; g: number; b: number } }).color;
    assert.deepEqual([color.r, color.g, color.b], WHITE);
    assert.equal((textLabel as unknown as { string: string }).string, '16', '没有负号');
});

/**
 * 纵向两档（2026-11-23 用户）：
 *
 * > 「战斗中，玩家方造成的伤害数字是往上飞的，运动路径和现在的相反，
 * >  受到伤害的数字运动路径保持不变」
 *
 * 判据用模型已经给好的两个正交标记（视图不拿 `owner` 反推，理由见 `damageTravelSign`）：
 * · `dealtByPlayer` ⇒ 向上飞；
 * · `takenFromPlayer` ⇒ 原样向下坠。
 *
 * 两档**只有纵向符号相反** —— 起点、总距离、入场时序、轨道行距、弹出缩放全共用，
 * 所以这里钉的第一件事是「逐拍互为镜像」，不是两条各写一套数字：
 * 各自写一套的话，哪天有人只调了其中一条的距离 / 时序，用例还是会绿。
 */
test('我方造成的伤害数字向上飞，挨打那条保持向下坠（路径互为镜像）', () => {
    const { view, positions } = createView();
    const entrance = view.entranceProgress;
    // 采样点覆盖：入场起点 / 入场四分之一 / 半程 / 入场结束 / 淡出中段 / 结束，全是「看得见」的拍子。
    const samples = [0, entrance * 0.25, entrance * 0.5, entrance, 0.7, 1];
    const track = (over: Record<string, unknown>) => samples.map((now) => {
        positions.length = 0;
        view.render(damageText(over), now);
        assert.equal(positions.length, 1, '每帧只写一次 Text 子节点位置');
        return positions[0][1];
    });
    const headY = view.damageTargetSize * 0.5 + view.damageHeadPadding;

    // ① 逐拍方向 + 镜像。`id` 决定轨道：1 ⇒ 第 0 行，7 ⇒ 第 1 行（行距 30 也要跟着镜像）。
    for (const id of [1, 7]) {
        const up = track({ id, dealtByPlayer: true });
        const down = track({ id, dealtByPlayer: undefined, takenFromPlayer: true });
        assert.ok(up[0] >= headY, `起点不许低于目标头顶（实际 ${up[0]} < ${headY}）`);
        assert.equal(up[0], down[0], '两档起点必须是同一个点（头顶 + 轨道行距），只差方向');
        for (let i = 1; i < samples.length; i += 1) {
            assert.ok(up[i] > up[i - 1],
                `id=${id} 第 ${i} 拍：我方造成的那条必须越飘越高（${up[i]} ≤ ${up[i - 1]}）`);
            assert.ok(down[i] < down[i - 1],
                `id=${id} 第 ${i} 拍：挨打那条保持向下坠（${down[i]} ≥ ${down[i - 1]}）`);
            assert.ok(Math.abs(up[i] + down[i] - 2 * up[0]) < 1e-9,
                `id=${id} 第 ${i} 拍：两档必须互为镜像（${up[i]} / ${down[i]} 之和应 = ${2 * up[0]}）`);
        }
    }

    // ② 幅度：入场段走满 damageDropDistance，慢出段沿**同一方向**再漂 driftDistance。
    const atEntrance = samples.indexOf(entrance);
    const up = track({ id: 1, dealtByPlayer: true });
    const down = track({ id: 1, dealtByPlayer: undefined, takenFromPlayer: true });
    assert.ok(Math.abs(up[0] - headY) < 1e-9, '第 0 行的起点就是目标头顶（行距 0）');
    assert.ok(Math.abs((up[atEntrance] - up[0]) - view.damageDropDistance) < 1e-6,
        `入场段上浮量应等于 damageDropDistance（实际 ${(up[atEntrance] - up[0]).toFixed(4)}）`);
    assert.ok(Math.abs((up.at(-1)! - up[atEntrance]) - view.driftDistance) < 1e-6,
        `慢出段应继续上浮 driftDistance（实际 ${(up.at(-1)! - up[atEntrance]).toFixed(4)}）`);
    assert.ok(Math.abs((down[0] - down[atEntrance]) - view.damageDropDistance) < 1e-6,
        `挨打那条的下坠量仍是 damageDropDistance（实际 ${(down[0] - down[atEntrance]).toFixed(4)}）`);
    assert.ok(Math.abs((down[atEntrance] - down.at(-1)!) - view.driftDistance) < 1e-6,
        `挨打那条的下沉收尾仍是 driftDistance（实际 ${(down[atEntrance] - down.at(-1)!).toFixed(4)}）`);

    // ③ 不带任何标记的伤害文本（`heal` / `miss` / 别的用例里的裸伤害）保持旧行为：向下。
    //    运行时不会出现「非玩家互打的伤害」—— 那条模型侧直接不推飘字，所以这是纯兼容位。
    assert.deepEqual(track({ id: 1, dealtByPlayer: undefined, takenFromPlayer: undefined }), down,
        '无标记 == 挨打那条的路径，旧行为一个像素都不动');
});

test('两个标记同时出现时以 takenFromPlayer 为准（挨打那档）：两个方向不许打架', () => {
    // 理论上不会出现「我方打我方」，但真出现了必须有确定答案：
    // 红字负号那档说的是「我掉了多少血」，方向、颜色、字号、负号要跟着同一档语义走。
    const { view, positions } = createView();
    const yAt = (now: number) => {
        positions.length = 0;
        view.render(damageText({ dealtByPlayer: true, takenFromPlayer: true }), now);
        return positions[0][1];
    };
    const entrance = view.entranceProgress;
    assert.ok(yAt(entrance) < yAt(0), '有 takenFromPlayer ⇒ 向下，不被 dealtByPlayer 翻上去');
});

