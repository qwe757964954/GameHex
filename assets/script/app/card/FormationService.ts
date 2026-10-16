import { RequestFormationInfo, RequestFormationOp, RequestFormationSelect } from '../generated/requestMsg/RequestFormationMsg';
import { GameNet } from '../net/GameNet';
import { normalizeFormation, normalizeFormations, toPositiveInt, normalizeHeroIds, withTimeout } from './FormationModel';
import type { ZCFormation } from './FormationModel';

export type { ZCFormation } from './FormationModel';
export { normalizeFormation, normalizeFormations } from './FormationModel';

/**
 * 阵型的**网络与缓存**层（数据模型与校验在 `FormationModel`，那是纯函数、可单测）。
 *
 * 对应协议 `CmdFormationInfoReqMsg` / `CmdFormationOpReqMsg`（见 `RequestFormationMsg.ts`）。
 */

/** 保存阵型的三态结果。`offline` 与 `failed` 要分开：前者是「没登录 / 没连上」，后者是「服务端没给合法响应」。 */
export type FormationSaveResult =
    | { readonly kind: 'success'; readonly formation: ZCFormation }
    | { readonly kind: 'offline' }
    | { readonly kind: 'failed' };

/**
 * 阵型请求的**硬超时**（毫秒）。
 *
 * 必须自己兜一个，因为 `GameNet.send` 只在「收到回包」或「断线」时兑现
 * （`NetSocket.onTimeOut()` 只在断线清心跳 / `ClearAllRequest()` 里被调用），
 * **没有按请求的超时**。于是「服务端不认这条消息、不回应」就 = 这个 Promise 永远悬着。
 * 布阵面板的数据加载被这样一条请求拖住会**整屏停在 prefab 占位外观**
 * （站台空、职业计数 0、卡池空白），2026-09-20 真机上就是这么炸的。
 *
 * 内网正常应答是毫秒级，所以这个值只是"不正常时尽快降级"的阈值，不是"给慢请求留的时间"。
 */
export const FORMATION_REQUEST_TIMEOUT_MS = 3000;

/**
 * 阵型**保存**的硬超时（毫秒）。
 *
 * 同一条原因（`GameNet.send` 无按请求超时），但后果不同：保存是用户主动点的，
 * 页面会 `saving = true` 并禁用按钮、把文字改成「保存中…」——
 * 请求悬着就是**按钮永远卡在保存中、再也点不动**。所以这里也得兜。
 *
 * 比读取给得宽：读取超时只是"这次先不看后端数据"，保存超时会**误报失败**
 * （服务端其实可能已经存了），要尽量避免，所以留出真实写入的时间。
 */
export const FORMATION_SAVE_TIMEOUT_MS = 5000;

let cachedFormations: readonly ZCFormation[] | null = null;
let pendingRequest: Promise<readonly ZCFormation[] | null> | null = null;

/**
 * 拉取当前角色的全部阵型。
 *
 * 返回 `null` 表示当前没有可用的后端数据（未连接、请求失败、超时）；空数组是服务端明确返回「一个阵型都没有」。
 * 并发调用合并成同一个请求（布阵弹窗反复开关时不会连发）。
 *
 * **本函数保证在 `FORMATION_REQUEST_TIMEOUT_MS` 内兑现**，绝不悬空 —— 调用方可以放心 await。
 */
export function fetchFormations(): Promise<readonly ZCFormation[] | null> {
    if (!pendingRequest) {
        pendingRequest = requestFormations().finally(() => {
            pendingRequest = null;
        });
    }
    const inflight = pendingRequest;
    return withTimeout(inflight, FORMATION_REQUEST_TIMEOUT_MS, () => {
        console.warn(
            `[FormationService] 阵型请求 ${FORMATION_REQUEST_TIMEOUT_MS}ms 无响应，`
            + '布阵面板先按本地卡组渲染',
        );
        return cachedFormations;
    });
}

/** 读取最近一次成功响应。 */
export function getCachedFormations(): readonly ZCFormation[] | null {
    return cachedFormations;
}

/**
 * 把一份阵型写回本地缓存（保存成功后调用）。
 *
 * 保存响应（`CmdFormationOpRspMsg.info`）回的就是**操作后的阵型**，直接换掉缓存里那一条即可 ——
 * 不补这一步的话，用户保存后马上切页签再切回来，看到的还是保存前的旧卡组。
 */
export function applyFormation(formation: ZCFormation): void {
    const current = cachedFormations ?? [];
    const replaced = current.map((entry) => (entry.formationId === formation.formationId ? formation : entry));
    if (!current.some((entry) => entry.formationId === formation.formationId)) replaced.push(formation);
    cachedFormations = replaced.slice().sort((a, b) => a.formationId - b.formationId);
}

/**
 * 保存（覆盖）一个阵型。
 *
 * 客户端只负责「把整份阵型发上去」——合法性、上阵数量上限由服务端判定，
 * 所以这里**不做本地预校验**（除了挡住明显非法的 id，避免发一个服务端必然拒绝的包）。
 */
