import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import type { ResBarSlot } from './MainResBarTypes';
import { loadResBarSprite } from './MainResBarArt';
import {
    formatResBarCountText,
    parseResBarCountText,
    resBarCountValue,
    resBarHitFx,
    type IResBarCountText,
} from './MainResBarFeedback';

const { ccclass, property } = _decorator;

/**
 * 资源栏里的一个资源格。
 *
 * ## 除了「画一格」，它还负责「被击中」的反馈
 *
 * 宝箱 / 飘字类的奖励会**飞进**这一格（`TerritoryChestView` 的飞行图标），落地那一刻
 * 页面调 {@link playGainFeedback} —— 图标弹一下、数字从「原值」滚到「新值」。
 *
 * ⚠️ **不用 tween**（全工程口径，规则 106/247）：这里只记 `hitElapsed`，
 * 每帧由 {@link step} 向 `MainResBarFeedback` 要一个 `fx` 再写节点。
 * 组件自己不挂 `update` —— 由 `ResBar.update` 统一推进（一条资源栏只有一个心跳）。
 */
@ccclass('MainResBarSlot')
export class MainResBarSlot extends Component {
    @property({ type: Sprite, tooltip: 'Icon：资源图标' })
    icon: Sprite = null;

    @property({ type: Label, tooltip: 'Value：数值（体力是 当前/上限）' })
    valueLabel: Label = null;

    /**
     * Plus：补货加号。**设计上可选** —— 只有「能补货」的格子（体力这类）才配这个节点，
     * 商城的金币 / 钻石格本来就没有加号 ⇒ 它挂 `ResBar` 时不绑这一项。
     *
     * ⚠️ 与规则 109「已绑的 `@property` 一律不判空」不冲突：那条管的是**绑错了不许静默**；
     * 这里是「本格没有加号」这种**合法配置**，所以按可选处理，不是防编辑器漏绑。
     * 判据：`render(null)` 之外，`showPlus` 为 false 的格子在任何宿主下都不需要这个节点。
     */
    @property({ type: Node, tooltip: 'Plus：补货加号（只有可补货的格子才有，如体力格；没有就留空）' })
    plus: Node | null = null;

    @property({ type: SpriteFrame, tooltip: 'Optional icon supplied by the host prefab; otherwise use the resource table icon' })
    iconOverride: SpriteFrame | null = null;

    @property({ tooltip: 'Keep the add affordance visible for this host appearance' })
    alwaysShowPlus = false;

    /** 防串图令牌：异步回调回来时数据可能已换。 */
    private token = 0;

    // ── 击中反馈（`hitElapsed < 0` = 没在播）──────────────────────────────
    private hitElapsed = -1;
    /** 滚动起点 / 终点（整数，含后缀单独存）。 */
    private hitFrom = 0;
    private hitTo = 0;
    private hitBase: IResBarCountText = { value: 0, suffix: '' };
    /**
     * 反馈期间到达的**新数值文本**（`render` 只暂存、不写）。
     *
     * 为什么不能直接写：数字滚动途中被 `CmdRole` 的推包重写一次，玩家看到的是
     * 「滚到一半突然跳回新值」—— 比不滚还糟。所以攒到收尾再落地。
     */
    private pendingValueText: string | null = null;
    /** 基准缩放（prefab 上的原值；反馈只写「基准 × fx」，不覆盖宿主的美术设定）。 */
    private iconBaseScale = 1;
    private labelBaseScale = 1;

    onLoad(): void {
        this.icon.trim = false;
        this.icon.sizeMode = Sprite.SizeMode.CUSTOM;
        this.iconBaseScale = this.icon.node.scale.x;
        this.labelBaseScale = this.valueLabel.node.scale.x;
    }

    /** 反馈是否在播（`ResBar` 用它决定还要不要继续 `update`）。 */
    get isFeedbackPlaying(): boolean {
        return this.hitElapsed >= 0;
    }

