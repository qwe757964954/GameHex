/**
 * 「更换宝石」两栏面板（**运行时构建**，不改 prefab 节点树）。
 *
 * 为什么用代码建而不是在 `RoleGemInfoPopup.prefab` 里加节点：
 *  - 该 prefab 已经 469 个序列化对象，手工插节点要连带改一堆 `__id__`，风险高于收益；
 *  - 布局还在跟设计对齐（左栏行高 / 右栏卡高随时会动），代码里一改两个常数就生效。
 * 真要固化到 prefab，把 `build()` 里的坐标抄过去即可，常量都提到文件顶部了。
 *
 * 交互口径（对齐 `RoleGemInfoPopup.onInlayClick`）：
 *  5 个孔位全满时，**左栏列的是「已被镶嵌的 5 颗旧宝石」**，选中某行 = 决定让哪一孔被覆盖，
 *  右栏把「该孔当前宝石 → 即将镶上的宝石」并排给出来，底部只有一个金色「确认替换」。
 *
 * 美术：全部取工程现有 sprite（`resources/image/**` + `RoleArt` key + `icons/gem`、`icons/equip`），
 * 不引入任何新图，避免出现第二套美术。
 */
import {
    Button,
    Color,
    Component,
    HorizontalTextAlignment,
    Label,
    Layers,
    Node,
    Sprite,
    SpriteFrame,
    UITransform,
    VerticalTextAlignment,
    _decorator,
} from 'cc';
import { spriteFramePathOf } from '../ArtPaths';
import { createRoutedSpriteFrameCache } from '../common/SpriteFrameCache';
import { gemEffectBadge } from './RoleGemEffectText';
import { loadRoleArt, loadRoleBagIconSprite, loadRoleQualityFrame } from './RoleArtLoader';
import type { IRoleGemEntry, IRoleGemSocket } from './RoleTypes';

const { ccclass } = _decorator;

// ============================================================
// 布局常量（面板坐标系：中心为原点，宽 660 × 高 760）
// ============================================================
const PANEL_W = 660;
const PANEL_H = 760;
const COL_W = 276;
const ROW_W = 276;
const ROW_H = 84;
const ROW_Y0 = 200;
const ROW_STEP = 90;
const LEFT_X = -152;
const RIGHT_X = 152;
const TITLE_Y = 348;
const CUR_Y = 243;
const CARD_Y = -15;
const CARD_H = 358;
const MAX_ROWS = 5;

const C_TITLE = new Color(255, 233, 179, 255);
const C_WHITE = new Color(255, 253, 246, 255);
const C_VALUE = new Color(255, 232, 150, 255);
/** 选中行文字：金底上用更深的墨色，且**不描边**（深字 + 深描边在 15px 下会糊成一团）。 */
const C_DARK = new Color(58, 32, 4, 255);
const C_DARK_VALUE = new Color(128, 54, 2, 255);
const C_HEAD = new Color(106, 76, 44, 255);
const C_HINT = new Color(128, 98, 62, 255);
const C_OUTLINE = new Color(38, 24, 10, 235);
/** 行底 tint：`cu_list_02_9gong` 本身是米色，乘色后得到稳定的蓝 / 金两态。 */
const ROW_TINT_BLUE = new Color(126, 196, 255, 255);
const ROW_TINT_GOLD = new Color(255, 228, 168, 255);
/** 选中行的描边环（`row_current_ring` 是金色环，乘深棕才在亮金底上看得见）。 */
const ROW_RING_INK = new Color(124, 76, 26, 255);

// ============================================================
// 数据
// ============================================================

/** 左栏一行 = 一个孔位（含该孔当前的旧宝石）。 */
export interface IGemReplaceOption {
    readonly socket: IRoleGemSocket;
    readonly gem: IRoleGemEntry | null;
    /** 1 起的孔位序号，直接画在行首。 */
    readonly slot: number;
}

export interface IGemReplaceData {
    readonly options: readonly IGemReplaceOption[];
    /** 即将镶上去的宝石（弹窗当前查看的那颗）。 */
    readonly incoming: IRoleGemEntry;
    readonly partName: string;
    readonly onConfirm: (socket: IRoleGemSocket) => void;
    readonly onClose: () => void;
}

interface IRowRefs {
    root: Node;
    bg: Sprite;
    edge: Sprite;
    frame: Sprite;
    icon: Sprite;
    slot: Label;
    keyword: Label;
    value: Label;
}

