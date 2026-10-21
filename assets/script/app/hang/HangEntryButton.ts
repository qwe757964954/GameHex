/**
 * 主城左下角金币车入口，挂在 ArenaRoot/BottomHud/HangRewardEntry。
 *
 * 复用挂机 Repository、累计时长和可领取提示，点击通过 HangPage.open 打开奖励弹窗。
 * 容器覆盖图标、底板和时间文字；显隐整体更新，摇摆只作用于 HangIcon。
 * 不登记 open.url：挂机奖励沿用主城常驻入口。
 */

import { _decorator, Button, Component, Label, Node, Tween, tween, Vec3 } from 'cc';
import { hangRepository } from './HangRepository';
import type { IHangSnapshot } from './HangRepository';
import { HangPage } from './HangPage';
import { canClaim, formatHms, idleCappedMs, idleElapsedMs, idleReachedMax } from './HangTable';

const { ccclass, property } = _decorator;

/** FGUI `t0` 的单段时长：12 帧 @ 60fps。 */
export const HJ_ENTRY_SHAKE_SEGMENT_SECONDS = 0.2;

/** FGUI `t0` 的旋转幅度（±8°）。 */
export const HJ_ENTRY_SHAKE_DEG = 8;

@ccclass('HangEntryButton')
export class HangEntryButton extends Component {
    @property({
        type: Node,
        tooltip: 'HangIcon：金币车图标，时间文字不参与摇摆',
    })
    shakeNode: Node = null!;

    @property({ type: Label, tooltip: 'HangTime：累计挂机时长' })
    timeLabel: Label = null!;

    @property({
        type: Node,
        tooltip: 'RedDot：红点占位（FGUI `com_rd`）。老端从不点亮，本轮不接；接的时候用 setRedDot()。',
    })
    redDot: Node = null!;

    /** 挂机起点（毫秒）；老端 `refreshLastTime` 的 `startTime`（0 时退到「现在」）。 */
    private _startMs: number = 0;

    /** 摇摆 tween 是否在跑（只用来保证 `_startShake` 幂等，不参与任何节点状态的「缓存比较」）。 */
    private _shaking: boolean = false;

    // ============================================================
    // 生命周期
    // ============================================================

    onLoad(): void {
        // ⚠️ 监听挂在**节点**上（`cc.Button` 的 click 本来就是 `node.emit` 出来的）。
        // 点击区在根节点：见文件头「点击区落在根节点上」。
        const button = this.node.getComponent(Button);
        if (!button) {
            // 与 `ChatEntryButton` 同一处置：只说一声、不静默。缺 `cc.Button` 时
            // `Button.EventType.CLICK` 永远不会被 emit，表现是「点了毫无反应且不报错」。
            console.error(`[Hang] ${this.node.name} 上没有 cc.Button，主界面入口点击不会生效`);
        } else {
            button.node.on(Button.EventType.CLICK, this.onClick, this);
        }
        void this.refresh();
    }

    /**
     * ⚠️ 这里**只**做「停表 + 停 tween」，不写 `off(...)`（规则 71）：
     * 同节点组件按 `_components` 序销毁，`cc.Button` 排在脚本前面 ⇒ 它先被 destruct、
     * `node` own property 被置 null ⇒ `this.node.getComponent(Button).node.off(...)` 抛
     * `TypeError` 并**中断整条销毁链**（节点留在父 `children` 里 → 重复销毁）。
     * 不 `off` 是安全的：`Node._onPreDestroyBase` 会先 `_eventProcessor.destroy()` 清空监听。
     */
    protected onDestroy(): void {
        this.unscheduleAllCallbacks();
        this._stopShake();
    }

    // ============================================================
    // 公开入口
    // ============================================================

    /** 打开征收弹窗。`PopupManager` 同类单实例 ⇒ 连点不会叠出第二个面板。 */
    onClick(): void {
        void HangPage.open();
    }

    /** 重读一次数据并铺一次（显隐 / 文案 / 摇摆）。 */
    async refresh(): Promise<void> {
        this.applySnapshot(await hangRepository.load());
    }

