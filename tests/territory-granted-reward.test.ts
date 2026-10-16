import test from 'node:test';
import assert from 'node:assert/strict';
import { readTerritoryGrantedRewards } from '../assets/script/app/territory/model/TerritoryGrantedReward';
import protobufRoot from '../assets/script/lib/protobuf/protoCompiledStatic';

test('normalizes server goods including protobuf Long counts', () => {
    assert.deepEqual(readTerritoryGrantedRewards([
        { resId: 7, number: { low: 15, high: 0 } },
        { resId: 9, number: '5' },
        { resId: 0, number: 1 },
        { resId: 7, number: 0 },
        { resId: 7, number: -1 },
    ]), [
        { resId: 7, amount: 15 },
        { resId: 9, amount: 5 },
    ]);
    assert.deepEqual(readTerritoryGrantedRewards(null), []);
});

test('runtime protobuf preserves granted goods on both territory responses', () => {
    interface IMessageCodec {
        encode(value: object): { finish(): Uint8Array };
        decode(bytes: Uint8Array): { tlCmdGoods?: unknown[] };
    }
    const cmd = (protobufRoot as unknown as {
        com: { xkhy: { tafang: { cmd: Record<string, IMessageCodec> } } };
    }).com.xkhy.tafang.cmd;
    for (const name of ['CmdCityChapterUnlockCellRspMsg', 'CmdCityChapterPassCellRspMsg']) {
        const codec = cmd[name];
        assert.ok(codec, `${name} missing from runtime protobuf`);
        const cellId = name === 'CmdCityChapterUnlockCellRspMsg' ? [4] : 4;
        const bytes = codec.encode({ levelChapter: 1, cellId, succ: 1,
            tlCmdGoods: [{ resId: 9, number: '5' }] }).finish();
        assert.deepEqual(readTerritoryGrantedRewards(codec.decode(bytes).tlCmdGoods),
            [{ resId: 9, amount: 5 }]);
    }
});
