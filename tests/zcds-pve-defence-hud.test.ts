import { componentControllerModule } from './helpers/controller-context';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';

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
    currentWaveIsBoss: true,
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

test('波次徽标：开波前按第一波显示，最后一波也不会越界', () => {
    //  徽标常驻（2026-11-09）：一开场就要有「第1/M波」，不能出现「第0/8波」。
    assert.equal(panel.formatZCDefenceWaveText(wave({ spawnedWaves: 0, currentWaveId: null })).text, '第1/8波');
    assert.equal(panel.formatZCDefenceWaveText(wave({ spawnedWaves: 1 })).text, '第1/8波');
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
        if (name.endsWith('/SpriteFrameCache')) return { createIconLoader: () => async () => null };
        if (name === '../HeadArt') return { HeadArt: { loadIconArtResolver: async () => ({}), loadHeadIconFrame: async (key: 'a' | 'b') => frames[key] } };
        if (name === './model/ZCMapConfig') return { ZCOwner: { Player: 'player' }, ZC_OWNER_ORDER: ['player', 'enemy', 'enemy2', 'enemy3'] };
        if (name === './model/ZCCombatCatalog') return { getEnemyDeck: () => [{ id: '2', name: '怪二', headIcon: 'b' }] };
        return {};
    } });
    const game = new exports.ZCGame!();
    Object.assign(game, { matchConfig: { playerDeck: [], enemyDeck: [], ownerDecks: {
        player: [{ id: '1', name: '怪一', headIcon: 'a' }], enemy: [],
    } }, presentationResources: { configs: {} }, isValid: true });
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

test('守城波次面板常驻：普通波与 BOSS 波均显示头像和总血条', () => {
    const created: unknown[] = [];
    const destroyed: string[] = [];
    const barVisible: boolean[] = [];
    const exports: { ZCGame?: typeof import('../assets/script/app/zcds/ZCGame').ZCGame } = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, require: (name: string) => {
            if (name.endsWith('/ComponentController')) return componentControllerModule();
        if (name === 'cc') return {
            ...STUB_CC,
            instantiate: (prefab: unknown) => {
                created.push(prefab);
                return {
                    layer: 0, setParent() {},
                    getComponent: () => ({
                        render() {},
                        setBossBarVisible: (visible: boolean) => barVisible.push(visible),
                    }),
                };
            },
        };
        return {};
    } });
    const game = new exports.ZCGame!();
    const prefab = { name: 'ZCBossPanel' };
    Object.assign(game, {
        isValid: true,
        preparedResources: { bossPanelPrefab: prefab },
        hudView: { node: { layer: 1, setParent() {}, destroy() {} } },
    });
    const render = (progress: Record<string, unknown> | null) => Reflect.get(game, 'renderBossPanel')
        .call(game, { defenceWaveProgress: progress });

    // 第一波尚未生成：徽标常驻，头像与总血条等待当前波数据。
    render({ ...wave({ currentWaveId: null, currentWaveIsBoss: false, spawnedWaves: 0 }) });
    assert.deepEqual(created, [prefab]);
    assert.deepEqual(barVisible, [false]);

    // 普通小怪波也要显示当前波的头像与总血条。
    render({ ...wave({ currentWaveIsBoss: false, spawnedWaves: 1 }) });
    assert.deepEqual(created, [prefab], '第一波起就要有波次徽标');
    assert.deepEqual(barVisible, [false, true], '普通波也必须显示头像和总血条');

    // BOSS 波：同一块面板复用，血条组点亮（不重建）。
    render(wave({ currentWaveIsBoss: true }));
    assert.deepEqual(created, [prefab], '同局不重建面板');
    assert.deepEqual(barVisible, [false, true, true]);

    // 回到普通波，头像与总血条继续显示。
    render({ ...wave({ currentWaveIsBoss: false }) });
    assert.deepEqual(barVisible, [false, true, true, true]);
    assert.deepEqual(destroyed, [], '面板不销毁，徽标要一直挂着');

    // 非守城局（没有波次进度）：面板销毁。
    Object.assign(Reflect.get(game, 'bossPanel'), { node: { destroy: () => destroyed.push('panel') } });
    render(null);
    assert.deepEqual(destroyed, ['panel']);
    assert.equal(Reflect.get(game, 'bossPanel'), null);
});

test('战斗主循环按 HUD 节奏刷新首领血条，受伤清零和换波都更新面板', () => {
    const exports: { ZCGame?: typeof import('../assets/script/app/zcds/ZCGame').ZCGame } = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, require: (name: string) => {
            if (name.endsWith('/ComponentController')) return componentControllerModule();
        if (name === 'cc') return STUB_CC;
        return {};
    } });
    assert.ok(exports.ZCGame);
    const game = new exports.ZCGame();
    Object.assign(game, { isValid: true });
    const boss = new panel.ZCHudBossPanel();
    // `setBossBarVisible` 会摸头像 / 名字 / 血条的 `node`，夹具要给出可写的 active。
    const portraitNode = { active: true };
    const nameNode = { active: true };
    const barNode = { active: true };
    const hpFill = { fillRange: 1, node: { parent: barNode } };
    const waveLabel = { string: '' };
    const rateLabel = { string: '' };
    Object.assign(boss, {
        hpFill, waveLabel, rateLabel,
        nameLabel: { string: '', node: nameNode },
        portraitIcon: { node: portraitNode },
    });
    const progress = { totalWaves: 8, spawnedWaves: 1, currentWaveId: 1, nextWaveId: 2,
        secondsUntilNextWave: 1, aliveEnemies: 2, currentWaveHp: 50, currentWaveMaxHp: 100,
        currentWaveHpRate: 4, currentWaveCardId: '68010', currentWaveIsBoss: true };
    const model = { snapshot: { status: 'playing' }, defenceWaveProgress: progress, tick() {},
        createRenderFrame: () => ({}), drainPresentationEvents: () => ({}) };
    let hudRenders = 0;
    Object.assign(game, { model, bossPanel: boss, hudView: { render() { hudRenders++; } },
        renderWorld: { renderDynamic() {}, renderStatic() {} } });
    Reflect.get(game, 'renderBattle').call(game, model, {}, {}, 'dynamic');
    assert.equal(hpFill.fillRange, 1, '节流窗口内不额外刷新 HUD');
    Reflect.get(game, 'renderBattle').call(game, model, {}, {}, 'static');
    assert.equal(hudRenders, 1);
    assert.equal(hpFill.fillRange, 0.5, '受伤后血条必须随普通 HUD 同步刷新');
    assert.equal(barNode.active, true, 'BOSS 波血条组要亮');
    progress.currentWaveHp = 0;
    Reflect.get(game, 'renderBattle').call(game, model, {}, {}, 'static');
    assert.equal(hpFill.fillRange, 0, '当前波死亡后显示空条');
    Object.assign(progress, { spawnedWaves: 2, currentWaveId: 2, currentWaveHp: 900,
        currentWaveMaxHp: 900, currentWaveHpRate: 8 });
    Reflect.get(game, 'renderBattle').call(game, model, {}, {}, 'static');
    assert.equal(hpFill.fillRange, 1, '新波次恢复为该波真实血量');
    assert.equal(waveLabel.string, '第2/8波');
    assert.equal(rateLabel.string, 'X8');
});
