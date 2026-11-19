import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { StoreEvent, type IStoreActionEvent } from './StoreEvents';
import type { StoreActionKind, IStoreActionContext, IStoreRequestScope } from './StoreActions';

export class StoreController extends ControllerBase {
    private started = false;
    private pending = false;
    private readonly requestOwner: object;
    private readonly canSend: () => boolean;
    constructor(context: IControllerContext | (() => IControllerContext), private readonly owner: object,
        private readonly action: (kind: StoreActionKind, context: IStoreActionContext, request?: IStoreRequestScope) => Promise<unknown>,
        private readonly failed: (error: unknown) => void,
        requestOwner?: object, canSend?: () => boolean) {
        super(context, 'store');
        this.requestOwner = requestOwner ?? this;
        this.canSend = canSend ?? (() => !this.isDisposed);
    }
    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(StoreEvent.Action, this.onAction);
    }
    private async onAction(event: IStoreActionEvent): Promise<void> {
        if (event.owner !== this.owner || this.pending) return;
        this.pending = true;
        try {
            await this.action(event.kind, event.context, {
                caller: this.requestOwner,
                canSend: () => !this.isDisposed && this.canSend(),
            });
        }
        catch (error) { if (!this.isDisposed) this.failed(error); }
        finally { this.pending = false; }
    }
}
