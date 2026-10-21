import { _decorator, Color, Component, Graphics, Label, Node, UITransform, Vec3, view } from 'cc';
import type { BigMapPresenter } from '../application/BigMapPresenter';
import { BIGMAP_COLORS, createButton, createLabel, createUiNode, drawPanel, type IBigMapButton } from './BigMapTheme';
import { BigMapWorldView } from './BigMapWorldView';
import { BigMapBaseView } from './BigMapBaseView';
import { BIGMAP_CITY_PHASE_LABEL } from '../model/BigMapCitySchedule';
import { sortSnapshotScores } from '../model/BigMapSnapshot';

const { ccclass } = _decorator;

type BigMapMode = 'world' | 'base';

const HEADER_HEIGHT = 62;
const SIDE_PANEL_WIDTH = 300;

/** 建造列表末尾「解锁队列」伪行的 id（真实建筑 id 都是 7 开头）。 */
const QUEUE_ROW_ID = -1;
const INFO_PANEL_WIDTH = 330;

/**
 * 大世界页面：顶栏资源 + 左侧建造列表 + 中间地图/建造区 + 右侧详情 + 底部队列条。
 *
 * 整套 UI **全部代码构建**（`BigMapTheme` 里那套 Graphics 工具），原因见该文件头注：
 * 大世界美术未出，先用线框图跑通玩法；后续换美术只需替换 `createButton/drawPanel`。
 *
 * 页面只做三件事：摆节点、把点击转成 Presenter 调用、把 Presenter 的视图数据写进 Label。
 * 任何规则判断都不在这里（都在 `model/`），所以改数值不用碰这个文件。
 */
@ccclass('BigMapPage')
export class BigMapPage extends Component {
    private presenter: BigMapPresenter | null = null;
    private mode: BigMapMode = 'world';
    private tickAccumulator = 0;
    private unsubscribe: (() => void) | null = null;
    /** 关闭回调（由入口注入；页面本身不知道自己在哪一层）。 */
    private onClose: (() => void) | null = null;
    private toastUntil = 0;

    private worldView: BigMapWorldView = null!;
    private baseView: BigMapBaseView = null!;

    private readonly resLabels = new Map<string, Label>();
    private walletLabel: Label = null!;
    private worldModeButton: IBigMapButton = null!;
    private baseModeButton: IBigMapButton = null!;
    private harvestButton: IBigMapButton = null!;
    private resetButton: IBigMapButton = null!;

    private buildPanel: Node = null!;
    private readonly buildRows: {
        node: Node;
        background: Graphics;
        name: Label;
        detail: Label;
        buildingId: number;
    }[] = [];

    private infoPanel: Node = null!;
    private infoTitle: Label = null!;
    private infoBody: Label = null!;
    private primaryButton: IBigMapButton = null!;
    private secondaryButton: IBigMapButton = null!;

    private queueLabel: Label = null!;
    private toastLabel: Label = null!;

    private selectedCityId = 0;
    private selectedMonsterId = 0;
    private selectedPlotHexId = -1;
    private pendingBuildingId = 0;

    /** 由入口注入 Presenter（单独注入而非在页面里 new，便于单测与后续联机版替换实现）。 */
    initialize(presenter: BigMapPresenter, onClose: (() => void) | null = null): void {
        this.presenter = presenter;
        this.onClose = onClose;
        this.buildUi();
        this.unsubscribe = presenter.onChanged(() => this.refreshAll());
        this.refreshAll();
    }

    // -------------------------------------------------------------- 构建

    private get size(): { width: number; height: number } {
        const size = view.getVisibleSize();
        return {
            width: this.node.getComponent(UITransform)?.width || size.width,
            height: this.node.getComponent(UITransform)?.height || size.height,
        };
    }

    private buildUi(): void {
        const { width, height } = this.size;
        const root = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        root.setContentSize(width, height);

        const backdrop = createUiNode('Backdrop', this.node, width, height);
        drawPanel(backdrop.addComponent(Graphics), width, height, BIGMAP_COLORS.pageBg, null, 0);

        this.buildHeader(width, height);
        this.buildWorldArea(width, height);
        this.buildBaseArea(width, height);
        this.buildBuildPanel(width, height);
        this.buildInfoPanel(width, height);

        this.mode = 'world';
        this.applyMode();
    }

