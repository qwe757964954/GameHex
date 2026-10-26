import { Node, Prefab, instantiate } from 'cc';
import { LaunchProgressPage } from './LaunchProgressPage';

/**
 * 热更阶段占启动总进度的权重（0~1）：热更下载占前 60%，登录后资源加载占后 40%。
 *
 * 两个启动流程（`ProcedureUpdate` / `ProcedurePostLogin`）驱动**同一个**
 * `LaunchProgress` 节点，进度按这个权重分段，视觉上是一条连续进度条。
 */
export const LAUNCH_UPDATE_WEIGHT = 0.6;

const NODE_NAME = 'LaunchProgress';

/**
 * 启动进度 UI（热更 + 登录后资源加载共用）的封装。
 *
 * ## 为什么是 prefab（而非代码动态创建）
 *
 * 进度条是**资源化**的：`LaunchProgress.prefab` 引用登录启动图（`SplashBg`）
 * 与白色进度条图（`image/common/white.png`，轨道/填充染色），放在
 * `assets/resources/ui/loading/` —— resources 是**首包内置**，不放进远程热更
 * bundle，因此 `ProcedureUpdate` 在热更阶段（启动早期）就能 load 使用。
 * 节点挂在 `ProcedureManager` 的**常驻 host** 下，跨流程存活：
 * - `ProcedureUpdate.onEnter` → `ensure(host)` 复用或 `createFromPrefab` 创建并 `show()`；`onLeave` 只 `hide()` 不销毁；
 * - 登录页停留期间保持隐藏；
 * - `ProcedurePostLogin.onEnter` → `ensure(host)` 复用并 `show()`；`onLeave`（进入 Main）保留节点，MainRoot 已在其下渲染就绪，由 `ProcedureMain.onEnter` 调 `release()` 销毁登录图。
 * 不是全局单例：实例由各流程字段持有，`ensure` 只按 host 下节点名复用。
 */
export class LaunchProgressUI {
    readonly node: Node;

    private readonly page: LaunchProgressPage;

    /** 取 host 下已存在的启动 UI；不存在返回 null（由调用方决定创建）。 */
    static ensure(host: Node): LaunchProgressUI | null {
        const existed = host.getChildByName(NODE_NAME);
        if (!existed) return null;
        const page = existed.getComponent(LaunchProgressPage);
        if (!page) {
            // 半成品/异常节点（缺组件）不能复用，销毁留给调用方重建。
            existed.destroy();
            return null;
        }
        return new LaunchProgressUI(existed, page);
    }

    /** 实例化首包 prefab 并挂到 host 下。组件缺失视为构建失败（销毁节点返回 null）。 */
    static createFromPrefab(prefab: Prefab, host: Node): LaunchProgressUI | null {
        const node = instantiate(prefab);
        node.setParent(host);
        node.setPosition(0, 0, 0);
        const page = node.getComponent(LaunchProgressPage);
        if (!page) {
            console.error('[LaunchProgressUI] LaunchProgress.prefab 缺少 LaunchProgressPage 组件');
            node.destroy();
            return null;
        }
        return new LaunchProgressUI(node, page);
    }

    private constructor(node: Node, page: LaunchProgressPage) {
        this.node = node;
        this.page = page;
    }

    setStatus(message: string): void {
        this.page.setStatus(message);
    }

    /** 当前进度（0~1，读填充条 fillRange）；热更流程用它把进度续接给登录后加载。 */
    get currentRatio(): number {
        return this.page.progressFill ? this.page.progressFill.fillRange : 0;
    }

    setProgress(ratio: number | null): void {
        this.page.setProgress(ratio);
    }

    /** 登录页期间隐藏（热更结束进入登录不销毁，留给登录后加载复用）。 */
    hide(): void {
        this.node.active = false;
    }

    show(): void {
        this.node.active = true;
    }

    /** 使命结束（进入 Main）后销毁：登录图移除，露出其下已渲染好的 MainRoot。 */
    release(): void {
        this.node.destroy();
    }
}