export async function saveFormation(
    formationId: number,
    heroIds: readonly number[],
    caller?: unknown,
): Promise<FormationSaveResult> {
    const net = GameNet.instance;
    if (!net.isConnected) return { kind: 'offline' };

    const normalizedId = toPositiveInt(formationId);
    if (normalizedId === null) {
        console.warn('[FormationService] formationId 非法，已取消保存', formationId);
        return { kind: 'failed' };
    }

    return withTimeout(
        sendFormationOp(normalizedId, normalizeHeroIds(heroIds), caller),
        FORMATION_SAVE_TIMEOUT_MS,
        () => {
            console.warn(
                `[FormationService] 阵型保存 ${FORMATION_SAVE_TIMEOUT_MS}ms 无响应，按失败处理`
                + '（否则保存按钮会永远停在「保存中」，只能重开面板）',
            );
            return { kind: 'failed' } as const;
        },
    );
}

/**
 * 发保存请求。
 *
 *  `heroIds` 收 **mutable** 数组：`saveFormation` 已经过 `normalizeHeroIds()`（返回的
 *  就是 `number[]`），而 proto 生成类型的 `heroId` 字段是 `number[]` ——
 *  这里再标 `readonly` 会撞 TS4104，而加一层拷贝只为过检查不值当。
 */
async function sendFormationOp(
    formationId: number,
    heroIds: number[],
    caller?: unknown,
): Promise<FormationSaveResult> {
    let response: CmdFormationOpRspMsg | null = null;
    try {
        //  保存 = 保存**并**选中（`select = 1`）。
        //
        //  `CmdFormationInfo.select` 的口径是 `1 选中 / 0 没选中`（见 proto 与 `FormationModel`）。
        //  发 0 的话只是把卡存下来了，服务端记着的「出阵阵型」仍旧是别的那一条 ——
        //  而卡牌阵容页的八卡读的正是「选中阵型」（`LineupPresets.resolveSelectedDeck`），
        //  玩家会觉得「改了半天下阵/上阵，保存完界面没变」。
        //
        //  这也解释了为什么独立的 `CmdFormationSelectReqMsg` 现在没有调用方：
        //  `LineupBoardPage.selectPreset()` 里那段 `selectFormation(...)` 已注释掉，
        //  切页签不再单独发包，**保存是同步选中状态的唯一时机**。别把这里改回 0。
        const ok = await GameNet.instance.send(new RequestFormationOp(
            { info: { formationId, heroId: heroIds, select: 1 } },
            caller as any,
            (rsp) => { response = rsp; },
        ), false);
        if (!ok || !response) return { kind: 'failed' };
    } catch (error) {
        console.warn('[FormationService] 阵型保存请求失败', error);
        return { kind: 'failed' };
    }

    const raw = (response as CmdFormationOpRspMsg).info;
    const formation = normalizeFormation(raw);
    if (!formation) {
        console.warn('[FormationService] 保存响应里的阵型非法', raw);
        return { kind: 'failed' };
    }
    // 服务端理应回同一条；回别的就按返回的存，但必须出声，否则本地缓存会静默错位。
    if (formation.formationId !== formationId) {
        console.warn('[FormationService] 保存响应的 formationId 与请求不一致', formationId, formation.formationId);
    }
    applyFormation(formation);
    return { kind: 'success', formation };
}

/**
 * 选中某个阵型（切换页签时调用）。
 *
 * 告诉服务端「当前出战的是这个阵型」，服务端会把其他阵型的 select 置 0，当前的置 1。
 * 成功后更新本地缓存的 selected 状态。
 */
export async function selectFormation(formationId: number, caller?: unknown): Promise<boolean> {
    const net = GameNet.instance;
    if (!net.isConnected) return false;

    const normalizedId = toPositiveInt(formationId);
    if (normalizedId === null) {
        console.warn('[FormationService] formationId 非法，已取消选中', formationId);
        return false;
    }

    try {
        let response: CmdFormationSelectRspMsg | null = null;
        const ok = await net.send(new RequestFormationSelect(
            { formationId: normalizedId },
            caller as any,
            (rsp) => { response = rsp; },
        ), false);
        if (!ok || !response) return false;
        // 更新本地缓存：其他阵型 selected=false，当前的 selected=true
        if (cachedFormations) {
            cachedFormations = cachedFormations.map((entry) => ({
                ...entry,
                selected: entry.formationId === normalizedId,
            }));
        }
        return true;
    } catch (error) {
        console.warn('[FormationService] 选中阵型请求失败', error);
        return false;
    }
}

async function requestFormations(): Promise<readonly ZCFormation[] | null> {
    const net = GameNet.instance;
    if (!net.isConnected) return cachedFormations;

    let response: CmdFormationInfoRspMsg | null = null;
    try {
        const ok = await net.send(new RequestFormationInfo(
            {},
            undefined,
            (rsp) => { response = rsp; },
        ), false);
        if (!ok || !response) return cachedFormations;
    } catch (error) {
        console.warn('[FormationService] 请求阵型失败，布阵面板退回本地卡组', error);
        return cachedFormations;
    }

    //  必须断言：`response` 的赋值发生在回调里，TS 不做跨函数控制流分析 ——
    //  在它眼里 `response` 始终还是初始值 `null`，上面那句 `!response` 早退之后
    //  类型就被收窄成 `never` 了。运行时是好的，只是检查器读不出来。
    //  （`sendFormationOp` 里对 `CmdFormationOpRspMsg` 用的是同一套写法。）
    cachedFormations = normalizeFormations((response as CmdFormationInfoRspMsg).infos);
    return cachedFormations;
}
