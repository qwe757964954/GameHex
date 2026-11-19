/**
 * MainHudIntro — 「回到章节地图」时各模块的平滑入场
 * ------------------------------------------------------------------
 * 需求（2026-11-18）③：*回到【章节地图】各模块的 UI 平滑进入*。
 *
 * 分工：
 *   · 节奏表与进度公式在 `MainHudMotion.ts`（纯函数、零 `cc`，有独立用例）；
 *   · 本文件只做「按名字找节点 → 逐帧写 UIOpacity / 缩放 / 位置」。
 *
 * 触发点是 `MainTerritoryMap` 首帧渲染成功后派发的 `VIEW_LIFECYCLE{phase:'presented'}`
 * （见 `MainPage.onViewLifecycle`），**不是** `onLoad`：
 *   · 登录首屏时 `ArenaRoot` 是在登录图底下预挂载的，`onLoad` 就起播等于在遮挡物后面演完；
 *   · 切 tab 回来时页面 prefab 才刚 instantiate，地图数据还没到，先播会看到「先亮一下再淡」。
 *   地图首帧就绪那一刻才是玩家真正看见这一页的时刻。
 *
 * 为什么不建 tween：主城页每次切 tab 都会重建，且宝箱栏等节点会 `active=false` 反复收放；
 * tween 在节点停用后仍会跑完。这里与 `ChestBar` / `UIMotionPlayer` 同一口径 ——
 * `startedAt` + `schedule(step, 0)`，静止时完全不进函数。
 *
 * ⚠️ 收尾必须**逐项复位**（位置 / 缩放 / 透明度全量写回基准值）：中途被打断
 *    （切 tab、进战斗、`active=false`）也要回到「正常状态」，绝不能把 HUD 留在半透明。
 */

import { _decorator, Component, Node, UIOpacity, Vec3 } from 'cc';
import { uiMotionEase } from '../../framework/ui/UIMotion';
import {
    MAIN_HUD_INTRO_PLAN,
    mainHudIntroProgress,
    mainHudIntroTotalSeconds,
    type IMainHudIntroPlanItem,
} from './MainHudMotion';

const { ccclass } = _decorator;

/** 入场用的缓动：统一 `out-cubic`（到位快、收尾稳，与 HUD 的「落位感」一致）。 */
const HUD_INTRO_EASING = 'out-cubic' as const;

interface IResolvedHudIntroItem {
    readonly node: Node;
    readonly delay: number;
    readonly seconds: number;
    readonly offsetY: number;
    readonly scaleFrom: number;
    readonly opacity: UIOpacity | null;
    /** 静止状态的位置 / 缩放：收尾与打断时都回到这里。 */
    readonly basePosition: Vec3;
    readonly baseScale: Vec3;
}

/**
 * 主城模块入场播放器（运行时挂在页面根节点，不落 prefab）。
 *
 * 只认 `ArenaRoot` 的**直接子节点名**：模块是 prefab 结构的一部分，
 * 用名字找可以让「加一个新模块」不需要动本文件以外的任何东西。
 */
@ccclass('MainHudIntroPlayer')
export class MainHudIntroPlayer extends Component {
    private readonly items: IResolvedHudIntroItem[] = [];
    private startedAt = 0;
    private totalSeconds = 0;
    private running = false;

    /**
     * 起播。返回是否真的播上了（没有可播的模块 ⇒ `false`，调用方无需处理）。
     * 重复调用会先复位再重播（切回页面时可能连发两次 `presented`）。
     */
    play(plan: readonly IMainHudIntroPlanItem[] = MAIN_HUD_INTRO_PLAN): boolean {
        this.stop();
        for (const entry of plan) {
            const node = this.node.getChildByName(entry.name);
            // 未解锁 / 收起的模块（宝箱入口、快速寻敌、宝箱栏）跳过：它们自己会在
            // 解锁那一刻播各自的生成动画，这里抢着淡入反而会「先虚一下再弹出来」。
            if (!node || !node.isValid || !node.activeInHierarchy) continue;
            this.items.push(this.resolveItem(node, entry));
        }
        if (this.items.length === 0) return false;
        this.startedAt = Date.now() / 1000;
        this.totalSeconds = mainHudIntroTotalSeconds(plan);
        this.running = true;
        // 先落起始帧，避免「原样渲染一帧再跳到透明」的闪动。
        this.apply(0);
        this.unschedule(this.step);
        this.schedule(this.step, 0);
        return true;
    }

