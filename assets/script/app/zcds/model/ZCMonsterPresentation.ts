/**
 * 野怪格的表现口径：头顶「血条 + 集火按钮 + 集火特效」的纵向排布，以及身体骨架的三态染色。
 * 零 `cc` 依赖 —— 只出**数字**，`Color` 由视图拼（这样用例能直接断言压亮倍率 / 暗红，不用跑引擎）。
 *
 * 2026-11-26 用户需求（第 53 批，原文）：
 * 「1. 野怪按钮特效的位置应该在血条的上方 3px；2. 野怪未激活整体叠加一层灰色不透明度为 35%；
 *   3. 野怪激活后去掉灰色，改成叠加暗色（类似敌方卡牌）；4. 野怪被玩家方击败，播放卡牌单位
 *   生成特效，把颜色改回正常颜色，去掉叠加的暗红色」。
 */

// ---------------------------------------------------------------- 头顶排布

/**
 * 集火按钮 / 特效底边 ↔ 血条顶边的间隙（2026-11-25 第 51 批定，本批复用到特效上）。
 *
 * 🔴 两个「间距」别混：这个是**按钮区 ↔ 血条**；`ZC_MONSTER_HEALTH_BAR_GAP`（6，在 `ZCUnitView`）
 * 是**模型头顶 ↔ 血条底**。名字里都带 GAP，量的是完全不同的两段。
 */
export const ZC_MONSTER_FOCUS_GAP_ABOVE_BAR = 3;

/**
 * 集火特效（`FocusSpine`）的锚点 y —— **美术底边**那条线。
 *
 * 🔴 返回的是「特效**美术**底边」的 y，不是节点原点、也不是中心：
 * 那颗 spine 的美术整体画在节点原点**之上**（骨架 `bounds.y ≈ 200`），
 * 所以原点与可见底边差着 `bounds.y × 节点缩放`。2026-11-26 第 56 批用户实测
 * 「特效还在血条上方约 100px」就是这个差（prefab 缩放 0.5 ⇒ 200×0.5 = 100）。
 *
 * 调用方传进来的 `artLiftPx` 已经乘过缩放（见 `zcMonsterFocusSpineArtLiftPx`），
 * 这里只做「目标线 − 美术高度」这一件事 —— 换图 / 改缩放都不用改这条式子。
 */
export function zcMonsterFocusSpineY(barTopY: number, artLiftPx: number,
    gapAboveBar = ZC_MONSTER_FOCUS_GAP_ABOVE_BAR): number {
    return barTopY + gapAboveBar - (Number.isFinite(artLiftPx) ? artLiftPx : 0);
}

/**
 * 集火特效相对 prefab 的放大倍数（2026-11-26 第 56 批用户：「特效按钮需要放大 1.5 倍」）。
 *
 * 乘在 prefab 的原始缩放下（现在是 0.5 ⇒ 实际 0.75）而不是写死绝对值：
 * 美术以后调 prefab 大小，这里跟着走。
 */
export const ZC_MONSTER_FOCUS_SPINE_SCALE = 1.5;

/**
 * 特效美术底边到节点原点的距离（**骨架单位**，未乘缩放）—— 读不到骨架 bounds 时的兜底。
 *
 * 实测值：prefab 0.5 缩放时约 100px ⇒ 骨架单位 200。
 */
export const ZC_MONSTER_FOCUS_SPINE_ART_LIFT = 200;

export function zcMonsterFocusSpineScale(baseScaleY: number): number {
    const base = Number.isFinite(baseScaleY) && baseScaleY !== 0 ? Math.abs(baseScaleY) : 1;
    return base * ZC_MONSTER_FOCUS_SPINE_SCALE;
}

/**
 * 美术底边离节点原点的**屏幕 px**。`boundsY` 传骨架 `getRuntimeData(true).y`：
 * - 有限值 ⇒ 取 `|y|`：方向**不靠符号推**，靠实测（第 56 批用户截图：美术浮在锚点上方约 100px
 *   ⇒ 底边在原点**之上**，原点要让出这一段）。spine 的 `data.y` 在不同导出工具里符号约定不一致，
 *   取绝对值才不会被一个负号把修正吞掉；
 * - 读不到（空骨架 / 单测桩）⇒ 用 `ZC_MONSTER_FOCUS_SPINE_ART_LIFT` 兜底。
 */
export function zcMonsterFocusSpineArtLiftPx(boundsY: number | null | undefined, scaleY: number): number {
    const raw = Number.isFinite(boundsY) ? Math.abs(boundsY as number) : ZC_MONSTER_FOCUS_SPINE_ART_LIFT;
    const scale = Number.isFinite(scaleY) ? Math.abs(scaleY) : 1;
    return raw * scale;
}