interface IStaticFrames {
    panelBg: SpriteFrame | null;
    title: SpriteFrame | null;
    closeIcon: SpriteFrame | null;
    goldBtn: SpriteFrame | null;
    card: SpriteFrame | null;
    /** 行底：`cu_list_02_9gong`（九宫，靠 tint 出蓝 / 金两态，避免 96×96 拉成 276×84 走形）。 */
    rowBg: SpriteFrame | null;
    /** 选中环：`chapter-select/row_current_ring`（原生 744×233，正好是宽扁行的整圈描边）。 */
    edge: SpriteFrame | null;
    tagEquipped: SpriteFrame | null;
    arrow: SpriteFrame | null;
    partIcon: SpriteFrame | null;
}

const artCache = createRoutedSpriteFrameCache('RoleGemReplacePanel');

/** 只保留主效果值：`+80% · +20%` → `+80%`（副效果在右栏/详情里看）。 */
function primaryValue(value: string): string {
    if (!value) return '—';
    return value.split(' · ')[0] || '—';
}

function loadResourceFrame(relPath: string): Promise<SpriteFrame | null> {
    return artCache.load(spriteFramePathOf(`image/${relPath}`));
}

// ============================================================
// 节点小工具
// ============================================================

function makeNode(parent: Node, name: string, w: number, h: number, x: number, y: number): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    const transform = node.addComponent(UITransform);
    transform.setContentSize(w, h);
    node.setPosition(x, y, 0);
    parent.addChild(node);
    return node;
}

function makeSprite(
    parent: Node,
    name: string,
    frame: SpriteFrame | null,
    w: number,
    h: number,
    x: number,
    y: number,
    sliced = false,
): Sprite {
    const node = makeNode(parent, name, w, h, x, y);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.type = sliced ? Sprite.Type.SLICED : Sprite.Type.SIMPLE;
    sprite.spriteFrame = frame;
    return sprite;
}

function makeLabel(
    parent: Node,
    name: string,
    text: string,
    fontSize: number,
    color: Color,
    w: number,
    h: number,
    x: number,
    y: number,
    align: HorizontalTextAlignment = HorizontalTextAlignment.CENTER,
    leftAnchor = false,
    outline: Color | null = null,
    bold = false,
    multiline = false,
): Label {
    const node = makeNode(parent, name, w, h, x, y);
    if (leftAnchor) node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
    else if (align === HorizontalTextAlignment.RIGHT) node.getComponent(UITransform)!.setAnchorPoint(1, 0.5);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.round(fontSize * 1.32);
    // 单行效果值用 SHRINK 保留完整数值，换行会裁掉超出固定行高的内容。
    label.enableWrapText = multiline;
    label.overflow = multiline ? Label.Overflow.CLAMP : Label.Overflow.SHRINK;
    label.horizontalAlign = align;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.color = color;
    label.isBold = bold;
    if (outline) {
        // 3.8.2 起 LabelOutline 组件已废弃，直接走 Label 内置描边（否则编辑器 Console 会刷 deprecated 警告）
        label.outlineColor = outline;
        label.outlineWidth = 2;
        label.enableOutline = true;
    }
    return label;
}

/**
 * 描边开关。金底行去掉描边后深色字才清晰；蓝底行必须保留白字的深描边。
 * 用 Label 自身的 `enableOutline`（`LabelOutline` 组件在 3.8.2 起已废弃）。
 */
function setStroke(label: Label, on: boolean): void {
    label.enableOutline = on;
}

function addClick(node: Node, handler: () => void, target: object): void {
    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.96;
    node.on(Button.EventType.CLICK, handler, target);
}

// ============================================================
// 组件
// ============================================================

@ccclass('RoleGemReplacePanel')
export class RoleGemReplacePanel extends Component {
    private static readonly VIEW_NAME = 'GemReplaceView';

    private data: IGemReplaceData | null = null;
    private built = false;
    private selected = 0;
    private rows: IRowRefs[] = [];
    private titleLabel: Label = null!;
    private curFrame: Sprite = null!;
    private curIcon: Sprite = null!;
    private curValue: Label = null!;
    private cardTitle: Label = null!;
    private cardFrame: Sprite = null!;
    private cardIcon: Sprite = null!;
    private cardKeyword: Label = null!;
    private cardValue: Label = null!;
    private cardDesc: Label = null!;
    private confirmButton: Button = null!;
    private renderSeq = 0;

