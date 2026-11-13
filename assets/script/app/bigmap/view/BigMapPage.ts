import { _decorator, Component, instantiate, Prefab, SpriteFrame, UITransform, Vec3, view } from 'cc';
import { ResourceScope } from '../../../core/asset/ResourceScope';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import { loadBigMapArt, type IBigMapArt } from '../application/BigMapArtLoader';
import type { IBigMapCityView, IBigMapViewState } from '../application/BigMapViewState';
import { BIGMAP_PRESENTATION_TEXT, formatBigMapCityOpening, formatBigMapMonsterDetail, formatBigMapPlotDetail } from './BigMapPresentationText';
import { BigMapWorldView } from './BigMapWorldView';
import { HeadArt } from '../../HeadArt';
import { BIGMAP_CAMP_ROLE_TEXT, formatBigMapCampRoleDetail } from '../model/BigMapCampRoleInfo';
import { BIGMAP_CAMP_MOVE_TEXT } from '../model/BigMapCampMove';

import { PopupCloseReason } from '../../../framework/ui/PopupDef';
import { PopupManager } from '../../../framework/ui/PopupManager';
import { ShowRewardPage } from '../../showReward/ShowRewardPage';
import { Toast } from '../../common/Toast';
import { BigMapCityPopup, type IBigMapCityPopupContent } from './BigMapCityPopup';
import { BigMapInfoPopup, type IBigMapInfoPopupContent } from './BigMapInfoPopup';
import { BIGMAP_QUEUE_ROW_KIND, BigMapBuildMenuPopup, type IBigMapBuildMenuRow } from './BigMapBuildMenuPopup';
import type { IBigMapPlotCardContent } from './BigMapPlotCard';
import { BigMapPageLayout } from './BigMapPageLayout';

import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent, BigMapViewEvent, type BigMapIntent, type IBigMapRenderEvent, type IBigMapViewCommandEvent } from '../application/BigMapEvents';

const { ccclass } = _decorator;

type BigMapMode = 'world' | 'base';

const HEADER_HEIGHT = 108;

const FOOTER_HEIGHT = 88;

const BIGMAP_PAGE_PREFAB_PATH = 'ui/bigmap/BigMapPage';
const BIGMAP_WORLD_PREFAB_PATH = 'ui/bigmap/BigMapWorldView';

/
 *大世界页面：地图铺满浏览区，目标详情点选时浮出；建造菜单仅基地模式显示。
 *
 *负责页面装配、世界地图与详情弹窗流程；预制体内部渲染和输入交给 BigMapPageLayout。
 */
@ccclass('BigMapPage')
export class BigMapPage extends Component {
    private data: IBigMapViewState | null = null;
    private ready = false;
    private mode: BigMapMode = 'world';
    private navigationHeight = FOOTER_HEIGHT;
    private controllerResources: IControllerResources = null;
    //资源域由 Controller 释放，可能早于 Cocos 帧末销毁；两者都约束 await 后的结果。
    private get artScope(): ResourceScope { return this.controllerResources.scope; }

    private layout: BigMapPageLayout = null;
    private worldView: BigMapWorldView = null;
    /
     *城池弹窗（`PopupBase` 子类，走 PopupManager 栈）。命中时懒打开，之后复用同一实例；
     *野怪 / 地块详情走 BigMapInfoPopup。
     */
    private cityPopupOpened = false;
    private infoPopupOpening = false;
    private infoPopupRevision = 0;
    private infoPopupContent: IBigMapInfoPopupContent | null = null;
    / `open` 是异步的（要读 prefab），期间 `get` 仍返回 null ⇒ 不挡住会连开好几层。 */
    private buildMenuOpening = false;
    / 上一次自动聚焦过的城池 —— 只在选中变化时聚焦一次，避免每帧把视角拽回去。 */
    private focusedCityId = 0;

    private art: IBigMapArt | null = null;
    private enteringBattle = false;

