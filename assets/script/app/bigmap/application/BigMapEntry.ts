import type { SessionAssetService } from '../../../core/asset/SessionAssetService';
import { createZCBattlePreload } from '../../zcds/application/ZCBattlePreparation';
import { director, Layers, Node, SpriteFrame, UITransform, view, Widget } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import type { ConfigService } from '../../../core/config/ConfigService';
import { GameRoute } from '../../../core/runtime/GameRoute';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
// 常驻弹窗根节点名：世界页要插到它**下面**，否则 Toast / CmdTips 全被地图盖住。
import { POPUP_ROOT_NAME } from '../../../framework/ui/PopupDef';
import { startBattle } from '../../battle/BattleStartService';
import { readRoleRow } from '../../main/MainRoleRow';
import { HeadArt } from '../../HeadArt';
import { toIdString } from '../../net/RequestGuard';
import { TerritoryChapterInfoRepository } from '../../territory/application/TerritoryChapterInfoRepository';
import { createTerritorySaveStore } from '../../territory/application/TerritorySaveStoreAdapter';
import { loadBigMapConfig } from './BigMapConfigLoader';
import { loadBigMapLayout } from './BigMapLayoutLoader';
import { NpcBigMapRankProvider } from './NpcBigMapRankProvider';
import { BigMapPresenter } from './BigMapPresenter';
import { BIGMAP_SAVE_KEY, type IBigMapSaveOwner } from './BigMapSaveKeys';
import { createBigMapStorage } from './BigMapStorage';
import { BigMapCampRepository } from './BigMapCampRepository';
import { GameNetBigMapCampGateway } from './GameNetBigMapCampGateway';
import { BigMapSlgRepository } from './BigMapSlgRepository';
import { GameNetBigMapSlgGateway } from './GameNetBigMapSlgGateway';
import { BigMapPage } from '../view/BigMapPage';
import { mountBigMapNavigation } from '../view/BigMapNavigation';
import type { IBigMapLayout } from '../model/BigMapLayout';
import type { IBigMapConfig } from '../model/BigMapTypes';
import { BIGMAP_BATTLE_TEXT } from '../model/BigMapBattle';
// 顶栏资源数量走背包（`CmdItem` 缓存）：SLG 资源在服务端就是道具 18501~18505。
import { readItemCounts } from '../../card/ItemBag';

/**
 * 大世界入口（**唯一一处**把「配置 / 存档 / 冒险进度 / 页面」接起来的地方）。
 *
 * 为什么单独放一层：`view/BigMapPage` 只认 `BigMapPresenter`，不知道配置从哪来、冒险进度
 * 存在哪。这里做三件脏活：
 * 1. 用 `ConfigService` 读 12 张 `bigmap*` 表并解析成强类型配置；
 * 2. 用领地存档（`TerritorySaveStore`）取「冒险已通关章节」——用户要求建筑解锁**只**来自它；
 * 3. 建一个全屏节点把 `BigMapPage` 挂上去，并把「关掉自己」的回调交回去。
 *
 * 页面用 `director.getScene()` 的 Canvas 做父节点（而不是主界面 Content），
 * 这样它是一层覆盖页，切 tab 不会把大世界连带销毁。
 */
export class BigMapEntry {
    private static instance: BigMapEntry | null = null;

    private root: Node | null = null;
    private presenter: BigMapPresenter | null = null;
    /** 页面组件（开战预加载失败时要通知它撤掉「正在进入」遮罩）。 */
    private page: BigMapPage | null = null;
    private saveOwner: IBigMapSaveOwner | null = null;
    private configCache: IBigMapConfig | null = null;
    /** `undefined` = 还没加载过；`null` = 加载过但没有可用布局。两者必须区分，否则会反复读盘。 */
    private layoutCache: IBigMapLayout | null | undefined = undefined;
    private assets: AssetService | null = null;
    private opening = false;
    private openRevision = 0;
    private navigationRestore: (() => void) | null = null;
    /** 关闭回调（宿主注入；`close()` 时回调一次，用于把底栏高亮切回去）。 */
    private onCloseCallback: (() => void) | null = null;
    /** 挂进宿主页时临时把 TopHud 提到最上层，关掉时还原它原来的兄弟序号。 */
    private hudRestore: { node: Node; index: number } | null = null;

    static shared(): BigMapEntry {
        if (!BigMapEntry.instance) BigMapEntry.instance = new BigMapEntry();
        return BigMapEntry.instance;
    }

    /**
     * 由组合根（`ProcedureBootstrap`）注入资源入口。
     *
     * 不注入也能玩：布局加载降级为「按种子生成世界」。这样入口那条链
     * （`MainTabHost` 的「世界」格 → 本类）不用为了接布局改签名。
     */
    private sessionAssets: SessionAssetService | null = null;
    setSessionAssetService(service: SessionAssetService): void { this.sessionAssets = service; }

