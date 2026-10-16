/**
 * 协议命名纯规则（零依赖，可被 node 单测直接覆盖）。
 *
 * 与独立调试台（tools/proto-debugger）同口径：发送方只认「请求协议名」，
 * 用户给 `CmdXxxRspMsg` 或裸名都换算到 `CmdXxxReqMsg`。
 */

/** 归一化到可发送的请求协议名：`CmdXxxRspMsg` → `CmdXxxReqMsg`；裸名自动补 `ReqMsg`。 */
export function toReqProtoName(raw: string): string {
    if (raw.endsWith('RspMsg')) {
        return `${raw.slice(0, -'RspMsg'.length)}ReqMsg`;
    }
    return raw.endsWith('ReqMsg') ? raw : `${raw}ReqMsg`;
}