    /**
     * 打开面板：第一次会在 `host` 下建一层 `GemReplaceView`，之后复用。
     * `host` 传 `ReplaceRoot`（整层显隐由弹窗控制）。
     */
    public static async open(host: Node, data: IGemReplaceData): Promise<void> {
        let viewNode = host.getChildByName(RoleGemReplacePanel.VIEW_NAME);
        if (!viewNode) {
            viewNode = new Node(RoleGemReplacePanel.VIEW_NAME);
            viewNode.layer = Layers.Enum.UI_2D;
            viewNode.addComponent(UITransform).setContentSize(720, 1280);
            viewNode.setPosition(0, 0, 0);
            host.addChild(viewNode);
        }
        viewNode.active = false;
        const view = viewNode.getComponent(RoleGemReplacePanel)
            ?? viewNode.addComponent(RoleGemReplacePanel);
        await view.setData(data);
        if (!view.isValid) return;
        viewNode.active = true;
    }

    public async setData(data: IGemReplaceData): Promise<void> {
        this.data = data;
        this.selected = this.pickDefaultIndex(data);
        await this.build();
        if (!this.isValid) return;
        this.render();
    }

    /** 默认选中：第一个有宝石的孔位（全空则第 1 个）。 */
    private pickDefaultIndex(data: IGemReplaceData): number {
        const index = data.options.findIndex(option => option.gem);
        return index >= 0 ? index : 0;
    }

    // ---------------- 建树 ----------------

    private async build(): Promise<void> {
        if (this.built) return;
        const frames = await this.loadStaticFrames();
        if (!this.isValid) return;
        this.buildPanel(frames);
        this.built = true;
    }

    private async loadStaticFrames(): Promise<IStaticFrames> {
        const [
            panelBg,
            title,
            closeIcon,
            goldBtn,
            card,
            rowBg,
            edge,
            tagEquipped,
            arrow,
            partIcon,
        ] = await Promise.all([
            loadResourceFrame('territory/panel/monsterbox/bg'),
            loadResourceFrame('main/popup/title'),
            loadResourceFrame('main/chest/detail/btn_close'),
            loadResourceFrame('main/chest/detail/btn_open'),
            loadResourceFrame('territory/panel/monsterbox/frame_guard'),
            loadRoleArt('listRow'),
            loadResourceFrame('chapter-select/row_current_ring'),
            loadRoleArt('tagEquipped'),
            loadRoleArt('arrowDown'),
            loadRoleBagIconSprite('equip', '图标_装备_武器1'),
        ]);
        return { panelBg, title, closeIcon, goldBtn, card, rowBg, edge, tagEquipped, arrow, partIcon };
    }

