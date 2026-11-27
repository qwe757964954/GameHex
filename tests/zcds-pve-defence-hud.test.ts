import { componentControllerModule } from './helpers/controller-context';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import * as outcomeStyle from '../assets/script/app/zcds/model/ZCSettlementOutcomeStyle';

/**
 * 守城（塔防）HUD 首领条那两块文字的格式口径。
 *
 * 口径来自蓝湖「BOSS」稿：面板**没有深色底板**，字直接压在地图沙地上 ⇒ 白字 + 黑描边；
 * 波次只留一行 `第4/8波`，血条上再压一个 `X4`（该波血量倍率）。
 *
 * 这两个格式化函数 2026-10-13 从 `ZCDefenceWaveText.ts` 并进了 `ZCHudBossPanel.ts`，所以这里
 * 不能裸 `import`（那个模块 import 了 `cc`）—— 走「工程真源 + cc 桩」加载，与
 * `tests/zcds-hud.test.ts` 的 `loadPureModule`（它跑的是 `ZCGameHudScoreSlot`）同一套做法。
 *
 * 🔴 2026-11-20 恢复：塔防「大血条」（头像框 / 名字 / 总血条）只在 BOSS 波显示，
 * 非 BOSS 怪不展示（SVN 合并曾把 `currentWaveIsBoss` 判据回退成 `currentWaveId !== null`）；
 * 波次徽标 `第N/M波` 仍从第一波起常驻，两条口径互不干涉。
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

/**
 * 把 `ZCGame` 真源灌进 vm 实例化（`cc` 与展示资源全走桩）。
 *
 * 与下面几条既有用例里内联的那份是同一套做法；新用例共用这一份，免得再抄第三份。
*/
function loadGameModule(): typeof import('../assets/script/app/zcds/ZCGame') {
    const exports: { ZCGame?: typeof import('../assets/script/app/zcds/ZCGame').ZCGame } = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, require: (name: string) => {
            if (name.endsWith('/ComponentController')) return componentControllerModule();
        if (name === 'cc') return STUB_CC;
        //  `ZCGame` 结算分支会按状态决定播不播胜负 UI 特效。这里给**真模块**：映射函数
        //  是纯的，而 `settlementOutcomeSkeleton` 在桩实例上恒为 null ⇒ 走到 `if (!data) return`
        //  就停，不会去建节点。若给 `{}`，`playOutcomeEffect` 会抛 `is not a function`，
        //  把「扣血 → 扫场」的顺序用例整条带红（2026-11-25 加特效时踩到）。
        if (name === './model/ZCSettlementOutcomeStyle') return outcomeStyle;
        return {};
    } });
    return exports as typeof import('../assets/script/app/zcds/ZCGame');
}

/** 造一块能写 `fillRange` 的首领条（三个文字/头像引用按 `ZCHudBossPanel.render` 的写法给足）。*/
function bossPanelFixture(): { panel: InstanceType<typeof panel.ZCHudBossPanel>; hpFill: { fillRange: number } } {
    const boss = new panel.ZCHudBossPanel();
    const hpFill = { fillRange: 1, node: { parent: { active: true } } };
    Object.assign(boss, {
        hpFill, waveLabel: { string: '' }, rateLabel: { string: '' },
        nameLabel: { string: '', node: { active: true } },
        portraitIcon: { node: { active: true } },
    });
    return { panel: boss, hpFill };
}

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

test('★ 守城波次面板常驻，但大血条只在 BOSS 波显示（非 BOSS 怪不展示）', () => {
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

    // 第一波尚未生成：徽标常驻，头像与总血条等待 BOSS 波。
    render({ ...wave({ currentWaveId: null, currentWaveIsBoss: false, spawnedWaves: 0 }) });
    assert.deepEqual(created, [prefab]);
    assert.deepEqual(barVisible, [false]);

    // 普通小怪波（用户截图「第3/6波」）：面板不重建（徽标还在），大血条整组收起。
    // `currentWaveId` 明明有值，正是这一条钉死「有当前波 ≠ 有首领」。
    render({ ...wave({ currentWaveIsBoss: false, spawnedWaves: 3 }) });
    assert.deepEqual(created, [prefab], '第一波起就要有波次徽标');
    assert.deepEqual(barVisible, [false, false], '非 BOSS 波不许显示头像和总血条');

    // BOSS 波：同一块面板复用，血条组点亮（不重建）。
    render(wave({ currentWaveIsBoss: true }));
    assert.deepEqual(created, [prefab], '同局不重建面板');
    assert.deepEqual(barVisible, [false, false, true]);

    // 从 BOSS 波切回普通波：大血条必须再收起（每帧写绝对显隐，不靠创建时染一次）。
    render({ ...wave({ currentWaveIsBoss: false }) });
    assert.deepEqual(barVisible, [false, false, true, false]);
    assert.deepEqual(destroyed, [], '面板不销毁，徽标要一直挂着');

    // 非守城局（没有波次进度）：面板销毁。
    Object.assign(Reflect.get(game, 'bossPanel'), { node: { destroy: () => destroyed.push('panel') } });
    render(null);
    assert.deepEqual(destroyed, ['panel']);
    assert.equal(Reflect.get(game, 'bossPanel'), null);
});

