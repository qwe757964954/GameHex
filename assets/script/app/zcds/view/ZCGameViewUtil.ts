import { Graphics, ProgressBar, SpriteFrame } from 'cc';
import {
    HEX_GRID_CONTENT_LIFT,
    HEX_GRID_FACE_HEIGHT,
    HEX_GRID_FACE_WIDTH,
    HEX_GRID_IMAGE_HEIGHT,
    HEX_GRID_IMAGE_WIDTH,
    HEX_GRID_LOGICAL_COLUMN_STEP,
    HEX_GRID_LOGICAL_ROW_STEP,
    HEX_GRID_VIEW_COLUMN_SPACING,
    HEX_GRID_VIEW_ROW_SPACING,
} from '../../../core/hex/HexGridLayout';
import type { ZCFaction, ZCOwner } from '../model/ZCMapConfig';

export const ZC_MAP_PRESENTATION_SCALE = 1;

/** Grid spacing derived from the 123×90 hex face: columns 92.25px, rows 90px. */
export const ZC_HEX_COLUMN_SPACING = HEX_GRID_VIEW_COLUMN_SPACING;
export const ZC_HEX_ROW_SPACING = HEX_GRID_VIEW_ROW_SPACING;
/** Camera bounds use the full tile image, including its transparent padding. */
export const ZC_HEX_VIEW_WIDTH = HEX_GRID_IMAGE_WIDTH;
export const ZC_HEX_VIEW_HEIGHT = HEX_GRID_IMAGE_HEIGHT;
/** Measured face bounds relative to the image center; regenerate these anchors when tile art changes. */
export const ZC_LAND_TOP_HALF_WIDTH = HEX_GRID_FACE_WIDTH / 2;
// 半高 45（格面 y[2..91] 共 90px，中心 46.5 ⇒ 上下各 44.5…45，按整除取 45 让
// 格面尺寸 = 123×90 与 anchors.mjs 的 bbox 完全一致）。
export const ZC_LAND_TOP_HALF_HEIGHT = HEX_GRID_FACE_HEIGHT / 2;
export const ZC_LAND_TOP_CENTER_LIFT = HEX_GRID_CONTENT_LIFT;
/** ZCMapConfig.createHexConfig 的逻辑间距换算。 */
export const ZC_MAP_SCALE_X = ZC_HEX_COLUMN_SPACING / HEX_GRID_LOGICAL_COLUMN_STEP;
export const ZC_MAP_SCALE_Y = ZC_HEX_ROW_SPACING / HEX_GRID_LOGICAL_ROW_STEP;

export function mapToViewX(x: number): number { return x * ZC_MAP_SCALE_X; }
export function mapToViewY(y: number): number { return y * ZC_MAP_SCALE_Y; }

/**
 * 开局镜头的落点：**我方主城**那一格的视图坐标；地图还没定主城时为 `null`。
 *
 * 口径与 `ZCGameModel.homeId('player')` 一致：`homes[0]` 优先、缺省退回 `playerHomeId`。
 * **与人数无关** —— 3 / 4 人图上 `homes[0]` 仍然是我方（第 1 席）主城。
 * `cityMode === 'select'` 一律返回 `null`：那种图的 `homes` 只是给玩家看的**默认建议**，
 * 真正的主城要等选点确认（`ZCGame.finishSpawnSelection`）才知道，提前拿去当镜头落点会停在错的格子上。
 *
 * 之前落点一律取棋盘包围盒中心：2 人图上大致是双方正中，3 / 4 人图上则落在几块领地
 * 之间的中立空白处，开局第一眼看到的是别人的地界而不是自己家。
 */
export function buildPlayerHomeFocus(
    map: Readonly<{
        homes?: readonly number[];
        playerHomeId: number;
        cityMode?: string;
        hexes: readonly Readonly<{ x: number; y: number }>[];
    }>,
): { x: number; y: number } | null {
    if (map.cityMode === 'select') return null;
    const homeId = map.homes?.[0] ?? map.playerHomeId;
    if (homeId < 0) return null;
    const home = map.hexes[homeId];
    return home ? { x: mapToViewX(home.x), y: mapToViewY(home.y) } : null;
}

export type ZCTerritoryOwner = 'player' | 'enemy' | 'enemy2' | 'enemy3' | 'neutral';

/**
 * 计算每格需要绘制的六边，保证每条边只由一个格子画（避免两边叠线颜色加深）。
 *
 * 返回值按位编码：
 *   - bit 0..5  = boundary（外边界边）：无邻居、或 owner 与邻居不同（阵营交界 / vs 中立），
 *                 由阵营方画外轮廓；中立格之间共享的褐色网格线也放这里。
 *   - bit 8..13 = internal（同阵营内部线）：邻居与自己同阵营，按 id 小的画细线。
 *
 * edge 顺序与六边顶点一致：右上、上、左上、左下、下、右下。
 */
export function buildTerritoryBoundaryMasks(
    map: ReadonlyArray<Readonly<{ id: number; playable: boolean; x: number; y: number; neighbors: readonly number[] }>>,
    ownerForHex: (hexId: number) => ZCTerritoryOwner,
): ReadonlyMap<number, number> {
    const masks = new Map<number, number>();
    for (const hex of map) {
        if (!hex.playable) continue;
        const owner = ownerForHex(hex.id);
        let boundary = 0;
        let internal = 0;
        for (let edge = 0; edge < 6; edge += 1) {
            const normal = Math.PI / 3 * edge + Math.PI / 6;
            let adjacentId: number | null = null;
            let best = -Infinity;
            for (const id of hex.neighbors) {
                const neighbor = map[id];
                if (!neighbor?.playable) continue;
                const dx = neighbor.x - hex.x;
                const dy = neighbor.y - hex.y;
                const alignment = (dx * Math.cos(normal) + dy * Math.sin(normal))
                    / Math.max(1, Math.hypot(dx, dy));
                if (alignment > best) { best = alignment; adjacentId = id; }
            }
            if (best <= 0.7) adjacentId = null;
            if (adjacentId === null) {
                // 地图外边界：自己画粗线。
                boundary |= 1 << edge;
                continue;
            }
            const neighborOwner = ownerForHex(adjacentId);
            if (owner !== neighborOwner) {
                // 阵营交界边：只由阵营方画粗外轮廓；中立格不画（避免和阵营粗线叠）。
                if (owner !== 'neutral') boundary |= 1 << edge;
            } else if (hex.id < adjacentId) {
                // 同 owner（同阵营 / 都中立）内部边：id 小的画一次，避免两边叠线。
                if (owner === 'neutral') boundary |= 1 << edge;
                else internal |= 1 << edge;
            }
        }
        masks.set(hex.id, boundary | (internal << 8));
    }
    return masks;
}

/** 血条只在被攻击后显示这一时长，避免满血战场挂满血条。 */
export const HEALTH_BAR_VISIBLE_SECONDS = 3;

/**
 * 是否在血条显示窗口内。
 * lastDamagedAt 为 null（从没挨打）不算，否则开局前 3 秒满血目标都会顶血条。
 */
export function isHealthBarVisible(lastDamagedAt: number | null, now: number): boolean {
    if (lastDamagedAt === null || !Number.isFinite(lastDamagedAt) || !Number.isFinite(now)) return false;
    return now - lastDamagedAt < HEALTH_BAR_VISIBLE_SECONDS;
}

/**
 * 阵营 → 血条填充图。`enemy3` 与 `enemy` 共用同一张 ——
 * 蓝湖「多队伍」稿只给了三队配色（我方蓝 / 敌红 / 敌2 黄），第 4 家不单独出图。
 */
export function pickHealthBarFill(
    owner: ZCFaction,
    player: SpriteFrame,
    enemy: SpriteFrame,
    enemy2: SpriteFrame,
): SpriteFrame {
    if (owner === 'player') return player;
    if (owner === 'enemy2') return enemy2;
    return enemy;
}

