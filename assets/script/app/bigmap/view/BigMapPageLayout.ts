import { _decorator, Button, Component, instantiate, Label, Node, Sprite, Widget } from 'cc';
import type { IBigMapViewState } from '../application/BigMapViewState';
import type { IBigMapArt } from '../application/BigMapArtLoader';
import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent, type BigMapIntent } from '../application/BigMapEvents';
import { BIGMAP_COLORS } from './BigMapTheme';
import { BIGMAP_HUD_COLORS, fitBigMapSprite } from './BigMapSkin';
import { BIGMAP_PRESENTATION_TEXT } from './BigMapPresentationText';
import { BigMapBaseView } from './BigMapBaseView';

const { ccclass, property } = _decorator;
const RESOURCE_TYPES = ['grain', 'wood', 'iron', 'coin', 'stamina'] as const;
const QUEUE_ROW_ID = -1;
const MODE_FRAME_WIDTH = 111;
const MODE_FRAME_Y = -7.5;
const MODE_ICON_SIZE = 79;
const MODE_ICON_Y = 11.5;

/** 持有页面预制体内部控件，负责渲染和输入；外部仅交付展示快照与资源。 */
@ccclass('BigMapPageLayout')
export class BigMapPageLayout extends Component {
    @property([Label]) private resourceLabels: Label[] = [];
    @property([Sprite]) private resourceIcons: Sprite[] = [];
    @property(BigMapBaseView) private baseView: BigMapBaseView = null!;
    @property(Button) private harvestButton: Button = null!;
    @property(Button) private buildMenuButton: Button = null!;
    @property(Node) private modeNode: Node = null!;
    @property(Label) private modeLabel: Label = null!;
    @property(Sprite) private modeIcon: Sprite = null!;
    @property(Sprite) private modeFrame: Sprite = null!;
    @property(Sprite) private modeFallback: Sprite = null!;
    @property(Node) private buildPanel: Node = null!;
    @property(Button) private buildRowTemplate: Button = null!;
    /** 左下角「探索」（蓝湖「野怪搜索」）：定位当前能打、等级最高的野怪。 */
    @property(Button) private exploreButton: Button = null!;
    @property(Node) private queuePanel: Node = null!;
    @property(Label) private queueLabel: Label = null!;

    // 仅保留输入所需的表现状态；初始化前不接收操作。
    private inputEnabled = false;
    private mode: 'world' | 'base' = 'world';
    private art: IBigMapArt | null = null;
    private readonly buildRows: { node: Node; background: Sprite; name: Label; detail: Label; kind: number }[] = [];

    protected onLoad(): void {
        this.harvestButton.node.on(Button.EventType.CLICK, this.onHarvestClick, this);
        this.buildMenuButton.node.on(Button.EventType.CLICK, this.onBuildMenuClick, this);
        this.exploreButton.node.on(Button.EventType.CLICK, this.onExploreClick, this);
        this.modeNode.on(Button.EventType.CLICK, this.onModeClick, this);
    }

    initialize(data: IBigMapViewState, navigationHeight: number): void {
        this.inputEnabled = !data.ui.enteringBattle;
        this.mode = data.ui.mode;
        this.applyNavigationHeight(navigationHeight);
        this.bindBuildRows(data.buildMenu);
    }

    mountWorld(node: Node): void {
        node.setParent(this.node);
        node.setSiblingIndex(1);
    }

    buildBase(data: IBigMapViewState, rect: { x: number; y: number; width: number; height: number }): void {
        this.baseView.node.setPosition(rect.x, rect.y, 0);
        this.baseView.build(data, rect.width, rect.height);
    }

    focusBase(hexId: number): void { this.baseView.focusOn(hexId); }

    setArt(art: IBigMapArt): void {
        this.art = art;
        this.baseView.setArt(art);
        this.resourceIcons.forEach((icon, index) => {
            icon.spriteFrame = art.resources.get(RESOURCE_TYPES[index]) ?? null;
        });
        this.applyMode(this.mode);
    }

