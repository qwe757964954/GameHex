import { _decorator, Button, Color, Component, EventMouse, EventTouch, Label, Layout, Node, ScrollView, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import { tween, type Tween } from 'cc';
import { Widget } from 'cc';
import { ZCGameHudScoreSlot } from './ZCGameHudScoreSlot';
import { ZCGameHudPlayerRow } from './ZCGameHudPlayerRow';
import { VirtualScrollView } from '../../../vscrollview/VScrollView';
import { HeadArt } from '../../HeadArt';
import type { IRankSeatProfile } from '../model/ZCRankBoard';
import type { ZCOwner } from '../model/ZCMapConfig';
// 倍率区间的**缺省口径**只有模型层一份（`ZCMapConfig`）：HUD 侧再抄一遍 0.6 / 1.2，
// 迟早有一天两边对不上，而"哪边是对的"从表现上看不出来。
import { ZC_MAP_ZOOM_MAX_DEFAULT, ZC_MAP_ZOOM_MIN_DEFAULT } from '../model/ZCMapConfig';
import { getPlayerDeck } from '../model/ZCCombatCatalog';
import { ZCGameModel, ZC_HEX_CONFIG } from '../model/ZCGameModel';
import { mapToViewX, mapToViewY, ZC_HEX_VIEW_WIDTH, ZC_HEX_VIEW_HEIGHT, ZC_MAP_PRESENTATION_SCALE } from './ZCGameViewUtil';
import { ZCGameUiEvent } from './ZCGameHudEvents';
import { EventMgr } from '../../../framework/event/EventMgr';

const { ccclass, property } = _decorator;
/**
 * HUD 神器按钮里那张图标的目标边长（`ArtifactIcon` 原尺寸 91×94）。
 *
 * 神器图是 230×230 的大画布，直接塞进 91×94 的按钮会被 TRIMMED 撑爆整个按钮。
 */
const ARTIFACT_ICON_TARGET_SIZE = 91;

/**
 * 「金币不足」反馈：金币图标跳动 + 数字闪红（`flashInsufficientGold`）。
 *
 * 需求口径：图标**放大缩小**并伴随**轻微 1~2 px 位移**，数字**红色闪烁**。
 * 导出这几个值给用例读，别把魔法数钉进断言（同 `HEX_ACT_LIFT_PIXELS` 的做法）。
 *  位移量按「轻微」定；调大到 6 px 以上就变成整条金币栏在抖，与需求不符。
 */
export const ZC_GOLD_DENY_LIFT_PIXELS = 2;
/** 弹跳峰值倍率；第二拍按 0.8 收，读起来才是「跳了两下」而不是一次长吸气。 */
export const ZC_GOLD_DENY_POP_SCALE = 1.35;
/** 图标两拍弹跳的总时长（秒）。 */
export const ZC_GOLD_DENY_BOUNCE_SECONDS = 0.36;
/** 数字闪红的翻转次数；**必须是偶数** —— 收尾那一下才能落回原色，不留一块红字在屏幕上。 */
export const ZC_GOLD_DENY_FLASH_STEPS = 6;
/** 每次翻转的间隔（秒）；`STEPS × STEP` 应与弹跳时长同量级，两段表现才是一条整体。 */
export const ZC_GOLD_DENY_FLASH_STEP_SECONDS = 0.06;

/**
 * 闪红用的红。与地块价格的 `ZCHexView.INSUFFICIENT_GOLD_COLOR` **同色**：
 * 同一件「钱不够」在棋盘和金币栏上的红必须是同一个，否则玩家会读成两种状况。
 */
const ZC_GOLD_DENY_LABEL_COLOR = new Color(255, 91, 91, 255);

/**
 * 「镜头一键复位」后，我方主城相对**视口中心**的下移量（px）。
 *
 * 需求原文（`v0.1战斗DEMO` 第 22 行「【战斗】相机」第 3 条）：
 * 「镜头一键复位，回到初始点位，主城位于中心点下方100px」。
 * 屏幕 y 轴**向上**为正 ⇒ 「下方 100px」= 主城落在 `(0, -100)`。
 * 单位是**屏幕像素**、不乘镜头倍率 —— 否则放大时主城会越推越往下，越放大越找不着家。
 */
export const ZC_MAP_HOME_CENTER_OFFSET_Y = 100;

/**
 * 滚轮缩放每格踩下去的倍率增量（新倍率 = 当前倍率 × (1 ± STEP)）。
 *
 * 触摸端走双指缩放；这一支专供**桌面预览 / PC 端** —— 没有它，
 * 编辑器里验证「每个地图自己的最大 / 最小倍率」只能靠改代码。
 */
export const ZC_MAP_ZOOM_WHEEL_STEP = 0.12;

/**
 * HUD 只**派发意图事件**（{@link ZCGameUiEvent}，在 {@link events} 上 `emit`）；
 * 页面打开、撤退确认与对局结算一律由控制器 `ZCGame` 订阅后处理。
 */

/** 对应 ZCGameHUD.prefab：地图 / 顶部四格与计时 / 左侧四行玩家 / 底部信息 / 右侧功能按钮。 */
@ccclass('ZCGameHUDView')
export class ZCGameHUDView extends Component {
    
    /** 拖动边界相对整盘包围盒的余量（四周留白）。 */
    private static readonly MAP_EDGE_MARGIN_X = 80;
    private static readonly MAP_EDGE_MARGIN_Y = 230;
    /** 全景缩放时视口四周留白。 */
    private static readonly MAP_OVERVIEW_PADDING = 36;
    /** 开局全景停留时长。 */
    private static readonly MAP_OVERVIEW_HOLD_SECONDS = 0.45;
    /** 开局镜头放大时长。 */
    private static readonly MAP_ZOOM_DURATION_SECONDS = 0.9;
    /** 结算镜头拉远时长。 */
    private static readonly MAP_SETTLEMENT_ZOOM_SECONDS = 0.55;

    // 必填引用由 `ZCGameHUD.prefab` 提供；缺绑定应在使用时尽早暴露。
    @property({ type: ScrollView, group: '地图', tooltip: 'MapScrollView；对局期间由 HUD 统一处理二维拖动' })
    mapScrollView: ScrollView = null!;
    @property({ type: Node, group: '地图', tooltip: 'MapScrollView/view：裁切和触摸区域' })
    mapViewport: Node = null!;
    @property({ type: Node, group: '地图', tooltip: 'MapScrollView/view/content：地块、单位和城墙挂载点' })
    mapLayer: Node = null!;
    /**
     * `MapScrollView/view/content/Background` 那张铺底图。
     *
     * 原来在 `fitMapBackground` 里按名字 `getChildByName('Background')` 取 —— 那是个**每帧**都要跑
     * 的路径（`applyMapOffset` 每次拖动都会调），字符串查表 + 找不到就抛；而且"按名找节点"
     * 这条本工程早就禁掉了（名字写错 / 改名 = 静默失效）。改成 prefab 绑定后
     * 取不到就是 prefab 错，在绑定层就炸。
     */
    @property({ type: Node, group: '地图', tooltip: 'MapScrollView/view/content/Background：铺底大图，按全景倍率 cover 铺满' })
    mapBackground: Node = null!;

    // 顶部四格（设计稿「多队伍」）：逐席位显示地块数；**地块数 = 0 视为该玩家已战斗结束** ⇒ 显示红 X。
    //  用四个独立 `@property` 而不是 `[ZCGameHudScoreSlot]` 数组 —— MCP 设不了数组属性
    //   （见 `cocos-mcp-build-prefab` 技能铁律 3：传单值会把数组写坏成 `{__id__:N}`）。
    @property({ type: Layout, group: '顶部信息', tooltip: 'TopInfoPanel/ScoreLayout：居中的分数格排列' })
    scoreLayout: Layout = null!;
    @property({ type: ZCGameHudScoreSlot, group: '顶部信息', tooltip: 'TopInfoPanel/ScoreLayout/Score1：第 1 席地块数' })
    scoreSlot1: ZCGameHudScoreSlot = null!;
    @property({ type: ZCGameHudScoreSlot, group: '顶部信息', tooltip: 'TopInfoPanel/ScoreLayout/Score2：第 2 席地块数' })
    scoreSlot2: ZCGameHudScoreSlot = null!;
    @property({ type: ZCGameHudScoreSlot, group: '顶部信息', tooltip: 'TopInfoPanel/ScoreLayout/Score3：第 3 席地块数' })
    scoreSlot3: ZCGameHudScoreSlot = null!;
    @property({ type: ZCGameHudScoreSlot, group: '顶部信息', tooltip: 'TopInfoPanel/ScoreLayout/Score4：第 4 席地块数' })
    scoreSlot4: ZCGameHudScoreSlot = null!;
    @property({ type: Label, group: '顶部信息', tooltip: 'TopInfoPanel/time/timeLab：剩余时间 mm:ss' })
    timeLabel: Label = null!;

    // 左侧玩家列表（设计稿「多队伍」）：逐席位显示圆盘 / 头像 / 名字 / 兵力 / buff×2。
    // 走**虚拟列表**：条目统一 308×88，圆盘与头像的尺寸、名字颜色都由条目脚本按 `owner` 现取
    // （设计稿我方那一行更大）。这样人数 2~4 变化时不用改 prefab 结构。
    @property({ type: VirtualScrollView, group: '玩家列表', tooltip: 'PlayerList：左侧玩家列表（纵向虚拟列表）' })
    playerList: VirtualScrollView = null!;

    @property({ type: Node, group: '底部信息', tooltip: 'BottomInfoPanel/CoinPanel/coin：金币图标，金币不足时跳动' })
    goldIcon: Node = null!;
    @property({ type: Label, group: '底部信息', tooltip: 'BottomInfoPanel/CoinPanel/GoldLabel：只显示金币数' })
    goldLabel: Label = null!;
    @property({ type: Button, group: '底部信息', tooltip: 'BottomInfoPanel/ArtifactButton' })
    artifactButton: Button = null!;
    @property({ type: Sprite, group: '底部信息', tooltip: 'ArtifactButton/ArtifactIcon：不可释放时置灰' })
    artifactIcon: Sprite = null!;
    @property({ type: Sprite, group: '底部信息', tooltip: 'ArtifactButton/ArtifactChargeFill：充能进度环' })
    artifactProgress: Sprite = null!;
    @property({ type: Label, group: '底部信息', tooltip: 'ArtifactButton/ArtifactCountLabel：已存次数 ×N' })
    artifactCountLabel: Label = null!;

    @property({ type: Button, group: '左侧功能', tooltip: 'leftPanel/RankBtn' })
    rankButton: Button = null!;
    @property({ type: Button, group: '左侧功能', tooltip: 'leftPanel/ZhiNanBtn' })
    guideButton: Button = null!;
    @property({ type: Button, group: '左侧功能', tooltip: 'leftPanel/HurtBtn' })
    damageButton: Button = null!;
    @property({ type: Button, group: '左侧功能', tooltip: 'leftPanel/RunAwayBtn：不等同于重开' })
    retreatButton: Button = null!;
    @property({ type: Button, group: '左侧功能', tooltip: 'leftPanel/ResetCameraBtn：镜头一键复位到初始点位' })
    resetCameraButton: Button = null!;

    // 选点阶段要整体收起的三个面板。原来按名字 `getChildByName` 找 —— 名字写错或节点改名
    // 会静默什么都不发生（面板照样盖在棋盘上），改成 prefab 绑定后缺一个就尽早炸。
    @property({ type: Node, group: '选点收起', tooltip: 'TopInfoPanel：选点阶段整体隐藏' })
    topInfoPanel: Node = null!;
    @property({ type: Node, group: '选点收起', tooltip: 'BottomInfoPanel：选点阶段整体隐藏' })
    bottomInfoPanel: Node = null!;
    @property({ type: Node, group: '选点收起', tooltip: 'leftPanel：选点阶段整体隐藏' })
    leftPanel: Node = null!;

    /** 本局席位档案（键 = 席位序，与 `ZC_OWNER_ORDER` 一致）；由 `setSeatProfiles` 注入。 */
    private seatProfiles: Map<ZCOwner, IRankSeatProfile> = new Map();
    /** 已加载好的头像帧（按席位）。异步填；没到位就是 null（保留空白框，不清空）。 */
    private readonly headFrames: Map<ZCOwner, SpriteFrame> = new Map();
    /** 本局席位序（左侧列表第 i 条 ↔ `rowOwners[i]`）；由 `paintPlayerRows` 维护。 */
    private rowOwners: readonly ZCOwner[] = [];
    /** 兵力文案取值函数；`null` = 这一局还没有兵力数据（选点阶段）。 */
    private rowUnitTextOf: ((owner: ZCOwner, index: number) => string | null) | null = null;
    /**
     * 是否处于选点阶段。
     *
     *  `render()` 现在也会开关 `topInfoPanel`（守城局整个收起），所以**必须**记住这个模式 ——
     * 否则选点期间任何一次整帧渲染都会把刚藏起来的顶栏又打开（`setSpawnSelectionMode` 白做）。
     */
    private spawnSelectionMode = false;
    private mapOffsetX = 0;
    private mapOffsetY = 0;
    /**
     * 开局镜头的落点（视图坐标，一般是我方主城那一格）；`null` = 整盘中心。
     *
     * 之前一律落整盘包围盒中心：2 人图上大致是双方正中，**3 / 4 人图上那块中心落在几块
     * 领地之间的中立空白处**，开局第一眼看到的是别人的地界而不是自己家。
     * 走 `ZCGameViewUtil.buildPlayerHomeFocus` 从本局地图配置取，人数多少都取 `homes[0]`。
     */
    private mapFocus: { x: number; y: number } | null = null;
    /**
     * 本局地图配置的镜头倍率区间（由 `ZCGame` 用 `setMapZoomRange` 注入）。
     *
     * 缺省口径取模型层的 `ZC_MAP_ZOOM_*_DEFAULT`（= 没有 `zoomMin / zoomMax` 的地图用什么倍率），
     * 所以这里**不写死 0.6 / 1.2**。
     */
    private mapZoomMin = ZC_MAP_ZOOM_MIN_DEFAULT;
    private mapZoomMax = ZC_MAP_ZOOM_MAX_DEFAULT;
    /** 双指缩放的参照指间距（px）；0 = 还没成对（单指 / 收指了）。 */
    private pinchStartDistance = 0;
    /** 双指刚成对那一刻的倍率（缩放基准）。用"落指时的倍率"而不是"上一帧倍率"：后者会累积漂移。 */
    private pinchStartScale = ZC_MAP_PRESENTATION_SCALE;
    /** 视口 `UITransform` 的缓存，见 `mapViewportTransform`。 */
    private viewportTransform: UITransform | null = null;
    private mapDragDistance = 0;
    private mapDragMoved = false;
    private mapIntroPlayed = false;
    private mapIntroPlaying = false;
    private mapIntroTween: Tween<Node> | null = null;
    private settlementOverviewTween: Tween<Node> | null = null;
    private settlementOverviewRequested = false;
    private settlementOverviewDone = false;
    private artifactReady = false;
    private playing = true;
    /** 金币栏「钱不够」反馈的句柄与静止态快照（首次触发时抓一次，见 `flashInsufficientGold`）。 */
    private goldDenyBounceTween: Tween<Node> | null = null;
    private goldDenyFlashStep = 0;
    private goldDenyIconRestPos: Vec3 | null = null;
    private goldDenyLabelRestColor: Color | null = null;

    get dragMoved(): boolean { return this.mapDragMoved; }

    /**
     * 结算镜头是否已经拉远到位。
     *
     * 结算扫场要等它 —— 玩家可能刚把视角拖到角落，直接在原视角上逐格变色的话，
     * 半张棋盘还在屏幕外，等于没看到"整盘归了胜利方"。
     */
    get settlementOverviewSettled(): boolean { return this.settlementOverviewDone; }

    /** 镜头正在动（开局入场或结算拉远）：期间要吞掉棋盘拖动，别让两段动画抢 mapLayer。 */
    private get mapCameraBusy(): boolean {
        return this.mapIntroPlaying || (this.settlementOverviewRequested && !this.settlementOverviewDone);
    }

    /**
     * 指定开局镜头的落点（视图坐标）。
     *
     * 由 `ZCGame` 用本局地图配置算出（`buildPlayerHomeFocus`）后注入；`null` = 整盘中心。
     * 必须在 `initialize` 之前给 —— `initialize` 里的入场镜头就是按这个落点收尾的。
     */
    setMapFocus(focus: { x: number; y: number } | null): void {
        this.mapFocus = focus;
    }

    /**
     * 注入本局地图配置的镜头倍率区间（需求：「每个地图配置对应的最大和最小倍率」）。
     *
     * 由 `ZCGame` 从 `ZCMapConfig.resolveZCMapZoom` 的结果取（真源是地图 JSON 的
     * `zoomMin / zoomMax`），HUD 侧只当**相机约束**用，不进模型。
     * 与 `setMapFocus` 一样要在 `initialize` 之前给 —— 入场镜头的收尾倍率 `mapSettleScale`
     * 就是拿这个区间夹出来的。
     *
     * 上下限颠倒时**当成"用户写反了"就地纠正**（不抛）：模型层的
     * `resolveZCMapZoom` 已经把这件事在配置期拦死了，走到这里的只可能是注入顺序问题，
     * 为了一个顺序问题让整局崩掉不划算。
     */
    setMapZoomRange(min: number, max: number): void {
        this.mapZoomMin = Math.min(min, max);
        this.mapZoomMax = Math.max(min, max);
        // 上一局的倍率（或默认机位 1）可能落在本图区间之外，注入时立刻夹回来。
        this.applyMapZoom(Math.abs(this.mapLayer.scale.x) || ZC_MAP_PRESENTATION_SCALE);
    }

    /**
     * 镜头一键复位（需求：「镜头一键复位，回到初始点位，主城位于中心点下方100px」）。
     *
     * **刻意不做补间**：「一键复位」要的是秒回；补间的话又得多一个忙标记去和入场 / 结算镜头
     * 抢 `mapLayer`，收益只是 0.2 秒的顺滑。所以直接停掉在跑的镜头 tween，一次性写到位。
     */
    resetCamera(): void {
        // 复位时手指可能还按着，把双指参照清掉，免得松手前的那点位移立刻又缩一次。
        this.pinchStartDistance = 0;
        this.resetMapPosition();
    }

    /**
     * 支持重复初始化（重复调用只重设渲染状态与镜头）。
     *
     * 事件监听**不**在这里绑：视图侧的按钮监听在 `onLoad` 一次性完成（规范 7.2）—— `cc.Node`
     * 监听挂在 EventTarget 上，节点失活 / 重激活都不掉，且引擎保证 `onLoad` 每实例只跑一次。
     * 控制器侧的订阅统一在 `ZCGame.bindUiEvents`：视图**不持有任何回调**，只 `EventMgr.instance.emit` 意图。
     */
    initialize(options?: { deferMapIntro?: boolean }): void {
        // 复用同一个 HUD 实例开下一局：先把金币栏反馈落回静止态，再丢掉静止态缓存 ——
        // 上一局抓到的坐标 / 颜色对本局不再可信（同一 prefab 重排过就该重抓）。
        this.stopGoldDenyFx();
        this.goldDenyIconRestPos = null;
        this.goldDenyLabelRestColor = null;
        // 同一个 HUD 实例复用开下一局：视口是同一套 prefab 节点，但缓存留到下局没有意义
        // （而且万一换了视口节点，缓存里的旧 `UITransform` 会让全景倍率算在旧尺寸上）。
        this.viewportTransform = null;
        // 条目数据回填只设一次（重复赋值同一函数幂等）；它不是事件监听，不参与 7.2 的绑定时机约束。
        //  必须 `.bind(this)`：`VScrollView` 侧是 `this.renderItemFn(node, i)` 的**方法调用**语法
        //    ⇒ 不绑的话函数内 `this` 会是 VScrollView，`this.rowOwners` 读到 undefined 直接崩。
        this.playerList.renderItemFn = this.fillPlayerRow.bind(this);
        this.resetMapPosition();
        if (options?.deferMapIntro) this.showSpawnSelectionMap();
        else if (!this.mapIntroPlayed) this.playMapIntro();
        this.updateButtons();
    }

    /** 选点时只保留棋盘，把正式对局 HUD 的顶部、底部和左侧按钮暂时藏起。 */
    setSpawnSelectionMode(active: boolean): void {
        this.spawnSelectionMode = active;
        const hide = !active;
        this.topInfoPanel.active = hide;
        this.bottomInfoPanel.active = hide;
        this.leftPanel.active = hide;
        if (active) this.showSpawnSelectionMap();
        else {
            this.mapIntroPlayed = false;
            this.playMapIntro();
        }
    }

    private showSpawnSelectionMap(): void {
        this.mapIntroTween?.stop();
        this.mapIntroTween = null;
        this.mapIntroPlaying = false;
        const scale = this.mapOverviewScale;
        const center = this.mapCenterAtScale(scale);
        this.mapLayer.setScale(scale, scale, 1);
        this.mapLayer.setPosition(center.x, center.y, 0);
        this.mapOffsetX = center.x;
        this.mapOffsetY = center.y;
        this.clearDrag();
    }

    /**
     * 结算镜头：把镜头从**当前位置**平滑拉远到「整盘可见并居中」，播完就停在那儿
     * （不像开局入场那样再 zoom 回游戏倍率 —— 结算要的就是一直在全局视角上看完整盘变色）。
     *
     * 幂等：`update` 的结算分支每帧都会调，已经起过一次就忽略。
     */
    startSettlementOverview(): void {
        if (this.settlementOverviewRequested) return;
        const mapLayer = this.mapLayer;
        if (!mapLayer) return;
        this.settlementOverviewRequested = true;
        this.settlementOverviewDone = false;
        // 开局入场可能还没播完（短局 + 手快）；停掉它，否则两个 tween 同时写 mapLayer。
        this.mapIntroTween?.stop();
        this.mapIntroTween = null;
        this.mapIntroPlaying = false;
        const scale = this.mapOverviewScale;
        const center = this.mapCenterAtScale(scale);
        this.clearDrag();
        this.settlementOverviewTween = tween(mapLayer)
            .to(ZCGameHUDView.MAP_SETTLEMENT_ZOOM_SECONDS, {
                scale: new Vec3(scale, scale, 1),
                position: new Vec3(center.x, center.y, 0),
            }, { easing: 'quadInOut' })
            .call(() => {
                this.settlementOverviewTween = null;
                this.settlementOverviewDone = true;
                this.mapOffsetX = center.x;
                this.mapOffsetY = center.y;
                this.clearDrag();
            })
            .start();
    }

    /**
     * 注入本局全部席位档案（2~4 席）。名字与头像都从这里取。
     *
     *  头像必须走 `HeadArt.loadHeadFrame`：`headKey` 存的是**角色 id**（如 `70001`），
     * 要先经 `head` 表翻成图标名 —— 直接拿去 `icons/head/<id>` 找会报
     * `Bundle resources doesn't contain ...`（排行榜那边踩过同样的坑）。
     *
     *  **这里必须自己把四行刷出来**（不能只存不画）：
     * 自选主城的图（`cityMode === 'select'`）在玩家选点阶段 `ZCGame.update` 会在
     * `if (this.spawnSelection)` 分支里**提前 return**，`render` 一次都不会跑
     * （那时连 `this.model` 都还没建）⇒ 只存不画的话左侧永远停在 prefab 默认态：
     * 四个圆盘 + 空名字、没有头像（真机实测就是这个症状）。
     *
     * 席位序 = `Map` 的**插入序** —— `buildSeatProfiles` 先把自己钉进 `player`、
     * 其余按 campId 顺序取空槽，因此与 `ownersForPlayerCount`（= `model.owners`）同序。
     */
    setSeatProfiles(profiles: Map<ZCOwner, IRankSeatProfile>): void {
        this.seatProfiles = profiles;
        const owners = Array.from(profiles.keys());
        this.paintPlayerRows(owners);
        for (const [owner, profile] of profiles) {
            if (!profile.headKey || this.headFrames.has(owner)) continue;
            void HeadArt.loadHeadFrame(profile.headKey).then((frame) => {
                if (frame) this.headFrames.set(owner, frame);
                // 头像异步到货：选点阶段没有"下一帧 render"，得在这里补刷一次；
                // 对局阶段多刷这一次无害（下一帧 `render` 会写成同样的值）。
                //  用 `repaintPlayerRows` 而不是 `paintPlayerRows` —— 后者会把兵力取值函数
                // 重置成 null，对局中会把兵力文字抹掉一小会儿。
                if (!this.isValid) return;
                this.repaintPlayerRows();
            });
        }
    }

    /**
     * 只刷左侧四行玩家 —— **不依赖 `model`**。
     *
     * 这样自选主城的选点阶段（`ZCGame.update` 提前 return、连 `this.model` 都还没建）
     * 也能把玩家显示出来；对局阶段由 `render` 每 0.15 秒调一次。
     *
     * @param owners     席位序（第 i 行 ↔ `owners[i]`）
     * @param unitTextOf 兵力文案；**缺省 = 这一局还没有兵力数据** ⇒ 四行的兵力整组收掉
     *                   （设计稿本来也只有第 1 行有这组元素）
     */
    private paintPlayerRows(
        owners: readonly ZCOwner[],
        unitTextOf?: (owner: ZCOwner, index: number) => string | null,
    ): void {
        this.rowOwners = owners;
        this.rowUnitTextOf = unitTextOf ?? null;
        this.repaintPlayerRows();
        //  规则 86：虚拟列表的槽位在它**自己的 `start()`** 里建，而 `createGame` 里的
        // `setSeatProfiles` 早于 `start()`；选点阶段之后又不会再有人调 `render`
        // ⇒ 这里补一次「下一帧」的重刷（先 `unschedule` 防重复排程）。
        this.unschedule(this.repaintPlayerRows);
        this.scheduleOnce(this.repaintPlayerRows, 0);
    }

/** 按当前缓存重设条数并逐条填充（槽位已建时立即生效）。 */
private repaintPlayerRows(): void {
        const list = this.playerList;
        if (!list || !list.isValid) return;
        if (list.totalCount !== this.rowOwners.length) list.setTotalCount(this.rowOwners.length);
        for (let i = 0; i < this.rowOwners.length; i++) {
            const node = list.getItemByIndex(i);
            if (node) this.fillPlayerRow(node, i);
        }
    }

/** 填一条。虚拟列表的 `renderItemFn` 参数序是 **`(node, index)`**（别写反）。 */
private fillPlayerRow(node: Node, index: number): void {
        const owner = this.rowOwners[index];
        if (!owner) return;
        const row = node.getComponent(ZCGameHudPlayerRow);
        if (!row) return;
        row.render({
            owner,
            name: this.seatProfiles.get(owner)?.name ?? '',
            head: this.headFrames.get(owner) ?? null,
            unitText: this.rowUnitTextOf?.(owner, index) ?? null,
            buffA: null,
            buffB: null,
        });
    }

    render(model: ZCGameModel): void {
        const state = model.snapshot;
        const defence = model.defenceWaveProgress;
        // 守城（塔防）局：顶部信息带（计时 + 四格）整体收起 —— 蓝湖「BOSS」稿那一帧只有左上角的首领条，
        // 而首领条（`ZCBossPanel`，由 `ZCGame` 实例化）高 173px、居中的四格会与它重叠。
        this.topInfoPanel.active = defence === null && !this.spawnSelectionMode;
        if (!defence) {
            const seconds = Math.max(0, Math.ceil(model.remainingSeconds));
            this.timeLabel.fontSize = 28;
            this.timeLabel.lineHeight = 40;
            this.timeLabel.string = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        }
        this.goldLabel.string = String(Math.max(0, Math.floor(state.playerGold)));
        // 顶部四格：逐席位显示地块数。**地块数 = 0 ⇒ 该玩家已战斗结束**（数字收掉、红 X 亮起）。
        // 席位不足 4 个（2~3 人局）时把多余的格整体关掉。
        const slots: (ZCGameHudScoreSlot | null)[] = [
            this.scoreSlot1, this.scoreSlot2, this.scoreSlot3, this.scoreSlot4,
        ];
        // 先数一遍各席地块数，才能判「谁领先」——领先格由 Layout 按 110×77 排列。
        const counts: number[] = [];
        let layoutDirty = false;
        for (let i = 0; i < slots.length; i++) {
            const owner = model.owners[i];
            counts.push(owner ? model.territoryCountOf(owner) : 0);
        }
        // **唯一**领先才放大：并列第一（开局常见 1:1:1）时全都不放大，
        // 否则四格齐刷刷变大会失去「领先」的表达力。
        const top = counts.length ? Math.max(...counts) : 0;
        const topCount = counts.filter((count) => count === top).length;
        const leadIndex = top > 0 && topCount === 1 ? counts.indexOf(top) : -1;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot) continue;
            const owner = model.owners[i];
            if (!owner) {
                if (slot.node.active) {
                    slot.node.active = false;
                    layoutDirty = true;
                }
                continue;
            }
            if (!slot.node.active) {
                slot.node.active = true;
                layoutDirty = true;
            }
            const count = counts[i];
            //  尺寸会随 `leading` 在 94×66 / 110×77 之间变，Layout 必须跟着重排 ⇒ 每次渲染都标脏。
            slot.render({ value: count, finished: count <= 0, leading: i === leadIndex });
            layoutDirty = true;
        }
        if (layoutDirty) this.scoreLayout.updateLayout();

        // 左侧四行玩家：逐席位渲染头像框 / 头像 / 名字 / 兵力 / buff。
        // 兵力按 `unit.owner === owner` 现数活口（`battleState === 'dead'` 不算）。
        // **四行都显示**（2026-10-09 用户要求「所有玩家兵力数量都要显示」；设计稿只画了第 1 行的 `14/100`）。
        this.paintPlayerRows(model.owners, (owner) => {
            let alive = 0;
            for (const unit of state.units) {
                if (unit.owner === owner && unit.battleState !== 'dead') alive += 1;
            }
            return `${alive}/${model.unitCap}`;
        });
        this.playing = state.status === 'playing';
        const readyUses = Math.max(0, state.artifactReadyUses ?? 0);
        const cooling = state.artifactCooldown > 0;
        this.artifactReady = this.playing && readyUses > 0 && !cooling;
        this.updateButtons();
        this.artifactIcon.grayscale = !this.artifactReady;
        const chargeFull = Math.max(1, model.artifactChargeFull);
        const cooldownDuration = Math.max(0.001, model.artifactCooldownDuration);
        this.artifactProgress.fillRange = cooling
            ? Math.min(1, state.artifactCooldown / cooldownDuration)
            : readyUses >= model.artifactMaxStored
                ? 1
                : Math.min(1, Math.max(0, state.artifactCharge / chargeFull));
        this.artifactProgress.grayscale = !this.playing || cooling;
        this.artifactCountLabel.string = `×${readyUses}`;
    }

    /**
     * 金币栏「钱不够」反馈：金币图标跳动 + 数字闪红。
     *
     * 由 `ZCGame.onHexClick` 在 `developHex` 因金币不足失败时调（判据是结构化的
     * `ZCActionFailureReason`，不是中文文案）。棋盘上给不出这段反馈 —— 那一格的图标与价格照旧，
     * 而「我钱不够」正是这一下点击的全部意义 ⇒ 让底部的金币栏自己说。
     *
     *  `render()` 每 0.15s 只写 `goldLabel.string`、从不写 color / scale，所以这段表现不会被整帧
     * 渲染打断。但**连点必须能重来**：两个入口都先停上一次的动画再起新的，收尾一律落回静止态。
     */
    flashInsufficientGold(): void {
        if (!this.playing) return;
        // 静止态只在首次触发时抓一次：`render` 从不写这两个值 ⇒ 抓到的就是 prefab 上的原值。
        // 位置用分量新建 `Vec3`（不依赖 `position.clone()`），颜色同理 —— 桩/引擎两边都稳。
        if (!this.goldDenyIconRestPos) {
            const rest = this.goldIcon.position;
            this.goldDenyIconRestPos = new Vec3(rest.x, rest.y, rest.z);
        }
        if (!this.goldDenyLabelRestColor) {
            const rest = this.goldLabel.color;
            this.goldDenyLabelRestColor = rest
                ? new Color(rest.r, rest.g, rest.b, rest.a)
                : new Color(255, 255, 255, 255);
        }
        this.playGoldIconDenyBounce();
        this.playGoldLabelDenyFlash();
    }

    /**
     * 图标跳动：两拍「放大 + 轻微上抛 → 落回」。
     *
     * 走 `tween` 与本文件的开局 / 结算镜头同一套生命周期（`stop()` 后置空，别留悬空引用）。
     * 四段关键帧按 `ZC_GOLD_DENY_BOUNCE_SECONDS / 4` 平分；最后一帧就落在静止态，中断也不会歪。
     */
    private playGoldIconDenyBounce(): void {
        const node = this.goldIcon;
        const rest = this.goldDenyIconRestPos!;
        const pop = ZC_GOLD_DENY_POP_SCALE;
        const lift = ZC_GOLD_DENY_LIFT_PIXELS;
        const beat = ZC_GOLD_DENY_BOUNCE_SECONDS / 4;
        this.goldDenyBounceTween?.stop();
        // 先进静止态：上一次可能停在半空（被这一下点击打断）。
        node.setScale(1, 1, 1);
        node.setPosition(rest.x, rest.y, rest.z);
        this.goldDenyBounceTween = tween(node)
            .to(beat, {
                scale: new Vec3(pop, pop, 1),
                position: new Vec3(rest.x, rest.y + lift, rest.z),
            }, { easing: 'quadOut' })
            .to(beat, {
                scale: new Vec3(1, 1, 1),
                position: new Vec3(rest.x, rest.y, rest.z),
            }, { easing: 'quadIn' })
            .to(beat, {
                scale: new Vec3(pop * 0.8, pop * 0.8, 1),
                position: new Vec3(rest.x, rest.y + lift * 0.5, rest.z),
            }, { easing: 'quadOut' })
            .to(beat, {
                scale: new Vec3(1, 1, 1),
                position: new Vec3(rest.x, rest.y, rest.z),
            }, { easing: 'quadIn' })
            .call(() => { this.goldDenyBounceTween = null; })
            .start();
    }

    /**
     * 数字闪红：红 / 原色交替 `ZC_GOLD_DENY_FLASH_STEPS` 次（偶数 ⇒ 收尾落回原色）。
     *
     * 用「定时翻转」而不是 tween 补间颜色：这里要的就是**跳变**（闪烁），不是渐变 ——
     * 与 `ZCSpawnSelectionView.flash` 同款定时器写法。
     */
    private playGoldLabelDenyFlash(): void {
        this.unschedule(this.stepGoldLabelDenyFlash);
        this.goldDenyFlashStep = 0;
        this.stepGoldLabelDenyFlash();
    }

    private stepGoldLabelDenyFlash(): void {
        const rest = this.goldDenyLabelRestColor!;
        if (this.goldDenyFlashStep >= ZC_GOLD_DENY_FLASH_STEPS) {
            // 收尾那一拍显式复位：中途被打断也不会留一块红字。
            this.goldLabel.color = rest;
            return;
        }
        this.goldLabel.color = this.goldDenyFlashStep % 2 === 0 ? ZC_GOLD_DENY_LABEL_COLOR : rest;
        this.goldDenyFlashStep += 1;
        this.scheduleOnce(this.stepGoldLabelDenyFlash, ZC_GOLD_DENY_FLASH_STEP_SECONDS);
    }

    /** 停掉金币栏反馈并落回静止态（**重复初始化 / 重置**时调 ——  不能在 `onDestroy` 里调，见 `cancelGoldDenyFx`）。 */
    private stopGoldDenyFx(): void {
        this.cancelGoldDenyFx();
        const iconRest = this.goldDenyIconRestPos;
        if (iconRest) {
            this.goldIcon.setScale(1, 1, 1);
            this.goldIcon.setPosition(iconRest.x, iconRest.y, iconRest.z);
        }
        const labelRest = this.goldDenyLabelRestColor;
        if (labelRest) this.goldLabel.color = labelRest;
    }

    /**
     * 只取消金币栏反馈的**驱动**（tween / 定时器），**一个子节点都不碰**。
     *
     *  `onDestroy` 必须走这一支 —— Cocos 销毁节点时**先销毁子节点、再销毁组件**
     * （`Node._onPreDestroyBase` → 子节点 `_destroyImmediate` → `Component._onPreDestroy`），
     * 所以组件 `onDestroy` 里 `this.goldIcon` / `this.goldLabel` 的 `_lpos`/`_lscale`
     * **已经是 null**，再 `setScale` / `setPosition` 就抛
     * `Cannot set properties of null (setting 'x')`。
     * 真机栈（2026-10-14 结算点确定退出对局）：
     * `ZCGameHUDView.onDestroy:603 → stopGoldDenyFx:542 → Node.setScale → Vec3.set`。
     *
     *  而且这个异常会**打断组件销毁循环** ⇒ 引擎随后再销毁一遍 ⇒ 成片
     * `You are trying to destroy a object twice or more` —— 两条日志是**同一个根因**。
     * （节点都要销毁了，把图标"恢复静止态"本来也没有意义。）
     */
    private cancelGoldDenyFx(): void {
        this.goldDenyBounceTween?.stop();
        this.goldDenyBounceTween = null;
        this.unschedule(this.stepGoldLabelDenyFlash);
        this.goldDenyFlashStep = 0;
    }

    /**
     * 把所有镜头状态复位到「刚开局、还没播入场动画」的样子。
     *
     * 停 tween、清入场 / 结算旗标、清拖动累积，再把 `mapLayer` 与 `mapOffset*` 一次性写到位。
     * `initialize`（开下一局）与 {@link resetCamera}（一键复位按钮）共用这一支
     * —— 两条路径要的"初始点位"必须是同一个，否则玩家一键复位后的构图会和开局第一帧对不上。
     */
    resetMapPosition(): void {
        this.mapIntroTween?.stop();
        this.mapIntroTween = null;
        this.mapIntroPlaying = false;
        this.settlementOverviewTween?.stop();
        this.settlementOverviewTween = null;
        this.settlementOverviewRequested = false;
        this.settlementOverviewDone = false;
        // 重置回对局视角的停靠点 = 我方主城（没给落点时是整盘中心），再往下让 100px。
        const settleScale = this.mapSettleScale;
        const rest = this.mapRestCenterAtScale(settleScale);
        this.mapLayer.setScale(settleScale, settleScale, 1);
        this.mapOffsetX = rest.x;
        this.mapOffsetY = rest.y;
        this.clearDrag();
        this.applyMapOffset();
    }

    /**
     * 显示本局携带的那件神器的图标。
     *
     *  prefab 上`ArtifactIcon` 原先硬绑的是 `image/gameui/zd_faqi.png`（91×94 的**通用「神器」按钮图**），
     * 与玩家实际带的神器毫无关系 —— 表现为棋盘上的资源格显示「霜封冰刃」、HUD 却显示一把石锤。
     * 帧来源与资源格**同一份**（`ZCGameLoader` 预加载的 `image/artifact/<pvpArtifact[].icon>`），
     * 不额外加载、不硬绑：神器随配置变，硬绑必然过期。
     *
     * `null` = 没加载到 ⇒ 保留 prefab 原帧（通用图），别留空白。
     */
    setArtifactFrame(frame: SpriteFrame | null): void {
        if (!frame) return;
        if (this.artifactIcon.spriteFrame === frame) return;
        this.artifactIcon.spriteFrame = frame;
        // `ArtifactIcon` 是 `sizeMode = TRIMMED(1)`：换帧会把节点尺寸覆写成新帧的 rect
        // （230×230 的神器图会把 91×94 的按钮撑大）。按 HUD 目标尺寸等比缩回来。
        const size = frame.originalSize;
        const longest = Math.max(size.width, size.height);
        if (!(longest > 0)) return;
        const scale = Math.min(1, ARTIFACT_ICON_TARGET_SIZE / longest);
        this.artifactIcon.node.setScale(scale, scale, 1);
    }

    /**
     * 一次性静态绑定（规范 7.2：绑在引擎保证只跑一次的 `onLoad`，禁「绑 onEnable + `bound` 守卫」）。
     *
     * `ZCGame.createGame` 先 `instantiate + setParent`（激活 ⇒ 触发 `onLoad`）再 `initialize(...)` 设镜头：
     * 点击回调只 `emit` 意图事件，控制器订阅与否都不影响本绑定本身。
     */
    protected onLoad(): void {
        this.bindEvents();
    }
    protected onDestroy(): void {
        this.mapIntroTween?.stop();
        this.mapIntroTween = null;
        this.settlementOverviewTween?.stop();
        this.settlementOverviewTween = null;
        //  这里**只能**用 cancelGoldDenyFx（不碰子节点）：此刻 goldIcon / goldLabel
        // 已经被引擎先销毁了，走 stopGoldDenyFx 会 setScale(null) 抛异常，
        // 进而打断销毁循环 ⇒ 连带刷出 `destroy twice`。详见 cancelGoldDenyFx 的注释。
        this.cancelGoldDenyFx();
    }

    private updateButtons(): void {
        // 神器按钮只在对局结束后禁用。 曾经写成 `this.artifactReady` —— 不可充能时按钮
        // interactable=false，Cocos 的 Button 便**不再派发 CLICK**，点击被整段吞掉，
        // 连「神器尚未充满」这句文案都生成不出来，表现为「点了没反应」。
        // 置灰交给 artifactIcon / artifactProgress 的 grayscale 表达，不靠 interactable。
        // 神器与撤退只在对局进行中可点（结束后没有意义）；排行榜 / 指南 / 统计 / 复位视角整局都能点，
        // 保持 prefab 默认的 `interactable = true`（事件化之后视图不再知道"上层有没有接"）。
        this.artifactButton.interactable = this.playing;
        this.retreatButton.interactable = this.playing;
    }

    private onArtifactClick(): void {
        if (!this.playing) return;
        // 不判 artifactReady：充能不足 / 冷却中也照常派发，由模型决定成败与原因文案。
        EventMgr.instance.emit(ZCGameUiEvent.UseArtifact);
    }

    private onRankClick(): void {
        EventMgr.instance.emit(ZCGameUiEvent.OpenRank);
    }

    private onGuideClick(): void {
        EventMgr.instance.emit(ZCGameUiEvent.OpenGuide);
    }

    private onDamageClick(): void {
        EventMgr.instance.emit(ZCGameUiEvent.OpenDamageStats);
    }

    private onRetreatClick(): void {
        if (!this.playing) return;
        EventMgr.instance.emit(ZCGameUiEvent.Retreat);
    }

    /**
     * 镜头一键复位。
     *
     *  和排行榜 / 指南一样**不判 `playing`**：结算期间"看不见自己家"同样是玩家会遇到的状况
     * （结算镜头自己会拉远，但玩家中途拖走过），复位永远有意义。
     */
    private onResetCameraClick(): void {
        EventMgr.instance.emit(ZCGameUiEvent.ResetCamera);
    }

    private bindEvents(): void {
        // 保留既有二维棋盘拖动逻辑，避免 ScrollView 同时修改 content 位置。
        this.mapScrollView.stopAutoScroll();
        this.mapScrollView.enabled = false;
        this.artifactButton.node.on(Button.EventType.CLICK, this.onArtifactClick, this);
        this.rankButton.node.on(Button.EventType.CLICK, this.onRankClick, this);
        this.guideButton.node.on(Button.EventType.CLICK, this.onGuideClick, this);
        this.damageButton.node.on(Button.EventType.CLICK, this.onDamageClick, this);
        this.retreatButton.node.on(Button.EventType.CLICK, this.onRetreatClick, this);
        this.resetCameraButton.node.on(Button.EventType.CLICK, this.onResetCameraClick, this);
        // 事件监听随节点销毁自动清理，无需手动解绑；`onLoad` 每实例只跑一次 ⇒ 不会重复注册。
        this.mapViewport.on(Node.EventType.TOUCH_START, this.onMapTouchStart, this, true);
        this.mapViewport.on(Node.EventType.TOUCH_MOVE, this.onMapTouchMove, this, true);
        this.mapViewport.on(Node.EventType.TOUCH_END, this.onMapTouchEnd, this, true);
        this.mapViewport.on(Node.EventType.TOUCH_CANCEL, this.onMapTouchEnd, this, true);
        // 滚轮缩放：触摸端走双指（上面那三条），桌面端只有滚轮 —— 缺了它，
        // 编辑器预览里就验证不了「每个地图自己的最小 / 最大倍率」。
        this.mapViewport.on(Node.EventType.MOUSE_WHEEL, this.onMapMouseWheel, this, true);
        this.mapViewport.on(Node.EventType.SIZE_CHANGED, this.applyMapOffset, this);
    }

    private clearDrag(): void {
        this.mapDragDistance = 0;
        this.mapDragMoved = false;
    }

    /**
     * 落指。
     *
     * `event` 是**可选**的：`TOUCH_*` 的派发方一定是引擎（必带 event），但这一支也允许被
     * 单测直接调（夹具只 `emit('start')` 不带参数）—— 拿不到 event 就按"单指拖动"走，
     * 不做双指判断，比抛异常或一律当成缩放都更接近真实行为。
     */
    private onMapTouchStart(event?: EventTouch): void {
        this.unschedule(this.clearDrag);
        if (this.mapCameraBusy) {
            // 镜头动画期间吞掉棋盘操作，避免缩放尚未结束时就误点地块或拖偏中心。
            this.mapDragDistance = 0;
            this.mapDragMoved = true;
            return;
        }
        if (event && this.beginPinch(event)) {
            // 双指：这一下不算拖动，标记成"已移动"免得松手时被当成点选地块。
            this.mapDragMoved = true;
            return;
        }
        this.clearDrag();
    }

    private onMapTouchMove(event?: EventTouch): void {
        if (this.mapCameraBusy) return;
        if (event && this.stepPinch(event)) return;
        if (!event) return;
        const delta = event.getUIDelta();
        this.mapDragDistance += Math.abs(delta.x) + Math.abs(delta.y);
        if (this.mapDragDistance > 10) this.mapDragMoved = true;
        this.mapOffsetX += delta.x;
        this.mapOffsetY += delta.y;
        this.applyMapOffset();
    }

    private onMapTouchEnd(event?: EventTouch): void {
        if (event) this.endPinch(event);
        // 等地块 TOUCH_END 处理结束后再清标记，防止拖动被当成点选。
        this.scheduleOnce(this.clearDrag, 0);
    }

    /**
     * 开局先完整展示棋盘，短暂停留后放大到游戏机位（`mapSettleScale`，正常即原始倍率）。
     *
     * 全景环节仍以**整盘包围盒中心**为基准（那样才看得见完整棋盘），收尾落点改成
     * `mapRestCenterAtScale` —— 我方主城那一格再往下让 100px，3 / 4 人图上不再停在
     * 几块领地之间的中立空白处，2 人图上也不再让主城压在正中。
     */
    private playMapIntro(): void {
        this.mapIntroPlayed = true;
        const settleScale = this.mapSettleScale;
        const overviewScale = this.mapOverviewScale;
        const overviewCenter = this.mapCenterAtScale(overviewScale);
        const restPoint = this.mapRestCenterAtScale(settleScale);
        const rest = this.clampMapOffset(restPoint.x, restPoint.y, settleScale);

        this.mapLayer.setScale(overviewScale, overviewScale, 1);
        this.mapLayer.setPosition(overviewCenter.x, overviewCenter.y, 0);
        this.mapOffsetX = overviewCenter.x;
        this.mapOffsetY = overviewCenter.y;
        this.mapIntroPlaying = true;
        this.mapIntroTween = tween(this.mapLayer)
            .delay(ZCGameHUDView.MAP_OVERVIEW_HOLD_SECONDS)
            .to(ZCGameHUDView.MAP_ZOOM_DURATION_SECONDS, {
                scale: new Vec3(settleScale, settleScale, 1),
                position: new Vec3(rest.x, rest.y, 0),
            }, { easing: 'quadInOut' })
            .call(() => {
                this.mapIntroTween = null;
                this.mapIntroPlaying = false;
                this.mapOffsetX = rest.x;
                this.mapOffsetY = rest.y;
                this.clearDrag();
            })
            .start();
    }

    /**
     * 视口（`MapScrollView/view`）的 `UITransform`。
     *
     *  prefab 上静态挂着它，且全工程无人给 `mapViewport` 赋值 ⇒ 取不到就是 prefab 错，
     * 直接 `!` 爆掉，不留「取不到就退回」的降级分支（降级会把 prefab 错误伪装成"镜头有点怪"）。
     *
     *  缓存：视口节点的尺寸由 Widget 四边拉伸 + `ON_WINDOW_RESIZE` 决定，`UITransform` 实例本身
     * 不换，所以**全类只查一次**。这不是过早优化 —— 全景倍率、背景铺满、拖动约束、双指缩放的
     * 锚点换算四处都要它，每多一个调用点就多一次"顺手写个判空"的机会；收敛成一处之后，
     * 用例可以按「源码里只出现一次 `mapViewport.getComponent`」把这条钉死。
     */
    private get mapViewportTransform(): UITransform {
        if (!this.viewportTransform) this.viewportTransform = this.mapViewport.getComponent(UITransform)!;
        return this.viewportTransform;
    }

    /**
     * 整盘刚好装进视口、四周留出 `MAP_OVERVIEW_PADDING` 的缩放。开局入场与结算镜头共用。
     *
     * 视口尺寸由 `MapScrollView/view` 的 `cc.Widget`（四边拉伸 + `ON_WINDOW_RESIZE`）决定，
     * 恒等于窗口宽高，不会是 0。
     *
     * ⚠️ 全景 / 结算镜头是**脚本演出**，不受玩家缩放区间（`mapZoomMin/Max`）约束：
     * 地图可能把 `zoomMin` 配到 0.6，而"看清整盘"需要 0.35 —— 夹进去就看不到全图了。
     */
    private get mapOverviewScale(): number {
        const viewport = this.mapViewportTransform;
        const bounds = this.mapBounds;
        return Math.min(
            ZC_MAP_PRESENTATION_SCALE,
            Math.max(1, viewport.width - ZCGameHUDView.MAP_OVERVIEW_PADDING * 2) / Math.max(1, bounds.maxX - bounds.minX),
            Math.max(1, viewport.height - ZCGameHUDView.MAP_OVERVIEW_PADDING * 2) / Math.max(1, bounds.maxY - bounds.minY),
        );
    }

    /**
     * 对局停靠倍率：默认机位（`ZC_MAP_PRESENTATION_SCALE`）夹进本图倍率区间。
     *
     * 正常情况下就是 1；只有当某张图把区间配到不包含 1（例如 `zoomMax = 0.8`）时，
     * 入场收尾 / 一键复位 / 重开一局才该落到区间边缘而不是硬停在 1
     * —— 否则开局第一帧就处在"玩家自己捏不到"的倍率上，接着一捏就跳一下。
     */
    private get mapSettleScale(): number {
        return this.clampMapZoom(ZC_MAP_PRESENTATION_SCALE);
    }

    /**
     * 背景和棋盘继续共用 `content` 的平移与缩放，但背景尺寸要覆盖全面屏视口。
     *
     * prefab 的 Background 原本靠 Widget 固定在 720×1280 内容区的中心（局部 y=-640），
     * 对局镜头却把整个 content 当地图坐标系缩放、平移。窄长屏的全景缩放受地图宽度限制，
     * 1660×2916 的背景再被缩小后，上下就会露出视口。这里关掉 Widget 的重定位，令背景中心
     * 对齐地图包围盒，并按全景缩放下的视口尺寸 + 最大地图拖动范围等比 cover。
     */
    private fitMapBackground(): void {
        // 由 prefab 绑定（曾按名 `getChildByName('Background')` 取 —— 每帧字符串查表，
        // 而且名字一改就静默失效）。缺绑定应在绑定层就暴露，这里不再兜底。
        const background = this.mapBackground;
        const transform = background.getComponent(UITransform)!;
        const sprite = background.getComponent(Sprite)!;
        const widget = background.getComponent(Widget);
        if (widget) widget.enabled = false;

        const viewport = this.mapViewportTransform;
        const bounds = this.mapBounds;
        const mapWidth = Math.max(1, bounds.maxX - bounds.minX);
        const mapHeight = Math.max(1, bounds.maxY - bounds.minY);
        const coverScale = Math.max(0.001, this.mapOverviewScale);
        const requiredWidth = Math.max(
            viewport.width / coverScale,
            mapWidth + 2 * ZCGameHUDView.MAP_EDGE_MARGIN_X / coverScale,
        );
        const requiredHeight = Math.max(
            viewport.height / coverScale,
            mapHeight + 2 * ZCGameHUDView.MAP_EDGE_MARGIN_Y / coverScale,
        );
        const frameSize = sprite.spriteFrame?.originalSize;
        const sourceWidth = frameSize?.width || transform.width;
        const sourceHeight = frameSize?.height || transform.height;
        const imageScale = Math.max(requiredWidth / sourceWidth, requiredHeight / sourceHeight);
        transform.setContentSize(sourceWidth * imageScale, sourceHeight * imageScale);
        background.setPosition((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0);
    }

    private get mapBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
        const xs = ZC_HEX_CONFIG.map((hex) => mapToViewX(hex.x));
        const ys = ZC_HEX_CONFIG.map((hex) => mapToViewY(hex.y));
        return {
            minX: Math.min(...xs) - ZC_HEX_VIEW_WIDTH / 2,
            maxX: Math.max(...xs) + ZC_HEX_VIEW_WIDTH / 2,
            minY: Math.min(...ys) - ZC_HEX_VIEW_HEIGHT / 2,
            maxY: Math.max(...ys) + ZC_HEX_VIEW_HEIGHT / 2,
        };
    }

    private mapCenterAtScale(scale: number): { x: number; y: number } {
        const bounds = this.mapBounds;
        return {
            x: -(bounds.minX + bounds.maxX) * scale / 2 || 0,
            y: -(bounds.minY + bounds.maxY) * scale / 2 || 0,
        };
    }

    /**
     * 对局期间的停靠点：`-focus * scale` 正好让落点落在视口正中。
     *
     * 没给落点时退回整盘中心（2 人图上两者差别不大，3 / 4 人图上差别是"自己家"与"中立空白"）。
     * 拖动边界仍按整盘算（`applyMapOffset`），所以停在自家主城也不会把棋盘拖出可视区。
     *
     * 给了落点时再按需求把主城**从正中往下让 100px**（`ZC_MAP_HOME_CENTER_OFFSET_Y`）：
     * 镜头中心比主城高 100px ⇒ 主城上方多露出 100px，出征方向看得见。
     * 屏幕 y 向上为正 ⇒ 让主城落在 `(0, -100)` 等价于让镜头中心落在 `focus + 100`，
     * 即 `mapOffsetY = -(focus.y * scale) - 100`。
     */
    private mapRestCenterAtScale(scale: number): { x: number; y: number } {
        const focus = this.mapFocus;
        if (!focus) return this.mapCenterAtScale(scale);
        // `|| 0` 只为了把 `-0` 归成 `0`（`-0 === 0` 为真但序列化 / 断言里是两种东西）。
        const x = -focus.x * scale;
        const y = -focus.y * scale - ZC_MAP_HOME_CENTER_OFFSET_Y;
        return { x: x || 0, y: y || 0 };
    }

    /**
     * 把倍率夹进本局区间。
     *
     * 非有限数（NaN / Infinity，只可能来自外部注入）一律退回默认机位：镜头倍率是乘法链，
     * 一个 NaN 会把 `mapLayer` 的 scale 与 position 一起污染成 NaN，地图整块消失且零报错。
     */
    private clampMapZoom(scale: number): number {
        const value = Number.isFinite(scale) ? scale : ZC_MAP_PRESENTATION_SCALE;
        return Math.min(this.mapZoomMax, Math.max(this.mapZoomMin, value));
    }

    /**
     * 按新倍率缩放棋盘；给了 `anchor` 就**钉住锚点在视口里的位置**（双指 / 滚轮缩放的锚点）。
     *
     * 锚点用**视口局部坐标**：设锚点处的棋盘坐标 `p = (anchor - offset) / scale`
     * （它是跟着棋盘走的那个点），缩放后令 `p` 仍落在 `anchor` 上 ⇒ `offset' = anchor - p * scale'`。
     * 不做这一步的话每次缩放都把地图整体"推"一下，双指捏合的手感会变成"缩放 + 平移"混合。
     *
     * 收尾一律走 `applyMapOffset`：夹回拖动范围 + 重铺背景，和拖动是同一条出口。
     */
    private applyMapZoom(scale: number, anchor?: { x: number; y: number }): void {
        const next = this.clampMapZoom(scale);
        const current = Math.abs(this.mapLayer.scale.x) || ZC_MAP_PRESENTATION_SCALE;
        // 已经顶在区间边界上（捏到头了）：什么都不用做，连 `fitMapBackground` 都不必重跑。
        if (next === current) return;
        const pinned = anchor ? { x: (anchor.x - this.mapOffsetX) / current, y: (anchor.y - this.mapOffsetY) / current } : null;
        this.mapLayer.setScale(next, next, 1);
        if (anchor && pinned) {
            this.mapOffsetX = anchor.x - pinned.x * next;
            this.mapOffsetY = anchor.y - pinned.y * next;
        }
        this.applyMapOffset();
    }

    /**
     * UI 世界坐标 → 视口（`MapScrollView/view`）的**局部**坐标。
     *
     *  不能把 `getUILocation()` 直接当局部坐标用：它给的是 UI 世界坐标，
     * 原点在设计分辨率的左下角，宽高比和设计稿不一致的机型上还带黑边偏移
     * ⇒ 直接拿来当锚点会让"捏哪儿缩哪儿"在窄长屏上偏掉一大截。
     */
    private toViewportLocal(uiX: number, uiY: number): { x: number; y: number } {
        const local = this.mapViewportTransform.convertToNodeSpaceAR(new Vec3(uiX, uiY, 0));
        return { x: local.x, y: local.y };
    }

    /**
     * 双指缩放：把**两指间距的变化**换算成倍率，锚点是两指中点。
     *
     *  必须用 `getAllTouches()` 而不是 `getTouches()`：后者的口径是"这一帧有变动的触点"，
     * 第一根手指按住不动、第二根刚落下时它**只报第二根** ⇒ 拿不到指间距，永远起不了缩放。
     *  返回 true = 这一帧由缩放接管，调用方不要再走棋盘拖动（否则捏合会顺带把地图拖走）。
     *
     * 参照（指间距与倍率）在 {@link beginPinch} 落指时就记好了，所以**第一帧 move 就能缩放**
     * —— 不在中途"吃一帧"记参照，否则双指一捏会先呆一下才动，手感是"卡了一下"。
     */
    private stepPinch(event: EventTouch): boolean {
        const touches = typeof event.getAllTouches === 'function' ? event.getAllTouches() : [];
        if (touches.length < 2) {
            this.pinchStartDistance = 0;
            return false;
        }
        const first = touches[0].getUILocation();
        const second = touches[1].getUILocation();
        const distance = Math.hypot(first.x - second.x, first.y - second.y);
        if (!(this.pinchStartDistance > 0)) {
            // 兜底：`beginPinch` 没跑到（第二根手指的 TOUCH_START 被上层吞了）或两指重叠。
            // 这时只能拿当前帧当参照，本帧不缩放。
            this.pinchStartDistance = distance;
            this.pinchStartScale = Math.abs(this.mapLayer.scale.x) || ZC_MAP_PRESENTATION_SCALE;
            return true;
        }
        if (distance > 0) {
            const anchor = this.toViewportLocal((first.x + second.x) / 2, (first.y + second.y) / 2);
            this.applyMapZoom(this.pinchStartScale * (distance / this.pinchStartDistance), anchor);
        }
        return true;
    }

    /**
     * 第二根手指落下：把这一瞬间的**指间距**与**当前倍率**记成缩放参照，并清掉已累积的拖动量。
     *
     * 返回 true = 判定为双指缩放（调用方不要再把它当棋盘拖动）。
     * 参照记在"落指那一刻"才是正确的：两指刚成对的间距就是 1× 的基准。
     */
    private beginPinch(event: EventTouch): boolean {
        const touches = typeof event.getAllTouches === 'function' ? event.getAllTouches() : [];
        if (touches.length < 2) return false;
        const first = touches[0].getUILocation();
        const second = touches[1].getUILocation();
        this.pinchStartDistance = Math.hypot(first.x - second.x, first.y - second.y);
        this.pinchStartScale = Math.abs(this.mapLayer.scale.x) || ZC_MAP_PRESENTATION_SCALE;
        this.clearDrag();
        return true;
    }

    /**
     * 抬指：剩不到两根就结束这次缩放。
     *
     * ⚠️ `TOUCH_END` 时 `getAllTouches()` **不含**刚抬起的那根（引擎注释："如果手指行为是 touch end，
     * 这个时候列表是没有该手指信息的"），所以这里数出来的一定是"还按着的"根数。
     */
    private endPinch(event: EventTouch): void {
        const remaining = typeof event.getAllTouches === 'function' ? event.getAllTouches().length : 0;
        if (remaining < 2) this.pinchStartDistance = 0;
    }

    /**
     * 滚轮缩放（桌面预览 / PC 端）：一格一个固定增量，不带惯性、不跟滚轮速度挂钩。
     *
     *  锚点取鼠标位置，"滚哪儿缩哪儿"，与双指缩放同一套 `applyMapZoom`。
     */
    private onMapMouseWheel(event: EventMouse): void {
        if (this.mapCameraBusy) return;
        const delta = event.getScrollY();
        if (!delta) return;
        const current = Math.abs(this.mapLayer.scale.x) || ZC_MAP_PRESENTATION_SCALE;
        const step = delta > 0 ? ZC_MAP_ZOOM_WHEEL_STEP : -ZC_MAP_ZOOM_WHEEL_STEP;
        const position = event.getUILocation();
        this.applyMapZoom(current * (1 + step), this.toViewportLocal(position.x, position.y));
    }

    /**
     * 把落点夹回可拖动范围：以整盘包围盒中心为基准，四周留 `MAP_EDGE_MARGIN_*` 余量。
     *
     * 落点（我方主城）也必须过这一关 —— 否则 `setMapFocus` 给一个贴边的坐标，
     * 镜头会停在拖动范围之外，下一次 `SIZE_CHANGED` 把它弹回去，玩家看到镜头自己跳一下。
     */
    private clampMapOffset(x: number, y: number, scale: number): { x: number; y: number } {
        const viewport = this.mapViewportTransform;
        const bounds = this.mapBounds;
        const center = this.mapCenterAtScale(scale);
        const halfMapWidth = (bounds.maxX - bounds.minX) * scale / 2;
        const halfMapHeight = (bounds.maxY - bounds.minY) * scale / 2;
        const maxX = Math.max(0, halfMapWidth - viewport.width / 2 + ZCGameHUDView.MAP_EDGE_MARGIN_X);
        const maxY = Math.max(0, halfMapHeight - viewport.height / 2 + ZCGameHUDView.MAP_EDGE_MARGIN_Y);
        return {
            x: Math.max(center.x - maxX, Math.min(center.x + maxX, x)),
            y: Math.max(center.y - maxY, Math.min(center.y + maxY, y)),
        };
    }

    private applyMapOffset(): void {
        const scale = Math.abs(this.mapLayer.scale.x) || ZC_MAP_PRESENTATION_SCALE;
        const next = this.clampMapOffset(this.mapOffsetX, this.mapOffsetY, scale);
        this.mapOffsetX = next.x;
        this.mapOffsetY = next.y;
        this.mapLayer.setPosition(this.mapOffsetX, this.mapOffsetY, 0);
        this.fitMapBackground();
    }
}
