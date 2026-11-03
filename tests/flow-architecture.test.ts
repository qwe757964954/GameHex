import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('login and matching views have no business root, navigation, transport or controller callbacks', () => {
    for (const path of ['login/LoginPage', 'login/ServerSelectPanel', 'login/ServerSelectItem', 'matching/MatchingPage']) {
        const code = readFileSync(`assets/script/app/${path}.ts`, 'utf8');
        assert.doesNotMatch(code, /new\s+(?:LoginRoot|\w*Controller)\s*\(/, path);
        assert.doesNotMatch(code, /ProcedureManager|GameNet|resources\.load|rootLogic|pickOpponents|awaitReady|onMatched|onSelect\s*:/, path);
    }
});

test('login, matching and post-login procedures delegate composition and do not implement feature workflows', () => {
    for (const name of ['Login', 'Matching', 'PostLogin']) {
        const code = readFileSync(`assets/script/app/procedure/Procedure${name}.ts`, 'utf8');
        assert.match(code, new RegExp(`${name}Composition`));
        assert.doesNotMatch(code, /new LoginGateway|startBattle\(|fetchPvpInfo\(|beginMatch\(|pickOpponents|configureGateway/);
    }
});

test('post-login loading view and procedure do not own business orchestration', () => {
    const view = readFileSync('assets/script/app/loading/LaunchProgressPage.ts', 'utf8');
    const procedure = readFileSync('assets/script/app/procedure/ProcedurePostLogin.ts', 'utf8');
    assert.doesNotMatch(view, /PostLoginController|PostLoginComposition|sessionAssets|GameNet|localStorage/);
    assert.doesNotMatch(procedure, /EventMgr|AudioMgr|LaunchProgressUI|TerritoryChapterInfoRepository|localStorage|sessionAssets\.prepare/);
});

test('battle procedure delegates assembly and runtime receives resources without owning a controller', () => {
    const procedure = readFileSync('assets/script/app/procedure/ProcedureGame.ts', 'utf8');
    const runtime = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
    const entry = readFileSync('assets/script/app/zcds/application/ZCGameEntry.ts', 'utf8');
    assert.match(procedure, /BattleComposition/);
    assert.doesNotMatch(procedure, /new ZCGameLoader|addComponent|buildSeatProfiles|buildZCClientCombatConfig|createTerritorySaveStore/);
    assert.doesNotMatch(runtime, /ComponentController|resourceController|pve\.onResult|new ZCGameModel|\.tick\(|\.developHex\(|\.useArtifact\(|finishBattle|ProcedureManager|bindUiEvents/);
    assert.match(runtime, /initialize\(entry: IZCGameEntry, resources: IControllerResources, model: IZCBattleRenderModel/);
    const viewEntry = entry.slice(entry.indexOf('export interface IZCGameEntry {'), entry.indexOf('/** 对局入口模式'));
    assert.doesNotMatch(viewEntry, /onResult|Controller|session\s*:/);
});
