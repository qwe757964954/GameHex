import { _decorator, Component, Label, Node, Sprite, UITransform, Vec3, type SpriteFrame } from 'cc';
import { tween, type Tween } from 'cc';

/**
 * 对局 HUD 顶部一格：各席位保留自己的 `frame_01~04` 底图。
 * 横向 Layout 根据在场席位居中；唯一领先者 110×77，其余 94×66。
 * 地块数为 0 时显示红 X，数字必须同时隐藏。
 *
 * 领先状态切换时尺寸**补间过渡**：新领先者放大（backOut 轻微回弹）、
 * 原领先者缩回（quadInOut）；逐帧写真实尺寸，Layout 监听 size-changed 自动重排。
 *
 * 变化反馈（2026-10-14）：**领先状态切换**（新领先者登场）时整格**弹跳**（放大 1.2 → 弹回 1），
 * 与尺寸补间叠加强化「这格变大了」；失去领先不弹 —— 缩回那一格已有 contentSize 补间表达。
 * **数字增减（大小状态不变）时只有数字本身跳**、方块不动 —— 见 `playNumberPulse`。
 */
const { ccclass, property } = _decorator;

const SCORE_LEAD_WIDTH = 110;
const SCORE_LEAD_HEIGHT = 77;
const SCORE_NORMAL_WIDTH = 94;
const SCORE_NORMAL_HEIGHT = 66;

/** 普通格数字字号 / 行高 = prefab 出厂值（28 / 39）；领先格适度加大。 */
const SCORE_NORMAL_FONT_SIZE = 28;
const SCORE_NORMAL_LINE_HEIGHT = 39;
const SCORE_LEAD_FONT_SIZE = 32;
const SCORE_LEAD_LINE_HEIGHT = 44;

/** 弹跳峰值（相对基准缩放 1）与两段时长：先放大、再带回弹地缩回。 */
const PULSE_PEAK_SCALE = 1.2;
const PULSE_UP_SECONDS = 0.1;
const PULSE_DOWN_SECONDS = 0.18;
/** tween 的目标值会被系统读取但不改写，模块级共享常量安全（AGENTS.md：不在 update 路径造临时对象）。 */
const PULSE_BASE = new Vec3(1, 1, 1);
const PULSE_PEAK = new Vec3(PULSE_PEAK_SCALE, PULSE_PEAK_SCALE, 1);

/** 新领先者放大动画时长（秒）。 */
const SIZE_GROW_SECONDS = 0.25;
/** 原领先者缩回普通尺寸的动画时长（秒）。 */
const SIZE_SHRINK_SECONDS = 0.2;

/** 一格的渲染数据。 */
export interface IHudScoreSlotData {
    /** 显示的数字（地块数）。 */
    readonly value: number;
    /** 该玩家是否已战斗结束（true ⇒ 显示红 X、隐藏数字）。 */
    readonly finished: boolean;
    /** 该席是否**唯一**领先（并列第一不算，见上层判据）。 */
    readonly leading: boolean;
}

@ccclass('ZCGameHudScoreSlot')
export class ZCGameHudScoreSlot extends Component {
    @property({ type: Sprite, tooltip: 'Score 自身的九宫格底板 frame_01~04' })
    background: Sprite = null;

    @property({ type: Label, tooltip: 'Value：地块数（已结束时隐藏）' })
    value: Label = null;

    @property({ type: Sprite, tooltip: 'Cross：红 X（该玩家已战斗结束；平时隐藏）' })
    cross: Sprite = null;

    /** 是否已完成首次渲染 —— 首帧直接落位，不让开局四格从默认尺寸演一遍。 */
    private rendered = false;
    /** 上一次的领先状态，用于识别切换。 */
    private leading = false;
    /** 上一次显示的地块数；`null` = 首帧 / 已结束（红 X），此时不弹跳。 */
    private lastValue: number | null = null;
    /** 当前尺寸补间；节点停用 / 销毁必须停（target 是本节点，ActionManager 也会随节点销毁停它）。 */
    private sizeTween: Tween<Node> | null = null;
    /** 当前整格弹跳补间；与尺寸补间相互独立（scale ≠ contentSize），各自停各自的。 */
    private pulseTween: Tween<Node> | null = null;
    /** 当前数字弹跳补间（只动 `Value` 节点，不动整格）。 */
    private numberPulseTween: Tween<Node> | null = null;

