import assert from 'node:assert/strict';
import test from 'node:test';
import type { NetworkRequest, NetworkTransport } from '../assets/script/core/network/NetworkTransport';
import { CenterPaymentService } from '../assets/script/platform/payment/CenterPaymentService';

class FakeTransport implements NetworkTransport {
    readonly requests: NetworkRequest[] = [];
    readonly responses: unknown[] = [];

    async requestJson<T>(request: NetworkRequest): Promise<T> {
        this.requests.push(request);
        if (this.responses.length === 0) throw new Error('missing fake response');
        return this.responses.shift() as T;
    }
}

function configured(transport: FakeTransport, sdkType = 'YouaiSDK'): CenterPaymentService {
    const payment = new CenterPaymentService(transport);
    payment.configure({
        centerUrl: 'https://center.example/',
        platform: 7,
        code: 'account-code',
        roleId: 10001,
        sdkType,
    });
    return payment;
}

test('内部订单由 create 接口直接发货，不重复调用确认接口', async () => {
    const transport = new FakeTransport();
    transport.responses.push({ result: true, orderCode: 'O-1', isInternal: true });
    await configured(transport).pay(11, 'common', 0);

    assert.equal(transport.requests.length, 1);
    const url = new URL(transport.requests[0].url);
    assert.equal(url.pathname, '/center/order/create');
    assert.equal(url.searchParams.get('payChannelId'), '11');
    assert.equal(url.searchParams.get('roleId'), '10001');
    assert.equal(url.searchParams.get('fromType'), 'common');
});

test('YouaiSDK 非内部订单继续走内部确认，完成 2.0 的本地测试支付链路', async () => {
    const transport = new FakeTransport();
    transport.responses.push(
        { result: true, orderCode: 'O-2', isInternal: false },
        { result: true, tips: 'ok' },
    );
    await configured(transport).pay(11, 'common', 0);

    assert.equal(transport.requests.length, 2);
    const confirm = new URL(transport.requests[1].url);
    assert.equal(confirm.pathname, '/center/order/confirm/internal');
    assert.equal(confirm.searchParams.get('orderCode'), 'O-2');
});

test('真实渠道没有注入 SDK 时明确失败，不在客户端伪造发货', async () => {
    const transport = new FakeTransport();
    transport.responses.push({ result: true, orderCode: 'O-3', isInternal: false });
    await assert.rejects(
        configured(transport, 'GaoreSDK').pay(11, 'common', 0),
        /支付 SDK 未接入/,
    );
});