    setAssetService(assets: AssetService | null): void {
        this.assets = assets;
        this.layoutCache = undefined;
    }

    get isOpen(): boolean {
        return !!this.root && this.root.isValid;
    }

    /**
     * 打开大世界页面。重复调用不会叠两层。
     *
     * 两种挂法：
     * - **不给 `parent`**：挂 Canvas 下做全屏覆盖页（老行为，切 tab 不销毁）；
     * - **给 `parent`**：挂在宿主页里，并让出底部 `bottomInset`（2026-10-21 起主界面用它把大世界
     *   压在主城页上 —— 这样顶部 HUD 与底部菜单栏都是主界面的**真件**，不用另画一套；
     *   用户截图要求「底部沿用图片 2 的菜单栏」）。
     */
    async open(configs: ConfigService, options?: {
        parent?: Node | null;
        topInset?: number;
        bottomInset?: number;
        navigation?: Node | null;
        onClose?: (() => void) | null;
    }): Promise<void> {
        const owner = this.readSaveOwner();
        if ((this.isOpen || this.opening) && !this.isSaveOwnerCurrent(this.saveOwner)) this.close();
        if (this.isOpen || this.opening) return;
        this.opening = true;
        this.saveOwner = owner;
        const revision = ++this.openRevision;
        try {
            const config = await this.ensureConfig(configs);
            if (revision !== this.openRevision || !this.isSaveOwnerCurrent(owner)) return;
            const layout = await this.ensureLayout(config);
            if (revision !== this.openRevision || !this.isSaveOwnerCurrent(owner)) return;
            const host = options?.parent && options.parent.isValid ? options.parent : null;
            const canvas = host ? null : this.findCanvas();
            if (!host && !canvas) {
                console.warn('[BigMapEntry] 找不到 Canvas，无法打开大世界');
                return;
            }
            const size = view.getVisibleSize();
            const root = new Node('BigMapPage');
            root.layer = Layers.Enum.UI_2D;
            const transform = root.addComponent(UITransform);
            if (host) {
                // 宿主页里：宽度占满，顶部让出主界面 HUD、底部让出菜单栏，剩下的中间区域给地图。
                const hostSize = host.getComponent(UITransform)?.contentSize;
                const hostHeight = hostSize?.height || size.height;
                const hudNode = host.getChildByName('TopHud');
                const hudHeight = hudNode?.getComponent(UITransform)?.height ?? 0;
                // HUD 是「顶部对齐」的一块：它的下沿到画布顶的距离就是必须让出的高度。
                const hudBottom = hudNode ? hudNode.position.y - hudHeight / 2 : hostHeight / 2;
                const top = Math.max(Math.max(0, options?.topInset ?? 0), Math.max(0, hostHeight / 2 - hudBottom));
                const bottom = Math.max(0, options?.bottomInset ?? 0);
                const width = hostSize?.width || size.width;
                const height = Math.max(1, hostHeight - top - bottom);
                transform.setContentSize(width, height);
                root.setPosition(0, (bottom - top) / 2, 0);
                root.setParent(host);
                // 大世界要盖住主城页里的地图/入口列/宝箱栏，但**不能盖住顶部 HUD**：
                // 新节点默认是最后一个（最上层），所以把 TopHud 提到最上层，关掉时还原。
                if (hudNode) {
                    this.hudRestore = { node: hudNode, index: hudNode.getSiblingIndex() };
                    hudNode.setSiblingIndex(host.children.length - 1);
                }
            } else {
                transform.setContentSize(size.width, size.height);
                const widget = root.addComponent(Widget);
                widget.isAlignTop = true;
                widget.isAlignBottom = true;
                widget.isAlignLeft = true;
                widget.isAlignRight = true;
                widget.top = 0;
                widget.bottom = 0;
                widget.left = 0;
                widget.right = 0;
                root.setParent(canvas!);
                // 🔴 常驻 `Popup` 节点必须永远压在所有页面之上（Toast / LoadingPopup / 各类弹窗
                // 全挂它下面）。世界页是后加的，默认拿到 Canvas 的**最后一个**兄弟序号，
                // 正好把 Popup 盖住 —— 服务端回的 `CmdTips`（例如「章节尚未通关」）就弹不出来，
                // 表现为「请求发了、服务端有提示、界面一片安静」（2026-10-26 反馈）。
                // 插到 Popup 之前即可，不用改 Popup 自己的序号 —— 关页后顺序依旧正常。
                const popupRoot = canvas!.getChildByName(POPUP_ROOT_NAME);
                if (popupRoot) root.setSiblingIndex(popupRoot.getSiblingIndex());
            }

            const presenter = new BigMapPresenter({
                config,
                layout,
                storage: createBigMapStorage(owner),
                saveKey: BIGMAP_SAVE_KEY,
                // 每次取实时值：玩家在冒险里推了一章，回到大世界立刻能看到新解锁的建筑。
                adventureChapter: () => this.readAdventureChapter(owner),
                // 联机态顶栏数量从背包读（`SlgGameInfo` 没有余额字段）；
                // 离线 / 预览态没有背包，Presenter 会退回存档值。
                itemCounts: () => readItemCounts(),
                now: () => Math.floor(Date.now() / 1000),
                // 单机档：NPC 模拟榜。联机版换成走服务器的 provider，这里一行不改。
                rankProvider: new NpcBigMapRankProvider(config),
                campRepository: new BigMapCampRepository(new GameNetBigMapCampGateway()),
                startBattle: owner ? async (battleType, targetConfigId, isPresenterCurrent) => {
                    const isCurrent = (): boolean => revision === this.openRevision && root.isValid
                        && this.isSaveOwnerCurrent(owner) && isPresenterCurrent();
                    if (!isCurrent()) return { ok: false, message: BIGMAP_BATTLE_TEXT.closed };
                    this.sessionAssets?.pauseWarmup?.();
                    const battle = await startBattle(battleType, [String(targetConfigId)], root, isCurrent);
                    if (!isCurrent()) return { ok: false, message: BIGMAP_BATTLE_TEXT.closed };
                    if (!battle) return { ok: false, message: BIGMAP_BATTLE_TEXT.failed };
                    const preload = this.assets ? createZCBattlePreload(this.sessionAssets?.reusableAssets ?? this.assets,
                        configs, Promise.resolve(battle)) : undefined;
                    // 🔴 别在这里立刻 `close()`：`navigate` 是「预加载 → 进入」两阶段，
                    // 战斗资源没就绪之前当前界面一直不动。提前关掉世界页，露出来的就是
                    // 主界面的 `currentTab`（默认 tab = 领地）⇒ 玩家看到的是
                    // 「点攻打先跑回领地，等几十秒才进战斗」（2026-10-26 反馈）。
                    // 世界页挂 Canvas、不在 Main 节点下，`ProcedureMain.onLeave` 销毁不到它，
                    // 所以要自己关 —— 但必须等到流程真正切走的那一刻，见下面的落定钩子。
                    const stopSettled = ProcedureManager.onSwitchSettled((entered) => {
                        stopSettled();
                        if (entered) {
                            this.close();
                            return;
                        }
                        // 预加载失败 / 被别的切换顶掉：世界页还在，把「正在进入」撤掉让玩家重试。
                        this.page?.cancelEnteringBattle();
                    });
                    ProcedureManager.navigate(GameRoute.Battle, {
                        battle,
                        slgBattleType: battleType,
                        preload,
                        selfRoleId: owner.roleId,
                    });
                    return { ok: true, message: '' };
                } : undefined,
                slgRepository: owner ? new BigMapSlgRepository(
                    new GameNetBigMapSlgGateway(() => revision === this.openRevision && this.isSaveOwnerCurrent(owner)),
                    config, () => Math.floor(Date.now() / 1000),
                ) : undefined,
            });

            const page = root.addComponent(BigMapPage);
            root.active = false;
            const navigation = options?.navigation;
            const navigationHeight = navigation?.isValid ? navigation.getComponent(UITransform)?.height ?? 0 : 0;
            this.root = root;
            this.presenter = presenter;
            this.page = page;
            this.onCloseCallback = options?.onClose ?? null;
            // 基地写操作由 serverBaseReady 拦截；同步回包不应挡住世界浏览，更不能等到缺包超时才亮页。
            void presenter.initializeSlg().catch((error: unknown) => {
                if (revision === this.openRevision && root.isValid && this.isSaveOwnerCurrent(owner)) {
                    console.warn('[BigMapEntry] 基地信息同步失败', error);
                }
            });
            // 冒险章节集合是登录后**并行**拉的，世界页可能开在它前面 —— 那会儿建筑解锁只能按
            // 兜底的「第 1 章」算。回包到达后补一次刷新，否则通关了却建不了（2026-10-26 用户反馈）。
            if (!TerritoryChapterInfoRepository.instance.current) {
                void TerritoryChapterInfoRepository.instance.refresh().then(() => {
                    if (revision !== this.openRevision || !root.isValid || !this.isSaveOwnerCurrent(owner)) return;
                    this.presenter?.refreshUnlockContext();
                });
            }
            await page.initialize(presenter, () => this.close(), this.assets, layout?.background ?? '', navigationHeight, async (scope) => {
                const role = readRoleRow();
                if (!role || scope.disposed) return null;
                const resolver = await HeadArt.loadHeadArtResolver(configs);
                if (scope.disposed) return null;
                return HeadArt.loadHeadFrame(toIdString(role.img), (name, root) => (
                    this.assets.load(`${root}/${name}/spriteFrame`, SpriteFrame, { scope })
                ), resolver);
            });
            if (revision !== this.openRevision || !root.isValid) return;
            if (!this.isSaveOwnerCurrent(owner)) {
                this.close();
                return;
            }
            if (navigation?.isValid) this.navigationRestore = mountBigMapNavigation(navigation, root).restore;
            root.active = true;
        } catch (error) {
            if (revision === this.openRevision) this.close();
            throw error;
        } finally {
            if (revision === this.openRevision) this.opening = false;
        }
    }