    private buildPanel(frames: IStaticFrames): void {
        this.node.removeAllChildren();
        this.rows = [];

        const panel = makeNode(this.node, 'Panel', PANEL_W, PANEL_H, 0, 0);
        // 吃掉点击，避免穿透到下层 ReplaceMask 把整层关掉
        panel.on(Node.EventType.TOUCH_START, () => { /* 仅拦截 */ }, this);

        makeSprite(panel, 'Bg', frames.panelBg, PANEL_W, PANEL_H, 0, 0, true);
        makeSprite(panel, 'Title', frames.title, 420, 122, 0, TITLE_Y, false);
        this.titleLabel = makeLabel(
            panel, 'TitleLabel', '', 28, C_TITLE, 380, 44, 0, TITLE_Y,
            HorizontalTextAlignment.CENTER, false, C_OUTLINE,
        );

        // 关闭钮与标题木牌同一条中线（差 12px 会明显「歪」）；x 收进面板右框内，避免压到外描边
        const close = makeSprite(panel, 'Close', frames.closeIcon, 64, 64, 282, TITLE_Y, false);
        addClick(close.node, () => this.data?.onClose(), this);

        // ---- 左栏：被替换的旧宝石 ----
        if (frames.partIcon) {
            makeSprite(panel, 'PartIcon', frames.partIcon, 24, 28, -278, 258, false);
        }
        makeLabel(
            panel, 'LeftHead', '被替换的旧宝石', 17, C_HEAD,
            190, 24, frames.partIcon ? -258 : -286, 258,
            HorizontalTextAlignment.LEFT, true, null, true,
        );

        for (let i = 0; i < MAX_ROWS; i++) {
            this.rows.push(this.buildRow(panel, i, frames));
        }

        // ---- 右栏：装备中 → 替换为 ----
        makeSprite(panel, 'CurBg', frames.card, COL_W, 66, RIGHT_X, CUR_Y, true);
        makeSprite(panel, 'CurTag', frames.tagEquipped, 78, 27, RIGHT_X - 84, CUR_Y, false);
        this.curFrame = makeSprite(panel, 'CurFrame', null, 40, 40, RIGHT_X - 12, CUR_Y, false);
        this.curIcon = makeSprite(panel, 'CurIcon', null, 30, 34, RIGHT_X - 12, CUR_Y, false);
        this.curValue = makeLabel(
            panel, 'CurValue', '', 20, C_WHITE, 104, 28, RIGHT_X + 124, CUR_Y,
            HorizontalTextAlignment.RIGHT, false, C_OUTLINE, true,
        );

        const arrow = makeSprite(panel, 'Arrow', frames.arrow, 40, 18, RIGHT_X, 186, false);
        arrow.node.angle = -90;

        const card = makeNode(panel, 'Card', COL_W, CARD_H, RIGHT_X, CARD_Y);
        makeSprite(card, 'CardBg', frames.card, COL_W, CARD_H, 0, 0, true);
        this.cardTitle = makeLabel(
            card, 'CardTitle', '', 20, C_HEAD, 240, 30, 0, 138,
            HorizontalTextAlignment.CENTER, false, null, true,
        );
        this.cardFrame = makeSprite(card, 'CardFrame', null, 126, 126, 0, 52, false);
        this.cardIcon = makeSprite(card, 'CardIcon', null, 96, 108, 0, 52, false);
        this.cardKeyword = makeLabel(
            card, 'CardKeyword', '', 22, C_DARK, 236, 32, 0, -30,
            HorizontalTextAlignment.CENTER, false, null, true,
        );
        this.cardValue = makeLabel(
            card, 'CardValue', '', 38, C_DARK_VALUE, 240, 56, 0, -74,
            HorizontalTextAlignment.CENTER, false, null, true,
        );
        this.cardDesc = makeLabel(
            card, 'CardDesc', '', 14, C_HINT, 232, 54, 0, -142,
            HorizontalTextAlignment.CENTER, false, null, false, true,
        );

        // ---- 底部 ----
        makeLabel(
            panel, 'Hint', '点左侧孔位即可切换替换目标', 15, C_HINT,
            420, 22, 0, -221, HorizontalTextAlignment.CENTER, false,
        );
        const confirm = makeSprite(panel, 'Confirm', frames.goldBtn, 400, 62, 0, -267, true);
        makeLabel(
            confirm.node, 'ConfirmLabel', '确认替换', 28, C_WHITE,
            360, 44, 0, 0, HorizontalTextAlignment.CENTER, false, C_OUTLINE, true,
        );
        this.confirmButton = confirm.node.addComponent(Button);
        this.confirmButton.transition = Button.Transition.SCALE;
        this.confirmButton.zoomScale = 0.96;
        confirm.node.on(Button.EventType.CLICK, this.onConfirmClick, this);
    }

    private buildRow(panel: Node, index: number, frames: IStaticFrames): IRowRefs {
        const root = makeNode(panel, `Row${index}`, ROW_W, ROW_H, LEFT_X, ROW_Y0 - index * ROW_STEP);
        root.active = false;

        // 九宫格行底保留边角比例，颜色由当前行状态控制。
        const bg = makeSprite(root, 'Bg', frames.rowBg, ROW_W, ROW_H, 0, 0, true);
        bg.color = ROW_TINT_BLUE;
        // 选中环用整圈描边贴图（原来拿 110×110 的图标选中框拉宽，会在行里再套一个小圆角框）
        const edge = makeSprite(root, 'Edge', frames.edge, ROW_W, ROW_H, 0, 0, false);
        edge.color = ROW_RING_INK;
        edge.node.active = false;

        const slot = makeLabel(
            root, 'Slot', `${index + 1}`, 14, C_VALUE,
            22, 22, -118, 0, HorizontalTextAlignment.CENTER, false, C_OUTLINE, true,
        );
        const frame = makeSprite(root, 'Frame', null, 36, 36, -88, 0, false);
        const icon = makeSprite(root, 'Icon', null, 28, 32, -88, 0, false);
        // 单行：图标 + 关键词（左） …… 数值（右对齐成一列）
        const keyword = makeLabel(
            root, 'Keyword', '', 15, C_WHITE,
            84, 26, -64, 0, HorizontalTextAlignment.LEFT, true, C_OUTLINE, true,
        );
        const value = makeLabel(
            root, 'Value', '', 21, C_VALUE,
            96, 30, 122, 0, HorizontalTextAlignment.RIGHT, false, C_OUTLINE, true,
        );

        addClick(root, () => this.select(index), this);

        return { root, bg, edge, frame, icon, slot, keyword, value };
    }