    private buildHeader(width: number, height: number): void {
        const header = createUiNode('Header', this.node, width - 24, HEADER_HEIGHT);
        header.setPosition(new Vec3(0, height / 2 - HEADER_HEIGHT / 2 - 8, 0));
        drawPanel(header.addComponent(Graphics), width - 24, HEADER_HEIGHT, BIGMAP_COLORS.panel, BIGMAP_COLORS.border);

        const half = (width - 24) / 2;
        const closeButton = createButton(header, '返回', 76, 40, () => this.onClose?.(), 17);
        closeButton.node.setPosition(new Vec3(-half + 50, 0, 0));

        // 资源：1200 宽下也放得下（每格 176），最右侧留给模式与操作按钮。
        let x = -half + 128;
        for (const type of ['grain', 'wood', 'iron', 'coin', 'stamina'] as const) {
            const label = createLabel(header, '', 17, BIGMAP_COLORS.text, 176, HEADER_HEIGHT);
            label.node.setPosition(new Vec3(x, 0, 0));
            this.resLabels.set(type, label);
            x += 176;
        }

        this.worldModeButton = createButton(header, '大地图', 96, 40, () => this.switchMode('world'), 18);
        this.worldModeButton.node.setPosition(new Vec3(half - 300, 0, 0));
        this.baseModeButton = createButton(header, '基地建造', 106, 40, () => this.switchMode('base'), 18);
        this.baseModeButton.node.setPosition(new Vec3(half - 194, 0, 0));
        this.harvestButton = createButton(header, '收取', 80, 40, () => this.feedback(this.presenter!.harvestAll()), 18);
        this.harvestButton.node.setPosition(new Vec3(half - 100, 0, 0));
        this.resetButton = createButton(header, '重置', 64, 40, () => {
            this.feedback(this.presenter!.resetSave());
            this.clearSelection();
        }, 15);
        this.resetButton.node.setPosition(new Vec3(half - 30, 0, 0));

        const hint = createLabel(
            this.node, '拖动平移 · 滚轮 / ± 缩放 · 点格子选目标', 14, BIGMAP_COLORS.muted, 460, 24,
        );
        hint.node.setPosition(new Vec3(-width / 2 + 250, height / 2 - HEADER_HEIGHT - 22, 0));
    }

