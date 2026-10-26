import { _decorator, Color, Component, Label, Sprite, UITransform, UIOpacity } from 'cc';
import type { ZCFloatText, ZCFloatTextKind } from '../model/ZCGameTypes';
import {
    FLOAT_TEXT_DRIFT_DISTANCE,
    FLOAT_TEXT_ENTRANCE_PROGRESS,
    floatTextDrift,
    floatTextEntrance,
    floatTextFade,
    floatTextGoldDrop,
    mapToViewX,
    mapToViewY,
} from './ZCGameViewUtil';

const { ccclass, property } = _decorator;

/**
 * 飘字表现由 ZCGameFloatText.prefab 拥有：脚本只把 [ZCFloatText] 翻译成文字 / 颜色 / 位移，
 * 按进度每帧重算（非 tween），切流程 / 暂停不残留。
 *
 * 普通飘字是「快进慢出」：前 entranceProgress 完成入场（位移 + 缩放），之后线性淡出并带少量同向漂移，
 * 曲线真源在 ZCGameViewUtil.floatTextEntrance / floatTextFade / floatTextDrift。
 *
 * 金币为例外：走 floatTextGoldDrop（掉落原地 → 迅速缩小消失），无文字，
 * 硬币从角色中心上方落到 goldCenterY（兵种画布中心）；不使用 riseDistance / driftDistance / popScale。
 */
@ccclass('ZCFloatTextView')
export class ZCFloatTextView extends Component {
    private static readonly NORMAL_DAMAGE_COLOR = new Color(255, 255, 255, 255);
    private static readonly CRITICAL_COLOR = new Color(255, 198, 45, 255);
    private static readonly HEAL_COLOR = new Color(91, 255, 49, 255);
    private static readonly RESTRAINT_COLOR = new Color(255, 72, 62, 255);
    private static readonly RESISTED_COLOR = new Color(150, 150, 150, 255);
    private static readonly EXECUTE_COLOR = new Color(255, 105, 72, 255);
    private static readonly MISS_COLOR = new Color(120, 205, 255, 255);
    private static readonly GOLD_COLOR = new Color(255, 198, 45, 255);

    /** 按 kind 取色：穷举表，缺 key 会编译失败（新增 kind 必须补色）。 */
    private static readonly FLOAT_TEXT_COLOR_BY_KIND: Readonly<Record<ZCFloatTextKind, Color>> = {
        damage: ZCFloatTextView.NORMAL_DAMAGE_COLOR,
        critical: ZCFloatTextView.CRITICAL_COLOR,
        heal: ZCFloatTextView.HEAL_COLOR,
        restraint: ZCFloatTextView.RESTRAINT_COLOR,
        resisted: ZCFloatTextView.RESISTED_COLOR,
        execute: ZCFloatTextView.EXECUTE_COLOR,
        miss: ZCFloatTextView.MISS_COLOR,
        gold: ZCFloatTextView.GOLD_COLOR,
    };

