import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(`assets/script/app/${path}`, 'utf8');
test('chapter page consumes snapshots and emits intents without business dependencies', () => {
    const source = read('main/MainTerritoryMap.ts');
    assert.doesNotMatch(source, /TerritoryPresenter|TerritoryModel|TerritoryCellRepository|GameNet|CacheMgr|readRoleRow/);
    assert.match(source, /TerritoryUiEvent\.Intent/);
    assert.match(source, /TerritoryViewEvent\.Render/);
    assert.match(source, /TerritoryViewEvent\.Command/);
});
test('chapter model has instance outputs and no global view event subscriptions', () => {
    const source = read('territory/application/TerritoryModel.ts');
    assert.doesNotMatch(source, /import.*EventMgr|from.*view\/TerritoryEvents/);
    assert.match(source, /onOutput/);
});
test('chapter has a single implementation: no compatibility re-export presenters', () => {
    assert.equal(existsSync('assets/script/app/territory/application/TerritoryPresenter.ts'), false);
    assert.equal(existsSync('assets/script/app/bigmap/application/BigMapPresenter.ts'), false);
});
test('写请求只发不等：Model 负责发送，Controller 监听回包再回灌', () => {
    const model = read('territory/application/TerritoryModel.ts');
    const controller = read('territory/application/TerritoryController.ts');
    // 写请求不许再 await 网关（只有查询/开战保留 Promise）。
    assert.doesNotMatch(model, /await this\.ports\.gateway\.(unlockCell|passCell|sweep|claimIdleReward|upMonsterBoxLv)/);
    for (const apply of ['applyUnlockRsp', 'applyPassRsp', 'applySweepRsp', 'applyIdleRewardRsp', 'applyMonsterBoxRsp']) {
        assert.match(model, new RegExp(`${apply}\\(`), `Model 缺回包落地入口 ${apply}`);
    }
    // Controller 必须把五条 Rsp 都挂上，且解码后回灌 Model。
    for (const message of ['UnlockCellRspMsg', 'PassCellRspMsg', 'SweepRspMsg', 'IdleRewardRspMsg', 'UpMonsterBoxLvRspMsg']) {
        assert.match(controller, new RegExp(`CmdCityChapter${message}`), `Controller 没监听 ${message}`);
    }
    assert.doesNotMatch(controller, /options\.cells\.send/, 'Controller 不许绕开 Model 直接发写请求');
});

test('model 只在 Entry 装配一次，Controller 只接收实例', () => {
    const entry = read('territory/application/TerritoryEntry.ts');
    const controller = read('territory/application/TerritoryController.ts');
    // 装配点唯一：Entry 造 Model 并交给 Controller；Controller 不建 Model、也不建 Model 的网关。
    assert.match(entry, /new TerritoryModel\(/);
    assert.match(entry, /new TerritoryController\(model,/);
    assert.doesNotMatch(controller, /new TerritoryModel|createModel\(|createCellGateway/);
    // 网关由仓储自身承担（构造时注入 caller），Entry 里不再有逐个方法的转发 lambda。
    assert.doesNotMatch(entry, /createCellGateway|=> cells\.(unlockCell|passCell|startBattle|sweep)/);
});