    /** 中间地图区域：避开左侧建造列表与右侧详情面板。 */
    private worldAreaRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const left = -width / 2 + SIDE_PANEL_WIDTH + 16;
        const right = width / 2 - INFO_PANEL_WIDTH - 16;
        const bottom = -height / 2 + 64;
        const top = height / 2 - HEADER_HEIGHT - 30;
        return { x: (left + right) / 2, y: (bottom + top) / 2, width: right - left, height: top - bottom };
    }

    private buildWorldArea(width: number, height: number): void {
        const rect = this.worldAreaRect(width, height);
        const node = createUiNode('WorldView', this.node, rect.width, rect.height);
        node.setPosition(new Vec3(rect.x, rect.y, 0));
        this.worldView = node.addComponent(BigMapWorldView);
        this.worldView.build(this.presenter!, rect.width, rect.height);
        this.worldView.onTap = (hexId) => this.onWorldTap(hexId);

        // 缩放按钮叠在地图右下角。
        const zoomIn = createButton(this.node, '+', 40, 40, () => this.worldView.zoomBy(1.2), 22);
        zoomIn.node.setPosition(new Vec3(rect.x + rect.width / 2 - 30, rect.y - rect.height / 2 + 96, 0));
        const zoomOut = createButton(this.node, '−', 40, 40, () => this.worldView.zoomBy(1 / 1.2), 22);
        zoomOut.node.setPosition(new Vec3(rect.x + rect.width / 2 - 30, rect.y - rect.height / 2 + 50, 0));
        const focus = createButton(this.node, '回家', 56, 34, () => {
            this.worldView.focusOn(this.presenter!.world.playerBase.hexId);
        }, 15);
        focus.node.setPosition(new Vec3(rect.x + rect.width / 2 - 42, rect.y + rect.height / 2 - 24, 0));
    }

    private buildBaseArea(width: number, height: number): void {
        const rect = this.worldAreaRect(width, height);
        const node = createUiNode('BaseView', this.node, rect.width, rect.height);
        node.setPosition(new Vec3(rect.x, rect.y, 0));
        this.baseView = node.addComponent(BigMapBaseView);
        this.baseView.build(this.presenter!, rect.width, rect.height);
        this.baseView.onTap = (hexId) => this.onPlotTap(hexId);
    }

    private buildBuildPanel(width: number, _height: number): void {
        const panelHeight = 9 * 56 + 52;
        const panel = createUiNode('BuildPanel', this.node, SIDE_PANEL_WIDTH, panelHeight);
        panel.setPosition(new Vec3(-width / 2 + SIDE_PANEL_WIDTH / 2 + 12, -40, 0));
        drawPanel(panel.addComponent(Graphics), SIDE_PANEL_WIDTH, panelHeight, BIGMAP_COLORS.panel, BIGMAP_COLORS.border);
        this.buildPanel = panel;

        const title = createLabel(panel, '建筑（解锁来自冒险章节）', 16, BIGMAP_COLORS.gold, SIDE_PANEL_WIDTH - 24, 26);
        title.node.setPosition(new Vec3(0, panelHeight / 2 - 24, 0));
        title.horizontalAlign = Label.HorizontalAlign.CENTER;

        const menu = this.presenter!.buildMenu();
        menu.forEach((entry, index) => {
            const row = createUiNode(`BuildRow_${entry.buildingId}`, panel, SIDE_PANEL_WIDTH - 24, 50);
            row.setPosition(new Vec3(0, panelHeight / 2 - 62 - index * 56, 0));
            const background = row.addComponent(Graphics);
            drawPanel(background, SIDE_PANEL_WIDTH - 24, 50, BIGMAP_COLORS.panelLight, BIGMAP_COLORS.border, 6);
            const name = createLabel(row, entry.name, 17, BIGMAP_COLORS.text, SIDE_PANEL_WIDTH - 40, 22);
            name.node.setPosition(new Vec3(0, 10, 0));
            const detail = createLabel(row, '', 13, BIGMAP_COLORS.muted, SIDE_PANEL_WIDTH - 40, 18);
            detail.node.setPosition(new Vec3(0, -11, 0));
            row.on(Node.EventType.TOUCH_END, () => this.onBuildRowClick(entry.buildingId));
            this.buildRows.push({ node: row, background, name, detail, buildingId: entry.buildingId });
        });

        // 队列付费解锁是一条**动作**而不是建筑，但在 UI 上和建筑同属「花钱变强」，所以放在列表末尾。
        const queueRow = createUiNode('BuildRow_Queue', panel, SIDE_PANEL_WIDTH - 24, 50);
        queueRow.setPosition(new Vec3(0, panelHeight / 2 - 62 - menu.length * 56, 0));
        const queueBackground = queueRow.addComponent(Graphics);
        drawPanel(queueBackground, SIDE_PANEL_WIDTH - 24, 50, BIGMAP_COLORS.panelLight, BIGMAP_COLORS.border, 6);
        const queueName = createLabel(queueRow, '解锁建造队列', 17, BIGMAP_COLORS.text, SIDE_PANEL_WIDTH - 40, 22);
        queueName.node.setPosition(new Vec3(0, 10, 0));
        const queueDetail = createLabel(queueRow, '', 13, BIGMAP_COLORS.muted, SIDE_PANEL_WIDTH - 40, 18);
        queueDetail.node.setPosition(new Vec3(0, -11, 0));
        queueRow.on(Node.EventType.TOUCH_END, () => this.onBuildRowClick(QUEUE_ROW_ID));
        this.buildRows.push({
            node: queueRow,
            background: queueBackground,
            name: queueName,
            detail: queueDetail,
            buildingId: QUEUE_ROW_ID,
        });
    }

    private buildInfoPanel(width: number, height: number): void {
        const panelHeight = height - HEADER_HEIGHT - 110;
        const panel = createUiNode('InfoPanel', this.node, INFO_PANEL_WIDTH, panelHeight);
        panel.setPosition(new Vec3(width / 2 - INFO_PANEL_WIDTH / 2 - 12, -40, 0));
        drawPanel(panel.addComponent(Graphics), INFO_PANEL_WIDTH, panelHeight, BIGMAP_COLORS.panel, BIGMAP_COLORS.border);
        this.infoPanel = panel;

        this.infoTitle = createLabel(panel, '选择目标', 20, BIGMAP_COLORS.gold, INFO_PANEL_WIDTH - 30, 30);
        this.infoTitle.node.setPosition(new Vec3(0, panelHeight / 2 - 32, 0));
        this.infoTitle.horizontalAlign = Label.HorizontalAlign.CENTER;

        this.infoBody = createLabel(panel, '', 15, BIGMAP_COLORS.text, INFO_PANEL_WIDTH - 34, panelHeight - 200);
        this.infoBody.node.setPosition(new Vec3(0, 40, 0));
        this.infoBody.overflow = Label.Overflow.CLAMP;
        this.infoBody.lineHeight = 24;

        this.primaryButton = createButton(panel, '攻打', INFO_PANEL_WIDTH - 40, 46, () => this.onPrimaryAction(), 19);
        this.primaryButton.node.setPosition(new Vec3(0, -panelHeight / 2 + 92, 0));
        this.secondaryButton = createButton(panel, '查看', INFO_PANEL_WIDTH - 40, 40, () => this.onSecondaryAction(), 17);
        this.secondaryButton.node.setPosition(new Vec3(0, -panelHeight / 2 + 38, 0));

        this.queueLabel = createLabel(this.node, '', 15, BIGMAP_COLORS.muted, width - 40, 26);
        this.queueLabel.node.setPosition(new Vec3(0, -height / 2 + 40, 0));
        this.queueLabel.horizontalAlign = Label.HorizontalAlign.CENTER;

        this.toastLabel = createLabel(this.node, '', 18, BIGMAP_COLORS.gold, width - 40, 28);
        this.toastLabel.node.setPosition(new Vec3(0, -height / 2 + 14, 0));
        this.toastLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    }

    // -------------------------------------------------------------- 模式切换

    private switchMode(mode: BigMapMode): void {
        this.mode = mode;
        this.pendingBuildingId = 0;
        this.baseView.setPendingBuilding(0);
        this.applyMode();
        this.refreshAll();
    }

    private applyMode(): void {
        this.worldView.node.active = this.mode === 'world';
        this.baseView.node.active = this.mode === 'base';
        this.buildPanel.active = this.mode === 'base';
        this.worldModeButton.setEnabled(this.mode !== 'world');
        this.baseModeButton.setEnabled(this.mode !== 'base');
        if (this.mode === 'world') this.clearSelection();
    }

    // -------------------------------------------------------------- 交互

    private onWorldTap(hexId: number): void {
        const presenter = this.presenter!;
        const occupant = this.worldView.occupantAt(hexId);
        if (occupant.kind === 'city') {
            this.selectedCityId = occupant.cityId;
            this.selectedMonsterId = 0;
            this.selectedPlotHexId = -1;
            this.refreshInfo();
            // 榜单异步拉一次（拿回来 presenter 会 emit，页面自己重绘）。
            void presenter.refreshCityRank(occupant.cityId);
            return;
        }
        if (occupant.kind === 'monster') {
            this.selectedMonsterId = occupant.instanceId;
            this.selectedCityId = 0;
            this.selectedPlotHexId = -1;
            this.refreshInfo();
            return;
        }
        if (occupant.kind === 'base') {
            if (occupant.base.isPlayer) {
                this.switchMode('base');
                this.feedback({ ok: true, message: '回到自己的基地' });
            } else {
                this.clearSelection();
                this.infoTitle.string = occupant.base.name;
                this.infoBody.string = `其他玩家的基地\n\n战力：${occupant.base.power}\n距离：${Math.round(presenter.distanceFromBase(hexId))} 格\n\n本期只做查看与攻打城池，进攻玩家基地留到联机版。`;
                this.primaryButton.setEnabled(false);
                this.primaryButton.setText('暂不可攻打');
                this.secondaryButton.node.active = false;
            }
            return;
        }
        this.clearSelection();
    }

    private onPlotTap(hexId: number): void {
        const presenter = this.presenter!;
        this.selectedPlotHexId = hexId;
        if (this.pendingBuildingId !== 0) {
            const feedback = presenter.startBuild(hexId, this.pendingBuildingId);
            this.feedback(feedback);
            if (feedback.ok) {
                this.pendingBuildingId = 0;
                this.baseView.setPendingBuilding(0);
            }
            this.refreshAll();
            return;
        }
        const feedback = presenter.tapPlotCell(hexId);
        this.feedback(feedback);
        this.refreshAll();
    }

    private onBuildRowClick(buildingId: number): void {
        if (buildingId === QUEUE_ROW_ID) {
            const feedback = this.presenter!.unlockBuildQueue();
            this.feedback(feedback);
            this.refreshAll();
            return;
        }
        const entry = this.presenter!.buildMenu().find((item) => item.buildingId === buildingId);
        if (!entry) return;
        if (!entry.unlocked) {
            this.feedback({ ok: false, message: entry.reason });
            return;
        }
        this.pendingBuildingId = this.pendingBuildingId === buildingId ? 0 : buildingId;
        this.baseView.setPendingBuilding(this.pendingBuildingId);
        this.feedback({
            ok: true,
            message: this.pendingBuildingId === 0 ? '已取消选择' : `点击空地放置${entry.name}`,
        });
    }

    private onPrimaryAction(): void {
        const presenter = this.presenter!;
        if (this.selectedCityId !== 0) {
            const feedback = presenter.attackCity(this.selectedCityId);
            this.feedback(feedback);
            this.refreshAll();
            return;
        }
        if (this.selectedMonsterId !== 0) {
            const feedback = presenter.attackMonster(this.selectedMonsterId);
            this.feedback(feedback);
            this.refreshAll();
            return;
        }
        this.feedback({ ok: false, message: '先在地图上选一座城池或一只野怪' });
    }

    private onSecondaryAction(): void {
        const presenter = this.presenter!;
        if (this.selectedCityId !== 0) {
            const view = presenter.cityView(this.selectedCityId);
            if (view) this.worldView.focusOn(view.hexId);
        }
        if (this.selectedMonsterId !== 0) {
            const view = presenter.monsterView(this.selectedMonsterId);
            if (view) this.worldView.focusOn(view.hexId);
        }
    }

    private clearSelection(): void {
        this.selectedCityId = 0;
        this.selectedMonsterId = 0;
        this.selectedPlotHexId = -1;
        this.refreshInfo();
    }

    // -------------------------------------------------------------- 刷新

    private refreshAll(): void {
        if (!this.presenter) return;
        this.refreshHeader();
        this.refreshBuildRows();
        this.refreshQueue();
        this.refreshInfo();
        this.worldView?.refresh();
        this.baseView?.refresh();
        this.refreshToast();
    }

    private refreshHeader(): void {
        for (const view of this.presenter!.resourceBar()) {
            const label = this.resLabels.get(view.type);
            if (!label) continue;
            const cap = Number.isFinite(view.cap) ? `/${Math.floor(view.cap)}` : '';
            const pending = view.pending > 0 ? `  +${view.pending}` : '';
            label.string = `${view.name} ${view.amount}${cap}${pending}`;
            label.color = view.pending > 0 ? BIGMAP_COLORS.gold : BIGMAP_COLORS.text;
        }
        this.harvestButton.setEnabled(this.presenter!.resourceBar().some((item) => item.pending > 0));
    }

    private refreshBuildRows(): void {
        const menu = this.presenter!.buildMenu();
        const queueInfo = this.presenter!.queueUnlockInfo();
        for (const row of this.buildRows) {
            if (row.buildingId === QUEUE_ROW_ID) {
                drawPanel(
                    row.background, SIDE_PANEL_WIDTH - 24, 50, BIGMAP_COLORS.panelLight,
                    queueInfo.canUnlock ? BIGMAP_COLORS.border : BIGMAP_COLORS.muted, 6,
                );
                row.name.string = `解锁建造队列  ${queueInfo.current}/${queueInfo.max}`;
                row.name.color = queueInfo.canUnlock ? BIGMAP_COLORS.text : BIGMAP_COLORS.muted;
                row.detail.string = queueInfo.canUnlock
                    ? `货币 ${Math.round(queueInfo.cost)} · 点击解锁第 ${queueInfo.current + 1} 条`
                    : queueInfo.reason;
                row.detail.color = queueInfo.canUnlock ? BIGMAP_COLORS.muted : BIGMAP_COLORS.danger;
                continue;
            }
            const entry = menu.find((item) => item.buildingId === row.buildingId);
            if (!entry) continue;
            const selected = this.pendingBuildingId === row.buildingId;
            drawPanel(
                row.background, SIDE_PANEL_WIDTH - 24, 50,
                selected ? new Color(72, 96, 70, 255) : BIGMAP_COLORS.panelLight,
                selected ? BIGMAP_COLORS.gold : (entry.unlocked ? BIGMAP_COLORS.border : BIGMAP_COLORS.muted),
                6,
            );
            row.name.string = `${entry.name}  ${entry.count}/${entry.maxOwnNum}`;
            row.name.color = entry.unlocked ? BIGMAP_COLORS.text : BIGMAP_COLORS.muted;
            if (!entry.unlocked) {
                row.detail.string = entry.reason;
                row.detail.color = BIGMAP_COLORS.danger;
            } else {
                row.detail.string = `粮${entry.costGrain} 木${entry.costWood} 铁${entry.costIron} · ${entry.buildTime}s · 第${entry.unlockChapter}章`;
                row.detail.color = entry.affordable ? BIGMAP_COLORS.muted : BIGMAP_COLORS.danger;
            }
        }
    }

    private refreshQueue(): void {
        const queues = this.presenter!.queues();
        const main = this.presenter!.mainLevel();
        const power = this.presenter!.attackPower();
        const busy = queues.filter((queue) => queue.busy)
            .map((queue) => `${queue.name}→Lv.${queue.targetLevel} ${queue.remainSeconds}s`);
        const idle = queues.filter((queue) => !queue.busy).length;
        this.queueLabel.string = `主城 Lv.${main} · 攻城伤害 ${power} · 队列 ${idle}/${queues.length} 空闲`
            + (busy.length > 0 ? ` · ${busy.join(' / ')}` : '')
            + ` · 已通关冒险 ${this.presenter!.adventureChapter} 章`;
    }

    private refreshInfo(): void {
        const presenter = this.presenter!;
        this.secondaryButton.node.active = true;

        if (this.selectedCityId !== 0) {
            const city = presenter.cityView(this.selectedCityId);
            if (!city) return;
            this.infoTitle.string = `${city.name}（Lv.${city.level}）`;
            const stateText: Record<string, string> = {
                open: '可攻打', locked: '未解锁', occupied: '已占领', unavailable: '本期未开放', breached: '城防已破',
            };
            const lines = [
                `状态：${stateText[city.state] ?? city.state}`,
                city.state === 'locked' ? `条件：${city.reason}` : '',
                `日程：${BIGMAP_CITY_PHASE_LABEL[city.phase]}${city.canAttack ? '' : ` · ${city.attackReason}`}`,
                `距离：${Math.round(city.distance)} 格${city.inRange ? '' : `（超出势力范围，伤害 -${city.damageCutPct}%）`}`,
                `城防：${Math.round(city.hpRatio * 100)}%   本轮战功：${city.warScore}/${city.minWarScore}`,
                `名次：第 ${city.playerRank} 名   同场 ${city.attackerCount} 人`,
                `消耗行动力：${city.staminaCost}`,
                city.state === 'open'
                    ? `预计伤害 ${city.previewDamage} · 战功 +${city.previewWarScore}`
                    : '',
                city.state === 'occupied' ? `占领奖励：货币 +${city.rewardCoin}` : '',
                '',
                city.desc,
            ];
            this.infoBody.string = lines.filter((line) => line !== '').join('\n');
            // 按钮跟随日程：休战/结算期即使城池开放也要灰掉，否则「亮着但点了才报错」。
            this.primaryButton.node.active = true;
            this.primaryButton.setText(city.canAttack ? '攻打' : '不可攻打');
            this.primaryButton.setEnabled(city.canAttack);
            this.secondaryButton.setText('定位');
            return;
        }

        if (this.selectedMonsterId !== 0) {
            const monster = presenter.monsterView(this.selectedMonsterId);
            if (!monster) return;
            this.infoTitle.string = `${monster.name}（${monster.level} 级）`;
            this.infoBody.string = [
                monster.unlocked ? '状态：可挑战' : `条件：${monster.reason}`,
                `血量：${Math.round(monster.hpRatio * 100)}%`,
                `消耗行动力：${monster.staminaCost}`,
                monster.respawnInSeconds > 0 ? `刷新倒计时：${monster.respawnInSeconds}s` : '已刷新',
                '',
                '野怪必须逐级通关：攻 5 级需先通关 4 级。',
            ].join('\n');
            this.primaryButton.node.active = true;
            this.primaryButton.setText(monster.respawnInSeconds > 0 ? '等待刷新' : '攻打');
            this.primaryButton.setEnabled(monster.unlocked && monster.respawnInSeconds === 0);
            this.secondaryButton.setText('定位');
            return;
        }

        this.infoTitle.string = this.mode === 'base' ? '基地建造' : '选择目标';
        this.infoBody.string = this.mode === 'base'
            ? [
                '六边格建造区：一格只能放一座建筑。',
                '',
                '· 左侧点建筑 → 再点空地放置',
                '· 点已建成的建筑 → 升级（第 3 章解锁）',
                '· 点建造中的格子 → 取消并返还资源',
                '',
                `建筑解锁全部来自冒险章节，当前已通关第 ${presenter.adventureChapter} 章。`,
            ].join('\n')
            : [
                '点击地图上的：',
                '· 菱形块 → 城池（可攻打 / 已占领）',
                '· 小圆点 → 野怪（逐级解锁）',
                '· 蓝色六边形 → 我的基地（点它进建造）',
                '· 小方块 → 其他玩家的基地（本期只看）',
                '',
                '城池解锁是「章节 + 开服天数 + 前置城池已占领」三重条件。',
            ].join('\n') + this.daySnapshotLines();
        this.primaryButton.node.active = false;
        this.secondaryButton.node.active = false;
    }

    /**
     * 「昨日战绩」——22:00 快照，只显示战功最高的三座城。
     *
     * 没有快照（新号 / 还没过过 22:00）就返回空串，不占版面也不显示「暂无」这种噪音。
     */
    private daySnapshotLines(): string {
        const presenter = this.presenter;
        const snapshot = presenter?.daySnapshot();
        if (!presenter || !snapshot) return '';
        const top = sortSnapshotScores(snapshot).slice(0, 3);
        if (top.length === 0) return '';
        const lines = top.map(([cityId, score]) => (
            `· ${presenter.cityView(cityId)?.name ?? cityId}　第 ${score.rank} 名　战功 ${score.warScore}`
        ));
        return ['', `昨日战绩（累计积分 ${snapshot.totalWarScore}）`, ...lines].join('\n');
    }

    private feedback(feedback: { ok: boolean; message: string }): void {
        if (!feedback.message) return;
        this.toastLabel.string = feedback.message;
        this.toastLabel.color = feedback.ok ? BIGMAP_COLORS.gold : BIGMAP_COLORS.danger;
        this.toastUntil = Date.now() + 2600;
        this.toastLabel.node.active = true;
    }

    private refreshToast(): void {
        if (this.toastUntil === 0) return;
        if (Date.now() > this.toastUntil) {
            this.toastUntil = 0;
            this.toastLabel.node.active = false;
        }
    }

    // -------------------------------------------------------------- 心跳

    protected update(deltaTime: number): void {
        if (!this.presenter) return;
        this.tickAccumulator += deltaTime;
        if (this.tickAccumulator < 0.5) return;
        this.tickAccumulator = 0;
        // 静默推进（不触发 onChanged 递归），随后自己刷一次——地图标记重画比整页刷新便宜。
        this.presenter.tick(false);
        this.refreshHeader();
        this.refreshQueue();
        this.worldView?.refresh();
        this.baseView?.refresh();
        this.refreshToast();
    }

    onDestroy(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }
}
