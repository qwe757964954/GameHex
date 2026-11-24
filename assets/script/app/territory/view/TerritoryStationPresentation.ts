import type { SpriteFrame } from 'cc';
import type { ITerritoryStationState } from '../application/TerritoryViewState';
import type { TerritoryCampaignStage } from '../model/TerritoryCampaignConfig';
import { territoryLevelBubbleText } from '../model/TerritoryLevelBubble';
import type { TerritorySite, TerritorySiteType } from '../model/TerritoryMapConfig';
import { isTerritoryBattleSite, isTerritoryChestSite, TERRITORY_SITE_TYPE } from '../model/TerritoryMapConfig';
import type { ITerritoryMapArt } from './TerritoryMapArt';
import type { ITerritoryMapRenderInput } from './TerritoryMapView';
import type { ITerritoryStationRender } from './TerritoryStationView';
import {
    TERRITORY_COLORS,
    TERRITORY_STATION_STATE,
    territoryBossTint,
    territoryStationTint,
    territoryUnboundTint,
} from './TerritoryTheme';

const EMPTY_CELL_SET: ReadonlySet<number> = new Set<number>();

const DEFAULT_STATION_STATE: ITerritoryStationState = Object.freeze({
    unlocked: false,
    owned: false,
    opened: false,
    battle: false,
    areaPassed: false,
    openable: false,
    pending: false,
    phase: TERRITORY_STATION_STATE.locked,
    silverRed: false,
    staminaShort: false,
    monsterBoxLv: 0,
});

type TerritorySiteArtKey = {
    [K in keyof ITerritoryMapArt]: ITerritoryMapArt[K] extends SpriteFrame | null ? K : never;
}[keyof ITerritoryMapArt];

/**
 * 站点类型 → 建筑帧字段（按 type 取图的那条**兜底**路径）。
 *
 * 只有 `fixedResource` / `bonus` 会真的走到这里：`stage` / `boss` / `asyncPvp`
 * 在 `stationIconOf` 里就「没配 `buildingId` ⇒ `return null`」早退了，映射表里那三条
 * **不可达**（保留是为了类型完整 + 万一口径再放宽时不用回来补表）。
 * 改建筑外观只需动两处：这里的字段名 + `TerritoryPageAssets.loadTerritoryBattleArt` 的加载路径。
 */
const TERRITORY_SITE_ART: Readonly<Record<TerritorySiteType, TerritorySiteArtKey>> = {
    stage: 'stage',
    boss: 'boss',
    asyncPvp: 'asyncPvp',
    fixedResource: 'fixedResource',
    bonus: 'bonus',
    patrolChest: 'fixedResource',
};

/**
 * 未通关 PVP 头像气泡的四件套（头像 / 黄底框 / 等级角标 / 等级）。
 *
 * 唯一判据是 `visible`：调用方已经把「未通关 + 红底加载到」算好，
 * 这里只决定「有没有头像」。头像为 null ⇒ 四项全空，视图落回原 `PVP` 文字胶囊。
 */
function pvpAvatarBubbleOf(
    input: ITerritoryMapRenderInput,
    visible: boolean,
): Pick<ITerritoryStationRender,
    'levelBubblePortrait' | 'levelBubbleAvatarFrame' | 'levelBubbleLevelFrame' | 'levelBubbleLevel'> {
    const portrait = visible ? input.playerPortrait ?? null : null;
    if (!portrait) {
        return {
            levelBubblePortrait: null,
            levelBubbleAvatarFrame: null,
            levelBubbleLevelFrame: null,
            levelBubbleLevel: 0,
        };
    }
    return {
        levelBubblePortrait: portrait,
        // 两层底与左上角玩家卡同源；任一缺失时视图少画这一层，头像和红底仍照常显示。
        levelBubbleAvatarFrame: input.art.pvpBubbleAvatarFrame ?? null,
        levelBubbleLevelFrame: input.art.pvpBubbleLevelFrame ?? null,
        levelBubbleLevel: Number.isFinite(input.playerLevel) ? Math.max(0, Math.floor(input.playerLevel!)) : 0,
    };
}

