import { _decorator, Component, Node, Label, Color, UITransform, Canvas, Camera } from 'cc';
import { Container, injectField } from '../framework/container/Container';
import { Log } from '../framework/log/Log';
import { UpdateBeat } from '../framework/utils/UpdateBeat';
import { DemoService } from './DemoService';

const { ccclass, property } = _decorator;

/**
 * DemoMain
 * ------------------------------------------------------------------
 * CC 3.8 工程入口。两种使用方式:
 *   A. 推荐：用编辑器新建 scene → 拖 DemoMain.ts 到 Canvas 节点 → 保存
 *   B. 应急：把 DemoMain 挂到任意空 Node 上 → onLoad 时会自动构造 Canvas+Camera+DemoMain+LoginLayer
 *
 * 负责:
 *   1. 初始化 framework Container（IoC）
 *   2. 注册 demo services 并验证依赖注入（@injectField）
 *   3. 启动 LoginLayer（如果场景中不存在）
 *   4. 输出 framework 启动状态日志
 *
 * ⚠ P0 阶段只在编辑器内运行验证 framework 是否能编译/启动，不接业务
 * ------------------------------------------------------------------
 */
@ccclass('DemoMain')
export class DemoMain extends Component {

    @property({ type: Label, tooltip: '可选：用于显示 framework 启动状态的 Label' })
    statusLabel: Label | null = null;

    private _container: Container | null = null;

    onLoad() {
        console.log('[DemoMain] onLoad');

        // 应急模式：若当前节点不是 Canvas 子节点，则自动构造完整 demo 树
        this._ensureDemoTree();

        // 1. 初始化 Container
        this._container = Container.inst();
        this._container.collectObj(this, 'DemoMain');

        // 2. 注册 demo services（验证 IoC + @injectField）
        // 注意：Container 设计上 collectObj 只是缓冲，所有对象必须等 start() 才会进入 collectMap
        const demoService = new DemoService();
        this._container.collectObj(demoService, 'DemoService');

        const child = new DemoChildService();
        this._container.collectObj(child, 'DemoChildService');

        // 启动 Container（必须，否则 inject/getByAlias 都返回 undefined）
        this._container.start();

        // 此时再 inject（依赖 collectMap 已填充）
        child.inject();

        // 3. 启动 LoginLayer（如果场景中没有）
        this._ensureLoginLayer();

        // 4. 输出 framework 启动状态
        const status =
            `framework started\n` +
            `- container singleton: ${Container.inst() === this._container}\n` +
            `- DemoService injected: ${child.demoService != null}\n` +
            `- DemoService.greet(): ${demoService.greet()}`;

        console.log(status);
        Log.log(status);

        if (this.statusLabel) {
            this.statusLabel.string = status;
        }
    }

    start() {
        console.log('[DemoMain] start, frameCount:', cc.game.frameCount);
    }

    /**
     * 驱动 framework UpdateBeat（替代 cc.director 每帧调度）
     * 任何挂载在 UpdateBeat 的回调（如 Timer / FrameTimer / Cor.Update）都会在此被每帧调用
     */
    update(dt: number) {
        UpdateBeat.loop(dt);
    }

    onDestroy() {
        if (this._container) {
            this._container.destroy();
            this._container = null;
        }
    }

    /** 应急：构造 Canvas + Camera（若当前节点不在 Canvas 下） */
    private _ensureDemoTree(): void {
        let canvas: Node | null = this.node;
        // 向上找到 Canvas
        while (canvas && !canvas.getComponent(Canvas)) {
            canvas = canvas.parent;
        }

        if (canvas) {
            console.log('[DemoMain] 已找到 Canvas:', canvas.name);
            return;
        }

        // 没找到 Canvas：构造一个
        console.warn('[DemoMain] 未检测到 Canvas，自动构造 demo 树...');
        const canvasNode = new Node('AutoCanvas');
        canvasNode.addComponent(UITransform);
        canvasNode.addComponent(Canvas);

        const cameraNode = new Node('AutoCamera');
        const cam = cameraNode.addComponent(Camera);
        canvasNode.addChild(cameraNode);
        cameraNode.addComponent(UITransform);

        // 把当前 DemoMain 节点挂到 Canvas 下
        if (this.node.parent) {
            this.node.parent.addChild(canvasNode);
        }
        canvasNode.addChild(this.node);

        const canvasComp = canvasNode.getComponent(Canvas)!;
        canvasComp.cameraComponent = cam;
    }

    /** 应急：构造 LoginLayer（若场景中无 LoginLayer） */
    private _ensureLoginLayer(): void {
        if (this.node.getChildByName('LoginLayer')) return;

        console.log('[DemoMain] 未检测到 LoginLayer，自动构造...');
        const node = new Node('LoginLayer');
        node.addComponent(UITransform);
        this.node.addChild(node);

        // 动态 import 避免循环依赖
        import('./LoginLayer').then(({ LoginLayer }) => {
            node.addComponent(LoginLayer);
        });
    }
}

/**
 * DemoChildService
 * 演示 @injectField 装饰器（被 CC 3.8 @ccclass 装饰器链包裹可能失效）。
 * DemoMain 调用 inject() 后会同时尝试装饰器版 + 手动版两种注入路径，
 * 结果取并集，确保即使装饰器版失败仍能拿到 DemoService。
 */
export class DemoChildService implements destroyable {
    public static __cname: string = 'DemoChildService';

    @injectField('DemoService')
    demoService: DemoService | null = null;

    destroyed: boolean = false;

    constructor() {
        console.log('[DemoChildService] constructed');
    }

    /**
     * 双轨注入：
     *   1. 装饰器版（依赖 @injectField 元数据，CC 3.8 下可能不生效）
     *   2. 手动版（直接通过 alias 拿，100% 兼容）
     */
    inject(): void {
        // 1. 装饰器版
        Container.inst().inject(this);

        // 2. 手动版（fallback）
        if (!this.demoService) {
            const svc = Container.inst().getByAlias('DemoService');
            if (svc) {
                this.demoService = svc;
                console.log('[DemoChildService] manual inject fallback succeeded');
            }
        }
    }

    destroy(): void {
        this.destroyed = true;
        console.log('[DemoChildService] destroyed');
    }
}