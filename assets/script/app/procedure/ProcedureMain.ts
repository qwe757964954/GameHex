import { instantiate, Node, Prefab, Vec3 } from 'cc';
import { ProcedureBase } from '../../framework/procedure/ProcedureBase';
import type { ProcedurePreloadContext } from '../../framework/procedure/ProcedureBase';
import { MainTab, MainTabHost } from '../main/MainTabHost';

const MAIN_ROOT_URL = 'ui/main/MainRoot';

interface MainEntryParams {
    readonly onProgress?: (ratio: number, message: string) => void;
    readonly onError?: (message: string) => void;
    readonly initialTab?: number | 'adventure';
}

/**
 * 主界面流程。
 *
 * 生命周期：
 *   onPreload  异步预加载 MainRoot 预制体（含 MainPage 组件及其 @property 绑定）
 *   onEnter    实例化 MainRoot 挂到 host 节点下
 *   onLeave    销毁主界面节点
 *
 * MainPage 点击「开始游戏」后按 GameRoute 进入匹配流程。
 */
export class ProcedureMain extends ProcedureBase {
    public static __cname: string = 'ProcedureMain';

    /** 预加载得到的 MainRoot 预制体（缓存，重进主界面时复用）。 */
    private mainPrefab: Prefab | null = null;

    /** 当前主界面节点实例（切出时销毁）。 */
    private mainNode: Node | null = null;

    async onPreload(params?: MainEntryParams, context?: ProcedurePreloadContext): Promise<void> {
        if (this.mainPrefab) {
            params?.onProgress?.(1, '主界面已就绪');
            return;
        }
        params?.onProgress?.(0, '正在加载主界面…');
        try {
            const prefab = await this.assets.load(MAIN_ROOT_URL, Prefab, { scope: context?.resources });
            if (context?.cancelled) return;
            this.mainPrefab = prefab;
            params?.onProgress?.(1, '主界面加载完成');
            this.log('MainRoot 预加载完成');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            params?.onError?.(`主界面加载失败：${message}`);
            throw error;
        }
    }

    onEnter(params?: MainEntryParams): void {
        if (!this.mainPrefab) {
            this.error('MainRoot 尚未预加载，无法进入主界面流程');
            return;
        }
        this.mainNode = instantiate(this.mainPrefab);
        const tabHost = this.mainNode.getComponent(MainTabHost);
        // 资源入口转交给 tab 宿主：tab 页是它实例化出来的 prefab，拿不到流程依赖
        // （领地页的地图 JSON 与美术走 `AssetService`）。必须在 setParent 之前 —— 那会触发页面的 onLoad。
        tabHost?.setAssetService(this.assets);
        // 配置入口也给一份：大世界入口要读 `BigMap-*` 表（同样必须在 setParent 之前）。
        tabHost?.setConfigService(this.configs);
        if (tabHost && params?.initialTab !== undefined) {
            tabHost.defaultTab = params.initialTab === 'adventure' ? MainTab.Adventure : params.initialTab;
        }
        this.mainNode.setParent(this.host);
        this.mainNode.setPosition(Vec3.ZERO);
        this.log('进入主界面流程');
    }

    onPreloadCancelled(): void {
        this.mainPrefab = null;
    }

    onLeave(): void {
        if (this.mainNode) {
            this.mainNode.destroy();
            this.mainNode = null;
        }
        this.mainPrefab = null;
        this.releaseResourceScope();
        this.log('离开主界面流程');
    }
}
