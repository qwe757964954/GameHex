import { _decorator, Color, Component, Graphics, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { bigMapMarkerLayout, type IBigMapMarkerHitArea } from './BigMapWorldLayout';
import { paintMapMarkerBadge } from '../../common/MapMarkerBadge';

const { ccclass, property } = _decorator;

/** 名条左端徽章中心相对条中心的横向偏移（设计稿「大地图3」：菱形/圆形徽章都落在 -70 附近）。 */
const PLATE_BADGE_X = -70;
/** 名条名字的左边缘相对条中心的横向偏移：`-宽/2 + 76`（设计稿两条口径一致，取中值 -24）。 */
const PLATE_NAME_X = -24;
/** 名字到条右端的内边距。 */
const PLATE_NAME_RIGHT_PAD = 10;
/** 徽章数字框宽（两位数字 31px + 余量），超过用 `Overflow.SHRINK` 收。 */
const PLATE_LEVEL_WIDTH = 50;

/**
 * 据点标记：建筑图 + **名条**（徽章数字 + 名字）+ 其上的「谁占着」小旗 + 主城头像。
 *
 * 布局口径（2026-11-02 蓝湖「大地图3」）：
 * · 名条压在**建筑下方**，顶边与建筑底边齐平（见 `bigMapMarkerLayout`）；
 * · 名条底是**整条贴图**（四张按归属分：野怪蓝 / 关卡红 / 己方绿 / 他人灰），
 *   左端徽章位写等级或关卡号，右侧写据点名 —— 贴图尺寸不同，位置全部按
 *   当前那张的 `rect` 现算，不写死；
 * · 缺图时（美术未导入）退回手画角标：`paintMapMarkerBadge` + 单色底，
 *   只写数字，名字和旗子自动隐藏，绝不出现「空白条」。
 */
@ccclass('BigMapWorldMarker')
export class BigMapWorldMarker extends Component {
    @property({ type: Sprite, group: '图标' }) icon: Sprite = null;
    /** 名条底图（蓝湖四张 `plate_*`）。字段名沿用 `badge`，历史原因：它原来是手画角标的底。 */
    @property({ type: Sprite, group: '名条' }) private badge: Sprite = null;
    /** 徽章位数字（等级 / 关卡号）。 */
    @property({ type: Label, group: '名条' }) private label: Label = null;
    /** 条右侧的据点名。 */
    @property({ type: Label, group: '名条' }) private nameLabel: Label = null;
    /** 名条的手画兜底底板：**只在没贴图时**显示。 */
    @property({ type: Graphics, group: '名条' }) private badgeBackground: Graphics = null;
    /** 占据者（小旗 + 名字）整段；没有占据者时整段隐藏。 */
    @property({ type: Node, group: '占据者' }) private occupantRoot: Node = null;
    @property({ type: Sprite, group: '占据者' }) private occupantFlag: Sprite = null;
    @property({ type: Label, group: '占据者' }) private occupantLabel: Label = null;
    @property({ type: Node, group: '玩家头像' }) private portraitRoot: Node = null;
    @property({ type: Sprite, group: '玩家头像' }) private portrait: Sprite = null;

    /**
     * `render()` 算出的**原始命中框**（不含头像外扩）。
     *
     * 头像会把命中框往上撑 120px（`setPortrait`）。撑的动作必须以**这份基框**为输入而不是
     * 拿 `markerLayout` 就地累加 —— 否则「只换头像、不重跑 `render()`」的调用（换装 / 玩家改名
     * 之类）每调一次就再撑 120px，命中框和头像偏移量一起漂走，且从界面上看不出根因。
     */
    private baseLayout: Omit<IBigMapMarkerHitArea, 'hexId'> = { width: 0, height: 0 };
    private markerLayout: Omit<IBigMapMarkerHitArea, 'hexId'> = { width: 0, height: 0 };

    get hitArea(): Omit<IBigMapMarkerHitArea, 'hexId'> { return this.markerLayout; }

    /**
     * @param frame 建筑图（据点/野怪/主城）。
     * @param plate 名条贴图；`null` 时退回手画角标。
     * @param level 徽章位文字（等级 / 关卡号 / 空串）。
     * @param name 条右侧的据点名（空串 = 不显示，给只有角标的旧口径兜底）。
     * @param occupant 占据者名字（空串 = 整段隐藏）。
     * @param tint 只有**手画兜底**用它上色；有贴图时贴图自带的颜色才是真源。
     */
    render(
        frame: SpriteFrame | null,
        plate: SpriteFrame | null,
        level: string,
        name: string,
        occupant: string,
        tint: Color,
        width: number,
    ): void {
        this.icon.spriteFrame = frame;
        this.icon.node.active = !!frame;
        const scale = frame ? width / frame.rect.width : 1;
        // `rect` 在「图集还没就绪」时可能是 0×0，退回 `originalSize` 才不会把名条设成 0 尺寸。
        const plateWidth = plate ? (plate.rect.width || plate.originalSize.width) : 0;
        const plateHeight = plate ? (plate.rect.height || plate.originalSize.height) : 0;
        this.markerLayout = bigMapMarkerLayout(
            frame ? width : 0,
            frame ? frame.rect.height * scale : 0,
            plateWidth || undefined,
            plateHeight || undefined,
        );
        this.baseLayout = this.markerLayout;
        this.portraitRoot.active = false;
        this.icon.color = Color.WHITE;
        this.icon.node.setScale(scale, scale, 1);
        this.icon.node.setPosition(frame ? -frame.offset.x * scale : 0,
            (frame ? -frame.offset.y * scale : 0) + (this.markerLayout.iconY ?? 0), 0);

        const badgeTransform = this.badge.node.getComponent(UITransform);
        this.badge.node.setPosition(0, this.markerLayout.badgeY ?? 0, 0);
        this.badge.trim = false;
        this.badge.sizeMode = Sprite.SizeMode.CUSTOM;
        // ⚠️ `plate` 为 null 时**不要**把 `spriteFrame` 赋成 null —— 那会连 prefab 里
        // `Badge` 预置的底图（plate_city）一起清掉，界面上只剩光秃秃的文字，看起来就是「边框丢了」。
        if (plate) {
            this.badge.spriteFrame = plate;
            if (badgeTransform) badgeTransform.setContentSize(plateWidth, plateHeight);
        } else if (badgeTransform && badgeTransform.width <= 0) {
            badgeTransform.setContentSize(88, 30);
        }
        // 手画底板只在**真的没图**时画：有图还画会把贴图整个盖住（老 bug 的形态）。
        // 必须按名条**整条**尺寸画（不是 88×30 的小角标）—— 缺图时也要是「一整条」，
        // 否则界面上还是光秃秃的文字，看不出到底是缺图还是节点没渲染。
        this.badgeBackground.enabled = !plate && !this.badge.spriteFrame;
        if (this.badgeBackground.enabled) {
            const fallbackWidth = plateWidth || 202;
            const fallbackHeight = plateHeight || 56;
            const bgTransform = this.badgeBackground.node.getComponent(UITransform);
            if (bgTransform) bgTransform.setContentSize(fallbackWidth, fallbackHeight);
            if (badgeTransform) badgeTransform.setContentSize(fallbackWidth, fallbackHeight);
            paintMapMarkerBadge(this.badgeBackground, tint, new Color(49, 31, 26), fallbackWidth, fallbackHeight);
        }

        // 一次性诊断已定位问题（`Badge` 的 Sprite 在 prefab 里 `_enabled=false`），探针移除。

        this.label.string = level;
        this.label.node.setPosition(PLATE_BADGE_X, 0, 0);
        const levelTransform = this.label.node.getComponent(UITransform);
        if (levelTransform) levelTransform.setContentSize(PLATE_LEVEL_WIDTH, plateHeight || 30);

        this.nameLabel.string = name;
        this.nameLabel.node.active = name !== '';
        this.nameLabel.node.setPosition(PLATE_NAME_X, 0, 0);
        const nameTransform = this.nameLabel.node.getComponent(UITransform);
        if (nameTransform) {
            nameTransform.setAnchorPoint(0, 0.5);
            // 左边缘在 `PLATE_NAME_X`（负值），右边缘留 `PLATE_NAME_RIGHT_PAD` ⇒ 宽度是**差**。
            nameTransform.setContentSize(
                plateWidth ? plateWidth / 2 - PLATE_NAME_RIGHT_PAD - PLATE_NAME_X : 0,
                plateHeight || 30,
            );
        }

        this.occupantRoot.active = occupant !== '';
        this.occupantLabel.string = occupant;
        this.occupantRoot.setPosition(0, (this.markerLayout.iconY ?? 0) + this.markerLayout.height / 2 - 6, 0);
    }

    /** 「这格是谁占的」小旗 + 名字：贴在建筑顶边，旗在左、名字在右。 */
    setOccupantFlag(frame: SpriteFrame | null): void {
        this.occupantFlag.spriteFrame = frame;
        this.occupantFlag.node.active = frame !== null;
        if (!frame) { this.occupantLabel.node.setPosition(-84, 0, 0); return; }
        const flagWidth = 37;
        const scale = flagWidth / Math.max(1, frame.rect.width);
        this.occupantFlag.node.setScale(scale, scale, 1);
        // 设计稿实测（「大地图3」帐篷上那条）：旗中心在建筑中心左 105px，名字左边缘左 84px。
        this.occupantFlag.node.setPosition(-105, 0, 0);
        this.occupantLabel.node.setPosition(-84, 0, 0);
    }

    /**
     * 把「占据者」那一行改成**状态行**（名单玩家标记用它显示血量）。
     *
     * 复用同一个 Label 而不是新增节点：玩家标记没有建筑图，`iconY + height/2` 落点会跟名条撞，
     * 所以 y 由调用方给。旗帜一律隐藏 —— 玩家不是"占据这座建筑"的人，挂旗会读成据点归属。
     */
    setStatusLine(text: string, y: number): void {
        this.occupantRoot.active = text !== '';
        this.occupantFlag.node.active = false;
        this.occupantLabel.string = text;
        this.occupantRoot.setPosition(0, y, 0);
    }

    setPortrait(frame: SpriteFrame | null): void {
        this.portrait.spriteFrame = frame;
        this.portraitRoot.active = frame !== null;
        // 撤掉头像：命中框退回 `render()` 的原始值，别把上一次撑过的框留着（撤回 / 换号都走这里）。
        if (!frame) { this.markerLayout = this.baseLayout; return; }
        // 头像挂在**建筑上方**（名条已经挪到下方，两者不能再抢同一个位置）。
        const iconTop = (this.baseLayout.iconY ?? 0) + this.baseLayout.height / 2;
        this.portraitRoot.setPosition(0, iconTop + 60, 0);
        // 点击范围把头像一起框住：把建筑命中矩形往上扩到头顶（`height` 与 `iconY` 同比长）。
        // 从 `baseLayout` 派生 ⇒ 重复调用是幂等的，撑出来的框恒等于「基框 + 120」，不会逐次累加。
        this.markerLayout = {
            ...this.baseLayout,
            height: this.baseLayout.height + 120,
            iconY: (this.baseLayout.iconY ?? 0) + 60,
        };
    }
}
