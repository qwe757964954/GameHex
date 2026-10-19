/**
 * 「生成抖动」的两段脉冲 —— **零 `cc` 的共用曲线模块**。
 *
 * ## 为什么它不在 `app/zcds` 里
 *
 *  这条脉冲原本只长在 `app/zcds/view/ZCGameViewUtil.ts` 里。2026-10-16 的
 *  **row14（冒险）**「建筑生成增加**类似战斗系统**的建筑抖动效果」要求领地也播同一条 ——
 *  而 `app/territory` 与 `app/zcds` 之间**没有任何依赖**（领地是独立页面，不该反向吃对局的视图层）。
 *  ⇒ 与 `HexFlipPresentation`（翻格曲线，同样是两边共用）一样落到 `core/hex`。
 *
 *  ⚠️ **不要在任一业务侧再抄一份**：抄了以后「单位出生 110% / 建筑生成 120%」这两档
 *  就会各自漂移，且不会有任何报错。判据见 `tests/territory-building-shake.test.ts`
 *  （比对 `ZCGameViewUtil` 的转发与 core 真源逐项相等）。
 *
 * ## 形状
 *
 *  「Y 拉 120% 回落 → X 拉 120% 回落」两段脉冲，每段 `SPAWN_SHAKE_PHASE_SECONDS`：
 *
 *  ```
 *  t ∈ [0, 1]  ⟶  1 + stretch · sin(π t)      // 出手 / 收手都是零斜率，没有尖点
 *  ```
 *
 *  两段的顺序由调用方按「已用时」拼：
 *  · Y 段 = 前 `PHASE` 秒（`spawnShakeScaleY`），X 段 = 后 `PHASE` 秒（`spawnShakeScaleX`）；
 *  · 段外一律恒 1 ⇒ 播完不需要额外复位（但**必须显式停表**，否则「已用时」会一直涨）。
 *
 * ## 谁在抖
 *
 *  · **单位**出生：`ZCUnitView.playSpawnShake`（拉伸量走缺省的 `SPAWN_SHAKE_STRETCH` 110%）；
 *  · **建筑**生成：`ZCHexView.playBuildingShake`（对局）/ `TerritoryStationView.playBuildingShake`
 *    （领地冒险）—— 两处都显式传 `BUILDING_SHAKE_STRETCH`（120%）。
 *
 *  只有「谁在抖」不同：单位抖的是单位节点本身，建筑抖的是建筑图标节点，
 *  且两边都把这个因子**乘进各自的基准缩放**（不是覆盖），所以归一化、过冲等既有缩放不受影响。
 */

/** 出生抖动的拉伸量：110% = 1 + 0.1。**单位**自己出生那一下用它（建筑看 `BUILDING_SHAKE_STRETCH`）。 */
export const SPAWN_SHAKE_STRETCH = 0.1;

/**
 * **建筑**抖动的拉伸量：120% = 1 + 0.2（需求原文：「同时优化【建筑生成动画】，
 * **建筑模型放大比例从 110% 改成 120%**」）。
 *
 * 与 `SPAWN_SHAKE_STRETCH` 分开的理由：需求只让**建筑模型**放大，单位自己出生那一下
 * 仍按早先的口径 110%（`ZCUnitView.playSpawnShake` 走默认档）。
 *
 * 🔴 口径说明（免得后人以为这里写错了）：这条抖动最初是 110%（「建筑节点快速抖动：
 * 先是 Y 轴变成 1.1，回落到 1，再是 X 轴 1.1」），后来明确抬到 120%。
 * 同一条需求里的「【建筑生成动画】」也可以读成「建筑由小长出来的那一段」
 * （`elasticPopScale`，峰值 `POP_PEAK_SCALE` **本来就是 1.2**）—— 两种读法下
 * 「建筑模型的放大比例 = 120%」这句都成立，所以只抬抖动这一处，`POP_PEAK_SCALE` 保持 1.2。
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
 * 同一条脉冲只差「拉多少」，形状与相位完全一致。
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
