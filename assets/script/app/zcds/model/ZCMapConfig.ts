/** 地图 JSON 校验、分区 / 镜像配对与六边形棋盘构建；不依赖对局规则。 */
import { hexGridLogicalPoint } from '../../../core/hex/HexGridLayout';
import { isZCNeutralResourceId } from './ZCNeutralResourceReward';
import type { ZCNeutralResourceId } from './ZCNeutralResourceReward';

export const ZC_OWNER_ORDER = ['player', 'enemy', 'enemy2', 'enemy3'] as const;
export type ZCOwner = typeof ZC_OWNER_ORDER[number];
export type ZCFaction = ZCOwner | 'neutral';

/** 地图席位号（1~4）与运行时阵营 id 的唯一映射。 */
export function ownerForSection(section: number): ZCOwner | null {
    return section >= 1 && section <= ZC_OWNER_ORDER.length ? ZC_OWNER_ORDER[section - 1] : null;
}

/** 返回本局实际启用的席位；第 1 席固定为本机玩家，其余席位由本地 AI 驱动。 */
export function ownersForPlayerCount(playerCount: ZCPlayerCount): readonly ZCOwner[] {
    return ZC_OWNER_ORDER.slice(0, playerCount);
}

/**
 * 对局人数 = 地图在开局时划分出的分区数（每块归一名玩家，见《自选主城需求文档》3.5）。
 * 与敌我无关：谁是「我方」由玩家视角决定。缺省 2。
 */
export type ZCPlayerCount = 2 | 3 | 4;

/**
 * 主城模式：
 *   fixed  —— 地图内直接指定各方主城坐标，开局就位后进入对局；
 *   select —— 开局先进入选点阶段，由玩家在本方分区内自选，地图不产出主城坐标。
 * 缺省 fixed（与既有全部地图一致）。
 */
export type ZCCityMode = 'fixed' | 'select';

/**
 * 分区编号：0 = 不属于任何分区（可通行时即中立格）；1~4 = 第 N 分区。
 *
 * 编号按象限编码（0-based 的 bit0 = 上下、bit1 = 左右）：
 *   1 = 下左、2 = 上左、3 = 下右、4 = 上右。
 * 这个编码让「镜像后落到哪个分区」退化成一次异或，见 buildSectionMirrorTable。
 */
export type ZCSection = 0 | 1 | 2 | 3 | 4;

/**
 * 自选主城地图里「这一格属于哪个玩家的半区」的默认划分（《自选出生点-需求文档》3.2 / 4.1）。
 *
 * 分区只在**开局选点阶段**起作用 —— 它决定各玩家的出生点可选范围；正式玩法开始后这一概念
 * 不再存在（地盘由打下来的格决定，见 4.2）。口径与地图编辑器 `app.js` 的 `sectionAt()`
 * 完全一致（两处一起改，别只改一边）：
 *   2 / 4 人 —— 上下半场二分（上半场 = 2 区），4 人再按左右分开 3 / 4 区；
 *   3 人     —— 上带 1/3 归 2 区，其余按列平分给 1 区（左）/ 3 区（右）。
 *
 *  只在**地图自己没画分区**时用它兜底：`cityMode: 'select'` 的地图当前全是中立格
 * （编辑器切到自选主城会收回主城盘，不铺分区色），所以「我方半区」只能从布局推导。
 * 地图一旦像固定主城图那样画了 1~4 区，就以地图数据为准 —— 见
 * `ZCSpawnSelection.regionSectionOf`。
 */
export function defaultZCSectionAt(
    playerCount: ZCPlayerCount, rows: number, columns: number, row: number, column: number,
): ZCSection {
    if (playerCount === 3) {
        const band = Math.max(1, Math.round(rows / 3));
        return (row < band ? 2 : (column >= Math.ceil(columns / 2) ? 3 : 1)) as ZCSection;
    }
    const section = row < rows - Math.ceil(rows / 2) ? 2 : 1;
    return (playerCount === 4 && column >= Math.ceil(columns / 2) ? section + 2 : section) as ZCSection;
}

/** 分区内的纵深片（前 / 中 / 后）。 */
export type ZCDepth = 'front' | 'mid' | 'back';

/** 打法倾向；选点阶段以气泡展示给玩家。 */
export type ZCTendency = 'rush' | 'control' | 'develop';

export interface ZCMapHome {
    row: number;
    column: number;
}

/** 分区内按纵深划出的一片区域；未圈画时地图不产出 regions。 */
export interface ZCMapRegion {
    /** 所属分区（1 ~ playerCount）。 */
    section: number;
    depth: ZCDepth;
    /** 该片覆盖的格 id。 */
    cells: number[];
    /** 打法倾向；缺省按纵深取 ZC_DEPTH_TENDENCY。 */
    tendency?: ZCTendency;
    /** 气泡文案；缺省取 ZC_TENDENCY_TEXT。 */
    text?: string;
}

export interface ZCMapHomeCandidates {
    section: number;
    cells: number[];
}

/** 中立资源点位：开局据此抽取生成中立资源的固定格。 */
export interface ZCMapResourcePoint {
    row: number;
    column: number;
    /** 固定为 0；省略时由中立格归属推导。 */
    section?: number;
    /** 所在纵深片；缺省由 regions 反查。 */
    depth?: ZCDepth;
    /** 资源 id → 抽取权重；至少 1 项且至少 1 个非零。 */
    pool: Record<string, number>;
}

/** 选点结束时由点位资源池抽出的本局中立资源。 */
export interface ZCMapResolvedResource {
    hexId: number;
    section: number;
    depth?: ZCDepth;
    resourceId: ZCNeutralResourceId;
}

/** 可调间距参数（六边形最短路径，单位＝格）。 */
export interface ZCMapSpacing {
    /** R4：后确定方的主城与其他主城的最小格距；缺省 2。 */
    homeMinDistance?: number;
    /** 任意两个点位之间的最小格距；缺省 3，下限 3。 */
    resourceMinDistance?: number;
}

/** 不绑定六边格、只参与地图美术表现的自由装饰。坐标与尺寸使用棋盘局部视图单位。 */
export interface ZCMapFreeDecor {
    /** 编辑器内稳定标识；客户端不将它解释为玩法实体。 */
    id?: string | number;
    art: string;
    x: number;
    y: number;
    /** 贴图最大显示框；渲染时按资源原始宽高等比适配。 */
    width: number;
    height: number;
    rotation?: number;
    flipX?: boolean;
    flipY?: boolean;
    /** 编辑器状态，渲染不读取。 */
    locked?: boolean;
}

