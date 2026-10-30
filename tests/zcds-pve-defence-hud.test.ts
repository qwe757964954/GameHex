import { componentControllerModule } from './helpers/controller-context';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { ZCBattlePhase, ZCBattlePhaseController } from '../assets/script/app/zcds/application/ZCBattlePhaseController';

/**
 * 守城（塔防）HUD 首领条那两块文字的格式口径。
 *
 * 口径来自蓝湖「BOSS」稿：面板**没有深色底板**，字直接压在地图沙地上 ⇒ 白字 + 黑描边；
 * 波次只留一行 `第4/8波`，血条上再压一个 `X4`（该波血量倍率）。
 *
 * 这两个格式化函数 2026-10-13 从 `ZCDefenceWaveText.ts` 并进了 `ZCHudBossPanel.ts`，所以这里
 * 不能裸 `import`（那个模块 import 了 `cc`）—— 走「工程真源 + cc 桩」加载，与
 * `tests/zcds-hud.test.ts` 的 `loadPureModule`（它跑的是 `ZCGameHudScoreSlot`）同一套做法。
 */
const STUB_CC = {
    // ⚠️ `ccclass` 必须返回**装饰器函数**：`@ccclass('X')` 展开成 `__decorate([ccclass('X')], Y)`，
    //    直接把入参字符串返回会让 `__decorate` 拿字符串当函数调 ⇒ 抛 `d is not a function`。
    _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
    Component: class {},
    Label: class {},
    Sprite: class {},
    SpriteFrame: class {},
};

function loadBossPanel(): typeof import('../assets/script/app/zcds/view/ZCHudBossPanel') {
    const source = readFileSync('assets/script/app/zcds/view/ZCHudBossPanel.ts', 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            experimentalDecorators: true,
        },
    }).outputText;
    const module = { exports: {} as never };
    new Function('require', 'module', 'exports', code)((name: string) => {
        // 并进来之后这个模块**只该**依赖 cc：模型那边是 `import type`（转译后消失）。
        // 多出别的运行时依赖就说明这里加载的方式不再成立，要当场暴露而不是装没看见。
        assert.equal(name, 'cc', `ZCHudBossPanel 不该有 cc 之外的运行时依赖：${name}`);
        return STUB_CC;
    }, module, module.exports);
    return module.exports;
}

const panel = loadBossPanel();

/** 只关心格式化用的那几个字段，其余给合理默认。 */
const wave = (over: Record<string, unknown> = {}) => ({
    totalWaves: 8,
    spawnedWaves: 4,
    currentWaveId: 4,
    nextWaveId: 5,
    secondsUntilNextWave: 2,
    aliveEnemies: 0,
    currentWaveHp: 300,
    currentWaveMaxHp: 400,
    currentWaveHpRate: 4,
    currentWaveCardId: '68010',
    ...over,
}) as never;

test('波次徽标只有一行 `第N/M波`，字号与描边取自设计稿量测', () => {
    assert.deepEqual(panel.formatZCDefenceWaveText(wave()), {
        text: '第4/8波',
        fontSize: 32,
        lineHeight: 38,
        outlineWidth: 3,
    });
});

test('波次徽标：开波前是第 0/M 波，最后一波也不会越界', () => {
    assert.equal(panel.formatZCDefenceWaveText(wave({ spawnedWaves: 0, currentWaveId: null })).text, '第0/8波');
    assert.equal(panel.formatZCDefenceWaveText(wave({ spawnedWaves: 8, nextWaveId: null })).text, '第8/8波');
});

test('血量倍率徽标：整数不带小数点，非法值退回 X1', () => {
    assert.equal(panel.formatZCDefenceHpRate(4), 'X4');
    assert.equal(panel.formatZCDefenceHpRate(1), 'X1');
    assert.equal(panel.formatZCDefenceHpRate(1.4), 'X1.4');
    assert.equal(panel.formatZCDefenceHpRate(2.25), 'X2.25');
    assert.equal(panel.formatZCDefenceHpRate(0), 'X1');
    assert.equal(panel.formatZCDefenceHpRate(-3), 'X1');
    assert.equal(panel.formatZCDefenceHpRate(Number.NaN), 'X1');
});