    private selectedCityId = 0;
    private selectedMonsterId = 0;
    private selectedPlotHexId = -1;
    / 搬移态：非 0 时点空地 = 把这栋建筑搬过去（协议 `CmdSlgBuildMoveReqMsg`）。 */
    private pendingMoveInstanceId = 0;
    private baseActionPending = false;
    private playerPortraitLoader: ((scope: ResourceScope) => Promise<SpriteFrame | null>) | null = null;
    private playerPortrait: SpriteFrame | null = null;
    private readonly rolePortraits = new Map<string, SpriteFrame | null>();

    / 由入口交付初始快照，之后只响应展示事件。 */
    async initialize(data: IBigMapViewState, resources: IControllerResources, background = '', navigationHeight = FOOTER_HEIGHT,
        playerPortraitLoader: ((scope: ResourceScope) => Promise<SpriteFrame | null>) | null = null): Promise<void> {
        this.controllerResources = resources;
        this.data = data;
        EventMgr.instance.on(BigMapViewEvent.Render, this.onRender, this);
        EventMgr.instance.on(BigMapViewEvent.Command, this.onCommand, this);
        this.navigationHeight = navigationHeight;
        this.playerPortraitLoader = playerPortraitLoader;
        await Promise.all([
            this.loadPageLayout(),
            this.loadWorldView(),
            this.loadArt(background, data),
        ]);
        if (!this.isValid || this.artScope.disposed) return;
        this.buildUi(this.data);
        this.applyArt();
        this.ready = true;
        this.render(this.data);
        EventMgr.instance.emit(BigMapUiEvent.Ready);
    }

    private async loadPageLayout(): Promise<void> {
        let prefab: Prefab;
        try {
            prefab = await this.controllerResources.assets.load(BIGMAP_PAGE_PREFAB_PATH, Prefab, { scope: this.artScope });
        } catch (error) {
            if (!this.isValid || this.artScope.disposed) return;
            throw error;
        }
        if (!this.isValid || this.artScope.disposed) return;
        const node = instantiate(prefab);
        const layout = node.getComponent(BigMapPageLayout);
        if (!layout) {
            node.destroy();
            throw new Error('[BigMapPage] 页面预制体缺少 BigMapPageLayout');
        }
        node.setParent(this.node);
        this.layout = layout;
    }

    private async loadWorldView(): Promise<void> {
        let prefab: Prefab;
        try {
            prefab = await this.controllerResources.assets.load(BIGMAP_WORLD_PREFAB_PATH, Prefab, { scope: this.artScope });
        } catch (error) {
            if (!this.isValid || this.artScope.disposed) return;
            throw error;
        }
        if (!this.isValid || this.artScope.disposed) return;
        const node = instantiate(prefab);
        node.setParent(this.node);
        const worldView = node.getComponent(BigMapWorldView);
        if (!worldView) {
            node.destroy();
            throw new Error('[BigMapPage] 地图预制体缺少 BigMapWorldView');
        }
        this.worldView = worldView;
    }

    private async loadArt(background: string, data: IBigMapViewState): Promise<void> {
        const [art, portrait] = await Promise.all([
            loadBigMapArt(this.controllerResources.assets, this.artScope, background, data.resourceIcons,
                data.buildingConfigs, data.campConfigs),
            this.playerPortraitLoader ? this.playerPortraitLoader(this.artScope).catch((error: unknown) => {
                console.warn('[BigMapPage] 玩家头像加载失败', error);
                return null;
            }) : Promise.resolve(null),
        ]);
        if (!this.isValid || this.artScope.disposed) return;
        this.art = art;
        this.playerPortrait = portrait;
    }

    private applyArt(): void {
        const art = this.art;
        if (!art) return;
        this.worldView.setArt(art);
        this.worldView.setPlayerPortrait(this.playerPortrait);
        this.layout.setArt(art);
    }

    //-------------------------------------------------------------- 构建

    private get size(): { width: number; height: number } {
        const size = view.getVisibleSize();
        return {
            width: this.node.getComponent(UITransform)?.width || size.width,
            height: this.node.getComponent(UITransform)?.height || size.height,
        };
    }

