import type { NetworkTransport } from '../../core/network/NetworkTransport';

/** 登录成功后发起中心服订单所需的最小会话。 */
export interface CenterPaymentSession {
    readonly centerUrl: string;
    readonly platform: number;
    readonly code: string;
    readonly roleId: number;
    readonly sdkType: string;
}

interface CreateOrderResponse {
    readonly result?: boolean;
    readonly orderCode?: string;
    readonly tips?: string;
    /** true 表示中心服已按内部订单直接通知游戏服发货。 */
    readonly isInternal?: boolean;
}

interface ConfirmOrderResponse {
    readonly result?: boolean;
    readonly tips?: string;
}

export interface ExternalPaymentOrder {
    readonly orderCode: string;
    readonly payChannelId: number;
    readonly fromType: string;
    readonly fromId: number;
}

export type ExternalPaymentHandler = (order: ExternalPaymentOrder) => void | Promise<void>;

/**
 * 2.0 `SDKMgr.pay()` 的中心服部分。
 *
 * 游戏服的购买响应只代表允许开单；本服务继续请求 `/center/order/create`。内部订单
 * 会由中心服直接发货，YouaiSDK 本地渠道则继续调用 `/center/order/confirm/internal`。
 * 微信、抖音、原生渠道的真实扣款仍通过 `setExternalPaymentHandler()` 注入，不能在客户端伪造。
 */
export class CenterPaymentService {
    private static _current: CenterPaymentService | null = null;
    private session: CenterPaymentSession | null = null;
    private externalHandler: ExternalPaymentHandler | null = null;

    static instance(transport: NetworkTransport): CenterPaymentService {
        return CenterPaymentService._current ??= new CenterPaymentService(transport);
    }

    static get current(): CenterPaymentService | null {
        return CenterPaymentService._current;
    }

    constructor(private readonly transport: NetworkTransport) {}

    configure(session: CenterPaymentSession): void {
        this.session = { ...session };
    }

    clear(): void {
        this.session = null;
    }

    setExternalPaymentHandler(handler: ExternalPaymentHandler | null): void {
        this.externalHandler = handler;
    }

    async pay(payChannelId: number, fromType: string, fromId: number): Promise<void> {
        const session = this.session;
        if (!session) throw new Error('支付会话尚未初始化，请重新登录');
        if (!Number.isSafeInteger(payChannelId) || payChannelId <= 0) {
            throw new Error(`支付渠道无效：${payChannelId}`);
        }

        const create = await this.transport.requestJson<CreateOrderResponse>({
            url: withQuery(joinUrl(session.centerUrl, 'center/order/create'), {
                platform: session.platform,
                code: session.code,
                roleId: session.roleId,
                payChannelId,
                fromType,
                fromId,
            }),
            method: 'GET',
        });
        if (!create?.result) throw new Error(create?.tips || '创建支付订单失败');

        // 中心服判定为内部订单时，create 接口已经通知游戏服发货，不能再次确认。
        if (create.isInternal === true) return;

        const orderCode = String(create.orderCode ?? '');
        if (!orderCode) throw new Error('创建支付订单成功，但没有返回订单号');

        // 对齐 2.0 YouaiSDK.PPP()：本地渠道用内部确认接口完成测试支付。
        if (session.sdkType === 'YouaiSDK') {
            const confirmed = await this.transport.requestJson<ConfirmOrderResponse>({
                url: withQuery(joinUrl(session.centerUrl, 'center/order/confirm/internal'), { orderCode }),
                method: 'GET',
            });
            if (!confirmed?.result) throw new Error(confirmed?.tips || '内部支付确认失败');
            return;
        }

        if (!this.externalHandler) {
            throw new Error(`当前渠道支付 SDK 未接入：${session.sdkType || 'unknown'}`);
        }
        await this.externalHandler({ orderCode, payChannelId, fromType, fromId });
    }
}

function joinUrl(origin: string, path: string): string {
    return `${origin.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function withQuery(origin: string, params: Readonly<Record<string, string | number>>): string {
    const query = Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
    return `${origin}${origin.includes('?') ? '&' : '?'}${query}`;
}
