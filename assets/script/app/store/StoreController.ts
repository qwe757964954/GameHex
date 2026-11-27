import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { StoreEvent, type IStoreActionEvent, type StoreOutput } from './StoreEvents';
import type { StoreActionKind, IStoreActionContext, IStoreRequestScope } from './StoreActions';

export interface IStoreControllerOptions {
    readonly owner: object;
    readonly action: (kind: StoreActionKind, context: IStoreActionContext, request?: IStoreRequestScope) => Promise<unknown>;
    readonly requestOwner?: object;
    readonly canSend?: () => boolean;
}

export class StoreController extends ControllerBase {
    private pending = false;
    private readonly requestOwner: object;
    private readonly canSend: () => boolean;

    constructor(context: IControllerContext | (() => IControllerContext), private readonly options: IStoreControllerOptions) {
        super(context, 'store');
        this.requestOwner = options.requestOwner ?? this;
        this.canSend = options.canSend ?? (() => !this.isDisposed);
    }

    start(): void {
        this.listen(StoreEvent.Action, this.onAction);
    }

    private async onAction(event: IStoreActionEvent, source: object): Promise<void> {
        if (source !== this.options.owner || this.pending) return;
        this.pending = true;
        try {
            await this.options.action(event.kind, event.context, {
                caller: this.requestOwner,
                canSend: () => !this.isDisposed && this.canSend(),
            });
        } catch (error) {
            if (!this.isDisposed) {
                EventMgr.instance.emit(StoreEvent.Output, { kind: 'failed', error } satisfies StoreOutput, this);
            }
        } finally {
            this.pending = false;
        }
    }
}