    render(data: IBigMapViewState): void {
        this.inputEnabled = !data.ui.enteringBattle;
        this.mode = data.ui.mode;
        this.applyMode(data.ui.mode);
        this.buildPanel.active = data.ui.mode === 'base' && data.ui.buildMenuVisible;
        this.refreshHeader(data);
        this.refreshBuildRows(data);
        this.refreshQueue(data);
        this.baseView.render(data);
    }

    private sendIntent(intent: BigMapIntent): void {
        if (this.inputEnabled) EventMgr.instance.emit(BigMapUiEvent.Intent, { intent });
    }
    private onHarvestClick(): void { this.sendIntent({ kind: 'harvestAll' }); }
    private onBuildMenuClick(): void { this.sendIntent({ kind: 'toggleBuildMenu' }); }
    private onExploreClick(): void { this.sendIntent({ kind: 'searchMonster' }); }
    private onModeClick(): void {
        this.sendIntent({ kind: 'mode', mode: this.mode === 'world' ? 'base' : 'world' });
    }

    /** 固定尺寸、边距与资源均分由 prefab 的 Widget 管理。 */
    private applyNavigationHeight(navigationHeight: number): void {
        this.node.getComponent(Widget).updateAlignment();
        const modeWidget = this.modeNode.getComponent(Widget);
        modeWidget.bottom = navigationHeight + 20;
        modeWidget.updateAlignment();
        const exploreWidget = this.exploreButton.node.getComponent(Widget);
        exploreWidget.bottom = navigationHeight + 128;
        exploreWidget.updateAlignment();
    }

    private bindBuildRows(menu: IBigMapViewState['buildMenu']): void {
        const entries = [...menu, { kind: QUEUE_ROW_ID, name: '解锁建造队列' }];
        entries.forEach((entry, index) => {
            const node = instantiate(this.buildRowTemplate.node);
            node.name = `BuildRow_${entry.kind}`;
            node.setParent(this.buildPanel);
            node.active = true;
            node.setPosition(0, 216 - index * 56);
            const name = node.getChildByName('Name').getComponent(Label);
            const detail = node.getChildByName('Detail').getComponent(Label);
            name.string = entry.name;
            node.on(Button.EventType.CLICK, () => this.sendIntent({ kind: 'build', buildingKind: entry.kind }), this);
            this.buildRows.push({ node, background: node.getComponent(Sprite), name, detail, kind: entry.kind });
        });
    }

    private applyMode(mode: IBigMapViewState['ui']['mode']): void {
        this.baseView.node.active = mode === 'base';
        this.buildMenuButton.node.active = mode === 'base';
        this.queuePanel.active = mode === 'base';
        this.modeLabel.string = mode === 'world'
            ? BIGMAP_PRESENTATION_TEXT.baseToggle
            : BIGMAP_PRESENTATION_TEXT.worldToggle;
        if (this.art) {
            // 图标跟着文字走：写【基地】就压建筑 icon，写【大地图】就压折页地图。
            // 换模式时**只换 spriteFrame**，不重建节点 —— 重建会让那颗按钮在点下的那一帧闪一下。
            const icon = this.art.hud.get(mode === 'world' ? 'mode_base' : 'mode_world') ?? null;
            fitBigMapSprite(this.modeIcon, icon, MODE_ICON_SIZE, 0, MODE_ICON_Y);
            const frame = this.art.hud.get('mode_frame') ?? null;
            fitBigMapSprite(this.modeFrame, frame, MODE_FRAME_WIDTH, 0, MODE_FRAME_Y);
            this.modeFallback.node.active = !frame;
        }
    }