/**
 * 站点 → 画法。**状态判定的唯一真源**就在这里，视图只收结果。
 */
export function stationRenderOf(
    site: TerritorySite,
    input: ITerritoryMapRenderInput,
    /** 本轮唯一该挂气泡的宝箱格（`territoryChestHintCell` 的结果；`null` = 一个都不挂）。 */
    chestHintCell: number | null = null,
    /**
     * 同一节点里**不承载 UI** 的格子（`territoryNodeMutedCells` 的结果）。
     *
     * 不传 = 空集合 = 保持现状（每个站点各自画自己的价格/编号），沙箱测试与老调用方零改动。
     */
    mutedCells: ReadonlySet<number> = EMPTY_CELL_SET,
): ITerritoryStationRender {
    const stage = input.stageByCell?.get(site.cellId) ?? null;
    const station = input.stationStates?.get(site.cellId) ?? DEFAULT_STATION_STATE;
    const isOpened = station.opened;
    // 同一节点的「非建筑格」：**任何状态都不画任何 UI**（
    // 「和 boss 关卡是同一个节点的地块都不显示 UI，只有建筑虚影上显示 UI
    // （锁住的 icon 或者是银币 icon + 数字）」）。
    // ⇒ 价格 / 编号气泡 / 建筑 / 锁**全部只落在承载格**上，兄弟格永远是空地。
    // 第四 / 五轮曾两次放宽（「解锁后兄弟格还是要显示银币 icon 和数量」、
    // 「兄弟格跟 30 样式一样」），两条都被本轮覆盖：同一关十几片褐色格各挂一条 35，
    // 读起来就是"这一关要连续买十几次"。状态改由承载格一处表达。
    // `interactive` 保持原样：这些格照样能点、照样扣银币解锁（§3.28「保留可点，照常解锁」），
    // 消耗数字由点击后的确认弹窗承担。
    if (mutedCells.has(site.cellId)) {
        const mutedPending = station.pending;
        return {
            site,
            icon: null,
            caption: '',
            // 地皮色是**地形**不是 UI：未解锁仍是泥土色，解锁后转草地（与承载格同一套 `isOpened` 判定）。
            tint: isOpened ? TERRITORY_COLORS.cleared : TERRITORY_COLORS.locked,
            badge: '',
            isLoading: mutedPending,
            interactive: !mutedPending,
        };
    }
    if (!isOpened) {
        const isOpenable = station.openable;
        const isPending = station.pending;
        // 「预告关卡节点，展示气泡提示（红色未通过的状态）」。
        // 提前披露只改可见性 —— 这一格仍然走「未解锁」的锁 / 价格画法，气泡是**额外叠上去的**，
        // 绝不因此放宽解锁、扣费、开战判据（模型侧 `territoryRevealedCells` 的口径一个字没动）。
        // 四条判据同时成立才挂：
        // ① 在 `previewCells` 里（披露序列 = 本章第 1 关 + 每个首领，见 `model/TerritoryPreview`）；
        // ② 是战斗站点（stage / boss / asyncPvp），资源点与装饰格不挂编号；
        // ③ 配了 `buildingId` 且查得到帧 = **虚影承载格**（`syncGhosts` 也只在这格画虚影）；
        // ④ 能算出气泡文案（asyncPvp 恒 `PVP`，其余要绑到 campaign 行才有 `章节-关卡`）。
        // ⇒ 一关 footprint 有 5~10 格，只有承载格挂一颗，不会满屏 `1-1`（§3.28 同口径）。
        const bubbleText = territoryLevelBubbleText(site, stage);
        const isPreviewBattleSite = Boolean(input.previewCells?.includes(site.cellId))
            && station.battle
            && !!site.buildingId
            && bubbleText !== undefined;
        // 站点自身 `icon` 必须是 null（未解锁不画实心建筑），但气泡要抬到**虚影建筑**顶上：
        // 把虚影那张帧单独交给视图算可见高，别让它按「没有建筑 ⇒ height 0」把气泡压回格心。
        const previewAnchor = isPreviewBattleSite
            ? stationIconOf(site, stage, input.art) : null;
        const previewBubble = isPreviewBattleSite && previewAnchor !== null;
        return {
            site,
            icon: null,
            isCondition: true,
            isLoading: isPending,
            conditionIcon: input.art.randomSilverIcon,
            // 固定宝箱格可激活时在价格行**上方**再加一颗宝箱图标。
            // 只给**普通宝箱**（`fixedResource`）：关卡 / 异步据点 / 随机格的格心只放价格，
            // 别跟着长出一颗箱子；野怪宝箱（`patrolChest`）也不再长（它点开是去打野怪，
            // 不画任何宝箱外观，见下面的宝箱分支）。
            // 前置没满足的宝箱格走的是 `syncStations` 的 `locked` 分支（`isCondition = false`），
            // 到这里的一定是「可激活」⇒ 天然满足「未解锁只显示锁」。
            conditionChestIcon: site.type === TERRITORY_SITE_TYPE.fixedResource
                ? input.art.chestIcon ?? null
                : null,
            conditionTextColor: station.silverRed
                ? TERRITORY_COLORS.randomConditionText : TERRITORY_COLORS.randomAvailableText,
            // 预告关卡的红色编号气泡：文案复用 `model/TerritoryLevelBubble`，底图固定取
            // 「未通关」红 `frame_02`（这一格本来就没通过）；红图缺失照旧回退蓝图，别让编号消失。
            levelBubble: previewBubble ? bubbleText : undefined,
            // 头像气泡的四件（头像 + 黄底框 + 等级角标 + 等级）只在「红底 + 玩家头像都取到」时给，
            // 任一缺失就落回「PVP」文字胶囊 —— 别让预告格的气泡变成空白。
            ...pvpAvatarBubbleOf(
                input,
                previewBubble && site.type === TERRITORY_SITE_TYPE.asyncPvp
                    && !!input.art.levelBubblePendingFrame,
            ),
            levelBubbleFrame: previewBubble
                ? input.art.levelBubblePendingFrame ?? input.art.levelBubbleFrame ?? null
                : undefined,
            previewBubble,
            levelBubbleAnchorFrame: previewAnchor,
            caption: isPending
                ? ''
                : String(site.unlock.silverCost),
            tint: isOpenable ? TERRITORY_COLORS.gold : TERRITORY_COLORS.locked,
            badge: '',
            interactive: !isPending,
        };
    }
    // 宝箱格：普通宝箱（`fixedResource`）与野怪宝箱（`patrolChest`）共用**状态与交互**，
    // 但外观分开 —— 见下面 `isPatrol` 那几处。
    // 野怪宝箱点开是去打巡逻野怪（`battleIds` 那场），不是开箱领奖；
    // 它**只在自己的锚点格**画模型（4 档专用图，见 `patrolChestIconOf`），不挂体力气泡。
    if (isTerritoryChestSite(site)) {
        const claimed = station.owned;
        const pending = station.pending;
        const isPatrol = site.type === TERRITORY_SITE_TYPE.patrolChest;
        // 普通宝箱挂气泡提示（样式同「章节」那颗：同一张 `levelBubbleFrame` 蓝底、
        // 同一套圆角与尾巴），内容是体力 icon + 消耗数；同屏只留一只（由 `chestHintCell` 给出那一格）。
        // 野怪宝箱不挂：它的第二下是开战，格面只靠地块颜色表达状态。
        const showHintBubble = !isPatrol && !claimed && chestHintCell === site.cellId;
        // 普通宝箱领取后清除宝箱图，状态只由地块颜色表达；
        // 野怪宝箱反而**靠这张图**说明「这里是巡逻宝箱」，通过后换开盖版、不摘图。
        return {
            site,
            icon: isPatrol
                ? patrolChestIconOf(site, station, input)
                : claimed ? null : stationIconOf(site, null, input.art),
            // 巡逻宝箱的体量单独压一档（开盖版顶满格子的问题，见 art 侧的常量注释）；
            // 普通宝箱不传 ⇒ 视图按 1 处理，与改动前完全一致。
            iconScale: isPatrol ? input.art.patrolChestIconScale ?? 1 : undefined,
            isLoading: pending,
            caption: '',
            levelBubble: showHintBubble ? String(site.unlock.staminaCost) : undefined,
            // 宝箱气泡用**专属新底图** `frame_04`（77×87 竖向水滴，指定），
            // 不再借用关卡那颗 94×45 的蓝胶囊：形状与内部排版都不同（那张是横向一行，
            // 这张是「icon 在上、数字在下」两行，见 `model/TerritoryChestBubble`）。
            // 别按 `claimed` 去取未通关红 —— 这是**提示**不是「待挑战」，
            // 宝箱本来就还没领，取红会读成"被打败了"。取不到新图才退回蓝胶囊。
            levelBubbleFrame: showHintBubble
                ? input.art.chestBubbleFrame ?? input.art.levelBubbleFrame ?? null
                : undefined,
            levelBubbleIcon: showHintBubble ? input.art.staminaIcon ?? null : undefined,
            // 体力**不够**时这颗数字染红「对应的数字 UI 显示红色」。
            // 只给气泡这一支，且只在气泡真的显示时才算 —— 其余格没有体力数字可染。
            // 不要拿 `claimed` / `isOpenable` 判：这是"付不起"的提示，不是"被打了"的状态色。
            levelBubbleTextColor: showHintBubble
                && station.staminaShort
                ? TERRITORY_COLORS.randomConditionText : undefined,
            // 已领取（已通关）的固定资源点不再显示解锁消耗，用「已通关」绿与「可领取」区分开。
            tint: claimed ? TERRITORY_COLORS.cleared : territoryStationTint(TERRITORY_STATION_STATE.available),
            badge: '',
            interactive: !claimed && !pending,
        };
    }
    // 所有战斗站点（`stage` / `boss` / `asyncPvp`）都在这里：先解锁展示建筑，
    // 已解锁再点击 ⇒ `CmdStartBattleReqMsg` 开战（**不发**通关）。
    // 判定必须与 `TerritoryModel.selectSite` 的关卡分支**同口径**（都是站点类型），
    // 之前两边都写的是「两步式名单 [327,328] 或 isBoss」⇒ 只有关卡 1 会长这样、能点下有反应，
    // 其余关卡外观照旧却已经不可点 ⇒ 「外观说能打、点了没反应」。
    if (station.battle) {
        const isAsyncPvp = site.type === TERRITORY_SITE_TYPE.asyncPvp;
        // 异步据点**不再有「查不到 stage」的特例**（2026-11-23 收口）：
        // 旧特例把 `interactive` 写成 `!isUnlocked && !isOwned` —— 能走到这里的站点
        // 必定 `opened = unlocked || owned`（未解锁已在上面 return），该表达式恒 false，
        // 一旦缺关卡行就**永久点不动**（连解锁都发不出去）；它还漏了区域通关口径与
        // 已通关问号徽标，和下面这条统一分支分成两套表现。缺 stage 时与其它战斗站点
        // 一样：照常可点（解锁 / 打开详情），由 `selectSite` 对 `detailStage = null` 兜底。
        // **区域口径**：327 与 328 同 `configId=10001`、打同一关卡
        // ⇒ 任一格通关，整片都算已通关「327/328 算一起的」。
        // 只查查询态、不动 `owned` 存储 —— 见 `TerritoryProgress.isAreaPassed` 注释。
        const claimed = station.areaPassed;
        const pending = station.pending;
        // 已通关的异步据点 ⇒ 2026-11-23 图1 的「问号徽标」：94×103 蓝底方图 + 74×74 灰盾问号。
        // 两张图都到位才切；缺一张就回退旧「PVP」文字胶囊（不带头像，也不让气泡消失）。
        const pvpClearBadge = isAsyncPvp && claimed
            && !!input.art.pvpClearBubbleFrame && !!input.art.pvpClearBubbleIcon;
        return {
            site,
            icon: stationIconOf(site, stage, input.art),
            // 美术稿是 `1-1`：连字符两侧**不留空格**。间距由 `MAP_MARKER_BADGE_SPACING_X` 控，
            // 字符串里塞空格的话，换字号 / 换字体时那个空格宽度会跟着漂。
            // 文案真源在 `model/TerritoryLevelBubble`（异步据点固定 `PVP`，其余拼编号）——
            // 点击被前置挡住时的提示也调它，两处**必须同源**「名字同气泡文案」。
            // 已通关 PVP 改用问号徽标，不再写 `PVP` 文字。
            levelBubble: pvpClearBadge ? undefined : territoryLevelBubbleText(site, stage),
            ...pvpAvatarBubbleOf(
                input,
                !pvpClearBadge && isAsyncPvp && !claimed && !!input.art.levelBubblePendingFrame,
            ),
            ...(pvpClearBadge
                ? { levelBubblePvpBadge: true, levelBubbleIcon: input.art.pvpClearBubbleIcon ?? null }
                : {}),
            // 气泡底图按「通没通过」二选一：未通关红 `frame_02` / 已通关蓝 `frame_03`。
            // 判据必须用**区域口径** `isAreaPassed`（同 `configId` 的兄弟格共享通关状态）；
            // 红图没加载到时回退蓝图，别让这一格连编号都没有。
            levelBubbleFrame: pvpClearBadge
                ? input.art.pvpClearBubbleFrame ?? null
                : claimed
                    ? input.art.levelBubbleFrame ?? null
                    : input.art.levelBubblePendingFrame ?? input.art.levelBubbleFrame ?? null,
            isLoading: pending,
            caption: '',
            // 已通关不再显示解锁消耗，用「已通关」绿区分开（与 fixedResource 同口径）。
            tint: claimed ? TERRITORY_COLORS.cleared
                : isAsyncPvp && station.unlocked
                    ? territoryBossTint() : territoryStationTint(station.phase),
            badge: '',
            // 「点击已通过的关卡也可以打开【领地关卡信息弹窗】」。
            // 原来这里写的是 `claimed ? isAsyncPvp : true` —— 打完的 `stage`/`boss` 直接不可点，
            // 玩家想回头看一眼通关目标 / 占领奖励 / 敌军一览都点不开。
            // 现在**已通关也可点**：`selectSite` 对已解锁 / 区域已通关的关卡一律只开弹窗
            // （开战请求在 `handleBattleStationStart` 里另有守卫，不会误发）。
            // 唯一不可点的情况是请求在途（`pending`，防连点；loading 遮挡是主防线）。
            interactive: !pending,
        };
    }
    // 走到这里的只剩 `bonus`（奖励据点）：上面 `station.battle` 接走 stage / boss / asyncPvp，
    // 宝箱分支接走 fixedResource / patrolChest；`stageByCell` 也只给这三类战斗站点
    // （以及巡逻宝箱）绑关卡 ⇒ 本格 `stage` 恒为 null。
    // 因此不再保留 `stage?.isBoss` / `phase` 的颜色分支 —— 旧条件在这里永不为真，
    // 留着只会让人误以为「存在没被 station.battle 接管的关卡」。
    return {
        site,
        icon: stationIconOf(site, null, input.art),
        caption: '',
        tint: station.owned ? TERRITORY_COLORS.owned : territoryUnboundTint(site.type),
        badge: '',
        interactive: true,
    };
}

