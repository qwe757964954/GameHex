import { formatBattleFloatAmount } from '../../../core/math/CompactNumber';
import { _decorator, Color, Component, Label, Sprite, UITransform, UIOpacity } from 'cc';
import type { ZCFloatText, ZCFloatTextKind } from '../model/ZCGameTypes';
import {
    FLOAT_TEXT_DRIFT_DISTANCE,
    FLOAT_TEXT_ENTRANCE_PROGRESS,
    FLOAT_TEXT_GOLD_INCOME_TOP_PX,
    floatTextDrift,
    floatTextEntrance,
    floatTextFade,
    floatTextGoldDrop,
    floatTextGoldRise,
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
 * 伤害类那条的**纵向方向分两档**（2026-11-23 用户：「玩家方造成的伤害数字是往上飞的，
 * 运动路径和现在的相反，受到伤害的数字运动路径保持不变」）：
 * · 我方打出去（`dealtByPlayer`）—— 起点在目标头顶，**向上飞**：
 *   `y = headY + row × 行距 + (入场位移 + 收尾漂移)`；
 * · 我方挨打 / 无标记 —— 起点同上，**原路向下坠**：`y = headY + row × 行距 − (入场位移 + 收尾漂移)`。
 * 两条**只有符号相反**，起点、距离、时序、轨道散落、弹出缩放全部共用 —— 判据见 `damageTravelSign`。
 *
 * 金币是例外，而且分两条完全相反的路（`ZCFloatTextKind` 已按来处拆开）：
 * · `gold`（击杀 / 拆建筑的掉落）—— `floatTextGoldDrop`：无数字，硬币从角色中心上方落到地面、
 * 停一下、原地缩小消失；不使用 riseDistance / driftDistance / popScale。
 * · `goldincome`（主城 / 金矿的产出）—— `floatTextGoldRise`：有数字，硬币 + 数字一起从
 * 建筑顶部往上升 50px 并淡出。锚点仍是格心，建筑高度由 FLOAT_TEXT_GOLD_INCOME_TOP_PX 补。
 *
 * **治疗（`heal`）自成一档**（2026-11-25 第 47 批）：绿字带 `+`、字号与伤害一致，
 * 轨迹是**竖直向上的直线 75px**、0.2s 匀速走完 —— 不套伤害那套「按 id 散横轨 + 方向符号」。
 * 距离在 `healRiseDistance`，时长在模型侧 `FLOAT_TEXT_HEAL_SECONDS`（视图只管比例）。
*/
@ccclass('ZCFloatTextView')
export class ZCFloatTextView extends Component {
    /**
     * 伤害类飘字的颜色口径（2026-11-20 用户）：
     * · 我方打出的伤害 / 暴击 / 克制增伤 —— 全白，靠字号与「暴击」前缀区分，不再分色；
     * · **本机席位**被扣血 —— 红字 + 负号（`takenFromPlayer`，见 `PLAYER_LOSS_COLOR`）。
     *   攻方是另一个玩家还是 NPC **都一样**：我方被打只有这一种样式；
     * · 两个非玩家互打 —— 模型侧直接不出飘字，这里没有对应分支。
     *
     * 抵抗（灰）与秒杀（橙）保持原样：需求只点了「伤害 / 暴击 / 克制」三档，
     * 这两个是提示语义（少受伤 / 处决），并进白字会丢掉信息。
     *
     * **前缀（暴击 / 克制 / 抵抗 / 秒杀）只挂在「我方打出去」的那条上**（`dealtByPlayer`）：
     * 我方被扣血 —— 红字负号那档、以及被 NPC 打的白字那档 —— 只有「负号 + 血量」，
     * 而且**字号也是默认号**（`takenFromPlayer` 压平 kind 的放大，2026-11-23 用户）。
     * 所以取色只看 kind / `takenFromPlayer`，前缀与字号另看 `dealtByPlayer`，两者不能互相替代。
     */
    private static readonly NORMAL_DAMAGE_COLOR = new Color(255, 255, 255, 255);
    private static readonly CRITICAL_COLOR = ZCFloatTextView.NORMAL_DAMAGE_COLOR;
    private static readonly RESTRAINT_COLOR = ZCFloatTextView.NORMAL_DAMAGE_COLOR;
    /** 本机席位被扣血：红字 + 负号（攻方是玩家或 NPC 都一样）。 */
    private static readonly PLAYER_LOSS_COLOR = new Color(255, 72, 62, 255);
    private static readonly HEAL_COLOR = new Color(91, 255, 49, 255);
    private static readonly RESISTED_COLOR = new Color(150, 150, 150, 255);
    private static readonly EXECUTE_COLOR = new Color(255, 105, 72, 255);
    private static readonly MISS_COLOR = new Color(120, 205, 255, 255);
    private static readonly GOLD_COLOR = new Color(255, 198, 45, 255);

    /** 按 kind 取色：穷举表，缺 key 会编译失败（新增 kind 必须补色）。*/
    private static readonly FLOAT_TEXT_COLOR_BY_KIND: Readonly<Record<ZCFloatTextKind, Color>> = {
        damage: ZCFloatTextView.NORMAL_DAMAGE_COLOR,
        critical: ZCFloatTextView.CRITICAL_COLOR,
        heal: ZCFloatTextView.HEAL_COLOR,
        restraint: ZCFloatTextView.RESTRAINT_COLOR,
        resisted: ZCFloatTextView.RESISTED_COLOR,
        execute: ZCFloatTextView.EXECUTE_COLOR,
        miss: ZCFloatTextView.MISS_COLOR,
        gold: ZCFloatTextView.GOLD_COLOR,
        goldincome: ZCFloatTextView.GOLD_COLOR,
    };

    /** 连续伤害按中、左、右交替排布；五条轨道正好收在 98px 兵种画布宽度内。*/
    private static readonly DAMAGE_LANES = [0, -1, 1, -2, 2] as const;
    private static readonly DEFAULT_FONT_SIZE = 30;
    /** 暴击字号 = 普通字号 × 1.7（2026-11-20 用户：「出现暴击就用 1.7 倍大的数字字体」）。*/
    private static readonly CRITICAL_FONT_SIZE = Math.round(ZCFloatTextView.DEFAULT_FONT_SIZE * 1.7);
    /** 秒杀沿用旧的大字号（需求没点它，别跟着暴击一起放大）。*/
    private static readonly EXECUTE_FONT_SIZE = 34;
    /**
     * 前缀字号 = 数字字号 × 该比例。数字只占 0.72em 大写高、汉字占 0.95em，
     * 取 0.5 后视觉高度约 0.66；要再贴近「一半高」只改此值。
    */
    private static readonly PREFIX_FONT_RATIO = 0.5;
    /** 前缀与数字的水平间距：前缀描边会各吃掉 1px，间距过小会贴成整体。*/
    private static readonly PREFIX_GAP = 6;
    /** 连续伤害的三行轨道：行距、每行额外的下坠量、中心/两侧摇摆幅度。*/
    private static readonly DAMAGE_ROW_STEP = 30;
    private static readonly DAMAGE_ROW_DROP_EXTRA = 6;
    private static readonly DAMAGE_ROW_SWAY_CENTER = 4;
    private static readonly DAMAGE_ROW_SWAY_OFFSET = 3;

    /**
     * 金币掉落段内的自转圈数（屏幕平面内）。图标尺寸（30×30）在 prefab 的 GoldIcon 上定，
     * 本文件只管位置 / 自转 / 透明度。
    */
    private static readonly GOLD_ICON_SPINS = 1;
    /**
     * 产金飘字里硬币的半边长（prefab GoldIcon 30×30 的一半）。
     * 只有 `goldincome` 用得上：它有数字，硬币要压在数字左侧，不能像 `gold` 那样居中重叠。
    */
    private static readonly GOLD_ICON_HALF_SIZE = 15;
    /** 产金飘字里硬币与数字的横向间距（数字描边各吃 1px，再小会贴成整体）。*/
    private static readonly GOLD_ICON_TEXT_GAP = 4;
    /** Text 宽度上限：contentSize 自适应有一帧延迟，读到出厂值 240 时用兜底宽度。*/
    private static readonly TEXT_WIDTH_MAX = 200;
    /** 宽度读不到时的兜底宽度（按 3 个字符数字估算）。*/
    private static readonly TEXT_WIDTH_FALLBACK = 40;

    /** 飘字文案拆成「前缀 + 数值」两段（前缀用独立小字号 Label，见 renderPrefix）。*/
    private static battleText(text: Readonly<ZCFloatText>): { prefix: string; value: string } {
        const value = formatBattleFloatAmount(text.value);
        // 玩家卡牌被别的玩家扣血：负号直接拼进数值，与数字同字号连成「-5」；
        // 走前缀位会被缩到一半字号并留出间距，读起来像一个独立的短横。
        const sign = text.takenFromPlayer ? '-' : '';
        // 前缀是「我方打出去的」才有的标记（2026-11-20 用户）：
        // 暴击 / 克制 / 抵抗 / 秒杀 都只在我方对别人造成伤害时出现；
        // 我方被扣血 —— 被另一个玩家打（红字负号）、被 NPC 打（白字）—— 一律只有数字本身。
        // 少了这一道闸，塔防局里 NPC 打我方卡的每一下都会挂一个【克制】【暴击】，数字反而读不出来。
        const mark = (prefix: string): string => (text.dealtByPlayer && !text.takenFromPlayer ? prefix : '');
        switch (text.kind) {
            // 金币无文字，只剩硬币图标，连 + 也不拼。
            case 'gold': return { prefix: '', value: '' };
            // 建筑产金有数字（用户口径「金币 icon 和对应的数字 UI」），+ 号标"到账"。
            // 与 gold 的差别不只是显示与否：那条是掉落物，数字会跟掉落物抢地面，藏掉更干净。
            case 'goldincome': return { prefix: '', value: `+${value}` };
            // 治疗保留 + 号，标的是「加」语义。
            case 'heal': return { prefix: '', value: `+${value}` };
            case 'miss': return { prefix: '', value: 'MISS' };
            // 伤害类不带负号：飘字本就在挨打目标身上，负号只增加宽度并易与前缀读成整体。
            // 例外是「玩家卡牌被别的玩家扣血」—— 那条要的就是负号，见上面的 `sign`。
            case 'critical': return { prefix: mark('暴击'), value: `${sign}${value}` };
            // 克制增伤只在我方打出去时标【克制】；被打到的那一下只有血量。
            case 'restraint': return { prefix: mark('克制'), value: `${sign}${value}` };
            case 'resisted': return { prefix: mark('抵抗'), value: `${sign}${value}` };
            case 'execute': return { prefix: mark('秒杀'), value: `${sign}${value}` };
            default: return { prefix: '', value: `${sign}${value}` };
        }
    }

    /**
     * 伤害飘字的纵向方向：`+1` 向上飞 / `−1` 向下坠（2026-11-23 用户）。
     *
     * > 「战斗中，玩家方造成的伤害数字是往上飞的，运动路径和现在的相反，
     * >  受到伤害的数字运动路径保持不变」
     *
     * 判据直接用模型已经算好的两个正交标记，**视图不拿 `owner` 反推**：PVP 四人局里另外三个
     * 席位也是真人，按 owner 判会把「我方打出去」和「我方挨打」两档都判错
     * （真源是 `ZCMatchConfig.npcOwners`，见 ZCGameTypes 里两个字段的注释）：
     * · `dealtByPlayer` ⇒ 我方打出的一击，向上飞；
     * · `takenFromPlayer` ⇒ 我方掉的血，**原样向下**（红字负号那档一个像素都不动）。
     * 两个同时出现时以 `takenFromPlayer` 为准 —— 挨打那条的样式是「我掉了多少血」，
     * 方向跟着它走才和颜色 / 字号 / 负号是同一档语义。
     *
     * 无标记（`miss` / 测试里的裸伤害文本）保持旧行为：向下坠。
     * 运行时不会出现「无标记的伤害」—— 非玩家互打模型侧直接不推飘字。
     *
     * 2026-11-25 起 `heal` **不再走这里**：治疗是「直线上升 75px、0.2s」，见 `render` 的
     * `heal` 分支（它连横轨与摇摆都不用）。这条判据只剩伤害类语义。
     */
    private static damageTravelSign(text: Readonly<ZCFloatText>): 1 | -1 {
        return text.dealtByPlayer === true && text.takenFromPlayer !== true ? 1 : -1;
    }

    @property({ type: Label, group: '节点引用', tooltip: 'Text：显示数值的 Label（必填）' })
    textLabel: Label = null!;

    @property({
        type: Label,
        group: '节点引用',
        tooltip: 'Text/Prefix：暴击 / 克制 / 抵抗 / 秒杀 的小字号前缀（只在我方打出去的伤害上显示）',
    })
    prefixLabel: Label = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'GoldIcon：金币飘字的金币图标（挂在 Text 下自动跟随；gold 与 goldincome 都显示）' })
    goldIcon: Sprite = null!;

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

    /**
     * 伤害数字的纵向位移距离 —— **两档共用同一个距离、只有方向相反**（2026-11-23 用户
     * 「运动路径和现在的相反」）：我方打出去的往上飞这么远，挨打的往下坠这么远。
     *
     * 名字停在 Drop 是因为 prefab 按字段名绑值（改名会丢序列化值、静默退回缺省），
     * 语义已经是「纵向位移」；要两档走不同距离再拆一个新字段，别改这个。
     */
    @property({ group: '数值表现', tooltip: '伤害数字的纵向位移距离：我方造成向上飞 / 挨打向下坠（同一距离、方向相反）' })
    damageDropDistance = 100;

    /**
     * 治疗数字的直线上升距离（像素），0.2s 内匀速走完（2026-11-25 第 47 批）。
     *
     * 与伤害的 `damageDropDistance` 拆开：治疗是**直线**上浮、不分轨道、不摇摆、不回落，
     * 而且距离由需求指定 75px。合用一个字段会让「改伤害下坠距离」顺手改掉治疗。
     */
    @property({ group: '数值表现', tooltip: '治疗数字的直线上升距离（像素）：匀速走完整条时长，不分轨道不摇摆' })
    healRiseDistance = 75;

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

    /** 慢出段收尾漂移距离：沿入场方向再走一点，避免静止淡出的死板感。*/
    @property({ group: '数值表现', tooltip: '慢出段的收尾漂移距离（像素）：随该条飘字的方向 —— 我方造成继续上浮 / 挨打继续下沉' })
    driftDistance = FLOAT_TEXT_DRIFT_DISTANCE;

    /** 复用的取色缓存：Label.color 的 setter 会拷贝，同一条飘字不会互相串色。*/
    private readonly tint = new Color();
    /** 金币图标的 UIOpacity（懒取）：Label.color.a 只作用于 Label，独立 Sprite 需单独同步淡出。*/
    private goldIconOpacity: UIOpacity | null = null;

    /**
     * `gold`（击杀 / 拆建筑掉落）的落点高度 = 兵种画布中心（单位根节点是逻辑脚点，
     * 画布中心在其上方约 49px，取 offsetY=26 只到下半身）。
     *
     * 只服务 `gold`。建筑产金（`goldincome`）的基准是建筑顶部，不走这里 ——
     * 见 `FLOAT_TEXT_GOLD_INCOME_TOP_PX`。
    */
    private get goldCenterY(): number {
        return this.damageTargetSize * 0.5;
    }

    render(text: Readonly<ZCFloatText>, now: number): void {
        const duration = Math.max(0.001, text.durationSeconds);
        const progress = Math.max(0, Math.min(1, (now - text.startedAt) / duration));

        const parts = ZCFloatTextView.battleText(text);
        this.textLabel.string = parts.value;
        // 我方被扣血只有一种样式（2026-11-23 用户）：红字 + 负号 + **默认字号**。
        // 暴击 1.7 倍 / 秒杀 34 号的放大在这一档一并压平 —— 那条飘字要说的是「我掉了多少血」，
        // 放大数字会让人误读成「我方打出暴击」，与「暴击」前缀是同一个战果语义，
        // 所以字号和前缀一起只挂在 `dealtByPlayer` 那一侧（见 battleText 的 mark）。
        const fontSize = text.takenFromPlayer ? ZCFloatTextView.DEFAULT_FONT_SIZE
            : text.kind === 'critical' ? ZCFloatTextView.CRITICAL_FONT_SIZE
                : text.kind === 'execute' ? ZCFloatTextView.EXECUTE_FONT_SIZE
                    : ZCFloatTextView.DEFAULT_FONT_SIZE;
        this.textLabel.fontSize = fontSize;
        // 金币两种各走自己的曲线（掉落 / 产金，方向相反），其余走「快进慢出」，互不干扰。
        const gold = text.kind === 'gold' ? floatTextGoldDrop(progress) : null;
        // 建筑产金走相反的上升曲线（只向上）。两个分支互斥，同时只会有一条非 null。
        const goldIncome = text.kind === 'goldincome' ? floatTextGoldRise(progress) : null;
        const enter = floatTextEntrance(progress, this.entranceProgress);
        // 淡出系数：金币（两种都算）用自己的，其余走 floatTextFade。
        const fade = this.applyColor(
            text, progress, gold ? gold.fade : goldIncome ? goldIncome.fade : null);
        // 前缀借用同一条染色缓存，必须在 applyColor 之后。
        this.renderPrefix(parts.prefix, fontSize, fade);
        // 世界定位由根节点承担，Text 子节点只做局部偏移；两处都写绝对坐标会让位置翻倍。
        this.node.setPosition(mapToViewX(text.x), mapToViewY(text.y), 0);
        // 每帧绝对赋值 enabled：节点来自对象池，复用会残留上一次状态。
        if (this.goldIcon) {
            this.goldIcon.enabled = gold !== null || goldIncome !== null;
            // 掉落：硬币压在落点上自转一圈。产金：硬币不自转，让到数字左侧 —— 这条有数字，
            // 居中重叠会把「+16」的加号盖掉。
            if (gold) this.renderGoldIcon(gold.spin, fade);
            else if (goldIncome) this.renderGoldIcon(0, fade, this.goldIncomeIconX);
        }
        if (gold) {
            // 用 enabled=false 而非关 Text 节点：金币图标是 Text 的子节点，关节点会把硬币一起隐藏。
            this.textLabel.enabled = false;
            // 不上浮、不漂移，从上方落到角色中心。
            this.textLabel.node.setPosition(0, this.goldCenterY + gold.drop, 0);
            this.textLabel.node.setScale(gold.scale, gold.scale, 1);
            return;
        }
        if (goldIncome) {
            // 建筑产金：数字保持可见（applyColor 已按 fade 写过 enabled），硬币与数字同组上浮
            // —— 硬币是 Text 的子节点，所以移动父节点就等于两个一起动，不需要各算一遍。
            //  基准是建筑顶部（格心 + FLOAT_TEXT_GOLD_INCOME_TOP_PX），不是角色中心；
            //    上升量全程 >= 0，所以这条飘字只会往上走。
            this.textLabel.node.setPosition(
                0, FLOAT_TEXT_GOLD_INCOME_TOP_PX + goldIncome.rise, 0);
            // 对象池里的上一条可能是 `gold`（末尾 scale 收到 0）⇒ 必须显式写回 1。
            this.textLabel.node.setScale(1, 1, 1);
            return;
        }
        {
            //  治疗（2026-11-25 第 47 批，用户口径「移动轨迹是直线上移 75px，持续 0.2s」）：
            //  **只有一条竖直向上的直线** —— 不分横轨、不摇摆、不回落。
            //
            //  🔴 不能落到下面那段伤害通用逻辑里：那里 `damageTravelSign` 对无标记的 kind 返回 −1
            //  （向下坠），还会按 `text.id` 散到 5 条横向轨道上。治疗套进去的症状是
            //  「一半治疗数字往地里钻、并且每次位置都偏一点」，不报错、只是读起来像 bug。
            //  起点仍取 `headY`（角色头顶），与伤害数字同一基线 —— 需求要的就是「字号 / 位置同伤害」。
            if (text.kind === 'heal') {
                const headY = this.damageTargetSize * 0.5 + this.damageHeadPadding;
                //  匀速走完整条时长：`progress` 而不是 `enter` —— 入场段走完就该正好 75px，
                //  用 enter 会在入场结束时就停住，后半段变成原地不动地淡出。
                const rise = this.healRiseDistance * progress;
                const scale = 1 + (this.popScale - 1) * (1 - enter);
                this.textLabel.node.setPosition(0, headY + rise, 0);
                this.textLabel.node.setScale(scale, scale, 1);
                return;
            }
            const drift = floatTextDrift(progress, this.entranceProgress);
            const sequence = Math.max(0, text.id - 1);
            const lane = ZCFloatTextView.DAMAGE_LANES[sequence % ZCFloatTextView.DAMAGE_LANES.length];
            const row = Math.floor(sequence / ZCFloatTextView.DAMAGE_LANES.length) % 3;
            // 散落 / 纵向位移 / 摇摆都用入场进度，位移在入场段内走完（用 progress 会飘满整条时长）。
            const spreadProgress = 0.55 + 0.45 * enter;
            const sway = Math.sin(enter * Math.PI) * (lane === 0 ? (row - 1) * ZCFloatTextView.DAMAGE_ROW_SWAY_CENTER : Math.sign(lane) * ZCFloatTextView.DAMAGE_ROW_SWAY_OFFSET);
            const x = lane * this.damageLaneSpacing * spreadProgress + sway;
            // 98×98 视觉中心锚定，头顶 = 中心 +49px，再留少量呼吸空间。
            const headY = this.damageTargetSize * 0.5 + this.damageHeadPadding;
            // 纵向两档（2026-11-23 用户）：我方打出去 ⇒ 向上飞；挨打 ⇒ 保持向下坠。
            // 起点、距离、时序、轨道、缩放全部共用，只有这个符号相反 —— 见 damageTravelSign。
            const dir = ZCFloatTextView.damageTravelSign(text);
            // 入场段走完位移、慢出段沿同一方向做惯性收尾（两段同向，不会互相打架）。
            const travel = enter * (this.damageDropDistance + row * ZCFloatTextView.DAMAGE_ROW_DROP_EXTRA)
                + drift * this.driftDistance;
            const y = headY + row * ZCFloatTextView.DAMAGE_ROW_STEP + dir * travel;
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
     * 金币图标的落位与透明度。
     *
     * `x` 默认 0 = 居中压在落点上（`gold` 掉落：没有数字可对齐，再按文字宽度往左偏只会让硬币凭空偏左）；
     * `goldincome` 传数字左缘再往左半个硬币宽 —— 那条有数字，硬币要在左边排成一排。
     * 自转只在掉落段（两种情况都用的 `spin`，产金传 0）。
    */
    private renderGoldIcon(spin: number, fade: number, x = 0): void {
        const icon = this.goldIcon;
        icon.node.setPosition(x, 0, 0);
        icon.node.setRotationFromEuler(0, 0, spin * ZCFloatTextView.GOLD_ICON_SPINS * 360);
        const opacity = this.getGoldIconOpacity();
        if (opacity) opacity.opacity = Math.round(255 * fade);
    }

    /**
     * 产金飘字里硬币的横向位置：数字左缘再往左 `间距 + 半硬币`。
     * 数字宽度读 `UITransform`（overflow=NONE 时由 Label 按文字内容刷新，有一帧延迟，见 readTextWidth）。
    */
    private get goldIncomeIconX(): number {
        return -(this.readTextWidth() * 0.5
            + ZCFloatTextView.GOLD_ICON_TEXT_GAP
            + ZCFloatTextView.GOLD_ICON_HALF_SIZE);
    }

    /**
     * 数字 Label 实际宽度：overflow=NONE 时 contentSize 自适应但有一帧延迟，
     * 读到出厂值 240 时退回兜底宽度。
    */
    private readTextWidth(): number {
        // Text 节点在 ZCGameFloatText.prefab 上带 UITransform + Label。
        const width = this.textLabel.node.getComponent(UITransform).width;
        return width > 0 && width <= ZCFloatTextView.TEXT_WIDTH_MAX
            ? width : ZCFloatTextView.TEXT_WIDTH_FALLBACK;
    }

    private getGoldIconOpacity(): UIOpacity | null {
        if (!this.goldIconOpacity) {
            this.goldIconOpacity = this.goldIcon.node.getComponent(UIOpacity)
                ?? this.goldIcon.node.addComponent(UIOpacity);
        }
        return this.goldIconOpacity;
    }

    /** 按 kind 取色 + 尾段淡出，返回本帧 alpha 系数（0~1）供金币图标同步。*/
    private applyColor(text: Readonly<ZCFloatText>, progress: number, fadeOverride: number | null = null): number {
        // 「玩家卡牌被别的玩家扣血」优先于 kind：暴击 / 克制在这一档同样是红字，
        // 而且字号也一样（2026-11-23 起 takenFromPlayer 会把 kind 的字号一起压平）。
        const base = text.takenFromPlayer
            ? ZCFloatTextView.PLAYER_LOSS_COLOR
            : ZCFloatTextView.FLOAT_TEXT_COLOR_BY_KIND[text.kind];
        // 金币有自己的淡出曲线，其余走 floatTextFade。
        const fade = fadeOverride === null ? floatTextFade(progress, this.entranceProgress) : fadeOverride;
        this.tint.set(base.r, base.g, base.b, Math.round(base.a * fade));
        this.textLabel.color = this.tint;
        this.textLabel.enabled = fade > 0;
        return fade;
    }
}