/** 血条按阵营换填充图（贴图自带颜色，不再走 `color` 染色），并刷新比例与可见性。 */
export function updateHealthBar(bar: ProgressBar | null, hp: number, maxHp: number, fill: SpriteFrame): void {
    if (!bar) return;
    const valid = Number.isFinite(maxHp) && maxHp > 0;
    const ratio = valid && Number.isFinite(hp) ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    bar.node.active = valid;
    bar.progress = ratio;
    // 同帧每个单位/地块都会走到这里，只在阵营真的变了时才写 spriteFrame。
    if (bar.barSprite && bar.barSprite.spriteFrame !== fill) bar.barSprite.spriteFrame = fill;
}


// 生成动画（「由小变大」）：卡牌揭示与建筑生成共用同一条弹性曲线。


/** 生成动画的起手缩放（`1` = 不弹；卡牌从这一档放大出来）。 */
export const POP_FROM_SCALE = 0.2;
/** 建筑生成的起手缩放（比卡牌更小：0.15 ≈ 收没后的「刚冒头」，跟卡牌淡出同拍出现）。 */
export const BUILDING_POP_FROM_SCALE = 0.15;
/** 冲出峰值的过冲量。 */
export const POP_PEAK_SCALE = 1.2;
/** 回落时穿过 1 的下探量 —— **弹性就来自这一下**（收过头再弹回）。 */
export const POP_DIP_SCALE = 0.92;
/** 峰值落在生成段的正中。 */
export const POP_PEAK_AT = 0.5;
/** 下探最低点落在生成段的哪里。 */
export const POP_DIP_AT = 0.82;

/**
 * 生成动画曲线（纯函数）：`from → 1.2 → 0.92 → 1`，`t ∈ [0,1]`。
 *
 * 三段各有职责，合起来读作「蹦出来、收过头、稳稳落位」：
 *  - `[0, 0.5)` easeOutCubic：出手快、有力量感地冲出峰值；
 *  - `[0.5, 0.82)` easeInOutQuad：回落并**穿过 1**，把弹性做出来；
 *  - `[0.82, 1]` easeOutQuad：从下探点柔顺落回 1。
 *
 *  **卡牌（`ZCCardRevealView`）与建筑（`ZCHexView` 的建筑生成段）共用这一条**
 * ——需求原文就是「建筑生成动画节奏类似卡牌生成」，各写一套迟早会分开跑。
 * `t` 会被 clamp 到 [0,1]，段外恒为 1。
 */
export function elasticPopScale(t: number, from: number = POP_FROM_SCALE): number {
    const k = t < 0 ? 0 : (t > 1 ? 1 : t);
    if (k < POP_PEAK_AT) {
        const eased = 1 - Math.pow(1 - k / POP_PEAK_AT, 3);
        return from + (POP_PEAK_SCALE - from) * eased;
    }
    if (k < POP_DIP_AT) {
        const u = (k - POP_PEAK_AT) / (POP_DIP_AT - POP_PEAK_AT);
        const eased = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
        return POP_PEAK_SCALE + (POP_DIP_SCALE - POP_PEAK_SCALE) * eased;
    }
    const u = (k - POP_DIP_AT) / (1 - POP_DIP_AT);
    const eased = 1 - (1 - u) * (1 - u);
    return POP_DIP_SCALE + (1 - POP_DIP_SCALE) * eased;
}


// 飘字「快进慢出」：前 45% 完成入场（位移 + 缩放 + 金币图标自转），后 55% 缓慢淡出。


/**
 * 飘字入场段占整条时长的比例（**默认值**；真源是 `ZCFloatTextView.entranceProgress` 这个 property，
 * 这里的常量只用来给它当缺省，避免两个数字各写一份）。
 *
 * 需求原文：「前 35% 时长内快速完成入场（位移 + 缩放），后 65% 时长内缓慢淡出，整体动画的总时长保持不变」；
 * 2026-10-15 追加入场占比 **35% → 45%**（`0.45`）：35% 时入场太急、位移「唰」一下就走完，
 * 读不出数字是从目标头顶**飘出来**的。放宽到 45% 后入场仍是少数派（慢出仍占 55%，「慢出」的定性不变）。
 *
 *  要么别调，要么连 `ZCGameFloatText.prefab` 上那份序列化值一起调 —— 面板值会把代码缺省顶掉。
 */
export const FLOAT_TEXT_ENTRANCE_PROGRESS = 0.45;

/**
 * 飘字的**入场进度**（`0 → 1`）：位移、缩放、金币图标自转共用它。纯函数。
 *
 * 前 `entranceProgress` 段套 easeOutCubic（起步最快、末段收稳，这就是「快进」的手感来源），
 * 之后**恒 1** —— 数字「啪」地进到位就不再动，把剩下的时长整段留给淡出。
 *
 *  别退回「位移铺满整条时长」：那样数字全程都在飘，跟「入场」是两回事，
 * 而且慢速位移会一直抢走淡出的注意力。
 */
export function floatTextEntrance(progress: number, entranceProgress: number = FLOAT_TEXT_ENTRANCE_PROGRESS): number {
    // `entranceProgress <= 0`（瞬时入场）走下面 `progress >= span` 那一支，不必特判。
    const span = entranceProgress > 0 ? entranceProgress : 1e-6;
    const k = progress <= 0 ? 0 : (progress >= span ? 1 : progress / span);
    return 1 - Math.pow(1 - k, 3);
}

/**
 * 飘字的**不透明度系数**（`1 → 0`）。纯函数。
 *
 * 入场段恒 `1`（数字还在「进」的时候不该同时变淡），之后在剩下的时长里**线性**淡出到 0。
 * 「慢出」要的是「匀速地慢慢消失」；这里再叠一层 easing 会让中段忽快忽慢、反而显脏。
 */
export function floatTextFade(progress: number, entranceProgress: number = FLOAT_TEXT_ENTRANCE_PROGRESS): number {
    const start = entranceProgress < 0 ? 0 : (entranceProgress > 1 ? 1 : entranceProgress);
    if (progress <= start) return 1;
    const span = 1 - start;
    if (span <= 0) return 0;
    return Math.max(0, 1 - (progress - start) / span);
}

/**
 * 飘字「慢出」段的**收尾漂移**进度（`0 → 1`）。纯函数。
 *
 * 配合 `FLOAT_TEXT_DRIFT_DISTANCE` 用：入场段恒 `0`（那段位移由 `floatTextEntrance` 自己走完），
 * 之后用 easeOutQuad（`u(2-u)`）慢慢推到 1 —— 起步还带着一点入场剩下的惯性、越往后越慢，
 * 最后几乎停住，只在整条飘字里多出 5~10px 的位移收尾。
 *
 * 存在的理由：入场一结束，数字会在剩下的时长里**完全静止**地淡出，
 * 读起来像「贴图卡在那儿被调透明度」而不是「飘走」。给一点点同向漂移就有惯性收尾的感觉。
 *
 *  幅度仍是**像素级**（5~10px）：这里的位移只负责「别显得死掉」，
 * 几十像素就会跟淡出抢注意力，变回「一直在飘」，等于把快进慢出又退回去。
 */
export function floatTextDrift(progress: number, entranceProgress: number = FLOAT_TEXT_ENTRANCE_PROGRESS): number {
    const start = entranceProgress < 0 ? 0 : (entranceProgress > 1 ? 1 : entranceProgress);
    if (progress <= start) return 0;
    const span = 1 - start;
    if (span <= 0) return 0;
    const u = Math.min(1, (progress - start) / span);
    return u * (2 - u);
}

