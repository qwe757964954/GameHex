import { _decorator, Color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import type { ResBarSlot } from './MainResBarTypes';
import { loadResBarSprite } from './MainResBarArt';
import {
    formatResBarCountText,
    parseResBarCountText,
    resBarCountValue,
    resBarHitFx,
    resBarSpendColor,
    resBarSpendFx,
    type IResBarCountText,
} from './MainResBarFeedback';

const { ccclass, property } = _decorator;

/**
 * 资源栏里的一个资源格。
 *
 * ## 除了「画一格」，它还负责两条反馈时间轴
 *
 * | 反馈 | 入口 | 表现 |
 * |---|---|---|
 * | **加**（宝箱 / 飘字飞进来） | {@link playGainFeedback} | 图标弹一下 + 数字从「原值」滚到「新值」 |
 * | **扣**（2026-11-02） | {@link playSpendFeedback} | 数字**显红** + 跳一下，**跳完才**滚到扣后值 |
 *
 * 两条曲线都在 `MainResBarFeedback`（纯函数、零 cc），本文件只做「取 fx → 写节点」。
 *
 * ⚠️ **不用 tween**（全工程口径，规则 106/247）：这里只记 `hitElapsed` / `spendElapsed`，
 * 每帧由 {@link step} 向模型要一个 `fx` 再写节点。
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

    // ── 加：击中反馈（`hitElapsed < 0` = 没在播）──────────────────────────────
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

    // ── 扣：显红 + 跳动 + 再扣（`spendElapsed < 0` = 没在播）────────────────
    private spendElapsed = -1;
    private spendFrom = 0;
    private spendTo = 0;
    private spendBase: IResBarCountText = { value: 0, suffix: '' };
    /** 数字节点的原始 y（`labelHop` 是相对它的位移）。 */
    private labelBaseY = 0;
    /** 数字的**常态字色**（prefab 里那一档）—— 显红时从这个值混向红，收尾混回来。 */
    private readonly labelBaseColor = new Color(255, 255, 255, 255);
    /**
     * 上一次**落定**在 label 上的数值（首帧前 / 整格隐藏后为 `null`）。
     *
     * 用途单一：`ResBar` 每次重渲染前拿它和新值比，**变小了就是一次扣除** ⇒
     * 扣除反馈不需要每个花钱的地方各自调一次（漏一处就少一处反馈）。
     */
    private settledValue: number | null = null;

    onLoad(): void {
        this.icon.trim = false;
        this.icon.sizeMode = Sprite.SizeMode.CUSTOM;
        this.iconBaseScale = this.icon.node.scale.x;
        this.labelBaseScale = this.valueLabel.node.scale.x;
        this.labelBaseY = this.valueLabel.node.position.y;
        this.labelBaseColor.set(this.valueLabel.color);
    }

    /** 反馈是否在播（`ResBar` 用它决定还要不要继续 `update`）。 */
    get isFeedbackPlaying(): boolean {
        return this.hitElapsed >= 0 || this.spendElapsed >= 0;
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
        // 两条时间轴不能同时写一个 label：新的一次反馈直接接管（后到的说了算）。
        this.cancelSpend();
        const base = parseResBarCountText(this.valueLabel.string);
        this.hitBase = base;
        this.hitTo = base.value;
        const delta = Number.isFinite(amount) && amount > 0 ? amount : 0;
        this.hitFrom = Math.max(0, this.hitTo - delta);
        this.pendingValueText = null;
        this.hitElapsed = 0;
        this.applyHit();
    }

    /**
     * 新文本比「落定值」**少多少**；`0` = 没扣（涨了 / 首帧 / 文本解析不出数字）。
     *
     * 调用方（`ResBar.reload`）据此决定要不要播扣除反馈；`> 0` 时把同一个 `valueText`
     * 原样传给 {@link playSpendFeedback}，两边对"扣到多少"的口径就只有一个来源。
     */
    spendDeltaOf(valueText: string): number {
        if (this.settledValue === null) return 0;
        const next = parseResBarCountText(valueText).value;
        const delta = this.settledValue - next;
        return delta > 0 ? delta : 0;
    }

    /**
     * 播一次「资源被扣除」：数字**先显红并跳一下**，跳完才从「扣前值」滚到「扣后值」。
     *
     * @param amount 扣了多少（`<= 0` / 非有限数 ⇒ 整段跳过：没扣就别演）。
     * @param valueText 扣完之后的**显示文本**（带 `当前/上限` 那种后缀）。不传则用 label
     *   当前的文本当作"已经扣完"——只给「值已经落地、但走不到 `render`」的调用方用。
     *
     * 🔴 顺序不能反：如果先把新值写进 label 再演，玩家看到的是「先扣、再变红」，
     *    与需求「显红、跳动、**再**扣除」正好相反。所以这里立刻把 label 钉回 `spendFrom`。
     */
    playSpendFeedback(amount: number, valueText?: string): void {
        if (!this.node.active) return;
        if (!Number.isFinite(amount) || amount <= 0) return;
        this.cancelHit();
        const base = parseResBarCountText(valueText ?? this.valueLabel.string);
        this.spendBase = base;
        this.spendTo = base.value;
        this.spendFrom = this.spendTo + Math.max(1, Math.round(amount));
        this.pendingValueText = valueText ?? null;
        this.spendElapsed = 0;
        this.applySpend();
    }

    /** 逐帧推进（两条时间轴互斥）；`true` = 还在播。 */
    step(dt: number): boolean {
        const safe = Number.isFinite(dt) && dt > 0 ? dt : 0;
        let busy = false;
        if (this.hitElapsed >= 0) {
            this.hitElapsed += safe;
            if (!resBarHitFx(this.hitElapsed)) this.finishHit();
            else {
                this.applyHit();
                busy = true;
            }
        }
        if (this.spendElapsed >= 0) {
            this.spendElapsed += safe;
            if (!resBarSpendFx(this.spendElapsed)) this.finishSpend();
            else {
                this.applySpend();
                busy = true;
            }
        }
        return busy;
    }

    /** 立刻中止（整格隐藏 / 数据重置）：复原缩放、位移、字色，并吞掉暂存值。 */
    cancelFeedback(): void {
        this.cancelHit();
        this.cancelSpend();
        this.pendingValueText = null;
        this.settledValue = null;
    }

    /** @param slot null = 整格隐藏。 */
    render(slot: ResBarSlot | null): void {
        if (!slot) {
            this.cancelFeedback();
            this.node.active = false;
            return;
        }
        this.node.active = true;
        // 反馈在播 ⇒ 只暂存（见 `pendingValueText` 的注释）；否则照旧直写，并记下落定值。
        if (this.isFeedbackPlaying) this.pendingValueText = slot.valueText;
        else {
            this.valueLabel.string = slot.valueText;
            this.settledValue = parseResBarCountText(slot.valueText).value;
        }
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
        this.settledValue = parseResBarCountText(this.valueLabel.string).value;
    }

    /** 按当前 `spendElapsed` 写一帧（缩放 + 位移 + 字色 + 文本）。 */
    private applySpend(): void {
        const fx = resBarSpendFx(this.spendElapsed);
        if (!fx) return;
        this.icon.node.setScale(this.iconBaseScale * fx.iconScale, this.iconBaseScale * fx.iconScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale * fx.labelScale, this.labelBaseScale * fx.labelScale, 1);
        this.valueLabel.node.setPosition(this.valueLabel.node.position.x, this.labelBaseY + fx.labelHop, 0);
        const [r, g, b] = resBarSpendColor(
            [this.labelBaseColor.r, this.labelBaseColor.g, this.labelBaseColor.b],
            fx.redStrength,
        );
        this.valueLabel.color = new Color(r, g, b, this.labelBaseColor.a);
        const value = resBarCountValue(this.spendFrom, this.spendTo, fx.countRatio);
        this.valueLabel.string = formatResBarCountText(this.spendBase, value);
    }

    /** 收尾：缩放 / 位移 / 字色全部复原，扣后值落地。 */
    private finishSpend(): void {
        this.spendElapsed = -1;
        this.icon.node.setScale(this.iconBaseScale, this.iconBaseScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale, this.labelBaseScale, 1);
        this.valueLabel.node.setPosition(this.valueLabel.node.position.x, this.labelBaseY, 0);
        this.valueLabel.color = new Color(
            this.labelBaseColor.r, this.labelBaseColor.g, this.labelBaseColor.b, this.labelBaseColor.a);
        const pending = this.pendingValueText;
        this.pendingValueText = null;
        this.valueLabel.string = pending ?? formatResBarCountText(this.spendBase, this.spendTo);
        this.settledValue = parseResBarCountText(this.valueLabel.string).value;
    }

    /** 中止「加」的那条时间轴（不碰扣的那条，也不碰暂存值）。 */
    private cancelHit(): void {
        if (this.hitElapsed < 0) return;
        this.hitElapsed = -1;
        this.icon.node.setScale(this.iconBaseScale, this.iconBaseScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale, this.labelBaseScale, 1);
    }

    /** 中止「扣」的那条时间轴：字色 / 位移必须一起复原，否则会留一格红字。 */
    private cancelSpend(): void {
        if (this.spendElapsed < 0) return;
        this.spendElapsed = -1;
        this.icon.node.setScale(this.iconBaseScale, this.iconBaseScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale, this.labelBaseScale, 1);
        this.valueLabel.node.setPosition(this.valueLabel.node.position.x, this.labelBaseY, 0);
        this.valueLabel.color = new Color(
            this.labelBaseColor.r, this.labelBaseColor.g, this.labelBaseColor.b, this.labelBaseColor.a);
    }
}
