import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = 'assets/script/app/bigmap/';
const code = (path: string) => readFileSync(root + path, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

test('MVC：视图不持有 Model/Presenter、不订阅业务状态、不请求网络或推进业务时钟', () => {
    for (const file of readdirSync(root + 'view').filter((name) => name.endsWith('.ts'))) {
        const source = code('view/' + file);
        assert.doesNotMatch(source, /\bBigMapPresenter\b|\bBigMapModel\b|\.onChanged\(|\.request[A-Z]|\.refreshCampDetail\(|\.refreshVisibleCamps\(|\.tick\(/, file);
        assert.doesNotMatch(source, /onTap\s*:\s*\(\(|onHarvest\s*:\s*\(\(/, file);
    }
});

test('MVC：网络广播只在 Controller 绑定，仓库和 Model 不自行订阅网络', () => {
    assert.ok(existsSync(root + 'application/BigMapController.ts'));
    for (const file of ['GameNetBigMapCampGateway', 'GameNetBigMapSlgGateway', 'BigMapCampRepository', 'BigMapSlgRepository', 'BigMapModel']) {
        assert.doesNotMatch(code(`application/${file}.ts`), /\.addEvent\(|gateway\.subscribe|\.subscribeRoleEvents\(/, file);
    }
    const controller = code('application/BigMapController.ts');
    assert.match(controller, /bindNetworkEvents/);
    assert.match(controller, /bindModelEvents/);
    assert.match(controller, /bindUiEvents/);
    assert.match(controller, /offTarget\(this\)/);
});