/**
 * 慢出段收尾漂移的**默认距离（像素）**，真源是 `ZCFloatTextView.driftDistance` 这个 property。
 *
 * 2026-10-15 由 4 提到 **7**（需求区间 5~10 的中值）：4px 在 720×1280 上太含蓄，
 * 慢出段那 55% 里几乎看不出在动，惯性收尾的感觉没出来。7px 能看见「还在飘」，又不至于抢淡出的戏。
 */
export const FLOAT_TEXT_DRIFT_DISTANCE = 7;


// 生成单位抖动：「Y 拉 110% 回落 → X 拉 110% 回落」两段脉冲。
//  - 单位出生抖动：`ZCUnitView.playSpawnShake`（新兵自己抖一下）；
//  - 建筑生成抖动：`ZCHexView.playBuildingShake`（建筑模型自己抖一下，需求 2026-10-15）。
// 两者共用同一条脉冲，只有「谁在抖」不同：单位抖的是单位节点，建筑抖的是 BuildingIcon。


/** 出生抖动的拉伸量：110% = 1 + 0.1。**单位**自己出生那一下用它（建筑看 `BUILDING_SHAKE_STRETCH`）。 */
export const SPAWN_SHAKE_STRETCH = 0.1;
/**
 * **建筑**抖动的拉伸量：120% = 1 + 0.2（需求 2026-10-15 row12 原文：
 * 「同时优化【建筑生成动画】，**建筑模型放大比例从 110% 改成 120%**」）。
 *
 * 与 `SPAWN_SHAKE_STRETCH` 分开的理由：需求只让**建筑模型**放大，单位自己出生那一下
 * 仍按早先的口径 110%（`ZCUnitView.playSpawnShake` 走默认档）。
 *
 * 🔴 口径说明（免得后人以为这里写错了）：这条抖动最初是 110%（row5 的
 * 「建筑节点快速抖动：先是 Y 轴变成 1.1，回落到 1，再是 X 轴 1.1」），row12 明确把它抬到 120%。
 * 同一条需求里的「【建筑生成动画】」也可以读成「建筑由小长出来的那一段」
 * （`elasticPopScale`，峰值 `POP_PEAK_SCALE` **本来就是 1.2**）—— 两种读法下
 * 「建筑模型的放大比例 = 120%」这句都成立，所以这里只抬抖动这一处，`POP_PEAK_SCALE` 保持 1.2。
 */
export const BUILDING_SHAKE_STRETCH = 0.2;
/** 单段（Y 或 X）抖动的时长（秒）；Y 先 X 后，共两段。 */
export const SPAWN_SHAKE_PHASE_SECONDS = 0.12;
/** 单次抖动的**总时长**（秒）= Y 段 + X 段。过了它就该复位。 */
export const SPAWN_SHAKE_TOTAL_SECONDS = SPAWN_SHAKE_PHASE_SECONDS * 2;

/**
 * 单段抖动脉冲（纯函数）：`t ∈ [0,1]` 内 `1 → 1+stretch → 1`（正弦脉冲，出手顺滑无尖点）。
 * 两段顺序由调用方拼：先 Y（scaleX 恒 1）、后 X（scaleY 恒 1）。
 *
 * `stretch` 缺省是**单位**那档（110%）；建筑传 `BUILDING_SHAKE_STRETCH`（120%）——
 * 同一条脉冲只差"拉多少"，形状与相位完全一致。
 */
export function spawnShakePulse(t: number, stretch: number = SPAWN_SHAKE_STRETCH): number {
    const k = t < 0 ? 0 : t > 1 ? 1 : t;
    return 1 + stretch * Math.sin(Math.PI * k);
}

/**
 * 生成抖动在「已用时（秒）」下的 **Y 轴**缩放因子（纯函数）：**先拉 Y**（前段 `0~PHASE`），
 * 之后恒 1。与 `spawnShakeScaleX` 拼出需求要的「先 Y 后 X」两段。
 */
export function spawnShakeScaleY(elapsedSeconds: number, stretch: number = SPAWN_SHAKE_STRETCH): number {
    return spawnShakePulse(elapsedSeconds / SPAWN_SHAKE_PHASE_SECONDS, stretch);
}

/**
 * 生成抖动在「已用时（秒）」下的 **X 轴**缩放因子（纯函数）：**后拉 X**（后段 `PHASE~2PHASE`），
 * 前段恒 1。与 `spawnShakeScaleY` 同源，只差一个相位平移。
 */
export function spawnShakeScaleX(elapsedSeconds: number, stretch: number = SPAWN_SHAKE_STRETCH): number {
    return spawnShakePulse(
        (elapsedSeconds - SPAWN_SHAKE_PHASE_SECONDS) / SPAWN_SHAKE_PHASE_SECONDS, stretch);
}


// 选择基地：跟随基地的【确认位置】按钮落点。


/**
 * 按钮与基地之间的**格子单位数**（需求原文：「按钮与基地之间保持 2 个格子单位的间距」）。
 *
 * 1 个格子单位 = **行距** `HEX_GRID_VIEW_ROW_SPACING`（90）= 同列上下邻格的中心距
 * —— 需求说的「正下方」就是同列方向，所以这里只能乘行距，别乘列距（92.25）：
 * 列距是斜邻居的横向分量，用它算出来的按钮会横向偏出去。
 */
export const SPAWN_BASE_CONFIRM_ROW_OFFSET = 2;

/**
 * 按钮中心相对**基地中心**的偏移（棋盘层局部坐标，y 上为正 ⇒ 负值 = 屏幕下方）。
 *
 * 取「中心到中心」而不是「基地底边到按钮顶边」：基地是随卡面尺寸变化的
 * Sprite，按边距算就得先知道它此刻多高，基地一换外观按钮就会跳；中心距与基地外观无关。
 */
export function spawnBaseConfirmOffsetY(): number {
    return -SPAWN_BASE_CONFIRM_ROW_OFFSET * HEX_GRID_VIEW_ROW_SPACING;
}

/** 基地格心（棋盘层局部坐标）→【确认位置】按钮的落点。 */
export function spawnBaseConfirmPoint(base: { x: number; y: number }): { x: number; y: number } {
    return { x: base.x, y: base.y + spawnBaseConfirmOffsetY() };
}


// 开局「点这里」提示：给金矿那一格套一圈整体描边、按正弦脉冲闪几下（需求 2026-10-15 row10）。


/**
 * 提示的目标资源 id —— 需求原文「给**金矿**图标所在的地块格子增加一个整体的描边闪烁，
 * 提示玩家点击金矿」。`mine` 是中立资源表里「金矿」的 id（见 `ZCNeutralResourceReward`）。
 */
export const ZC_NEUTRAL_HINT_RESOURCE_ID = 'mine';
/** 闪烁一个完整周期的时长（秒）。约 1.1s ⇒ 读起来是「一呼一吸」，不是频闪。 */
export const ZC_NEUTRAL_HINT_CYCLE_SECONDS = 1.1;
/** 闪几个周期。4 个周期足够被看见，又不会一直分散注意力。 */
export const ZC_NEUTRAL_HINT_CYCLES = 4;
/** 提示的**总时长**（秒）= 周期 × 次数（整数倍 ⇒ 收尾落在相位 0，不会闪到一半硬切）。 */
export const ZC_NEUTRAL_HINT_SECONDS = ZC_NEUTRAL_HINT_CYCLE_SECONDS * ZC_NEUTRAL_HINT_CYCLES;
/** 脉冲的下限透明度（上限恒 1）：留一点底，描边不会「彻底消失再出现」那样跳。 */
export const ZC_NEUTRAL_HINT_MIN_ALPHA = 0.35;

