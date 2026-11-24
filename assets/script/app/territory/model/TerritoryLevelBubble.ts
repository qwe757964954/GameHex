import type { TerritorySite } from './TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from './TerritoryMapConfig';
import type { TerritoryCampaignStage } from './TerritoryCampaignConfig';

/**
 * 站点气泡文案的唯一来源（纯函数，零 cc）。
 *
 * 气泡与前置提示共用这一处，避免编号在不同层各拼一遍。
 */

/**
 * 异步据点的气泡文案。
 *
 * 异步据点可重复挑战，统一写 PVP 而不是关卡编号；判定必须排在编号之前。
 */
export const TERRITORY_ASYNC_PVP_BUBBLE_TEXT = 'PVP';

/**
 * 未通关 PVP 复用玩家头像与红色九宫格气泡；通关后换成 2026-11-23 图1 的「问号徽标」。
 *
 * 几何（头像框 / 头像 / 等级角标的大小与落点）归 `TerritoryStation.prefab` 的
 * `LevelBubble` 子树；这里只留**随底图变化**的气泡框尺寸与头像边长，供视图刷新
 * `LevelBubble` 根节点和头像节点。
 */
export const TERRITORY_PVP_BUBBLE_PORTRAIT_PATH = 'icons/head/icon_hero_head_40018/spriteFrame';
export const TERRITORY_PVP_BUBBLE_WIDTH = 94;
export const TERRITORY_PVP_BUBBLE_HEIGHT = 103;
export const TERRITORY_PVP_BUBBLE_PORTRAIT_SIZE = 54;

/** 与左上角玩家卡同一张黄底头像框 / 等级角标（领地不另存一份图）。 */
export const TERRITORY_PVP_BUBBLE_AVATAR_FRAME_PATH = 'image/main/hud/hud_avatar_frame/spriteFrame';
export const TERRITORY_PVP_BUBBLE_LEVEL_FRAME_PATH = 'image/main/hud/hud_level_bg/spriteFrame';

/**
 * **已通关 PVP** 的「问号徽标」气泡（2026-11-23 蓝湖`塔防主界面-1` 图1）。
 *
 * 底图是 **94×103 的成品方图**（蓝底 + 底部小尖角，不再拿红 `frame_02` 九宫格拉长），
 * 中心叠一张 **74×74 的灰色盾牌问号**（稿里距顶 10、左右各 10）。整块**没有文字 / 等级角标**，
 * 所以不能用 PVP 头像气泡那套 prefab 几何（头像框 64 / 头像 54 / 角标 19 是给未通关的）。
 *
 * 提示：道具名沿用美术切片 `frame_04` / `tx_01`，但工程里 `frame_04` 已被宝箱水滴占用
 * （`TerritoryChestBubble`）⇒ 入包时改成 `pvp_clear_frame` / `pvp_clear_icon`，别按稿里编号反查。
 */
export const TERRITORY_PVP_CLEAR_BUBBLE_FRAME_PATH = 'image/spawn-region/pvp_clear_frame/spriteFrame';
export const TERRITORY_PVP_CLEAR_BUBBLE_ICON_PATH = 'image/spawn-region/pvp_clear_icon/spriteFrame';
export const TERRITORY_PVP_CLEAR_BUBBLE_WIDTH = 94;
export const TERRITORY_PVP_CLEAR_BUBBLE_HEIGHT = 103;
export const TERRITORY_PVP_CLEAR_BUBBLE_ICON_SIZE = 74;
/** 稿里图标距底图上沿 10 ⇒ 图标中心在气泡根中心上方 `103/2 - 10 - 74/2 = 4.5`。 */
export const TERRITORY_PVP_CLEAR_BUBBLE_ICON_Y =
    TERRITORY_PVP_CLEAR_BUBBLE_HEIGHT / 2 - 10 - TERRITORY_PVP_CLEAR_BUBBLE_ICON_SIZE / 2;

/**
 * 红气泡底图 `frame_02`（94×45，`SLICED` 拉成 94×103）**不是上下对称**的。
 *
 * 逐行量 `alpha > 60`：圆角主体在 raw 行 `0..36`，`37..44` 只剩一条居中的小尖角
 * （行宽从 16px 收到 6px）。九宫格的上下切边按 1:1 渲染 ⇒ 不管中间那一段被拉多长，
 * 「节点顶边 ↔ raw 0」「节点底边 ↔ raw 45」恒成立，主体可见中心恒比**节点中心**高
 * `(45 - 36 - 1) / 2 = 4px`，与气泡高度 / `borderTop` / `borderBottom` 都无关。
 *
 * 这条尾巴就是「头像没在红底里居中」的其中一笔：按节点中心摆必然整体偏下，
 * 表现是「上边一大片红、下边贴着尖角」。换底图时按 PNG 重新量这两组数。
 */
export const TERRITORY_PVP_BUBBLE_FRAME_HEIGHT = 45;
export const TERRITORY_PVP_BUBBLE_BODY_BOTTOM_ROW = 36;
export const TERRITORY_PVP_BUBBLE_TAIL_ROWS =
    TERRITORY_PVP_BUBBLE_FRAME_HEIGHT - TERRITORY_PVP_BUBBLE_BODY_BOTTOM_ROW - 1;
export const TERRITORY_PVP_BUBBLE_BODY_CENTER_LIFT_Y = TERRITORY_PVP_BUBBLE_TAIL_ROWS / 2;

