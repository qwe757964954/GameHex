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

/**
 * 挂载后最多等这么久地图就绪（{@link MainHudIntroPlayer.prepare} 的兜底）。
 *
 * 地图没起来（数据失败 / 没有地图宿主 / 断网）时不能一直把 HUD 藏着 —— 到点直接放出来，
 * 并放弃这一轮入场。2.5s 比正常首帧（0.2~1s）宽出一截，又短到玩家不会觉得「界面没了」。
 */
const MAIN_HUD_INTRO_HOLD_SECONDS = 2.5;

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

    /** 已经摆好起始姿态、等地图就绪就起表（见 {@link prepare}）。 */
    private armed = false;
    /**
     * 入场这件事已经了结（播完 / 超时放出来）。
     *
     * 🔴 之后再收到 `presented` 必须**什么都不做**：那时 HUD 早就以静止姿态摆在屏幕上，
     *    再摆一次起始姿态就是玩家看见的「先跳一下」。
     */
    private settled = false;
    /** 挂载等待的兜底计时（到了还没等到地图就绪 ⇒ 直接把 HUD 放出来）。 */
    private holdTimer: (() => void) | null = null;

    /**
     * **页面一挂上就摆好「未入场」的起始姿态**，等 {@link play} 起表。
     *
     * 为什么需要它（2026-11-23 用户：「从别的界面加载回领地界面时，出现一个空场景，
     * 再加载了按钮，但是按钮的位置和空场景按钮的位置偏差，画面会显得跳一下」）：
     *
     * 起播点是地图首帧就绪（`presented`），而地图要异步读章节数据 + 美术 —— 切 tab 回来时
     * 页面早就渲染了零点几秒到两三秒（那段就是用户说的「空场景」）。等 `presented` 到了才
     * `apply(0)`，等于把**已经静止显示在屏幕上**的 HUD 一把推到起始姿态（顶栏 +40、底栏 -40、
     * 透明度归零），再花 0.4s 缓回去 —— 玩家看到的就是"跳一下"。
     *
     * 所以改成两段：挂载时先摆好（此时还没人看见，或还在登录图底下），就绪时只起表不摆位。
     * 代价是加载那几秒 HUD 不显示（只剩地图底图）—— 那正是"加载中"该有的样子。
     *
     * 兜底：地图一直不就绪（加载失败 / 没有地图宿主）时，最多等
     * {@link MAIN_HUD_INTRO_HOLD_SECONDS} 就把 HUD 直接放出来，且**放弃入场动画** ——
     * 宁可没有动画，也不能让玩家对着一个没有 HUD 的页面。
     */
    prepare(plan: readonly IMainHudIntroPlanItem[] = MAIN_HUD_INTRO_PLAN): boolean {
        // 这一页的入场已经了结过（`presented` 抢在 `start()` 前面到 ⇒ 走的是老口径当场播完）：
        // 再摆一次起始姿态就成了「先动一下再等」。
        if (this.settled) return false;
        this.stop();
        for (const entry of plan) {
            const node = this.node.getChildByName(entry.name);
            // 与 `play` 同一条口径：未解锁 / 收起的模块不碰（宝箱栏默认就是收起的）。
            if (!node || !node.isValid || !node.activeInHierarchy) continue;
            this.items.push(this.resolveItem(node, entry));
        }
        if (this.items.length === 0) return false;
        // 基准位置已经抓完，这里落起始帧是安全的（之后再怎么摆都不会污染基准）。
        this.apply(0);
        this.armed = true;
        this.holdTimer = (): void => { this.releaseOnTimeout(); };
        this.scheduleOnce(this.holdTimer, MAIN_HUD_INTRO_HOLD_SECONDS);
        return true;
    }

    /**
     * 起播。返回是否真的播上了（没有可播的模块 ⇒ `false`，调用方无需处理）。
     *
     * 三种入口：
     *  · `prepare` 过 ⇒ 只起表（基准位置沿用挂载时抓的，绝不重抓、不重摆）；
     *  · 已经 `settled`（播完 / 超时放出来）⇒ 直接 `false`，不重播；
     *  · 都没走过（无地图宿主的测试桩 / 预览）⇒ 现抓现摆，保持老口径。
     */
    play(plan: readonly IMainHudIntroPlanItem[] = MAIN_HUD_INTRO_PLAN): boolean {
        if (this.settled) return false;
        if (this.armed) {
            this.armed = false;
            this.cancelHold();
            // 挂载时被门禁挡掉、现在已经亮出来的模块（快速寻敌 / 排行角标）：现抓现摆。
            // 它们从来没被摆过，此刻的位置就是基准，抓了不亏。
            for (const entry of plan) {
                const node = this.node.getChildByName(entry.name);
                if (!node || !node.isValid || !node.activeInHierarchy) continue;
                if (this.items.some((item) => item.node === node)) continue;
                this.items.push(this.resolveItem(node, entry));
            }
            if (this.items.length === 0) return false;
            this.startedAt = Date.now() / 1000;
            this.totalSeconds = mainHudIntroTotalSeconds(plan);
            this.running = true;
            // 这一页的入场从此只有这一次（重复的 `presented` 不许打断重播）。
            this.settled = true;
            // 补进来的模块要立刻落到起始姿态，否则会先以全不透明闪一帧。
            this.apply(0);
            this.unschedule(this.step);
            this.schedule(this.step, 0);
            return true;
        }
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
        // 老口径这一次就是"这一页的入场"，记上账：之后再有 `prepare` / `play` 都不许重来。
        this.settled = true;
        // 先落起始帧，避免「原样渲染一帧再跳到透明」的闪动。
        this.apply(0);
        this.unschedule(this.step);
        this.schedule(this.step, 0);
        return true;
    }

    /** 等太久了：直接把 HUD 放出来，并**放弃**这一轮入场（见 {@link prepare}）。 */
    private releaseOnTimeout(): void {
        this.holdTimer = null;
        if (!this.armed) return;
        this.armed = false;
        this.settled = true;
        this.restore();
        this.items.length = 0;
    }

    private cancelHold(): void {
        if (!this.holdTimer) return;
        try {
            this.unschedule(this.holdTimer);
        } catch (error) {
            console.warn('[MainHudIntro] 取消失效兜底计时失败', error);
        }
        this.holdTimer = null;
    }

    /** 立刻中止并复位（`onDisable` / `onDestroy` / 重播前）。 */
    stop(): void {
        this.running = false;
        this.armed = false;
        this.cancelHold();
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
        this.armed = false;
        this.settled = true;
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

/**
 * 页面刚挂上时先把各模块摆成「未入场」的起始姿态，等 {@link playMainHudIntro} 起表。
 *
 * 与 {@link playMainHudIntro} 的分工见 `MainHudIntroPlayer.prepare` 的注释：
 * 起播点是地图首帧就绪（异步），那时页面早就显示过一段「空场景」了 —— 不能到那一刻才摆位。
 */
export function prepareMainHudIntro(root: Node | null): boolean {
    if (!root || !root.isValid) return false;
    if (typeof UIOpacity !== 'function') return false;
    try {
        const player = root.getComponent(MainHudIntroPlayer) ?? root.addComponent(MainHudIntroPlayer);
        return player.prepare();
    } catch (error) {
        console.warn('[MainHudIntro] 入场预备失败，按「照常显示」处理', error);
        return false;
    }
}