/**
 * 提示描边的透明度（纯函数）：`elapsed` 是**进入对局后的秒数**。
 *
 * 三段叠起来读：
 *  - 正弦脉冲 `1 → 0.35 → 1` 一周期一次（`cos` 相位 ⇒ **`elapsed = 0` 就是最亮**，
 *    玩家一进场立刻看到描边，而不是先暗一拍）；
 *  - 最后一个周期整体收尾淡出（`tail`）：从最后一个波峰最亮处一路降到 0 ⇒ 窗口结束时
 *    透明度已经到 0，不硬切；
 *  - 窗口外恒 0（含负值 / NaN）⇒ 调用方"看到 0 就收手"这一条判定是安全的。
 *
 * ⚠️ `tail` 取 **`(1-u)²` 而不是线性 `1-u`**：线性包络下，脉冲在收尾周期的后半段往回升
 * （0.35 → 1），乘出来会**中途反涨**，肉眼看到的是「最后一下闪两下再灭」。平方包络压得比脉冲
 * 回升快，整段收尾严格单调下降（用例里逐点断言了这条）。
 */
export function zcNeutralHintAlpha(elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= ZC_NEUTRAL_HINT_SECONDS) return 0;
    const phase = (elapsed % ZC_NEUTRAL_HINT_CYCLE_SECONDS) / ZC_NEUTRAL_HINT_CYCLE_SECONDS;
    const pulse = ZC_NEUTRAL_HINT_MIN_ALPHA
        + (1 - ZC_NEUTRAL_HINT_MIN_ALPHA) * (0.5 + 0.5 * Math.cos(2 * Math.PI * phase));
    const tailStart = ZC_NEUTRAL_HINT_CYCLE_SECONDS * (ZC_NEUTRAL_HINT_CYCLES - 1);
    if (elapsed <= tailStart) return pulse;
    const remaining = 1 - (elapsed - tailStart) / ZC_NEUTRAL_HINT_CYCLE_SECONDS;
    return pulse * remaining * remaining;
}


// 结算扫场：从胜利方那一侧起，整行同时铺**深饱和**阵营色（一行接一行），
// 铺满前再从**起点**整行推回去、把深色回正成阵营**当前色**（需求 2026-10-15 row8）。
//
// 需求原文：「胜利结算动画优化，效果类似【选择基地进入场景后的格子替换动画】/ 镜头放大的动画保持不变 /
// 在场景拉高后，用和阵营颜色一致，但饱和度更深的颜色填充格子，**其他玩家从最上方的格子往下填充，
// 玩家自己依旧是从下方往上填充**，深色格子即将完成全部填充时，再从起始点开始逐渐过渡到对应阵营的当前颜色」。
//
// 拆成四条口径：
//  1. **方向**按胜利方身份定，不按每一格的真实归属定 ——「其他玩家」= 非我方 ⇒ 从最上方那行往下，
//     「玩家自己」= 我方 ⇒ 从最下方那行往上。玩家那一侧**保持不变**（原文「依旧」）。
//  2. 轴上是**三段**：① 填充（铺深色，整行推进）→ ② 回正（起点整行推回去，深色 → 当前色）
//     → ③ **线条脉冲**（回正收手后，再有一道亮线沿同一方向扫过一遍，见 `PULSE_*`）。
//     ② 的起跑时刻见 `REVERT_LEAD_ROWS`；③ 的起跑时刻 = ② 收手那一刻（`victorySweepRevertEndSeconds`）。
//  3. ① 期间已铺上的格子**闪烁**：颜色在同色系的**偏白**一端快速来回（`SHIMMER_*`），2026-10-16 新增。
//  4. ② 收手后 ③ 亮的是**地块轮廓线**（不是底色）：③ 期间全盘已归胜利方、底色不再变，
//     唯一还在动的就是这条线 —— 见 `ZCOutlineLayer.appendHexPulseOutlineSegments`。


/** 填充段每一步（= 一整行）的时长。 */
export const ZC_VICTORY_SWEEP_STEP_SECONDS = 0.06;
/**
 * 回正段每一步的时长。
 *
 * 与填充段同速：一来一回节奏一致，观众看到的是「同一道波原路推回」。
 * 单独给一个常量而不是复用填充那一个，是为了以后想调「回正比铺色快一点」时不用再拆。
 */
export const ZC_VICTORY_SWEEP_REVERT_STEP_SECONDS = 0.06;
/**
 * 回正段在**填充铺过几行之后**起跑。
 *
 * 需求演进（钉钉表 row8 的追加两轮）：
 *  - 2026-10-16 第一轮：「回正动画播放时间往前移，普通动画播了 **3、4 行**格子时，马上播放回正动画」⇒ 取 3；
 *  - 2026-10-16 第二轮：「铺场动画播了 **1~3 行**，就播放回正动画」⇒ **取 2**。
 *    行号是 `floor` 出来的整数、游标是连续的，所以取 2 时屏幕上看到的是「已铺 1~2 行」，
 *    正好落在需求给的 1~3 区间**中间**（取 1 会变成 0~1 行，几乎没有铺色铺垫；
 *    取 3 仍是 3~4 行，也就是上一轮的原样）。
 *
 * 🔴 更早之前这里是「比铺满**提前** 0.12s」的秒数（`ZC_VICTORY_SWEEP_REVERT_LEAD_SECONDS`）——
 * 那个口径下回正要等铺到倒数第二行才动，前大半段只有铺色、屏幕上一动不动的深色占了大半时间。
 * 现在锚点在**填充开头**、口径是**行数**（需求就是按行说的）：
 * 起跑时刻 = `LEAD_ROWS × 填充步长`，与整盘有多少行**无关**。
 *
 * 之后填充波前与回正游标**同速**推进 ⇒ 中间恒定留一条 `LEAD_ROWS` 行宽的深色带
 * （见 `tests/zcds-progress.test.ts` 的半开区间断言），读起来是「一道深色带从起点扫到终点，
 * 前面被回正不断吃掉」。
 *
 * ⚠️ 行数比它还少的盘（`stepCount <= LEAD_ROWS`）退化成「铺满即起跑」（见
 * `victorySweepRevertStartSeconds`），不会出现负的起跑时刻。
 */
export const ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS = 2;
/**
 * 铺场闪烁的**一个完整来回**的时长（2026-10-16 需求：「铺场的颜色格子会闪烁，颜色在同色系
 * 偏白色的范围内快速变化」）。
 *
 * 0.15s ≈ 6.7Hz：比 60fps 的一帧（16.7ms）慢一个量级，所以每帧都能取到不同的相位（**真的在闪**）；
 * 又比填充步长（0.06s/行）长一倍多，肉眼不会把它和「铺过去」这件事混起来。
 */
export const ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS = 0.15;
/**
 * 闪烁时**最白**那一点白到什么程度：`0` = 纯深色（不闪），`1` = 纯白。
 *
 * 0.5 = 深色与纯白的中点 —— 实测我方 `#6a70e6` 到最白是 `#b5b8f3`，明显「偏白」但仍认得出
 * 是同一色系（`#6a70e6` 是 `ZC_DEEP_DARKEN = 0.9` 下的深色底，改那个比例这条注释要跟着改）。
 * 需求里的「同色系偏白色的范围」由它和下面的相位共同划定。
 */
export const ZC_VICTORY_SWEEP_SHIMMER_MAX = 0.5;
/**
 * 相邻两行的相位差（单位 = 周期的倍数）。
 *
 * 取 1/3 而不是 0：整行同步闪会读成「整盘一起呼吸」，是一种全局脉冲而不是「闪烁」；
 * 隔行错开相位后高光沿着行列斜着跑，才像一片在闪的金属。
 */
export const ZC_VICTORY_SWEEP_SHIMMER_ROW_PHASE = 1 / 3;
/**
 * 闪烁相位的量化档数（每周期）。用来判「这一帧要不要重画」：档位没变就不重画。
 *
 * 16 档 / 0.15s ≈ 107 档每秒 > 60fps ⇒ 闪烁期间**事实上每帧都会重画**（这正是「闪」的来源）；
 * 但一旦周期被调到很长（> 0.27s）它就真的省下重画 —— 闸门留着，不是为了现在。
 */
