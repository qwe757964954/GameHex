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

test('login and matching procedures delegate composition and do not implement feature workflows', () => {
    for (const name of ['Login', 'Matching']) {
        const code = readFileSync(`assets/script/app/procedure/Procedure${name}.ts`, 'utf8');
        assert.match(code, new RegExp(`${name}Composition`));
        assert.doesNotMatch(code, /new LoginGateway|startBattle\(|fetchPvpInfo\(|beginMatch\(|pickOpponents|configureGateway/);
    }
});
