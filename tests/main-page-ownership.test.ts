import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('main tab views neither construct nor retain application controllers or entries', () => {
    for (const path of ['main/MainTabHost', 'main/MainPage', 'main/MainTerritoryMap', 'card/CardLineupPage', 'role/RolePage', 'store/StorePage', 'league/LeagueTabPage']) {
        const source = readFileSync(`assets/script/app/${path}.ts`, 'utf8');
        assert.doesNotMatch(source, /new\s+\w*(?:Controller|Entry)\s*\(/, path);
        assert.doesNotMatch(source, /(?:private|protected)\s+(?:readonly\s+)?\w+\s*:\s*\w*(?:Controller|Entry)(?:<|\s|;|\|)/, path);
        assert.doesNotMatch(source, /import\s+\{[^}]*\b(?:ComponentController|CardLineupController|RoleController|StoreController|LeagueTabController|MainTabController|TerritoryEntry)\b/, path);
    }
});