    /**
     * 用给定快照铺一次 —— `refresh()` 的**同步核心**。
     *
     * 单独暴露是为了让端到端探针（`tmp/_hang_probe.mjs`）能注入替身快照：
     * 离线预览里 `sweetLevel` 恒 `null`（见文件头），不注入就永远验不到「可见态」。
     */
    applySnapshot(snapshot: IHangSnapshot): void {
        // ---- ① 显隐：老端 `有无扫荡` controller（见文件头）----
        // 🔴 `active` **无条件写**（规则 82）：prefab 里烘的是 `true`（为了 `onLoad` 能跑起来，
        //    见文件头），一旦写成「只在翻转时写」（`if (v !== this._visible) { … }`），
        //    首次调用 `v === true === 缓存初值` 就会**短路不写** ⇒ 不可见的新号永远停在可见态。
        //    代价可忽略：`cc.Node.active` 的 setter 自己会 `if (this._active !== value)` 早退。
        const visible = snapshot.sweetLevel !== null;
        this.node.active = visible;
        if (!visible) {
            this.unscheduleAllCallbacks();
            this._stopShake();
            return;
        }

        // ---- ② 起点：老端 `lastIdleRewardTime || now` ----
        // 为 0 时退到「现在」，否则进度/时长会从 1970 年算起（直接顶到 8h）。
        const start = snapshot.role ? snapshot.role.lastIdleRewardTimeMs : 0;
        this._startMs = start > 0 ? start : Date.now();

        // ---- ③ 文案 + ④ 摇摆 + ⑤ 每秒心跳 ----
        this._tick();
        this.unschedule(this._tick);
        this.schedule(this._tick, 1);
    }

    /** 红点显隐的唯一入口（本轮不接，接口先留好）。 */
    setRedDot(visible: boolean): void {
        if (this.redDot) this.redDot.active = visible;
    }

    // ============================================================
    // 内部
    // ============================================================

    /**
     * 每秒一跳：刷时长文案、按「能不能领」开关摇摆。
     *
     * 到顶（8h）后文案定格在 `08:00:00`、摇摆也已经是循环态 ⇒ 停表
     * （与 `HangPage._tick` 到 `MAX` 就 `unschedule` 同一处置，别让主界面白跑一辈子定时器）。
     */
    private _tick(): void {
        const elapsed = idleElapsedMs(this._startMs, Date.now());
        if (this.timeLabel) this.timeLabel.string = formatHms(idleCappedMs(elapsed));

        if (canClaim(elapsed)) {
            this._startShake();
            if (idleReachedMax(elapsed)) this.unschedule(this._tick);
        } else {
            this._stopShake();
        }
    }

    /** 起摇摆（幂等）。FGUI `t0`：`0 → +8° → -8° → 0`，每段 12 帧。 */
    private _startShake(): void {
        if (this._shaking) return;
        const target = this.shakeNode;
        if (!target || !target.isValid) return;
        this._shaking = true;

        const segment = HJ_ENTRY_SHAKE_SEGMENT_SECONDS;
        const deg = HJ_ENTRY_SHAKE_DEG;
        tween(target)
            .to(segment, { eulerAngles: new Vec3(0, 0, deg) })
            .to(segment, { eulerAngles: new Vec3(0, 0, -deg) })
            .to(segment, { eulerAngles: new Vec3(0, 0, 0) })
            .union()
            .repeatForever()
            .start();
    }

    /**
     * 停摇摆并把角度复位。
     *
     * ⚠️ 复位**必须**判 `isValid`：入口是随宿主 `ArenaRoot` 一起销毁的，`onDestroy` 跑到这里时
     * 子节点内部那个存欧拉角的 `Vec3` 可能已被释放，`setRotationFromEuler` 会抛
     * `TypeError: Cannot set properties of null (setting 'x')` —— 而 `onDestroy` 抛异常会
     * **中断销毁链**（节点留在父 `children` 里 → 下一趟重复 `destroy()`）。
     * 这条在 `activity/ActivityProgressBox.stopBreath()` 上已经踩过一次，照它抄。
     */
    private _stopShake(): void {
        this._shaking = false;
        const target = this.shakeNode;
        if (!target || !target.isValid) return;
        Tween.stopAllByTarget(target);
        // 无条件复位：`repeatForever` 的 tween 被停掉时可能停在任意角度（含 ±8° 附近）。
        target.setRotationFromEuler(0, 0, 0);
    }
}
