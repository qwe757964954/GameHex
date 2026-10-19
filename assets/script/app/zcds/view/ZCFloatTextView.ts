import { _decorator, Color, Component, Label, Sprite, UITransform, UIOpacity } from 'cc';
import type { ZCFloatText, ZCFloatTextKind } from '../model/ZCGameTypes';
import {
    FLOAT_TEXT_DRIFT_DISTANCE,
    FLOAT_TEXT_ENTRANCE_PROGRESS,
    floatTextDrift,
    floatTextEntrance,
    floatTextFade,
    mapToViewX,
    mapToViewY,
} from './ZCGameViewUtil';

const { ccclass, property } = _decorator;

/**
 * 飘字表现由 ZCGameFloatText.prefab 拥有：脚本只负责把 [ZCFloatText] 的数值、
 * 归属、存活进度翻译成文字 / 颜色 / 位移，布局与字体样式都在 prefab 里。
 *
 * 和 ZCCombatEffectView 一样是**按进度计算**而不是 tween：每帧重算，切流程/暂停都不会残留补间。
 *
 * 时间结构是「**快进慢出**」（2026-10-15）：前 `entranceProgress`（默认 45%）走完入场 ——
 * 位移、弹出缩放、金币图标自转全部收在这一段；剩下的时长只做线性淡出，
 * 并带 **5~10px 的同向收尾漂移**（`driftDistance`）—— 否则数字会静止着淡出，读起来像
 * 「贴图卡在那儿被调透明度」而不是「飘走」。
 * 曲线真源在 `ZCGameViewUtil.floatTextEntrance` / `floatTextFade` / `floatTextDrift`，别在本文件里另算一份。
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

    /**
     * 按飘字 kind 取底色：穷举表，缺 key 会编译失败（新增 kind 必须补色）。
     * 暴击与金币当前同色，但保留两个常量，方便日后单独改色。
     */
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
     * 前缀（暴击 / 克制 / 抵抗 / 秒杀）字号 = 数字字号 × 该比例。
     *
     * 需求「【克制】大约只有数字一半高」：数字是阿拉伯数字、只占 0.72em 的大写高，
     * 前缀是汉字、占 0.95em，所以按**字号**取半（30 → 15）后，视觉高度是 21.6 : 14.25 ≈ 0.66。
     * 要真正贴着「一半高」再往下压，把这里改成 0.4（30 → 12）即可，只此一处。
     */
    private static readonly PREFIX_FONT_RATIO = 0.5;
    /**
     * 前缀与数字之间的水平间距（像素）。取 6 而不是 4：前缀带 1px 描边，视觉上会再各吃掉 1px，
     * 4 时两个字几乎贴着数字（实测像一整个「克制31」）。
     */
    private static readonly PREFIX_GAP = 6;
    /** 连续伤害的三行轨道：行距、每行额外的下坠量、中心/两侧摇摆幅度。 */
    private static readonly DAMAGE_ROW_STEP = 30;
    private static readonly DAMAGE_ROW_DROP_EXTRA = 6;
    private static readonly DAMAGE_ROW_SWAY_CENTER = 4;
    private static readonly DAMAGE_ROW_SWAY_OFFSET = 3;

    /**
     * 金币图标（只 `gold` 飘字显示）：直径与普通数字字号（30）相近，
     * 挂在数字左侧、随文字一起上浮，并在上升途中绕自身旋转。
     */
    private static readonly GOLD_ICON_SIZE = 30;
    /** 图标与数字之间的水平间距（像素）。 */
    private static readonly GOLD_ICON_GAP = 4;
    /** 整条飘字期间绕自身旋转的圈数（屏幕平面内自转）。 */
    private static readonly GOLD_ICON_SPINS = 1;
    /**
     * 数字 Label 宽度的采纳上限：`Text` 的 UITransform 出厂值是 240（容器宽），
     * 引擎按文字内容刷新 contentSize 有**一帧延迟**，同帧读到 240 说明还没更新过 ⇒ 用兜底宽度。
     */
    private static readonly TEXT_WIDTH_MAX = 200;
    /** 宽度读不到时按「3 个字符的金币数字」估的兜底宽度（图标只会略偏，不会飞到画面外）。 */
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

    /** 飘字文案拆成「前缀 + 数值」两段（前缀单独一条小字号 Label，见 `renderPrefix`）。 */
    private static battleText(text: Readonly<ZCFloatText>): { prefix: string; value: string } {
        const value = ZCFloatTextView.compactBattleNumber(text.value);
        switch (text.kind) {
            // 正向收益保留 `+`：它标的是「加」这一个语义，与伤害的正负无关。
            case 'gold':
            case 'heal': return { prefix: '', value: `+${value}` };
            case 'miss': return { prefix: '', value: 'MISS' };
            // 伤害类**不再带负号**（2026-10-17 需求）：飘字本来就在挨打的目标身上，
            // 负号只增加一个字符宽度、和前缀挤在一起还容易读成「克制 -31」一个整体。
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

    @property({ type: Sprite, group: '节点引用', tooltip: 'GoldIcon：金币飘字左侧的金币图标（挂在 Text 下自动跟随上浮；只有 gold 飘字显示）' })
    goldIcon: Sprite | null = null;

    @property({ group: '数值表现', tooltip: '锚点相对目标位置的向上偏移（像素）' })
    offsetY = 26;

    @property({ group: '数值表现', tooltip: '整条飘字期间总共向上飘多少像素' })
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
     * 「快进慢出」的分界：前这么久完成**入场（位移 + 缩放 + 金币图标自转）**，之后缓慢淡出。
     *
     *  一个旋钮同时管两端 —— 早先是 `POP_PROGRESS = 0.3`（代码常量）与 `fadeStartProgress = 0.55`
     * 两个数，中间 0.25 段数字既不动也不淡，读起来是「卡了一下才消失」。合成一个之后，
     * 进到位的那一刻正是开始淡出的那一刻。缺省值与 `FLOAT_TEXT_ENTRANCE_PROGRESS` 同源。
     *
     * 2026-10-15 由 0.35 提到 **0.45**：35% 时入场太急、位移「唰」一下就走完，读不出「从目标头顶飘出来」。
     * 45% 仍小于一半 ⇒ 「快进 / 慢出」的定性不变（慢出仍占 55%）。
     */
    @property({ group: '数值表现', tooltip: '入场段占比（0~1）：前这么久完成位移 + 缩放，之后淡出' })
    entranceProgress = FLOAT_TEXT_ENTRANCE_PROGRESS;

    /**
     * 慢出段的**收尾漂移距离（像素）**：沿入场的方向再走这么一点（伤害继续下沉、金币继续上飘）。
     *
     * 量级压在 **5~10px**（2026-10-15：4 → 7）—— 只用来抵消「入场结束后完全静止地淡出」那种死板感。
     * 4px 在 720×1280 上太含蓄、几乎看不出在动；调到几十像素就变回「一直在飘」，
     * 等于把「快进慢出」退回去。
     */
    @property({ group: '数值表现', tooltip: '慢出段的收尾漂移距离（像素）：伤害继续下沉 / 金币继续上飘' })
    driftDistance = FLOAT_TEXT_DRIFT_DISTANCE;

    /** 复用的取色缓存：Label.color 的 setter 会拷贝，所以同一条飘字不会互相串色。 */
    private readonly tint = new Color();
    /**
     * 金币图标自己的 UIOpacity（懒取）：`textLabel` 的淡出走 `Label.color.a`，那是**只作用于 Label**
     * 的通道 —— 图标是独立 Sprite，不跟着它淡。所以图标单独用一条 opacity 与同一个 fade 同步。
     */
    private goldIconOpacity: UIOpacity | null = null;

    render(text: Readonly<ZCFloatText>, now: number): void {
        const duration = Math.max(0.001, text.durationSeconds);
        const progress = Math.max(0, Math.min(1, (now - text.startedAt) / duration));

        const parts = ZCFloatTextView.battleText(text);
        this.textLabel.string = parts.value;
        const fontSize = text.kind === 'critical' || text.kind === 'execute'
            ? ZCFloatTextView.EMPHASIS_FONT_SIZE : ZCFloatTextView.DEFAULT_FONT_SIZE;
        this.textLabel.fontSize = fontSize;
        // 「快进慢出」：入场进度（位移 / 缩放 / 图标自转共用）在前 `entranceProgress` 段走完，
        // 之后恒 1；淡出覆盖剩下的整段，并叠一段像素级同向漂移做收尾。
        // 三条都走 `ZCGameViewUtil` 的纯函数，别在视图里再算一遍。
        const enter = floatTextEntrance(progress, this.entranceProgress);
        const drift = floatTextDrift(progress, this.entranceProgress);
        const fade = this.applyColor(text, progress);
        // 前缀必须排在 `applyColor` 之后：它借用同一条染色缓存（同色同透明度）。
        this.renderPrefix(parts.prefix, fontSize, fade);
        // 世界定位一律由**根节点**承担（和 ZCUnitView / ZCCombatEffectView 同惯例），
        // Text 子节点只负责「基准上移 + 随进度上浮」的局部偏移。
        //  两处都写绝对坐标会让实际位置翻倍（子节点坐标是相对根节点的），
        //    表现是飘字整条跑到目标位置的两倍远处、大多直接落到屏幕外。
        this.node.setPosition(mapToViewX(text.x), mapToViewY(text.y), 0);
        // 金币图标：只有 gold 飘字显示。**每帧绝对赋值** —— 节点来自对象池，
        // 复用回来时上一次的 enabled 会残留（只表现为「伤害飘字旁边挂着个金币」）。
        if (this.goldIcon) {
            const isGold = text.kind === 'gold';
            this.goldIcon.enabled = isGold;
            if (isGold) this.renderGoldIcon(enter, fade);
        }
        if (text.kind !== 'gold') {
            const sequence = Math.max(0, text.id - 1);
            const lane = ZCFloatTextView.DAMAGE_LANES[sequence % ZCFloatTextView.DAMAGE_LANES.length];
            const row = Math.floor(sequence / ZCFloatTextView.DAMAGE_LANES.length) % 3;
            // 出现时已分开一半，随后继续向两侧漂移；散落、下坠、摇摆**都用入场进度**，
            // 所以整条位移在前 `entranceProgress` 段就走完（用 `progress` 会让数字飘满整条时长）。
            const spreadProgress = 0.55 + 0.45 * enter;
            const sway = Math.sin(enter * Math.PI) * (lane === 0 ? (row - 1) * ZCFloatTextView.DAMAGE_ROW_SWAY_CENTER : Math.sign(lane) * ZCFloatTextView.DAMAGE_ROW_SWAY_OFFSET);
            const x = lane * this.damageLaneSpacing * spreadProgress + sway;
            // 兵种视觉资源统一为 98×98 且中心锚定，头顶就是中心 +49px；只再留少量呼吸空间。
            const headY = this.damageTargetSize * 0.5 + this.damageHeadPadding;
            // 慢出段沿**同一方向**（继续下沉）再走 driftDistance 像素，做惯性收尾。
            const y = headY + row * ZCFloatTextView.DAMAGE_ROW_STEP
                - enter * (this.damageDropDistance + row * ZCFloatTextView.DAMAGE_ROW_DROP_EXTRA)
                - drift * this.driftDistance;
            this.textLabel.node.setPosition(x, y, 0);
        } else {
            // 金币仍向上飘，和向下散落的伤害数字形成清晰的方向区分；
            // 慢出段同样沿**同一方向**（继续上飘）收尾。
            this.textLabel.node.setPosition(0, this.offsetY + enter * this.riseDistance + drift * this.driftDistance, 0);
        }
        // 起手弹出：入场段内从 popScale 收回到 1，之后保持 1（与位移同一根轴）。
        const scale = 1 + (this.popScale - 1) * (1 - enter);
        this.textLabel.node.setScale(scale, scale, 1);
    }

    /**
     * 前缀（暴击 / 克制 / 抵抗 / 秒杀）：**单独一条小字号 Label**，字号取数字的一半。
     *
     * 为什么要拆成两条：`cc.Label` 一条字符串只有**一个**字号，`克制` 与 `31` 写在同一句里
     * 就只能同号 —— 需求「【克制】只有数字一半高」在单 Label 上无解，除非换 `RichText`
     * （那会连带改锚点/自适应宽度的行为，收益不值）。拆开后前缀挂在 `Text` 之下 ⇒
     * 位置、弹出缩放、上下散落全部自动继承，这里只补一个水平偏移与字号。
     *
     * 水平位置同样按数字**实际宽度**反推（`-(数字宽/2 + 间距 + 前缀半宽)`），与金币图标同一套算法：
     * `31` 与 `1.2K` 宽度差一倍，固定偏移会让前缀时而压字、时而飘太远。
     * 前缀恒为 2 个汉字，宽度直接按「字数 × 字号」算，不读 `UITransform`（那条路有一帧延迟）。
     *
     * 每帧**绝对赋值** `active`：节点来自对象池，复用回来时上一条的可见性会残留
     * （只表现为「普通伤害旁边贴着一个『克制』」）。
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
        // 与数字同色同透明度（`applyColor` 刚写好的缓存，克制就是那支红）。
        label.color = this.tint;
        const textWidth = this.readTextWidth();
        const prefixWidth = prefix.length * prefixSize;
        label.node.setPosition(
            -(textWidth * 0.5 + ZCFloatTextView.PREFIX_GAP + prefixWidth * 0.5), 0, 0);
    }

    /**
     * 金币图标：跟在数字左侧、随文字一起上浮（它是 `Text` 的子节点，位置与弹出缩放自动继承），
     * 同时**绕自身旋转**。
     *
     * 水平位置用数字的**实际宽度**反推（`-(数字宽/2 + 间距 + 图标半宽)`），不用固定偏移：
     * `+5` 与 `+1.2K` 宽度差一倍，固定偏移会让图标时而压在数字上、时而飘得太远。
     *
     * 自转走 `setRotationFromEuler(0, 0, 角度)`（屏幕平面内转圈，不是 3D 翻转），
     * 整圈正好在**入场段内**转完 —— 与上浮同步结束，不显得空转。
     *
     *  传的是 `enter`（入场进度）不是整条 `progress`：上浮自 2026-10-15 起收进前 45%，
     * 自转若还铺满整条时长，就会变成「数字已经停住、金币还在旁边自己转」。
     */
    private renderGoldIcon(enter: number, fade: number): void {
        const icon = this.goldIcon;
        if (!icon) return;
        const textWidth = this.readTextWidth();
        const half = ZCFloatTextView.GOLD_ICON_SIZE * 0.5;
        icon.node.setPosition(-(textWidth * 0.5 + ZCFloatTextView.GOLD_ICON_GAP + half), 0, 0);
        icon.node.setRotationFromEuler(0, 0, enter * ZCFloatTextView.GOLD_ICON_SPINS * 360);
        const opacity = this.getGoldIconOpacity();
        if (opacity) opacity.opacity = Math.round(255 * fade);
    }

    /**
     * 数字 Label 的实际宽度（像素）。
     * `Text` 的 overflow 设为 NONE，contentSize 由引擎按文字内容自适应，但有**一帧延迟**：
     * 同帧读到出厂宽度 240 时说明还没刷新过 ⇒ 退回兜底宽度（下一帧起就是准的）。
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

    /**
     * 按 kind 取色 + 尾段淡出；返回本帧的 alpha 系数（0~1），供金币图标同步淡出。
     *
     * 淡出曲线在 `ZCGameViewUtil.floatTextFade`（入场段恒 1，之后线性淡出到 0）——
     * 与入场共用 `entranceProgress` 一个旋钮，改动时不会漏掉另一半。
     */
    private applyColor(text: Readonly<ZCFloatText>, progress: number): number {
        const base = ZCFloatTextView.FLOAT_TEXT_COLOR_BY_KIND[text.kind];
        const fade = floatTextFade(progress, this.entranceProgress);
        this.tint.set(base.r, base.g, base.b, Math.round(base.a * fade));
        this.textLabel.color = this.tint;
        this.textLabel.enabled = fade > 0;
        return fade;
    }
}
