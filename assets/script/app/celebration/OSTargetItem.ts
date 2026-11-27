import { _decorator, Button, Component, Label, Node } from 'cc';
import { RedDot } from '../common/RedDot';
import { osTargetNodeState } from './CelebrationViewState';
import { OSArtStrip } from './OSArtStrip';
import { targetDescTextOf, targetStateOf } from './CelebrationRepository';
import type { CelebrationFrames } from './CelebrationFrames';
import type { ICelebrationSnapshot, ICelebrationTargetRow } from './CelebrationRepository';

const { ccclass, property } = _decorator;

// 三态映射在零 cc 的 CelebrationViewState 里（带 cc 的文件的纯函数进不了 Node 用例）。
// 这里 re-export，外部 import 路径不变。
export { osTargetNodeState } from './CelebrationViewState';
export type { IOsTargetNodeState } from './CelebrationViewState';

/**
 * 庆典目标页的一行（prefab `ui/Celebration/OSRankTargetItem`，659×140）。
 *
 * 三态来自 FGUI `item1` 的 `状态` 控制器 `pages="1,未领取,0,未达标,2,已完成"`。
 * `pages` 按「页 id,页名」交替列出，页下标不等于页 id：下标 0 是页 id 1 → 老端 `Reward`，
 * 下标 1 是页 id 0 → `Unfinished`，下标 2 是页 id 2 → `Received`。
 * 节点 gear 用页 id：`按钮_领取` = 1、`按钮_前往` = 0、`n35` 印章 = 2，三者互斥且覆盖三态。
 *
 * 红点：老端对领取按钮无条件 `OnRDUpdate(1)`，「看得见领取按钮」即「有奖可领」；
 * 前往按钮的 `com_rd` 老端从未写过，恒隐藏。两者都在 `render` 里写死。
 */
@ccclass('OSTargetItem')
export class OSTargetItem extends Component {
    @property({ type: Label, tooltip: 'Desc：{战力口径}达到{N}（FGUI lab_desc）' })
    desc: Label = null!;

    @property({ type: OSArtStrip, tooltip: 'RewardList：横向奖励条（FGUI list）' })
    strip: OSArtStrip = null!;

    @property({ type: Node, tooltip: 'ClaimBtn：领取按钮（FGUI 按钮_领取，状态 页 id 1）' })
    claimBtn: Node = null!;

    @property({ type: RedDot, tooltip: 'ClaimBtn/RedDot：跟随领取按钮（工程通用红点）' })
    claimRedDot: RedDot = null!;

    @property({ type: Node, tooltip: 'GoBtn：前往按钮（FGUI 按钮_前往，状态 页 id 0）' })
    goBtn: Node = null!;

    @property({ type: RedDot, tooltip: 'GoBtn/RedDot：老端从不点亮，恒隐藏（工程通用红点）' })
    goRedDot: RedDot = null!;

    @property({ type: Node, tooltip: 'ClaimedMark：已领取印章（FGUI n35，状态 页 id 2）' })
    claimedMark: Node = null!;

    /**
     * 领取回调，由宿主在每次铺行时重设（见 `OSRankPage`）。
     *
     * 监听绑在实例上（`onLoad` 一次），回调里再取当前行的身份：整行会被虚拟列表 clone 复用，
     * 若在 `render()` 里绑监听，会点第 3 行去领第 1 行的奖（与 `ActivityTaskRow.onAction` 同一处置）。
     */
    onClaim: () => void = null!;

    /** 前往回调（老端 `CtrlJumpView.JumpType(config.goto)`）；本工程跳转链路未接，由宿主提示。 */
    onGoto: () => void = null!;

    protected onLoad(): void {
        // 两个按钮在 FGUI 里都是真按钮，迁过来有 cc.Button。若哪天换成 loader，必须改用 TOUCH_END：
        // 那时只有 cc.Sprite，CLICK 永远不会 emit，点了毫无反应且不报错。
        this.claimBtn.on(Button.EventType.CLICK, this._emitClaim, this);
        this.goBtn.on(Button.EventType.CLICK, this._emitGoto, this);
    }

    private _emitClaim(): void {
        this.onClaim();
    }

    private _emitGoto(): void {
        this.onGoto();
    }

    /** 铺一行；每一处状态都绝对赋值，行会被 clone 复用。 */
    render(snapshot: ICelebrationSnapshot, row: ICelebrationTargetRow, frames: CelebrationFrames): void {
        this.desc.string = targetDescTextOf(snapshot, row);

        const flags = osTargetNodeState(targetStateOf(snapshot, row));
        this.claimBtn.active = flags.claimVisible;
        this.goBtn.active = flags.goVisible;
        this.claimedMark.active = flags.claimedVisible;
        this.claimRedDot.setRedDot(flags.claimVisible);
        this.goRedDot.setRedDot(false);

        this.strip.render(snapshot, row.rewards, frames);
    }
}