    /** 全量赋值。数字 / 红 X 同步切换；尺寸在领先状态变化时补间，否则幂等落位。 */
    render(data: IHudScoreSlotData): void {
        // 弹跳被 onDisable 打断会停在半路；没在弹跳时把缩放归位（Score / Value 节点 scale 恒为 1，别处不写）。
        if (!this.pulseTween) {
            const scale = this.node.scale;
            if (scale.x !== 1 || scale.y !== 1) this.node.setScale(1, 1, 1);
        }
        if (!this.numberPulseTween) {
            const valueScale = this.value.node.scale;
            if (valueScale.x !== 1 || valueScale.y !== 1) this.value.node.setScale(1, 1, 1);
        }
        this.value.enabled = !data.finished;
        this.cross.enabled = data.finished;
        this.value.string = data.finished ? '' : String(data.value);
        // 领先格数字加大加粗。只写变化的字段：`fontSize` / `isBold` 的 setter 都会触发字集重建，
        // 每帧无条件写会白白重建 4 格 × 0.15s 一轮的字形贴图。
        const fontSize = data.leading ? SCORE_LEAD_FONT_SIZE : SCORE_NORMAL_FONT_SIZE;
        if (this.value.fontSize !== fontSize) {
            this.value.fontSize = fontSize;
            this.value.lineHeight = data.leading ? SCORE_LEAD_LINE_HEIGHT : SCORE_NORMAL_LINE_HEIGHT;
        }
        if (this.value.isBold !== data.leading) this.value.isBold = data.leading;
        const rect = this.node.getComponent(UITransform);
        const targetWidth = data.leading ? SCORE_LEAD_WIDTH : SCORE_NORMAL_WIDTH;
        const targetHeight = data.leading ? SCORE_LEAD_HEIGHT : SCORE_NORMAL_HEIGHT;
        // 数字变化 / 领先切换的判据要在写入 `leading` / `lastValue` **之前**算好。
        // 首帧不弹（`rendered` 为 false）：开局四格齐弹一遍只剩噪音。
        const valueChanged = this.rendered && !data.finished
            && this.lastValue !== null && data.value !== this.lastValue;
        const leadingChanged = this.rendered && data.leading !== this.leading;
        if (!this.rendered) {
            rect.setContentSize(targetWidth, targetHeight);
        } else if (leadingChanged) {
            this.playSizeTween(rect, targetWidth, targetHeight, data.leading);
            // 只有「新领先者登场」才整格弹跳；失去领先不弹 —— 缩回那一格已有 contentSize 补间表达。
            if (data.leading) this.playPulse();
        } else if (!this.sizeTween) {
            // 状态相同且无动画在跑：幂等补齐到目标（动画被 onDisable 打断后重新激活时走到）。
            rect.setContentSize(targetWidth, targetHeight);
        }
        // 大小状态没切换、只是数字增减 ⇒ 只让数字跳，方块不动。
        if (valueChanged && !leadingChanged) this.playNumberPulse();
        this.lastValue = data.finished ? null : data.value;
        this.leading = data.leading;
        this.rendered = true;
    }

    /** 换底板；尺寸由 Score 的 UITransform 控制。 */
    setBackgroundFrame(frame: SpriteFrame | null): void {
        if (frame) this.background.spriteFrame = frame;
    }