export interface ZCMapArt {
    /** 背景图资源名（衬在棋盘之下）；可留空。 */
    background?: string;
    /** 地块贴图。键为分区号 '1'~'4' / 'neutral' / 'void'，值为资源名。 */
    tiles?: Record<string, string>;
    /** 自由摆放的纯表现装饰；没有格占位，不受虚空约束。 */
    freeDecor?: ReadonlyArray<ZCMapFreeDecor>;
}

export interface ZCHexConfig {
    id: number;
    column: number;
    row: number;
    q: number;
    r: number;
    x: number;
    y: number;
    mirrorId: number;
    neighbors: number[];
    playable: boolean;
}

export interface ZCMapLayout {
    id: string;
    /**
     * v1: #/./-
     * v2: 增加 N（可通行、开局无主）
     * v3: 增加 0~4（分区归属），支持 playerCount / cityMode / homes / regions / resourcePoints / spacing / art
     * 省略时按 v1 处理。
     */
    version?: number;
    rows: number;
    columns: number;
    mirror180?: boolean;
    mirrorHorizontal?: boolean;
    mirrorVertical?: boolean;
    /**
     * 字符画。`.` = 虚空，数字 0~4 = 可通行格的分区归属（0 = 中立）。
     *
     * 开启镜像时只存「1 区所在的象限」，其余由镜像推导：
     *   仅 mirrorVertical  —— 存下半场（ceil(rows / 2) 行 × columns 列）
     *   仅 mirrorHorizontal —— 存左半场（rows 行 × ceil(columns / 2) 列）
     *   两者同时          —— 存左下 1/4（ceil(rows / 2) 行 × ceil(columns / 2) 列）
     *   mirror180         —— 沿用 v1/v2 口径：存上半场且行序反转
     * 全不开镜像时存全图。v1/v2 只支持行压缩（存下半场），列压缩自 v3 起生效。
     */
    ascii: string[];
    /** 对局人数（2/3/4），同时决定地图分区数；省略时按 2 处理。 */
    playerCount?: number;
    /** 主城模式；省略时按 'fixed' 处理。'select' 时不产出主城坐标。 */
    cityMode?: ZCCityMode;
    /** v1/v2：固定主城模式的两座主城（我方 / 敌方）。 */
    playerHome?: ZCMapHome;
    /** v1/v2：固定主城模式的两座主城（我方 / 敌方）。 */
    enemyHome?: ZCMapHome;
    /** v3：固定主城模式每方一座，下标 0 = 1 区；给出时优先于 playerHome / enemyHome。 */
    homes?: ZCMapHome[];
    /** v3：各分区的前 / 中 / 后区域；未圈画时省略。 */
    regions?: ZCMapRegion[];
    homeCandidates?: ZCMapHomeCandidates[];
    /** v3：中立格资源点位；无点位时省略。 */
    resourcePoints?: ZCMapResourcePoint[];
    /** v3：可调间距参数。 */
    spacing?: ZCMapSpacing;
    /** v3：美术配置。 */
    art?: ZCMapArt;
    /**
     * v3：局内镜头的**最小 / 最大倍率**（R22 相机：「每个地图配置对应的最大和最小倍率」）。
     *
     *  ⚠️ 这是**同一对**参数的两半，只配一半时另一半走默认值（不是「不生效」）——
     *  见 `resolveZCMapZoom`。缺省 `0.6 / 1.2`（旧工程 `NodeMoveScale` 的手感）。
     *  改字段要连 `tools/map-editor/app.js` 的 passthrough 白名单一起改，
     *  否则编辑器另存一次就把这两个键**静默丢掉**。
     */
    zoomMin?: number;
    zoomMax?: number;
}

/**
 * 这张地图能否进入「随机选图」池。
 *
 * 2 / 3 / 4 人固定主城与自选主城图均可参与随机；多人图使用独立席位并由本地 AI 驱动。
 *
 * 判定只此一处：`ZCGameLoader` 与 `ZCGame` 两条随机路径都调它，别在各自的
 * `loadRandomMap` 里再写一份人数与模式判断。未声明 playerCount 时仍按 2 人处理。
 */
export function getZCLocalPlayerCountOverride(): ZCPlayerCount | null {
    const runtime = globalThis as typeof globalThis & {
        __ZCDS_PLAYER_COUNT__?: unknown;
        localStorage?: { getItem(key: string): string | null };
    };
    let raw = runtime.__ZCDS_PLAYER_COUNT__;
    try {
        raw ??= runtime.localStorage?.getItem('zcds.playerCount');
    } catch {
        // 隐私模式 / 原生容器可能禁止访问 localStorage；无覆盖时继续走全人数随机。
    }
    const count = Number(raw);
    return count === 2 || count === 3 || count === 4 ? count : null;
}

export function isRandomMapCandidate(
    layout: { playerCount?: number; cityMode?: string } | null | undefined,
    requestedPlayerCount?: ZCPlayerCount | null,
): boolean {
    const count = layout?.playerCount ?? 2;
    return (count === 2 || count === 3 || count === 4)
        && (!requestedPlayerCount || count === requestedPlayerCount)
        && (layout?.cityMode === undefined || layout.cityMode === 'fixed' || layout.cityMode === 'select');
}

export const ZC_DEFAULT_HOME_MIN_DISTANCE = 2;
export const ZC_DEFAULT_RESOURCE_MIN_DISTANCE = 3;
/** 点位最小间距的下限：不足 3 格时两点位会存在共同相邻格。 */
export const ZC_RESOURCE_MIN_DISTANCE_FLOOR = 3;
/**
 * 地图没写 `zoomMin` / `zoomMax` 时的兜底倍率（R22 相机）。
 *
 *  取 `0.6 / 1.2` 是有意的：旧工程 `NodeMoveScale` 就是「最小 0.6、最大 1.2」的手感，
 *  老玩家对这个范围的肌肉记忆可以直接沿用；`1`（`ZC_MAP_PRESENTATION_SCALE`）是默认机位。
 */
