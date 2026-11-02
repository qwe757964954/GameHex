import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { RoleEvent, type IRoleIntent } from './RoleEvents';
import { ROLE_NAV_READY, isRoleBagTabReady } from './RoleTable';
import { ROLE_TEXTS } from './RoleTexts';
import type { RoleBagTabId } from './RoleTypes';

export interface IRoleControllerOptions<T> {
    readonly owner: object;
    readonly load: () => Promise<T>;
    readonly render: (snapshot: T) => Promise<void>;
    readonly showBag: (tab: RoleBagTabId) => Promise<void>;
    readonly selectBag: (tab: RoleBagTabId) => void;
    readonly openTalent: () => void;
    readonly tip: (text: string) => void;
    readonly failed: (error: unknown) => void;
}
export class RoleController<T> extends ControllerBase {
    private revision = 0;
    private selectionRevision = 0;
    private started = false;
    constructor(context: IControllerContext | (() => IControllerContext), private readonly options: IRoleControllerOptions<T>) {
        super(context, 'role');
    }
    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(RoleEvent.Intent, this.onIntent);
    }
    async refresh(): Promise<void> {
        if (this.isDisposed) return;
        const revision = ++this.revision, selection = this.selectionRevision;
        try {
            const snapshot = await this.options.load();
            if (this.isDisposed || revision !== this.revision) return;
            await this.options.render(snapshot);
            if (this.isDisposed || revision !== this.revision || selection !== this.selectionRevision) return;
            await this.selectBag(1);
        } catch (error) {
            if (!this.isDisposed && revision === this.revision) this.options.failed(error);
        }
    }
    cancel(): void { this.revision++; this.selectionRevision++; }
    private onIntent(event: IRoleIntent): void {
        if (event.owner !== this.options.owner) return;
        if (event.kind === 'bag') { void this.selectBag(event.tab); return; }
        if (event.navId === 2) { this.options.openTalent(); return; }
        if (!ROLE_NAV_READY.has(event.navId)) this.options.tip(ROLE_TEXTS.navMissing);
    }
    private async selectBag(tab: RoleBagTabId): Promise<void> {
        if (!isRoleBagTabReady(tab)) { this.options.tip(ROLE_TEXTS.bagTabMissing); return; }
        this.selectionRevision++;
        this.options.selectBag(tab);
        try { await this.options.showBag(tab); }
        catch (error) { if (!this.isDisposed) this.options.failed(error); }
    }
}
