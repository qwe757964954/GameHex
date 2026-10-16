import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

interface IGameInstance {
    createGame: (prepared: unknown) => void;
    readonly preparedResources: unknown;
    initialize(entry: unknown): void;
    onLoad(): void;
    shutdown(): void;
    renderBossPanel(model: unknown): void;
}

interface IGameClass {
    new (): IGameInstance;
}

function loadGame(instantiate: (prefab: unknown) => unknown): IGameClass {
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
            if (name === 'cc') return {
                _decorator: { ccclass: () => (component: unknown) => component },
                Component: class { node = { layer: 1 }; },
                instantiate,
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
    game.initialize(entry);
    assert.equal(received, prepared);
    assert.equal(game.preparedResources, prepared);
    assert.equal(game.matchConfig, matchConfig);
    assert.equal(game.playerAvatars, playerAvatars);
    assert.notEqual(game.seatProfiles, seatProfiles, '组件持有自己的席位 Map，不保留调用方数组');
    assert.throws(() => game.initialize(entry), /已初始化/);

    game.shutdown();
    assert.equal(game.preparedResources, null);
    assert.equal(game.matchConfig, null);
    assert.equal(game.playerAvatars, null);
    assert.equal(game.pveContext, null);
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
    game.initialize({ resources });

    const progress = { currentWaveCardId: null };
    game.renderBossPanel({ defenceWaveProgress: progress });
    assert.deepEqual(instantiated, [bossPanelPrefab]);
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0][0], progress);
});