export const ZC_MAP_ZOOM_MIN_DEFAULT = 0.6;
export const ZC_MAP_ZOOM_MAX_DEFAULT = 1.2;
/**
 * 倍率的**硬**边界：任何地图都不许配到范围外。
 *
 *  下界 `0.3`：再小就连整盘都糊成一片（且小于多数地图的全景倍率，没有意义）；
 *  上界 `1.5`：地块贴图按 1 倍出图，放到 1.5 已经能看出像素块。
 */
export const ZC_MAP_ZOOM_HARD_MIN = 0.3;
export const ZC_MAP_ZOOM_HARD_MAX = 1.5;

/** 一局地图的镜头倍率范围（已补默认值、已过校验）。 */
export interface IZCMapZoom {
    readonly min: number;
    readonly max: number;
}

/**
 * 解析地图声明的镜头倍率范围 —— **只此一处**，`configureZCMap` 与地图编辑器共用同一口径。
 *
 *  规则：缺省整个走默认；只配一半时另一半走默认（不是「不生效」）；
 *  越界（含 NaN / 非数字 / 上下限颠倒）**直接抛**，不静默夹取 ——
 *  静默夹取会让「地图配错了」表现成「缩放偶尔不动」，排查成本极高。
 */
export function resolveZCMapZoom(
    layout: { zoomMin?: unknown; zoomMax?: unknown } | null | undefined,
): IZCMapZoom {
    const pick = (value: unknown, fallback: number, label: string): number => {
        if (value === undefined || value === null) return fallback;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`地图镜头倍率 ${label} 必须是数字`);
        }
        if (value < ZC_MAP_ZOOM_HARD_MIN || value > ZC_MAP_ZOOM_HARD_MAX) {
            throw new Error(`地图镜头倍率 ${label} 必须在 ${ZC_MAP_ZOOM_HARD_MIN} ~ ${ZC_MAP_ZOOM_HARD_MAX} 之间`);
        }
        return value;
    };
    const min = pick(layout?.zoomMin, ZC_MAP_ZOOM_MIN_DEFAULT, 'zoomMin');
    const max = pick(layout?.zoomMax, ZC_MAP_ZOOM_MAX_DEFAULT, 'zoomMax');
    if (min > max) throw new Error(`地图镜头倍率下限（${min}）不能大于上限（${max}）`);
    return { min, max };
}

export const ZC_DEPTH_ORDER: readonly ZCDepth[] = ['front', 'mid', 'back'];
/** 纵深 → 默认打法倾向（前区速攻、中区控场、后区发育）。 */
export const ZC_DEPTH_TENDENCY: Readonly<Record<ZCDepth, ZCTendency>> = {
    front: 'rush', mid: 'control', back: 'develop',
};
export const ZC_TENDENCY_TEXT: Readonly<Record<ZCTendency, string>> = {
    rush: '速攻', control: '控场', develop: '发育',
};

// 棋盘状态只由本局载入的地图 JSON 设置。
export let ZC_MAP_COLUMNS = 0;
export let ZC_MAP_ROWS = 0;
export let ZC_INITIAL_TERRITORY = 0;
export let ZC_MAP_ID = '';
/** 每格的分区归属；0 = 不属于任何分区。 */
export let ZC_MAP_SECTIONS: readonly ZCSection[] = [];
/** 固定主城模式下各方主城格 id（下标 0 = 1 区）；自选主城模式为空数组。 */
export let ZC_MAP_HOMES: readonly number[] = [];
/** 各方前 / 中 / 后区域；未圈画时为空数组。 */
export let ZC_MAP_REGIONS: readonly ZCMapRegion[] = [];
export let ZC_MAP_HOME_CANDIDATES: readonly ZCMapHomeCandidates[] = [];
/** 资源点位；无点位时为空数组。 */
export let ZC_MAP_RESOURCE_POINTS: readonly ZCMapResourcePoint[] = [];
/** 可调间距参数（已补默认值）。 */
export let ZC_MAP_SPACING: Readonly<Required<ZCMapSpacing>> = {
    homeMinDistance: ZC_DEFAULT_HOME_MIN_DISTANCE,
    resourceMinDistance: ZC_DEFAULT_RESOURCE_MIN_DISTANCE,
};
/** 美术配置；未配置时为空对象。 */
export let ZC_MAP_ART: Readonly<ZCMapArt> = {};

let mapOwners: ZCFaction[] = [];
let mapSections: ZCSection[] = [];
/** 地形拓扑与阵营分离：虚空和中立格都无主，只有后者可通行。 */
let mapPlayable: boolean[] = [];

/**
 * 邻居方向（offset 坐标：dq = column、dr = row）。
 *
 * 竖直矩形摆法里奇偶列的垂直相位不同：奇列整体 +10.5、偶列 -10.5，两者相差正好
 * 半行（21）。于是"相邻列"的格子落在同 row 还是落在上下各半行处，取决于当前列的
 * 奇偶——必须按奇偶各用一套方向表，不能共用。
 */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [-1, 1],
];
/** 奇列（相位 +10.5）的邻居方向集。 */
const DIRECTIONS_ODD: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [1, -1], [1, 0], [0, 1], [-1, -1], [-1, 0],
];

/** 平顶六边形网格：offset 坐标即轴向坐标（q=column、r=row）。 */
function axialFromOffset(column: number, row: number): { q: number; r: number } {
    return { q: column, r: row };
}

/**
 * 地图分区 → 战斗阵营。战斗侧仍是两方：1 区＝本局玩家视角的己方，2~4 区＝敌方。
 * 分区（谁在哪一块地）与敌我（谁是队友）是两件事，地图层只负责前者。
 */
function factionOfSection(section: ZCSection): ZCFaction {
    if (section === 0) return 'neutral';
    return ownerForSection(section) ?? 'neutral';
}

/** 字符画 token → 可通行性 + 分区。`#` / `-` / `N` 是 v1/v2 的分区别名。 */
function parseSectionToken(token: string): { playable: boolean; section: ZCSection } {
    switch (token) {
        case '.': return { playable: false, section: 0 };
        case 'N': case '0': return { playable: true, section: 0 };
        case '#': case '1': return { playable: true, section: 1 };
        case '-': case '2': return { playable: true, section: 2 };
        case '3': return { playable: true, section: 3 };
        case '4': return { playable: true, section: 4 };
        default: throw new Error(`地图字符画出现非法字符：${token}`);
    }
}

