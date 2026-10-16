import { _decorator, Component, Label, Node } from 'cc';
import { osTargetNodeState } from './CelebrationViewState';
import { OSArtStrip } from './OSArtStrip';
import { targetDescTextOf, targetStateOf } from './CelebrationRepository';
import type { CelebrationFrames } from './CelebrationFrames';
import type { ICelebrationSnapshot, ICelebrationTargetRow } from './CelebrationRepository';

const { ccclass, property } = _decorator;

/**
 * 庆典目标页的**一行**（prefab `ui/Celebration/OSRankTargetItem`，659×140）。
 *
 * ## 三态从哪来（FGUI `item1` 的 `状态` 控制器）
 *
 * ```xml
 * <controller name="状态" pages="1,未领取,0,未达标,2,已完成" selected="0"/>
 * ```
 *
 * 🔴 `pages` 是 `页id,页名` 交替列出的 ⇒ **页下标 ≠ 页 id**：
 *
 * | 页下标 | 页 id | 页名 | 老端 `setSelectedIndex(state)` 的 state |
 * |---|---|---|---|
 * | 0 | `1` | 未领取 | `Reward = 0`（可领取） |
 * | 1 | `0` | 未达标 | `Unfinished = 1` |
 * | 2 | `2` | 已完成 | `Received = 2` |
 *
 * 节点上的 gear 用的是**页 id**：`按钮_领取` = `pages="1"`（未领取）、
 * `按钮_前往` = `pages="0"`（未达标）、`n35`（已领取印章）= `pages="2"`（已完成）。
 * 三者**互斥**，且覆盖全部三态 ⇒ Cocos 里就是三个节点的 `active`，本组件**无条件写**（规则 82）。
 *
 * ## 红点：`按钮_领取` 上的**常亮**（不是页驱动）
 *
 * 老端 `renderTargetListItem` 里对领取按钮的红点是**无条件** `rd.OnRDUpdate(1)` ——
 * 也就是说「能看见领取按钮」本身就意味着「有奖可领」，红点只是个视觉强调，**永远亮**。
 * `按钮_前往` 的 `com_rd` 老端**一次都没写过** ⇒ 恒隐藏。
 * 两者都在本组件里显式写死（prefab 里烘的是隐藏，因为红点属于「设计期隐藏」那一类）。
 */

// 三态 ↔ 三个节点的对应关系已抽到零 `cc` 的 `CelebrationViewState`（规则 78：带 `cc` 的文件里的
// 纯函数，Node 用例 import 不进来 ⇒ 会永久脱离回归网）。这里 re-export ⇒ 外部 import 路径不变。
export { osTargetNodeState } from './CelebrationViewState';
export type { IOsTargetNodeState } from './CelebrationViewState';

@ccclass('OSTargetItem')
export class OSTargetItem extends Component {
    @property({ type: Label, tooltip: 'Desc：`{战力口径}达到{N}`（FGUI `lab_desc`）' })
    desc: Label = null!;

    @property({ type: OSArtStrip, tooltip: 'RewardList：横向奖励条（FGUI `list`）' })
    strip: OSArtStrip = null!;

    @property({ type: Node, tooltip: 'ClaimBtn：领取按钮（FGUI `按钮_领取`，`状态` 页 id `1`）' })
    claimBtn: Node = null!;

    @property({ type: Node, tooltip: 'ClaimBtn/RedDot：老端**常亮**（见文件头）' })
    claimRedDot: Node = null!;

    @property({ type: Node, tooltip: 'GoBtn：前往按钮（FGUI `按钮_前往`，`状态` 页 id `0`）' })
    goBtn: Node = null!;

    @property({ type: Node, tooltip: 'GoBtn/RedDot：老端从不点亮 ⇒ 恒隐藏' })
    goRedDot: Node = null!;

    @property({ type: Node, tooltip: 'ClaimedMark：已领取印章（FGUI `n35`，`状态` 页 id `2`）' })
    claimedMark: Node = null!;

    /**
     * 领取回调 —— **由宿主在每次铺行时重设**（`OSRankPage.renderTargetRow`）。
     *
     * ⚠️ 不能在 `render()` 里绑监听：整行会被虚拟列表 clone 复用，同一个实例会被赋予不同的行；
     * 监听绑在**实例**上（`onLoad` 一次），回调里再取「当前行的身份」，才不会点第 3 行去领第 1 行的奖
     * （与 `ActivityTaskRow.onAction` 同一处置）。
     */
    onClaim: (() => void) | null = null;

    /** 前往回调（老端 `CtrlJumpView.JumpType(config.goto)`）；本工程跳转链路未接 ⇒ 宿主提示。 */
    onGoto: (() => void) | null = null;

    protected onLoad(): void {
        // ⚠️ `cc.Button` 的 click 就是 `node.emit` 出来的 ⇒ 监听节点与监听组件等价。
        // ⚠️ 这两个按钮在 FGUI 里是**真 `<component>` 按钮**（`按钮_公共_多颜色_二级_变暗狂欢`），
        //    迁过来有 `cc.Button`。若哪天换成 `loader`，必须改 `Node.EventType.TOUCH_END`
        //    （规则 81b：`<loader>` 只有 `cc.Sprite`，CLICK 永远不会 emit，点了毫无反应且不报错）。
        this.claimBtn?.on('click', this._emitClaim, this);
        this.goBtn?.on('click', this._emitGoto, this);
    }

    private _emitClaim(): void {
        this.onClaim?.();
    }

    private _emitGoto(): void {
        this.onGoto?.();
    }

    /**
     * 铺一行。
     *
     * ⚠️ 每一处状态都**绝对赋值**（规则 10）—— 行会被 clone 复用。
     */
    render(snapshot: ICelebrationSnapshot, row: ICelebrationTargetRow, frames: CelebrationFrames): void {
        if (this.desc) this.desc.string = targetDescTextOf(snapshot, row);

        const state = targetStateOf(snapshot, row);
        const flags = osTargetNodeState(state);
        // 🔴 显隐**无条件写**（规则 82）：prefab 会照原稿烘出非零默认值，
        //    「只在翻转时写」会让首次 `新值 === 缓存初值` 短路，永久停在错的初始态。
        if (this.claimBtn) this.claimBtn.active = flags.claimVisible;
        if (this.goBtn) this.goBtn.active = flags.goVisible;
        if (this.claimedMark) this.claimedMark.active = flags.claimedVisible;
        // 老端：领取按钮的红点**常亮**、前往按钮的红点**从不点亮**（见文件头）。
        if (this.claimRedDot) this.claimRedDot.active = flags.claimVisible;
        if (this.goRedDot) this.goRedDot.active = false;

        if (this.strip) this.strip.render(snapshot, row.rewards, frames);
    }
}