    close(): void {
        this.sessionAssets?.pauseWarmup?.();
        this.openRevision += 1;
        this.opening = false;
        this.navigationRestore?.();
        this.navigationRestore = null;
        this.presenter?.dispose();
        if (this.root?.isValid) this.root.destroy();
        this.root = null;
        this.presenter = null;
        this.page = null;
        this.saveOwner = null;
        const hud = this.hudRestore;
        this.hudRestore = null;
        if (hud && hud.node.isValid) hud.node.setSiblingIndex(hud.index);
        // 关掉后通知宿主（主界面用它把底栏高亮切回真正的 tab）。
        const callback = this.onCloseCallback;
        this.onCloseCallback = null;
        callback?.();
    }

    /** 配置解析一次就够（12 张表 + 世界生成都挺贵），后续开关复用。 */
    private async ensureConfig(configs: ConfigService): Promise<IBigMapConfig> {
        if (!this.configCache) this.configCache = await loadBigMapConfig(configs);
        return this.configCache;
    }

    /**
     * 策划布局：**有就用，没有就 null**（Presenter 那边回退种子生成）。
     *
     * 结果缓存到会话结束：布局跟客户端版本一起发（`assets/resources/config/bigmap-maps/`），
     * 不会在运行期变，不必每次开页面都读一遍。
     */
    private async ensureLayout(config: IBigMapConfig): Promise<IBigMapLayout | null> {
        if (this.layoutCache !== undefined) return this.layoutCache;
        if (!this.assets) {
            console.warn('[BigMapEntry] 没有注入 AssetService，跳过布局文件，按种子生成世界');
            this.layoutCache = null;
            return null;
        }
        this.layoutCache = await loadBigMapLayout(this.assets, config);
        return this.layoutCache;
    }