test('★ 非 BOSS 波：头像框整组收起（不留空框），波次徽标仍照常刷新', () => {
    const boss = new panel.ZCHudBossPanel();
    // `portraitIcon` 绑在 `Portrait/Icon` 上：只藏 Icon 会留下 86×86 的 `boss_txk` 空头像框。
    const portraitFrame = { active: true };
    const iconNode = { active: true, parent: portraitFrame };
    const nameNode = { active: true };
    const barNode = { active: true };
    const waveNode = { active: true };
    const hpFill = { fillRange: 1, node: { parent: barNode } };
    Object.assign(boss, {
        hpFill, waveLabel: { string: '', node: waveNode }, rateLabel: { string: '' },
        nameLabel: { string: '', node: nameNode },
        portraitIcon: { node: iconNode },
    });

    boss.setBossBarVisible(false);
    assert.equal(portraitFrame.active, false, '整个头像框都要收，不能只藏里面的怪图');
    assert.equal(nameNode.active, false, '名字收起');
    assert.equal(barNode.active, false, '血条（含 X 倍率）收起');
    assert.equal(waveNode.active, true, '骷髅 + 第N/M波 徽标不受影响');

    boss.beginHpDrain();
    boss.render(wave({ currentWaveIsBoss: false, spawnedWaves: 3,
        currentWaveHp: 30, currentWaveMaxHp: 100 }), '', null);
    assert.equal(boss.waveLabel.string, '第3/8波', '非 BOSS 波徽标照常刷新');
    assert.equal(boss.advanceHpDrain(0.016), false, '条藏着时结算不为扣血演出多等半秒');
    assert.equal(hpFill.fillRange, 0.3, '放行时仍把条写到位');

    boss.setBossBarVisible(true);
    assert.deepEqual([portraitFrame.active, nameNode.active, barNode.active], [true, true, true],
        'BOSS 波整组恢复（面板不重建，显隐必须双向可写）');
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

test('结算扣血缓动：从死前那一刻的比例平滑降到最终血量，两端落在终值上', () => {
    assert.equal(panel.bossHpDrainRatio(0.85, 0, 0), 0.85, '起手原样，不许跳一下');
    assert.equal(panel.bossHpDrainRatio(0.85, 0, panel.ZC_BOSS_HP_DRAIN_SECONDS), 0, '播完必须正好落到目标');
    assert.equal(panel.bossHpDrainRatio(0.85, 0, 9), 0, '超时也停在目标上');
    assert.equal(panel.bossHpDrainRatio(0.85, 0, -1), 0.85, '负时间不许倒着走');
    const half = panel.bossHpDrainRatio(0.85, 0, panel.ZC_BOSS_HP_DRAIN_SECONDS / 2);
    assert.ok(half > 0 && half < 0.85, `中点必须夹在两端之间：${half}`);
    assert.ok(panel.bossHpDrainRatio(0.85, 0, 0.1) > panel.bossHpDrainRatio(0.85, 0, 0.2), '全程单调下降');
});

test('首领条扣血动画：对局中直接落地，只有结算起手才补间；隐藏 / 没掉血不演', () => {
    const { panel: boss, hpFill } = bossPanelFixture();

    // 对局中：条跟手，不做动画（打怪时血条必须一拍不差）。
    boss.render(wave({ currentWaveHp: 60, currentWaveMaxHp: 100 }), '怪', null);
    assert.equal(hpFill.fillRange, 0.6);

    // 结算起手：先钉住 60% 这个起点，随后的归零只记目标。
    boss.beginHpDrain();
    boss.render(wave({ currentWaveHp: 0, currentWaveMaxHp: 100 }), '怪', null);
    assert.equal(hpFill.fillRange, 0.6, '扣血动画没推进之前不许直接归零');
    assert.equal(boss.advanceHpDrain(panel.ZC_BOSS_HP_DRAIN_SECONDS / 2), true);
    assert.ok(hpFill.fillRange > 0 && hpFill.fillRange < 0.6, `动画中段要在两端之间：${hpFill.fillRange}`);
    assert.equal(boss.advanceHpDrain(panel.ZC_BOSS_HP_DRAIN_SECONDS), false, '播完就交还结算');
    assert.equal(hpFill.fillRange, 0, '播完落在最终血量上');
    assert.equal(boss.advanceHpDrain(0.1), false, '播完不再占着结算');

    // 回血 / 满血（新波）：不是「被扣」，硬拉动画只会显得卡 ⇒ 第一帧就放行、条直接落地。
    boss.beginHpDrain();
    boss.render(wave({ currentWaveHp: 100, currentWaveMaxHp: 100 }), '怪', null);
    assert.equal(boss.advanceHpDrain(0.016), false, '没掉血不为空动画白等');
    assert.equal(hpFill.fillRange, 1);

    // 血条组藏着（当前波没有可显示的单位）：没有扣血可看，同样当场放行。
    boss.setBossBarVisible(false);
    boss.beginHpDrain();
    boss.render(wave({ currentWaveHp: 30, currentWaveMaxHp: 100 }), '怪', null);
    assert.equal(boss.advanceHpDrain(0.016), false, '血条藏着时不出扣血演出');
    assert.equal(hpFill.fillRange, 0.3, '放行时血条要写到位，不能停在旧值');
});

test('塔防结算：首领条这次扣血没演完，镜头不拉远、扫场也不许起', () => {
    const exports = loadGameModule();
    const game = new exports.ZCGame();
    const { panel: boss, hpFill } = bossPanelFixture();
    const calls: string[] = [];
    const progress = wave({ currentWaveHp: 85, currentWaveMaxHp: 100, currentWaveId: 7, spawnedWaves: 7, nextWaveId: 8 });
    // 对局中最后一帧：BOSS 还有 85% 血（用户截图里那条没扣下去的血条）。
    boss.setBossBarVisible(true);
    boss.render(progress, '吞噬大嘴花', null);
    assert.equal(hpFill.fillRange, 0.85);
    // 这一拍逻辑上血量已经清零、胜负已定，但 HUD 的 0.15s 刷新窗口还没轮到。
    const settled = { ...(progress as Record<string, unknown>), currentWaveHp: 0 };
    const model = { snapshot: { status: 'victory' }, defenceWaveProgress: settled } as never;
    const frame = { snapshot: { status: 'victory' }, winner: 'player' } as never;
    Object.assign(game, {
        isValid: true, bossPanel: boss,
        hudView: {
            settlementOverviewSettled: false,
            startSettlementOverview() { calls.push('overview'); this.settlementOverviewSettled = true; },
        },
        // `startVictorySweep` 在真实现里幂等（已在播直接返回 true），桩也要照这个语义记，否则
        // 每帧都会记一次「起扫场」。
        renderWorld: {
            sweepStarted: false,
            startVictorySweep() {
                if (this.sweepStarted) return true;
                this.sweepStarted = true;
                calls.push('sweepStart');
                return true;
            },
            advanceVictorySweep() { calls.push('sweep'); return false; },
        },
    });
    const advance = (dt: number): boolean => game.advanceSettlementPresentation(model, frame, dt);

    // 起手那一帧：条从 85% 起步往下走，结算演出一步都不许动。
    assert.equal(advance(0.1), true);
    assert.deepEqual(calls, [], '扣血没演完之前不许拉镜头 / 起扫场');
    assert.ok(hpFill.fillRange < 0.85 && hpFill.fillRange > 0, `血条要在扣血过程中：${hpFill.fillRange}`);

    // 一直等到它放行：顺序必须是「扣血 → 拉远镜头 → 扫场」。
    let guard = 0;
    while (advance(0.05) && guard++ < 40) { /* 等它演完 */ }
    assert.deepEqual(calls, ['sweepStart', 'overview', 'sweep'], '血条降完才轮到结算演出');
    assert.equal(hpFill.fillRange, 0, '结算演出开始时血条已经扣到 0');
});

test('非塔防局（没有首领条）不为扣血动画多等一帧', () => {
    const exports = loadGameModule();
    const game = new exports.ZCGame();
    const calls: string[] = [];
    const model = { snapshot: { status: 'victory' }, defenceWaveProgress: null } as never;
    const frame = { snapshot: { status: 'victory' }, winner: 'player' } as never;
    Object.assign(game, {
        isValid: true, bossPanel: null,
        hudView: {
            settlementOverviewSettled: false,
            startSettlementOverview() { calls.push('overview'); this.settlementOverviewSettled = true; },
        },
        renderWorld: {
            sweepStarted: false,
            startVictorySweep() {
                if (this.sweepStarted) return true;
                this.sweepStarted = true;
                calls.push('sweepStart');
                return true;
            },
            advanceVictorySweep() { calls.push('sweep'); return false; },
        },
    });
    assert.equal(game.advanceSettlementPresentation(model, frame, 0.016), true);
    assert.deepEqual(calls, ['sweepStart', 'overview'], '第一帧就直接起演出');
    assert.equal(game.advanceSettlementPresentation(model, frame, 0.016), false);
    assert.deepEqual(calls, ['sweepStart', 'overview', 'sweep']);
});
