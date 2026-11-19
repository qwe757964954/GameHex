import { Director, director, Node, Prefab, instantiate } from 'cc';
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
 * 节点 → 它实例化用的 prefab。
 *
 * ⚠️ 这张表是**引用计数的一部分**，不是缓存：启动 UI 的节点跨流程存活
 * （`ProcedureUpdate.onLeave` / `PostLoginComposition.leave` 都只 `hide()` 不销毁），
 * 而 prefab 的加载引用挂在**流程的 preload 作用域**上，`onLeave` 的
 * `releaseResourceScope()` 会把它和依赖图（`bar_white` 等）一起 decRef 到 0 ⇒
 * 节点明明还 `active`，两个 Sprite 却挂着已 destroy 的帧，`Batcher2D` 每帧崩
 * `frame should not be invalid, it may have been released` → `getGFXTexture` 空指针。
 *
 * 所以实例化时 `addRef()` 一次，节点真正销毁后（`release()`）再 `decRef()`：
 * 谁持有节点，谁就持有 prefab。
 */
const nodePrefabs = new WeakMap<Node, Prefab>();

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
            releaseNodePrefab(existed);
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
        // 节点跨流程存活（onLeave 只 hide），prefab 的加载引用却挂在流程的 preload 作用域上：
        // 不自己持有的话，`releaseResourceScope()` 会把它连同 `bar_white` 一起 decRef 到 0。
        prefab.addRef();
        nodePrefabs.set(node, prefab);
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
        if (!this.node || !this.node.isValid) return;
        this.node.destroy();
        releaseNodePrefab(this.node);
    }
}

/**
 * 还回 `createFromPrefab` 借的那份 prefab 引用。
 *
 * 必须等 `EVENT_AFTER_DRAW`：`node.destroy()` 只是标记，真正销毁在帧末，这一帧还要画；
 * 立刻 `decRef` 会把贴图从正在提交的渲染里抽走（与 `CocosAssetService.releaseAfterDraw` 同一条口径）。
 */
function releaseNodePrefab(node: Node): void {
    const prefab = nodePrefabs.get(node);
    if (!prefab) return;
    nodePrefabs.delete(node);
    if (!prefab.isValid) return;
    if (!Director || typeof director?.once !== 'function') {
        prefab.decRef();
        return;
    }
    director.once(Director.EVENT_AFTER_DRAW, () => {
        if (prefab.isValid) prefab.decRef();
    });
}
