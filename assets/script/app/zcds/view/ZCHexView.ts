import {
    _decorator,
    Animation,
    Color,
    Component,
    Graphics,
    instantiate,
    Label,
    Node,
    Prefab,
    ProgressBar,
    sp,
    Sprite,
    SpriteFrame,
    UITransform,
    Vec3,
} from 'cc';
import type {
    ZCBuildingCooldownState,
    ZCBuildingType,
    ZCFaction,
    ZCHexActivation,
    ZCHexState,
    ZCOwner,
} from '../model/ZCGameModel';
import { ZC_CLIENT_COLORS, zcDeepFactionColor, zcFactionColor, zcTowardWhite } from './ZCTheme';
// 提示描边与领地轮廓共用同一份顶面顶点口径与内缩比例：这条线也要"贴着台面边缘"，
// 自己抄一份顶点迟早会和轮廓错开半个像素。
import { OWNED_OUTLINE_INSET_SCALE, ZC_OUTLINE_HEX_POINTS } from './ZCOutlineLayer';
import { ZCPvpTileType } from '../model/ZCPvpTileRules';
import {
    ZC_CARD_FADE_START_PROGRESS,
    ZC_CARD_REVEAL_SECONDS,
    ZC_CARD_START_SECONDS,
    ZC_HEX_ACTIVATION_SECONDS,
    ZC_HEX_BUILDING_SECONDS,
    ZC_HEX_NEIGHBOR_HOLD_SECONDS,
    ZC_HEX_SHRINK_SECONDS,
} from '../model/ZCBattlePresentationQueue';
import {
    clamp01,
    HEX_FLIP_GLOW_MASK_OFFSET_Y,
    HEX_FLIP_GROUND_GLOW_ALPHA,
    HEX_FLIP_IDLE_FX,
    HEX_FLIP_PIVOT_LIFT,
    HEX_PULSE_FRAME_COUNT,
    HEX_PULSE_FRAME_HIDDEN,
    HEX_PULSE_FRAME_SECONDS,
    hexCollapseProgress,
    hexFlipFoldProgress,
    hexFlipGroundGlowStrength,
    hexPulseFx,
    hexShrinkFx,
} from '../../../core/hex/HexFlipPresentation';
import type { IZCHexFlipFx } from '../../../core/hex/HexFlipPresentation';
import { HEX_GRID_FACE_HEIGHT, HEX_GRID_FACE_WIDTH } from '../../../core/hex/HexGridLayout';
import {
    BUILDING_POP_FROM_SCALE,
    BUILDING_SHAKE_STRETCH,
    elasticPopScale,
    isHealthBarVisible,
    pickHealthBarFill,
    SPAWN_SHAKE_TOTAL_SECONDS,
    spawnShakeScaleX,
    spawnShakeScaleY,
    territoryTintOwner,
    updateHealthBar,
    ZC_LAND_TOP_CENTER_LIFT,
} from './ZCGameViewUtil';

const { ccclass, property } = _decorator;
const BUILDING_SYMBOLS: Readonly<Record<ZCBuildingType, string>> = {
    none: '', hq: '城', mine: '金', barracks: '兵', tower: '塔',
};
/**
 * 中立资源点 → 文字兜底。有 `resourceFrame` 的走图标（见 `frameForResource`），
 * 只有还没出美术图的这两类（`unit_cap` / `artifact_charge`）才落到这里。
 */
const NEUTRAL_RESOURCE_LABELS: Readonly<Record<string, string>> = {
    chest: '宝箱', gold: '金币', mine: '金矿', unit_cap: '兵力', artifact_charge: '神器',
};
// 三个「格内图标落点」下面的 y 都是 **BuildingLayer 内的局部坐标**。
// 详见 docs/ZCHexView设计决策.md §1。

/**
 * 资源图标的目标边长（对齐格子的 128×128）。
 * 节点尺寸会被 `SpriteFrame.rect` 覆写，神器图是 230×230 会溢出格子，必须按最大边等比缩到本格。
 */
const RESOURCE_ICON_TARGET_SIZE = 128;

/**
 * 已建建筑外观图（`buildingSprite`）的基准缩放。
 * 必须落在代码而非 prefab：`applyActivationFx` 会覆写激活格的 scale，只改 prefab
 * 会出现「激活过的格子 1.0、没激活的 0.72」的静默偏差。`applyBuildingScale` 是唯一写入口。
 */
const BUILDING_ICON_SCALE = 0.72;

/**
 * 地块类型图标（`icon_wh` / `icon_jk` / `icon_by` / `icon_em`，都挂在 `iconSprite` 上）的基准缩放。
 *
 * 必须落在代码而非只改 prefab：`iconSprite` 与**资源点图标共用同一个节点**，
 * `renderContent` 是它 scale 的唯一写入口 —— 走资源点图标时按 `resourceIconScale` 缩到格子边长，
 * 其余情况写回本值。只改 prefab 会被这一句静默覆盖成 1：编辑器里怎么调都没反应，
 * 表现为「地块图标比设计稿大一号」。口径与 `BUILDING_ICON_SCALE` 一致。
 */
const TILE_ICON_SCALE = 0.8;

/**
 * 激活表现的时间分段（`progress` 是**激活轴**占比，总长 = `ZC_HEX_ACTIVATION_SECONDS` = **1.856s**
 * = `ZC_CARD_START_SECONDS`（点击动画 0.7）+ `ZC_CARD_REVEAL_SECONDS`（卡牌 1.156））：
 * 🔴 缩没段曾因 SVN 冲突整个丢失 —— 别删；`tileLift` 别填非零（要求原地缩小、中心点不动）。
 * 详见 docs/ZCHexView设计决策.md §2。
 */
/** 卡牌独占视线：整格不渲染（卡牌是独立节点，不受影响）。只读复用，别改字段。 */
const HEX_ACT_HIDDEN: Readonly<IZCHexFlipFx> = {
    hidden: true, tileLift: 0, tileFlip: 1, tileScale: 1, buildingPopScale: 0, glowRadius: 0, glowAlpha: 0,
};
/**
 * 分段边界比较的容差（秒）。
 *
 * 🔴 「建筑长完」的比较里，`progress × 总长 − 收场段 − 淡出起点` 在 IEEE754 下会差 ~1e-16：
 * 激活走到最后一帧时算出来可能比 `ZC_HEX_BUILDING_SECONDS` 少 1 ULP，
 * 裸 `>=` 会**少收口一次** ⇒ 末帧停在「光圈半径 56、透明度 0」上。
 * 画面上看不出来（alpha 0 不画），但 `active` 判据会一直认为在激活中。
 * 所以「段末」比较都留一点容差，别用裸 `>=`。
 */
const HEX_ACT_SECONDS_EPSILON = 1e-9;
/** 光圈光效的内/外半径（格心局部坐标；格子 128×128，外圈刚好压在邻格边缘内）。 */
const HEX_ACT_GLOW_RADIUS_MIN = 20;
const HEX_ACT_GLOW_RADIUS_MAX = 56;

/**
 * 脉冲序列帧的**按卡牌品阶染色**（用户 2026-10-19 口径）。
 *
 * 「脉冲效果图片的整体颜色根据对应获得的卡牌品阶，1 绿 / 2 蓝 / 3 紫 / 4 金，
 *  **没有获得卡牌 → 绿**」⇒ 索引就是品阶，下标 0 与下标 1 同色。
 *
 * 🔴 与旧口径的差别：2026-10-15 那版按**格子类型**上色（兵营蓝紫 / 金矿绿），
 * 现在颜色只表达「你抽到了什么品阶」—— 点下去的那一刻就能从波的颜色读出结果。
 * 详见 docs/ZCHexView设计决策.md §3。
 */
/** 1 档（绿）。0 档与它**共用同一个实例** —— 用户口径就是「没获得卡牌 = 绿色」，不是另给一档。 */
const PULSE_TINT_GREEN = new Color(90, 226, 138, 255);   // #5AE28A
const PULSE_TINT_BY_RARITY: readonly Color[] = [
    PULSE_TINT_GREEN,                // 0 = 没抽到卡 ⇒ 绿（与 1 同色同实例）
    PULSE_TINT_GREEN,                // 1 绿
    new Color(72, 148, 255, 255),    // 2 蓝 #4894FF
    new Color(178, 108, 255, 255),   // 3 紫 #B26CFF
    new Color(255, 196, 60, 255),    // 4 金 #FFC43C
];
/** 缺省染色（没抽到卡 / 品阶越界）—— 绿。 */
const PULSE_TINT_DEFAULT = PULSE_TINT_GREEN;

/**
 * 脉冲序列帧（`effects/hex_pulse_seq`，320×320 画布）里**本体六边形**的像素尺寸。
 *
 * 美术口径（需求文档 §三）：平顶六边形，本体基准 **164 × 142**，波最大时约 292 × 253，
 * 5 帧中心逐像素对齐在画布正中。视图拿这组数把「图上 1.0 倍的本体」对齐到格面
 * （`HEX_GRID_FACE_WIDTH/HEIGHT` = 123×90）—— 一次算好写成常量，别每帧再除。
 */
const HEX_PULSE_ART_BODY_WIDTH = 164;
const HEX_PULSE_ART_BODY_HEIGHT = 142;
/**
 * 脉冲波节点相对 320 画布的**静态缩放**（x / y 分开：本项目格面 123:90 = 1.367，
 * 比正六边形 1.155 更扁，等比缩放会让波和格子对不上边）。
 *
 * ⚠️ 这是「把美术图摊到格子上」的**一次性**换算，不是动画 —— 波自己的放大已经烘焙在图里，
 * 5 帧共用这一个缩放（需求 §七.7：节点上不许再叠 scale 动画）。
 */
const HEX_PULSE_SCALE_X = HEX_GRID_FACE_WIDTH / HEX_PULSE_ART_BODY_WIDTH;
const HEX_PULSE_SCALE_Y = HEX_GRID_FACE_HEIGHT / HEX_PULSE_ART_BODY_HEIGHT;
/**
 * 脉冲序列帧的**画布边长**（320×320，5 帧同尺寸）。
 *
 * 节点 contentSize 必须按这张整画布给，而不是按格面 —— 波最后会扩到约 292×253，
 * 只给 123×90 的话 Sprite 会把整张图压进格子、波形被挤扁（`_sizeMode` 是 `CUSTOM`，
 * 引擎不会替你改尺寸）。换美术图要同步改这里。
 */
const HEX_PULSE_CANVAS_SIZE = 320;

/**
 * 卡牌品阶 → 脉冲染色（纯函数，便于单测）。
 *
 * @param rarity 1 绿 / 2 蓝 / 3 紫 / 4 金；`0` / 越界 / 非数字 = 没抽到卡 ⇒ 绿。
 * @returns 共享的只读色；调用方只许读、`set` 到自己的实例里，别改它的分量。
 */
export function pulseTintForRarity(rarity: number): Color {
    if (!Number.isFinite(rarity)) return PULSE_TINT_DEFAULT;
    const index = Math.round(rarity);
    if (index <= 0 || index >= PULSE_TINT_BY_RARITY.length) return PULSE_TINT_DEFAULT;
    return PULSE_TINT_BY_RARITY[index];
}


/**
 * 激活进度 → 表现参数（纯函数，便于单测）。
 * 详见 docs/ZCHexView设计决策.md §4。
 */
/**
 * 阶段 2（缩没）的起点：**脉冲播到中间帧那一刻**（用户 2026-10-19 口径）。
 *
 * 5 帧索引 `0..4`，「中间帧」= 帧 `2`，它从 `0.2s` 开始 ⇒ 阶段 1 只有 `0..0.2s`
 * （脉冲前两帧 + 格子带 UI 原样不动），阶段 2 从 `0.2s` 起把格子缩掉、0.7s 收干净。
 *
 * ⚠️ 别把它写成 `HEX_PULSE_WAVE_SECONDS / 2`（0.25s）：那是「波走到一半的时间」，
 * 而用户说的是「播放**到**中间帧」，两件事差半帧（0.05s）。
 */
const HEX_PULSE_SHRINK_START_SECONDS = HEX_PULSE_FRAME_SECONDS * Math.floor(HEX_PULSE_FRAME_COUNT / 2);

/**
 * **点击动画段 = 阶段 1 脉冲 + 阶段 2 缩没**（纯函数）。详见 docs/ZCHexView设计决策.md §5。
 *
 * 🔴 两段是**先后**关系，不再并发（2026-10-19 用户口径）：
 *   ① `[0, 0.2s)` 只有脉冲 —— 格子（含图标 + 价格数字）**原样不动**，`tileScale` 恒 1；
 *   ② `[0.2s, 0.7s]` 脉冲继续播（0.5s 处自然退场），格子同时原地缩到 `HEX_SHRINK_MIN_SCALE`。
 *
 * 缩没的**跨度跟着变短**（0.5s 而不是 0.7s），但**总段长不变**（仍是 `ZC_HEX_SHRINK_SECONDS` = 0.7s）——
 * 卡牌弹出时刻 / 首批兵 / 邻格按住窗都锚在这个段长上，不能因为改节奏就整体后移。
 * 曲线还是 `hexShrinkFx` 的 easeInCubic（前半几乎不动、末段迅速收），现在起点往后挪、末段更利落。
 */