/**
 * 分区镜像配对表：索引 = 分区号，值 = 镜像后的分区号（-1 = 本局无伙伴）。
 *
 * 2 人与 3 人只有上下镜像（3 人地图不做 120° 旋转对称，3 区由策划手动圈画、无伙伴）；
 * 4 人按实际开启的镜像位翻转象限，于是上下 → 1↔2 / 3↔4，左右 → 1↔3 / 2↔4，180° → 1↔4 / 2↔3。
 */
function buildSectionMirrorTable(
    playerCount: ZCPlayerCount, vertical: boolean, horizontal: boolean, rotate180: boolean,
): number[] {
    if (playerCount === 2) return [0, 2, 1];
    if (playerCount === 3) return [0, 2, 1, -1];
    const mask = (vertical || rotate180 ? 1 : 0) | (horizontal || rotate180 ? 2 : 0);
    const table = [0];
    for (let section = 1; section <= 4; section += 1) table.push(((section - 1) ^ mask) + 1);
    return table;
}

function createHexConfig(): ZCHexConfig[] {
    const byAxial = new Map<string, number>();
    const configs: ZCHexConfig[] = [];
    for (let row = 0; row < ZC_MAP_ROWS; row += 1) {
        for (let column = 0; column < ZC_MAP_COLUMNS; column += 1) {
            const id = row * ZC_MAP_COLUMNS + column;
            const { q, r } = axialFromOffset(column, row);
            const point = hexGridLogicalPoint(row, column, ZC_MAP_ROWS, ZC_MAP_COLUMNS);
            byAxial.set(`${q},${r}`, id);
            configs.push({
                id, column, row, q, r,
                // 旧快照保存连续逻辑坐标，沿用取整口径；视图在布局入口补偿固定原点偏移。
                x: Math.round(point.x),
                y: Math.round(point.y),
                mirrorId: (ZC_MAP_ROWS - 1 - row) * ZC_MAP_COLUMNS + (ZC_MAP_COLUMNS - 1 - column),
                neighbors: [],
                playable: mapPlayable[id] === true,
            });
        }
    }
    for (const config of configs) {
        const dirs = (config.column & 1) ? DIRECTIONS_ODD : DIRECTIONS;
        config.neighbors = config.playable ? dirs
            .map(([dq, dr]) => byAxial.get(`${config.q + dq},${config.r + dr}`))
            .filter((id): id is number => id !== undefined && mapPlayable[id]) : [];
    }
    return configs;
}

export let ZC_HEX_CONFIG: readonly ZCHexConfig[] = [];
export let ZC_PLAYER_HOME_ID = -1;
export let ZC_ENEMY_HOME_ID = -1;
/** 本局地图声明的对局人数（分区数）；缺省 2。 */
export let ZC_MAP_PLAYER_COUNT: ZCPlayerCount = 2;
/** 本局地图的主城模式；缺省 'fixed'。 */
export let ZC_MAP_CITY_MODE: ZCCityMode = 'fixed';
/** 本局地图的镜头倍率范围（R22 相机）；缺省 `0.6 / 1.2`。 */
export let ZC_MAP_ZOOM_MIN = ZC_MAP_ZOOM_MIN_DEFAULT;
export let ZC_MAP_ZOOM_MAX = ZC_MAP_ZOOM_MAX_DEFAULT;