export const ZC_VICTORY_SWEEP_SHIMMER_STEPS = 16;

/**
 * 线条脉冲（第 ③ 段）波前每推进一行的时长（2026-10-16 需求：「回正动画结束再增加一个
 * 线条波动的脉冲效果，类似回正动画的」）。
 *
 * 🔴 **故意比填充 / 回正的 0.06s 快**：那两段是「一格一格把颜色铺过去」，看得清每一行；
 * 脉冲是收尾的一道光，0.06 会让整段拖到 1.3s 以上（结算弹窗要一直等它）。
 * 0.035 下 20 行的盘约 0.7s —— 读起来是「唰」一下扫过，而不是第二遍铺场。
 * 「类似回正动画」指的是**方向与形态**（从起点整行扫到终点），不是速度。
 */
export const ZC_VICTORY_SWEEP_PULSE_STEP_SECONDS = 0.035;
/**
 * 波带的半宽（行）：波前左右各 `BAND` 行内非零，峰在波前正压过的那一行。
 *
 * 取 1 ⇒ 任何时刻屏幕上最多 2~3 行在亮，是一条**窄亮带**。
 * ⚠️ 调大它不只是变宽：共享轮廓层按「同色同宽」分桶，带子越宽、同时在亮的行越多，
 * 每帧的 subModel 越多（见 `victorySweepPulseLevel`）。要加宽请同时看 `ZC_OUTLINE_*` 的桶数。
 */
export const ZC_VICTORY_SWEEP_PULSE_BAND_ROWS = 1;
/**
 * 脉冲强度的量化档数（见 `victorySweepPulseLevel`）。
 *
 * 4 档 ⇒ 每帧新增的 `Graphics` 桶数 ≤ 4（全盘同属一个阵营时它连底色一共只要 6 个桶）。
 * 档数再高收益递减：波带扫得快（0.035s/行），屏幕上根本分不出更多灰阶。
 */
export const ZC_VICTORY_SWEEP_PULSE_LEVELS = 4;
/**
 * 最亮那一档往**白**里偏多少（`0` = 不偏、`1` = 纯白）。
 *
 * 0.55 ⇒ 我方 `#7e82ff → #c9cbff`：明显「发亮」但仍认得出是这一方的颜色
 * （需求选的是「胜利方阵营色·偏亮」，不是纯白高光）。
 */
export const ZC_VICTORY_SWEEP_PULSE_MAX_MIX = 0.55;
/**
 * 脉冲亮线的线宽（px）。
 *
 * 比领地轮廓的 `OWNED_OUTLINE_LINE_WIDTH = 6` 粗 1px：更粗 + 更亮，一眼就是「有东西在扫」。
 * 不再往上加 —— 亮线会盖住相邻格的图标边缘。
 */
export const ZC_VICTORY_SWEEP_PULSE_LINE_WIDTH = 7;

export interface ZCVictorySweepPlan {
    /** hexId → 步号（0 = 最靠起点那一行）。同一行所有格同一步号。只含可玩格。 */
    steps: ReadonlyMap<number, number>;
    /** 总行数（不是总格数）。 */
    stepCount: number;
}

/**
 * 给每个可玩格排步号：按行分层，**同一行所有格共用一个步号**——整行同时铺/回正，
 * 一行接一行推进，不逐格从左往右。stepCount = 行数。
 *
 * 方向由**胜利方**决定（不是逐格看真实归属）：
 *  - 胜利方是**我方** ⇒ 起点在最下方那行，往上推（`maxRow - row`）；
 *  - 胜利方是**其他玩家** ⇒ 起点在最上方那行，往下推（`row - minRow`）。
 *
 * ⚠️ 判据必须是 `winner === 'player'`（而不是旧版 `winner === 'enemy'`）：四人局里的
 * `enemy2` / `enemy3` 也是「其他玩家」，旧写法会把它们当成我方、从下往上推 —— 需求明确
 * 「其他玩家从最上方的格子往下填充」。
 */
export function buildVictorySweepPlan(
    map: ReadonlyArray<Readonly<{ id: number; row: number; x: number; playable: boolean }>>,
    winner: ZCOwner,
): ZCVictorySweepPlan {
    const playable = map.filter((hex) => hex.playable);
    if (!playable.length) return { steps: new Map(), stepCount: 0 };
    const rows = playable.map((hex) => hex.row);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);
    // row 越大越靠下（`minRow` = 最上方那行）—— 与 `HEX_GRID_VIEW_ROW_SPACING` 的取号方向一致。
    const layerOf = (row: number): number => (winner === 'player' ? maxRow - row : row - minRow);
    // 按行分组：同一 layer（=同一行）的所有格共用一个步号。
    const layerSet = new Set(playable.map((hex) => layerOf(hex.row)));
    const layerList = Array.from(layerSet).sort((a, b) => a - b);
    const stepByLayer = new Map<number, number>();
    layerList.forEach((layer, index) => stepByLayer.set(layer, index));
    const steps = new Map<number, number>();
    for (const hex of playable) steps.set(hex.id, stepByLayer.get(layerOf(hex.row))!);
    return { steps, stepCount: layerList.length };
}

/** elapsed 秒时应**铺到**第几步（含）；-1 = 一步都没铺。 */
export function victorySweepLitStep(elapsed: number, stepCount: number): number {
    if (!(stepCount > 0)) return -1;
    const index = Math.floor(Math.max(0, elapsed) / ZC_VICTORY_SWEEP_STEP_SECONDS);
    return Math.min(stepCount - 1, index);
}

/** 填充段总长（秒）。 */
export function victorySweepFillSeconds(stepCount: number): number {
    return stepCount > 0 ? stepCount * ZC_VICTORY_SWEEP_STEP_SECONDS : 0;
}

/**
 * 回正段起点（从扫场开始算的秒数）= 填充铺过 `REVERT_LEAD_ROWS` 行的那一刻。
 *
 * 🔴 与整盘有多少行**无关**（需求：「播了 3、4 行格子时马上播放回正动画」）——
 * 行数少的盘只兜一个「不晚于铺满」：`stepCount <= LEAD_ROWS` 时退化成铺满即起跑，
 * 不会算出负的起跑时刻（那会让游标从第一帧就是正值、整盘一起回正）。
 */
export function victorySweepRevertStartSeconds(stepCount: number): number {
    if (!(stepCount > 0)) return 0;
    const lead = ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS * ZC_VICTORY_SWEEP_STEP_SECONDS;
    return Math.min(victorySweepFillSeconds(stepCount), lead);
}

/**
 * 回正游标（单位 = 步）：整数部分 = 已经整行回正到第几步，小数部分 = 当前这一行的
 * **过渡比例**；`-1` = 回正还没开始，`stepCount` = 整盘回正完毕。
 *
 * 用「带小数的游标」而不是「整数步 + 单独一个过渡量」：一行内的过渡比例就是游标的小数位，
 * 两段（哪一行 / 行内多少）只有一个来源，不会出现「行号和比例对不上」的错位。
 */
export function victorySweepRevertCursor(elapsed: number, stepCount: number): number {
    if (!(stepCount > 0)) return -1;
    const start = victorySweepRevertStartSeconds(stepCount);
    if (elapsed < start) return -1;
    return Math.min(stepCount, (elapsed - start) / ZC_VICTORY_SWEEP_REVERT_STEP_SECONDS);
}

/**
 * 某一格此刻「深饱和色 → 阵营当前色」的混合比：`0` = 纯深色，`1` = 当前色。
 *
 * 严格单调不减：`cursor` 停在某一行上时该行从 0 走到 1，越过的行恒 1、没到的行恒 0。
 */
export function victorySweepRevertMix(cursor: number, step: number): number {
    if (!(cursor > 0)) return 0;
    const local = cursor - step;
    if (local <= 0) return 0;
    return local >= 1 ? 1 : local;
}