    private buildUi(data: IBigMapViewState): void {
        const { width, height } = this.size;
        const ui = this.layout;
        ui.initialize(data, this.navigationHeight);
        ui.mountWorld(this.worldView.node);
        this.buildWorldArea(data, width, height);
        this.buildBaseArea(data, width, height);
        this.mode = 'world';
        this.applyMode();
    }

    / 浏览地图铺满屏宽；浮层放在地图之上，不再把竖屏压成负宽度。 */
    private worldAreaRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const left = -width / 2 + 12;
        const right = width / 2 - 12;
        const bottom = -height / 2 + this.navigationHeight;
        const top = height / 2 - HEADER_HEIGHT - 20;
        return { x: (left + right) / 2, y: (bottom + top) / 2, width: right - left, height: top - bottom };
    }

    private buildWorldArea(data: IBigMapViewState, width: number, height: number): void {
        const rect = this.worldAreaRect(width, height);
        const node = this.worldView.node;
        node.setPosition(new Vec3(rect.x, rect.y, 0));
        //先交付已加载的贴图，避免 build 把整张世界逐格画成 Graphics 后又立即清空重画。
        if (this.art) this.worldView.setArt(this.art);
        this.worldView.build(data, rect.width, rect.height);
    }

    private buildBaseArea(data: IBigMapViewState, width: number, height: number): void {
        const rect = this.worldAreaRect(width, height);
        this.layout.buildBase(data, rect);
    }

    //-------------------------------------------------------------- 模式切换

    private applyMode(): void {
        this.worldView.node.active = this.mode === 'world';
    }

    //-------------------------------------------------------------- 交互

    private sendIntent(intent: BigMapIntent): void {
        if (this.ready && !this.enteringBattle) EventMgr.instance.emit(BigMapUiEvent.Intent, { intent });
    }
    private onWorldTap(hexId: number): void { this.sendIntent({ kind: 'worldTap', hexId }); }
    private onPlotTap(hexId: number): void { this.sendIntent({ kind: 'plotTap', hexId }); }

    private onRender(event: IBigMapRenderEvent): void {
        this.data = event.state;
        if (this.ready) this.render(event.state);
    }
    private onCommand(event: IBigMapViewCommandEvent): void {
        if (!this.ready) return;
        const command = event.command;
        if (command.kind === 'rewards') {
            void ShowRewardPage.open({ userData: { goods: command.rewards.map(reward => ({ resId: reward.resId, number: reward.amount })) } });
        } else if (command.kind === 'feedback') this.feedback(command);
        else if (command.kind === 'focusWorld') this.worldView.focusOn(command.hexId);
        else this.layout.focusBase(command.hexId);
    }
    private render(data: IBigMapViewState): void {
        this.data = data;
        const ui = data.ui;
        this.mode = ui.mode;
        this.selectedCityId = ui.selectedCityId;
        this.selectedMonsterId = ui.selectedMonsterId;
        this.selectedPlotHexId = ui.selectedPlotHexId;
        this.pendingMoveInstanceId = ui.pendingMoveInstanceId;
        this.baseActionPending = ui.baseActionPending;
        this.enteringBattle = ui.enteringBattle;
        this.applyMode();
        this.refreshAll(data);
    }

    //-------------------------------------------------------------- 刷新

    private refreshAll(data: IBigMapViewState): void {
        this.loadRolePortraits(data);
        this.layout.render(data);
        this.refreshBuildMenu(data);
        this.refreshInfo(data);
        this.worldView.render(data);
    }

    /
     *建造目录：`buildMenuVisible` 一开就打开弹窗，一关就关掉。
     *
     *走 `PopupBase`（`BigMapBuildMenuPopup`）而不是页面内节点：
     *遮罩、点空白关闭、栈顺序、关闭原因全部由基类接管，页面这边只剩「什么时候开」。
     */
    private refreshBuildMenu(data: IBigMapViewState): void {
        const shouldOpen = data.ui.mode === 'base' && data.ui.buildMenuVisible;
        const opened = PopupManager.inst.get(BigMapBuildMenuPopup);
        if (!shouldOpen) {
            this.buildMenuOpening = false;
            if (opened) opened.close(PopupCloseReason.Force);
            return;
        }
        const content = { rows: this.buildMenuRows(data) };
        if (opened) { opened.render(content); return; }
        if (this.buildMenuOpening) return;
        this.buildMenuOpening = true;
        void BigMapBuildMenuPopup.open({
            userData: content,
            //点空白只让弹窗自己收掉，页面状态里的 `buildMenuVisible` 还是 true ⇒
            //下一次 500ms `tick → publish` 会按「该开」再弹回来。所以把用户主动收起
            //翻译成意图，让 model 的可见性跟着关。
            onClose: (reason) => {
                //`Force` 是页面自己在收（切模式 / 状态已经变了），model 那边早就关过了；
                //其余（点空白、点了某一行、关闭按钮）都是用户主动关 —— 状态必须跟着关，
                //否则下一次 500ms `tick → publish` 会把弹窗原样再弹回来。
                if (reason === PopupCloseReason.Force) return;
                if (this.isValid) this.sendIntent({ kind: 'closeBuildMenu' });
            },
        }).then((popup) => {
            this.buildMenuOpening = false;
            if (!popup || !this.isValid) return;
            const now = this.data;
            //打开期间状态已经变了（关页 / 退出基地 / 又点了一次「建造」）⇒ 立刻收掉，别留个孤儿弹窗。
            if (!now || now.ui.mode !== 'base' || !now.ui.buildMenuVisible) popup.close(PopupCloseReason.Force);
        });
    }

    / 把 `buildMenu` + `queueUnlock` 摊平成行数据 —— 弹窗不认识 model，只吃这份结果。 */
    private buildMenuRows(data: IBigMapViewState): IBigMapBuildMenuRow[] {
        const rows: IBigMapBuildMenuRow[] = data.buildMenu.map((entry) => ({
            kind: entry.kind,
            name: `${entry.name}  ${entry.count}/${entry.maxOwnNum}`,
            detail: entry.unlocked
                ? `粮${entry.costGrain} 木${entry.costWood} 铁${entry.costIron} · ${entry.buildTime}s · 第${entry.unlockChapter}章`
                : entry.reason,
            selected: data.ui.pendingBuildingId !== 0 && data.ui.pendingBuildingId === entry.buildingId,
            nameMuted: !entry.unlocked,
            detailDanger: !entry.unlocked || !entry.affordable,
        }));
        //解锁队列固定排最后一行（与目录的「你还能再开一条队列」语义一致）。
        const unlock = data.queueUnlock;
        rows.push({
            kind: BIGMAP_QUEUE_ROW_KIND,
            name: `解锁建造队列  ${unlock.current}/${unlock.max}`,
            detail: unlock.canUnlock ? `货币 ${Math.round(unlock.cost)} · 点击解锁第 ${unlock.current + 1} 条` : unlock.reason,
            selected: false,
            nameMuted: !unlock.canUnlock,
            detailDanger: !unlock.canUnlock,
        });
        return rows;
    }

    private refreshInfo(data: IBigMapViewState): void {
        if (this.enteringBattle) {
            this.closeInfoPopup();
            this.closeCityPopup();
            //开战遮罩盖上来时，贴底卡也得收 —— 否则它压在遮罩下面露出半个角。
            this.layout.renderPlotCard(null);
            return;
        }
        this.refreshInfoContent(data);
    }

    /
     *显示 / 复用城池弹窗。
     *
     *弹窗是 `PopupBase` 子类、由 `PopupManager` 管生命周期，所以这里只做两件事：
     *已经有实例就直接复渲染（不重复压栈），没有才 `open`。
     *首次 `open` 要读预制体、有一帧延迟 —— 可接受，且打开后一直复用。
     */
    private showCityPopup(city: IBigMapCityView): void {
        const content = this.buildCityPopupContent(city);
        const opened = PopupManager.inst.get(BigMapCityPopup);
        if (opened) {
            opened.render(content);
            this.cityPopupOpened = true;
            return;
        }
        //`open` 是异步的（要读预制体），期间 `get` 仍返回 null ⇒ 不挡住的话每次 refresh 都会再压一层。
        if (this.cityPopupOpened) return;
        this.cityPopupOpened = true;
        void BigMapCityPopup.open({ userData: content }).then((popup) => {
            const data = this.data;
            if (!this.isValid || !data || data.ui.campRolesVisible || data.ui.selectedCityId === 0 || data.ui.mode !== 'world') {
                if (popup) popup.close(PopupCloseReason.Force);
                return;
            }
            const current = data.cities.get(data.ui.selectedCityId);
            if (current && popup) popup.render(this.buildCityPopupContent(current));
        }).catch((error: unknown) => {
            this.cityPopupOpened = false;
            console.warn('[BigMapPage] 城池弹窗打开失败', error);
        });
    }

    / 关掉城池弹窗（没开着时是空操作）。`Force` = 由页面侧主动收，不算用户点空白。 */
    private closeCityPopup(): void {
        if (!this.cityPopupOpened) return;
        this.cityPopupOpened = false;
        PopupManager.inst.closeByClass(BigMapCityPopup, PopupCloseReason.Force);
    }

    /
     *城池 → 弹窗展示数据。
     *
     *排行榜来自当前城池快照；增益效果：`bigMapCamp` 表只有 `buffConNum` / `buffRate` 两个数值 + 一句 `campDesc`，
     *  没有逐条 buff 文案，先填 `campDesc` 一条（第二条自动隐藏）。
     */
    private buildCityPopupContent(city: IBigMapCityView): IBigMapCityPopupContent {
        const desc = city.campConfig?.desc ?? city.desc;
        const lordId = city.campInfo?.occupyRoleId;
        const lordRank = lordId ? city.rankEntries.find((row) => row.roleId === lordId) : undefined;
        const lordRole = lordId ? city.campRoles.find((role) => role.roleId === lordId) : undefined;
        return {
            hasPlayerActions: city.isServerCamp,
            title: city.name,
            openingText: city.state === 'unavailable' || city.state === 'locked'
                ? formatBigMapCityOpening(city.campConfig?.openDay ?? 0) : '',
            buffs: desc ? [{ title: BIGMAP_PRESENTATION_TEXT.buffTitle, desc }] : [],
            ranks: city.rankEntries.filter((row) => !lordId || row.roleId !== lordId).map((row) => ({ rank: row.rank, name: row.name ?? '',
                score: String(row.warScore), avatar: null, avatarId: row.avatarId ?? '' })),
            warScore: city.warScore,
            minOccupyScore: city.minWarScore,
            lordName: city.campInfo?.occupyRoleName ?? '',
            lordScore: lordRank ? String(lordRank.warScore) : '',
            lordAvatarId: lordRole?.avatarId || lordRank?.avatarId || '',
            staminaCost: city.staminaCost,
            fightCaption: city.canAttack ? BIGMAP_PRESENTATION_TEXT.attack : BIGMAP_PRESENTATION_TEXT.cannotAttack,
            fightEnabled: city.canAttack,
        };
    }

    private refreshInfoContent(data: IBigMapViewState): void {
        //基地建筑一律走贴底卡（非模态，地图不下线）；野怪 / 迁城确认仍走居中 InfoPopup。
        //每帧只写一遍：`buildPlotCardContent` 返回 null 就是收起。
        this.layout.renderPlotCard(this.buildPlotCardContent(data));
        const city = this.mode === 'world' && this.selectedCityId !== 0 ? data.cities.get(this.selectedCityId) : null;
        if (city && data.ui.campRolesVisible) {
            this.closeCityPopup();
            const roles = city.campRoles;
            const index = roles.length > 0 ? data.ui.campRoleIndex % roles.length : 0;
            const role = roles[index];
            const empty = city.campRolesStatus === 'failed' ? BIGMAP_CAMP_ROLE_TEXT.failed
                : city.campRolesStatus === 'ready' ? BIGMAP_CAMP_ROLE_TEXT.empty : BIGMAP_CAMP_ROLE_TEXT.pending;
            this.showInfoPopup({
                title: `${city.name} · 驻守玩家${role ? `（${index + 1}/${roles.length}）` : ''}`,
                body: role ? formatBigMapCampRoleDetail(role) : empty,
                icon: role ? this.rolePortraits.get(role.avatarId) ?? null : null,
                primary: { text: BIGMAP_CAMP_MOVE_TEXT.moveHere, enabled: !this.baseActionPending },
                secondary: { text: BIGMAP_CAMP_ROLE_TEXT.next, enabled: roles.length > 1 && !this.baseActionPending },
            });
            return;
        }
        if (city) {
            this.closeInfoPopup();
            this.showCityPopup(city);
            if (this.focusedCityId !== city.cityId) {
                this.focusedCityId = city.cityId;
                this.sendIntent({ kind: 'secondary' });
            }
            return;
        }
        this.focusedCityId = 0;
        this.closeCityPopup();
        const content = this.buildInfoPopupContent(data);
        if (content) this.showInfoPopup(content);
        else this.closeInfoPopup();
    }

    /
     *建筑卡内容。
     *
     *与原先 `BigMapInfoPopup` 的 base 分支是同一套语义（主按钮 = 升级 / 取消建造，
     *次按钮 = 收取 / 移动），只是不再塞进模态弹窗，并且正文换成带产量对比的版本。
     */
    private buildPlotCardContent(data: IBigMapViewState): IBigMapPlotCardContent | null {
        //用页面自己的 `mode`（`render` 里从 `ui.mode` 同步过来），与 `buildInfoPopupContent` 同口径。
        if (this.mode !== 'base' || this.selectedPlotHexId < 0) return null;
        const detail = data.plotDetails.get(this.selectedPlotHexId);
        if (!detail) return null;
        const busy = detail.queueSlotIndex >= 0;
        const moving = this.pendingMoveInstanceId === detail.instanceId;
        const canHarvest = detail.stored > 0 || data.collectableBuildings.has(detail.buildingId);
        return {
            name: detail.name,
            level: detail.level,
            targetLevel: detail.targetLevel,
            body: formatBigMapPlotDetail(detail) + (moving ? `\n${BIGMAP_PRESENTATION_TEXT.moveHint}` : ''),
            icon: this.art?.buildings.get(detail.buildingId) ?? null,
            busy,
            remainSeconds: detail.remainSeconds,
            primary: {
                text: busy ? BIGMAP_PRESENTATION_TEXT.cancelBuild : BIGMAP_PRESENTATION_TEXT.upgrade,
                enabled: !data.ui.baseActionPending && (busy || detail.canUpgrade),
            },
            secondary: canHarvest || !busy ? {
                text: canHarvest ? data.isServerBase ? BIGMAP_PRESENTATION_TEXT.harvest
                    : `${BIGMAP_PRESENTATION_TEXT.harvest} ${detail.stored}`
                    : moving ? BIGMAP_PRESENTATION_TEXT.moveCancel : BIGMAP_PRESENTATION_TEXT.move,
                enabled: !data.ui.baseActionPending,
            } : null,
        };
    }

    private buildInfoPopupContent(data: IBigMapViewState): IBigMapInfoPopupContent | null {
        if (data.ui.pendingCampMoveId > 0 && data.ui.selectedBaseHexId >= 0) {
            const city = data.cities.get(data.ui.pendingCampMoveId);
            return {
                title: BIGMAP_CAMP_MOVE_TEXT.confirm, body: `目标据点：${city?.name ?? data.ui.pendingCampMoveId}\n目标格：${data.ui.selectedBaseHexId}`,
                icon: null, primary: { text: BIGMAP_CAMP_MOVE_TEXT.confirm, enabled: !this.baseActionPending },
                secondary: { text: BIGMAP_CAMP_MOVE_TEXT.cancel, enabled: !this.baseActionPending },
            };
        }
        if (this.mode === 'base') return null;
        const monster = this.mode === 'world' && this.selectedMonsterId !== 0 ? data.monsters.get(this.selectedMonsterId) : null;
        if (!monster) return null;
        return {
            title: `${monster.name}（${monster.level} 级）`, body: formatBigMapMonsterDetail(monster),
            icon: this.art?.monster ?? null,
            primary: { text: monster.canAttack ? '攻打' : monster.respawnInSeconds > 0 ? '等待刷新' : '暂不可挑战',
                enabled: monster.canAttack }, secondary: { text: '定位', enabled: true },
        };
    }

    private async showInfoPopup(content: IBigMapInfoPopupContent): Promise<void> {
        this.infoPopupContent = content;
        const opened = PopupManager.inst.get(BigMapInfoPopup);
        if (opened) { opened.render(content); return; }
        if (this.infoPopupOpening) return;
        const revision = ++this.infoPopupRevision;
        this.infoPopupOpening = true;
        try {
            const popup = await BigMapInfoPopup.open({ userData: content });
            if (!this.isValid || revision !== this.infoPopupRevision || !this.infoPopupContent) return;
            if (popup) popup.render(this.infoPopupContent);
        } catch (error) {
            console.warn('[BigMapPage] 详情弹窗打开失败', error);
        } finally {
            if (revision === this.infoPopupRevision) this.infoPopupOpening = false;
        }
    }

    private closeInfoPopup(): void {
        this.infoPopupContent = null;
        this.infoPopupOpening = false;
        this.infoPopupRevision += 1;
        PopupManager.inst.closeByClass(BigMapInfoPopup, PopupCloseReason.Force);
    }

    private feedback(feedback: { ok: boolean; message: string }): void {
        if (feedback.message) Toast.show(feedback.message);
    }

    /
     *头像预取：地图上每个玩家标记都要头像（榜单榜首 + 名单里全部角色）。
     *
     *`rolePortraits` 兼作"已发起"的登记表（先写 `null` 占位），所以每帧全量扫一遍不会重复发请求；
     *新进视野的据点名单到达后，下一帧自然补上。
     */
    private loadRolePortraits(data: IBigMapViewState): void {
        for (const city of data.cities.values()) {
            const avatarIds = [city.rankEntries.find((row) => row.rank === 1)?.avatarId];
            //2026-11-11：名单角色已按 `pos` 摆在地图上 ⇒ 全员头像都要，不能只加载弹窗当前那位。
            for (const role of city.campRoles) avatarIds.push(role.avatarId);
            for (const avatarId of avatarIds) {
                if (!avatarId || this.rolePortraits.has(avatarId)) continue;
                this.rolePortraits.set(avatarId, null);
                void this.loadRolePortrait(avatarId);
            }
        }
    }
    private async loadRolePortrait(avatarId: string): Promise<void> {
        const resources = this.controllerResources;
        let frame: SpriteFrame | null = null;
        try {
            frame = await HeadArt.loadHeadFrame(avatarId, (name, root) =>
                resources.assets.load(`${root}/${name}/spriteFrame`, SpriteFrame, { scope: resources.scope }));
        } catch (error) { console.warn('[BigMapPage] 驻守玩家头像加载失败', error); }
        if (!this.isValid || resources.scope.disposed) return;
        this.rolePortraits.set(avatarId, frame);
        this.worldView.setRolePortrait(avatarId, frame);
        if (this.data) this.refreshInfo(this.data);
    }

    onDestroy(): void {
        this.ready = false;
        this.closeInfoPopup();
        this.closeCityPopup();
        if (this.data) EventMgr.instance.emit(BigMapUiEvent.Disposed);
        EventMgr.instance.offTarget(this);
        this.data = null;
        this.rolePortraits.clear();
    }
}