    /** 立刻中止并复位（`onDisable` / `onDestroy` / 重播前）。 */
    stop(): void {
        this.running = false;
        if (this.items.length === 0) return;
        try {
            this.unschedule(this.step);
        } catch (error) {
            console.warn('[MainHudIntro] 取消调度失败', error);
        }
        this.restore();
        this.items.length = 0;
    }

    onDisable(): void {
        this.stop();
    }

    onDestroy(): void {
        this.stop();
    }

    /** 入场的一帧（只在播放期间被调度）。 */
    private readonly step = (): void => {
        if (!this.running) {
            this.unschedule(this.step);
            return;
        }
        const elapsed = Date.now() / 1000 - this.startedAt;
        this.apply(elapsed);
        if (elapsed < this.totalSeconds) return;
        this.finish();
    };

    private apply(elapsed: number): void {
        for (const item of this.items) {
            if (!item.node.isValid) continue;
            const progress = mainHudIntroProgress(item.delay, item.seconds, elapsed);
            const eased = uiMotionEase(HUD_INTRO_EASING, progress);
            const scale = item.scaleFrom + (1 - item.scaleFrom) * eased;
            const offsetY = item.offsetY * (1 - eased);
            if (item.opacity && item.opacity.isValid) {
                item.opacity.opacity = Math.round(Math.max(0, Math.min(1, eased)) * 255);
            }
            item.node.setScale(item.baseScale.x * scale, item.baseScale.y * scale, item.baseScale.z);
            item.node.setPosition(item.basePosition.x, item.basePosition.y + offsetY, item.basePosition.z);
        }
    }

    private finish(): void {
        this.running = false;
        this.unschedule(this.step);
        this.restore();
        this.items.length = 0;
    }

    /** 逐项写回基准值（透明度 255 / 原始位置 / 原始缩放）。 */
    private restore(): void {
        for (const item of this.items) {
            if (!item.node.isValid) continue;
            if (item.opacity && item.opacity.isValid) item.opacity.opacity = 255;
            item.node.setScale(item.baseScale);
            item.node.setPosition(item.basePosition);
        }
    }

    private resolveItem(node: Node, entry: IMainHudIntroPlanItem): IResolvedHudIntroItem {
        const position = node.position;
        const scale = node.scale;
        return {
            node,
            delay: Math.max(0, entry.delay),
            seconds: Math.max(0, entry.seconds),
            offsetY: entry.offsetY,
            scaleFrom: Math.max(0.05, entry.scaleFrom),
            opacity: MainHudIntroPlayer.ensureOpacity(node),
            basePosition: new Vec3(position.x, position.y, position.z),
            baseScale: new Vec3(scale.x, scale.y, scale.z),
        };
    }

    /** 取（必要时补挂）`UIOpacity`。取不到就当「只做位移与缩放」。 */
    private static ensureOpacity(node: Node): UIOpacity | null {
        if (typeof UIOpacity !== 'function') return null;
        try {
            return node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        } catch (error) {
            console.warn('[MainHudIntro] 补挂 UIOpacity 失败，该模块只做位移 / 缩放', error);
            return null;
        }
    }
}

/**
 * 播一次「章节地图各模块入场」。
 * 任何异常都只能退化成「不动」（模块本来就在正确位置），不许影响页面本身。
 */
export function playMainHudIntro(root: Node | null): boolean {
    if (!root || !root.isValid) return false;
    if (typeof UIOpacity !== 'function') return false;
    try {
        const player = root.getComponent(MainHudIntroPlayer) ?? root.addComponent(MainHudIntroPlayer);
        return player.play();
    } catch (error) {
        console.warn('[MainHudIntro] 入场动画启动失败，按无动画处理', error);
        return false;
    }
}