/** 载入编辑器地图；格子 id 仍按 row * columns + column，虚空保留 id 但不可通行。 */
export function configureZCMap(layout: ZCMapLayout): void {
    const rows = layout?.rows;
    const columns = layout?.columns;
    const version = layout?.version ?? 1;
    if (!Number.isInteger(version) || version < 1 || version > 3) throw new Error('地图版本只支持 1、2 或 3');
    // v1/v2 的镜像语义是「存一半」，要求偶数行；v3 起允许奇数行，中线行镜像到自身。
    const requireEvenRows = version <= 2;
    const maxColumns = version >= 3 ? 60 : 30;
    if (!Number.isInteger(rows) || rows < 4 || rows > 60 || (requireEvenRows && rows % 2)
        || !Number.isInteger(columns) || columns < 4 || columns > maxColumns) {
        throw new Error(version >= 3
            ? '地图尺寸必须为 4~60 列、4~60 行'
            : '地图尺寸必须为 4~30 列、4~60 偶数行');
    }
    const playerCount = layout.playerCount ?? 2;
    if (playerCount !== 2 && playerCount !== 3 && playerCount !== 4) {
        throw new Error('地图对局人数必须是 2、3 或 4');
    }
    const cityMode: ZCCityMode = layout.cityMode ?? 'fixed';
    if (cityMode !== 'fixed' && cityMode !== 'select') {
        throw new Error('地图主城模式必须是 fixed（固定主城）或 select（自选主城）');
    }
    // 镜头倍率范围：越界 / 非数字 / 上下限颠倒都在这里抛（口径见 resolveZCMapZoom）。
    const zoom = resolveZCMapZoom(layout);
    /** 自选主城模式不产出主城坐标：主城由选点结果决定。 */
    const hasHome = cityMode === 'fixed';
    const mirror180 = layout.mirror180 === true;
    const mirrorVertical = layout.mirrorVertical === true;
    const mirrorHorizontal = layout.mirrorHorizontal === true;
    if (mirror180 && (mirrorVertical || mirrorHorizontal)) {
        throw new Error('地图不能同时使用 180° 旋转镜像与上下 / 左右镜像');
    }
    if (mirror180 && (columns % 2 || rows % 2)) throw new Error('180° 旋转镜像要求偶数行与偶数列');

    /** 字符画行数：镜像时只存 1 区那一侧的半场。 */
    const storedRows = mirror180 ? rows / 2 : mirrorVertical ? Math.ceil(rows / 2) : rows;
    /** 镜像侧的行数（= 下半场起点）。不开行镜像时为 0。 */
    const topRows = rows - storedRows;
    /** 列压缩自 v3 起生效：镜像时只存左半场。 */
    const halfColumns = mirrorHorizontal && version >= 3 ? Math.ceil(columns / 2) : columns;

    const invalidToken = version <= 1 ? /[^.#-]/ : version === 2 ? /[^.#N-]/ : /[^.#N01234-]/;
    const allowedTokens = version <= 1 ? '.#-' : version === 2 ? '.#N-' : '.01234（#/-/N 为别名）';
    if (!Array.isArray(layout.ascii) || layout.ascii.length !== storedRows
        || layout.ascii.some((line) => typeof line !== 'string' || line.length !== halfColumns || invalidToken.test(line))) {
        throw new Error(`地图字符画必须有 ${storedRows} 行，每行 ${halfColumns} 个 ${allowedTokens} 字符`);
    }
    // v1/v2 的上下镜像只存我方半场，{敌方 token 不该出现} 是格式约束而非玩法约束。
    if (version <= 2 && mirrorVertical && layout.ascii.some((line) => line.includes('-'))) {
        throw new Error(`上下镜像地图的我方字符画只能包含 ${version >= 2 ? '#、N 和 .' : '# 和 .'}`);
    }

    const sectionMirrorTable = buildSectionMirrorTable(playerCount, mirrorVertical, mirrorHorizontal, mirror180);
    /** 镜像后落到哪个分区；无伙伴（-1）说明该分区不能被镜像生成。 */
    const mirrorSection = (section: ZCSection): number => sectionMirrorTable[section];

    const playable: boolean[] = [];
    const sections: ZCSection[] = [];
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            let sourceRow: number;
            let sourceColumn: number;
            /**
             * 该格相对「存储侧」翻掉了几位：bit0 = 上下、bit1 = 左右。
             * 必须逐格算，不能取全局开关——四象限只存 1/4 时，上半场左半场那格
             * 只翻了上下一位（1→2 区），只有同时翻上下与左右才是对角（1→4 区）。
             */
            let flip: number;
            if (mirror180) {
                // v1/v2 口径：字符画存上半场原样，下半场由 180° 旋转推出。
                const lower = row >= rows / 2;
                sourceRow = lower ? rows - 1 - row : row;
                sourceColumn = lower ? columns - 1 - column : column;
                flip = lower ? 3 : 0;
            } else {
                const rowMirrored = mirrorVertical && row < topRows;
                sourceRow = rowMirrored ? rows - 1 - row - topRows : row - topRows;
                const columnMirrored = mirrorHorizontal && version >= 3 && column >= halfColumns;
                sourceColumn = columnMirrored ? columns - 1 - column : column;
                flip = (rowMirrored ? 1 : 0) | (columnMirrored ? 2 : 0);
            }
            const raw = parseSectionToken(layout.ascii[sourceRow][sourceColumn]);
            // 2 / 3 人只有上下是分区维度（3 人地图不做旋转对称），列位只影响几何。
            const effectiveFlip = playerCount <= 3 ? (flip & 1) : flip;
            const section = raw.section > 0 && effectiveFlip
                ? (((raw.section - 1) ^ effectiveFlip) + 1) as ZCSection
                : raw.section;
            if (section > playerCount) {
                throw new Error(`${playerCount} 人镜像地图里 ${raw.section} 区没有镜像伙伴，不能只画在一侧`);
            }
            playable.push(raw.playable);
            sections.push(section);
        }
    }
    if (sections.some((section) => section > playerCount)) {
        throw new Error(`地图出现了超出对局人数的分区：本图只允许 1~${playerCount} 区`);
    }
    if (layout.mirrorHorizontal === true && version <= 2) {
        for (let row = 0; row < rows; row += 1) {
            for (let column = 0; column < columns; column += 1) {
                const id = row * columns + column;
                const mirrorId = row * columns + columns - 1 - column;
                if (sections[id] !== sections[mirrorId] || playable[id] !== playable[mirrorId]) {
                    throw new Error('左右镜像地图同一行的格子必须一致');
                }
            }
        }
    }

    const owners: ZCFaction[] = sections.map(factionOfSection);
    const homeId = (home: ZCMapHome | undefined, section: ZCSection): number => {
        if (!home || !Number.isInteger(home.row) || !Number.isInteger(home.column)
            || home.row < 0 || home.row >= rows || home.column < 0 || home.column >= columns) {
            throw new Error('主城坐标不在地图内');
        }
        const id = home.row * columns + home.column;
        if (!playable[id]) throw new Error('主城不能落在虚空上');
        if (section !== 0 && sections[id] !== section) throw new Error('主城必须位于本方地块');
        return id;
    };
    /** 分区所在侧：bit0 = 0 在下半场、1 在上半场（中线行归下半场）。 */
    const lowerStartRow = Math.floor(rows / 2);
    const homes: number[] = [];
    // select 模式的 homes 是可选默认主城（含 null 占位）；坐标合法即可，不要求落在分区格 / 中线己方一侧。
    if (cityMode === 'select') {
        const list = Array.isArray(layout.homes) ? layout.homes : [];
        if (list.length !== 0 && list.length !== playerCount) {
            throw new Error(`自选主城模式的默认主城应为 ${playerCount} 座（或留空）`);
        }
        for (let index = 0; index < list.length; index += 1) {
            const home = list[index];
            if (home === null || home === undefined) { homes.push(-1); continue; }
            const id = homeId(home, 0);
            homes.push(id);
        }
    }
    if (hasHome) {
        const list = Array.isArray(layout.homes) && layout.homes.length
            ? layout.homes
            : (layout.playerHome && layout.enemyHome ? [layout.playerHome, layout.enemyHome] : null);
        if (!list) throw new Error('固定主城模式必须给出各方主城坐标');
        if (list.length !== playerCount) {
            throw new Error(`固定主城模式每方恰好一座主城，本图应为 ${playerCount} 座`);
        }
        for (let index = 0; index < list.length; index += 1) {
            const section = (index + 1) as ZCSection;
            const id = homeId(list[index], section);
            const upperSide = ((section - 1) & 1) === 1;
            const onOwnSide = upperSide ? list[index].row < lowerStartRow : list[index].row >= lowerStartRow;
            if (!onOwnSide) throw new Error(`第 ${section} 区的主城必须位于地图中线己方一侧`);
            homes.push(id);
        }
    }

    const neighborsOf = (id: number): number[] => {
        const column = id % columns;
        const row = Math.floor(id / columns);
        const dirs = column & 1 ? DIRECTIONS_ODD : DIRECTIONS;
        return dirs.flatMap(([dc, dr]) => {
            const nc = column + dc;
            const nr = row + dr;
            const next = nr * columns + nc;
            return nc >= 0 && nc < columns && nr >= 0 && nr < rows && playable[next] ? [next] : [];
        });
    };
    /** 六边形最短路径步数；不可达返回 -1。 */
    const hexDistance = (startId: number, targetId: number): number => {
        if (startId === targetId) return 0;
        const seen = new Set<number>([startId]);
        const queue = [{ id: startId, distance: 0 }];
        for (let head = 0; head < queue.length; head += 1) {
            const cell = queue[head];
            for (const next of neighborsOf(cell.id)) {
                if (seen.has(next)) continue;
                if (next === targetId) return cell.distance + 1;
                seen.add(next);
                queue.push({ id: next, distance: cell.distance + 1 });
            }
        }
        return -1;
    };

    // ---- 间距参数（《地图编辑器需求文档》5.5）------------------------------------
    const homeMinDistance = layout.spacing?.homeMinDistance ?? ZC_DEFAULT_HOME_MIN_DISTANCE;
    const resourceMinDistance = layout.spacing?.resourceMinDistance ?? ZC_DEFAULT_RESOURCE_MIN_DISTANCE;
    if (!Number.isInteger(homeMinDistance) || homeMinDistance < 0) {
        throw new Error('主城最小间距必须是非负整数');
    }
    if (!Number.isInteger(resourceMinDistance) || resourceMinDistance < ZC_RESOURCE_MIN_DISTANCE_FLOOR) {
        throw new Error(`资源点位最小间距必须是不小于 ${ZC_RESOURCE_MIN_DISTANCE_FLOOR} 的整数`);
    }

    // ---- 区域（5.4）------------------------------------------------------------
    const regions: ZCMapRegion[] = [];
    const regionDepthByCell = new Map<number, ZCDepth>();
    if (layout.regions !== undefined) {
        if (!Array.isArray(layout.regions)) throw new Error('区域配置必须是数组');
        for (const region of layout.regions) {
            if (!region || !Number.isInteger(region.section) || region.section < 1 || region.section > playerCount) {
                throw new Error(`区域必须属于 1~${playerCount} 区`);
            }
            if (ZC_DEPTH_ORDER.indexOf(region.depth) < 0) throw new Error('区域纵深必须是 front / mid / back');
            if (!Array.isArray(region.cells) || !region.cells.length) throw new Error('区域至少要圈进一格');
            if (region.tendency !== undefined && !(region.tendency in ZC_TENDENCY_TEXT)) {
                throw new Error('打法倾向必须是 rush / control / develop');
            }
            const cells: number[] = [];
            for (const cell of region.cells) {
                if (!Number.isInteger(cell) || cell < 0 || cell >= rows * columns) throw new Error('区域包含地图外的格');
                if (!playable[cell]) throw new Error('区域不能圈进虚空');
                // select 模式地图全是中立格，区域只作为位置标注（前/中/后区提示），
                // 不校验分区归属；fixed 模式区域必须位于声明的分区。
                if (cityMode !== 'select' && sections[cell] !== region.section) {
                    throw new Error(`第 ${region.section} 区的区域不能圈进别的分区`);
                }
                const owner = regionDepthByCell.get(cell);
                if (owner !== undefined) throw new Error('同一分区内的前 / 中 / 后区域不能重叠');
                regionDepthByCell.set(cell, region.depth);
                cells.push(cell);
            }
            regions.push({
                section: region.section,
                depth: region.depth,
                cells,
                tendency: region.tendency ?? ZC_DEPTH_TENDENCY[region.depth],
                text: typeof region.text === 'string' ? region.text : ZC_TENDENCY_TEXT[region.tendency ?? ZC_DEPTH_TENDENCY[region.depth]],
            });
        }
    }

    // ---- 资源点位（5.3 / 7.1）--------------------------------------------------
    const homeCandidates: ZCMapHomeCandidates[] = [];
    if (layout.homeCandidates !== undefined) {
        if (!Array.isArray(layout.homeCandidates)) throw new Error('主城可选格配置必须是数组');
        const configuredSections = new Set<number>();
        for (const entry of layout.homeCandidates) {
            if (!entry || !Number.isInteger(entry.section) || entry.section < 1 || entry.section > playerCount) {
                throw new Error(`主城候选范围必须属于 1~${playerCount} 区`);
            }
            if (configuredSections.has(entry.section)) throw new Error(`第 ${entry.section} 区主城候选范围重复`);
            if (!Array.isArray(entry.cells) || !entry.cells.length) throw new Error('主城候选范围至少要包含一格');
            configuredSections.add(entry.section);
            const seen = new Set<number>();
            const cells = entry.cells.map((cell) => {
                if (!Number.isInteger(cell) || cell < 0 || cell >= rows * columns) throw new Error('主城候选范围包含地图外的格');
                if (!playable[cell]) throw new Error('主城候选范围不能包含虚空格');
                if (cityMode !== 'select' && sections[cell] !== entry.section) {
                    throw new Error(`第 ${entry.section} 区主城候选范围不能包含别区格`);
                }
                if (seen.has(cell)) throw new Error('主城候选范围不能重复包含同一格');
                seen.add(cell);
                return cell;
            });
            homeCandidates.push({ section: entry.section, cells });
        }
    }

    const resourcePoints: ZCMapResourcePoint[] = [];
    if (layout.resourcePoints !== undefined) {
        if (!Array.isArray(layout.resourcePoints)) throw new Error('资源点位必须是数组');
        const occupied = new Map<number, number>();
        for (const point of layout.resourcePoints) {
            if (!point || !Number.isInteger(point.row) || !Number.isInteger(point.column)
                || point.row < 0 || point.row >= rows || point.column < 0 || point.column >= columns) {
                throw new Error('资源点位的坐标不在地图内');
            }
            const id = point.row * columns + point.column;
            if (!playable[id]) throw new Error('资源点位不能落在虚空上');
            if (sections[id] !== 0) throw new Error('资源点位只能落在中立格上');
            if (point.section !== undefined && point.section !== 0) throw new Error('中立资源点的分区必须为 0');
            if (homes.indexOf(id) >= 0) throw new Error('资源点位不能落在主城上');
            if (occupied.has(id)) throw new Error('资源点位不能重复');
            if (!point.pool || typeof point.pool !== 'object' || Array.isArray(point.pool)) {
                throw new Error('资源点位必须配置资源池');
            }
            const pool: Record<string, number> = {};
            let total = 0;
            for (const [resource, weight] of Object.entries(point.pool)) {
                if (!isZCNeutralResourceId(resource)) throw new Error(`资源池包含未知资源 id：${resource}`);
                if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
                    throw new Error('资源权重必须是非负数');
                }
                pool[resource] = weight;
                total += weight;
            }
            if (!Object.keys(pool).length || total <= 0) throw new Error('资源池至少要有一项非零权重');
            occupied.set(id, resourcePoints.length);
            resourcePoints.push({
                row: point.row,
                column: point.column,
                section: 0,
                depth: point.depth ?? regionDepthByCell.get(id),
                pool,
            });
        }
        for (let i = 0; i < resourcePoints.length; i += 1) {
            for (let j = i + 1; j < resourcePoints.length; j += 1) {
                const from = resourcePoints[i].row * columns + resourcePoints[i].column;
                const to = resourcePoints[j].row * columns + resourcePoints[j].column;
                const distance = hexDistance(from, to);
                if (distance < 0) throw new Error('资源点位之间必须可达');
                if (distance < resourceMinDistance) {
                    throw new Error(`资源点位间距必须不小于 ${resourceMinDistance} 格`);
                }
            }
        }
    }

    // ---- 美术（3.9）------------------------------------------------------------
    const art: ZCMapArt = {};
    if (layout.art !== undefined) {
        if (!layout.art || typeof layout.art !== 'object' || Array.isArray(layout.art)) {
            throw new Error('美术配置必须是对象');
        }
        if (layout.art.background !== undefined) {
            if (typeof layout.art.background !== 'string') throw new Error('背景图必须是资源名');
            art.background = layout.art.background;
        }
        if (layout.art.tiles !== undefined) {
            if (!layout.art.tiles || typeof layout.art.tiles !== 'object' || Array.isArray(layout.art.tiles)) {
                throw new Error('地块贴图必须是 { 键: 资源名 } 对象');
            }
            const tiles: Record<string, string> = {};
            for (const [key, value] of Object.entries(layout.art.tiles)) {
                if (/^\d+,\d+$/.test(key)) continue;
                if (typeof value !== 'string') throw new Error(`地块贴图 ${key} 必须是资源名`);
                tiles[key] = value;
            }
            art.tiles = tiles;
        }
        if (layout.art.freeDecor !== undefined) {
            if (!Array.isArray(layout.art.freeDecor)) throw new Error('自由装饰必须是数组');
            const items: ZCMapFreeDecor[] = [];
            for (let index = 0; index < layout.art.freeDecor.length; index += 1) {
                const value = layout.art.freeDecor[index];
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                    throw new Error(`自由装饰 ${index} 必须是对象`);
                }
                const item = value as ZCMapFreeDecor;
                if (typeof item.art !== 'string' || !item.art.trim()) throw new Error(`自由装饰 ${index} 缺少资源名`);
                if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) throw new Error(`自由装饰 ${index} 坐标无效`);
                if (!Number.isFinite(item.width) || item.width <= 0 ||
                    !Number.isFinite(item.height) || item.height <= 0) {
                    throw new Error(`自由装饰 ${index} 尺寸无效`);
                }
                if (item.rotation !== undefined && !Number.isFinite(item.rotation)) {
                    throw new Error(`自由装饰 ${index} 角度无效`);
                }
                if (item.id !== undefined && (
                    (typeof item.id === 'string' && !item.id.trim()) ||
                    (typeof item.id === 'number' && !Number.isFinite(item.id)) ||
                    (typeof item.id !== 'string' && typeof item.id !== 'number')
                )) throw new Error(`自由装饰 ${index} id 无效`);
                if ((item.flipX !== undefined && typeof item.flipX !== 'boolean') ||
                    (item.flipY !== undefined && typeof item.flipY !== 'boolean')) {
                    throw new Error(`自由装饰 ${index} 翻转值无效`);
                }
                items.push({
                    ...(item.id !== undefined ? { id: item.id } : {}),
                    art: item.art.trim(), x: item.x, y: item.y,
                    width: item.width, height: item.height,
                    ...(item.rotation !== undefined ? { rotation: item.rotation } : {}),
                    ...(item.flipX !== undefined ? { flipX: item.flipX } : {}),
                    ...(item.flipY !== undefined ? { flipY: item.flipY } : {}),
                });
            }
            art.freeDecor = items;
        }
    }

    // ---- 分区非空（7.1 可选格）-------------------------------------------------
    // select 模式地图全是中立格（玩家可在任意格建主城），不存在固定分区，跳过。
    if (cityMode !== 'select') {
        for (let section = 1; section <= playerCount; section += 1) {
            const count = sections.reduce<number>((total, value, id) => (
                value === section && playable[id] ? total + 1 : total
            ), 0);
            if (!count) throw new Error(`第 ${section} 区至少要有 1 个可通行格`);
        }
    }

    // ---- 连通性（7.1）----------------------------------------------------------
    // 固定主城模式以 1 区主城为起点；自选主城模式此时主城尚未产生，取任意可通行格即可。
    const connectivityStartId = hasHome ? homes[0] : playable.indexOf(true);
    if (connectivityStartId < 0) throw new Error('地图至少需要一个可通行格');
    const visited = new Set<number>([connectivityStartId]);
    const queue = [connectivityStartId];
    for (let head = 0; head < queue.length; head += 1) {
        for (const next of neighborsOf(queue[head])) {
            if (visited.has(next)) continue;
            visited.add(next);
            queue.push(next);
        }
    }
    const playableCount = playable.filter(Boolean).length;
    if (visited.size !== playableCount) throw new Error('地图可用格必须全部连通');

    const playerIds = owners.flatMap((owner, id) => owner === 'player' ? [id] : []);
    const enemyIds = owners.flatMap((owner, id) => owner === 'enemy' ? [id] : []);

    const mirrorIds = Array.from({ length: owners.length }, (_, id) => id);
    const mirrorCellId = (row: number, column: number): number => {
        const mirrorRow = mirrorVertical || mirror180 ? rows - 1 - row : row;
        const mirrorColumn = mirrorHorizontal || mirror180 ? columns - 1 - column : column;
        return mirrorRow * columns + mirrorColumn;
    };
    if (version <= 2 && playerCount === 2) {
        // ---- v1/v2 两方图：沿用主城锚点配对 + 更严的对称校验，存量地图行为不变 ----
        if (!playerIds.length || playerIds.length !== enemyIds.length) throw new Error('地图双方可用格数必须相等');
        const playerHomeId = hasHome ? homeId(layout.playerHome, 1) : -1;
        const enemyHomeId = hasHome ? homeId(layout.enemyHome, 2) : -1;
        const freeEnemy = new Set(enemyIds);
        const freePlayer = new Set(playerIds);
        const pair = (enemy: number, player: number): void => {
            if (!freeEnemy.has(enemy) || !freePlayer.has(player)) return;
            mirrorIds[enemy] = player;
            mirrorIds[player] = enemy;
            freeEnemy.delete(enemy);
            freePlayer.delete(player);
        };
        if (mirror180) {
            for (const enemy of enemyIds) {
                const row = Math.floor(enemy / columns);
                const column = enemy % columns;
                const candidate = (rows - 1 - row) * columns + columns - 1 - column;
                if (!freePlayer.has(candidate)) throw new Error('180° 镜像地图的阵营或水域不对称');
                pair(enemy, candidate);
            }
            if (hasHome && mirrorIds[enemyHomeId] !== playerHomeId) throw new Error('双方主城必须互为 180° 镜像');
        } else if (hasHome) {
            pair(enemyHomeId, playerHomeId);
            const enemyNeighbors = neighborsOf(enemyHomeId).filter((id) => owners[id] === 'enemy').sort((a, b) => a % columns - b % columns);
            const playerNeighbors = neighborsOf(playerHomeId).filter((id) => owners[id] === 'player').sort((a, b) => a % columns - b % columns);
            if (enemyNeighbors.length !== playerNeighbors.length) throw new Error('双方主城的相邻地块数必须相同');
            for (let index = 0; index < enemyNeighbors.length; index += 1) pair(enemyNeighbors[index], playerNeighbors[index]);
            // `freeEnemy` / `freePlayer` 是 Set：release 构建会把 `[...set]` 降级成
            // `[].concat(set)`，而 concat 不展开迭代器 → 直接拿到 Set 对象本身。
            // 统一走 `Array.from`。
            for (const enemy of Array.from(freeEnemy)) {
                const row = Math.floor(enemy / columns);
                const column = enemy % columns;
                const candidate = (rows - 1 - row) * columns + column;
                if (freePlayer.has(candidate)) pair(enemy, candidate);
            }
        } else {
            // 自选主城模式没有主城做锚点：直接按上下几何镜像配对。
            for (const enemy of Array.from(freeEnemy)) {
                const row = Math.floor(enemy / columns);
                const column = enemy % columns;
                const candidate = (rows - 1 - row) * columns + column;
                if (freePlayer.has(candidate)) pair(enemy, candidate);
            }
        }
        const remainingEnemy = Array.from(freeEnemy);
        const remainingPlayer = Array.from(freePlayer).reverse();
        for (let index = 0; index < remainingEnemy.length; index += 1) pair(remainingEnemy[index], remainingPlayer[index]);
        // 无主可用格也要成对，保证双方看到相同的随机地块类型；虚空无需参与地块生成。
        if (mirror180 || mirrorVertical) {
            for (let id = 0; id < owners.length; id += 1) {
                if (!playable[id] || owners[id] !== 'neutral') continue;
                const row = Math.floor(id / columns);
                const column = id % columns;
                const candidate = (rows - 1 - row) * columns + (mirror180 ? columns - 1 - column : column);
                if (!playable[candidate] || owners[candidate] !== 'neutral') {
                    throw new Error('镜像地图的中立格必须互为镜像');
                }
                mirrorIds[id] = candidate;
            }
        }
        ZC_PLAYER_HOME_ID = hasHome ? homeId(layout.playerHome, 1) : -1;
        ZC_ENEMY_HOME_ID = hasHome ? homeId(layout.enemyHome, 2) : -1;
    } else {
        // ---- v3 / 多人图：几何镜像 + 分区配对 ------------------------------------
        for (let id = 0; id < owners.length; id += 1) {
            const row = Math.floor(id / columns);
            const column = id % columns;
            const target = mirrorCellId(row, column);
            mirrorIds[id] = target;
            if (playable[target] !== playable[id]) throw new Error('镜像地图的水域必须对称');
            if (target === id || !playable[id]) continue;
            const partner = mirrorSection(sections[id]);
            if (partner >= 0 && sections[target] !== partner) {
                throw new Error('镜像地图的分区归属必须按镜像关系成对');
            }
        }
        ZC_PLAYER_HOME_ID = hasHome ? homes[0] : -1;
        ZC_ENEMY_HOME_ID = hasHome && homes.length > 1 ? homes[1] : -1;
    }

    mapOwners = owners;
    mapSections = sections;
    mapPlayable = playable;
    ZC_MAP_ROWS = rows;
    ZC_MAP_COLUMNS = columns;
    ZC_INITIAL_TERRITORY = playerIds.length;
    ZC_MAP_ID = typeof layout.id === 'string' && layout.id ? layout.id : 'custom';
    ZC_MAP_PLAYER_COUNT = playerCount;
    ZC_MAP_CITY_MODE = cityMode;
    ZC_MAP_ZOOM_MIN = zoom.min;
    ZC_MAP_ZOOM_MAX = zoom.max;
    ZC_MAP_SECTIONS = sections;
    ZC_MAP_HOMES = homes;
    ZC_MAP_REGIONS = regions;
    ZC_MAP_HOME_CANDIDATES = homeCandidates;
    ZC_MAP_RESOURCE_POINTS = resourcePoints;
    ZC_MAP_SPACING = { homeMinDistance, resourceMinDistance };
    ZC_MAP_ART = art;
    const configs = createHexConfig();
    for (const config of configs) config.mirrorId = mirrorIds[config.id];
    ZC_HEX_CONFIG = configs;
}

export function getZCMapOwner(id: number): ZCFaction {
    return mapOwners[id];
}

/** 该格的分区归属；0 = 不属于任何分区。 */
export function getZCMapSection(id: number): ZCSection {
    return mapSections[id];
}