    /** 连续伤害按中、左、右交替排布；五条轨道正好收在 98px 兵种画布宽度内。 */
    private static readonly DAMAGE_LANES = [0, -1, 1, -2, 2] as const;
    /** 数值压缩档位（千/百万/十亿/万亿 → 后缀）。 */
    private static readonly COMPACT_UNITS: ReadonlyArray<readonly [number, string]> = [
        [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K'],
    ];
    /** 暴击 / 秒杀的大字号；其余普通字号。 */
    private static readonly EMPHASIS_FONT_SIZE = 34;
    private static readonly DEFAULT_FONT_SIZE = 30;
    /**
     * 前缀字号 = 数字字号 × 该比例。数字只占 0.72em 大写高、汉字占 0.95em，
     * 取 0.5 后视觉高度约 0.66；要再贴近「一半高」只改此值。
     */
    private static readonly PREFIX_FONT_RATIO = 0.5;
    /** 前缀与数字的水平间距：前缀描边会各吃掉 1px，间距过小会贴成整体。 */
    private static readonly PREFIX_GAP = 6;
    /** 连续伤害的三行轨道：行距、每行额外的下坠量、中心/两侧摇摆幅度。 */
    private static readonly DAMAGE_ROW_STEP = 30;
    private static readonly DAMAGE_ROW_DROP_EXTRA = 6;
    private static readonly DAMAGE_ROW_SWAY_CENTER = 4;
    private static readonly DAMAGE_ROW_SWAY_OFFSET = 3;

    /**
     * 金币掉落段内的自转圈数（屏幕平面内）。图标尺寸（30×30）在 prefab 的 GoldIcon 上定，
     * 本文件只管位置 / 自转 / 透明度。
     */
    private static readonly GOLD_ICON_SPINS = 1;
    /** Text 宽度上限：contentSize 自适应有一帧延迟，读到出厂值 240 时用兜底宽度。 */
    private static readonly TEXT_WIDTH_MAX = 200;
    /** 宽度读不到时的兜底宽度（按 3 个字符数字估算）。 */
    private static readonly TEXT_WIDTH_FALLBACK = 40;

    /** 数值压缩：千/百万/十亿/万亿 → K/M/B/T 后缀。 */
    private static compactBattleNumber(value: number): string {
        const rounded = Math.max(0, Math.ceil(value));
        for (const [limit, suffix] of ZCFloatTextView.COMPACT_UNITS) {
            if (rounded < limit) continue;
            const compact = rounded / limit;
            return `${compact >= 100 ? Math.round(compact) : Number(compact.toFixed(1))}${suffix}`;
        }
        return String(rounded);
    }

    /** 飘字文案拆成「前缀 + 数值」两段（前缀用独立小字号 Label，见 renderPrefix）。 */
    private static battleText(text: Readonly<ZCFloatText>): { prefix: string; value: string } {
        const value = ZCFloatTextView.compactBattleNumber(text.value);
        switch (text.kind) {
            // 金币无文字，只剩硬币图标，连 + 也不拼。
            case 'gold': return { prefix: '', value: '' };
            // 治疗保留 + 号，标的是「加」语义。
            case 'heal': return { prefix: '', value: `+${value}` };
            case 'miss': return { prefix: '', value: 'MISS' };
            // 伤害类不带负号：飘字本就在挨打目标身上，负号只增加宽度并易与前缀读成整体。
            case 'critical': return { prefix: '暴击', value };
            case 'restraint': return { prefix: '克制', value };
            case 'resisted': return { prefix: '抵抗', value };
            case 'execute': return { prefix: '秒杀', value };
            default: return { prefix: '', value };
        }
    }

    @property({ type: Label, group: '节点引用', tooltip: 'Text：显示数值的 Label（必填）' })
    textLabel: Label = null!;

    @property({
        type: Label,
        group: '节点引用',
        tooltip: 'Text/Prefix：暴击 / 克制 / 抵抗 / 秒杀 的小字号前缀（只在这四种飘字显示）',
    })
    prefixLabel: Label | null = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'GoldIcon：金币飘字的金币图标（挂在 Text 下自动跟随；只有 gold 飘字显示）' })
    goldIcon: Sprite | null = null;

    @property({ group: '数值表现', tooltip: '（已废弃）原飘字基准上移量；金币落点改见 goldCenterY' })
    offsetY = 26;

    /**
     * 已废弃，仅为兼容 prefab 序列化值保留（删属性会在 prefab 上产生未知属性警告）。
     * 金币掉落高度改由 ZCGameViewUtil.FLOAT_TEXT_GOLD_DROP_PX 决定。
     */
    @property({ group: '数值表现', tooltip: '（已废弃）原金币上飘距离；金币现改为掉落原地，见 FLOAT_TEXT_GOLD_DROP_PX' })
    riseDistance = 46;

    @property({ group: '数值表现', tooltip: '兵种视觉 Prefab 的统一宽高，用于计算头顶和散落范围' })
    damageTargetSize = 98;

    @property({ group: '数值表现', tooltip: '伤害数字与人物头顶之间保留的距离' })
    damageHeadPadding = 6;

    @property({ group: '数值表现', tooltip: '伤害泪滴向下坠落的总距离' })
    damageDropDistance = 100;

    @property({ group: '数值表现', tooltip: '同位置连续伤害的横向轨道间距' })
    damageLaneSpacing = 24;

    @property({ group: '数值表现', tooltip: '起手弹出倍率，1 = 不弹' })
    popScale = 1.25;

    /**
     * 「快进慢出」分界：前这么久完成入场（位移 + 缩放），之后淡出；
     * 缺省值与 FLOAT_TEXT_ENTRANCE_PROGRESS 同源。
     */
    @property({ group: '数值表现', tooltip: '入场段占比（0~1）：前这么久完成位移 + 缩放，之后淡出' })
    entranceProgress = FLOAT_TEXT_ENTRANCE_PROGRESS;

    /** 慢出段收尾漂移距离：沿入场方向再走一点，避免静止淡出的死板感。 */
    @property({ group: '数值表现', tooltip: '慢出段的收尾漂移距离（像素）：伤害继续下沉 / 金币继续上飘' })
    driftDistance = FLOAT_TEXT_DRIFT_DISTANCE;

    /** 复用的取色缓存：Label.color 的 setter 会拷贝，同一条飘字不会互相串色。 */
    private readonly tint = new Color();
    /** 金币图标的 UIOpacity（懒取）：Label.color.a 只作用于 Label，独立 Sprite 需单独同步淡出。 */
    private goldIconOpacity: UIOpacity | null = null;

    /**
     * 金币落点高度 = 兵种画布中心（单位根节点是逻辑脚点，画布中心在其上方约 49px，
     * 取 offsetY=26 只到下半身）。建筑产出的金币传的是格心，同样走此路径。
     */
    private get goldCenterY(): number {
        return this.damageTargetSize * 0.5;
    }

    render(text: Readonly<ZCFloatText>, now: number): void {
        const duration = Math.max(0.001, text.durationSeconds);
        const progress = Math.max(0, Math.min(1, (now - text.startedAt) / duration));

        const parts = ZCFloatTextView.battleText(text);
        this.textLabel.string = parts.value;
        const fontSize = text.kind === 'critical' || text.kind === 'execute'
            ? ZCFloatTextView.EMPHASIS_FONT_SIZE : ZCFloatTextView.DEFAULT_FONT_SIZE;
        this.textLabel.fontSize = fontSize;
        // 金币走自己的掉落曲线，其余走「快进慢出」，两条曲线互不干扰。
        const gold = text.kind === 'gold' ? floatTextGoldDrop(progress) : null;
        const enter = floatTextEntrance(progress, this.entranceProgress);
        // 淡出系数：金币用自己的（缩小段才淡），其余走 floatTextFade。
        const fade = this.applyColor(text, progress, gold ? gold.fade : null);
        // 前缀借用同一条染色缓存，必须在 applyColor 之后。
        this.renderPrefix(parts.prefix, fontSize, fade);
        // 世界定位由根节点承担，Text 子节点只做局部偏移；两处都写绝对坐标会让位置翻倍。
        this.node.setPosition(mapToViewX(text.x), mapToViewY(text.y), 0);
        // 每帧绝对赋值 enabled：节点来自对象池，复用会残留上一次状态。
        if (this.goldIcon) {
            const isGold = gold !== null;
            this.goldIcon.enabled = isGold;
            if (gold) this.renderGoldIcon(gold.spin, fade);
        }
        if (gold) {
            // 用 enabled=false 而非关 Text 节点：金币图标是 Text 的子节点，关节点会把硬币一起隐藏。
            this.textLabel.enabled = false;
            // 不上浮、不漂移，从上方落到角色中心。
            this.textLabel.node.setPosition(0, this.goldCenterY + gold.drop, 0);
            this.textLabel.node.setScale(gold.scale, gold.scale, 1);
            return;
        }
        {
            const drift = floatTextDrift(progress, this.entranceProgress);
            const sequence = Math.max(0, text.id - 1);
            const lane = ZCFloatTextView.DAMAGE_LANES[sequence % ZCFloatTextView.DAMAGE_LANES.length];
            const row = Math.floor(sequence / ZCFloatTextView.DAMAGE_LANES.length) % 3;
            // 散落 / 下坠 / 摇摆都用入场进度，位移在入场段内走完（用 progress 会飘满整条时长）。
            const spreadProgress = 0.55 + 0.45 * enter;
            const sway = Math.sin(enter * Math.PI) * (lane === 0 ? (row - 1) * ZCFloatTextView.DAMAGE_ROW_SWAY_CENTER : Math.sign(lane) * ZCFloatTextView.DAMAGE_ROW_SWAY_OFFSET);
            const x = lane * this.damageLaneSpacing * spreadProgress + sway;
            // 98×98 视觉中心锚定，头顶 = 中心 +49px，再留少量呼吸空间。
            const headY = this.damageTargetSize * 0.5 + this.damageHeadPadding;
            // 慢出段沿同一方向（继续下沉）做惯性收尾。
            const y = headY + row * ZCFloatTextView.DAMAGE_ROW_STEP
                - enter * (this.damageDropDistance + row * ZCFloatTextView.DAMAGE_ROW_DROP_EXTRA)
                - drift * this.driftDistance;
            this.textLabel.node.setPosition(x, y, 0);
            // 起手弹出：入场段内从 popScale 收回 1，之后保持 1。
            const scale = 1 + (this.popScale - 1) * (1 - enter);
            this.textLabel.node.setScale(scale, scale, 1);
        }
    }

    /**
     * 前缀用独立小字号 Label：单条 Label 只有一个字号，无法满足「前缀只有数字一半高」。
     * 前缀挂在 Text 下自动继承位置与缩放；水平位置按数字实际宽度反推（前缀宽度按字数×字号算，
     * 不读 UITransform，避免一帧延迟）。每帧绝对赋值 active：对象池复用会残留可见性。
     */
    private renderPrefix(prefix: string, fontSize: number, fade: number): void {
        const label = this.prefixLabel;
        if (!label) return;
        const show = prefix.length > 0;
        label.node.active = show;
        label.enabled = show && fade > 0;
        if (!show) return;
        const prefixSize = Math.max(1, Math.round(fontSize * ZCFloatTextView.PREFIX_FONT_RATIO));
        label.string = prefix;
        label.fontSize = prefixSize;
        // 与数字同色同透明度。
        label.color = this.tint;
        const textWidth = this.readTextWidth();
        const prefixWidth = prefix.length * prefixSize;
        label.node.setPosition(
            -(textWidth * 0.5 + ZCFloatTextView.PREFIX_GAP + prefixWidth * 0.5), 0, 0);
    }

    /**
     * 金币图标居中压在落点（x=0），随掉落进度自转一圈（屏幕平面内，非 3D 翻转），
     * 透明度与 fade 同步。
     */
    private renderGoldIcon(spin: number, fade: number): void {
        const icon = this.goldIcon;
        if (!icon) return;
        icon.node.setPosition(0, 0, 0);
        icon.node.setRotationFromEuler(0, 0, spin * ZCFloatTextView.GOLD_ICON_SPINS * 360);
        const opacity = this.getGoldIconOpacity();
        if (opacity) opacity.opacity = Math.round(255 * fade);
    }

    /**
     * 数字 Label 实际宽度：overflow=NONE 时 contentSize 自适应但有一帧延迟，
     * 读到出厂值 240 时退回兜底宽度。
     */
    private readTextWidth(): number {
        const width = this.textLabel.node.getComponent(UITransform)?.width ?? 0;
        return width > 0 && width <= ZCFloatTextView.TEXT_WIDTH_MAX
            ? width : ZCFloatTextView.TEXT_WIDTH_FALLBACK;
    }

    private getGoldIconOpacity(): UIOpacity | null {
        if (!this.goldIcon) return null;
        if (!this.goldIconOpacity) {
            this.goldIconOpacity = this.goldIcon.node.getComponent(UIOpacity)
                ?? this.goldIcon.node.addComponent(UIOpacity);
        }
        return this.goldIconOpacity;
    }

    /** 按 kind 取色 + 尾段淡出，返回本帧 alpha 系数（0~1）供金币图标同步。 */
    private applyColor(text: Readonly<ZCFloatText>, progress: number, fadeOverride: number | null = null): number {
        const base = ZCFloatTextView.FLOAT_TEXT_COLOR_BY_KIND[text.kind];
        // 金币有自己的淡出曲线，其余走 floatTextFade。
        const fade = fadeOverride === null ? floatTextFade(progress, this.entranceProgress) : fadeOverride;
        this.tint.set(base.r, base.g, base.b, Math.round(base.a * fade));
        this.textLabel.color = this.tint;
        this.textLabel.enabled = fade > 0;
        return fade;
    }
}
