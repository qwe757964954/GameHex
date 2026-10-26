import { instantiate, Node, Prefab, Vec3 } from 'cc';
import { ProcedureBase } from '../../framework/procedure/ProcedureBase';
import type { ProcedurePreloadContext } from '../../framework/procedure/ProcedureBase';
import { LaunchProgressUI } from '../loading/LaunchProgressUI';
import { MainTab, MainTabHost } from '../main/MainTabHost';

const MAIN_ROOT_URL = 'ui/main/MainRoot';
/** MainRoot prefab 加载完成的进度节点（其余进度在主城首屏渲染完成后一次到 1）。 */
const MAIN_ROOT_PROGRESS = 0.3;

interface MainEntryParams {
    readonly onProgress?: (ratio: number, message: string) => void;
    readonly onError?: (message: string) => void;
    readonly initialTab?: number | 'territory' | 'world';
}

/**
 * 主界面流程。
 *
 * 生命周期：
 *   onPreload  登录预加载阶段就加载并实例化 MainRoot，挂到常驻 host、置于登录图（LaunchProgress）之下，
 *              等待主城页在登录图下完成真实首帧渲染，保证登录图移除时屏幕上直接是完整主城。
 *   onEnter    仅移除登录图（登录流程的节点），不做任何挂载/渲染，因此没有遮挡或干等。
 *   onLeave    销毁主界面节点。
 *
 * MainPage 点击「开始游戏」后按 GameRoute 进入匹配流程。
 */
export class ProcedureMain extends ProcedureBase {
    public static __cname: string = 'ProcedureMain';

    /** 预加载得到的 MainRoot 预制体。 */
    private mainPrefab: Prefab | null = null;

    /** 当前主界面节点实例（登录预加载阶段提前挂载，切出时销毁）。 */
    private mainNode: Node | null = null;

    async onPreload(params?: MainEntryParams, context?: ProcedurePreloadContext): Promise<void> {
        if (this.mainNode) {
            params?.onProgress?.(1, '主界面已就绪');
            return;
        }
        params?.onProgress?.(0, '正在加载主界面…');
        try {
            const prefab = await this.assets.load(MAIN_ROOT_URL, Prefab, { scope: context?.resources });
            if (context?.cancelled) return;
            this.mainPrefab = prefab;
            params?.onProgress?.(MAIN_ROOT_PROGRESS, '正在准备主城…');

            const node = instantiate(prefab);
            const tabHost = node.getComponent(MainTabHost);
            tabHost?.setAssetService(this.assets);
            tabHost?.setConfigService(this.configs);
            tabHost?.setSessionAssetService(this.sessionAssets);
            if (tabHost && params?.initialTab !== undefined) {
                // 章节战斗结束回到主城地图；领地已成为底部主 tab。
                tabHost.defaultTab = params.initialTab === 'territory' ? MainTab.Territory
                    : params.initialTab === 'world' ? MainTab.World : params.initialTab;
            }
            this.mainNode = node;
            node.setParent(this.host);
            node.setPosition(Vec3.ZERO);
            // MainRoot 后挂载会渲染在登录图之上，把登录图重新置顶盖住，主城在其下完成首帧渲染。
            const launchCover = LaunchProgressUI.ensure(this.host);
            if (launchCover && this.host) {
                launchCover.node.setSiblingIndex(this.host.children.length - 1);
            }
            // 等待主城在登录图下真实渲染就绪；ready 信号丢失时由宿主 8s 兜底 resolve。
            if (tabHost) await tabHost.whenFirstScreenReady;
            if (context?.cancelled) {
                this.destroyMainNode();
                return;
            }
            params?.onProgress?.(1, '主界面加载完成');
            this.log('MainRoot 登录预加载阶段已挂载并就绪');
        } catch (error) {
            this.destroyMainNode();
            const message = error instanceof Error ? error.message : String(error);
            params?.onError?.(`主界面加载失败：${message}`);
            throw error;
        }
    }

    onEnter(): void {
        // 主城已在登录图下渲染好，直接移除登录图，屏幕上即完整主城（无遮挡、无干等）。
        LaunchProgressUI.ensure(this.host)?.release();
        this.log('进入主界面流程');
    }

    /** 销毁主界面节点并清空加载引用（取消/离开/失败兜底）。 */
    private destroyMainNode(): void {
        if (this.mainNode) {
            this.mainNode.destroy();
            this.mainNode = null;
        }
        this.mainPrefab = null;
    }

    onPreloadCancelled(): void {
        this.destroyMainNode();
    }

    onLeave(): void {
        this.destroyMainNode();
        this.releaseResourceScope();
        this.log('离开主界面流程');
    }
}