/**
 * 集火按钮（点击区，150×42）的中心 y：**底边**贴血条顶边往上 `gapAboveBar`。
 *
 * 两个半高各加一次才叫「底边 ↔ 顶边」，不是中心距（同 `positionMonsterHeader` 的老注释）。
 */
export function zcMonsterFocusButtonY(barTopY: number, halfButton: number,
    gapAboveBar = ZC_MONSTER_FOCUS_GAP_ABOVE_BAR): number {
    return barTopY + gapAboveBar + halfButton;
}

// ---------------------------------------------------------------- 三态染色

/**
 * 野怪身体的三种染色态：
 * - `sleep`：**未激活**（没人集火）—— 压亮（不压透），读成「还没醒，别打」。
 * - `awake`：**已激活可打** —— 叠暗红，读成「这条能打，点集火」。
 * - `captured`：**已被玩家方打下**（格子改归属）—— 回正常色，另配一次出生特效。
 */
export type ZCMonsterTintState = 'sleep' | 'awake' | 'captured';

export interface IZCMonsterTint {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
}

/**
 * 未激活的灰度倍率（0~255）。
 *
 * 🔴 spine 顶点色是**乘算**，做不出真正的灰度遮罩（黄剑会变暗黄而不是灰白 —— 同
 * `MONSTER_FOCUS_LOCKED_TINT` 那段说明）。这里给的是「灰色 + 压亮」的等效倍率，
 * 真要灰度只能换材质，代价是丢掉插槽色/透明度动画，不值当。
 */
export const ZC_MONSTER_SLEEP_GRAY = 0xB4;

/**
 * 未激活的整体不透明度：**不透明**（255）。
 *
 * 🔴 2026-11-26 用户澄清（第 53 批那句「叠加一层灰色不透明度为 35%」的原意）：
 * 「是叠加一层**带透明度**的颜色，**不是整个颜色变透**」——
 * 之前 `0x59`（35%）的写法让整只怪变成 35% 半透明，地皮网格直接透过身体（实机截图可证），
 * 读起来像「幽灵」而不是「没激活」。
 *
 * 所以这里钉死 255：**本体永远不透明**。要「灰罩」得靠材质做 `mix(原色, 灰, 35%)`（见文档 §53.2），
 * 那一步没做之前先走零成本近似 —— 只压亮（`ZC_MONSTER_SLEEP_GRAY`），不透。
 * 等灰罩材质上线，35% 这个数会变成 shader 的强度参数，而不是这里的 alpha。
 */
export const ZC_MONSTER_SLEEP_ALPHA = 255;

/** 激活态的暗红倍率（≈ 0.59 / 0.33 / 0.33 相乘）：压暗并往红偏，和敌方卡牌的暗色读法一致。*/
export const ZC_MONSTER_AWAKE_RED = 0x96;
export const ZC_MONSTER_AWAKE_GREEN = 0x54;
export const ZC_MONSTER_AWAKE_BLUE = 0x54;

export const ZC_MONSTER_TINTS: Readonly<Record<ZCMonsterTintState, IZCMonsterTint>> = {
    sleep: { r: ZC_MONSTER_SLEEP_GRAY, g: ZC_MONSTER_SLEEP_GRAY, b: ZC_MONSTER_SLEEP_GRAY, a: ZC_MONSTER_SLEEP_ALPHA },
    awake: { r: ZC_MONSTER_AWAKE_RED, g: ZC_MONSTER_AWAKE_GREEN, b: ZC_MONSTER_AWAKE_BLUE, a: 255 },
    //  被玩家方打下：**不染色**（返回 `null`，视图写 `Color.WHITE`）。
    captured: { r: 255, g: 255, b: 255, a: 255 },
};

/**
 * 这一格要不要染色、染哪一态。`null` = 这一格根本不是野怪（交给别的地块表现，一个字节不动）。
 *
 * 判据顺序有讲究，别合并：
 * 1. 先看**归属**：非中立 ⇒ `captured`。野怪被玩家方打下来后 `owner` 立刻改，
 *    而 `neutralResourceId` 故意留着（见 `ZCDevelopmentSystem`「出生格的生命值仍由中立野怪
 *    战斗结算持有」），所以这一格仍然会画那只野怪 —— 这时必须回正常色。
 * 2. 再看 `awake && hp > 0`：`awake` 在集火时置真，但血量归零后不该还显示「能打」的暗红。
 * 3. 其余都是 `sleep`（未激活）。
 */
