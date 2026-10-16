import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

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
        fontSize: panel.ZC_BOSS_WAVE_FONT_SIZE,
        lineHeight: panel.ZC_BOSS_WAVE_FONT_SIZE + 6,
        outlineWidth: panel.ZC_BOSS_LABEL_OUTLINE_WIDTH,
    });
    assert.equal(panel.ZC_BOSS_WAVE_FONT_SIZE, 32, '设计稿文字框 109×32、白核高 29.9');
    assert.equal(panel.ZC_BOSS_LABEL_OUTLINE_WIDTH, 3, '白字压沙地，描边是必须的');
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
    assert.equal(panel.ZC_BOSS_RATE_FONT_SIZE, 22, '设计稿 `X4` 白核 26.5×16.1');
});