function hexPulseShrinkFx(seconds: number): IZCHexFlipFx {
    const pulse = hexPulseFx(seconds);
    const elapsed = seconds - HEX_PULSE_SHRINK_START_SECONDS;
    // 阶段 1：格子与 UI 全都不动，只有波在长。
    if (elapsed <= 0) return { ...pulse, tileScale: 1 };
    const span = ZC_HEX_SHRINK_SECONDS - HEX_PULSE_SHRINK_START_SECONDS;
    const shrink = hexShrinkFx(span > 0 ? clamp01(elapsed / span) : 1);
    return { ...pulse, tileScale: shrink.tileScale };
}

export function hexActivationFx(progress: number, hasCardReveal = true): IZCHexFlipFx {
    // 无激活事件（progress < 0，= 未开始 / 已过期）→ 常规定格：建筑可见。
    // 不能交给下面的 `clamp01` 折成 0（那会得到「脉冲起点、建筑还没长出来」的 buildingPopScale 0，
    // `applyActivationFx` 会误判成激活中，把正常渲染里的建筑藏起来）。
    if (progress < 0) return { ...HEX_FLIP_IDLE_FX };
    // 按**秒**分段：见上面时间分段的说明，别退回「占比相乘」。
    const seconds = clamp01(progress) * ZC_HEX_ACTIVATION_SECONDS;
    // ①② 点击动画：脉冲与缩没**并发**（同起同收，宽 `ZC_CARD_START_SECONDS`）。
    //    `buildingPopScale = 0` ⇒ 建筑还没长出来，格子按开发前外观渲染（图标+价格数字一起缩）。
    //    🔴 缩没这一段 2026-10-15 曾因 SVN 冲突整个丢失（用户报「点击地块收缩替换的动画丢失」），别删。
    if (seconds < ZC_CARD_START_SECONDS) return hexPulseShrinkFx(seconds);
    if (!hasCardReveal) {
        // 没有卡牌 ⇒ 点击动画播完直接回常规定格（没有卡牌段可等）。
        // 🔴 绝不能在这里进隐藏段：那 1 秒多的空窗里格子里什么都没有、直接露出棋盘底色。
        return { ...HEX_FLIP_IDLE_FX };
    }
    // ③ 卡牌段：整段 `ZC_CARD_REVEAL_SECONDS`（1.156s），从点击动画结束那一刻起算
    //    （`pushCardReveal` 把 startedAt 推到 `ZC_CARD_START_SECONDS`）。
    //    卡牌进度 [0, 0.62) 整格隐藏（卡牌独占视线）。
    const afterClick = seconds - ZC_CARD_START_SECONDS;
    const fadeStart = ZC_CARD_REVEAL_SECONDS * ZC_CARD_FADE_START_PROGRESS;
    if (afterClick < fadeStart) return HEX_ACT_HIDDEN;
    //    卡牌进度 [0.62, 1) 卡牌淡出：地块回场 + 建筑从 0.15 由小变大（与淡出同拍重叠）。
    //    建筑生长时长 `ZC_HEX_BUILDING_SECONDS` 落在淡出窗内（0.36 < 1.156 × 0.38 = 0.43928），
    //    卡牌淡完时已长齐 —— 这是总长从 2.24 缩到 1.856 后仍必须成立的约束
    //    （卡牌段没变，所以这层关系跟总长无关，改动点击动画不会碰它）。
    const buildSeconds = afterClick - fadeStart;
    // 建筑长完 ⇒ 常规定格：光圈半径在段内长到最大、透明度同时归零，这里收口成 idle，
    // 免得「半径 56 + alpha 0」被 `active` 判据一直当成激活中。
    if (buildSeconds >= ZC_HEX_BUILDING_SECONDS - HEX_ACT_SECONDS_EPSILON) {
        return { ...HEX_FLIP_IDLE_FX };
    }
    const build = clamp01(buildSeconds / ZC_HEX_BUILDING_SECONDS);
    return {
        hidden: false,
        tileLift: 0,
        tileFlip: 1,
        tileScale: 1,
        buildingPopScale: elasticPopScale(build, BUILDING_POP_FROM_SCALE),
        glowRadius: HEX_ACT_GLOW_RADIUS_MIN + (HEX_ACT_GLOW_RADIUS_MAX - HEX_ACT_GLOW_RADIUS_MIN) * build,
        glowAlpha: Math.round(255 * (1 - build)),
    };
}

/**
 * 资源图标的等比缩放系数：`min(1, 目标边长 / 帧最大边)`。
 *
 * 纯函数（便于单测），**只缩不放**：小于格子的图保持原尺寸 —— 美术若哪天出了张小图，
 * 不该被我们放大成糊的。三边同值 ⇒ 保持等比、不变形。
 */
export function resourceIconScale(frame: SpriteFrame | null | undefined): number {
    const size = frame?.originalSize;
    if (!size) return 1;
    const longest = Math.max(size.width, size.height);
    // 帧尺寸缺失/为 0 时不缩放：宁可大一点也不要产出 NaN 缩放把图标缩没。
    if (!Number.isFinite(longest) || longest <= 0) return 1;
    return Math.min(1, RESOURCE_ICON_TARGET_SIZE / longest);
}

/** 建筑外观帧解析器：按卡牌 id / 建筑类型取专属外观图，取不到返回 null（回退 prefab 绑的类型通用图）。 */
type IZCBuildingFrameResolver = (
    cardId: string | null,
    building: ZCBuildingType,
    owner: ZCHexState['owner'],
) => SpriteFrame | null;

interface IZCHexPresentation {
    state: Readonly<ZCHexState>;
    canDevelop: boolean;
    /** 我方当前金币，用于把买不起的开发价格标红。 */
    playerGold: number;
    cooldown: Readonly<ZCBuildingCooldownState> | null;
    /** 表现时间（秒），用于判断血条是否还在「被攻击后 3 秒」的显示窗口内。 */
    now: number;
    /** 自选主城地图不在地块上叠加资源名称文字，避免遮挡选点后的地图视觉。 */
    hideNeutralResourceLabel?: boolean;
    /** bit 0..5 对应六条边；占领地只画外轮廓，中立共享边只画一次。 */
    boundaryMask?: number;
    /** 开发成功后的「地块激活表现」事件；无则按普通渲染。 */
    activation?: Readonly<ZCHexActivation> | null;
}

interface IZCSpawnHexPresentation {
    sectionOwner: ZCFaction;
    selectedBy: ZCOwner | null;
    confirmed: boolean;
    blocked: boolean;
    resourcePoint: boolean;
    /** 资源点的具体资源 id（选点阶段用资源图标，不再显示「资源/可解锁」文字）。 */
    resourceId?: string | null;
    unlocksResource: boolean;
    regionText?: string;
    boundaryMask?: number;
    /**
     * 本格是否紧邻**我方基地**（选点阶段基地周围那 6 格）。
     *
     * 是 ⇒ 填充换成深蓝 `#1D24C8` 高亮，压过半区色与受阻色（需求 1：「高亮显示基地相邻的
     * 6 个六边形格子，高亮填充色为深蓝色 #1D24C8」）。已确认 / 阶段结束后渲染层不再给这一位。
     */
    homeHighlight?: boolean;
}

/** 地块渲染行为（节点布局由 `ZCGameHex.prefab` 管理）。 */
@ccclass('ZCHexView')
export class ZCHexView extends Component {
    /**
     * 地块填充 / 染色 / 图标位置的专属常量与辅助函数：按 §6.2 第 12 条
     * 从模块级内聚为私有静态 —— 只服务于本类渲染，外部类不可引用。
     */
    /**
     * 格子填充 = **半透明（约 60%）**。
     * 🔴 填充若 100% 不透明，同色外轮廓会被完全吃掉 —— 必须留半透明（约 60%）。
     * 详见 docs/ZCHexView设计决策.md §6。
     */
    private static readonly TERRITORY_FILL_ALPHA = 150;
    /**
     * 选点阶段「基地相邻 6 格」的高亮填充：需求指定的深蓝 `#1D24C8`。
     * 详见 docs/ZCHexView设计决策.md §7。
     */
    private static readonly SPAWN_BASE_NEIGHBOR_FILL = new Color(0x1D, 0x24, 0xC8, 170);
    /**
     * 开局「点击金矿」提示描边的线宽与颜色（需求 2026-10-15 row10）。
     *
     * 比领地轮廓的 6px 再粗一点：这条线要**压得住**金矿图标和地块底图、在一整盘六边形里被第一眼看到。
     * 颜色取主题里的金币金 `#ffc62d`——提示的对象就是金矿，用金色比用阵营色更贴题，
     * 也不会被误读成「这一格归属了谁」。
     */
    private static readonly HINT_OUTLINE_LINE_WIDTH = 7;
    private static readonly HINT_OUTLINE_COLOR = ZC_CLIENT_COLORS.gold;
    /**
     * 中立格填充 alpha：**`0` = 这一格不做任何显示**（2026-10-16 口径「局内地图中立没有任何显示」）。
     *
     * `setSprite` 见 0 就停用那张 Sprite ⇒ 棋盘底图直接透出来，格子感交给
     * `OutlineLayer` 的矢量格线（内网格线不受影响）。
     * 🔴 别再把它调回可见值：那不是"更淡"，而是把底图重新盖住。
     */
    private static readonly NEUTRAL_FILL_ALPHA = 0;
    /** 中立填充的色相：只在"以中立为一端"的过渡色里参与混色（扩散波），常规渲染拿到的 alpha 恒为 0。 */
    private static readonly NEUTRAL_FILL_RGB = { r: 236, g: 232, b: 224 } as const;
    /** 金币不足时的价格/提示色。 */
    private static readonly INSUFFICIENT_GOLD_COLOR = new Color(255, 91, 91, 255);
    /** 敌方建筑名的淡红提示色。 */
    private static readonly ENEMY_BUILDING_COLOR = new Color(255, 175, 175, 255);
    /** 中立资源点已解锁（`developmentResolved`）时的提示色。 */
    private static readonly RESOURCE_RESOLVED_COLOR = new Color(87, 220, 132, 255);
    /** 选点阶段「该格被占住了」的填充色（阵营色之上的红调）。 */
    private static readonly BLOCKED_FILL_COLOR =
        new Color(255, 148, 148, ZCHexView.TERRITORY_FILL_ALPHA);
    /** 自选主城未确认时的半透明主城图；确认后转纯白。 */
    private static readonly UNCONFIRMED_HQ_COLOR = new Color(255, 255, 255, 205);

    // 敌方可开发图标居中到六边形中心（BuildingLayer 局部 y，见文件头那段换算说明）。
    private static readonly ENEMY_DEVELOP_ICON_POS = { x: 0, y: -2.342, z: 0 } as const;
    /**
     * 地块类型图标（`icon_jk` / `icon_by` / `icon_wh`）的落点：压在底部价格行正上方，两者读成一组。
     * 详见 docs/ZCHexView设计决策.md §8。
     */
    private static readonly DEFAULT_TILE_ICON_POS = { x: -4.801, y: 4, z: 0 } as const;
    /**
     * 中立资源点图标（金币 / 金矿 / 宝箱 / 神器）的落点：对齐顶面中心（换算见文件头）。
     *
     * ⚠️ 它比顶面**高 19px、也低 19px**（节点 128×128、顶面 123×90）：左右邻格的整图会盖住
     * 溢出到它们那一侧的部分 ⇒ 必须抬到棋盘级资源层再画，见 `setResourceIconRaised`。
     */
    private static readonly RESOURCE_ICON_POS = { x: 0, y: -2.342, z: 0 } as const;

    /**
     * 格内兵力资源点（`unit_cap`）骨骼的目标可见高度（格子高 128 的 38%）。
     * ⚠️ 与 `ZCUnitView` 战场口径（活体单位 69.4）不同，这里要塞进 N 个并排预览。
     */
    private static readonly RESOURCE_UNIT_TARGET_HEIGHT = 48.6;
    /** 多个并排时的横向间距。 */
    private static readonly RESOURCE_UNIT_SPACING = 16;
    /**
     * 骨骼脚底落点：格心偏下一点。
     *
     * 🔴 2026-10-15 需求（`demo体验反馈` row7）：「格内兵团上移 30px」⇒ 由 `-18` 抬到 `12`
     * （`-18 + 30 = 12`）。脚底对齐的兵站上来时不会被格子下沿的侧壁压住。
     */
    private static readonly RESOURCE_UNIT_POS_Y = 12;

    /**
     * 骨架 canvas 高度（设计单位），用来算缩放。
     * ⚠️ 必须走 `getRuntimeData()`，不能读 prefab 的 `UITransform` ——
     * 豌豆射手 prefab 根节点 UITransform 是复制坚果留下的，与骨架不符。
     * 与 `ZCUnitView` 同源同口径。
     */
    private static spineResourceCanvasHeight(skeleton: sp.Skeleton): number {
        const runtime = skeleton.skeletonData?.getRuntimeData(true);
        return runtime?.height ?? 0;
    }

    @property({ type: Sprite, group: '节点引用' })
    tileSprite: Sprite = null!;

    /** 三个投影侧面与原位柔光共用的 Sprite；图片仅提供柔光纹理。 */
    @property({ type: Sprite, group: '节点引用', tooltip: 'GroundGlow：三个阵营色投影侧面；图片仅供原位柔光取样' })
    groundGlow: Sprite = null!;

    @property({ type: SpriteFrame, group: '地块底图', tooltip: '统一六边格蒙版：hex_flat（130×119 画布 / 面 123×90，扁平纯白）' })
    tileFrame: SpriteFrame | null = null;

