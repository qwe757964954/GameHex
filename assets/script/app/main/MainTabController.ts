import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { ResourceScope } from '../../core/asset/ResourceScope';
import type { AssetType } from '../../core/asset/AssetService';
import { MainTab, MainTabModel, mainTabTarget } from './MainTabModel';
import { MainTabEvent, type IMainTabSelectEvent } from './MainTabEvents';

export interface IMainTabControllerOptions<T> {
    readonly owner: object;
    readonly assetType: AssetType<T>;
    readonly failed: (tab: number, error: unknown) => void;
    readonly view: {
        readonly showPage: (page: T) => void;
        readonly renderNav: (tab: number) => void;
    };
    readonly world: {
        readonly openWorld: () => Promise<void>;
        readonly closeWorld: () => void;
        readonly isWorldOpen: () => boolean;
    };
    readonly warmup: {
        readonly beforeSwitch: () => void;
        readonly settled: () => void;
    };
    readonly hero: {
        readonly prefetchHero: () => void;
    };
    readonly telemetry: {
        readonly reportClick: (tab: number) => void;
    };
}

export class MainTabController<T> extends ControllerBase {
    private readonly model = new MainTabModel();
    private pageScope: ResourceScope | null = null;
    private pendingScope: ResourceScope | null = null;
    private loading: Promise<void> | null = null;
    private started = false;

    constructor(context: IControllerContext | (() => IControllerContext), private readonly options: IMainTabControllerOptions<T>) {
        super(context, 'main-tab-controller');
    }
    get snapshot() { return this.model.snapshot; }

    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(MainTabEvent.Select, this.onSelect);
    }
    private onSelect(event: IMainTabSelectEvent): void {
        if (event.owner !== this.options.owner) return;
        const target = mainTabTarget(event.tab);
        if (!target || target.kind === 'locked') return;
        if (event.source !== 'route') this.options.telemetry.reportClick(event.tab);
        void this.switchTab(event.tab);
    }

    switchTab(tab: number): Promise<void> {
        if (this.isDisposed) return Promise.resolve();
        const target = mainTabTarget(tab);
        if (!target || target.kind === 'locked') return Promise.resolve();
        if (tab === this.snapshot.loadingTab && this.loading) return this.loading;
        if (target.kind === 'overlay' && this.options.world.isWorldOpen()) return Promise.resolve();

        this.options.warmup.beforeSwitch();
        this.pendingScope?.dispose();
        this.pendingScope = null;
        const revision = this.model.begin(tab);
        this.loading = null;
        if (target.kind === 'page') {
            const wasWorldVisible = this.snapshot.worldVisible;
            this.model.showWorld(false);
            this.options.world.closeWorld();
            if (wasWorldVisible) this.options.view.renderNav(this.snapshot.currentTab);
            if (tab === this.snapshot.currentTab) {
                this.model.settle();
                this.options.view.renderNav(tab);
                this.options.warmup.settled();
                return Promise.resolve();
            }
            if (tab === MainTab.Hero) this.options.hero.prefetchHero();
            const scope = new ResourceScope(`main-tab:${tab}`);
            this.pendingScope = scope;
            this.loading = this.loadPage(tab, target.path, target.bundle, scope, revision);
        } else {
            this.model.showWorld(true);
            this.options.view.renderNav(MainTab.World);
            this.loading = this.openWorld(revision);
        }
        return this.loading;
    }

    private current(revision: number): boolean { return !this.isDisposed && revision === this.snapshot.revision; }

    private async loadPage(tab: number, path: string, bundle: string | undefined, scope: ResourceScope, revision: number): Promise<void> {
        let adopted = false;
        try {
            const page = await this.resources.assets.load(path, this.options.assetType, { scope, bundle });
            if (!this.current(revision) || scope.disposed) return;
            this.options.view.showPage(page);
            const previous = this.pageScope;
            this.pageScope = scope;
            adopted = true;
            previous?.dispose();
            this.model.commit(tab);
            this.options.view.renderNav(tab);
        } catch (error) {
            if (this.current(revision)) this.options.failed(tab, error);
        } finally {
            if (!adopted) scope.dispose();
            if (this.pendingScope === scope) this.pendingScope = null;
            this.finish(revision);
        }
    }

    private async openWorld(revision: number): Promise<void> {
        try { await this.options.world.openWorld(); }
        catch (error) {
            if (this.current(revision)) {
                this.model.showWorld(false);
                this.options.view.renderNav(this.snapshot.currentTab);
                this.options.failed(MainTab.World, error);
            }
        } finally { this.finish(revision); }
    }
    worldClosed(): void {
        if (this.isDisposed || !this.snapshot.worldVisible) return;
        this.model.showWorld(false);
        this.options.view.renderNav(this.snapshot.currentTab);
        if (this.snapshot.loadingTab === -1) this.options.warmup.settled();
    }
    private finish(revision: number): void {
        if (!this.current(revision)) return;
        this.loading = null;
        this.model.settle();
        this.options.warmup.settled();
    }
    dispose(): void {
        if (this.isDisposed) return;
        super.dispose();
        this.pendingScope?.dispose();
        this.pageScope?.dispose();
        this.pendingScope = null;
        this.pageScope = null;
        this.loading = null;
        this.options.world.closeWorld();
    }
}
