import { director, Layers, Node, UITransform, view, Widget } from 'cc';
import type { ConfigService } from '../../../core/config/ConfigService';
import { readRoleRow } from '../../main/MainResBar';
import { toIdString } from '../../net/RequestGuard';
import { TerritoryChapterInfoRepository } from '../../territory/application/TerritoryChapterInfoRepository';
import { createTerritorySaveStore } from '../../territory/application/TerritorySaveStoreAdapter';
import type { ITerritorySaveOwner } from '../../territory/model/TerritorySaveStore';
import { loadBigMapConfig } from './BigMapConfigLoader';
import { BigMapPresenter } from './BigMapPresenter';
import { BIGMAP_SAVE_KEY } from './BigMapSaveKeys';
import { createBigMapStorage } from './BigMapStorage';
import { BigMapPage } from '../view/BigMapPage';
import type { IBigMapConfig } from '../model/BigMapTypes';

/**
 * 大世界入口（**唯一一处**把「配置 / 存档 / 冒险进度 / 页面」接起来的地方）。
 *
 * 为什么单独放一层：`view/BigMapPage` 只认 `BigMapPresenter`，不知道配置从哪来、冒险进度
 * 存在哪。这里做三件脏活：
 * 1. 用 `ConfigService` 读 12 张 `BigMap-*` 表并解析成强类型配置；
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
    private configCache: IBigMapConfig | null = null;
    private opening = false;

    static shared(): BigMapEntry {
        if (!BigMapEntry.instance) BigMapEntry.instance = new BigMapEntry();
        return BigMapEntry.instance;
    }

    get isOpen(): boolean {
        return !!this.root && this.root.isValid;
    }

    /** 打开大世界覆盖页。重复调用不会叠两层。 */
    async open(configs: ConfigService): Promise<void> {
        if (this.isOpen || this.opening) return;
        this.opening = true;
        try {
            const config = await this.ensureConfig(configs);
            const canvas = this.findCanvas();
            if (!canvas) {
                console.warn('[BigMapEntry] 找不到 Canvas，无法打开大世界');
                return;
            }
            const size = view.getVisibleSize();
            const root = new Node('BigMapPage');
            root.layer = Layers.Enum.UI_2D;
            const transform = root.addComponent(UITransform);
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
            root.setParent(canvas);

            const presenter = new BigMapPresenter({
                config,
                storage: createBigMapStorage(),
                saveKey: BIGMAP_SAVE_KEY,
                // 每次取实时值：玩家在冒险里推了一章，回到大世界立刻能看到新解锁的建筑。
                adventureChapter: () => this.readAdventureChapter(),
                now: () => Math.floor(Date.now() / 1000),
            });

            const page = root.addComponent(BigMapPage);
            page.initialize(presenter, () => this.close());
            this.root = root;
            this.presenter = presenter;
        } finally {
            this.opening = false;
        }
    }

    close(): void {
        if (this.root?.isValid) this.root.destroy();
        this.root = null;
        this.presenter = null;
    }

    /** 配置解析一次就够（12 张表 + 世界生成都挺贵），后续开关复用。 */
    private async ensureConfig(configs: ConfigService): Promise<IBigMapConfig> {
        if (!this.configCache) this.configCache = await loadBigMapConfig(configs);
        return this.configCache;
    }

    /**
     * 冒险已通关章节数。
     *
     * `TerritorySaveStore.loadLastChapter` 存的是「玩家当前所在章节」，口径沿用为
     * 「已通关到第 N 章」——新号是 1，正好对上「第 1 章解锁主城」。
     * 任何异常都退回 1，绝不让大世界因为读存档失败打不开。
     */
    private readAdventureChapter(): number {
        try {
            const role = readRoleRow();
            const owner: ITerritorySaveOwner | null = role ? {
                roleId: toIdString(role.id),
                serverId: toIdString(role.selectServerId),
            } : null;
            const chapters = TerritoryChapterInfoRepository.instance.availableChapters;
            const store = createTerritorySaveStore(owner);
            return Math.max(1, store.loadLastChapter(chapters, chapters[0] ?? 1));
        } catch (error) {
            console.warn('[BigMapEntry] 读取冒险进度失败，按第 1 章处理', error);
            return 1;
        }
    }

    private findCanvas(): Node | null {
        const scene = director.getScene();
        if (!scene) return null;
        return scene.getChildByName('Canvas') ?? scene.children[0] ?? null;
    }
}
