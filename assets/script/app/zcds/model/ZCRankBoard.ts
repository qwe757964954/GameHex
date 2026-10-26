/**
 * 对局内排行榜（蓝湖「排行榜」设计稿）的**纯 TS 数据层**。
 *
 * ## 这是「对局内」排行，不是章节榜
 *
 *  别跟 `celebration` 的开服冲榜搞混：那一套走 `CmdGetRankReqMsg` 查服务端
 * （`CelebrationRepository.requestRank`），指标是战力；本模块**不发任何网络请求** ——
 * 数据全部来自本局模型 `ZCGameModel`（`owners` + `territoryCount`）。
 *
 * ## 数据源（三处，都已存在，本模块只是读）
 *
 * | 需要 | 来源 |
 * |---|---|
 * | 本局有哪些席位 | `ZCGameModel.owners`（`2~4` 个 `ZCOwner`） |
 * | 每方占了几格 | `ZCGameModel.territoryCountOf(owner)` |
 * | 席位的名字 / 头像 | `seatProfiles` —— `ZCGame` 从后端 `battle.units` 建的映射 |
 *
 * ##  「比赛中…」态是设计稿的一部分，不是异常
 *
 * 设计稿 4 行里第 3、4 行右侧是 `di_02` + 一行提示文字，而不是地块数字。
 * 那是**本局还没打下来的席位**：对局进行中，地块数随时会变，
 * 提前把数字画出来等于给玩家一个会跳变的承诺。所以统一走
 * {@link IRankSeat.isPlaying} —— 它为 true 时渲染层显示 `di_02` + 文案，
 * 且**地块数一律不显示**（不是显示 0）。
 *
 * ## 排序口径
 *
 * 地块数**降序**；同分时按 `ZCOwner` 的席位序（`player` → `enemy` → `enemy2` → `enemy3`），
 * 保证「同分时排在一起」且**顺序稳定** —— 不稳定会让虚拟列表每帧重排、行闪烁。
 *
 * 规则 78：**禁 import `cc`**，因此本文件可在 Node 下直接单测。
 */

import { ZCOwner } from './ZCMapConfig';
import { ownerForSection } from './ZCMapConfig';

/** 一条排行数据。 */
export interface IRankSeat {
    readonly owner: ZCOwner;
    /** 名次，从 1 开始。 */
    readonly rank: number;
    readonly name: string;
    /** 头像资源路径（`icons/head` 下的键；空串 = 还没取到，渲染层留默认）。 */
    readonly headKey: string;
    /** 已占领地块数。 `isPlaying` 为 true 时**不要显示它**。 */
    readonly territoryCount: number;
    /** 是否是"比赛中"（设计稿的 `di_02` 提示态）。 */
    readonly isPlaying: boolean;
}

/** 席位档案：名字 + 头像。由 `ZCGame` 持有，本模块只读。 */
export interface IRankSeatProfile {
    readonly name: string;
    readonly headKey: string;
}

/** 一局的席位档案表（键 = `ZCOwner`）。 */
export type RankSeatProfiles = ReadonlyMap<ZCOwner, IRankSeatProfile>;

/** 「比赛中…」提示文案。 */
export const RANK_PLAYING_TEXT = '比赛中…';

/** 兜底席位名（后端没给名字时）。按席位序，与 `ZCOWNER_ORDER` 一致。 */
export const RANK_FALLBACK_NAMES: Readonly<Record<ZCOwner, string>> = {
    player: '我方',
    enemy: '敌方',
    enemy2: '敌方2',
    enemy3: '敌方3',
};

/**
 * 席位比较器：地块数降序 → 席位序升序。
 *
 * 导出成独立函数是为了让「排序稳定性」能被单测直接钉住，
 * 不必再起一个 model 才能验（规则 78：本文件不 import `cc`）。
 */
export function compareRankSeats(a: IRankSeat, b: IRankSeat): number {
    if (b.territoryCount !== a.territoryCount) return b.territoryCount - a.territoryCount;
    return RANK_SEAT_ORDER.indexOf(a.owner) - RANK_SEAT_ORDER.indexOf(b.owner);
}

/**
 * 席位序（与 `ZC_OWNER_ORDER` 保持一致）。
 *
 *  自己另存一份而**不 import `ZC_OWNER_ORDER`**：那个常量在 `ZCMapConfig` 里，
 * 而 `zcds-view-fixtures` 的 `load` 只认 `./X`，跨到 `../model/…` 的值导入会落进
 * 兜底分支报 ENOENT（规则 167）。这里复制一份并在单测里断言两者一致。
 */
export const RANK_SEAT_ORDER: readonly ZCOwner[] = [ZCOwner.Player, ZCOwner.Enemy, ZCOwner.Enemy2, ZCOwner.Enemy3];

/**
 * 排出本局排行榜。
 *
 * @param owners 本局参赛席位（`model.owners`）
 * @param territoryCountOf 取某方已占领地块数（`model.territoryCountOf`）
 * @param profiles 席位档案；缺项时用 {@link RANK_FALLBACK_NAMES} + 空头像
 * @param finished 对局是否已结束。**进行中**的席位标 `isPlaying`（设计稿的提示态）。
 * @returns 按名次升序的排行（名次从 1 开始）
 */