    /**
     * 冒险进度（建筑 / 城池 / 野怪解锁的唯一依据）—— **服务端章节集合优先**。
     *
     * 真源是 `ChapterInfo.chapters`（`TerritoryChapterInfoRepository`）：`[1,2,3]` = 账号能进到第 3 章。
     * 「能进第 N 章」与配置里的 `unlockChapter = N` 是同一口径（第 N 章的资源田 / 科技树…），
     * 所以直接取集合里最大那一章。
     *
     * 🔴 别拿 `loadLastChapter` 当主口径（2026-10-26 用户反馈）：那个存的是「上次点开的章节」，
     * 新号 / 从没进过冒险页时恒为 1 —— 服务端明明给了 `[1,2,3]`，大地图仍按第 1 章算，
     * 粮食田（第 2 章解锁）就全是灰的。它只在服务端还没回包时兜底。
     *
     * 任何异常都退回 1，绝不让大世界因为读进度失败打不开。
     */
    private readAdventureChapter(owner: IBigMapSaveOwner | null): number {
        try {
            const repository = TerritoryChapterInfoRepository.instance;
            const serverTop = (repository.current?.chapters ?? [])
                .reduce((max, chapter) => Math.max(max, chapter), 0);
            if (serverTop > 0) return serverTop;
            // 服务端快照还没到：退回本地上次所在章节（受 `availableChapters` 限制，新号就是 1）。
            const chapters = repository.availableChapters;
            const store = createTerritorySaveStore(owner);
            return Math.max(1, store.loadLastChapter(chapters, chapters[0] ?? 1));
        } catch (error) {
            console.warn('[BigMapEntry] 读取冒险进度失败，按第 1 章处理', error);
            return 1;
        }
    }

    private readSaveOwner(): IBigMapSaveOwner | null {
        const role = readRoleRow();
        if (!role) return null;
        const roleId = toIdString(role.id).trim();
        const serverId = toIdString(role.selectServerId).trim();
        return roleId && serverId && roleId !== '0' && serverId !== '0' ? { roleId, serverId } : null;
    }

    private isSaveOwnerCurrent(owner: IBigMapSaveOwner | null): boolean {
        const current = this.readSaveOwner();
        return owner?.roleId === current?.roleId && owner?.serverId === current?.serverId;
    }

    private findCanvas(): Node | null {
        const scene = director.getScene();
        if (!scene) return null;
        return scene.getChildByName('Canvas') ?? scene.children[0] ?? null;
    }
}
