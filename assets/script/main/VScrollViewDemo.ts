/**
 * VScrollViewDemo
 * ------------------------------------------------------------------
 * 验证 VScrollView（soidaken 替代 FGUI GList）能否在 Demo3.8 (CC 3.8.8) 上跑起来。
 *
 * 推荐用法（编辑器手动模式，最贴近 P1 业务层）：
 *   1. 把 VSListTemplate_V.prefab 拖入场景任意父节点下 → 自动创建一个完整的
 *      滚动列表节点（节点名 VSListTemplate_V，自带 VScrollView + content + item 模板）
 *   2. 在 Hierarchy 创建一个空节点 "Demo"，挂 VScrollViewDemo
 *   3. 把 VScrollViewDemo.ts 的 vlist 字段拖入 VSListTemplate_V 节点
 *   4. 跑场景 → 看到 50 条"重要通知"垂直列表，可滚动、可点击、入场有缩放回弹
 *
 * 自启动模式（开箱即跑）：
 *   - 如果 vlist 字段没挂，自动从 resources/ 加载 VSListTemplate_V.prefab，
 *     instantiate 到 Canvas 下，绑回调，自动刷数据。
 *   - 用法：随便建一个空场景，创建一个空节点 "Demo" 挂 VScrollViewDemo，直接跑。
 *
 * 资源路径：VSListTemplate_V.prefab 必须放在 assets/resources/ui/vscroll/ 下，
 *          demo 用 resources.load('ui/vscroll/VSListTemplate_V', Prefab) 加载。
 *          CC 3.x 只有 resources/ 下的资产可以动态加载，main bundle 不行。
 * ------------------------------------------------------------------
 */
import {
    _decorator,
    Camera,
    Canvas,
    Component,
    Label,
    Node,
    Prefab,
    Tween,
    UITransform,
    Vec3,
    instantiate,
    resources,
    tween,
} from 'cc';
// 注：soidaken/VScrollView 里的类名是 VirtualScrollView（不是 VScrollView），
// 类注册名（@ccclass('VirtualScrollView')）就是这个。
// 路径注意：vscrollview/ 在 assets/script/ 下，与 assets/script/main/ 平级，
// 所以从 script/main/ 走 ../ 出 1 层就能到
import { VirtualScrollView } from '../vscrollview/VScrollView';

const { ccclass, property } = _decorator;

interface NotifyItem {
    title: string;
    time: string;
}

/** VSListTemplate_V.prefab 的相对位置（assets/resources/ 下） */
const TEMPLATE_URL = 'ui/vscroll/VSListTemplate_V';

@ccclass('VScrollViewDemo')
export class VScrollViewDemo extends Component {

    /** 把场景里 VSListTemplate_V 节点（带 VScrollView 组件）拖到这 */
    @property(VirtualScrollView)
    vlist: VirtualScrollView | null = null;

    private data: NotifyItem[] = [];

    onLoad() {
        // 生成 50 条测试数据
        this.data = Array.from({ length: 50 }, (_, i) => ({
            title: `重要通知 ${i + 1}`,
            time: `2026.09.${(i % 30) + 1}`,
        }));

        if (this.vlist) {
            // 手动模式：直接绑回调 + 刷数据
            this.bindVlistCallbacks();
            this.vlist.refreshList(this.data);
            console.log('[VScrollViewDemo] 手动模式启动');
        } else {
            // 自启动模式：异步加载 prefab + instantiate
            this.tryAutoBootstrap();
        }
    }

    /**
     * 自启动：异步加载 VSListTemplate_V.prefab，instantiate 到自己下面，
     * 拿到上面的 VirtualScrollView 组件，绑回调 + 刷数据。
     */
    private tryAutoBootstrap() {
        this.loadTemplatePrefab((prefab) => {
            if (!prefab) return;

            // 确保场景里有 Canvas
            const canvas = this.ensureCanvas();
            if (!canvas) {
                console.warn('[VScrollViewDemo] 自启动失败：Canvas 构造未成功');
                return;
            }

            // instantiate 整个 prefab 到 Canvas 下
            const listNode = instantiate(prefab);
            listNode.setParent(canvas);
            listNode.setPosition(0, 0, 0);
            listNode.name = 'VSListTemplate_V';

            // 拿 VScrollView 组件
            const vlist = listNode.getComponent(VirtualScrollView);
            if (!vlist) {
                console.error('[VScrollViewDemo] prefab 上找不到 VirtualScrollView 组件');
                return;
            }
            this.vlist = vlist;

            this.bindVlistCallbacks();
            vlist.refreshList(this.data);
            console.log('[VScrollViewDemo] 自启动完成，列表已渲染');
        });
    }

