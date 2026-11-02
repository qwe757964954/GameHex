import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { StoreEvent, type IStoreActionEvent } from './StoreEvents';

export class StoreController extends ControllerBase {
    private started = false;
    private pending = false;
    constructor(context: IControllerContext | (() => IControllerContext), private readonly owner: object,
        private readonly action: (kind: IStoreActionEvent['kind'], context: IStoreActionEvent['context']) => Promise<unknown>,
        private readonly failed: (error: unknown) => void) { super(context, 'store'); }
    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(StoreEvent.Action, this.onAction);
    }
    private async onAction(event: IStoreActionEvent): Promise<void> {
        if (event.owner !== this.owner || this.pending) return;
        this.pending = true;
        try { await this.action(event.kind, event.context); }
        catch (error) { if (!this.isDisposed) this.failed(error); }
        finally { this.pending = false; }
    }
}