export function zcMonsterTintStateOf(input: {
    readonly monster: boolean;
    readonly owner: string;
    readonly awake: boolean;
    readonly hp: number;
}): ZCMonsterTintState | null {
    if (!input.monster) return null;
    if (input.owner !== 'neutral') return 'captured';
    if (input.awake && (input.hp > 0 || !Number.isFinite(input.hp))) return 'awake';
    return 'sleep';
}

/**
 * 未激活时骨架的动画倍速：慢速待机，看得出「还没醒」。
 *
 * 另外两态一律 1 —— `captured` 尤其不能留 0.35，否则打下来的野怪像还在睡。
 */
export function zcMonsterIdleTimeScale(state: ZCMonsterTintState | null): number {
    return state === 'sleep' ? 0.35 : 1;
}

// ---------------------------------------------------------------- 集火提示

/**
 * 集火按钮点击后「点不成」的原因。`null` = 可以集火。
 *
 * `not-adjacent`：己方没有**相邻**的已建成地块（2026-11-26 第 56 批用户：
 * 「地块相邻后才能集火野怪」）。这条也顺带覆盖「未解锁」—— 解锁判据已经收到相邻。
 * `cooldown`：切换冷却还没到（`neutralMonsterFocusSwitchCdSeconds`，默认 3s）。
 */
export type ZCMonsterFocusBlock = 'not-adjacent' | 'cooldown';

/** 这一下真的切成功了，是「开」还是「关」。 */
export type ZCMonsterFocusToggleKind = 'started' | 'cancelled';

/**
 * 一次集火切换的结果：成功给 `kind`，被拦给 `reason`，什么都不该发生两个都是 `null`。
 *
 * 控制器只认这一份结果决定弹哪句话 —— 不让视图 / 控制器自己猜「刚才那下成没成」。
 */
export interface IZCMonsterFocusToggleResult {
    readonly ok: boolean;
    readonly kind: ZCMonsterFocusToggleKind | null;
    readonly reason: ZCMonsterFocusBlock | null;
}

/**
 * 集火相关的屏幕中央提示文案（走公共吐司 `Toast.show`）。
 *
 * 集中放这里而不是散在视图 / 控制器里：同一句话既可能被别处复用，
 * 也是用例唯一要断言的字符串。
 */
export const ZC_MONSTER_FOCUS_TOAST: Readonly<Record<ZCMonsterFocusBlock | 'started' | 'cancelled', string>> = {
    'not-adjacent': '相邻地块才能集火野怪',
    cooldown: '集火冷却中，请稍候',
    started: '开始激活野怪',
    cancelled: '集火取消',
};

// ---------------------------------------------------------------- 集火按钮的视觉三档

/**
 * 集火按钮（底特效）的三档视觉。
 *
 * - `locked`：无相邻我方地块 —— 定格在倒数第 2 帧 + 压灰（点得出原因、但明显"还差条件"）。
 * - `idle`：已解锁但**野怪还没激活** —— 继续循环，但保持压灰（2026-11-26 用户：
 *   「按钮也需要是灰色的」）。
 * - `active`：野怪已激活（暗红态）—— 恢复原色 + 循环，读成「这条能打」。
 *
 * 🔴 为什么 `idle` 要单列一档：第 51 批的灰只挂在「未解锁」上，于是「相邻已建好、还没点集火」
 * 这一态按钮是**满色**的 —— 身体灰着、按钮亮着，整只怪的读法就散了。
 * 用户口径是「未激活整体灰」，所以灰必须跟着**野怪三态**（`zcMonsterTintStateOf`）走，
 * 而"定格"仍然只跟解锁走（那是"点不出结果"的表达，两件事）。
 */
export type ZCMonsterFocusSpineVisual = 'locked' | 'idle' | 'active';

/**
 * 按「解锁 / 野怪三态」算按钮视觉档。
 *
 * `tintState` 传 `zcMonsterTintStateOf(...)` 的结果（与身体染色同一份判据）：
 * `sleep` ⇒ 未激活 ⇒ 压灰。`null`（不是野怪）当已激活处理 —— 按钮根本不会显示，不必另造一档。
 */
export function zcMonsterFocusSpineVisualOf(input: {
    readonly unlocked: boolean;
    readonly tintState: ZCMonsterTintState | null;
}): ZCMonsterFocusSpineVisual {
    if (!input.unlocked) return 'locked';
    return input.tintState === 'sleep' ? 'idle' : 'active';
}
