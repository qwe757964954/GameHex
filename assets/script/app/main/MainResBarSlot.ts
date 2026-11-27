import { _decorator, Color, Component, instantiate, Label, Node, Prefab, Sprite, SpriteFrame, UITransform } from 'cc';
import { formatResBarAmountText, type ResBarSlot } from './MainResBarTypes';
import { loadResBarSprite } from './MainResBarArt';
import {
    formatResBarSpendFloat,
    resBarCountValue,
    resBarHitFx,
    resBarSpendFlashColor,
    resBarSpendFloatFx,
    resBarSpendFx,
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
 * | **扣**（2026-11-02，2026-11-03 改口径） | {@link playSpendFeedback} | 数字**白色闪烁** + 跳一下，**跳完才**滚到扣后值；同时上方飘一条 `-N` |
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
    valueLabel: Label = null!;

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

    @property({ type: Prefab, tooltip: 'SpendFloat：扣减飘字模板（字号/描边/锚点都在 prefab 里）' })
    spendFloatPrefab: Prefab | null = null;

    @property({ type: SpriteFrame, tooltip: 'Optional icon supplied by the host prefab; otherwise use the resource table icon' })
    iconOverride: SpriteFrame | null = null;

    @property({ tooltip: 'Keep the add affordance visible for this host appearance' })
    alwaysShowPlus = false;

    /** 防串图令牌：异步回调回来时数据可能已换。 */
    private token = 0;

    // ── 加：击中反馈（`hitElapsed < 0` = 没在播）──────────────────────────────
    private hitElapsed = -1;
    /** 滚动起点 / 终点（原始整数）。 */
    private hitFrom = 0;
    private hitTo = 0;
    /**
     * 反馈期间到达的**新的一格数据**（`render` 只暂存、不写）。
     *
     * 为什么不能直接写：数字滚动途中被 `CmdRole` 的推包重写一次，玩家看到的是
     * 「滚到一半突然跳回新值」—— 比不滚还糟。所以攒到收尾整格落地。
     */
    private pendingSlot: ResBarSlot | null = null;
    /** 基准缩放（prefab 上的原值；反馈只写「基准 × fx」，不覆盖宿主的美术设定）。 */
    private iconBaseScale = 1;
    private labelBaseScale = 1;

    // ── 扣：白色闪烁 + 跳动 + 再扣 + 上方飘 `-N`（`spendElapsed < 0` = 没在播）────────
    private spendElapsed = -1;
    private spendFrom = 0;
    private spendTo = 0;
    /** 这一笔扣了多少（飘字文本用）。 */
    private spendAmount = 0;
    /** 数字节点的原始 y（`labelHop` 是相对它的位移）。 */
    private labelBaseY = 0;
    /** 数字的**常态字色**（prefab 里那一档）—— 闪烁时从这个值混向纯白，收尾混回来。 */
    private readonly labelBaseColor = new Color(255, 255, 255, 255);
    /** 上方飘字节点（懒建，见 {@link ensureSpendFloat}）。 */
    private spendFloat: Node | null = null;
    private spendFloatLabel: Label | null = null;
    /** 飘字起点的本地坐标（`y` = 槽位半高 + prefab 根节点的初始 y 偏移）。 */
    private spendFloatStartY = 0;
    private spendFloatX = 0;
    /**
     * 上一次**落定**在 label 上的原始数值（首帧前 / 整格隐藏后为 `null`）。
     *
     * 用途单一：`ResBar` 每次重渲染前拿它和新值比，**变小了就是一次扣除** ⇒
     * 扣除反馈不需要每个花钱的地方各自调一次（漏一处就少一处反馈）。
     */
    private settledValue: number | null = null;
    /**
     * 落定值的**换算口径**（资源键 + 体力上限）。
     *
     * 读数在滚动途中要按同一口径重算文本 —— 显示文本已经缩写（`122.3M`），
     * 反解析不回原值，所以口径必须单独记着。
     */
    private settledKey = '';
    private settledCap = 0;

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
     * ## `amount` 与「当前值」的关系（为什么读落定值，不读缓存）
     *
     * 此刻落定值已经是**发奖后**的数值（`CmdRole` 的推包早于开箱表演落地，`render` 已写完），
     * 所以「原值 = 当前值 - amount」是唯一说得通的读法；`roleProperty` 里的 `endMax`
     * 之类也没法反推。
     *
     * `amount <= 0` / 首次渲染前（`settledValue === null`）⇒ **只弹跳不滚动**：
     * 宁可少一段动画，也不要显示一个凭空算出来的数。
     */
    playGainFeedback(amount: number): void {
        if (!this.node.active) return;
        // 两条时间轴不能同时写一个 label：新的一次反馈直接接管（后到的说了算）。
        this.cancelSpend();
        const to = Math.max(0, this.settledValue ?? 0);
        this.hitTo = to;
        const delta = Number.isFinite(amount) && amount > 0 ? amount : 0;
        this.hitFrom = Math.max(0, to - delta);
        this.pendingSlot = null;
        this.hitElapsed = 0;
        this.applyHit();
    }

    /**
     * 新数值比「落定值」**少多少**；`0` = 没扣（涨了 / 首帧 / 数据脏）。
     *
     * 调用方（`ResBar.reload`）据此决定要不要播扣除反馈；`> 0` 时把同一格（含扣后原值）
     * 原样传给 {@link playSpendFeedback}，两边对"扣到多少"的口径就只有一个来源。
     */
    spendDeltaOf(amount: number): number {
        if (this.settledValue === null) return 0;
        const next = Number.isFinite(amount) ? amount : 0;
        const delta = this.settledValue - next;
        return delta > 0 ? delta : 0;
    }

    /**
     * 播一次「资源被扣除」：数字**先白色闪烁并跳一下**，跳完才从「扣前值」滚到「扣后值」；
     * 同时在这一格上方飘一条 `-N`（需求 2026-11-03 第 2 条）。
     *
     * @param amount 扣了多少（`<= 0` / 非有限数 ⇒ 整段跳过：没扣就别演）。
     * @param next 扣完之后的**那一格数据**（`amount` 是扣后原值）。`ResBar.reload` 在
     *   `render` 之前调，必须传；不传时按「已落定的当前值」当扣后值 —— 只给
     *   「值已经落地、但走不到 `render`」的调用方用。
     *
     * 🔴 顺序不能反：如果先把新值写进 label 再演，玩家看到的是「先扣、再闪」，
     *    与需求「闪烁、跳动、**再**扣除」正好相反。所以这里立刻把 label 钉回 `spendFrom`。
     */
    playSpendFeedback(amount: number, next?: ResBarSlot | null): void {
        if (!this.node.active) return;
        if (!Number.isFinite(amount) || amount <= 0) return;
        this.cancelHit();
        this.spendTo = next ? next.amount : Math.max(0, this.settledValue ?? 0);
        this.spendAmount = Math.max(1, Math.round(amount));
        this.spendFrom = this.spendTo + this.spendAmount;
        this.pendingSlot = next ?? null;
        this.spendElapsed = 0;
        this.prepareSpendFloat();
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
        // `cancelSpend` 没在播时会早退，飘字得单独收一次（它可能正飘着而时间轴刚结束）。
        this.hideSpendFloat();
        this.pendingSlot = null;
        this.settledValue = null;
        this.settledKey = '';
        this.settledCap = 0;
    }

    /** @param slot null = 整格隐藏。 */
    render(slot: ResBarSlot | null): void {
        if (!slot) {
            this.cancelFeedback();
            this.node.active = false;
            return;
        }
        this.node.active = true;
        // 反馈在播 ⇒ 只暂存（见 `pendingSlot` 的注释）；否则整格落地。
        if (this.isFeedbackPlaying) this.pendingSlot = slot;
        else this.applySlot(slot);
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

    /**
     * 整格落地：换算口径（key / 上限）、原始值、显示文本一起换。
     *
     * 这三者必须成对写 —— 只写文本再回头反解析，缩写（`122.3M`）会丢精度。
     */
    private applySlot(slot: ResBarSlot): void {
        this.settledKey = slot.key;
        this.settledCap = slot.cap;
        this.settledValue = slot.amount;
        this.valueLabel.string = slot.valueText;
    }

    /** 按当前 `hitElapsed` 写一帧（缩放 + 文本）。 */
    private applyHit(): void {
        const fx = resBarHitFx(this.hitElapsed);
        if (!fx) return;
        this.icon.node.setScale(this.iconBaseScale * fx.iconScale, this.iconBaseScale * fx.iconScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale * fx.labelScale, this.labelBaseScale * fx.labelScale, 1);
        const value = resBarCountValue(this.hitFrom, this.hitTo, fx.countRatio);
        this.valueLabel.string = formatResBarAmountText(this.settledKey, value, this.settledCap);
    }

    /** 收尾：复原缩放，把暂存的新数据落地（没有暂存就落到滚动终点）。 */
    private finishHit(): void {
        this.hitElapsed = -1;
        this.icon.node.setScale(this.iconBaseScale, this.iconBaseScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale, this.labelBaseScale, 1);
        const pending = this.pendingSlot;
        this.pendingSlot = null;
        if (pending) {
            this.applySlot(pending);
            return;
        }
        this.settledValue = this.hitTo;
        this.valueLabel.string = formatResBarAmountText(this.settledKey, this.hitTo, this.settledCap);
    }

    /** 按当前 `spendElapsed` 写一帧（缩放 + 位移 + 字色 + 文本）。 */
    private applySpend(): void {
        const fx = resBarSpendFx(this.spendElapsed);
        if (!fx) return;
        this.icon.node.setScale(this.iconBaseScale * fx.iconScale, this.iconBaseScale * fx.iconScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale * fx.labelScale, this.labelBaseScale * fx.labelScale, 1);
        this.valueLabel.node.setPosition(this.valueLabel.node.position.x, this.labelBaseY + fx.labelHop, 0);
        const [r, g, b] = resBarSpendFlashColor(
            [this.labelBaseColor.r, this.labelBaseColor.g, this.labelBaseColor.b],
            fx.whiteStrength,
        );
        // 透明度也走 `label.color`：Label 的顶点色带 alpha，白字"闪"就是靠它（见模型里的注释）。
        const alpha = Math.round(this.labelBaseColor.a * fx.labelAlpha);
        this.valueLabel.color = new Color(r, g, b, alpha);
        const value = resBarCountValue(this.spendFrom, this.spendTo, fx.countRatio);
        this.valueLabel.string = formatResBarAmountText(this.settledKey, value, this.settledCap);
        this.applySpendFloat();
    }

    /** 上方的 `-N` 飘字：懒建在槽位下面，样式全部来自 `MainResBarSpendFloat.prefab`。 */
    private ensureSpendFloat(): Label | null {
        if (this.spendFloatLabel) return this.spendFloatLabel;
        const host = this.valueLabel.node;
        if (!host.isValid || !this.spendFloatPrefab) return null;
        const node = instantiate(this.spendFloatPrefab);
        const gap = node.position.y;
        this.spendFloatStartY = this.node.getComponent(UITransform).height / 2 + gap;
        this.spendFloatX = host.position.x;

        node.name = 'SpendFloat';
        node.layer = host.layer;
        node.setParent(this.node);
        node.setPosition(this.spendFloatX, this.spendFloatStartY, 0);
        const label = node.getComponent(Label);
        if (!label) {
            node.destroy();
            return null;
        }
        node.active = false;
        this.spendFloat = node;
        this.spendFloatLabel = label;
        return label;
    }

    /** 起播：写好文本、压回起点、显示出来。 */
    private prepareSpendFloat(): void {
        const label = this.ensureSpendFloat();
        if (!label || !this.spendFloat) return;
        label.string = formatResBarSpendFloat(this.spendAmount);
        this.spendFloat.setPosition(this.spendFloatX, this.spendFloatStartY, 0);
        this.spendFloat.active = true;
    }

    /** 每一帧：上移 + 淡出；飘完（或没在飘）就藏起来。 */
    private applySpendFloat(): void {
        const node = this.spendFloat;
        if (!node) return;
        const fx = resBarSpendFloatFx(this.spendElapsed);
        if (!fx) {
            node.active = false;
            return;
        }
        node.setPosition(this.spendFloatX, this.spendFloatStartY + fx.rise, 0);
        if (this.spendFloatLabel) {
            this.spendFloatLabel.color = new Color(255, 255, 255, Math.round(255 * fx.alpha));
        }
    }

    /** 收起飘字（收尾 / 中止都要调，否则下次进主城会看到一条没飘完的 `-N`）。 */
    private hideSpendFloat(): void {
        if (this.spendFloat) this.spendFloat.active = false;
    }

    /** 收尾：缩放 / 位移 / 字色 / 飘字全部复原，扣后值落地。 */
    private finishSpend(): void {
        this.spendElapsed = -1;
        this.hideSpendFloat();
        this.icon.node.setScale(this.iconBaseScale, this.iconBaseScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale, this.labelBaseScale, 1);
        this.valueLabel.node.setPosition(this.valueLabel.node.position.x, this.labelBaseY, 0);
        this.valueLabel.color = new Color(
            this.labelBaseColor.r, this.labelBaseColor.g, this.labelBaseColor.b, this.labelBaseColor.a);
        const pending = this.pendingSlot;
        this.pendingSlot = null;
        if (pending) {
            this.applySlot(pending);
            return;
        }
        this.settledValue = this.spendTo;
        this.valueLabel.string = formatResBarAmountText(this.settledKey, this.spendTo, this.settledCap);
    }

    /** 中止「加」的那条时间轴（不碰扣的那条，也不碰暂存值）。 */
    private cancelHit(): void {
        if (this.hitElapsed < 0) return;
        this.hitElapsed = -1;
        this.icon.node.setScale(this.iconBaseScale, this.iconBaseScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale, this.labelBaseScale, 1);
    }

    /** 中止「扣」的那条时间轴：字色 / 透明度 / 位移 / 飘字必须一起复原，否则会留半透明白字。 */
    private cancelSpend(): void {
        if (this.spendElapsed < 0) return;
        this.spendElapsed = -1;
        this.hideSpendFloat();
        this.icon.node.setScale(this.iconBaseScale, this.iconBaseScale, 1);
        this.valueLabel.node.setScale(this.labelBaseScale, this.labelBaseScale, 1);
        this.valueLabel.node.setPosition(this.valueLabel.node.position.x, this.labelBaseY, 0);
        this.valueLabel.color = new Color(
            this.labelBaseColor.r, this.labelBaseColor.g, this.labelBaseColor.b, this.labelBaseColor.a);
    }
}