    /**
     * `TerritoryOutline` 的 `cc.Graphics` —— **领地轮廓不再用它**：轮廓由 `ZCOutlineLayer`
     * 整盘一个 Graphics 画。字段保留（删了 prefab 已序列化引用会悬空），`initialize` 里
     * `enabled = false`，防止漏网调用路径画出与共享层重叠的第二份线。
     *
     * 2026-10-15 row10 起**只由开局「点击金矿」提示复用**（`renderHintOutline`）：那条提示是
     * 单格、每帧都要重绘的闪烁，走共享层会连带整盘轮廓每帧重建（探针里只有它是脏的），
     * 而这份 per-cell 的画布刚好"一格一画布"、代价只有 6 条边 —— 复活它比加节点更划算。
     */
    @property({ type: Graphics, group: '节点引用', tooltip: 'TerritoryOutline：领地轮廓已停用（走 OutlineLayer 共享绘制）；仅开局金矿提示闪烁复用' })
    outlineGraphics: Graphics = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'BuildingLayer：开发图标和价格' })
    buildingLayer: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: '根节点下的 BuildingIcon：已建建筑' })
    buildingSprite: Sprite = null!;

    @property({ type: Sprite, group: '节点引用' })
    iconSprite: Sprite = null!;

    @property({ type: Sprite, group: '节点引用' })
    priceIcon: Sprite = null!;

    @property({ type: SpriteFrame, group: '开发图标', tooltip: '金矿开发图标：icon_jk' })
    mineIconFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '开发图标', tooltip: '兵营开发图标：icon_by' })
    barracksIconFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '建筑图片', tooltip: '已建金矿' })
    mineFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '建筑图片', tooltip: '废墟：fx' })
    ruinsFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '开发图标', tooltip: '全随机地块图标：icon_wh' })
    mysteryFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '开发图标', tooltip: '敌方可建造地块：icon_em' })
    enemyDevelopFrame: SpriteFrame | null = null;

    /**
     * 中立资源点图标（`neutralResourceId` → 图），复用 `iconSprite` 节点，位置居中。
     * 三张图统一在 `assets/resources/image/map-resource/`（同一套 212×212 画布，别换别处的同名图）；
     * `artifact_charge` 不在这里绑（玩家携带、随配置变），由 `ZCGameLoader` 预加载后经 `setArtifactChargeFrame` 注入；
     * `unit_cap` 暂无美术图，走 `NEUTRAL_RESOURCE_LABELS` 文字兜底。
     */
    @property({ type: SpriteFrame, group: '资源点图标', tooltip: '中立资源点·金币：map-resource/gold' })
    goldResourceFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '资源点图标', tooltip: '中立资源点·金矿：map-resource/mine' })
    mineResourceFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '资源点图标', tooltip: '中立资源点·宝箱：map-resource/chest' })
    chestResourceFrame: SpriteFrame | null = null;

    @property({ type: Label, group: '节点引用' })
    iconLabel: Label = null!;

    @property({ type: ProgressBar, group: '状态条', tooltip: 'HealthBar：建筑生命值' })
    healthBar: ProgressBar = null!;

    // 血条填充图：按阵营各一张，与 ZCGameUnit 同一套（我方蓝 / 敌红 / 敌2 黄 / 敌3 紫）。
    // 第 4 家的紫图取自项目里已有但一直没人用的 `buildings/jindutiao_p.png`，见 pickHealthBarFill。
    @property({ type: SpriteFrame, group: '状态条', tooltip: '血条填充：我方（蓝）' })
    barFillPlayer: SpriteFrame = null!;

    @property({ type: SpriteFrame, group: '状态条', tooltip: '血条填充：敌方（红）' })
    barFillEnemy: SpriteFrame = null!;

    @property({ type: SpriteFrame, group: '状态条', tooltip: '血条填充：敌方 2（黄）' })
    barFillEnemy2: SpriteFrame = null!;

    @property({ type: SpriteFrame, group: '状态条', tooltip: '血条填充：敌方 3（紫）' })
    barFillEnemy3: SpriteFrame = null!;

    @property({ type: ProgressBar, group: '状态条', tooltip: 'Cooldown：内置建筑建造/工作周期圆环' })
    cooldownBar: ProgressBar = null!;

    private clickHandler: (() => void) | null = null;
    /** 由 ZCGameRenderWorld 注入；见 IZCBuildingFrameResolver。 */
    private buildingFrameResolver: IZCBuildingFrameResolver | null = null;
    /**
     * 本局携带神器的图标（中立资源点「神器充能」格用）。
     *
     *  与上面三个「prefab 硬绑」的帧不同：神器是**玩家带的**，会随配置变，
     * 所以不能烘进 prefab，由 `ZCGameLoader` 预加载后经渲染层注入。
     *  `null` = 没加载到 ⇒ 那一格退回文字兜底（`NEUTRAL_RESOURCE_LABELS`）。
     */
    private artifactChargeFrame: SpriteFrame | null = null;
    /**
     * 兵力资源点表里配的**卡 id**（`rewardCardId`，如 `'68001'`）与**要站几个**
     * （`rewardUnitCount`），都由渲染层注入 —— 视图不读表，与 `setBuildingFrameResolver` 同款口径。
     */
    private resourceUnitKey = '';
    private resourceUnitCount = 0;
    /** 当前注入的骨骼 prefab；`null` = 没注入（退回中文「兵力」文字兜底）。 */
    private resourceUnitPrefab: Prefab | null = null;
    /**
     * prefab 名，作「换兵种了」的缓存键。
     *
     * ⚠️ 不能比prefab 引用 —— `instantiate` 出来的实例每次都是新对象，比引用会永远判成「变了」
     * ⇒ 每帧重建节点（规则 176 的静默失效族：性能塌但不报错）。
     */
    private resourceUnitPrefabName = '';
    /** 本格当前挂着的骨骼节点（池化复用：格子 view 生命周期内只增不减，count 变小时多出来的隐藏）。 */
    private readonly resourceUnitNodes: Node[] = [];
    /** 骨骼节点的缓存键：`unitId@数量` —— 变了才重建。 */
    private resourceUnitCache = '';
    private contentKey = '';
    /** 上一次 render 到的建筑血量 / 城墙耐久；null = 这一格还没看过（第一次只记基线）。 */
    private observedHp: number | null = null;
    private observedWallHp: number | null = null;
    /** 最后一次实际扣血的表现时间（建筑或城墙任一被打都算）；null = 还没挨过打。 */
    private lastDamagedAt: number | null = null;
    /**
     * 结算扫场的阵营覆盖：非 null 把这一格整个画成该阵营，压过 `state.owner`。
     * 只写表现层、绝不回写模型；扫场结束或重开一局必须置回 null，否则下一局带上一局的颜色出场。
     */
    private sweepOwner: ZCOwner | null = null;
    /**
     * 扫场覆盖的**深色回正比例**（`0` = 深饱和色，`1` = 该阵营当前色），见 `sweepFill`。
     * 与 `sweepOwner` 一起决定覆盖色，两者都并进 `contentKey`。
     */
    private sweepMix = 0;
    /**
     * 铺场闪烁量（`0` = 纯深色、越大越往白里偏），见 `sweepFill` 与
     * `ZCGameViewUtil.victorySweepShimmer`（需求 2026-10-16）。
     *
     * 只作用在**深色那一端**：它和白的关系是「深色往白里偏」，所以回正越接近 1
     * 深色的权重越低，闪烁**自动**淡出，不需要第二套「什么时候停闪」的规则。
     */
    private sweepShimmer = 0;
    /**
     * 扫场覆盖的指纹片段（`''` = 无覆盖）。回正段**每帧都在变**，所以这里按 32 档量化 ——
     * 足够密（视觉上是连续过渡），又不会让每帧的指纹都不同而白重绘 spriteFrame。
     *
     * 闪烁（`sweepShimmer`）同理按 16 档量化；⚠️ 只在**还没回正完**（`mix < 1`）时才并进去 ——
     * 回正到 1 的格子上闪烁已经完全不参与配色（`sweepFill` 直接返回当前色），
     * 再把它算进指纹就等于每帧无故重绘一片不会再变的格子。
     */
    private sweepKey = '';
    /**
     * 开局「归属扩散」的临时覆盖：这一格正从**选点阶段的半区色**过渡到**战斗底色**。
     * 详见 docs/ZCHexView设计决策.md §9。
     */
    private claimWave: { from: ZCFaction; to: ZCFaction; progress: number } | null = null;
    /**
     * 脉冲段「脉冲波」的序列帧（渲染层注入，来自 `image/effects/hex_pulse_seq`，**5 帧**）。
     *
     * 2026-10-19 换美术：放大与不透明度**全部烘焙在图上**，视图只按 `pulseFrame` 换
     * `spriteFrame`，绝不往节点上再叠 scale / opacity 动画（叠了就是二次放大、二次虚化）。
     * 空数组 / 注入失败 ⇒ 波不显示，格子照常渲染（缩没照走）。
     */
    private pulseFrames: readonly SpriteFrame[] = [];
    /**
     * `GroundGlow` 节点**非脉冲段**的原始 contentSize（`initialize` 时从 prefab 读一次）。
     *
     * 脉冲帧是 320×320 的大画布（整张含波的扩散余量），而开口光序列帧是 130×239 的竖条，
     * 两者共用同一个 Sprite 节点 ⇒ 谁在场谁写尺寸，离开脉冲段必须写回这一份，
     * 否则下一次抬升开口光会被拉成 320×320 的一整块。
     */
    private groundGlowBaseSize: { width: number; height: number } | null = null;
    /** 脉冲的染色（每帧从 `pulseTintForRarity` 拷进来，复用实例避免每帧分配）。 */
    private readonly pulseTintColor = new Color(255, 255, 255, 255);
    /**
     * 本格脉冲要染的**色**（按抽到的卡牌品阶，见 `pulseTintForRarity`）。
     *
     * 由 `renderActivation` **每帧**从激活事件里取（`activation.cardRarity`）重写 ——
     * 品阶是「这一次开发」的结果，不是格子的静态属性，所以不能像旧版那样在 0.15s 的
     * `render` 里按 `state.tileType` 缓存。缺省绿（= 没抽到卡）。
     */
    private pulseTint: Color = PULSE_TINT_DEFAULT;
    /** 上一次应用到的表现参数；null = 不在激活期，用于复位检查。 */
    private lastActivationFx: IZCHexFlipFx | null = null;
    /**
     * 建筑「生成单位抖动」的起始时刻（秒）；null = 当前没在抖。
     *
     * 需求（2026-10-15 row5）：「建筑每一次【生成单位倒计时】结束时，播放一次【生成单位动画】」
     * ⇒ 渲染层在兵营格产出兵的**首帧**（单位 `isBirth`）调 `playBuildingShake` 登记，
     * 之后每帧由 `advanceBuildingShake` 推进（`renderStatic` 是 0.15s 节流，播不出 0.24s 的抖动）。
     */
    private buildingShakeStartedAt: number | null = null;
    /**
     * 抖动对建筑缩放的**倍率**（x / y 分开，因为需求要「先 Y 后 X」两段）。
     *
     * 由 `applyBuildingScale` 乘进基准 `BUILDING_ICON_SCALE` —— 保持「单一写入口」不变：
     * 抖动只是给那一处再加一个因子，别的渲染路径照常只传 multiplier。
     * 不在抖动期时为 1（与基准同值，写出来的就是原来的等比缩放）。
     */
    private buildingShakeScaleX = 1;
    private buildingShakeScaleY = 1;
    /**
     * 新点亮邻格「可开发外观」的按住截止时刻（秒）；<= now 表示已放行。
     *
     * 需求（2026-10-15 row6）：「三个新扩展的方块展示时间延迟 0.2s，等待卡牌生成动画开始
     * 播放后再展示出来」。由 `resolveDevelopableHold` 在 `canDevelop` 由假变真时登记，
     * 见 `ZC_HEX_NEIGHBOR_HOLD_SECONDS`。
     */
    private developableHoldUntil = 0;
    /** 上一帧的 `canDevelop`（用于识别「这一格刚被点亮」那一拍）。 */
    private lastCanDevelop = false;
    /** 是否已经记过首帧基线；false = 还没渲染过，本帧只记状态、不登记按住窗。 */
    private developableBootstrapped = false;
    /**
     * 上一次写进 `outlineGraphics` 的**提示透明度**（`0` = 提示没开）。
     *
     * 提示是每帧重绘的闪烁（需求 2026-10-15 row10），而透明度每帧只变一点点 ——
     * 缓存它才能做到「变化小于 2% 就连 Graphics 都不碰」（`cc.Graphics` 每次 `stroke()`
     * 都会重建一整份顶点数据 + 提交一个 subModel）。
     */
    private hintOutlineAlpha = 0;
    /**
     * 地块节点的**布局位置**（渲染层建视图时 `setPosition` 给的）。
     *
     * 翻面动效的 Y 上移必须绕它做偏移 —— 写成 `setPosition(0, lift, 0)` 会把整格挪到棋盘原点。
     * 在 `initialize` 里捕获；地块视图对象池复用时 `initialize` 会重跑，所以每局都拿得到当前基准。
     */
    private basePosition: Vec3 | null = null;
    /**
     * 「所有层之上」的容器（渲染层注入 = 棋盘根节点 `ZCGameBoard`）。
     *
     *  地块抬升时把格节点临时挂到它的**末位子节点之后**：棋盘各层（水面 / 地块 / 轮廓 /
     *  装饰 / 建筑 / 状态条）都是它的子层，末位即整盘最顶 —— 不这么做的话，抬起的顶面
     *  会被城墙、建筑、轮廓与血条压住（它们都在 `HexLayer` 之上）。
     */
    private activationLayer: Node | null = null;
    /** 抬升前的父节点；null = 当前没被抬到顶层（归位后清空）。 */
    private homeParent: Node | null = null;
    /** 抬升前在父层里的索引：归位要放回原位，别打乱画家排序。 */
    private homeSiblingIndex = 0;
    /**
     * 中立资源图标专用的**棋盘级**图层（`ZCGameBoard` 的 `ResourceLayer`）。渲染层注入。
     * 详见 docs/ZCHexView设计决策.md §11。
     */
    private resourceIconLayer: Node | null = null;
    /** 资源图标当前是否被抬到 `resourceIconLayer`（false = 正常挂在 `BuildingLayer` 下）。 */
    private resourceIconRaised = false;
    /**
     * 底部发光（开口光）的**序列帧**（渲染层注入，来自 `image/effects/hex_ground_glow`）。
     *
     * 8 帧、自带「淡入 → 峰值 → 淡出」的 alpha 曲线（末帧全透明），按收场段进度切帧即可，
     * 不需要材质也不需要额外的强度曲线。空数组 ⇒ 整块关掉（不崩、不空）。
     *
     * ⚠️ 对局自 2026-10-14 起**不再压扁地块**（改成原地缩没），所以本视图不再挂
     * `hex-flip.effect` 那份透视材质 —— 底光依旧在：它靠的是抬升量，与收场形状无关。
     */
    private groundGlowFrames: readonly SpriteFrame[] = [];
    private readonly groundGlowTintColor = new Color(255, 255, 255, HEX_FLIP_GROUND_GLOW_ALPHA);
    /** 上一次 `renderTerrain` 用的地块色，侧面与贴边光都沿用它。 */
    private terrainTintColor: Color | null = null;

    initialize(onClick: () => void): void {
        this.clickHandler = onClick;
        // 地块节点是对象池复用的：先摘再挂，避免同一实例上叠出多个监听。
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        // 轮廓已由 `OutlineLayer` 共享绘制（见字段注释）。关掉这份 per-cell 的，
        // 避免漏网调用路径画出与共享层重叠的第二份线。
        this.outlineGraphics.clear();
        this.outlineGraphics.enabled = false;
        this.observedHp = null;
        this.observedWallHp = null;
        this.lastDamagedAt = null;
        // 渲染层在这个调用之前已经 `setPosition` 落好格子位置（见 `ZCGameRenderWorld` 建视图那段），
        // 这里捕一份基准给翻面动效用；顺手清掉上一局的补间状态。
        this.basePosition = this.node.position.clone();
        this.lastActivationFx = null;
        // 脉冲层与开口光共用 `GroundGlow`：这里把 prefab 的原始画布尺寸存一份，
        // 离开脉冲段时按它写回（见 `restorePulseLayer`）。
        const groundGlowTransform = this.groundGlow?.node.getComponent(UITransform);
        this.groundGlowBaseSize = groundGlowTransform
            ? { width: groundGlowTransform.contentSize.width, height: groundGlowTransform.contentSize.height }
            : null;
        // 抖动 / 按住窗都是**每局一次**的表现状态，对象池复用会带着上一局的值回来：
        // 不复位的话新格可能一上来就停在「被拉长的姿态」或「按住不放」。
        this.buildingShakeStartedAt = null;
        this.buildingShakeScaleX = 1;
        this.buildingShakeScaleY = 1;
        this.developableHoldUntil = 0;
        this.lastCanDevelop = false;
        this.developableBootstrapped = false;
        // 开局「点击金矿」提示也是每局一次：复用回来时上一局的闪烁可能还开在 `outlineGraphics` 上
        // （`enabled = true` + 一个非 0 的缓存透明度），不复位就会让新局的**别的**格子先闪一下。
        this.hintOutlineAlpha = 0;
        // 开局归属扩散波是**每局一次**的表现状态：复用回来的视图若还带着上一局的覆盖色，
        // 新局第一帧就会先闪一格归属色（`ZCClaimWave.start` 只会覆盖它自己要染的格）。
        this.claimWave = null;
        // 同理：结算扫场的覆盖也是**每局一次**的表现状态（上一次可能是被 `destroy` / 重开打断的，
        // 没收工）。三个字段要一起清 —— 只清 owner 而留着 mix / shimmer，下一帧 `render` 早于
        // 渲染层的 `setSweepOwner` 时，就按上一局的深色 + 闪烁画过一格了。
        this.sweepOwner = null;
        this.sweepMix = 0;
        this.sweepShimmer = 0;
        this.sweepKey = '';
        // 脉冲层与开口光共用这个 Sprite 节点：复用回来的视图可能还停在「320×320 画布 +
        // 对齐缩放」上，不清就会让本局第一次抬升时把光带画成一大块（见 `restorePulseLayer`）。
        this.restorePulseLayer();
        this.contentKey = '';
        this.terrainTintColor = null;
        this.groundGlowTintColor.r = 255;
        this.groundGlowTintColor.g = 255;
        this.groundGlowTintColor.b = 255;
        this.groundGlow.color = this.groundGlowTintColor;
        // 复用回来的视图可能停在「抬到顶层」的状态（上一局播到一半就被回收）——
        // 父节点此时已由渲染层设回 HexLayer，这里只把基准清掉，下次抬升重新记。
        this.homeParent = null;
        // 同上：上一局可能把**资源图标**抬到棋盘层了，这里无条件收回 `BuildingLayer`。
        // ⚠️ 不能用 `setResourceIconRaised(false)`：`resourceIconLayer` 是渲染层在
        // `initialize` **之后**才注入的，此刻它还是 null，那个方法会走早退分支收不回来。
        this.resourceIconRaised = false;
        if (this.buildingLayer && this.iconSprite && this.iconSprite.node.parent !== this.buildingLayer) {
            this.iconSprite.node.setParent(this.buildingLayer);
        }
        this.applyTileOffset(0, 1);
        this.applyTileTransform(1, 1);
        this.applyGroundGlow(0, 1);
    }

    /** 注入建筑外观帧解析器；新建地块视图时由渲染层喂一次。 */
    setBuildingFrameResolver(resolver: IZCBuildingFrameResolver): void {
        this.buildingFrameResolver = resolver;
    }

    /**
     * 注入「所有层之上」的容器（棋盘根节点）。新建地块视图时由渲染层喂一次。
     * 没注入时抬升不动层级 —— 宁可不置顶，也不要按自己猜的父节点乱挂。
     */
    setActivationLayer(layer: Node | null): void {
        this.activationLayer = layer ?? null;
    }

    /**
     * 注入中立资源图标所在的棋盘级图层（`ZCGameBoard/ResourceLayer`）。新建地块视图时由渲染层喂一次。
     *
     * 没注入时不抬层（图标继续留在 `BuildingLayer`）—— 宁可不抬，也不要按自己猜的父节点乱挂。
     */
    setResourceIconLayer(layer: Node | null): void {
        this.resourceIconLayer = layer ?? null;
    }

    /**
     * 注入底部发光的序列帧（按帧序）。新建地块视图时由渲染层喂一次。
     * 传空数组 / 加载失败时隐藏整块光，其余表现不受影响。
     */
    setGroundGlowFrames(frames: readonly SpriteFrame[]): void {
        this.groundGlowFrames = frames ?? [];
    }

    /**
     * 抬升期把地块临时提到**整盘最顶**，落回后按原索引归位。
     * 详见 docs/ZCHexView设计决策.md §12。
     */
    private setRaised(raised: boolean): void {
        const layer = this.activationLayer;
        if (!layer) return;
        if (raised) {
            if (this.homeParent) return;
            const parent = this.node.parent;
            // 已经挂在顶层（或没有父）就不动，免得把索引记成错的基准。
            if (!parent || parent === layer) return;
            this.homeParent = parent;
            this.homeSiblingIndex = this.node.getSiblingIndex();
            this.node.setParent(layer);
            this.node.setSiblingIndex(layer.children.length - 1);
            return;
        }
        const home = this.homeParent;
        if (!home) return;
        this.homeParent = null;
        this.node.setParent(home);
        this.node.setSiblingIndex(this.homeSiblingIndex);
    }

    /**
     * 把**中立资源图标**在 `BuildingLayer` ↔ 棋盘级 `ResourceLayer` 之间搬一次（幂等）。
     * 详见 docs/ZCHexView设计决策.md §13。
     */
    private setResourceIconRaised(raised: boolean): void {
        const sprite = this.iconSprite;
        const layer = this.resourceIconLayer;
        if (!sprite || !layer) {
            this.resourceIconRaised = false;
            return;
        }
        const node = sprite.node;
        const target = raised ? layer : this.buildingLayer;
        if (!target) {
            this.resourceIconRaised = false;
            return;
        }
        if (raised === this.resourceIconRaised && node.parent === target) return;
        this.resourceIconRaised = raised;
        node.setParent(target);
        // 抬层期间可能被激活表现的「隐藏段」关掉过，搬回来时统一恢复。
        // 只在**真的换过父**时写，所以不会和 `applyActivationFx` 的隐藏段打架。
        node.active = true;
    }

    /**
     * 写 `iconSprite.node` 的坐标（**唯一写入口**，与 `applyTileOffset` / `applyBuildingScale` 同款）。
     *
     * `local` 是 **BuildingLayer 内的局部坐标** —— 三个落点常量都是这个口径。
     * 图标被抬到棋盘级 `ResourceLayer` 时，局部坐标不再共享同一个父节点，得自己把
     * 「格节点位置 + BuildingLayer 偏移」补回去；否则图标会跑到棋盘原点附近。
     */
    private applyIconPosition(local: Readonly<{ x: number; y: number; z: number }>): void {
        const sprite = this.iconSprite;
        if (!sprite) return;
        if (!this.resourceIconRaised) {
            sprite.node.setPosition(local.x, local.y, local.z);
            return;
        }
        const base = this.buildingLayer?.position;
        sprite.node.setPosition(
            this.node.position.x + (base?.x ?? 0) + local.x,
            this.node.position.y + (base?.y ?? 0) + local.y,
            local.z);
    }

    /**
     * 注入「本局携带的神器」图标。
     *
     *  与建筑外观帧解析器不同，这个**每个地块视图都要拿同一份**（渲染层在建视图时逐个喂，
     *  因为地块是池化复用的，注入一次不会覆盖到池里其它实例）。
     *
     *  ⚠️ 注入后会作废 `contentKey`：帧可能在格子已经渲染过之后才到，
     *  不作废的话那一格会一直空着图标（与 `setBuildingFrameResolver` 同款问题）。
     */
    setArtifactChargeFrame(frame: SpriteFrame | null): void {
        this.artifactChargeFrame = frame;
        this.contentKey = '';
    }

    /**
     * 注入兵力资源点（`unit_cap`）格内要站的中立兵。
     * 详见 docs/ZCHexView设计决策.md §14。
     */
    setResourceUnits(cardId: string, prefab: Prefab | null, count: number): void {
        const nextCount = Math.max(0, Math.floor(count));
        // ⚠️ **数量变了也必须重建**：并排位置按count 算（`(i-(count-1)/2)*spacing`），
        // 只改「可见个数」而沿用旧位置 ⇒ 3 个改 1 个时剩下那只还站在 -16，看着就是歪的。
        const changed = cardId !== this.resourceUnitKey
            || (prefab?.name ?? '') !== this.resourceUnitPrefabName
            || nextCount !== this.resourceUnitCount;
        this.resourceUnitKey = cardId;
        this.resourceUnitPrefabName = prefab?.name ?? '';
        this.resourceUnitPrefab = prefab;
        this.resourceUnitCount = nextCount;
        // 换兵种 / 换数量都要重建节点（骨架与并排布局都变了）。
        if (changed) this.rebuildResourceUnits();
        // 作废内容键：资源点可能在格子已渲染过之后才注入，不作废那一格会一直空着。
        this.contentKey = '';
    }

    /**
     * 废墟外观兜底：prefab 已绑（`@property` 非空）时不覆盖，只在缺图时从建筑帧目录取 `fx`
     * （`image/buildings/fx`）。取不到就整格留白 —— 不再回退「废」字（那会盖住废墟图）。
     */
    ensureRuinsFrame(frames: ReadonlyMap<string, SpriteFrame> | undefined): void {
        this.ruinsFrame ??= frames?.get('fx') ?? null;
    }

    render(presentation: Readonly<IZCHexPresentation>): void {
        const { state } = presentation;
        // 🔴 需求 2026-10-15（row6）：「三个新扩展的方块展示时间延迟 0.2s，等待卡牌生成
        // 动画开始播放后再展示出来」。按住期内把 `canDevelop` 压成 false ⇒ 下游
        // 内容签名 / 地形染色 / 图标价格整条路径一起回退成「还没点亮」的样子，
        // 到点后 `canDevelop` 恢复、签名变化自动触发一次重渲染。
        // ⚠️ 判定必须**先单独求值**再与 `canDevelop` 合取：写成
        // `presentation.canDevelop && !this.resolveDevelopableHold(...)` 会被短路 ——
        // 不可开发的那几拍根本不进方法，`developableBootstrapped` / `lastCanDevelop`
        // 拿不到基线，第一次「点亮」也就识别不出来（按住窗整条失效）。
        const holdDevelopable = this.resolveDevelopableHold(presentation.canDevelop, presentation.now);
        const canDevelop = presentation.canDevelop && !holdDevelopable;
        const activation = presentation.activation;
        const hasCardReveal = activation?.hasCardReveal ?? true;
        const progress = ZCHexView.activationProgress(activation, presentation.now);
        // 激活表现不能受 contentKey 缓存拦截（位移/缩放/active/光效不是「内容」）。
        // ⚠️ 这条是 **0.15s 一次的兜底**（`renderStatic` 节流）：真正每帧推进的是
        // `renderActivation`（挂 `renderDynamic`）。留着它是为了「激活事件已过期」时
        // 即使动态层那一帧没赶上，也能在一拍内把地块复位。
        const fx = hexActivationFx(progress, hasCardReveal);
        // 脉冲染色只跟**卡牌品阶**走（2026-10-19），由 `renderActivation` 每帧从激活事件里取；
        // 这条 0.15s 兜底路径拿不到品阶就不动它 —— 用 `state.tileType` 去猜会把颜色改错。
        this.applyActivationFx(fx);
        this.renderHealthBar(state, presentation.now);
        this.renderCooldown(
            !canDevelop && state.state !== 'ruins' && state.building !== 'none' ? presentation.cooldown : null,
        );
        // 脉冲段（建筑还没长出来）里，格子仍按「开发前」的可开发外观渲染 —— 图标+价格数字
        // 跟着呼吸缩放，而不是让已经落地的建筑提前顶掉它们。建筑要等卡牌淡出那段才换上来。
        const showDevelopable = progress >= 0 && hasCardReveal && !fx.hidden && fx.buildingPopScale === 0;
        const affordable = presentation.playerGold >= state.developmentCost;
        const key = this.contentSignature(state, presentation, canDevelop, affordable, showDevelopable);
        if (key === this.contentKey) return;
        this.renderTerrain(state, canDevelop);
        this.renderContent(state, canDevelop, affordable, presentation.hideNeutralResourceLabel === true, showDevelopable);
        this.contentKey = key;
    }

    /**
     * 单帧推进激活表现（由渲染层**每帧**调用）。
     *
     * 为什么单独一条入口：地块的常规刷新 `ZCGameRenderWorld.renderHexSystem` 挂在
     * `renderStatic` 上、由 `ZCGame.update` 按 0.15s 节流 —— 6.7fps 播不出「抬起 + 翻面」，
     * 会一卡一卡。卡牌 / 特效 / 飘字都在 `renderDynamic` 里每帧刷，这里对齐它们。
     *
     * `activation` 为 null（已过期）时走复位，与 `render` 同一条 `applyActivationFx`，幂等。
     */
    /**
     * 激活表现进度：无事件 / 未开始 / 已过期 → -1（走普通渲染）；否则 0~1。
     *
     * `now` 与 `startedAt` 必须同一时钟（渲染层喂的 `visualTime`），两端表现才能严格同步。
     * 两个调用点（静态刷新 `render` 与每帧推进 `renderActivation`）共用，按 §6.2-12 收为私有静态。
     */
    private static activationProgress(
        activation: Readonly<ZCHexActivation> | null | undefined,
        now: number,
    ): number {
        if (!activation) return -1;
        const elapsed = now - activation.startedAt;
        if (elapsed < 0 || elapsed >= activation.durationSeconds) return -1;
        return elapsed / activation.durationSeconds;
    }

    /**
     * 开局「点击金矿」提示：给这一格套一圈**整体描边闪烁**（需求 2026-10-15 row10 原文：
     * 「进入游戏初始时，给金矿图标所在的地块格子增加一个整体的描边闪烁，提示玩家点击金矿」）。
     * 详见 docs/ZCHexView设计决策.md §15。
     */
    renderHintOutline(alpha: number): void {
        const graphics = this.outlineGraphics;
        if (!graphics) return;
        const value = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
        if (value <= 0) {
            if (this.hintOutlineAlpha <= 0) return;
            this.hintOutlineAlpha = 0;
            graphics.clear();
            graphics.enabled = false;
            return;
        }
        if (graphics.enabled && Math.abs(value - this.hintOutlineAlpha) < 0.02) return;
        this.hintOutlineAlpha = value;
        if (!graphics.enabled) graphics.enabled = true;
        graphics.clear();
        graphics.lineWidth = ZCHexView.HINT_OUTLINE_LINE_WIDTH;
        const color = ZCHexView.HINT_OUTLINE_COLOR;
        graphics.strokeColor = new Color(color.r, color.g, color.b, Math.round(255 * value));
        // 顶点相对格心（本节点就在格心上，`_lpos = 0`）⇒ 与共享轮廓的画法完全一致，
        // 两条线（提示 / 领地）在屏幕上是同一条边，只是粗细与颜色不同。
        const points = ZC_OUTLINE_HEX_POINTS;
        for (let index = 0; index < points.length; index += 1) {
            const from = points[index];
            const to = points[(index + 1) % points.length];
            graphics.moveTo(from[0] * OWNED_OUTLINE_INSET_SCALE, from[1] * OWNED_OUTLINE_INSET_SCALE);
            graphics.lineTo(to[0] * OWNED_OUTLINE_INSET_SCALE, to[1] * OWNED_OUTLINE_INSET_SCALE);
        }
        graphics.stroke();
    }

    renderActivation(activation: Readonly<ZCHexActivation> | null, now: number, owner?: ZCFaction): void {
        // 动态帧先于 0.15 秒节流的地块刷新，侧面必须先拿到本帧归属色。
        if (activation && owner) {
            const tint = zcFactionColor(owner);
            this.terrainTintColor = tint;
            this.applyGroundGlowTint(tint);
        }
        // 脉冲染色跟着**抽到的卡牌品阶**走（用户 2026-10-19）：0 = 没抽到卡 ⇒ 绿。
        // 必须在 `applyActivationFx` 之前写 —— 它每帧读这份缓存去刷 Sprite 的颜色。
        this.pulseTint = pulseTintForRarity(activation?.cardRarity ?? 0);
        this.applyActivationFx(
            hexActivationFx(ZCHexView.activationProgress(activation, now), activation?.hasCardReveal ?? true),
        );
    }

    /**
     * 应用激活表现：整格上移 / 翻面 / 显隐 / 建筑弹入 / 光圈光效。
     *
     * **每帧**都会被调（见 `renderActivation`），所以每条写节点前先比一次值、没变就不碰。
     * 不在激活期时把格根与建筑节点复位 —— 地块视图是对象池复用，
     * 不复位的话上一次的抬起 / 翻面 / 弹入会带到下一局。
     */
    /**
     * 激活表现的瞬时复位：位移 / 地块缩放 / 地面光 / 脉冲材质一次写回基准值。
     *
     * 这几项**必须同拍一起写**（漏一个就留残影：脉冲材质套在开口光序列帧上会再乘一次亮度、
     * 地块停在最小缩放会让回场那一帧看见"从最小展开"）。建筑缩放由调用方按段决定：
     * 激活期外落回基准值，隐藏段传 0（等卡牌淡出那段才一起长出来）。
     */
    private resetActivationVisuals(): void {
        this.setRaised(false);
        this.applyTileOffset(0, 1);
        this.applyTileTransform(1, 1);
        this.applyGroundGlow(0, 1);
    }

    private applyActivationFx(fx: IZCHexFlipFx): void {
        const pulsing = fx.pulsePhase !== undefined;
        const active = fx.hidden || fx.tileFlip !== 1 || fx.tileScale !== 1 || fx.tileLift !== 0
            || fx.buildingPopScale !== 1 || fx.glowRadius > 0 || pulsing;
        // 只有参数变化才碰节点（每帧调，格子在激活期外占绝大多数）。
        const last = this.lastActivationFx;
        if (!active && (!last || (last.tileFlip === 1 && last.tileScale === 1 && last.tileLift === 0
            && last.buildingPopScale === 1 && last.glowRadius === 0 && !last.hidden))) {
            this.lastActivationFx = null;
            // 激活期外也要保证建筑缩放落在基准值：prefab 的 `_lscale = 0.9` 不是运行时真源
            // （见 `BUILDING_ICON_SCALE` 的口径说明）。有变化才写，值没变时零开销。
            this.setRaised(false);
            this.applyTileOffset(0, 1);
            this.applyTileTransform(1, 1);
            this.applyGroundGlow(0, 1);
            this.applyBuildingScale();
            // 激活期结束：抬到棋盘层的资源图标要跟着回显（隐藏段可能把它关掉过）。
            // 只在「抬层中 + 当前是关的」这一种情况下写，常规帧零开销。
            if (this.resourceIconRaised && !this.iconSprite.node.active) {
                this.iconSprite.node.active = true;
            }
            return;
        }
        this.lastActivationFx = fx;
        if (this.node.active === fx.hidden) this.node.active = !fx.hidden;
        // 抬到棋盘层的资源图标**不随格节点隐藏**（它已经不在格节点下了），单独跟一下显隐，
        // 否则卡牌独占视线那段「整格隐藏」里会剩一个图标飘着。
        if (this.resourceIconRaised) this.iconSprite.node.active = !fx.hidden;
        if (fx.hidden) {
            // 隐藏段整格不可见：位移与缩放也复位（收场末停在 0.1 与最高点，
            // 不复位的话地块回场那一刻会先看到「从最小展开」的帧差）。
            // 建筑也保持隐藏（buildingPopScale 0）—— 它要等卡牌淡出那段才跟淡出同拍长出来。
        this.resetActivationVisuals();
            this.applyBuildingScale(0);
            return;
        }
        // 抬升期提到整盘最顶（`tileLift > 0` 只在前置段成立 ⇒ 落地即归位）。
        this.setRaised(fx.tileLift > 0);
        this.applyTileOffset(fx.tileLift, fx.tileFlip);
        this.applyTileTransform(fx.tileFlip, fx.tileScale);
        // 脉冲段的**序列帧**与「抬升开口光」抢同一个中间层节点（`ZCGameHex/GroundGlow`）：
        // 谁在场谁写 —— 脉冲段由 `pulsePhase` 决定「这一段归脉冲管」，具体第几帧看 `pulseFrame`
        // （`-1` = 波已走完，整层关掉等缩没段收干净），其余走开口光那条老路径。
        // （同一个节点而不是新加一层：它就是 prefab 里唯一排在「底图之上、图标之下」的层。）
        if (fx.pulsePhase !== undefined) {
            this.applyPulseRipple(fx.pulseFrame ?? HEX_PULSE_FRAME_HIDDEN);
        } else {
            this.applyGroundGlow(fx.tileLift, fx.tileFlip, fx.tileScale);
        }
        this.applyBuildingScale(fx.buildingPopScale);
    }

    /**
     * 地块 Y 偏移：**布局基准 + `lift` + 轴心补偿**。本方法是地块节点 `position` 的**唯一写入口**
     * （建视图那次由渲染层写，之后一律走这里）。
     *
     * 轴心补偿项 `pivot × (1 − flip)` 是为了让压扁绕指定轴心而不是整图中心走
     * （见 `HEX_FLIP_PIVOT_LIFT`）；`flip = 1`（不翻转 / 缩没段）时它是 0，常规渲染零影响。
     */
    private applyTileOffset(lift: number, flip: number): void {
        if (!this.basePosition) this.basePosition = this.node.position.clone();
        const base = this.basePosition;
        const targetY = base.y + lift + HEX_FLIP_PIVOT_LIFT * (1 - flip);
        if (this.node.position.y === targetY) return;
        this.node.setPosition(base.x, targetY, base.z);
    }

    /**
     * 地块收场（等比压扁 / 整格缩没）。**本方法是地块节点 `scale` 的唯一写入口**。
     * 详见 docs/ZCHexView设计决策.md §16。
     */
    private applyTileTransform(flip: number, scale: number): void {
        const targetX = scale;
        const targetY = flip * scale;
        if (this.node.scale.x === targetX && this.node.scale.y === targetY) return;
        this.node.setScale(targetX, targetY, 1);
    }

    /**
     * 底部发光（开口光）：地块抬起来之后，把原格开口那道光**用序列帧播一遍**。
     * 详见 docs/ZCHexView设计决策.md §17。
     */
    private applyGroundGlow(tileLift: number, tileFlip: number, tileScale = 1): void {
        const sprite = this.groundGlow;
        if (!sprite) return;
        // 非脉冲段这条路径接管同一个节点 ⇒ 先把脉冲段写在它上面的画布尺寸 / 对齐缩放归位
        // （池化复用/分段切换时不归位，开口光会被画成 320×320 的一大块）。
        this.restorePulseLayer();
        const node = sprite.node;
        const frames = this.groundGlowFrames;
        const collapseFlip = 1 - hexCollapseProgress(tileFlip, tileScale);
        const lit = frames.length > 0 && hexFlipGroundGlowStrength(tileLift, collapseFlip) > 0.001;
        if (node.active !== lit) node.active = lit;
        if (!lit) {
            // 灭掉时位置归基准 —— 池化复用时不留下上一格的状态。
            if (node.position.y !== HEX_FLIP_GLOW_MASK_OFFSET_Y) {
                node.setPosition(0, HEX_FLIP_GLOW_MASK_OFFSET_Y, 0);
            }
            return;
        }
        // 光带下沿钉在原格：父节点抬了多少，Sprite 就往下补多少。
        node.setPosition(0, HEX_FLIP_GLOW_MASK_OFFSET_Y - tileLift, 0);
        const tint = this.terrainTintColor;
        if (tint) this.applyGroundGlowTint(tint);
        const progress = hexFlipFoldProgress(tileLift, collapseFlip);
        const frame = frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))];
        if (frame && sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
    }

    private applyGroundGlowTint(tint: Color): void {
        const sprite = this.groundGlow;
        const color = sprite.color;
        if (color.r === tint.r && color.g === tint.g && color.b === tint.b
            && color.a === HEX_FLIP_GROUND_GLOW_ALPHA) return;
        this.groundGlowTintColor.r = tint.r;
        this.groundGlowTintColor.g = tint.g;
        this.groundGlowTintColor.b = tint.b;
        this.groundGlowTintColor.a = HEX_FLIP_GROUND_GLOW_ALPHA;
        sprite.color = this.groundGlowTintColor;
    }

    /**
     * 写建筑外观节点的缩放 / 显隐：`BUILDING_ICON_SCALE × multiplier`。
     * 详见 docs/ZCHexView设计决策.md §18。
     */
    private applyBuildingScale(multiplier = 1): void {
        const node = this.buildingSprite.node;
        const visible = multiplier > 0;
        if (node.active !== visible) node.active = visible;
        if (!visible) return;
        // 生成单位抖动（需求 row5）在这里叠一层因子：抖动期 x / y 分开拉（先 Y 后 X），
        // 非抖动期两个因子都是 1 ⇒ 写出来的还是原来的等比 0.72。
        const base = BUILDING_ICON_SCALE * multiplier;
        const scaleX = base * this.buildingShakeScaleX;
        const scaleY = base * this.buildingShakeScaleY;
        if (node.scale.x !== scaleX || node.scale.y !== scaleY) node.setScale(scaleX, scaleY, 1);
    }

    /**
     * 登记一次建筑「生成动画：抖动」—— 兵营每产出一次兵（需求 row5）、
     * 主城 / 金矿每次产金（需求 row12 / row13）都调一次。
     *
     * 只记起点；曲线与推进在 `advanceBuildingShake`（同 `ZCGameViewUtil.spawnShake*`）。
     * 起点重置为 1 号相位：连续两次触发离得近时，后一次要从头播，不能接着上一段的尾巴。
     */
    playBuildingShake(now: number): void {
        this.buildingShakeStartedAt = now;
        this.buildingShakeScaleX = 1;
        this.buildingShakeScaleY = 1;
    }

    /**
     * 推进建筑抖动；返回是否仍在抖（false = 已播完并复位）。
     *
     * 渲染层把它挂在 `renderDynamic` 上每帧调 —— `renderStatic` 是 0.15s 节流，
     * 一帧就跨掉了 0.12s 的半个相位，播出来只会是「闪一下」。
     * 播完必须**显式复位**到基准缩放：否则建筑会停在被拉长的姿态（没有别的地方会把它改回来）。
     */
    advanceBuildingShake(now: number): boolean {
        if (this.buildingShakeStartedAt === null) return false;
        const elapsed = now - this.buildingShakeStartedAt;
        if (elapsed >= SPAWN_SHAKE_TOTAL_SECONDS) {
            this.buildingShakeStartedAt = null;
            this.buildingShakeScaleX = 1;
            this.buildingShakeScaleY = 1;
            this.applyBuildingScale(1);
            return false;
        }
        // 建筑抖动的拉伸量走 `BUILDING_SHAKE_STRETCH`（120%）—— 与**单位**自己出生那一下的
        // 110% 分开（需求 row12「建筑模型放大比例从 110% 改成 120%」，只点建筑模型）。
        this.buildingShakeScaleX = spawnShakeScaleX(elapsed, BUILDING_SHAKE_STRETCH);
        this.buildingShakeScaleY = spawnShakeScaleY(elapsed, BUILDING_SHAKE_STRETCH);
        this.applyBuildingScale(1);
        return true;
    }

    /**
     * 「新点亮邻格」可开发外观的按住窗判定（需求 2026-10-15 row6）。
     * 🔴 row9 起**渲染世界也会调它**（`ZCGameRenderWorld.renderHexSystem`）—— 改口径要两边一起看。
     * 详见 docs/ZCHexView设计决策.md §19。
     */
    resolveDevelopableHold(canDevelop: boolean, now: number): boolean {
        if (!this.developableBootstrapped) {
            this.developableBootstrapped = true;
            this.lastCanDevelop = canDevelop;
            return false;
        }
        if (canDevelop && !this.lastCanDevelop) {
            this.developableHoldUntil = now + ZC_HEX_NEIGHBOR_HOLD_SECONDS;
        }
        this.lastCanDevelop = canDevelop;
        return canDevelop && now < this.developableHoldUntil;
    }

    /**
     * 注入脉冲段的序列帧（按帧序 0→4）。新建地块视图时由渲染层喂一次。
     * 传空数组 / 加载失败时波不显示，其余表现（缩没）不受影响。
     */
    setHexPulseFrames(frames: readonly SpriteFrame[]): void {
        this.pulseFrames = frames ?? [];
    }

    /**
     * 脉冲层（`GroundGlow`）的尺寸 / 缩放归位 —— **离开脉冲段时必调**。
     *
     * 脉冲段把这个节点改成了「320×320 画布 + 静态对齐缩放」（`applyPulseRipple`），
     * 而它是和抬升开口光**共用**的，地块视图又是**对象池复用**的 ⇒ 不复位的话下一次
     * 开口光会按 320×320 × 0.75/0.63 的位置和尺寸画出来，整条光带偏掉。
     */
    private restorePulseLayer(): void {
        const node = this.groundGlow?.node;
        if (!node) return;
        if (node.scale.x !== 1 || node.scale.y !== 1) node.setScale(1, 1, 1);
        const base = this.groundGlowBaseSize;
        const ui = node.getComponent(UITransform);
        if (base && ui && (ui.contentSize.width !== base.width || ui.contentSize.height !== base.height)) {
            ui.setContentSize(base.width, base.height);
        }
    }

    /**
     * 脉冲段：中间层播**一道**美术序列帧（`frame` = 该显示第几张，`-1` = 波已走完、退场）。
     * 详见 docs/ZCHexView设计决策.md §20。
     *
     * 🔴 **只换图**：需求（2026-10-19）明确「缩放与透明度已烘焙进图，节点上不要再做
     * scale / opacity 动画」。这里写的 scale 是**一次性的对齐换算**（把图上 164×142 的本体
     * 摊成格面 123×90），5 帧全程同一个值，不随帧走。
     *
     * ⚠️ 除 `parentScale`：格根此刻正被缩没段往 0.1 收（`applyTileTransform` 已在本帧早些
     * 时候写过），波是它的子节点 ⇒ 不除回去波会跟着一起缩，读起来是「波也被吸进去了」。
     */
    private applyPulseRipple(frame: number): void {
        const sprite = this.groundGlow;
        if (!sprite) return;
        const node = sprite.node;
        const frames = this.pulseFrames;
        // 没有帧 / 波已走完 / 帧号越界 ⇒ 整层关掉（不是「显示第 0 帧」，那会留一圈亮边）。
        if (!frames.length || frame < 0 || frame >= frames.length) {
            if (node.active) node.active = false;
            this.restorePulseLayer();
            return;
        }
        if (!node.active) node.active = true;
        // 320×320 的整张画布（含波的扩散余量）铺进来；锚点 0.5 ⇒ 画布中心 = 节点原点。
        const ui = node.getComponent(UITransform);
        if (ui && (ui.contentSize.width !== HEX_PULSE_CANVAS_SIZE
            || ui.contentSize.height !== HEX_PULSE_CANVAS_SIZE)) {
            ui.setContentSize(HEX_PULSE_CANVAS_SIZE, HEX_PULSE_CANVAS_SIZE);
        }
        const parentScale = this.node.scale.x > 0 ? this.node.scale.x : 1;
        const y = ZC_LAND_TOP_CENTER_LIFT / parentScale;
        if (node.position.y !== y) node.setPosition(0, y, 0);
        const scaleX = HEX_PULSE_SCALE_X / parentScale;
        const scaleY = HEX_PULSE_SCALE_Y / parentScale;
        if (node.scale.x !== scaleX || node.scale.y !== scaleY) node.setScale(scaleX, scaleY, 1);
        const next = frames[frame];
        if (next && sprite.spriteFrame !== next) sprite.spriteFrame = next;
        // 🔴 类型色必须**每帧都判一次**：同一调用里 `renderActivation` 已经先把阵营 tint
        // 写进这张 Sprite 了（`applyGroundGlowTint`），只按「类型没变」缓存的话会被它压住。
        const tint = this.pulseTint;
        const color = sprite.color;
        if (color.r !== tint.r || color.g !== tint.g || color.b !== tint.b || color.a !== 255) {
            this.pulseTintColor.set(tint.r, tint.g, tint.b, 255);
            sprite.color = this.pulseTintColor;
        }
    }

    /** 选点阶段不创建战斗快照，直接用地图声明绘制格子状态。 */
    renderSpawnSelection(presentation: Readonly<IZCSpawnHexPresentation>): void {
        this.renderCooldown(null);
        this.healthBar.node.active = false;
        const owner = presentation.sectionOwner;
        // 优先级：基地邻格深蓝高亮 > 受阻红 > 半区 / 中立色。
        // 高亮压过受阻色是有意的 —— 需求把「基地周围 6 格」定义成一律高亮；
        // 受阻这件事仍由下面的 × 文案表达，不必再借底色说第二遍。
        const tint = presentation.homeHighlight
            ? ZCHexView.SPAWN_BASE_NEIGHBOR_FILL
            : presentation.blocked
                ? ZCHexView.BLOCKED_FILL_COLOR
                : this.territoryFill(owner);
        // 中立格不显示：`territoryFill('neutral')` 的 alpha 为 0，`setSprite` 会直接停用这张 Sprite，
        // 棋盘底图透出来。格子边界靠 `OutlineLayer` 的矢量格线（那一层照常画）。
        this.setSprite(this.tileSprite, this.tileFrame, tint);
        // 领地轮廓由 `ZCGameRenderWorld.redrawSharedOutline` 统一画在 `OutlineLayer` 上，
        // 这一格不自己描（`outlineGraphics` 已在 `initialize` 里关掉）。

        const selectedOwner = presentation.selectedBy;
        // 主城外观与**正式对局同源**：走注入的 `buildingFrameResolver`（`hq` → `hq-base`），
        // 不再在这里另取一套「我方 / 敌方」通用图 —— 那条路径以前让选点阶段和对局显示两种主城。
        const hqFrame = selectedOwner ? this.buildingFrameResolver?.(null, 'hq', selectedOwner) ?? null : null;
        this.setSprite(this.buildingSprite, hqFrame, presentation.confirmed
            ? Color.WHITE
            : ZCHexView.UNCONFIRMED_HQ_COLOR);
        // 与正式对局同一基准缩放（`applyBuildingScale` 是唯一写入口）：选点阶段不调
        // `applyActivationFx`，不显式设的话这里会停在 prefab 的 `_lscale = 0.9`，
        // 表现为「选点时的主城比开发完成后大一号」。
        this.applyBuildingScale();
        // 资源点与**正式对局同源**：
        //  · 兵力资源点（`unit_cap`）站表里配的那几个兵的**待机**骨骼（不用兵营图标、不写文字）；
        //  · 其余（金矿 / 金币 / 宝箱 / 神器）照常走图标。
        //
        // 骨骼数据在建视图时就已经由 `ZCGameRenderWorld.injectResourceUnits` 喂进来，这里只是把
        // `renderContent` 那条分支搬过来用 —— 兵种/数量没变时 `rebuildResourceUnitsIfNeeded` 只做
        // 显隐，零 `instantiate`（`renderSpawnSelection` 也是每帧调的）。
        const unitPoint = presentation.resourcePoint && presentation.resourceId === 'unit_cap';
        const resourceUnits = unitPoint ? this.rebuildResourceUnitsIfNeeded() : this.hideResourceUnits();
        // 骨骼没建出来（表里没配卡 / 没单位 prefab）时才退回兵营图标兜底，别留一格空白。
        const resourceFrame = presentation.resourcePoint && presentation.resourceId && !(unitPoint && resourceUnits)
            ? this.frameForSpawnResource(presentation.resourceId) : null;
        this.setSprite(this.iconSprite, resourceFrame);
        // 与正式对局同一套落点/抬层口径（见 `renderContent` 那段）：选点阶段的地块同样互相重叠，
        // 资源图标不抬层照样会被邻格整图沿格边线切掉。
        this.setResourceIconRaised(resourceFrame !== null);
        if (resourceFrame) {
            this.applyIconPosition(ZCHexView.RESOURCE_ICON_POS);
            const resourceScale = resourceIconScale(resourceFrame);
            this.iconSprite.node.setScale(resourceScale, resourceScale, 1);
        } else {
            // 选点阶段不画地块类型图标（只可能是「没有图标」或资源点图标），但这个节点与对局共用，
            // 复位值必须与对局基准同源：写成 1 就是第二个「静止值」，以后这里加了图标立刻大小不一。
            this.applyIconPosition(ZCHexView.DEFAULT_TILE_ICON_POS);
            this.iconSprite.node.setScale(TILE_ICON_SCALE, TILE_ICON_SCALE, 1);
        }
        this.priceIcon.enabled = false;

        let text = '';
        if (presentation.blocked) text = '×';
        if (presentation.regionText && !text && !selectedOwner) text = presentation.regionText;
        if (selectedOwner) text = presentation.confirmed ? '锁' : '已选';
        // 站了骨骼的格子**一个字都不写**（与对局一致）：这一格的语义是「这里的兵」，
        // 不是「可开发 / 可点」；区名 / × / 锁 也都让位给兵。
        if (resourceUnits) text = '';
        this.buildingLayer.active = resourceUnits ? false : (!!hqFrame || text !== '' || resourceFrame !== null);
        this.iconLabel.enabled = text !== '';
        this.iconLabel.string = text;
        this.iconLabel.color = presentation.blocked
            ? ZCHexView.INSUFFICIENT_GOLD_COLOR
            : presentation.unlocksResource
                ? ZCHexView.RESOURCE_RESOLVED_COLOR
                : ZC_CLIENT_COLORS.white;
        // 正式对局的首帧必须无条件重绘，不能复用选点阶段留下的 contentKey。
        this.contentKey = '';
    }

    /**
     * 选点阶段的资源图标：与正式对局同源（宝箱 / 金币 / 金矿 / 神器）。
     *
     *  ⚠️ `unit_cap` **正常走不到这里** —— 它在 `renderSpawnSelection` 里就分支去了
     *  「格内待机骨骼」（与对局一致）。只有骨骼建不出来（`neutralResource` 表没配
     *  `rewardCardId`、或该卡没有单位 prefab）时才会落回这里，用兵营图标兜底，
     *  免得那一格既没兵也没图、看着像块空地。
     */
    private frameForSpawnResource(id: string): SpriteFrame | null {
        if (id === 'unit_cap') return this.barracksIconFrame;
        return this.frameForResource(id);
    }

    /**
     * 结算扫场覆盖：把这一格画成 `owner`（null = 恢复正常按 `state.owner` 渲染）。
     * 详见 docs/ZCHexView设计决策.md §21。
     */
    setSweepOwner(owner: ZCOwner | null, mix = 0, shimmer = 0): void {
        this.sweepOwner = owner;
        this.sweepMix = clamp01(mix);
        this.sweepShimmer = clamp01(shimmer);
        if (owner === null) {
            this.sweepKey = '';
            return;
        }
        // 回正到 1 的格子这条闪烁已经不参与配色 ⇒ 不并进指纹（见 `sweepKey` 的说明）。
        const shimmerKey = this.sweepMix >= 1 ? 0 : Math.round(this.sweepShimmer * 16);
        this.sweepKey = `${owner}:${Math.round(this.sweepMix * 32)}:${shimmerKey}`;
    }

    /**
     * 开局归属扩散波：把这一格从 `from`（选点阶段的半区色）过渡到 `to`（战斗底色）。
     * 详见 docs/ZCHexView设计决策.md §22。
     */
    setClaimWave(wave: Readonly<{ from: ZCFaction; to: ZCFaction; progress: number }> | null): void {
        if (wave === null) {
            if (this.claimWave === null) return;
            this.claimWave = null;
            // 收工时把静态指纹清掉：覆盖期写进去的颜色只在「进度 1」时与常规渲染同值，
            // 中途收工（重开一局 / 止波）必须让下一拍 `render` 无条件重算一遍真实底色。
            this.contentKey = '';
            return;
        }
        this.claimWave = { from: wave.from, to: wave.to, progress: clamp01(wave.progress) };
        this.applyClaimWaveTint();
    }

    /**
     * 扩散波中途换色：只改色，不动 `spriteFrame`（这一格播的是同一张图，`setSprite` 内部有守卫）。
     *
     * ⚠️ 必须走 `setSprite` 而不是直接写 `color` —— 波的末端可能就是中立色（alpha 0），
     * 那一格要跟着**渐隐停用**，否则会出现「颜色已经透明、Sprite 还开着」的错位。
     */
    private applyClaimWaveTint(): void {
        const wave = this.claimWave;
        if (!wave) return;
        const tint = this.claimWaveTint(wave.from, wave.to, wave.progress);
        this.terrainTintColor = tint;
        this.applyGroundGlowTint(tint);
        this.setSprite(this.tileSprite, this.tileFrame, tint);
    }

    /**
     * 扩散波的颜色：`fromOwner` → `toOwner` 按 `progress` 线性过渡。
     *
     * 两端都用 `territoryFill` 算 ⇒ 与常规渲染（半区色 / 战斗底色）**逐位一致**，
     * 所以起手那一帧和收工那一帧都不会闪。
     */
    private claimWaveTint(fromOwner: ZCFaction, toOwner: ZCFaction, progress: number): Color {
        const from = this.territoryFill(fromOwner);
        const to = this.territoryFill(toOwner);
        if (progress <= 0) return from;
        if (progress >= 1) return to;
        return new Color(
            from.r + (to.r - from.r) * progress,
            from.g + (to.g - from.g) * progress,
            from.b + (to.b - from.b) * progress,
            from.a + (to.a - from.a) * progress,
        );
    }

    onDestroy(): void {
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.clickHandler = null;
        // 脉冲段 2026-10-19 起只换 `spriteFrame`，不再有运行时克隆的材质要销毁
        // （原 `ensurePulseMaterial` / `new Material()` 那条链已随 30 帧旧美术一起退役）。
        // 🔴 仍然别在销毁期碰子节点组件（规则 176）：`groundGlow.customMaterial = null` 之类会炸整个对局销毁。
        // 详见 docs/ZCHexView设计决策.md §23。
        this.groundGlowBaseSize = null;
    }

    private onTouchEnd(): void {
        this.clickHandler?.();
    }

    /**
     * 内容指纹：只有影响画面的字段才进 key，值没变就整块跳过（每帧每格都会走这里，别分配临时数组）。
     * `sweepKey`（扫场覆盖 + 深色回正档位）也并进来 —— 扫场覆盖必然导致下一帧重绘，
     * 同时不产生多余的 spriteFrame 赋值。
     */
    private contentSignature(
        state: Readonly<ZCHexState>,
        presentation: Readonly<IZCHexPresentation>,
        canDevelop: boolean,
        affordable: boolean,
        showDevelopable: boolean,
    ): string {
        return `${state.owner}|${this.sweepKey}|${state.state}|${state.building}`
            + `|${state.tileType}|${state.neutralResourceId ?? ''}|${state.tier}`
            + `|${state.developmentCost}|${state.developmentResolved}|${canDevelop}`
            + `|${affordable}|${presentation.hideNeutralResourceLabel === true}`
            + `|${presentation.boundaryMask ?? 0}|${showDevelopable}`;
    }

    /**
     * 一格一根血条，但一格上可能同时挂着城墙耐久和建筑耐久，按「当前能被打到的那样」取值：
     * 详见 docs/ZCHexView设计决策.md §24。
     */
    private renderHealthBar(state: Readonly<ZCHexState>, now: number): void {
        const bar = this.healthBar;
        // 旧存档 / 测试桩可能没有城墙字段，缺字段一律按「没有墙」处理。
        const wallHp = Number.isFinite(state.wallHp) ? state.wallHp : 0;
        const wallMaxHp = Number.isFinite(state.wallMaxHp) ? state.wallMaxHp : 0;
        const hasWall = wallHp > 0 && wallMaxHp > 0;
        updateHealthBar(bar, hasWall ? wallHp : state.hp, hasWall ? wallMaxHp : state.maxHp,
            pickHealthBarFill(state.owner, this.barFillPlayer, this.barFillEnemy,
                this.barFillEnemy2, this.barFillEnemy3));
        // 血量比上一帧少 = 这一帧挨了打。第一次渲染只记基线：格子视图是随地图
        // 一次建好的，若不记基线，开局第一帧就会把「满血」当成「刚被打」。
        const damaged = (this.observedHp !== null && state.hp < this.observedHp)
            || (this.observedWallHp !== null && wallHp < this.observedWallHp);
        this.observedHp = state.hp;
        this.observedWallHp = wallHp;
        if (damaged) this.lastDamagedAt = now;
        // updateHealthBar 已经把「maxHp 非法」写进 active，这里再叠 3 秒显示窗口。
        bar.node.active = bar.node.active && isHealthBarVisible(this.lastDamagedAt, now);
    }

    private renderTerrain(state: Readonly<ZCHexState>, canDevelop: boolean): void {
        // 中立 → 可开发（点了相邻格亮出的购买位）按玩家色染色，与"纯中立"染色不同。
        // 纯中立格 `tint.a` 为 0 ⇒ 这一格不显示（口径见 `NEUTRAL_FILL_ALPHA`）。
        const tint = this.territoryTint(state, canDevelop);
        // 缓存给抬升侧面的半透明涂抹用，避免光效再算一遍归属。
        this.terrainTintColor = tint;
        this.applyGroundGlowTint(tint);
        this.setSprite(this.tileSprite, this.tileFrame, tint);
    }

    private territoryTint(state: Readonly<ZCHexState>, canDevelop: boolean): Color {
        if (this.sweepOwner !== null) return this.sweepFill(this.sweepOwner, this.sweepMix, this.sweepShimmer);
        // 开局归属扩散：这一格还没轮到时按半区色画（`progress` 0），到了才过渡到战斗底色。
        // 压过下面那条常规口径，因为整盘底色此刻还没回到战斗态 —— 波前只管**何时**回。
        if (this.claimWave !== null) {
            return this.claimWaveTint(this.claimWave.from, this.claimWave.to, this.claimWave.progress);
        }
        if (state.state === 'ruins') {
            return new Color(
                ZC_CLIENT_COLORS.ruins.r,
                ZC_CLIENT_COLORS.ruins.g,
                ZC_CLIENT_COLORS.ruins.b,
                ZCHexView.TERRITORY_FILL_ALPHA);
        }
        return this.territoryFill(territoryTintOwner(state.owner, canDevelop));
    }

    /**
     * 领地填色。`deep` = 取该阵营的**深饱和版**（`zcDeepFactionColor`），结算扫场铺底用；
     * 常规渲染恒为 `false`，所以除了扫场没有任何路径会拿到深色。
     */
    private territoryFill(
        owner: ZCFaction,
        alpha: number = ZCHexView.TERRITORY_FILL_ALPHA,
        deep = false,
    ): Color {
        // 中立格**没有任何显示**（口径见 `NEUTRAL_FILL_ALPHA`）：alpha 恒 0，色相只在过渡色里参与混色。
        if (owner === 'neutral') {
            const shade = deep ? zcDeepFactionColor('neutral') : ZCHexView.NEUTRAL_FILL_RGB;
            return new Color(shade.r, shade.g, shade.b, ZCHexView.NEUTRAL_FILL_ALPHA);
        }
        const color = deep ? zcDeepFactionColor(owner) : zcFactionColor(owner);
        return new Color(color.r, color.g, color.b, alpha);
    }

    /**
     * 扫场底色：`mix` `0` → **深饱和**阵营色（刚铺上），`1` → 阵营**当前色**（已回正），
     * 中间线性过渡（需求 row8「深色格子即将完成全部填充时，再从起始点开始逐渐过渡到对应阵营的当前颜色」）。
     * 详见 docs/ZCHexView设计决策.md §25。
     */
    private sweepFill(owner: ZCFaction, mix: number, shimmer: number): Color {
        const deep = this.territoryFill(owner, ZCHexView.TERRITORY_FILL_ALPHA, true);
        const sparkling = shimmer > 0 ? zcTowardWhite(deep, shimmer) : deep;
        if (!(mix > 0)) return sparkling;
        const current = this.territoryFill(owner);
        if (mix >= 1) return current;
        const blend = (from: number, to: number): number => Math.round(from + (to - from) * mix);
        return new Color(
            blend(sparkling.r, current.r),
            blend(sparkling.g, current.g),
            blend(sparkling.b, current.b),
            blend(sparkling.a, current.a));
    }

    private renderContent(
        state: Readonly<ZCHexState>,
        canDevelop: boolean,
        affordable: boolean,
        hideNeutralResourceLabel: boolean,
        showDevelopable = false,
    ): void {
        const enemyCanDevelop = state.owner !== 'player' && state.owner !== 'neutral' && state.state === 'developable'
            && state.building === 'none' && !state.developmentResolved;
        const ruins = state.state === 'ruins';
        const hasBuilding = !canDevelop && !ruins && state.building !== 'none';
        // 缩没段（建筑还没长出来）仍按「开发前」外观渲染：图标+价格数字，建筑先不显示。
        // 用 `showDevelopable` 把 `canDevelop` 临时抬成 true、`hasBuilding` 压成 false，
        // 图标（`state.tileType` 开发后仍在）与 `developmentCost` 都还能还原出来。
        const effectiveCanDevelop = showDevelopable ? true : canDevelop;
        const showBuilding = !showDevelopable && hasBuilding;
        const buildingFrame = this.resolveBuildingFrame(state, ruins, showBuilding);
        this.setSprite(this.buildingSprite, buildingFrame, this.buildingTint(state, ruins));

        // 兵力资源点（`unit_cap`）走**格内骨骼**，不走图标 / 文字：表里配了`rewardCardId`
        // 与 `rewardUnitCount`，这里按配置站对应数量的中立待机兵。
        // 领取后`neutralResourceId` 被清空 ⇒ 走下面的 else 分支自动收掉。
        // ⚠️ 三元里必须给`&&` 加括号：裸写 `a && b ? x : y` 会被TS 解析成语法错误
        //（报TS1005/TS1389，指望不到具体行，容易误以为是别处坏了）。
        const wantsResourceUnits = state.neutralResourceId === 'unit_cap' && !hideNeutralResourceLabel;
        const resourceUnits = wantsResourceUnits
            ? this.rebuildResourceUnitsIfNeeded()
            : this.hideResourceUnits();
        const resourceFrame = state.neutralResourceId && !hideNeutralResourceLabel
            ? this.frameForResource(state.neutralResourceId) : null;
        this.setSprite(this.iconSprite,
            resourceFrame ?? (enemyCanDevelop ? this.enemyDevelopFrame : effectiveCanDevelop ? this.frameForTileType(state.tileType) : null));
        // 资源点图标居中；敌方可开发时没有价格/数字，也居中；我方可开发时图标压在地块上半部、价格在底部配对。
        const iconPos = resourceFrame
            ? ZCHexView.RESOURCE_ICON_POS
            : enemyCanDevelop
                ? ZCHexView.ENEMY_DEVELOP_ICON_POS
                : ZCHexView.DEFAULT_TILE_ICON_POS;
        // ⚠️ 必须先抬层、再写坐标：`applyIconPosition` 会按「图标当前挂在谁下面」决定
        // 要不要补 BuildingLayer 偏移（见它的注释），顺序反了坐标就按错的父节点算。
        // 只有**资源点图标**需要抬 —— 地块类型图标字形只占节点中段（约 33×33），
        // 落在顶面 123×90 之内，不会被邻格整图切到。
        this.setResourceIconRaised(resourceFrame !== null);
        this.applyIconPosition(iconPos);
        // ⚠️ 两条分支都**显式**写缩放，因为两者共用 `iconSprite` 一个节点，而节点随对象池复用：
        // 资源点图标按图尺寸缩到格子边长；地块类型图标（icon_jk/by/wh/em）回到基准 `TILE_ICON_SCALE`。
        // 漏写任一条 = 沿用上一格留下的值，表现为「资源点旁边的地块图标大小不一」。
        // 金币图标（`priceIcon`）与数字（`iconLabel`）在另一组节点上，这里不碰它们的 scale。
        if (resourceFrame) {
            const scale = resourceIconScale(resourceFrame);
            this.iconSprite.node.setScale(scale, scale, 1);
        } else if (this.iconSprite.node.scale.x !== TILE_ICON_SCALE) {
            this.iconSprite.node.setScale(TILE_ICON_SCALE, TILE_ICON_SCALE, 1);
        }
        this.priceIcon.enabled = effectiveCanDevelop && !!this.priceIcon.spriteFrame;

        let text = '';
        if (state.neutralResourceId && !hideNeutralResourceLabel && !resourceFrame && !resourceUnits) {
            // 有图标走图标（chest / gold / mine）；`artifact_charge` 无美术图时走文字；
            // `unit_cap` 有骨骼（`resourceUnits`）⇒ 这里不会再落到中文「兵力」。
            text = NEUTRAL_RESOURCE_LABELS[state.neutralResourceId] ?? state.neutralResourceId;
        } else if (effectiveCanDevelop) text = String(state.developmentCost);
        else if (showBuilding && !buildingFrame) {
            // 没配外观图（旧存档 / 美术缺图）时才退「城/金/兵/塔」字 + 等级。
            const symbol = BUILDING_SYMBOLS[state.building];
            text = state.building === 'hq' ? symbol : `${symbol}\n${state.tier}`;
        }
        // 骨骼挂在 `buildingLayer` 之外（根下），关掉它不影响骨骼；骨骼模式下建筑/价格层
        // 不该继续亮着（那是「可开发」的语义，与本格无关）。
        this.buildingLayer.active = resourceUnits ? false
            : enemyCanDevelop || effectiveCanDevelop || text !== '' || resourceFrame !== null;
        this.iconLabel.enabled = text !== '';
        if (this.iconLabel.string !== text) this.iconLabel.string = text;
        this.iconLabel.color = this.contentTextColor(state, effectiveCanDevelop, affordable);
    }

    private contentTextColor(state: Readonly<ZCHexState>, canDevelop: boolean, affordable: boolean): Color {
        if (state.neutralResourceId) {
            return state.developmentResolved
                ? ZCHexView.RESOURCE_RESOLVED_COLOR
                : ZC_CLIENT_COLORS.muted;
        }
        return canDevelop && !affordable
            ? ZCHexView.INSUFFICIENT_GOLD_COLOR
            : ZC_CLIENT_COLORS.white;
    }

    /**
     * 兵力资源点：按配置站 N 个中立待机兵。返回是否真的显示了骨骼。
     * 详见 docs/ZCHexView设计决策.md §26。
     */
    private rebuildResourceUnitsIfNeeded(): boolean {
        // 骨骼数量与兵种都来自配置（`rewardCardId` / `rewardUnitCount`），由渲染层注入。
        const prefab = this.resourceUnitPrefab;
        const count = this.resourceUnitCount;
        if (!prefab || count <= 0) {
            // 没注入骨骼（配置缺 rewardCardId / prefab 未就位）⇒ 返回 false 让调用方退回文字，
            // 别出现「既没图也没字」的空格。
            this.hideResourceUnits();
            return false;
        }
        this.layoutResourceUnits(prefab, count);
        return true;
    }

    /** 收掉格内骨骼（已领取 / 不是兵力资源点时）。返回 false 便于在三元表达式里直接用。 */
    private hideResourceUnits(): false {
        for (const node of this.resourceUnitNodes) {
            if (node.isValid) node.active = false;
        }
        return false;
    }

    /** 换兵种时把旧节点全部销毁重建（骨架不同，靠改 scale 换不过来）。 */
    private rebuildResourceUnits(): void {
        for (const node of this.resourceUnitNodes) {
            if (node.isValid) node.destroy();
        }
        this.resourceUnitNodes.length = 0;
        this.resourceUnitCache = '';
    }

    /** 站好 N 个兵：数量不足就补、超出就隐藏（节点池只增不减）。 */
    private layoutResourceUnits(prefab: Prefab, count: number): void {
        const key = `${this.resourceUnitPrefabName}@${count}`;
        if (this.resourceUnitCache === key) {
            this.showResourceUnits(count);
            return;
        }
        this.rebuildResourceUnits();
        this.resourceUnitCache = key;
        for (let i = 0; i < count; i += 1) {
            const visual = instantiate(prefab);
            visual.name = `ResourceUnit_${i}`;
            visual.layer = this.node.layer;
            visual.active = true;
            this.node.addChild(visual);
            // 并排：整体以格心为原点向两侧展开，数量为奇数时正中那只不偏。
            const offsetX = (i - (count - 1) / 2) * ZCHexView.RESOURCE_UNIT_SPACING;
            visual.setPosition(offsetX, ZCHexView.RESOURCE_UNIT_POS_Y, 0);
            const skeleton = visual.getComponent(sp.Skeleton) ?? visual.getComponentInChildren(sp.Skeleton);
            // 序列帧形态没有骨架：用 prefab 自身尺寸按比例缩到目标高。
            const factor = skeleton
                ? ZCHexView.RESOURCE_UNIT_TARGET_HEIGHT / ZCHexView.spineResourceCanvasHeight(skeleton)
                : ZCHexView.RESOURCE_UNIT_TARGET_HEIGHT
                    / Math.max(1, visual.getComponent(UITransform)?.height ?? 1);
            const safe = Number.isFinite(factor) && factor > 0 ? factor : 1;
            visual.setScale(safe, safe, 1);
            this.playResourceUnitIdle(visual, skeleton);
            this.resourceUnitNodes.push(visual);
        }
    }

    private showResourceUnits(count: number): void {
        this.resourceUnitNodes.forEach((node, index) => {
            if (node.isValid) node.active = index < count;
        });
    }

    /** 播待机动作：spine 走 `setAnimation`，序列帧走 `Animation`；都没有就静默（不抛）。 */
    private playResourceUnitIdle(visual: Node, skeleton: sp.Skeleton | null): void {
        if (skeleton) {
            const names = (skeleton.skeletonData?.getRuntimeData(true)?.animations ?? []).map((a) => a.name);
            // 美术起名不统一（`idle` / `Idle` / `-idle` 都有），逐名探测而不是写死一个。
            const clip = names.find((n) => {
                const lower = n.toLowerCase();
                return lower === 'idle' || lower.endsWith('-idle');
            }) ?? names[0] ?? '';
            if (clip) skeleton.setAnimation(0, clip, true);
            return;
        }
        // ⚠️ 必须显式标成 `Animation | null`：`getComponentInChildren` 的返回类型是基类 `Component`，
        // 直接用会报 `.clips` / `.play` 不存在。
        const animation: Animation | null =
            visual.getComponent(Animation) ?? visual.getComponentInChildren(Animation);
        const clip = animation?.clips?.find((c) => (c?.name ?? '').toLowerCase().includes('idle'))
            ?? animation?.defaultClip ?? animation?.clips?.[0] ?? null;
        if (animation && clip) animation.play(clip.name);
    }

    /**
     * 已建建筑的图：废墟走外观图（`image/buildings/fx`，保持原色不叠阵营色）；
     * 其余优先用卡牌专属外观（`buildIcon`），主城 / 金矿回退 prefab 绑定的类型通用图。
     */
    private resolveBuildingFrame(
        state: Readonly<ZCHexState>,
        ruins: boolean,
        hasBuilding: boolean,
    ): SpriteFrame | null {
        if (ruins) return this.ruinsFrame;
        if (!hasBuilding) return null;
        return this.buildingFrameResolver?.(state.cardId, state.building, state.owner)
            ?? this.frameForBuildingType(state.building);
    }

    /** 建筑染色：废墟保持原色；敌方针红、多人席位按阵营色；我方纯白。 */
    private buildingTint(state: Readonly<ZCHexState>, ruins: boolean): Color {
        if (ruins) return Color.WHITE;
        if (state.owner === 'enemy') return ZCHexView.ENEMY_BUILDING_COLOR;
        if (state.owner === 'enemy2' || state.owner === 'enemy3') return zcFactionColor(state.owner);
        return Color.WHITE;
    }

    /**
     * 布局由 prefab 管理；只在资源变化时更新 SpriteFrame。
     *
     * `color.a === 0` 时**连 Sprite 一起停用**（"不画"与"画一张全透明"在 DC 上是两回事）：
     * 中立格走的就是这条 —— 见 `NEUTRAL_FILL_ALPHA`。
     */
    private setSprite(sprite: Sprite, frame: SpriteFrame | null, color: Color = Color.WHITE): void {
        if (sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        sprite.enabled = frame !== null && color.a > 0;
        sprite.color = color;
    }

    /**
     * 建筑类型的通用外观兜底（**只在注入的解析器给不出图时**才走）。
     *
     *  ⚠️ 这里**没有 `hq` 分支**：主城外观统一由 `buildingFrameResolver` 提供
     *  （`ZCGameRenderWorld.resolveBuildingFrame` → `hq-base`），选点阶段与正式对局同源。
     *  旧的两张通用图（我方 `icon_ymp` / 敌方 `icon_m`）已下线 ——
     *  它们只在选点阶段显示过（那条路径绕过了 resolver），正式对局从来没走到过。
     */
    private frameForBuildingType(type: ZCBuildingType): SpriteFrame | null {
        switch (type) {
            case 'mine': return this.mineFrame;
            default: return null;
        }
    }

    private frameForTileType(type: ZCHexState['tileType']): SpriteFrame | null {
        switch (type) {
            case ZCPvpTileType.Mine: return this.mineIconFrame;
            case ZCPvpTileType.BarracksCommon:
            case ZCPvpTileType.BarracksMedium:
            case ZCPvpTileType.BarracksAdvanced: return this.barracksIconFrame;
            case ZCPvpTileType.AllRandom: return this.mysteryFrame;
            default: return null;
        }
    }

    /**
     * 中立资源点 → 图标。未登记的 id（`unit_cap` / `artifact_charge`）返回 null，
     * 调用方会退回 `NEUTRAL_RESOURCE_LABELS` 文字兜底 —— 加新图标只需补一个 `@property` + 一个 `case`。
     */
    private frameForResource(id: string): SpriteFrame | null {
        switch (id) {
            case 'gold': return this.goldResourceFrame;
            case 'mine': return this.mineResourceFrame;
            case 'chest': return this.chestResourceFrame;
            // 神器充能：显示**玩家本局携带的那件神器**的图（渲染层注入），不是中文字。
            case 'artifact_charge': return this.artifactChargeFrame;
            default: return null;
        }
    }

    private renderCooldown(cooldown: Readonly<ZCBuildingCooldownState> | null): void {
        const bar = this.cooldownBar;
        bar.node.active = cooldown !== null;
        bar.progress = cooldown && Number.isFinite(cooldown.progress)
            ? Math.max(0, Math.min(1, cooldown.progress))
            : 0;
    }
}
