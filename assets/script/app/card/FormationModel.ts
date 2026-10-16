/**
 * 阵型（布阵方案）的数据模型与边界校验 —— **纯函数、零引擎依赖**。
 *
 *  `FormationService` 负责网络与缓存，本文件只回答「这份数据能不能用」。
 *  拆开的原因不是洁癖：`FormationService` 经 `GameNet` 拉进 `cc`，在 Node 单测里
 *  **import 就炸**，而校验规则恰恰是最需要被用例锁住的部分
 *  （服务端少回一个字段、id 回成 0 或字符串，都不该把整块面板带崩）。
 */

/**
 * 经过边界校验的阵型。
 *
 * `heroIds` 与 `pvpCard.id` / 后端英雄 `heroId` 同一套编号；工程内卡 id 一律走字符串，
 * 所以与卡表对齐时用 `String(heroId)`（见 `LineupPresets.buildPresetDecks`）。
 */
export interface ZCFormation {
    readonly formationId: number;
    readonly heroIds: readonly number[];
    /** 1=当前选中阵型，0=未选中 */
    readonly selected: boolean;
}

/** 单条阵型的边界校验；`heroId` 逐项过滤非法值并去重（同一英雄只能上一次）。 */
export function normalizeFormation(info: CmdFormationInfo | null | undefined): ZCFormation | null {
    if (!info) return null;
    const formationId = toPositiveInt(info.formationId);
    if (formationId === null) return null;
    return { formationId, heroIds: normalizeHeroIds(info.heroId), selected: info.select === 1 };
}

/**
 * 整份列表的边界校验：逐条过滤非法项，按 `formationId` 去重（后出现的覆盖前值），再按 id 升序。
 * 升序是给「页签下标 → formationId」的映射用的，不要改成保持原顺序。
 */
export function normalizeFormations(infos: CmdFormationInfoRspMsg['infos']): readonly ZCFormation[] {
    const result = new Map<number, ZCFormation>();
    for (const info of infos ?? []) {
        const formation = normalizeFormation(info);
        if (!formation) {
            console.warn('[FormationModel] 服务端返回了非法阵型数据，已跳过', info);
            continue;
        }
        result.set(formation.formationId, formation);
    }
    // 必须用 `Array.from` 而不是 `[...result.values()]`：构建期 Babel（loose）会把展开
    // 降级成 `[].concat(map.values())`，而 concat 不展开迭代器 → 调用方拿到的是 [MapIterator]，
    // 遍历它得到的东西根本不是 ZCFormation（`PvpHeroService` 同款坑）。
    return Array.from(result.values()).sort((a, b) => a.formationId - b.formationId);
}

/** 上阵英雄 id 列表：过滤非法项并去重，保持原顺序。 */
export function normalizeHeroIds(heroIds: readonly number[] | null | undefined): number[] {
    const seen = new Set<number>();
    const result: number[] = [];
    for (const raw of heroIds ?? []) {
        const heroId = toPositiveInt(raw);
        if (heroId === null || seen.has(heroId)) continue;
        seen.add(heroId);
        result.push(heroId);
    }
    return result;
}

/** 正整数字段（`uint32` 的 `formationId` / `heroId` 都是这个口径）。 */
export function toPositiveInt(value: unknown): number | null {
    const num = Number(value);
    return Number.isSafeInteger(num) && num > 0 ? num : null;
}

/**
 * 给一个 Promise 兜**硬超时**：`ms` 内没兑现就用 `fallback()` 顶上，**保证一定兑现**。
 *
 * 为什么必须有它：`GameNet.send` 只在「收到回包」或「断线」时兑现（`NetSocket.onTimeOut()`
 * 只在断线清心跳 / `ClearAllRequest()` 里被调用），**没有按请求的超时** —— 服务端不认识
 * 某条消息、干脆不回应时，那个 Promise 会**永远悬着**。若把它放进 `Promise.all` 做数据加载，
 * 整个面板就停在 prefab 占位外观（站台空、计数 0、列表空白），而且**离线跑不出来**
 * （离线时请求根本不发），只在连真服时才炸 —— 2026-09-20 就这么炸过一次。
 *
 * 放纯模块里是为了能被单测覆盖：`FormationService` 经 `GameNet` 拉进 `cc`，Node 里 import 不了。
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
