import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { RoleEvent, type IRoleIntent } from './RoleEvents';
import { ROLE_NAV_READY, getGemChange, isRoleBagTabReady } from './RoleTable';
import type { GameRequestStatus } from '../net/RequestGuard';
import { ROLE_TEXTS } from './RoleTexts';
import type { IRoleEquipSlotData, IRoleGemEntry, IRoleGemSocket, RoleBagTabId, RoleGemChange } from './RoleTypes';

export interface IRoleGemDialog {
    readonly title: string;
    readonly content: string;
    readonly sureText?: string;
    readonly cancelText?: string;
    readonly confirmAgainText?: string;
}

interface IRoleGemOperations {
    readonly source: () => object;
    readonly slots: () => readonly IRoleEquipSlotData[];
    readonly find: (id: string) => IRoleGemEntry | null;
    readonly change: (change: RoleGemChange) => Promise<GameRequestStatus>;
    readonly preview: () => Promise<{ status: GameRequestStatus; materials: readonly { id: string; count: number }[] }>;
    readonly compose: () => Promise<{ status: GameRequestStatus; rewards: CmdGoods[] }>;
    readonly showRewards: (rewards: CmdGoods[]) => void;
    readonly dialog: (data: IRoleGemDialog) => Promise<'confirm' | 'alternate' | null>;
    readonly cancel: () => void;
}

