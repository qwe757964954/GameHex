/**
 * 主界面左下角「征收（快速扫荡）」入口按钮
 * —— 挂在 `assets/resources/ui/main/ArenaRoot.prefab`（竞技页）根下 `HangEntry`。
 *
 * 与 `chat/ChatEntryButton.ts` 同一类：**竞技页自己的常驻 HUD**，随 `ArenaRoot` 一起实例化 /
 * 销毁 ⇒ 切到角色页时不显示。位置用 `cc.Widget`（`LEFT | BOTTOM`）表达，不写死 `position`。
 *
 * ## 为什么是「手挂一个按钮」而不是 `open.json` 的数据驱动入口
 *
 * 征收**不是** `open.json` 入口行 —— 策划源表 `doc/塔防数据配置/json/client/open.json`（64 行）
 * 与老端 `client/assets/remoteRef/open.json` **都没有 `LayerHang`**。老端是在**主界面
 * `组件_战斗_章节选择`** 里手挂了一个 `快速扫荡` 节点，点它 `CtrlMgr.CtrlHang.openLayerHang()`
 * （`GObjChapterSelect.ts:468`；另一条是通用跳转 `JUMP_TYPE.HANG = 9`）。
 * 所以这里同样手挂，**不登记** `MainEntranceRoute` / `MainEntranceList` —— 塞一个表里不存在的
 * url 会打破 `tests/main-entrance-route.test.ts`「白名单 ⊆ open.json」那条既有守卫。
 * 出处常量见 `HangRepository.HJ_JUMP_TYPE_HANG`。
 *
 * ## 版面真源（三级嵌套，缺一级就偏）
 *
 * | 层 | 文件 | 几何 |
 * |---|---|---|
 * | 主界面 | `主界面_战斗/组件/组件_战斗_主界面.xml` | `size=720,1280` |
 * | 章节选择 | 同上 `组件_章节选择` | `xy=(0,196) size=720,1000` |
 * | 快速扫荡 | `组件/关卡/章节宝箱/组件_战斗_章节选择.xml` 的 `快速扫荡` | `xy=(17,800) size=100,131` + `relation bottom-bottom` |
 * | 本体 | `组件/关卡/组件_战斗_快速扫荡.xml` | 声明 `size=100,120`（实例覆写成 100,131） |
 *
 * ⇒ 屏上框：`left = 17`、`top = 196+800 = 996`、`bottom = 1127`、`size = 100×131`，
 * **底边距 1280 屏底 = 153**（≈ `ChatEntry` 的 `bottom = 152`，两者同一条底线）。
 * ⚠️ 别只看 `组件_战斗_快速扫荡.xml` 的 `size=100,120` —— 那会被实例覆写；
 * 也别把 `xy=(17,800)` 当屏坐标 —— 它的参照系是 720×1000 的 `章节选择`。
 *
 * 内部 displayList（坐标是**组件局部**、y 向下、原点左上；括号里是换算到 Cocos 的 `lpos`）：
 *
 * | FGUI 名 | 类型 | 几何 | 迁成 |
 * |---|---|---|---|
 * | `n60_32bee27d` / `按钮_快速扫荡` | `按钮_公共_通用自动大小_变暗`（`icon=zjm_icon03_ZhengShou`） | `xy=(0,27) size=100,100` ⇒ 中心 `(50,77)` | `Btn` @ `(0,-11.5)` |
 * | `n61` | `image 战斗选关_九宫_信息底01` | `xy=(-32,99) size=163,30` ⇒ 中心 `(49.5,114)` | `Bg` @ `(-0.5,-48.5)`，九宫 `20,7,20,9` |
 * | `n62_32bee27d` / `文本_快速扫荡章节` | `text`（20 号白字居中，`pivot="0.5,0.5"` + `anchor="true"` ⇒ **`xy` 即中心**） | 中心 `(50,114)`、`size=107,29` | `TimeText` @ `(0,-48.5)` |
 * | `n63_vi2v` / `com_rd` | `组件_公用_红点`（`size=30,30`） | `xy=(71,1)` ⇒ 中心 `(86,16)` | `RedDot` @ `(36,49.5)` |
 * | `n64_b8zb` / `clickNode` | `loader`（无 url，纯命中区） | `xy=(-23,-25) size=149,198` | **不迁**：点击交给根节点的 `cc.Button`（见下） |
 *
 * 层序（displayList 序 = 渲染序）：`按钮 → n61 → 文本 → com_rd → clickNode`
 * ⇒ `_children` 必须写成 `[Btn, Bg, TimeText, RedDot]`：底板压在图标的**下沿**之上、文字再压在底板上。
 * 写反了**不报错**，只是底板把图标盖住 / 文字被底板盖住。
 *
 * ## ⚠️ 图标要按 `scaleFree`（contain）渲染，不是拉满 100×100
 *
 * 按钮里那个 loader 写的是 `fill="scaleFree"`（保持比例、完整放进容器），容器 100×100、
 * 贴图 113×102（`zjm_icon03_ZhengShou`）⇒ FGUI 实际渲染 **100 × 90.27**（`scale = 100/113`）。
 * 实测该图不透明外框 = 113×99（底部 3px 透明）⇒ 可见内容缩后 **100 × 87.6**，宽度刚好铺满。
 * 用 `cc.Sprite` 的 `SIMPLE + sizeMode=CUSTOM` 保持节点尺寸即等价，所以 `Btn` 的
 * `UITransform` 写 **100×90.27**（而不是 100×100）—— 写 100×100 会纵向拉伸 11%。
 *
 * ## ⚠️ 点击区落在根节点上，而不是 `Btn` 上
 *
 * 老端的点击目标是 `clickNode`（149×198，比组件本体 100×131 还大，覆盖图标 + 底板 + 文字）。
 * 照搬到 Cocos 就是用根节点的 `cc.Button`（`HangEntry` 的 `UITransform` = 100×131，
 * 把图标、底板、文字都框住），而不是把 `cc.Button` 挂到 100×90.27 的 `Btn` 上 ——
 * 那样点「底下那行时长」会没反应。
 * （`cc.Button` 的 `transition = SCALE` 不需要同节点有 `cc.Sprite`，缩放对象默认取本节点。）
 *
 * ## ⚠️ 文案**不是**「第X章第Y关」
 *
 * FGUI 初值写的是 `第{zhang=1}章第{guan=1}关`，但 `GObjChapterSelect.UpdateView()` 里那段
 * `setVar("zhang"/"guan")` 是**注释掉的**；真正在写它的是 `onTimeLoop()` —— 把**累计挂机时长**
 * 写进去（起点 `CmdRole.lastIdleRewardTime`，先钳 8h 再 `TimeUtil.timeMillisecond2HMSStr`
 * 格式化，每秒刷一次）。也就是「入口上直接显示你已经攒了多久」。
 * 这里照抄同一语义：`formatHms(idleCappedMs(elapsed))`（`Math.ceil` 进位，见 `HangTable`）。
 *
 * ## ⚠️ 可见性：`GetSweetLevel() != null`（一个满星关都没有就整块隐藏）
 *
 * 老端 `UpdateView()`：`GetSweetLevel()` 有值 ⇒ `setSelectedPage("有无扫荡", "有")`，
 * 否则「无」；而 `快速扫荡` 节点上挂着 `<gearDisplay controller="有无扫荡" pages="1"/>`
 * ⇒ 只有「有」那一页才显示。
 *
 * 🔴 **但 prefab 里 `HangEntry._active` 必须烘 `true`**（与 FGUI 设计期默认页「无」相反）：
 * `Component.onLoad` **只在节点被激活时才跑**，烘 `false` ⇒ `onLoad` 永不执行 ⇒
 * `refresh()` 永不执行 ⇒ 就算 `sweetLevel` 真有值也**永远不显示**（死锁）。
 * 烘 `true` 后由 `applySnapshot()` 每趟**无条件**改写（规则 82），
 * 数据源（`RefUtil` 里已加载的表）在一个微任务内返回 ⇒ 实际不会闪帧；
 * 未预热时最多闪一帧，代价远小于死锁。
 *
 * 本地实测（`tmp/_hang_cache_chk.mjs`）：离线 / 新号 `getCmdBattleLevel(1)` 与
 * `getCmdBattleChapter(1)` 全空 ⇒ `sweetLevel === null` ⇒ **编辑器预览里看不到这个按钮**。
 * 这是**与老端一致**的行为（山猫 2026-09-24 拍板「照老端」），不是漏迁；
 * 端到端探针因此走**注入式**（注入替身快照 / 直接 `applySnapshot`）。
 *
 * ## ⚠️ 摇摆动画（FGUI 转场 `t0`）
 *
 * `t0` = `n60_32bee27d` 绕 Z 轴 `0 → +8° → -8° → 0`，每段 12 帧（60fps ⇒ 0.2s）。
 * 老端 `checkHang()` 的条件是 `ModelHang.GetCanReward()`（`now - lastIdleRewardTime >= 1h`）：
 * 真 ⇒ `timeScale = 1` + **无限循环**；假 ⇒ 停表 + `addTimer(GetRemainTime(), checkHang)`。
 *
 * ⚠️ 两处**有意不同**于老端，写在这里免得后面有人「对齐」回去：
 * ① 老端那个 `GetRemainTime()` 返回的是「**已经**攒了多久」（`now - lastIdleRewardTime`），
 *    名字叫 Remain、语义是 Elapsed；刚领完奖励时它 ≈ 0，而 FGUI 的
 *    `Timers.add(0, …)` 在 `now - last >= 0` 恒真 ⇒ **每帧触发**（空转）。
 *    这里直接并进每秒的 `_tick`（老端本来也有 `addTimer(1000, onTimeLoop)`），
 *    观感完全一致（到点就摇），且没有那个空转。
 * ② 老端每次刷新都会先 `timeScale = 4` 快播一遍 `t0`（**不可领取时也播**）；
 *    这里只在可领取时摇，免得面板一切换入口就抖一下。
 *
 * ## 红点
 *
 * FGUI 里留了 `com_rd` 槽位，但**老端代码从没点亮过它** —— `GObjChapterSelect` 里对
 * `快速扫荡.com_rd` 一次 `OnRDUpdate` 都没有（它对 `聊天.com_rd` / `按钮_左|右.com_rd` 都有，
 * 唯独漏了入口），注意力全靠摇摆动画做。
 * ⇒ 按「同步老端」+ 既有「红点统一后面做」口径：节点在 prefab 里**保持隐藏**（`_active=false`），
 * 本类只留引用与 `setRedDot()`，不主动点亮，也不在 `onLoad` 里强改它的 `active`。
 * 形态照抄 `ArenaRoot/ChatEntry/RedDot`（同一张 30×30 占位图，**不是**嵌套 prefab 实例）。
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
        tooltip: '摇摆动画作用的节点（FGUI `按钮_快速扫荡`，`t0` 转场转的就是它，不是根节点）',
    })
    shakeNode: Node = null!;

    @property({ type: Label, tooltip: '挂机时长文案 `08:00:00`（FGUI `文本_快速扫荡章节`）' })
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
