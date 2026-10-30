/**
 * 城池榜单 —— **纯规则，零 `cc`、零 `Date`、零随机源**。
 *
 * 存在原因：战功公式里的 `rank`（名次系数）和 `attackers`（拥挤系数）一直没人传，
 * 两个参数恒等于 1 ⇒ 名次系数永远 100%、拥挤系数永远 1.0，两条公式等于死代码。
 * 这里补上「名次从哪来」，把它们接活。
 *
 * 分工（与 `IBigMapStorage` 一致）：
 * - **本文件** = 单机/离线档的 NPC 模拟榜，**确定性**（同 `cityId` + 同样玩家战功必然同结果，
 *   存档可复现、测试可比对）；
 * - **联机版** = 服务器下发真实榜单，实现 `IBigMapRankProvider` 端口即可，本文件降级成离线样本。
 *
 * ⚠️ NPC 战功是**推算值**，不是策划数据：等协议就位后整块被服务器数据替换，
 * 所以不要把它接进存档，也不要让 UI 依赖具体数值。
 */
import type { IBigMapConfig } from './BigMapTypes';

/** 榜单一条：谁、多少战功、排第几。`isPlayer` 只给 UI 高亮用。 */
export interface IBigMapCityRankEntry {
    readonly rank: number;
    readonly warScore: number;
    readonly isPlayer: boolean;
}

/** 一座城的榜单快照。 */
export interface IBigMapCityRankBoard {
    readonly cityId: number;
    readonly entries: readonly IBigMapCityRankEntry[];
    /** 玩家在这座城的名次（从 1 起；没上榜也有名次 = 榜尾 + 1）。 */
    readonly playerRank: number;
    /** 同时在打的人数（含玩家），直接喂 `bigMapCrowdCoeff`。 */
    readonly attackerCount: number;
    readonly topWarScore: number;
}

/**
 * 城池榜单端口。
 *
 * 联机版 = 服务器 `ReqBigMapCityInfo` 的榜单部分；单机版 = `buildBigMapCityRankBoard` 的 NPC 模拟。
 * 端口是 async（真实实现必然走网络），但**不阻塞渲染**：Presenter 缓存上一份榜单、视图同步读。
 */
export interface IBigMapRankProvider {
    fetchCityRank(cityId: number, playerWarScore: number): Promise<IBigMapCityRankBoard>;
}

/** 32 位混合哈希 —— 只用来把 `cityId` 打散成种子，不需要密码学强度。 */
function hash32(value: number): number {
    let h = (value ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

/** 线性同余 —— 一条链自己往下滚，保证同一种子出同一串数。 */
function nextRandom(state: number): number {
    return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

/** NPC 人数范围：5~12 人（与文档「一城辐射 8~12 个基地」同量级，但这是**人数**不是辐射容量）。 */
const NPC_MIN = 5;
const NPC_SPAN = 8;

/**
 * 造一座城的 NPC 榜单并把玩家插进去。
 *
 * @param playerWarScore 玩家在这座城当日的累计战功（存档 `battle.cityWarScore[cityId]`）。
 */
export function buildBigMapCityRankBoard(
    config: IBigMapConfig,
    cityId: number,
    playerWarScore: number,
): IBigMapCityRankBoard {
    const city = config.cities.get(cityId);
    if (!city) throw new Error(`[BigMap] 榜单取不到城池配置：${cityId}`);
    const level = config.cityLevels.get(city.cityLevel);
    // 基准战功 = 该等级的「最低占领战功」，NPC 战功围绕它上下浮动。
    const baseline = Math.max(1, level?.minOccupyWarScore ?? 1000);

    let state = hash32(cityId);
    const npcCount = NPC_MIN + (state % NPC_SPAN);
    const scores: number[] = [];
    for (let index = 0; index < npcCount; index += 1) {
        state = nextRandom(state);
        // 0.15 ~ 1.20 倍基准：既有人还没打出成绩，也有已经能占领的。
        const ratio = 0.15 + ((state % 1000) / 1000) * 1.05;
        scores.push(Math.round(baseline * ratio));
    }
    scores.push(Math.max(0, Math.round(playerWarScore)));

    // 战功降序；同分时玩家优先（避免「刚追上就被别人压一名」的体感问题）。
    const sorted = scores
        .map((warScore, index) => ({ warScore, isPlayer: index === npcCount }))
        .sort((a, b) => b.warScore - a.warScore || (a.isPlayer ? -1 : b.isPlayer ? 1 : 0));

    const entries: IBigMapCityRankEntry[] = sorted.map((item, index) => ({
        rank: index + 1,
        warScore: item.warScore,
        isPlayer: item.isPlayer,
    }));
    const playerEntry = entries.find((entry) => entry.isPlayer);

    return {
        cityId: city.cityId,
        entries,
        playerRank: playerEntry.rank,
        // 拥挤系数吃「同时在打的人」：有战功的才算，0 分的没上榜不算在场。
        attackerCount: entries.filter((entry) => entry.warScore > 0).length,
        topWarScore: entries[0]?.warScore ?? 0,
    };
}

/** 从城池配置直接造一份「只有玩家」的榜（榜单端口未注入时用）。 */
export function buildSoloRankBoard(cityId: number, playerWarScore: number): IBigMapCityRankBoard {
    const score = Math.max(0, Math.round(playerWarScore));
    return {
        cityId,
        entries: [{ rank: 1, warScore: score, isPlayer: true }],
        playerRank: 1,
        attackerCount: score > 0 ? 1 : 0,
        topWarScore: score,
    };
}