    /**
     * 异步加载 prefab。从 CC 3.x 的 resources/ 专用 bundle 加载，
     * 这是 CC 3.x 唯一允许运行时动态加载非场景引用资源的机制。
     */
    private loadTemplatePrefab(cb: (prefab: Prefab | null) => void) {
        resources.load(TEMPLATE_URL, Prefab, (err: Error | null, prefab: Prefab) => {
            if (err || !prefab) {
                console.error(
                    `[VScrollViewDemo] 从 resources/ 加载 ${TEMPLATE_URL} 失败:`, err,
                    `\n请确认 assets/resources/ui/vscroll/VSListTemplate_V.prefab 存在。`
                );
                cb(null);
                return;
            }
            cb(prefab);
        });
    }

    /**
     * 确保场景里有 Canvas + Camera
     */
    private ensureCanvas(): Node | null {
        // 沿父链向上找现有 Canvas
        let canvas: Node | null = this.node;
        while (canvas && canvas.getComponent(Canvas) == null) {
            canvas = canvas.parent;
        }
        if (canvas) return canvas;

        // 否则构造一个新的 Canvas 节点作为当前节点的兄弟
        const canvasNode = new Node('Canvas');
        canvasNode.setParent(this.node.parent || this.node);
        canvasNode.addComponent(UITransform);
        canvasNode.addComponent(Canvas);

        const camNode = new Node('Camera');
        camNode.setParent(canvasNode);
        camNode.addComponent(Camera);
        console.log('[VScrollViewDemo] 自启动：构造 Canvas + Camera');

        return canvasNode;
    }

    /**
     * 绑定 VScrollView 回调
     * --------------------------------------------------------------
     * VSListTemplate_V 的节点结构：
     *   VSListTemplate_V (VScrollView 组件)
     *     content
     *       item (模板节点，renderItemFn / onItemClickFn 收到的就是它)
     *         icon
     *         title (Label)
     *         time (Label)
     */
    private bindVlistCallbacks() {
        if (!this.vlist) return;

        // 渲染回调：把数据写进 item 子节点的 Label
        this.vlist.renderItemFn = (itemNode: Node, index: number) => {
            const item = this.data[index];
            if (!item) return;
            const titleLabel = itemNode.getChildByName('title')?.getComponent(Label);
            const timeLabel = itemNode.getChildByName('time')?.getComponent(Label);
            if (titleLabel) titleLabel.string = item.title;
            if (timeLabel) timeLabel.string = item.time;
        };

        // 点击回调
        this.vlist.onItemClickFn = (_itemNode: Node, index: number) => {
            const item = this.data[index];
            if (item) {
                console.log(`[VScrollViewDemo] click item ${index + 1}: ${item.title}`);
            }
        };

        // 入场动画：子项刚进入可视区时缩放回弹
        this.vlist.onItemEdgeEnterFn = (itemNode: Node, _index: number) => {
            Tween.stopAllByTarget(itemNode);
            itemNode.setScale(new Vec3(0.6, 0.6, 1));
            tween(itemNode)
                .to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                .start();
        };
    }

    // ============================================================
    // 公开 API（P1 业务层会用）
    // ============================================================

    /** 模拟新数据到达时刷新列表 */
    public appendNewItem(title: string) {
        this.data.push({
            title,
            time: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
        });
        this.vlist?.refreshList(this.data);
    }

    /** 滚动到底部 */
    public scrollToBottom() {
        this.vlist?.scrollToBottom(true);
    }

    /** 滚动到指定 index */
    public scrollToIndex(idx: number) {
        this.vlist?.scrollToIndex(idx, true);
    }
}