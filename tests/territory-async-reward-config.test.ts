import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildTerritoryCampaign } from '../assets/script/app/territory/model/TerritoryCampaignConfig';

test('第一章主线关卡配置展示挂机奖励，并可由关卡配置解析', () => {
    const table = JSON.parse(readFileSync('assets/remoteRef/levelInfo.json', 'utf8'));
    const rows = table.v.map((values: unknown[]) => Object.fromEntries(table.k.map((key: string, i: number) => [key, values[i]])));
    const campaign = buildTerritoryCampaign(rows, [], [], [], 1);
    // 🔴 2026-11 起服务端的 `idleReward` 从**异步据点**（20001…）挪到了**主线关卡**（10001…）。
    //    旧口径断言 20001~20004 有三条奖励，现在它们拿到的是空列表 —— 别再把奖励来源钉在异步据点上。
    const stage = campaign.stages.find((entry) => entry.levelId === 10001);
    assert.ok(stage, '缺少主线关卡 10001');
    assert.deepEqual(stage.idleRewards.map(({ resId, amount, probability }) => ({ resId, amount, probability })), [
        { resId: 7, amount: 160, probability: 10000 },
        { resId: 16014, amount: 1, probability: 600 },
        { resId: 10010, amount: 2, probability: 10000 },
        { resId: 10010, amount: 3, probability: 10000 },
        { resId: 10011, amount: 1, probability: 150 },
        { resId: 10013, amount: 1, probability: 150 },
    ]);
    // 相邻关卡同样解析得到（不是只对 10001 生效的巧合），且数值随关卡走
    const second = campaign.stages.find((entry) => entry.levelId === 10002);
    assert.ok(second);
    assert.equal(second.idleRewards[0].resId, 7);
    // 2026-11-09：银币档整体 ×10（10001 16→160、10002 17→170），其余条目不动。
    assert.equal(second.idleRewards[0].amount, 170, '银币产出应随关卡变化');
    // 异步据点不再配挂机奖励：以后再配回来的话，来源就变成两套了，必须显式改这条
    const asyncStage = campaign.stages.find((entry) => entry.levelId === 20001);
    assert.ok(asyncStage, '缺少异步据点 20001');
    assert.deepEqual(asyncStage.idleRewards, [], '异步据点的挂机奖励已由主线关卡承担');
});
