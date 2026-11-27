import { RequestFormationInfo, RequestFormationOp, RequestFormationSelect } from '../generated/requestMsg/RequestFormationMsg';
import { GameNet } from '../net/GameNet';
import { withTimeout } from '../net/RequestGuard';
import type { GameRequestStatus } from '../net/RequestGuard';
import type { ZCFormation } from './FormationModel';
import { normalizeFormation, normalizeFormations, normalizeHeroIds, toPositiveInt } from './FormationModel';

export { normalizeFormation, normalizeFormations } from './FormationModel';
export type { ZCFormation } from './FormationModel';

/**
 * 阵型的网络与缓存层；数据模型与校验在 FormationModel。
 */

/** 保存阵型的三态结果。`offline` 与 `failed` 要分开：前者是「没登录 / 没连上」，后者是「服务端没给合法响应」。 */
export type FormationSaveResult =
    | { readonly kind: 'success'; readonly formation: ZCFormation }
    | { readonly kind: 'offline' }
    | { readonly kind: 'failed' };

/**
 * 阵型读取的硬超时。GameNet.send 没有按请求超时，服务端不回应时 Promise 会一直悬着，
 * 面板会停在 prefab 占位外观。
 */
const FORMATION_REQUEST_TIMEOUT_MS = 3000;

/**
 * 阵型保存的硬超时。保存是用户主动操作，超时会误报失败，所以比读取给得宽。
 */
export const FORMATION_SAVE_TIMEOUT_MS = 5000;

/**
 * 预取结果的新鲜期。切 tab 时 prefetchHero 先拉过一次，
 * 页面在 prefab 加载后复用这份结果，避免同一份阵型再等一个 RTT。
 */
export const FORMATION_PREFETCH_FRESH_MS = 1500;

let cachedFormations: readonly ZCFormation[] | null = null;
/** `cachedFormations` 是什么时候拿到的（毫秒时间戳）；用于 `maxAgeMs` 的新鲜期判定。 */
let cachedAt = 0;
let pendingRequest: ReturnType<typeof requestFormations> | null = null;
let sessionRevision = 0;
let writeRevision = 0;

/**
 * 重置阵型本地缓存（注销登录 / 切换会话时调用）。
 * 清空驻留的服务端阵型数据，避免跨会话状态污染。
 */
export function resetFormationSession(): void {
    sessionRevision++;
    const previous = pendingRequest;
    pendingRequest = null;
    previous?.cancel();
    cachedFormations = null;
    cachedAt = 0;
    selectProtocolWarned = false;
}

/** `fetchFormations()` 的等待策略（不传 = 老口径 3000ms）。 */
export interface FormationFetchOptions {
    /** 本次等待上限（毫秒）。 */
    readonly timeoutMs?: number;
    /** 超时日志里的调用方名字，用来区分是哪个界面在等。 */
    readonly label?: string;
    /** 缓存新鲜期：此时长内直接复用，不再发请求。 */
    readonly maxAgeMs?: number;
}

/**
 * 拉取当前角色的全部阵型。返回 null 表示没有可用的后端数据，空数组表示服务端确认没有阵型。
 * 并发调用合并成同一个请求，并保证在超时时间内兑现。
 */
export function fetchFormations(options: FormationFetchOptions = {}): Promise<readonly ZCFormation[] | null> {
    const timeoutMs = Math.max(1, Math.round(options.timeoutMs ?? FORMATION_REQUEST_TIMEOUT_MS));
    // 新鲜期内直接复用：不发请求、也不动 `pendingRequest`（可能正被别的调用方用着）。
    const maxAgeMs = Math.max(0, Math.round(options.maxAgeMs ?? 0));
    if (maxAgeMs > 0 && cachedFormations !== null && Date.now() - cachedAt <= maxAgeMs) {
        return Promise.resolve(cachedFormations);
    }
    const session = sessionRevision;
    if (!pendingRequest) {
        const request = requestFormations(session, writeRevision);
        pendingRequest = request;
        void request.promise.then(() => {
            if (pendingRequest === request) pendingRequest = null;
        });
    }
    return withTimeout(pendingRequest.promise, timeoutMs, () => {
        if (session !== sessionRevision) return null;
        console.warn(
            `[FormationService] ${options.label ?? '阵型'}请求 ${timeoutMs}ms 无响应，`
            + '先按本地卡组 / 本地快照渲染',
        );
        return cachedFormations;
    });
}

/** 读取最近一次成功响应。 */
export function getCachedFormations(): readonly ZCFormation[] | null {
    return cachedFormations;
}

/**
 * 把保存响应写回本地缓存。不更新的话，保存后切页签再回来看到的还是旧卡组。
 */
export function applyFormation(formation: ZCFormation): void {
    const current = cachedFormations ?? [];
    const replaced = current.map((entry) => {
        if (entry.formationId === formation.formationId) return formation;
        return formation.selected ? { ...entry, selected: false } : entry;
    });
    if (!current.some((entry) => entry.formationId === formation.formationId)) replaced.push(formation);
    cachedFormations = replaced.slice().sort((a, b) => a.formationId - b.formationId);
    writeRevision++;
    // 刚保存过的缓存算「新鲜」，否则 `maxAgeMs` 会把玩家自己刚改的结果挡掉。
    cachedAt = Date.now();
}

