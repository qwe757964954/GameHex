import { Color, Label, Node, UITransform } from 'cc';
import type { IBigMapResourceView } from '../application/BigMapViewState';
import {
    formatResBarSpendFloat,
    resBarCountValue,
    resBarHitFx,
    resBarSpendFlashColor,
    resBarSpendFloatFx,
    resBarSpendFx,
} from '../../main/MainResBarFeedback';

/** 飘字描边宽度（px）：飘字悬在资源卡上方，白字需要一圈黑边压住。 */
const FLOAT_OUTLINE_WIDTH = 2;
/** 飘字起点离资源格上沿的间隙（px）。 */
const FLOAT_GAP = 2;

/** 资源整数 → 顶部栏紧凑文本（≥1000 用一位小数 K），常态与反馈滚动共用同一口径。 */
export function formatBigMapResourceAmount(amount: number): string {
    const value = Math.floor(Number.isFinite(amount) ? amount : 0);
    return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : `${value}`;
}

/**
 * 大地图顶部单个资源格的反馈驱动（普通类，非组件）。
 *
 * 大地图资源条只有 Value Label（没有主界面 Slot 的 icon / plus / 底色节点），
 * 无法直接复用 {@link MainResBarSlot}，但所有曲线（命中 / 扣除 / 飘字）都直接调用
 * `MainResBarFeedback` 的纯函数，这里只做「记 elapsed → 取 fx → 写 Label」，不重复算法。
 *
 * 与主界面 Slot 的关键差异：本类在 sync 时直接持有原始 amount 整数（Label 文本带 K 后缀，
 * 无法可靠反解析），滚动从 / 到都用原始整数，落文本时再走 K 格式化。
 *
 * 不用 tween：只记 hitElapsed / spendElapsed，由 Layout 的 update 统一推进。
 */
export class BigMapResourceFeedback {
    private readonly label: Label;
    private readonly baseScale: number;
    private readonly baseY: number;
    private readonly baseR: number;
    private readonly baseG: number;
    private readonly baseB: number;
    private readonly baseA: number;

    // 增加：命中（labelScale + 数字滚动）
    private hitElapsed = -1;
    private hitFrom = 0;
    private hitTo = 0;
    // 扣除：白闪 + 跳动 + 再扣 + 飘字
    private spendElapsed = -1;
    private spendFrom = 0;
    private spendTo = 0;
    private spendAmount = 0;
    /** 数字后缀（体力的 /上限；其余为空），起播时锁定，滚动期间原样拼回。 */
    private suffix = '';
    /** 上一次落定的原始整数（首帧 / 未知后为 null）。 */
    private settledAmount: number | null = null;

    private floatNode: Node | null = null;
    private floatLabel: Label | null = null;
    private floatConfigured = false;
    private floatStartY = 0;
    private floatX = 0;

    constructor(label: Label) {
        this.label = label;
        this.baseScale = label.node.scale.x ?? 1;
        this.baseY = label.node.position.y ?? 0;
        const color = label.color;
        this.baseR = color?.r ?? 255;
        this.baseG = color?.g ?? 255;
        this.baseB = color?.b ?? 255;
        this.baseA = color?.a ?? 255;
        // 飘字节点由 prefab 预置在 Value 节点下（SpendFloat），缺了就降级为不飘字。
        const floatNode = label.node.getChildByName('SpendFloat');
        this.floatNode = floatNode;
        this.floatLabel = floatNode?.getComponent(Label) ?? null;
    }

    get isPlaying(): boolean {
        return this.hitElapsed >= 0 || this.spendElapsed >= 0;
    }

    /**
     * 每次 render 同步该资源：检测 amount 变化并起播；返回 true = 反馈在播、Label 由本类接管。
     *
     * amountKnown=false（联机余额未知）不起播并重置基线；首帧只建立基线，不演。
     */
    sync(view: IBigMapResourceView): boolean {
        if (view.amountKnown === false) {
            this.settledAmount = null;
            return false;
        }
        const amount = Math.floor(view.amount);
        if (this.settledAmount === null) {
            this.settledAmount = amount;
            return false;
        }
        const previous = this.settledAmount;
        if (amount === previous) return this.isPlaying;
        this.settledAmount = amount;
        if (amount < previous) this.beginSpend(previous, amount, view);
        else this.beginHit(previous, amount, view);
        return true;
    }

    /** 逐帧推进两条互斥时间轴；true = 还在播。 */
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

    /** 立刻中止（切页 / 重置）：复原节点并收起飘字。 */
    cancel(): void {
        this.cancelHit();
        this.cancelSpend();
        this.hideFloat();
        this.settledAmount = null;
    }

    private beginHit(from: number, to: number, view: IBigMapResourceView): void {
        this.cancelSpend();
        this.hitFrom = from;
        this.hitTo = to;
        this.suffix = this.suffixOf(view);
        this.hitElapsed = 0;
        this.applyHit();
    }

