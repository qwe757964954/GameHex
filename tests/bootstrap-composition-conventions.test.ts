import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { VIEW_LIFECYCLE } from '../assets/script/framework/ui/ViewLifecycle';
import { LoginUiEvent } from '../assets/script/app/login/LoginEvents';
import type { ILoginControllerOptions } from '../assets/script/app/login/LoginController';
import { createControllerContext } from './helpers/controller-context';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';

const root = 'assets/script/app/bootstrap';
function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
        ? sources(`${directory}/${entry.name}`) : entry.name.endsWith('.ts') ? [`${directory}/${entry.name}`] : []);
}

test('bootstrap lifecycle entry points delegate controller/model construction to named factories', () => {
    const files = sources(root);
    assert.equal(files.filter(file => file.endsWith('Composition.ts')).length, 7);
    for (const file of files) {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        function inspect(node: ts.Node): void {
            if (ts.isConstructorDeclaration(node) || ts.isMethodDeclaration(node) && ['mount', 'open', 'onLoad'].includes(node.name.getText(source))) {
                function inspectConstruction(child: ts.Node): void {
                    if (ts.isNewExpression(child)) assert.doesNotMatch(child.expression.getText(source), /(?:Controller|Model|Root|Entry)$/, file);
                    ts.forEachChild(child, inspectConstruction);
                }
                if (node.body) inspectConstruction(node.body);
            }
            ts.forEachChild(node, inspect);
        }
        inspect(source);
    }
});

test('controller initialization contracts group operational dependencies by responsibility', () => {
    const contracts = [
        ['login/LoginController', 'ILoginControllerOptions'], ['loading/PostLoginController', 'IPostLoginControllerOptions'],
        ['matching/MatchingController', 'IMatchingControllerOptions'], ['main/MainTabController', 'IMainTabControllerOptions'],
        ['role/RoleController', 'IRoleControllerOptions'], ['league/LeagueTabController', 'ILeagueTabControllerOptions'],
        ['card/CardLineupController', 'ICardLineupControllerOptions'], ['card/CardUpgradeController', 'ICardUpgradeControllerOptions'],
        ['card/LineupBoardController', 'ILineupBoardControllerOptions'],
        ['zcds/application/ZCBattleRuntimeContract', 'IZCBattleRuntimeServices'],
        ['zcds/application/ZCBattleSettlementController', 'IZCBattleSettlementServices'],
    ];
    for (const [file, name] of contracts) {
        const source = ts.createSourceFile(file, readFileSync(`assets/script/app/${file}.ts`, 'utf8'), ts.ScriptTarget.Latest, true);
        const contract = source.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === name);
        assert.ok(contract && ts.isInterfaceDeclaration(contract), name);
        for (const member of contract.members) {
            if (member.name?.getText(source) === 'failed') continue;
            assert.ok(!ts.isMethodSignature(member) && !(ts.isPropertySignature(member) && member.type && ts.isFunctionTypeNode(member.type)), `${name}.${member.name?.getText(source)}`);
        }
    }
});

function loginFixture(activationFails = false, cleanupFails = false) {
    const calls: string[] = [], failure = new Error('view activation failed');
    let options: ILoginControllerOptions;
    let resolvePanel: (panel: { isValid: boolean; close(): void }) => void;
    const pendingPanel = new Promise<{ isValid: boolean; close(): void }>(resolve => { resolvePanel = resolve; });
    const page = {};
    const node = {
        isValid: true, getComponent: () => page, setPosition() {},
        setParent() { if (activationFails) throw failure; },
        destroy() { calls.push('destroy'); this.isValid = false; if (cleanupFails) throw new Error('destroy failed'); },
    };
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync(`${root}/login/LoginComposition.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console: { ...console, error() {} }, require(name: string) {
        if (name === 'cc') return { instantiate: () => node, Prefab: class {}, Vec3: { ZERO: {} } };
        if (name.endsWith('/ControllerBase')) return { ControllerBase };
        if (name.endsWith('/ViewLifecycle')) return { VIEW_LIFECYCLE };
        if (name.endsWith('/LoginEvents')) return { LoginUiEvent };
        if (name.endsWith('/LoginRoot')) return { LoginRoot: class { configureGateway() {} } };
        if (name.endsWith('/LoginProtocol')) return { LoginGateway: class {} };
        if (name.endsWith('/LoginController')) return { LoginController: class {
            constructor(_context: unknown, dependencies: ILoginControllerOptions) { options = dependencies; calls.push('controller'); }
            dispose() { calls.push('dispose'); }
        } };
        if (name.endsWith('/ServerSelectPanel')) return { ServerSelectPanel: { open: () => pendingPanel } };
        return {};
    } });
    const Composition = exports.LoginComposition as new (context: unknown, network: unknown, host: unknown) => ControllerBase & {
        preload(context: { resources: ResourceScope; cancelled: boolean }): Promise<void>; mount(): void;
    };
    const composition = new Composition(createControllerContext(), {}, {});
    const preloadScope = new ResourceScope('login-conventions');
    composition.scope.defer(() => calls.push('resources'));
    return { composition, calls, failure, preloadScope,
        get options() { return options; }, resolvePanel: panel => resolvePanel(panel),
        preload: () => composition.preload({ resources: preloadScope, cancelled: false }),
    };
}

test('login assembly failure stops controller before destroying view and releasing resources', async () => {
    const h = loginFixture(true);
    await h.preload();
    assert.throws(() => h.composition.mount(), error => error === h.failure);
    assert.deepEqual(h.calls, ['controller', 'dispose', 'destroy', 'resources']);
    h.composition.dispose(); h.preloadScope.dispose();
    assert.equal(h.calls.length, 4);
});

test('login server popup completing after exit closes without retaining a stale panel', async () => {
    const h = loginFixture();
    try {
        await h.preload(); h.composition.mount();
        const opening = h.options.servers.openServers({ owner: {}, servers: [], selectedServerId: null });
        h.composition.dispose();
        let closed = 0;
        h.resolvePanel({ isValid: true, close() { closed++; } });
        await opening;
        h.options.servers.closeServers();
        assert.equal(closed, 1);
    } finally { h.composition.dispose(); h.preloadScope.dispose(); }
});

test('login cleanup failure still releases resources and preserves the activation error', async () => {
    const h = loginFixture(true, true);
    await h.preload();
    assert.throws(() => h.composition.mount(), error => error === h.failure);
    assert.deepEqual(h.calls, ['controller', 'dispose', 'destroy', 'resources']);
    h.preloadScope.dispose();
});