/**
 * 保存阵型。合法性由服务端判定，客户端只挡住明显非法的 id。
 */
export async function saveFormation(
    formationId: number,
    heroIds: readonly number[],
    caller?: object,
): Promise<FormationSaveResult> {
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
 * 发保存请求。heroIds 用可变数组，避免 proto 类型需要只读数组时多做一层拷贝。
 */
async function sendFormationOp(
    formationId: number,
    heroIds: number[],
    caller?: object,
): Promise<FormationSaveResult> {
    const session = sessionRevision;
    let response: CmdFormationOpRspMsg | null = null;
    try {
        // 保存顺带置选中。否则服务端记着的出阵阵型仍是别的，而阵容页读的是选中阵型，
        // 玩家会看到保存后界面没变。切页签走独立的 selectFormation，只换选中不动卡组。
        const status = await GameNet.sendRequest(() => new RequestFormationOp(
            { info: { formationId, heroId: heroIds, select: 1 } },
            caller,
            (rsp) => { response = rsp; },
        ), { timeoutMs: FORMATION_SAVE_TIMEOUT_MS, tag: 'FormationService' });
        if (session !== sessionRevision) return { kind: 'failed' };
        if (status === 'offline') return { kind: 'offline' };
        if (status !== 'ok' || !response) return { kind: 'failed' };
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
 * 选中协议是否已登记 MessageId。当前只有 message 定义、没有编号，
 * 缺号就跳过并只提示一次，服务端补号后自动生效。
 */
let selectProtocolWarned = false;
function hasSelectProtocol(): boolean {
    if (GameNet.instance.protoMgr?.getMessageId('CmdFormationSelectReqMsg') != null) return true;
    if (!selectProtocolWarned) {
        selectProtocolWarned = true;
        console.warn(
            '[FormationService] MessageId 里没有 CmdFormationSelectRspMsg，切页签只做本地同步；'
            + '服务端补上协议号并重新导出 proto 后会自动生效',
        );
    }
    return false;
}

/**
 * 选中某个阵型。成功后本地缓存的 selected 状态跟着更新。
 * 超时按失败返回，调用方已经切过去的本地页签不回滚。
 */
export function selectFormation(formationId: number, caller?: object): Promise<boolean> {
    if (!hasSelectProtocol()) return Promise.resolve(false);

    const normalizedId = toPositiveInt(formationId);
    if (normalizedId === null) {
        console.warn('[FormationService] formationId 非法，已取消选中', formationId);
        return Promise.resolve(false);
    }

    return withTimeout(sendFormationSelect(normalizedId, caller), FORMATION_REQUEST_TIMEOUT_MS, () => {
        console.warn(
            `[FormationService] 选中阵型 ${FORMATION_REQUEST_TIMEOUT_MS}ms 无响应，按失败处理`
            + '（本地页签已经切过去了，下次进界面再校正）',
        );
        return false;
    });
}

async function sendFormationSelect(formationId: number, caller?: object): Promise<boolean> {
    const session = sessionRevision;
    let response: CmdFormationSelectRspMsg | null = null;
    try {
        const status = await GameNet.sendRequest(() => new RequestFormationSelect(
            { formationId },
            caller,
            (rsp) => { response = rsp; },
        ), { timeoutMs: FORMATION_REQUEST_TIMEOUT_MS, tag: 'FormationService' });
        if (session !== sessionRevision || status !== 'ok' || !response) return false;
    } catch (error) {
        console.warn('[FormationService] 选中阵型请求失败', error);
        return false;
    }
    // 确认选中后，早于该写入发出的查询不能覆盖本地状态。
    writeRevision++;
    if (cachedFormations) {
        cachedFormations = cachedFormations.map((entry) => ({
            ...entry,
            selected: entry.formationId === formationId,
        }));
        cachedAt = Date.now();
    }
    return true;
}

function requestFormations(session: number, write: number) {
    let response: CmdFormationInfoRspMsg | null = null;
    let request: Promise<GameRequestStatus> & { cancel?: () => void };
    try {
        request = GameNet.sendRequest(() => new RequestFormationInfo(
            {},
            undefined,
            rsp => {
                response = rsp;
            },
        ), { timeoutMs: FORMATION_REQUEST_TIMEOUT_MS, tag: 'FormationService' });
    } catch (error) {
        request = Promise.reject(error);
    }
    const promise = request.then(status => {
        if (session !== sessionRevision) return null;
        if (write === writeRevision && status === 'ok' && response) {
            cachedFormations = normalizeFormations(response.infos);
            cachedAt = Date.now();
        }
        return cachedFormations;
    }).catch(error => {
        if (session !== sessionRevision) return null;
        console.warn('[FormationService] 请求阵型失败，布阵面板退回本地卡组', error);
        return cachedFormations;
    });
    return { promise, cancel: () => request.cancel?.() };
}