    private beginSpend(from: number, to: number, view: IBigMapResourceView): void {
        this.cancelHit();
        this.spendFrom = from;
        this.spendTo = to;
        this.spendAmount = Math.max(1, from - to);
        this.suffix = this.suffixOf(view);
        this.spendElapsed = 0;
        this.prepareFloat();
        this.applySpend();
    }

    private suffixOf(view: IBigMapResourceView): string {
        if (view.type !== 'stamina' || !Number.isFinite(view.cap)) return '';
        return `/${Math.floor(view.cap)}`;
    }

    private applyHit(): void {
        const fx = resBarHitFx(this.hitElapsed);
        if (!fx) return;
        const scale = this.baseScale * fx.labelScale;
        this.label.node.setScale(scale, scale, 1);
        const value = resBarCountValue(this.hitFrom, this.hitTo, fx.countRatio);
        this.label.string = formatBigMapResourceAmount(value) + this.suffix;
    }

    private finishHit(): void {
        this.hitElapsed = -1;
        this.label.node.setScale(this.baseScale, this.baseScale, 1);
        this.label.string = formatBigMapResourceAmount(this.hitTo) + this.suffix;
    }

    private applySpend(): void {
        const fx = resBarSpendFx(this.spendElapsed);
        if (!fx) return;
        const scale = this.baseScale * fx.labelScale;
        this.label.node.setScale(scale, scale, 1);
        this.label.node.setPosition(this.label.node.position.x, this.baseY + fx.labelHop, 0);
        const [r, g, b] = resBarSpendFlashColor([this.baseR, this.baseG, this.baseB], fx.whiteStrength);
        this.label.color = new Color(r, g, b, Math.round(this.baseA * fx.labelAlpha));
        const value = resBarCountValue(this.spendFrom, this.spendTo, fx.countRatio);
        this.label.string = formatBigMapResourceAmount(value) + this.suffix;
        this.applyFloat();
    }

    private finishSpend(): void {
        this.spendElapsed = -1;
        this.hideFloat();
        this.label.node.setScale(this.baseScale, this.baseScale, 1);
        this.label.node.setPosition(this.label.node.position.x, this.baseY, 0);
        this.label.color = new Color(this.baseR, this.baseG, this.baseB, this.baseA);
        this.label.string = formatBigMapResourceAmount(this.spendTo) + this.suffix;
    }

    private cancelHit(): void {
        if (this.hitElapsed < 0) return;
        this.hitElapsed = -1;
        this.label.node.setScale(this.baseScale, this.baseScale, 1);
    }

    private cancelSpend(): void {
        if (this.spendElapsed < 0) return;
        this.spendElapsed = -1;
        this.hideFloat();
        this.label.node.setScale(this.baseScale, this.baseScale, 1);
        this.label.node.setPosition(this.label.node.position.x, this.baseY, 0);
        this.label.color = new Color(this.baseR, this.baseG, this.baseB, this.baseA);
    }

    /** 配置 prefab 预置的上方飘字（与 Value 平级），首次使用照抄 Value 排版并加描边。 */
    private prepareFloat(): void {
        const node = this.floatNode;
        const floatLabel = this.floatLabel;
        // 旧 prefab 没预置飘字节点：静默降级，不影响白闪/滚动主反馈。
        if (!node || !floatLabel) return;
        // 飘字挂在 Value 下，用 Value 局部坐标：水平居中(0)，起点在 Value 上沿 + 间隙。
        const valueTransform = this.label.node.getComponent(UITransform);
        this.floatStartY = (valueTransform ? valueTransform.height / 2 : 0) + FLOAT_GAP;
        this.floatX = 0;
        if (!this.floatConfigured) {
            node.getComponent(UITransform)?.setAnchorPoint(0.5, 0);
            this.copyTypography(floatLabel);
            floatLabel.enableOutline = true;
            floatLabel.outlineColor = new Color(0, 0, 0, 255);
            floatLabel.outlineWidth = FLOAT_OUTLINE_WIDTH;
            this.floatConfigured = true;
        }
        floatLabel.string = formatResBarSpendFloat(this.spendAmount);
        node.setPosition(this.floatX, this.floatStartY, 0);
        node.active = true;
    }

    private applyFloat(): void {
        const node = this.floatNode;
        if (!node || !this.floatLabel) return;
        const fx = resBarSpendFloatFx(this.spendElapsed);
        if (!fx) {
            node.active = false;
            return;
        }
        node.setPosition(this.floatX, this.floatStartY + fx.rise, 0);
        this.floatLabel.color = new Color(255, 255, 255, Math.round(255 * fx.alpha));
    }

    private hideFloat(): void {
        if (this.floatNode) this.floatNode.active = false;
    }

    private copyTypography(label: Label): void {
        const source = this.label;
        label.useSystemFont = source.useSystemFont;
        label.font = source.font;
        label.fontFamily = source.fontFamily;
        label.fontSize = source.fontSize;
        label.lineHeight = source.lineHeight;
        label.isBold = source.isBold;
        label.isItalic = source.isItalic;
        label.horizontalAlign = source.horizontalAlign;
        label.verticalAlign = source.verticalAlign;
        label.enableWrapText = false;
        label.overflow = Label.Overflow.NONE;
    }
}