    // ---------------- 刷新 ----------------

    private select(index: number): void {
        if (!this.data || index < 0 || index >= this.data.options.length) return;
        if (index === this.selected) return;
        this.selected = index;
        this.render();
    }

    private render(): void {
        const data = this.data;
        if (!data) return;
        const seq = ++this.renderSeq;
        const option = data.options[this.selected] ?? data.options[0] ?? null;

        if (this.confirmButton) this.confirmButton.interactable = true;
        this.titleLabel.string = `更换${data.partName}宝石`;

        for (let i = 0; i < this.rows.length; i++) {
            const row = this.rows[i];
            const item = data.options[i];
            if (!item) {
                row.root.active = false;
                continue;
            }
            row.root.active = true;
            const isSelected = i === this.selected;
            const badge = gemEffectBadge(item.gem?.desc ?? '');
            row.slot.string = `${item.slot}`;
            row.keyword.string = item.gem ? badge.keyword : '空孔位';
            // 行里只放主效果值：一行塞「+80% · +20%」会挤成一坨，副效果留给右栏和详情弹窗
            row.value.string = item.gem ? primaryValue(badge.value) : '—';
            row.keyword.color = isSelected ? C_DARK : C_WHITE;
            row.value.color = isSelected ? C_DARK_VALUE : C_VALUE;
            row.slot.color = isSelected ? C_DARK : C_VALUE;
            // 选中时使用金底深字，关闭深色描边以保留小字号字形。
            setStroke(row.keyword, !isSelected);
            setStroke(row.value, !isSelected);
            setStroke(row.slot, !isSelected);
            row.bg.color = isSelected ? ROW_TINT_GOLD : ROW_TINT_BLUE;
            row.edge.node.active = isSelected;
            row.frame.node.active = !!item.gem;
            row.icon.node.active = !!item.gem;
            if (item.gem) {
                void this.paintIcon(seq, row.frame, row.icon, item.gem);
            }
        }

        if (option?.gem) {
            this.curValue.string = primaryValue(gemEffectBadge(option.gem.desc).value);
            void this.paintIcon(seq, this.curFrame, this.curIcon, option.gem);
        } else {
            this.curValue.string = '—';
            this.curFrame.spriteFrame = null;
            this.curIcon.spriteFrame = null;
        }

        const incoming = data.incoming;
        const incomingBadge = gemEffectBadge(incoming.desc);
        this.cardTitle.string = incoming.name;
        this.cardKeyword.string = incomingBadge.keyword;
        this.cardValue.string = incomingBadge.value;
        // 关键词和数值已展示，较长的效果描述额外显示原文。
        this.cardDesc.string = incoming.desc;
        this.cardDesc.node.active = (incoming.desc || '').length > 14;
        void this.paintIcon(seq, this.cardFrame, this.cardIcon, incoming);
    }

    private async paintIcon(
        seq: number,
        frameSprite: Sprite,
        iconSprite: Sprite,
        gem: IRoleGemEntry,
    ): Promise<void> {
        const [frame, icon] = await Promise.all([
            loadRoleQualityFrame(gem.quality || 1),
            gem.iconKey ? loadRoleBagIconSprite('gem', gem.iconKey) : Promise.resolve(null),
        ]);
        if (!this.isValid || seq !== this.renderSeq) return;
        if (frame) frameSprite.spriteFrame = frame;
        if (icon) iconSprite.spriteFrame = icon;
    }

    private onConfirmClick(): void {
        const data = this.data;
        const option = data?.options[this.selected];
        if (!data || !option) return;
        this.confirmButton.interactable = false;
        data.onConfirm(option.socket);
    }
}
