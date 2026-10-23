import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import protobuf from 'protobufjs/light.js';
import { ProtoCoder } from '../assets/script/framework/net/ProtoCoder';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

test('两组据点协议在真实运行时可注册、编码并解码', async () => {
    const coder = new ProtoCoder();
    await coder.init();
    const root = protobuf.Root.fromJSON(JSON.parse(readFileSync('assets/resources/config/protoCompiled.json', 'utf8')));
    for (const [stem, messageId] of [['CmdSlgCampSimpleInfo', 1631409176], ['CmdSlgCampInfo', 1665140602]] as const) {
        assert.equal(coder.getMessageId(`${stem}ReqMsg`), messageId);
        const encoded = coder.encode(`${stem}ReqMsg`, { campIds: [101, 102] });
        const req = root.lookupType(`com.xkhy.tafang.cmd.${stem}ReqMsg`);
        assert.deepEqual(req.toObject(req.decode(encoded)), { campIds: [101, 102] });
        const rsp = root.lookupType(`com.xkhy.tafang.cmd.${stem}RspMsg`);
        const bytes = rsp.encode({ infos: [{ campId: 101, opType: 1, state: 3 }] }).finish();
        const decoded = coder.decodeDataById(messageId, bytes);
        assert.equal(decoded.infos[0].campId, 101);
        assert.equal(decoded.infos[0].opType, 1);
        assert.equal(decoded.infos[0].state, 3);
    }
});

test('Presenter 提供可见据点查询与点击详情查询入口', () => {
    const presenter = new BigMapPresenter({ config: loadBigMapConfig(), storage: createMemoryBigMapStorage(),
        saveKey: 'camp-test', adventureChapter: () => 3, now: () => 957600 });
    assert.equal(typeof presenter.refreshVisibleCamps, 'function');
    assert.equal(typeof presenter.refreshCampDetail, 'function');
});
