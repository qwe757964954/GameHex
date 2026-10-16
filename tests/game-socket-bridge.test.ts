import assert from 'node:assert/strict';
import test from 'node:test';
import { toReqProtoName } from '../assets/script/app/gm/GameSocketProtocol';

test('协议名换算：带 ReqMsg 后缀原样返回', () => {
    assert.equal(toReqProtoName('CmdSystemGmReqMsg'), 'CmdSystemGmReqMsg');
    assert.equal(toReqProtoName('CmdSystemSyncTimeReqMsg'), 'CmdSystemSyncTimeReqMsg');
});

test('协议名换算：带 RspMsg 后缀自动换成 ReqMsg', () => {
    assert.equal(toReqProtoName('CmdSystemGmRspMsg'), 'CmdSystemGmReqMsg');
});

test('协议名换算：裸名自动补 ReqMsg', () => {
    assert.equal(toReqProtoName('CmdSystemGm'), 'CmdSystemGmReqMsg');
});