export interface IRoleControllerOptions<T> {
    readonly owner: object;
    readonly gems?: IRoleGemOperations;
    readonly failed: (error: unknown) => void;
    readonly repository: {
        readonly load: () => Promise<T>;
    };
    readonly view: {
        readonly render: (snapshot: T) => Promise<void>;
        readonly showBag: (tab: RoleBagTabId) => Promise<void>;
        readonly selectBag: (tab: RoleBagTabId) => void;
    };
    readonly popups: {
        readonly openTalent: () => void;
    };
    readonly feedback: {
        readonly tip: (text: string) => void;
    };
}
export class RoleController<T> extends ControllerBase {
    private revision = 0;
    private selectionRevision = 0;
    private started = false;
    private selectedBag: RoleBagTabId = 1;
    private selectedSocket: IRoleGemSocket | null = null;
    private gemBusy = false;
    private gemSession = 0;
    constructor(context: IControllerContext | (() => IControllerContext), private readonly options: IRoleControllerOptions<T>) {
        super(context, 'role');
    }
    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(RoleEvent.Intent, this.onIntent);
    }
    async refresh(resetBag = true): Promise<void> {
        if (this.isDisposed) return;
        const revision = ++this.revision, selection = this.selectionRevision;
        try {
            const snapshot = await this.options.repository.load();
            if (this.isDisposed || revision !== this.revision) return;
            await this.options.view.render(snapshot);
            if (this.isDisposed || revision !== this.revision || selection !== this.selectionRevision) return;
            if (resetBag) await this.selectBag(1);
            else await this.options.view.showBag(this.selectedBag);
        } catch (error) {
            if (!this.isDisposed && revision === this.revision) this.options.failed(error);
        }
    }
    cancel(): void {
        this.revision++;
        this.selectionRevision++;
        this.gemSession++;
        this.selectedSocket = null;
        if (this.gemBusy) this.options.gems?.cancel();
        this.gemBusy = false;
    }

    dispose(): void {
        this.cancel();
        super.dispose();
    }

    private onIntent(event: IRoleIntent, source: object): void {
        if (event.kind === 'gem' || event.kind === 'socket' || event.kind === 'compose') {
            const gems = this.options.gems;
            const owner = event.kind === 'compose' ? this.options.owner : gems?.source();
            if (gems && owner === source && !this.gemBusy) void this.handleGem(event, gems);
            return;
        }
        if (source !== this.options.owner) return;
        if (event.kind === 'bag') { void this.selectBag(event.tab); return; }
        if (event.navId === 2) { this.options.popups.openTalent(); return; }
        if (!ROLE_NAV_READY.has(event.navId)) this.options.feedback.tip(ROLE_TEXTS.navMissing);
    }

    private async handleGem(
        event: Extract<IRoleIntent, { kind: 'socket' | 'gem' | 'compose' }>,
        operations: IRoleGemOperations,
    ): Promise<void> {
        const session = this.gemSession;
        this.gemBusy = true;
        try {
            if (event.kind === 'socket') await this.chooseSocket(event.partId, event.order, operations, session);
            else if (event.kind === 'gem') await this.inspectGem(event.id, operations, session);
            else await this.compose(operations, session);
        } catch (error) {
            if (this.isGemSession(session)) {
                this.options.failed(error);
                this.options.feedback.tip(ROLE_TEXTS.failed);
            }
        } finally {
            if (this.isGemSession(session)) this.gemBusy = false;
        }
    }

    private async chooseSocket(partId: number, order: number, ops: IRoleGemOperations, session: number): Promise<void> {
        const slot = ops.slots().find(part => part.partId === partId);
        const socket = slot?.sockets.find(candidate => candidate.order === order);
        this.selectedSocket = null;
        if (!socket) {
            this.options.feedback.tip(ROLE_TEXTS.gemUnavailable);
            return;
        }
        if (this.selectedBag !== 1) await this.selectBag(1);
        if (!this.isGemSession(session)) return;
        if (!socket.gemId) {
            this.selectedSocket = socket;
            this.options.feedback.tip(ROLE_TEXTS.gemChoose(order));
            return;
        }

        const gem = ops.find(socket.gemId);
        const choice = await ops.dialog({
            title: gem?.name ?? ROLE_TEXTS.gemUnknown(socket.gemId),
            content: [ROLE_TEXTS.gemSocket(order), gem?.desc].filter(Boolean).join('\n'),
            sureText: ROLE_TEXTS.gemDown,
            cancelText: ROLE_TEXTS.gemChooseReplacement,
        });
        if (!this.isGemSession(session)) return;
        if (choice === 'alternate') {
            this.selectedSocket = socket;
            this.options.feedback.tip(ROLE_TEXTS.gemChoose(order));
        } else if (choice === 'confirm') {
            await this.changeGem(socket, null, ops, session);
        }
    }

    private async inspectGem(id: string, ops: IRoleGemOperations, session: number): Promise<void> {
        const gem = ops.find(id);
        if (!gem || gem.count <= 0) return;
        const socket = this.selectedSocket;
        const change = socket && getGemChange(ops.slots().flatMap(slot => slot.sockets), socket, gem);
        const details = ROLE_TEXTS.gemDetails(gem.desc, gem.count, gem.equipped);
        if (!change) {
            await ops.dialog({
                title: gem.name,
                content: `${details}\n${socket ? ROLE_TEXTS.gemInvalid : ROLE_TEXTS.gemChooseSocket}`,
            });
            return;
        }
        const choice = await ops.dialog({
            title: gem.name,
            content: `${details}\n${ROLE_TEXTS.gemSocket(socket.order)}`,
            sureText: change.kind === 'on' ? ROLE_TEXTS.gemOn : ROLE_TEXTS.gemReplace,
        });
        if (choice === 'confirm' && this.isGemSession(session)) {
            await this.changeGem(socket, gem, ops, session);
        }
    }

    private async changeGem(
        socket: IRoleGemSocket, gem: IRoleGemEntry | null, ops: IRoleGemOperations, session: number,
    ): Promise<void> {
        const currentGem = gem ? ops.find(gem.gemId) : null;
        const change = gem && !currentGem
            ? null
            : getGemChange(ops.slots().flatMap(slot => slot.sockets), socket, currentGem);
        if (!change) {
            this.options.feedback.tip(ROLE_TEXTS.gemInvalid);
            return;
        }
        const status = await ops.change(change);
        if (!this.isGemSession(session) || !this.gemSucceeded(status)) return;
        this.selectedSocket = null;
        this.options.feedback.tip(ROLE_TEXTS.gemChanged);
        await this.refresh(false);
    }

    private async compose(ops: IRoleGemOperations, session: number): Promise<void> {
        const preview = await ops.preview();
        if (!this.isGemSession(session) || !this.gemSucceeded(preview.status)) return;
        if (!preview.materials.length) {
            this.options.feedback.tip(ROLE_TEXTS.gemComposeEmpty);
            return;
        }
        const materials = preview.materials.map(item => ({ ...item, gem: ops.find(item.id) }));
        const content = materials.map(({ id, count, gem }) => ROLE_TEXTS.gemLine(gem?.name ?? ROLE_TEXTS.gemUnknown(id), count));
        const choice = await ops.dialog({
            title: ROLE_TEXTS.gemCompose,
            content: [ROLE_TEXTS.gemComposeMaterials, ...content].join('\n'),
            sureText: ROLE_TEXTS.gemComposeConfirm,
            confirmAgainText: materials.some(({ gem }) => gem && gem.quality >= 5) ? ROLE_TEXTS.gemComposeAgain : undefined,
        });
        if (choice !== 'confirm' || !this.isGemSession(session)) return;
        const result = await ops.compose();
        if (!this.isGemSession(session) || !this.gemSucceeded(result.status)) return;
        this.selectedSocket = null;
        if (result.rewards.length) ops.showRewards(result.rewards);
        else this.options.feedback.tip(ROLE_TEXTS.gemComposed);
        await this.refresh(false);
    }

    private isGemSession(session: number): boolean {
        return !this.isDisposed && session === this.gemSession;
    }

    private gemSucceeded(status: GameRequestStatus): boolean {
        if (status === 'ok') return true;
        this.options.feedback.tip(status === 'offline' ? ROLE_TEXTS.offline : ROLE_TEXTS.failed);
        return false;
    }
    private async selectBag(tab: RoleBagTabId): Promise<void> {
        if (!isRoleBagTabReady(tab)) { this.options.feedback.tip(ROLE_TEXTS.bagTabMissing); return; }
        this.selectionRevision++;
        this.selectedBag = tab;
        if (tab !== 1) this.selectedSocket = null;
        this.options.view.selectBag(tab);
        try { await this.options.view.showBag(tab); }
        catch (error) { if (!this.isDisposed) this.options.failed(error); }
    }
}