/**
 * 当前头像图 `icon_hero_head_40018.png` 的 meta 真值（无帧时的兜底几何）。
 *
 * `204×204` 原画布被 auto trim 成 `(0,27,200,177)`，于是 `offset = (-2,-13.5)`。
 * `LevelBubbleIcon` 是 `trim = false` + `sizeMode = CUSTOM` ⇒ 节点中心对应**原画布**中心，
 * 可见内容中心比节点中心低 `13.5 × 54 / 204 ≈ 3.57px`（早先写死的 `+3` 只补了这一笔）。
 * 与 `applyIconPlacement` 里用 `frame.offset` 抵消建筑留白是同一套算法。
 */
export const TERRITORY_PVP_BUBBLE_PORTRAIT_CANVAS = 204;
export const TERRITORY_PVP_BUBBLE_PORTRAIT_OFFSET_X = -2;
export const TERRITORY_PVP_BUBBLE_PORTRAIT_OFFSET_Y = -13.5;

/** 只取对齐需要的帧几何，不依赖 `cc`（模型层零引擎依赖）。 */
export interface ITerritoryPortraitFrameGeometry {
    readonly originalSize?: { readonly width: number; readonly height: number } | null;
    readonly offset?: { readonly x: number; readonly y: number } | null;
}

/** 头像节点相对气泡根中心的落点（Y 向上）。 */
export interface ITerritoryPortraitPosition {
    readonly x: number;
    readonly y: number;
}

function portraitPositionOf(
    canvasWidth: number, canvasHeight: number,
    offsetX: number, offsetY: number, size: number,
): ITerritoryPortraitPosition {
    return {
        // `trim = false` ⇒ 可见区中心 = 节点中心 + offset × (size / canvas)，
        // 取负号把可见区中心搬回节点中心；再整体抬到红框主体中心。
        // 写成 `0 - ...` 而不是 `-offsetX * ...`：后者在 offset 为 0 时会产出 `-0`。
        x: 0 - offsetX * size / canvasWidth,
        y: TERRITORY_PVP_BUBBLE_BODY_CENTER_LIFT_Y - offsetY * size / canvasHeight,
    };
}

function fallbackPortraitPosition(size: number): ITerritoryPortraitPosition {
    return portraitPositionOf(
        TERRITORY_PVP_BUBBLE_PORTRAIT_CANVAS, TERRITORY_PVP_BUBBLE_PORTRAIT_CANVAS,
        TERRITORY_PVP_BUBBLE_PORTRAIT_OFFSET_X, TERRITORY_PVP_BUBBLE_PORTRAIT_OFFSET_Y, size);
}

/**
 * 老夹具 / 异步缺帧时的固定落点，与真帧**同一套公式**（`4 + 3.57 ≈ 7.57`）。
 * 视图不再直接读它，留作版面锚点与回归判据。
 */
export const TERRITORY_PVP_BUBBLE_PORTRAIT_Y =
    fallbackPortraitPosition(TERRITORY_PVP_BUBBLE_PORTRAIT_SIZE).y;

/**
 * 头像在红色气泡里的**唯一落点真源**（纯函数，零 `cc`）。
 *
 * 两笔修正缺一不可：① 底图小尖角造成的 `+4px` 抬升；② auto trim 造成的 `+3.57px` 补偿。
 * 只写固定 `3`（旧口径）会把头像摆在节点中心，红框主体却在上面 4px ⇒ 明显不居中；
 * 只写固定 `7` 则换一张头像图 / 改尺寸就会重新偏掉。
 *
 * 帧没到 / 画布尺寸非法时不产出 `NaN`，退回当前美术的实测几何。
 */
export function territoryPvpBubblePortraitPosition(
    frame: ITerritoryPortraitFrameGeometry | null | undefined,
    size = TERRITORY_PVP_BUBBLE_PORTRAIT_SIZE,
): ITerritoryPortraitPosition {
    const canvas = frame?.originalSize;
    const offset = frame?.offset;
    if (!canvas || !(canvas.width > 0) || !(canvas.height > 0) || !(size > 0)) {
        return fallbackPortraitPosition(size > 0 ? size : TERRITORY_PVP_BUBBLE_PORTRAIT_SIZE);
    }
    return portraitPositionOf(canvas.width, canvas.height,
        offset && Number.isFinite(offset.x) ? offset.x : 0,
        offset && Number.isFinite(offset.y) ? offset.y : 0, size);
}

/** 算文案只需要站点类型 / 是否绑了关卡，收窄到这两个字段就不必拖整个站点对象。 */
export type TerritoryBubbleSite = Pick<TerritorySite, 'type'>;

/**
 * 这一格气泡上写什么；`undefined` 表示不显示气泡。
 *
 * `asyncPvp` 写 PVP；绑了关卡写 `章节-关卡`；其余交给各自的提示。
 */
export function territoryLevelBubbleText(
    site: TerritoryBubbleSite | null | undefined,
    stage: TerritoryCampaignStage | null | undefined,
): string | undefined {
    if (site?.type === TERRITORY_SITE_TYPE.asyncPvp) return TERRITORY_ASYNC_PVP_BUBBLE_TEXT;
    if (!stage) return undefined;
    return `${stage.chapterId}-${stage.stage}`;
}