/**
 * 回正段**收手**时刻（秒）= 回正起点 + 回正段总长。
 *
 * 也就是线条脉冲（第 ③ 段）的起跑时刻 —— 需求 2026-10-16：「回正动画结束再增加一个
 * 线条波动的脉冲效果」。分成单独一个函数而不是让脉冲去反推 `victorySweepDuration`：
 * 后者现在**含**脉冲段，拿它当脉冲起点就成自引用了。
 */
export function victorySweepRevertEndSeconds(stepCount: number): number {
    if (!(stepCount > 0)) return 0;
    return victorySweepRevertStartSeconds(stepCount)
        + stepCount * ZC_VICTORY_SWEEP_REVERT_STEP_SECONDS;
}

/**
 * 线条脉冲段总长（秒）。
 *
 * 波前从第 0 行走到最后一行（`stepCount - 1` 行），再往外走 `PULSE_BAND_ROWS` 行、
 * 让最后一行也彻底淡掉 ⇒ 恰好 `stepCount - 1 + PULSE_BAND_ROWS` 个脉冲步。
 * 空盘 / 单行盘都由 `Math.max` 兜住，不产出负数。
 */
export function victorySweepPulseSeconds(stepCount: number): number {
    if (!(stepCount > 0)) return 0;
    return Math.max(0, stepCount - 1 + ZC_VICTORY_SWEEP_PULSE_BAND_ROWS)
        * ZC_VICTORY_SWEEP_PULSE_STEP_SECONDS;
}

/** 整段演出总长（秒）= 回正收手 + 脉冲段。调用方（`ZCGame`）等它等到这一步才弹结算。 */
export function victorySweepDuration(stepCount: number): number {
    if (!(stepCount > 0)) return 0;
    return victorySweepRevertEndSeconds(stepCount) + victorySweepPulseSeconds(stepCount);
}

/**
 * 线条脉冲的**波前位置**（单位 = 行，连续）；`-1` = 还没起跑。
 *
 * 与回正游标同一个「带小数游标」范式：整数部分 = 波前压在第几行，小数部分 = 行内推进比例。
 * 起跑那一刻波前正好在第 0 行（起点那一行），与填充 / 回正都从起点出发，方向天然一致。
 */
export function victorySweepPulseCursor(elapsed: number, stepCount: number): number {
    if (!(stepCount > 0)) return -1;
    const start = victorySweepRevertEndSeconds(stepCount);
    if (elapsed < start) return -1;
    return (elapsed - start) / ZC_VICTORY_SWEEP_PULSE_STEP_SECONDS;
}

/**
 * 某一格此刻的脉冲强度 `0..1`：**三角**，峰在波前恰好压过这一行时（`cursor === step`）。
 *
 * 写成「波前两侧对称的三角」而不是「走过去了才开始亮」：脉冲的观感来自**波前的到达**，
 * 两侧对称才有「逼近 → 最亮 → 褪去」的三拍；单侧斜坡只有「亮起来再灭」，读作闪一下。
 *
 * ⚠️ 只在 `PULSE_BAND_ROWS` 行内非零 —— 这也是它能在共享轮廓层上成立的前提：
 * 任何时刻整盘只有 2~3 行在亮，配色种数（= `Graphics` 的 subModel 桶数）被压在个位数。
 */
export function victorySweepPulseMix(cursor: number, step: number): number {
    // ⚠️ 判据是 `cursor >= 0` 而不是 `> 0`：起跑那一刻游标**恰好是 0**，也就是波前正压在
    // 起点那一行 —— 写成 `> 0` 会让第一帧单独漏掉起点行，读起来是「波从第二行才亮」。
    if (!(cursor >= 0)) return 0;
    const distance = Math.abs(cursor - step);
    if (distance >= ZC_VICTORY_SWEEP_PULSE_BAND_ROWS) return 0;
    return 1 - distance / ZC_VICTORY_SWEEP_PULSE_BAND_ROWS;
}

/**
 * 把脉冲强度量化成**档位**（`0` = 不亮，`1..PULSE_LEVELS` = 越来越亮）。
 *
 * 为什么要量化：共享轮廓层按「同色同宽」分桶，桶数就是这一帧的 subModel 数。
 * 不量化的话每一格的强度都不同 ⇒ 每格一个颜色 ⇒ 每格一个 subModel，
 * 共享层白合了（那正是它存在的理由）。`PULSE_LEVELS` 个档位正好把新增桶数钉死在个位数。
 */
export function victorySweepPulseLevel(mix: number): number {
    if (!(mix > 0)) return 0;
    const clamped = mix >= 1 ? 1 : mix;
    // 用 `round` 不用 `ceil`：`ceil` 会让强度刚离 0 就跳到第 1 档、又在归零前一直停在
    // 第 1 档，末段是「啪一下灭掉」；`round` 让首尾各自先经过一档「半亮」再出现 / 消失。
    return Math.min(ZC_VICTORY_SWEEP_PULSE_LEVELS, Math.round(clamped * ZC_VICTORY_SWEEP_PULSE_LEVELS));
}

/**
 * 铺场闪烁量（纯函数）：某一格此刻该往白里偏多少，`0` = 纯深色、`0.5` = 最白（见
 * `ZC_VICTORY_SWEEP_SHIMMER_MAX`）。
 *
 * 2026-10-16 需求：「铺场的颜色格子会闪烁，颜色在同色系偏白色的范围内快速变化」。
 *
 * 形状是**三角波**不是正弦：三角波的顶点是折角，看上去是「啪一下亮起来」的闪；
 * 正弦顶点平缓，读起来是「慢慢呼吸」而不是「闪」。整周期内 0 → 峰值 → 0，**恒非负**
 * —— 所以`elapsed = 0` 那一刻拿到的是纯深色，起手不会先白一下。
 *
 * `step`（行号）把相位按 `SHIMMER_ROW_PHASE` 错开，于是高光是斜着跑过整盘的，
 * 而不是全盘同拍呼吸。
 *
 * ⚠️ 这个量只作用在**深色那一端**（见 `ZCHexView.sweepFill`）：它和白的关系是
 * 「深色往白里偏」，回正越接近 1、深色的权重越低，闪烁**自动**淡出，
 * 不需要第二套「什么时候停闪」的规则。
 */
export function victorySweepShimmer(elapsed: number, step: number): number {
    if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
    const phase = elapsed / ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS
        + step * ZC_VICTORY_SWEEP_SHIMMER_ROW_PHASE;
    const wrapped = phase - Math.floor(phase);
    const triangle = wrapped < 0.5 ? wrapped * 2 : (1 - wrapped) * 2;
    return triangle * ZC_VICTORY_SWEEP_SHIMMER_MAX;
}

/**
 * 闪烁相位的**量化档位**：档位没变就不必重画（`ZCVictorySweep.advance` 拿它当第三个变化量）。
 *
 * 只跟 `elapsed` 走、不含 `step` —— 各行的相位差是固定偏移，同一帧里所有行一起跨档；
 * 含 `step` 的话「要不要重画」这个判断就得逐格做，反而更贵。
 */
export function victorySweepShimmerTick(elapsed: number): number {
    if (!(elapsed > 0)) return 0;
    return Math.floor(elapsed / ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS * ZC_VICTORY_SWEEP_SHIMMER_STEPS);
}