    /**
     * 从**当前真实尺寸**补间到目标 —— 动画中途领先方再翻转，也能无缝反向，不会跳一下。
     *
     * target 必须是节点（规则 104：裸对象 target 推不出停机时机，组件销毁后回调必崩）；
     * 空 props + `onUpdate` 拿 eased ratio，逐帧 `setContentSize`：
     * 每次尺寸变化都触发 size-changed，父级 Layout 自动标脏重排，无需上层逐帧 updateLayout。
     */
    private playSizeTween(
        rect: UITransform,
        targetWidth: number,
        targetHeight: number,
        leading: boolean,
    ): void {
        this.sizeTween?.stop();
        const startWidth = rect.width;
        const startHeight = rect.height;
        this.sizeTween = tween(this.node)
            .to(leading ? SIZE_GROW_SECONDS : SIZE_SHRINK_SECONDS, {}, {
                easing: leading ? 'backOut' : 'quadInOut',
                onUpdate: (_node: Node, ratio: number) => {
                    rect.setContentSize(
                        startWidth + (targetWidth - startWidth) * ratio,
                        startHeight + (targetHeight - startHeight) * ratio,
                    );
                },
            })
            .call(() => {
                this.sizeTween = null;
                // 回弹结束时精确落位，避免浮点误差 / backOut 末帧偏差。
                rect.setContentSize(targetWidth, targetHeight);
            })
            .start();
    }

    /**
     * 整格弹跳：scale 1 → 1.2 → 1（放大用 sineOut 出去、缩回用 backOut 带一点回弹）。
     *
     * 只在新领先者登场时调用（领先状态切换那一下）—— 与 contentSize 放大补间叠加。
     * 为什么要走 `scale` 而不是再改一次 contentSize：contentSize 会触发父级 Layout 重排，
     * 弹跳是**瞬时**视觉强调，不该把旁边几格挤来挤去；scale 不参与 Layout，弹完即走。
     */
    private playPulse(): void {
        this.pulseTween?.stop();
        this.node.setScale(1, 1, 1);
        this.pulseTween = tween(this.node)
            .to(PULSE_UP_SECONDS, { scale: PULSE_PEAK }, { easing: 'sineOut' })
            .to(PULSE_DOWN_SECONDS, { scale: PULSE_BASE }, { easing: 'backOut' })
            .call(() => { this.pulseTween = null; })
            .start();
    }

    /**
     * 数字弹跳：只动 `Value` 节点（scale 1 → 1.2 → 1）。
     *
     * 什么时候用：地块数增减但**领先状态没变**（方块大小没切换）—— 此时方块不该跳，
     * 只让数字本身跳一下，作为「这个数变了」的轻反馈。目标节点是 `value.node`，
     * 不碰 Score 根节点，所以底板 / 红 X 不会跟着一起跳。
     */
    private playNumberPulse(): void {
        this.numberPulseTween?.stop();
        this.value.node.setScale(1, 1, 1);
        this.numberPulseTween = tween(this.value.node)
            .to(PULSE_UP_SECONDS, { scale: PULSE_PEAK }, { easing: 'sineOut' })
            .to(PULSE_DOWN_SECONDS, { scale: PULSE_BASE }, { easing: 'backOut' })
            .call(() => { this.numberPulseTween = null; })
            .start();
    }

    protected onDisable(): void {
        this.stopSizeTween();
        this.stopPulseTween();
        this.stopNumberPulseTween();
    }

    protected onDestroy(): void {
        this.stopSizeTween();
        this.stopPulseTween();
        this.stopNumberPulseTween();
    }

    private stopSizeTween(): void {
        if (!this.sizeTween) return;
        this.sizeTween.stop();
        this.sizeTween = null;
    }

    private stopPulseTween(): void {
        if (!this.pulseTween) return;
        this.pulseTween.stop();
        this.pulseTween = null;
        // 停在半路会让整格永久偏大 1.x 倍；停动画时顺手归位。
        this.node.setScale(1, 1, 1);
    }

    private stopNumberPulseTween(): void {
        if (!this.numberPulseTween) return;
        this.numberPulseTween.stop();
        this.numberPulseTween = null;
        // 停在半路会让数字永久偏大；停动画时顺手归位。
        this.value.node.setScale(1, 1, 1);
    }
}
