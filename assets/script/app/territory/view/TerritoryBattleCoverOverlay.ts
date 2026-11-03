/**
 * 云盖层的**跨流程宿主**：把"匹配页底下那层云"搬到流程宿主之上，跳到战场之后继续散。
 *
 * ## 为什么需要它（用户 2026-11-02 第三次打回）
 *
 * > 云散开进入战场的动画地图就应该是战场，不能是黑色的地图
 *
 * 旧的时序是「散云 → 散到 60% 才 navigate」。两个毛病叠在一起：
 *  ① 云住在匹配页里，`navigate` 一去 `MatchingComposition.dispose()` 就把页面连同云一起销毁，
 *     最后 40% 那一段**根本没播**；
 *  ② 散开的那 60% 背后是刚被 `hidePageContent()` 关掉的页面（连 `Bg` 都关了），
 *     露出来的是镜头清屏色 —— 玩家看到的就是"云散开 → 一片黑 → 战场"。
 *
 * 现在反过来：**先切战场，再散云**。
 *  ① `closeInstantly()`：藏 UI，并把云搬到这里（挂在宿主**父节点**上 ⇒ 切流程、清宿主节点都带不走它）；
 *  ② 立刻 `navigate`：战场在云**下面**挂起来。云是几百朵密铺、整层不透明、覆盖率 0.998，
 *     所以切场景的全过程玩家一点看不见；
 *  ③ 切换**落定**之后再等 {@link TERRITORY_BATTLE_COVER_RELEASE_DELAY}（让战场先渲染出
 *     一帧），才开始散 ⇒ 散开露出来的就是战场。
 *
 * ## 为什么挂在**流程宿主的父节点**上，而不是宿主底下
 *
 * 🔴 `ZCGame.createGame` 的第一行就是 `this.node.removeAllChildren()` —— 战场要先把宿主节点
 * 清空、再挂自己的 HUD。云要是宿主的子节点，进入战场那一帧就被删掉了（等于没交接）。
 * 所以这一层挂在宿主的**父节点**（`Canvas`）上，紧排在 `Procedure` 之后：
 * 战场全都在 `Procedure` 内部，弹窗挂在 `Popup`，我们正好夹在两者之间。
 *
 * ## 为什么每帧校正一次兄弟位
 *
 * `Canvas` 这一层本来只有 `Camera / Procedure / Popup` 三个，但保不齐以后有人往里插节点；
 * 每帧算一次"应该排在第几"（宿主的 index + 1），不一致才写一次，代价可以忽略。
 *
 * ## 兜底
 *
 * 流程切换迟迟不落定（战场预加载卡住 / 路由没注册）时，最多再等
 * {@link TERRITORY_BATTLE_COVER_RELEASE_MAX_WAIT} 就强行散云 —— 不能让玩家永远盯着一屏云。
 */

import { _decorator, Component, Node, Vec3 } from 'cc';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
import { TerritoryBattleCover } from './TerritoryBattleCover';

const { ccclass } = _decorator;

/** 覆盖层的节点名（用例/调试按名字找）。 */
export const TERRITORY_BATTLE_COVER_OVERLAY_NODE = 'BattleCoverOverlay';

/**
 * 切换落定之后、开始散云之前再等多久（秒）。
 *
 * 为什么不是 0：`onSwitchSettled` 在 `onEnter` **之前**同步触发，战场上那些地块 / HUD 是
 * 在 `onEnter` 里现建的。等两三个渲染帧，散到半透明时底下已经有画面了。
 */
export const TERRITORY_BATTLE_COVER_RELEASE_DELAY = 0.1;

/** 切换一直不落定时，最多再等这么久就强行散（秒）。 */
export const TERRITORY_BATTLE_COVER_RELEASE_MAX_WAIT = 3;

@ccclass('TerritoryBattleCoverOverlay')
export class TerritoryBattleCoverOverlay extends Component {
    private cover: TerritoryBattleCover | null = null;
    /** 收到"切场了，准备散"的时刻（秒，本层自己的时钟）；`< 0` = 还没收到。 */
    private armedAt = -1;
    /** 流程切换落定的时刻；`< 0` = 还没落定。 */
    private settledAt = -1;
    /** 真正开始散场的时刻；`< 0` = 还没散。 */
    private releasedAt = -1;
    private elapsed = 0;
    private stopSwitchWatch: (() => void) | null = null;
    /** 战场（流程宿主）节点：这一层永远是它的下一个兄弟。 */
    private anchor: Node | null = null;

