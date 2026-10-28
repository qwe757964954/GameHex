import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildTerritoryCampaign } from '../assets/script/app/territory/model/TerritoryCampaignConfig';

test('第一章异步据点配置展示奖励，并可由关卡配置解析', () => {
    const table = JSON.parse(readFileSync('assets/remoteRef/levelInfo.json', 'utf8'));
    const rows = table.v.map((values: unknown[]) => Object.fromEntries(table.k.map((key: string, i: number) => [key, values[i]])));
    const campaign = buildTerritoryCampaign(rows, [], [], [], 1);
    for (const id of [20001, 20002, 20003, 20004]) {
        const stage = campaign.stages.find((entry) => entry.levelId === id);
        assert.ok(stage, `缺少异步据点 ${id}`);
        assert.deepEqual(stage.idleRewards.map(({resId, amount, probability}) => ({resId, amount, probability})), [
            {resId: 7, amount: 75, probability: 10000},
            {resId: 16014, amount: 8, probability: 10000},
            {resId: 10012, amount: 8, probability: 10000},
        ]);
    }
});
