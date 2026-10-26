import type { SessionAssetService } from '../../../core/asset/SessionAssetService';
import { createZCBattlePreload } from '../../zcds/application/ZCBattlePreparation';
import { director, Layers, Node, SpriteFrame, UITransform, view, Widget } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import type { ConfigService } from '../../../core/config/ConfigService';
import { GameRoute } from '../../../core/runtime/GameRoute';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
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
            }

            const presenter = new BigMapPresenter({
                config,
                layout,
                storage: createBigMapStorage(owner),
                saveKey: BIGMAP_SAVE_KEY,
                // 每次取实时值：玩家在冒险里推了一章，回到大世界立刻能看到新解锁的建筑。
                adventureChapter: () => this.readAdventureChapter(owner),
                now: () => Math.floor(Date.now() / 1000),
                // 单机档：NPC 模拟榜。联机版换成走服务器的 provider，这里一行不改。
                rankProvider: new NpcBigMapRankProvider(config),
                campRepository: new BigMapCampRepository(new GameNetBigMapCampGateway()),
                startBattle: owner ? async (battleType, targetConfigId, isPresenterCurrent) => {
                    const isCurrent = (): boolean => revision === this.openRevision && root.isValid
                        && this.isSaveOwnerCurrent(owner) && isPresenterCurrent();
                    if (!isCurrent()) return { ok: false, message: BIGMAP_BATTLE_TEXT.closed };
                    void this.sessionAssets?.warmupBattle?.();
                    const battle = await startBattle(battleType, [String(targetConfigId)], root, isCurrent);
                    if (!isCurrent()) return { ok: false, message: BIGMAP_BATTLE_TEXT.closed };
                    if (!battle) return { ok: false, message: BIGMAP_BATTLE_TEXT.failed };
                    const preload = this.assets ? createZCBattlePreload(this.sessionAssets?.reusableAssets ?? this.assets,
                        configs, Promise.resolve(battle)) : undefined;
                    ProcedureManager.navigate(GameRoute.Battle, {
                        battle,
                        slgBattleType: battleType,
                        preload,
                        selfRoleId: owner.roleId,
                    });
                    this.close();
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
            this.onCloseCallback = options?.onClose ?? null;
            // 基地写操作由 serverBaseReady 拦截；同步回包不应挡住世界浏览，更不能等到缺包超时才亮页。
            void presenter.initializeSlg().catch((error: unknown) => {
                if (revision === this.openRevision && root.isValid && this.isSaveOwnerCurrent(owner)) {
                    console.warn('[BigMapEntry] 基地信息同步失败', error);
                }
            });
            await page.initialize(presenter, () => this.close(), this.assets, layout?.background ?? '', navigationHeight, async (scope) => {
                const role = readRoleRow();
                if (!role || scope.disposed) return null;
                const resolver = await HeadArt.loadHeadArtResolver(configs);
                if (scope.disposed) return null;
                return HeadArt.loadHeadFrame(toIdString(role.img), (name, root) => (
                    this.assets.load(`${root}/${name}/spriteFrame`, SpriteFrame, { scope })
                ), resolver);
            }, (isOpen) => {
                if (revision !== this.openRevision || !root.isValid) return;
                if (isOpen) void this.sessionAssets?.warmupBattle?.();
                else this.sessionAssets?.pauseWarmup?.();
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
     * 冒险已通关章节数。
     *
     * `TerritorySaveStore.loadLastChapter` 存的是「玩家当前所在章节」，口径沿用为
     * 「已通关到第 N 章」——新号是 1，正好对上「第 1 章解锁主城」。
     * 任何异常都退回 1，绝不让大世界因为读存档失败打不开。
     */
    private readAdventureChapter(owner: IBigMapSaveOwner | null): number {
        try {
            const chapters = TerritoryChapterInfoRepository.instance.availableChapters;
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