/**
 * 巡逻宝箱**锚点格**的模型图：`territory_monsterBox_L{lv}`，本片通过后换开盖版
 * `territory_monsterBoxOpen_L{lv}`（4 档，212×212，与其它建筑同规格）。
 *
 * 三条口径，改之前先读：
 * ① **只有锚点格画**（带 `patrolId` 的那格）。一片巡逻区 4~8 格，每格都画会长出一排箱子；
 *    「一片区域只在一格长建筑」与关卡 / 异步据点同源（§3.48 / §3.49）。
 * ② 等级取服务端快照 `station.monsterBoxLv`；快照还没到（`0`）按 1 档画 ——
 *    锚点格先空着等数据，玩家会读到「这块地什么都没长」。
 * ③ 通过判据用**片区口径** `patrolPassedCells`（同 `battleId` 任一格占点即整片通过），
 *    不是逐格 `owned` —— 否则只有占点那格换开盖图，同片其余还是闭合。
 *    取不到这份集合（老夹具）才退回 `station.owned`。
 */
function patrolChestIconOf(
    site: TerritorySite,
    station: ITerritoryStationState,
    input: ITerritoryMapRenderInput,
): SpriteFrame | null {
    if (!site.patrolId) return null;
    const passed = input.patrolPassedCells?.has(site.cellId) ?? station.owned;
    const frames = passed ? input.art.patrolChestOpenFrames : input.art.patrolChestFrames;
    if (!frames) return null;
    const lv = station.monsterBoxLv > 0 ? station.monsterBoxLv : 1;
    return frames.get(lv) ?? null;
}