    /**
     * 把已经建好的云搬到**宿主的旁边**（就绪的云层才会搬）。
     *
     * @returns 接管成功返回组件，宿主/云层不合法返回 `null`（调用方按"没有云"降级）
     */
    static create(host: Node, cover: TerritoryBattleCover): TerritoryBattleCoverOverlay | null {
        if (!host?.isValid || !cover?.built) return null;
        // 🔴 挂宿主的**父节点**：战场进入时会 `host.removeAllChildren()`（见类注释）。
        const parent = host.parent?.isValid ? host.parent : host;
        const node = new Node(TERRITORY_BATTLE_COVER_OVERLAY_NODE);
        node.layer = parent.layer;
        node.setParent(parent);
        node.setPosition(Vec3.ZERO);
        node.setSiblingIndex(Math.min(parent.children.length - 1, host.getSiblingIndex() + 1));
        const overlay = node.addComponent(TerritoryBattleCoverOverlay);
        overlay.anchor = host;
        overlay.adopt(cover);
        return overlay;
    }

    /** 当前是否还盖着（用例/调试可读）。 */
    get covering(): boolean {
        return !!this.cover?.built && !!this.node?.isValid;
    }

    private adopt(cover: TerritoryBattleCover): void {
        this.cover = cover;
        const layer = cover.layerNode;
        // 世界坐标不变：匹配页节点与这一层都在 (0,0)、没有缩放，直接换父节点不会有位移。
        if (layer?.isValid) layer.setParent(this.node);
    }

    /**
     * 收到"开始切场了"：从现在起等流程切换落定，落定后再等一小会儿就散。
     *
     * 必须在 `navigate` **之后**立刻调：`ProcedureManager.onSwitchSettled` 只播**之后**的
     * 切换结果；提前订阅会收不到自己那一次，只能等到兜底超时。
     */
    arm(): void {
        if (this.armedAt >= 0 || !this.node?.isValid) return;
        this.armedAt = this.elapsed;
        if (!ProcedureManager.instance) {
            // 没有管理器（单测/脱离流程跑）：当作"已经落定"，到点就散。
            this.settledAt = this.elapsed;
            return;
        }
        this.stopSwitchWatch = ProcedureManager.onSwitchSettled(() => {
            this.stopSwitchWatch?.();
            this.stopSwitchWatch = null;
            if (this.settledAt < 0) this.settledAt = this.elapsed;
        });
    }

    update(dt: number): void {
        const cover = this.cover;
        if (!cover) { this.finish(); return; }
        this.keepOnTop();
        const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
        this.elapsed += step;
        if (this.armedAt >= 0 && this.releasedAt < 0) {
            const settled = this.settledAt >= 0 && this.elapsed - this.settledAt >= TERRITORY_BATTLE_COVER_RELEASE_DELAY;
            const expired = this.elapsed - this.armedAt >= TERRITORY_BATTLE_COVER_RELEASE_MAX_WAIT;
            if (settled || expired) {
                // 已经起散就不用再听流程切换了（超时那条路尤其要退订，否则监听会一直挂着）。
                this.stopSwitchWatch?.();
                this.stopSwitchWatch = null;
                cover.startRelease();
                this.releasedAt = this.elapsed;
            }
        }
        cover.tick(step);
        if (this.releasedAt >= 0 && cover.releaseFinished) this.finish();
    }

    protected onDestroy(): void {
        this.stopSwitchWatch?.();
        this.stopSwitchWatch = null;
        this.releaseCover();
    }

    /** 战场 / 主界面已经现过面（或云散完）：整层连节点一起收掉。 */
    private finish(): void {
        this.stopSwitchWatch?.();
        this.stopSwitchWatch = null;
        this.releaseCover();
        if (this.node?.isValid) this.node.destroy();
    }

    /**
     * 放掉这一屏云。
     *
     * 🔴 必须走 `cover.dispose()` 而不是只把节点删掉：云的帧属于**匹配页那个资源作用域**，
     * 页面离开时已经被 `decRef` 过一次，全靠盖层自己那一份引用撑着。这里不还回去，
     * 那几帧就永远掉不出 0（内存里常驻一屏云图）。
     */
    private releaseCover(): void {
        const cover = this.cover;
        this.cover = null;
        cover?.dispose();
    }

    private keepOnTop(): void {
        const node = this.node;
        const anchor = this.anchor;
        const parent = node?.parent;
        if (!node?.isValid || !parent?.isValid) return;
        // 只在"兄弟树还认得出来"的时候校正：宿主被销毁 / 换父节点就不再管（这层马上也会收掉）。
        if (anchor?.isValid && anchor.parent === parent) {
            const target = Math.min(parent.children.length - 1, anchor.getSiblingIndex() + 1);
            if (node.getSiblingIndex() !== target) node.setSiblingIndex(target);
            return;
        }
        const last = parent.children.length - 1;
        if (node.getSiblingIndex() !== last) node.setSiblingIndex(last);
    }
}