    private refreshHeader(data: IBigMapViewState): void {
        for (const view of data.resources) {
            const label = this.resourceLabels[RESOURCE_TYPES.indexOf(view.type)];
            const cap = Number.isFinite(view.cap) ? `/${Math.floor(view.cap)}` : '';
            const pending = view.pending > 0 ? `  +${view.pending}` : '';
            const amount = view.amount >= 1000 ? `${(view.amount / 1000).toFixed(1)}K` : `${view.amount}`;
            const recovery = data.actionRecoverSeconds;
            label.string = view.amountKnown === false ? view.type === 'stamina' && recovery !== null && recovery > 0 ? `${recovery}s` : '—'
                : this.art ? amount + (view.type === 'stamina' ? cap : '') : `${view.name} ${view.amount}${cap}${pending}`;
            // HUD 皮肤：米白压深板岩卡；没加载到美术（纯色兜底）时退回旧的深棕字压浅纸面。
            label.color = this.art ? BIGMAP_HUD_COLORS.cream : BIGMAP_COLORS.text;
        }
        this.harvestButton.interactable = !data.ui.baseActionPending && data.canHarvest;
    }

    private refreshBuildRows(data: IBigMapViewState): void {
        const menu = data.buildMenu;
        const textColor = this.art ? BIGMAP_HUD_COLORS.cream : BIGMAP_COLORS.text;
        const mutedColor = this.art ? BIGMAP_HUD_COLORS.muted : BIGMAP_COLORS.muted;
        const dangerColor = this.art ? BIGMAP_HUD_COLORS.danger : BIGMAP_COLORS.danger;
        const queueInfo = data.queueUnlock;
        for (const row of this.buildRows) {
            if (row.kind === QUEUE_ROW_ID) {
                row.background.color = queueInfo.canUnlock ? BIGMAP_HUD_COLORS.cardLight : BIGMAP_HUD_COLORS.cardDeep;
                row.name.string = `解锁建造队列  ${queueInfo.current}/${queueInfo.max}`;
                row.name.color = queueInfo.canUnlock ? textColor : mutedColor;
                row.detail.string = queueInfo.canUnlock
                    ? `货币 ${Math.round(queueInfo.cost)} · 点击解锁第 ${queueInfo.current + 1} 条`
                    : queueInfo.reason;
                row.detail.color = queueInfo.canUnlock ? mutedColor : dangerColor;
                continue;
            }
            const entry = menu.find((item) => item.kind === row.kind);
            if (!entry) continue;
            const selected = data.ui.pendingBuildingId !== 0 && data.ui.pendingBuildingId === entry.buildingId;
            row.background.color = selected ? BIGMAP_HUD_COLORS.cardLight : BIGMAP_HUD_COLORS.cardDeep;
            row.name.string = `${entry.name}  ${entry.count}/${entry.maxOwnNum}`;
            row.name.color = entry.unlocked ? textColor : mutedColor;
            if (!entry.unlocked) {
                row.detail.string = entry.reason;
                row.detail.color = dangerColor;
            } else {
                row.detail.string = `粮${entry.costGrain} 木${entry.costWood} 铁${entry.costIron} · ${entry.buildTime}s · 第${entry.unlockChapter}章`;
                row.detail.color = entry.affordable ? mutedColor : dangerColor;
            }
        }
    }

    private refreshQueue(data: IBigMapViewState): void {
        const queues = data.queues;
        const busy = queues.filter((queue) => queue.busy)
            .map((queue) => `${queue.name}→Lv.${queue.targetLevel} ${queue.remainSeconds}s`);
        // 分母是 `bigmapQueue.maxBuildQueue`（解锁上限），不是"已解锁几条" ——
        // 否则新号看到的永远是 `0/1`，根本不知道还能解锁。
        const locked = queues.filter((queue) => queue.locked).length;
        const unlocked = queues.length - locked;
        this.queueLabel.string = `${BIGMAP_PRESENTATION_TEXT.queue} ${busy.length}/${unlocked}`
            + (busy.length > 0 ? ` · ${busy.join(' / ')}` : ` · ${BIGMAP_PRESENTATION_TEXT.emptyQueue}`)
            + (locked > 0 ? ` · ${BIGMAP_PRESENTATION_TEXT.queueLocked} ${locked}` : '');
    }

}