    /**
     * 播一次「被奖励击中」：图标弹一下 + 数字从 `当前值 - amount` 滚到 `当前值`。
     *
     * ## `amount` 与「当前值」的关系（为什么从 label 反读，不读缓存）
     *
     * 此刻 label 上已经是**发奖后**的数值（`CmdRole` 的推包早于开箱表演落地），
     * 所以「原值 = 当前值 - amount」是唯一说得通的读法；`roleProperty` 里的 `endMax`
     * 之类也没法反推。
     *
     * `amount <= 0` / 文本解析不出数字（登录前骨架期）⇒ **只弹跳不滚动**：
     * 宁可少一段动画，也不要显示一个凭空算出来的数。
     */
    playGainFeedback(amount: number): void {
        if (!this.node.active) return;
        const base = parseResBarCountText(this.valueLabel.string);
        this.hitBase = base;
        this.hitTo = base.value;
        const delta = Number.isFinite(amount) && amount > 0 ? amount : 0;
        this.hitFrom = Math.max(0, this.hitTo - delta);
        this.pendingValueText = null;
        this.hitElapsed = 0;
        this.applyHit();
    }

    /** 逐帧推进；`true` = 还在播。 */
    step(dt: number): boolean {
        if (this.hitElapsed < 0) return false;
        this.hitElapsed += Number.isFinite(dt) && dt > 0 ? dt : 0;
        if (!resBarHitFx(this.hitElapsed)) {
            this.finishHit();
            return false;
        }
        this.applyHit();
        return true;
    }

    /** 立刻中止（整格隐藏 / 数据重置）：复原缩放并吞掉暂存值。 */
    cancelFeedback(): void {
        if (this.hitElapsed < 0) return;
        this.hitElapsed = -1;
        this.pendingValueText = null;
        this.icon.node.setScale(this.iconBaseScale, this.iconBaseScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale, this.labelBaseScale, 1);
    }

    /** @param slot null = 整格隐藏。 */
    render(slot: ResBarSlot | null): void {
        if (!slot) {
            this.cancelFeedback();
            this.node.active = false;
            return;
        }
        this.node.active = true;
        // 反馈在播 ⇒ 只暂存（见 `pendingValueText` 的注释）；否则照旧直写。
        if (this.hitElapsed >= 0) this.pendingValueText = slot.valueText;
        else this.valueLabel.string = slot.valueText;
        if (this.plus) this.plus.active = this.alwaysShowPlus || slot.showPlus;

        const current = ++this.token;
        if (this.iconOverride) {
            this.icon.spriteFrame = this.iconOverride;
            return;
        }
        if (!slot.iconArt) {
            this.icon.spriteFrame = null;
            return;
        }
        void loadResBarSprite(slot.iconArt).then((frame) => {
            if (!this.isValid || current !== this.token) return;
            if (frame) this.icon.spriteFrame = frame;
        });
    }

    /** 按当前 `hitElapsed` 写一帧（缩放 + 文本）。 */
    private applyHit(): void {
        const fx = resBarHitFx(this.hitElapsed);
        if (!fx) return;
        this.icon.node.setScale(this.iconBaseScale * fx.iconScale, this.iconBaseScale * fx.iconScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale * fx.labelScale, this.labelBaseScale * fx.labelScale, 1);
        const value = resBarCountValue(this.hitFrom, this.hitTo, fx.countRatio);
        this.valueLabel.string = formatResBarCountText(this.hitBase, value);
    }

    /** 收尾：复原缩放，把暂存的新文本落地（没有暂存就落到滚动终点）。 */
    private finishHit(): void {
        this.hitElapsed = -1;
        this.icon.node.setScale(this.iconBaseScale, this.iconBaseScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale, this.labelBaseScale, 1);
        const pending = this.pendingValueText;
        this.pendingValueText = null;
        this.valueLabel.string = pending ?? formatResBarCountText(this.hitBase, this.hitTo);
    }
}