// 开局「归属扩散」：两座主城各自为圆心，把选点阶段铺的**半区色**逐个换成战斗底色。
//
// 需求（2026-10-15 row15）：「红色框，归属格子的颜色直接切换；绿色框，中立格子的颜色则是
// 逐个替换，以玩家基地为圆心，圆形的扩散替换，替换的速度越来越快，范围越来越大」。
// 拆开就是本段的两条口径：
//  · **归属格直接切** —— 开局就归属的格（主城 + 其 6 邻格）**不进表**，
//    由常规渲染一帧到位（选点阶段那 6 格是深蓝高亮，进战斗直接换成归属色，正是需求要的"直接切换"）；
//  · **中立格逐个替换** —— 只有落在**某座主城自己半区里**的中立格才进表，
//    起点 = 该格的半区色（`sectionOwnerOf`，与选点阶段铺的色逐位一致），
//    终点 = 战斗阶段的真实底色（`territoryTintOwner`）。
//
// ⚠️ 别把归属格也塞进表里"淡入"：那会让「已经归属」这件事看起来还在推进，
// 正是这一版要修掉的表现（见需求原话的红框）。

/**
 * 波前从主城走到最外圈中立格的总时长（秒）。
 *
 * ⚠️ 只算**波前推进**；每格自己还有 `ZC_CLAIM_WAVE_FADE_SECONDS` 的换色过渡，
 * 所以整段表现的实际长度 = 本值 + 过渡时长。
 */
export const ZC_CLAIM_WAVE_SECONDS = 1.0;
/** 单格自己的换色过渡时长（秒）：半区色 → 战斗底色。 */
export const ZC_CLAIM_WAVE_FADE_SECONDS = 0.1;
/**
 * 波前推进的加速指数（< 1 = 缓入快出、越往外越快）。
 *
 * 排序名次 `rank` 归一化成 `r = rank / (总数 − 1)`，到达时刻取 `ZC_CLAIM_WAVE_SECONDS × r^POWER`。
 * `POWER < 1` 时该曲线是**上凸**的：相邻两格之间的时间间隔随 rank **递减**
 * ⇒ 起手那几格之间等得久（缓入）、越往外越密（快出 / 越来越快）。
 * `POWER = 1` 是匀速；`POWER > 1` 会变成「快入缓出」，与需求相反。
 */
export const ZC_CLAIM_WAVE_ACCEL_POWER = 0.65;

/**
 * 一格底色该按**谁**的归属色画 —— 全工程唯一一处口径。
 *
 * 中立格且这一拍**可开发** ⇒ 按「可开发方」（玩家）的颜色点亮（`ZCHexView.renderTerrain` 里
 * 「中立 → 可开发（点了相邻格亮出的购买位）按玩家色染色」那条）。其余情况按真实归属。
 *
 * ⚠️ 三个调用点必须同源，否则同一格会出现「底图一个色、轮廓另一个色」：
 * `ZCHexView.territoryTint`（地块底色）、`ZCGameRenderWorld.renderHexSystem`（领地轮廓）
 * 与开局扩散波的**终点色**（`ZCClaimWaveCallbacks.tintOwnerOf`）。
 */
export function territoryTintOwner(owner: ZCFaction, canDevelop: boolean): ZCFaction {
    return owner === 'neutral' && canDevelop ? 'player' : owner;
}

export interface ZCClaimWaveEntry {
    /** 过渡起点：这一格在**选点阶段**铺的半区色。 */
    readonly fromOwner: ZCFaction;
    /** 过渡终点：战斗阶段的真实底色（`territoryTintOwner` 的口径）。 */
    readonly toOwner: ZCFaction;
    /** 这一格开始换色的时刻（相对波前起点，秒）。 */
    readonly startSeconds: number;
}

/**
 * 排「开局归属扩散」波要用到的三次查询。由渲染层注入 —— 本文件不查模型、不查选点状态。
 */
export interface ZCClaimWaveCallbacks {
    /** 该格**开局**的真实归属（`ZCSnapshotCodec.createInitialState` 已经分配好，这里只读）。 */
    ownerOf: (hexId: number) => ZCFaction;
    /** 该格在**选点阶段**被铺的半区色；`neutral` = 不属于任何半区（这种格不排波）。 */
    sectionOwnerOf: (hexId: number) => ZCFaction;
    /** 终点色：缺省 = `ownerOf`（即中立格都落到中立观感）。 */
    tintOwnerOf?: (hexId: number) => ZCFaction;
}

export interface ZCClaimWavePlan {
    /** hexId → 换色条目。只含**中立格**；归属格（主城 + 邻格）不在表里，它们一帧直接到位。 */
    readonly entries: ReadonlyMap<number, ZCClaimWaveEntry>;
    /** 波前推进总时长（秒）；没有要染的格时为 0。 */
    readonly durationSeconds: number;
}

/**
 * 排「开局归属扩散」的逐格时间表。
 *
 * 从每座主城做 BFS：**落在它自己半区里的中立格**才有条目，按到主城的距离分环
 * （邻格那一环全是归属格 ⇒ 不入选，所以实际最内环是「邻格的邻格」）。
 * 同一环内所有格到主城等距，光靠距离排不出先后，所以**环内再按相对主城的极角升序**排
 * —— 视觉上就是「以主城为圆心扫一圈、半径越来越大、逐个替换」。
 *
 * 到达时刻 = `ZC_CLAIM_WAVE_SECONDS × r^ZC_CLAIM_WAVE_ACCEL_POWER`，见加速指数的说明。
 * 名次 0（离主城最近的那一环）恒为 0 秒：主城那块刚切完，波就从它边上开吃。
 *
 * 每座主城**各排各的**（名次在自己的表里重新从 0 起）⇒ 两侧同拍、对称的地图不会一边先亮完。
 *
 * ⚠️ 本函数**不查模型**：归属在开局那一刻就已由 `ZCSnapshotCodec.createInitialState`
 * 分配好、半区则是选点阶段的既有概念，这里只负责把它们排成一条波前。
 */
export function buildClaimWavePlan(
    map: ReadonlyArray<Readonly<{
        id: number; x: number; y: number; neighbors: readonly number[]; playable?: boolean;
    }>>,
    homes: readonly number[],
    callbacks: ZCClaimWaveCallbacks,
): ZCClaimWavePlan {
    const entries = new Map<number, ZCClaimWaveEntry>();
    const claimed = new Set<number>();
    const { ownerOf, sectionOwnerOf } = callbacks;
    const tintOwnerOf = callbacks.tintOwnerOf ?? ownerOf;
    const angleOf = (origin: Readonly<{ x: number; y: number }>, hex: Readonly<{ x: number; y: number }>): number =>
        Math.atan2(hex.y - origin.y, hex.x - origin.x);
    for (const home of homes) {
        const origin = Number.isInteger(home) && home >= 0 ? map[home] : undefined;
        if (!origin) continue;
        const owner = ownerOf(home);
        if (owner === 'neutral') continue;
        // BFS 铺距离；一轮走完再把「本半区的中立格且尚未被别的主城认领」的格按 (距离, 极角) 排序。
        const distance = new Map<number, number>([[home, 0]]);
        const queue: number[] = [home];
        for (let head = 0; head < queue.length; head += 1) {
            const current = queue[head];
            const next = (distance.get(current) ?? 0) + 1;
            for (const neighborId of map[current]?.neighbors ?? []) {
                if (distance.has(neighborId)) continue;
                distance.set(neighborId, next);
                queue.push(neighborId);
            }
        }
        const mine = queue
            .filter((hexId) => {
                const hex = map[hexId];
                // 虚空格没有地块视图（`hexEntityBySource` 里查不到）、也铺不到半区色：
                // 收进来只会白占一个名次、把波前的节拍拉稀。
                if (!hex || hex.playable === false) return false;
                if (claimed.has(hexId)) return false;
                // 归属格（含主城 / 主城邻格）走常规渲染一帧到位，绝不进波。
                if (ownerOf(hexId) !== 'neutral') return false;
                // 别的半区归**那座**主城的波管，这边不许碰。
                return sectionOwnerOf(hexId) === owner;
            })
            .sort((a, b) => {
                const delta = (distance.get(a) ?? 0) - (distance.get(b) ?? 0);
                return delta !== 0 ? delta : angleOf(origin, map[a]) - angleOf(origin, map[b]);
            });
        const lastRank = mine.length - 1;
        mine.forEach((hexId, rank) => {
            claimed.add(hexId);
            const ratio = lastRank > 0 ? rank / lastRank : 0;
            entries.set(hexId, {
                fromOwner: sectionOwnerOf(hexId),
                toOwner: tintOwnerOf(hexId),
                startSeconds: ZC_CLAIM_WAVE_SECONDS * Math.pow(ratio, ZC_CLAIM_WAVE_ACCEL_POWER),
            });
        });
    }
    return { entries, durationSeconds: entries.size ? ZC_CLAIM_WAVE_SECONDS : 0 };
}

