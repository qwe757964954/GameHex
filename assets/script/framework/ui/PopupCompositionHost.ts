import type { ControllerBase, IControllerContext } from '../controller/ControllerBase';
import { EventMgr } from '../event/EventMgr';

/** 外部组合层端口；framework 不知道任何具体业务控制器。 */
export interface IPopupComposition {
    open(userData: unknown): void | Promise<void>;
    dispose(): void;
}
export type IPopupCompositionFactory<T extends object> = (view: T) => IPopupComposition | null;

/** 单弹窗组合会话基类：托管控制器生命周期、输出事件隔离与关闭清理。 */
export abstract class PopupSession<
    TView extends object,
    TController extends Pick<ControllerBase, 'dispose'> & { start(): void | Promise<void> },
    TOutput,
> implements IPopupComposition {
    private controller: TController | null = null;

    constructor(
        protected readonly context: IControllerContext,
        protected readonly view: TView,
        private readonly outputEvent: string,
    ) {}

    async open(userData: unknown): Promise<void> {
        if (this.controller) {
            throw new Error('弹窗会话不可重复启动');
        }
        const controller = this.createController(userData);
        this.controller = controller;
        try {
            EventMgr.instance.on(this.outputEvent, this.dispatchOutput, this);
            await controller.start();
        } catch (error) {
            try {
                this.dispose();
            } catch (cleanupError) {
                console.error('[PopupSession] 初始化失败后的清理失败', cleanupError);
            }
            throw error;
        }
    }

    protected abstract createController(userData: unknown): TController;

    protected abstract handleOutput(output: TOutput): void;

    protected onDispose(): void {}

    private readonly dispatchOutput = (output: TOutput, source: object): void => {
        if (source !== this.controller) {
            return;
        }
        this.handleOutput(output);
    };

    dispose(): void {
        const controller = this.controller;
        this.controller = null;
        EventMgr.instance.offTarget(this);
        try {
            this.onDispose();
        } finally {
            controller?.dispose();
        }
    }
}
interface IPopupCompositionSession {
    readonly composition: IPopupComposition;
    readonly cancel: () => void;
}

/** 一次打开对应一次组合会话；关闭立即落定首屏等待，缓存节点也不复用旧业务状态。 */
export class PopupCompositionHost<T extends object> {
    private readonly sessions = new Map<T, IPopupCompositionSession>();
    private disposed = false;
    constructor(private readonly create: IPopupCompositionFactory<T>) {}
    async open(view: T, userData: unknown): Promise<boolean> {
        if (this.disposed) return false;
        this.close(view);
        const composition = this.create(view);
        if (!composition) return true;
        let cancel: () => void = () => {};
        const cancelled = new Promise<false>(resolve => { cancel = () => resolve(false); });
        const session = { composition, cancel };
        this.sessions.set(view, session);
        try {
            const ready = Promise.resolve(composition.open(userData)).then(() => this.sessions.get(view) === session);
            return await Promise.race([ready, cancelled]);
        } catch (error) {
            if (this.sessions.get(view) === session) this.close(view);
            throw error;
        }
    }
    close(view: T): void {
        const session = this.sessions.get(view);
        if (!session) return;
        this.sessions.delete(view);
        session.cancel();
        session.composition.dispose();
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const view of Array.from(this.sessions.keys())) this.close(view);
    }
}
