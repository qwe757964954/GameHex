import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const REPOSITORY = readFileSync('assets/script/app/firstRecharge/FirstRechargeRepository.ts', 'utf8');
const PAGE = readFileSync('assets/script/app/firstRecharge/FirstRechargePage.ts', 'utf8');

test('首充购买开单成功后继续调用支付出口，不能把 ret=true 当成已发货', () => {
    assert.match(REPOSITORY, /if \(!ret\) return 'failed';\s*FW\.pay\(rmb, 'common', 0\);\s*return 'ok';/s);
});

test('首充页监听服务端状态缓存，支付异步发货后自动刷新并在关闭时解绑', () => {
    assert.match(
        PAGE,
        /setEventUpdate\(\s*'CmdFirstRechargeNew',\s*this as unknown as destroyable,\s*this\.onFirstRechargeCacheUpdate/s,
    );
    assert.match(
        PAGE,
        /removeEventUpdate\(\s*'CmdFirstRechargeNew',\s*this as unknown as destroyable,\s*this\.onFirstRechargeCacheUpdate/s,
    );
    assert.match(PAGE, /onFirstRechargeCacheUpdate[\s\S]*void this\.reload\(\)/);
});