/** 该格在 `now` 时刻的换色进度：`0` = 还没轮到（仍是半区色），`1` = 已经是战斗底色。 */
export function claimWaveProgress(now: number, startSeconds: number, startedAt: number): number {
    const raw = (now - startedAt - startSeconds) / ZC_CLAIM_WAVE_FADE_SECONDS;
    return raw <= 0 ? 0 : (raw >= 1 ? 1 : raw);
}


// 虚空装饰：虚空格没有节点，装饰铺在独立装饰层。


/** 装饰键判据："行,列"两个整数。 */
export const ZC_DECOR_KEY_PATTERN = /^\d+,\d+$/;

export interface ZCDecorPlacement {
    id: number;
    art: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** 装饰贴进格面的等比系数：装得下就行，只缩不拉伸。 */
export function decorFitScale(
    imageWidth: number,
    imageHeight: number,
    // 默认框 = **顶面**（123×90），不是整图（130×119）。
    // 立体地块的可见"台面"只有顶面，装饰贴整图会有一截陷进侧壁里。
    boxWidth = ZC_LAND_TOP_HALF_WIDTH * 2,
    boxHeight = ZC_LAND_TOP_HALF_HEIGHT * 2,
): number {
    if (!(imageWidth > 0) || !(imageHeight > 0)) return 0;
    return Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
}

/**
 * 装饰 = anchor（key 那格）+ 占地形态（span）+ 像素偏移（offset）。
 * 老存档只写资源名字符串（等价 span=[[0,0]], offset=[0,0]）；多格装饰是新加的对象格式。
 * 编辑器在 `ZCMapConfig.configureZCMap` 把两种值都规范化过，这里只描述入参形状。
 */
export interface ZCMapDecorTileLike {
    art: string;
    span?: ReadonlyArray<readonly [number, number]>;
    offset?: readonly [number, number];
}

/**
 * 把 art.tiles 装饰键翻译成摆放清单。
 * 图未加载（measure null）/ 越界键跳过；按 y 降序、x 升序（画家算法）。
 *
 * 单格（值是字符串）：图片贴 anchor 顶面 `123×90` 居中。
 * 多格（值是 `{ art, span, offset }`）：图片贴 span 包围盒的几何中心 + 像素偏移。
 *   - 宽 = `(maxDc - minDc) * HEX_COL + 2 * HEX_TOP_HALF_WIDTH`（顶面宽）
 *   - 高 = `(maxDr - minDr) * HEX_ROW + 2 * HEX_TOP_HALF_HEIGHT`（顶面高）
 *   - 中心 = 各 cell 中心点的平均（与 `hexCenter` 同坐标系），保证美术位置与编辑器所见一致。
 */
export function buildDecorPlacements(
    map: ReadonlyArray<Readonly<{ id: number; column: number; row: number; x: number; y: number }>>,
    tiles: Readonly<Record<string, string | ZCMapDecorTileLike>> | null | undefined,
    measure: (art: string) => Readonly<{ width: number; height: number }> | null,
): ZCDecorPlacement[] {
    if (!tiles) return [];
    const hexByCell = new Map<string, Readonly<{ id: number; column: number; row: number; x: number; y: number }>>();
    for (const hex of map) hexByCell.set(`${hex.row},${hex.column}`, hex);
    const placements: ZCDecorPlacement[] = [];
    for (const [key, value] of Object.entries(tiles)) {
        if (!ZC_DECOR_KEY_PATTERN.test(key)) continue;
        const hex = hexByCell.get(key);
        if (!hex || !value) continue;
        const art = typeof value === 'string' ? value : value.art;
        if (!art) continue;
        const size = measure(art);
        if (!size) continue;
        const entry: ZCMapDecorTileLike = typeof value === 'string' ? { art: value } : value;
        const span = entry.span && entry.span.length ? entry.span : [[0, 0]];
        const offset = entry.offset || [0, 0];
        const isSingle = span.length === 1 && span[0][0] === 0 && span[0][1] === 0;
        // 单格：图片贴 anchor 顶面（与编辑器装饰面板单格行为一致）。
        // 多格：图片贴 span 包围盒，几何中心 = 各 cell 中心点平均。
        let centerX: number;
        let centerY: number;
        let boxWidth: number;
        let boxHeight: number;
        if (isSingle) {
            centerX = mapToViewX(hex.x) + offset[0];
            centerY = mapToViewY(hex.y) + offset[1];
            boxWidth = ZC_LAND_TOP_HALF_WIDTH * 2;
            boxHeight = ZC_LAND_TOP_HALF_HEIGHT * 2;
        } else {
            let minDr = span[0][0], maxDr = span[0][0], minDc = span[0][1], maxDc = span[0][1];
            for (let i = 1; i < span.length; i += 1) {
                if (span[i][0] < minDr) minDr = span[i][0];
                if (span[i][0] > maxDr) maxDr = span[i][0];
                if (span[i][1] < minDc) minDc = span[i][1];
                if (span[i][1] > maxDc) maxDc = span[i][1];
            }
            boxWidth = (maxDc - minDc) * ZC_HEX_COLUMN_SPACING + ZC_LAND_TOP_HALF_WIDTH * 2;
            boxHeight = (maxDr - minDr) * ZC_HEX_ROW_SPACING + ZC_LAND_TOP_HALF_HEIGHT * 2;
            // 用 `hexByCell` 拿到各 cell 中心点（编辑器侧已经把 span 限定在虚空上，
            // 此处任意 cell 缺失 = 配置烂掉，整片跳过 —— 不让单点缺失污染几何中心）。
            let sumX = 0, sumY = 0;
            let valid = true;
            for (let i = 0; i < span.length; i += 1) {
                const cellHex = hexByCell.get(`${hex.row + span[i][0]},${hex.column + span[i][1]}`);
                if (!cellHex) { valid = false; break; }
                sumX += mapToViewX(cellHex.x);
                sumY += mapToViewY(cellHex.y);
            }
            if (!valid) continue;
            centerX = sumX / span.length + offset[0];
            centerY = sumY / span.length + offset[1];
        }
        // 适配到实际图尺寸的等比系数。盒子只能比图小（min(boxW/imgW, boxH/imgH)），
        // 与原 decorFitScale 同口径 —— 只缩不拉伸。
        const scale = Math.min(boxWidth / size.width, boxHeight / size.height);
        if (!(scale > 0)) continue;
        // placement 落点 = 图片中心（与 ZCGameRenderWorld.installDecor 期望一致：sprite.position
        // 就是中心，宽高由 UITransform 接管，老代码也走这条）。
        placements.push({
            id: hex.id,
            art,
            x: centerX,
            y: centerY,
            width: size.width * scale,
            height: size.height * scale,
        });
    }
    placements.sort((a, b) => b.y - a.y || a.x - b.x);
    return placements;
}

export function drawFlatTopHex(graphics: Graphics, radius: number): void {
    for (let index = 0; index < 6; index += 1) {
        const angle = Math.PI / 180 * (60 * index);
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);
        if (index === 0) graphics.moveTo(x, y);
        else graphics.lineTo(x, y);
    }
    graphics.close();
}