test('波次头像从本局所有席位和完整卡表获取，并按当前波切换', async () => {
    const exports: { ZCGame?: typeof import('../assets/script/app/zcds/ZCGame').ZCGame } = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    const frames = { a: { id: 'a', isValid: true }, b: { id: 'b', isValid: true } };
    runInNewContext(code, { exports, require: (name: string) => {
            if (name.endsWith('/ComponentController')) return componentControllerModule();
        if (name === 'cc') return STUB_CC;
        if (name === './application/ZCBattlePhaseController') return { ZCBattlePhase, ZCBattlePhaseController };
        if (name.endsWith('/SpriteFrameCache')) return { createIconLoader: () => async () => null };
        if (name === '../HeadArt') return { HeadArt: { loadIconArtResolver: async () => ({}), loadHeadIconFrame: async (key: 'a' | 'b') => frames[key] } };
        if (name === './model/ZCMapConfig') return { ZCOwner: { Player: 'player' }, ZC_OWNER_ORDER: ['player', 'enemy', 'enemy2', 'enemy3'] };
        if (name === './model/ZCCombatCatalog') return { getEnemyDeck: () => [{ id: '2', name: '怪二', headIcon: 'b' }] };
        return {};
    } });
    const game = new exports.ZCGame!();
    Object.assign(game, { matchConfig: { playerDeck: [], enemyDeck: [], ownerDecks: {
        player: [{ id: '1', name: '怪一', headIcon: 'a' }], enemy: [],
    } }, isValid: true });
    Reflect.get(game, 'loadDefenceBossArt').call(game);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const portraits = Reflect.get(game, 'bossPortraits') as Map<string, unknown>;
    assert.equal(portraits.get('1'), frames.a, '本局其他席位的波次怪应有头像');
    assert.equal(portraits.get('2'), frames.b, '完整卡表的波次怪应有头像');

    const boss = new panel.ZCHudBossPanel();
    Object.assign(boss, { hpFill: {}, waveLabel: {}, rateLabel: {}, nameLabel: {}, portraitIcon: {} });
    boss.render(wave({ currentWaveCardId: '1' }), '怪一', frames.a as never);
    assert.equal(boss.portraitIcon.spriteFrame, frames.a);
    boss.render(wave({ currentWaveCardId: '2' }), '怪二', null);
    assert.equal(boss.portraitIcon.spriteFrame, null, '新波头像尚未加载时不能显示上一波的怪');
    boss.render(wave({ currentWaveCardId: '2' }), '怪二', frames.b as never);
    assert.equal(boss.portraitIcon.spriteFrame, frames.b);
});

test('战斗主循环按 HUD 节奏刷新首领血条，受伤清零和换波都更新面板', () => {
    const exports: { ZCGame?: typeof import('../assets/script/app/zcds/ZCGame').ZCGame } = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, require: (name: string) => {
            if (name.endsWith('/ComponentController')) return componentControllerModule();
        if (name === 'cc') return STUB_CC;
        if (name === './application/ZCBattlePhaseController') return { ZCBattlePhase, ZCBattlePhaseController };
        return {};
    } });
    assert.ok(exports.ZCGame);
    const game = new exports.ZCGame();
    Object.assign(game, { isValid: true });
    (Reflect.get(game, 'phase') as ZCBattlePhaseController).startPlaying();
    const boss = new panel.ZCHudBossPanel();
    const hpFill = { fillRange: 1 };
    const waveLabel = { string: '' };
    const rateLabel = { string: '' };
    Object.assign(boss, { hpFill, waveLabel, rateLabel, nameLabel: { string: '' }, portraitIcon: {} });
    const progress = { totalWaves: 8, spawnedWaves: 1, currentWaveId: 1, nextWaveId: 2,
        secondsUntilNextWave: 1, aliveEnemies: 2, currentWaveHp: 50, currentWaveMaxHp: 100,
        currentWaveHpRate: 4, currentWaveCardId: '68010' };
    const model = { snapshot: { status: 'playing' }, defenceWaveProgress: progress, tick() {},
        createRenderFrame: () => ({}), drainPresentationEvents: () => ({}) };
    let hudRenders = 0;
    Object.assign(game, { model, bossPanel: boss, hudView: { render() { hudRenders++; } },
        renderWorld: { renderDynamic() {}, renderStatic() {} } });
    game.update(0.1);
    assert.equal(hpFill.fillRange, 1, '节流窗口内不额外刷新 HUD');
    game.update(0.05);
    assert.equal(hudRenders, 1);
    assert.equal(hpFill.fillRange, 0.5, '受伤后血条必须随普通 HUD 同步刷新');
    progress.currentWaveHp = 0;
    game.update(0.15);
    assert.equal(hpFill.fillRange, 0, '当前波死亡后显示空条');
    Object.assign(progress, { spawnedWaves: 2, currentWaveId: 2, currentWaveHp: 900,
        currentWaveMaxHp: 900, currentWaveHpRate: 8 });
    game.update(0.15);
    assert.equal(hpFill.fillRange, 1, '新波次恢复为该波真实血量');
    assert.equal(waveLabel.string, '第2/8波');
    assert.equal(rateLabel.string, 'X8');
});