export function buildRankSeats(
    owners: readonly ZCOwner[],
    territoryCountOf: (owner: ZCOwner) => number,
    profiles: RankSeatProfiles,
    finished: boolean,
): IRankSeat[] {
    const rows = owners.map((owner) => {
        const profile = profiles.get(owner);
        const count = Math.max(0, Math.floor(Number(territoryCountOf(owner)) || 0));
        return {
            owner,
            name: profile?.name || RANK_FALLBACK_NAMES[owner],
            headKey: profile?.headKey ?? '',
            territoryCount: count,
            //  整局结束后一律给真值 —— 「比赛中」是**对局进行中**的语义，
            // 结算界面还写「比赛中」是错的。
            isPlaying: !finished && count === 0,
        };
    });
    rows.sort(compareRankSeats);
    return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

/**
 * 由「后端下发的席位」建席位档案表（键 = `ZCOwner`）。
 *
 * ##  为什么不能只取 `sorted[0]` / `sorted[1]`
 *
 * `ProcedureGame` 原实现是：
 * ```ts
 * const sorted = [...battle.units].sort((a, b) => a.campId - b.campId);
 * const self = sorted.find((u) => u.roleId === selfRoleId) ?? sorted[0];
 * const foe  = sorted.find((u) => u !== self) ?? sorted[1];
 * IZCGameEntry.seatProfiles = buildSeatProfiles(battle.units, selfRoleId);
 * ```
 * 两槽昵称不够承载 3~4 人局的排行榜；完整档案随单局 entry 交接。
 * HUD 顶部与传说卡横幅只显示两栏所以看不出来，但排行榜要按 2~4 席逐行渲染。
 *
 * ## 席位映射
 *
 * `campId`（1~4）经 `ownerForSection` 转 `ZCOwner`。**不能用下标硬凑** ——
 * `campId` 缺 1 时下标会整体错位（`ownerForSection` 已做 `>= 1` 校验，非法值返 `null` 跳过）。
 *
 * @param units 后端席位（已按 campId 排序最佳，函数内也会再排一次保证确定性）
 * @param selfRoleId 自己的 roleId；用来把「我方」标成 `player` 槽（否则第 1 席未必是自己）
 * @returns 键 = `ZCOwner` 的档案表；`campId` 非法的席位**跳过**（不猜它属于谁）
 */
export function buildSeatProfiles(
    units: readonly { readonly campId: number; readonly roleId: string; readonly name: string; readonly avatarId: string }[],
    selfRoleId: string | null,
): Map<ZCOwner, IRankSeatProfile> {
    const profiles = new Map<ZCOwner, IRankSeatProfile>();
    //  两道过滤/排序，缺一不可：
    //   ① 校验 `campId` 合法（1~4）—— 非法席位**跳过**，不猜它属于谁。
    //      少了这步：`campId=0/9` 的脏数据会被当成合法席位塞进槽位（实测）。
    //   ② 按 campId 升序 —— 结果表的插入序稳定，不依赖调用方传入顺序。
    const sorted = units
        .filter((unit) => ownerForSection(unit.campId) !== null)
        .sort((a, b) => a.campId - b.campId);
    //  **不能**直接 `ownerForSection(campId)` 后再把"自己"那档改写成 `player`：
    // 自己若在 campId=2，`ownerForSection(2)` 给 enemy，而 campId=1 那位会给 player
    // ⇒ 两个都写 `player` 键，后者覆盖前者，**敌方凭空消失一档**（实测踩过，用例 14 抓到的）。
    //
    // 正解：**先把自己钉进 `player` 槽并从待分配里摘掉**，其余席位按 campId 顺序
    // 取 `RANK_SEAT_ORDER` 里**尚未被占用**的槽 —— 槽位与席位一一对应，
    // 且"自己永远是 player"与"其余按序"两条规则不打架。
    const selfUnit = selfRoleId ? sorted.find((unit) => unit.roleId === selfRoleId) : undefined;
    const rest = selfUnit ? sorted.filter((unit) => unit !== selfUnit) : sorted;
    if (selfUnit) {
        profiles.set(ZCOwner.Player, {
            name: selfUnit.name || RANK_FALLBACK_NAMES.player,
            headKey: selfUnit.avatarId || '',
        });
    }
    let cursor = 0;
    for (const unit of rest) {
        // `RANK_SEAT_ORDER[0]` 是 player，已被自己（或留空）占用 ⇒ 从 1 起找空槽。
        while (cursor < RANK_SEAT_ORDER.length && profiles.has(RANK_SEAT_ORDER[cursor])) cursor += 1;
        const owner = RANK_SEAT_ORDER[cursor];
        if (!owner) continue;
        // SLG 守军仍是完整参战席位，但 showInfo.name 可为空；名称沿用阵营兜底，避免 HUD 出现空行。
        profiles.set(owner, { name: unit.name || RANK_FALLBACK_NAMES[owner], headKey: unit.avatarId || '' });
    }
    return profiles;
}

/**
 * 名次徽章资源键（设计稿的 `icon_01 / icon_02 / icon_03`）。
 *
 * 前三名有专属奖章图，第四名及以后**没有图** —— 返回空串，
 * 渲染层要退化成纯数字文本，不能拿第 3 张图糊过去。
 */
export function rankBadgeKeyOf(rank: number): string {
    if (rank === 1) return 'icon_01';
    if (rank === 2) return 'icon_02';
    if (rank === 3) return 'icon_03';
    return '';
}

/** 行底板资源键：第一名单独一张高亮底（`phb_list_01`），其余共用 `phb_list_02`。 */
export function rowBackgroundKeyOf(rank: number): string {
    return rank === 1 ? 'phb_list_01' : 'phb_list_02';
}