/**
 * 站点转建筑帧。建筑外观以地图配置的 buildingId 为准。
 *
 * stage、boss、asyncPvp 只有配置 buildingId 且查得到帧时才画建筑；
 * fixedResource 与 bonus 仍按类型取图，否则宝箱会集体消失。
 * 是否解锁由 stationRenderOf 处理，本方法只判断该不该有建筑图。
 *
 * `stage` 参数只为调用方共用签名而保留，本函数不再据此选帧：
 * `bindTerritoryBattleStages` 只给 stage / boss / asyncPvp 绑关卡，而这三类在上面
 * 的 `isTerritoryBattleSite` 早退里已经返回 null；fixedResource / bonus 不会绑到
 * 任何关卡（巡逻宝箱的关卡只用于开战，模型图走 `patrolChestIconOf`）。
 * ⇒ 原先 `stage?.isBoss ⇒ art.boss` 的兜底永远到不了，已删除（2026-11-23）。
 */
export function stationIconOf(
    site: TerritorySite,
    _stage: TerritoryCampaignStage | null,
    art: ITerritoryMapArt,
): SpriteFrame | null {
    const buildingId = Number(site.buildingId);
    if (Number.isFinite(buildingId) && site.buildingId) {
        const framed = art.buildFrames?.get(buildingId);
        if (framed) return framed;
    }
    // 关卡 / 首领 / **异步据点**：没配 `buildingId`（或查不到帧）⇒ **返回 null，不画建筑**。
    // 这里**不能**再往下 fallback 到 `TERRITORY_SITE_ART` ——
    // 同一片战斗区域（相同 configId）里多个站点共用一张 type 图，
    // 而 `stage` 的 type 图恰好就是 `69004` 查表得到的同一张
    // ⇒「327 和 328 长得一样」，视觉上仍是「一片区域到处是建筑」。
    // 「**异步战点也要跟 Boss 一样**，通关 / 解锁都是有建筑 id 才显示建筑」
    // ⇒ `asyncPvp` 从「按 type 取图」并入本名单。chapter_01 的 16 个异步据点里只有 4 个配了
    // `buildingId=69002` ⇒ 其余 12 个不再画建筑，只留格面框 + 「异步据点」文案。
    // 连带 `TerritorySiteType` 的 type 回退现在**只服务 `fixedResource` / `bonus`**。
    if (isTerritoryBattleSite(site)) return null;
    return art[TERRITORY_SITE_ART[site.type]] ?? art.stage;
}

/**
 * 建筑体量倍率（表 `build.json` 的 `buildSize`，缺省 1）。
 *
 * 查表键与 `stationIconOf` 同一套口径：地图 JSON 的 `buildingId` 是**字符串**（`"69003"`），
 * 不 `Number(...)` 归一就永远查不到，表现是「配了 buildSize 但外观没变」，零报错。
 * 非法值（NaN / ≤0）一律按 1 —— 倍率 0 会让建筑凭空消失，也不报错。
 */
export function buildScaleOf(site: TerritorySite, art: ITerritoryMapArt): number {
    const buildingId = Number(site.buildingId);
    if (!Number.isFinite(buildingId) || !site.buildingId) return 1;
    const scale = art.buildScales?.get(buildingId);
    return Number.isFinite(scale) && (scale as number) > 0 ? (scale as number) : 1;
}
