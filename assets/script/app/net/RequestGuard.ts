/**
 * 网络请求的通用守卫工具 —— **纯函数、零引擎依赖**（Node 单测可直接 import）。
 *
 * 与 `app/card/FormationModel.ts` 里那份同款实现的关系：那份早于本文件，只服务布阵面板；
 * 本文件是「后来者都要用」的收敛点。两边逻辑保持一致，收敛时以本文件为准
 * （现在不动 `FormationModel`，避免和正在并行改它的同事撞车）。
 */

/**
 * 给一个 Promise 兜**硬超时**：`ms` 内没兑现就用 `fallback()` 顶上，**保证一定兑现**。
 *
 * 为什么必须有它：`GameNet.send` 只在「收到回包」或「断线」时兑现
 * （`NetSocket.onTimeOut()` 只在断线清心跳 / `ClearAllRequest()` 里被调用），
 * **没有按请求的超时** —— 服务端不认识某条消息、干脆不回应时，那个 Promise 会**永远悬着**。
 * 更常见的一种是：协议只加了 message 定义、**没登记 MessageId**，`GameNet` 虽然会 reject，
 * 但 reject 之前已经打过日志；调用方若不是每个分支都 catch，整条流程就卡住。
 *
 * 把「服务端不回」变成「N 毫秒后走兜底」，调用方才能安全地把它放进流程主链。
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
    return new Promise<T>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = (value: T): void => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            resolve(value);
        };
        timer = setTimeout(() => finish(fallback()), Math.max(0, ms));
        // 原 Promise 若 reject 也走同一个 fallback，调用方永远不会收到 reject。
        void promise.then(finish, () => finish(fallback()));
    });
}

/**
 * `Long` / `string` / `number` → **十进制字符串**；认不出来返回空串。
 *
 * 用于 `uint64` 这类 id 字段：protobufjs 开了 `--force-long`，运行时拿到的是
 * `Long` 对象（`{low, high, unsigned}`），直接 `String()` 会得到 `"1234"` 或 `"[object Object]"`，
 * 取决于 protobufjs 版本与 `configure()` 设置 —— 不能赌。工程内 id 一律走字符串口径。
 *
 * 走字符串而不是 number：`uint64` 超过 `Number.MAX_SAFE_INTEGER` 时 `toNumber()` 会静默丢精度。
 */
export function toIdString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (value && typeof value === 'object') {
        const long = value as { toString?: () => string; low?: number; high?: number };
        // protobufjs 的 Long 覆盖了 toString()，且带 `unsigned` 标记；
        // 但普通对象也有默认 toString（返回 "[object Object]"），所以先用 low/high 判断形状。
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            if (typeof long.toString === 'function') {
                const text = long.toString();
                if (text && text !== '[object Object]') return text;
            }
            return String(long.high * 4294967296 + (long.low >>> 0));
        }
        if (typeof long.toString === 'function') {
            const text = long.toString();
            if (text && text !== '[object Object]') return text;
        }
    }
    return '';
}

/** `Long` / `string` / `number` → 有限数值；认不出来返回 0。用于 `uint32` 这类计数/资质字段。 */
export function toCount(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (value && typeof value === 'object') {
        const long = value as { toNumber?: () => number; low?: number; high?: number };
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            return long.high * 4294967296 + (long.low >>> 0);
        }
        if (typeof long.toNumber === 'function') {
            const parsed = long.toNumber();
            return Number.isFinite(parsed) ? parsed : 0;
        }
    }
    return 0;
}

/** 正整数字段（各种 `uint32` 的 id 都是这个口径）；非法返回 `null`。 */
export function toPositiveInt(value: unknown): number | null {
    const num = toCount(value);
    return Number.isSafeInteger(num) && num > 0 ? num : null;
}
