import { ZC_BATTLE_EVENTS } from '../assets/script/app/zcds/application/ZCBattleEvents';
import { createControllerResources } from './helpers/controller-context';
import { componentControllerModule } from './helpers/controller-context';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

interface IGameInstance {
    createGame: (prepared: unknown) => void;
    readonly preparedResources: unknown;
    initialize(entry: unknown, resources: unknown): void;
    update(dt: number): void;
    onDestroy(): void;
    onLoad(): void;
    shutdown(): void;
    renderBossPanel(model: unknown): void;
}

interface IGameClass {
    new (): IGameInstance;
}

function loadGame(instantiate: (prefab: unknown) => unknown, emit = (_event: string, _data: unknown) => {}): IGameClass {
    const source = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            experimentalDecorators: true,
        },
    }).outputText;
    const context = {
        exports: {} as { ZCGame?: IGameClass },
        console: { error() {} },
        require: (name: string): unknown => {
            if (name.endsWith('/ZCBattleEvents')) return { ZC_BATTLE_EVENTS };
            if (name.endsWith('/ComponentController')) return componentControllerModule();
            if (name === 'cc') return {
                _decorator: { ccclass: () => (component: unknown) => component },
                // `Component` 桩要带上计时器 API：ZCGame.ts:718/724 会用
                // `scheduleOnce(this.finishSpawnSelection, …)` / `unschedule(...)` 做自选主城的展示倒计时。
                // 桩里只需收下回调、不真排程 —— 这两条用例只验资源注入，不验倒计时。
                Component: class {
                    node = { layer: 1 };
                    // 🔴 `isValid` 必须给 true。ZCGame 的 `leaving` getter 是
                    // `!this.isValid || this.phase.isLeaving`，桩上留 undefined ⇒ `!undefined` 恒 true
                    // ⇒ `renderBossPanel` 在 `if (this.leaving) return` 处提前返回，
                    // 一条 prefab 都不实例化，表现为 `instantiated` 空数组的假红。
                    isValid = true;
                    scheduleOnce(_cb: () => void, _delay: number): void {}
                    unschedule(_cb: () => void): void {}
                },
                instantiate,
            };
            if (name === '../../framework/event/EventMgr') return {
                // 中控订阅全挂在全局唯一的 `EventMgr.instance` 上（ZCGame.ts:316/629+）：
                // `on` 订阅 11 次、`offTarget(this)` 在 shutdown 里摘一次。
                EventMgr: { instance: { on(): void {}, offTarget(): void {}, emit } },
            };
            if (name === '../battle/BattleResultService') return {
                BattleResultService: { ensureListening() {} },
            };
            return {};
        },
    };
    runInNewContext(code, context);
    assert.ok(context.exports.ZCGame);
    return context.exports.ZCGame;
}

test('对局组件在 onLoad 后通过实例入口接收本局数据，并在退出时放开引用', () => {
    const ZCGame = loadGame(() => { throw new Error('首屏创建已由测试替代'); });
    const prepared = { hudPrefab: { name: 'HUD' } };
    const matchConfig = { map: { mapId: 'entry-map' } };
    const playerAvatars = { player: 'self', enemy: 'foe' };
    const seatProfiles = [['player', { name: 'self' }]];
    const entry = { resources: prepared, battleSeed: 'seed-1', matchConfig, playerAvatars, seatProfiles, pveContext: null };
    const game = new ZCGame();
    let received: unknown = null;
    game.createGame = (resources) => { received = resources; };

    game.onLoad();
    assert.equal(received, null, 'onLoad 不应从全局暂存区启动对局');
    game.initialize(entry, createControllerResources());
    assert.equal(received, prepared);
    assert.equal(game.preparedResources, prepared);
    assert.equal(game.matchConfig, matchConfig);
    assert.equal(game.playerAvatars, playerAvatars);
    assert.notEqual(game.seatProfiles, seatProfiles, '组件持有自己的席位 Map，不保留调用方数组');
    assert.throws(() => game.initialize(entry, createControllerResources()), /已初始化/);

    game.shutdown();
    assert.equal(game.preparedResources, null);
    assert.equal(game.matchConfig, null);
    assert.equal(game.playerAvatars, null);
    assert.equal('pveContext' in game, false);
    assert.equal(game.seatProfiles.size, 0);

    const nextGame = new ZCGame();
    nextGame.createGame = () => { throw new Error('暂存资源只能被消费一次'); };
    nextGame.onLoad();
    assert.equal(nextGame.preparedResources, null);
});

test('守城首领条延迟创建时使用本局预加载的 Prefab', () => {
    const instantiated: unknown[] = [];
    const rendered: unknown[][] = [];
    const panel = { render: (...args: unknown[]) => rendered.push(args) };
    const ZCGame = loadGame((prefab) => {
        instantiated.push(prefab);
        return { layer: 0, setParent() {}, getComponent: () => panel };
    });
    const bossPanelPrefab = { name: 'BossPanel' };
    const game = new ZCGame();
    game.createGame = () => {};
    const resources = { bossPanelPrefab };
    game.onLoad();
    game.initialize({ resources }, createControllerResources());
    // 首领条要 `setParent(hudView.node)` 并继承它的 layer；`hudView` 是 `createGame` 里建的，
    // 上面把它桩成空函数 ⇒ 这里补一个最小 HUD 宿主（真 HUD 的渲染行为由 zcds-hud* 覆盖）。
    (game as unknown as { hudView: unknown }).hudView = {
        node: { layer: 1, setParent() {}, destroy() {} },
    };

    const progress = { currentWaveCardId: null };
    game.renderBossPanel({ defenceWaveProgress: progress });
    assert.deepEqual(instantiated, [bossPanelPrefab]);
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0][0], progress);
});

test('view emits frames and destruction with its own owner, without owning business results', () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    const ZCGame = loadGame(() => ({}), (event, payload) => events.push({ event, payload }));
    const game = new ZCGame();
    game.createGame = () => {};
    game.initialize({ resources: {}, seatProfiles: [], pveContext: { chapterId: 1, levelId: 2, territoryCellId: 3 } }, createControllerResources());
    game.update(0.1);
    game.onDestroy();
    assert.deepEqual(events.map(value => value.event), [ZC_BATTLE_EVENTS.FRAME, ZC_BATTLE_EVENTS.RUNTIME_DESTROYED]);
    assert.equal((events[0].payload as { owner: object }).owner, game);
    assert.equal((events[0].payload as { dt: number }).dt, 0.1);
    assert.equal((events[1].payload as { owner: object }).owner, game);
});
