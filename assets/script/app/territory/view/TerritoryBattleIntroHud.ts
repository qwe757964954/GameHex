/**
 * 过场里**一件 HUD 的写节点工具**（位置 / 透明度 / 收工复位）。
 *
 * ## 为什么单独一个模块，而不是写在页面里
 *
 * `tests/territory-page-split.test.ts` 有一条架构守卫：**页面不许自己搭 UI**
 * （源码里出现 `new Node(` / `addComponent(` 就红）。那是"页面只接线、预制体管结构"的底线，
 * 过场要临时给 HUD 挂 `UIOpacity`（节点上本来没有）不该把它破掉 ——
 * 于是"挂组件 / 复位 / 决定要不要删"这三件事挪到视图层，页面只传节点进来。
 *
 * ## 为什么只删"自己加的"那个 `UIOpacity`
 *
 * prefab 里有的 HUD 本来就带 `UIOpacity`（半透明底条之类）。收工一律 `destroy()` 会把它们
 * 变成**永久不透明**（不是恢复原值，是连组件都没了）；一律不删又会给每个推过的 HUD
 * 永久留一个组件。所以进来时记 `added`，收工按它决定。
 */

import { Node, UIOpacity } from 'cc';
import type { Vec3 } from 'cc';
import { territoryBattleIntroDirVector, type TerritoryBattleIntroDir } from '../model/TerritoryBattleIntro';

/** 一件要推出去的 HUD：基准位置 + 方向 + 透明度组件（全部在进过场那一刻定下来）。 */
export interface ITerritoryBattleIntroHud {
    readonly node: Node;
    /** 开演那一刻的 `position`（Widget 之后会改它，所以必须存副本）。 */
    readonly base: Vec3;
    readonly dir: { readonly x: number; readonly y: number };
    readonly opacity: UIOpacity;
    /** `true` = `UIOpacity` 是本模块加的，收工要删掉。 */
    readonly added: boolean;
}

/**
 * 把一件 HUD 包成过场可用的句柄（顺手补上 `UIOpacity`）。
 *
 * @param node 已确认有效的节点
 * @param dir  往哪边飞（见 `TERRITORY_BATTLE_INTRO_TARGETS`）
 */
export function acquireIntroHud(node: Node, dir: TerritoryBattleIntroDir): ITerritoryBattleIntroHud | null {
    if (!node?.isValid) return null;
    let opacity = node.getComponent(UIOpacity);
    let added = false;
    if (!opacity) {
        opacity = node.addComponent(UIOpacity);
        added = true;
    }
    if (!opacity) return null;
    opacity.opacity = 255;
    return {
        node,
        base: node.position.clone(),
        dir: territoryBattleIntroDirVector(dir),
        opacity,
        added,
    };
}

/**
 * 写一帧：沿方向推出 `distance` 像素、整件 HUD 的不透明度写 `opacity01`。
 *
 * 位移写成"基准 + 方向 × 距离"（不是累加）：`hold` 段的帧反复写同一个值也不会漂，
 * 中途任何一帧读到的位置只由 `distance` 决定。
 */
export function applyIntroHud(handle: ITerritoryBattleIntroHud, distance: number, opacity01: number): void {
    const node = handle.node;
    if (!node?.isValid) return;
    const x = handle.base.x + handle.dir.x * distance;
    const y = handle.base.y + handle.dir.y * distance;
    if (node.position.x !== x || node.position.y !== y) node.setPosition(x, y, node.position.z);
    if (!handle.opacity?.isValid) return;
    const clamped = opacity01 <= 0 ? 0 : opacity01 >= 1 ? 1 : opacity01;
    const target = Math.round(clamped * 255);
    if (handle.opacity.opacity !== target) handle.opacity.opacity = target;
}

/** 收工：位置回基准、透明度回 255（自己加的那个组件顺手删掉）。 */
export function releaseIntroHud(handle: ITerritoryBattleIntroHud): void {
    const node = handle.node;
    if (!node?.isValid) return;
    node.setPosition(handle.base);
    if (!handle.opacity?.isValid) return;
    if (handle.added) handle.opacity.destroy();
    else handle.opacity.opacity = 255;
}
