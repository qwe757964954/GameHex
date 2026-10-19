/**
 * 领地请求结果状态码（`TerritoryCellRepository` 及其调用方共用，纯 TS 零依赖）。
 *
 * ⚠️ **运行时比较一律走 `TERRITORY_REQUEST_STATUS`**，禁止写
 * `sent === 'offline'` / `reason === 'rejected'` 这类裸字面量比较——状态名改动或
 * 拼错时字面量比较在运行时静默失配，走本表则编译期就暴露。
 *
 * 类型位置（可判别联合的 reason 分支、函数返回值 / 参数）用**本表推导的命名类型**
 * （`TerritoryRequestFailure` / `TerritoryRequestTransportFailure`），不裸写字面量联合。
 */

/** 传输 / 解析层失败（`offline` / `failed` / `invalid`）：`send` 返回值与 `failFetch` 参数的 reason 全集（`rejected` 是服务端业务拒绝，不属于传输层）。 */
export type TerritoryRequestTransportFailure = 'offline' | 'failed' | 'invalid';

/** 请求失败（`ok` 之外的所有分支；`rejected` = 服务端回 `succ = 0` 的业务拒绝）。 */
export type TerritoryRequestFailure = 'offline' | 'failed' | 'rejected' | 'invalid';

export type TerritoryRequestStatus = 'ok' | TerritoryRequestFailure;

/** 命名常量表（映射类型保证键 = 值 = 状态名）。 */
export const TERRITORY_REQUEST_STATUS: { readonly [K in TerritoryRequestStatus]: K } = {
    ok: 'ok',
    offline: 'offline',
    failed: 'failed',
    rejected: 'rejected',
    invalid: 'invalid',
};
