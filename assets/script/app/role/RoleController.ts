import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { RoleEvent, type IRoleIntent } from './RoleEvents';
import { ROLE_NAV_READY, getGemChange, isRoleBagTabReady } from './RoleTable';
import type { GameRequestStatus } from '../net/RequestGuard';
import type { ProtoInput } from '../../framework/net/RequestMsg';
import type { IRoleEquipGrowth, IRoleEquipPlan, IRoleGemGrowth, IRoleGrowthProtocol } from './RoleTypes';
import { ROLE_TEXTS } from './RoleTexts';
import type { IRoleEquipSlotData, IRoleGemEntry, IRoleGemSocket, RoleBagTabId, RoleGemChange } from './RoleTypes';

export interface IRoleGemDialog {
    readonly title: string;
    readonly content: string;
    readonly sureText?: string;
    readonly cancelText?: string;
    readonly confirmAgainText?: string;
}

export interface IRoleGrowthOperations {
    readonly equip: (id: string | null, partId: number | null) => Promise<IRoleEquipGrowth | null>;
    readonly washAttributes: (ids: readonly number[], values: readonly number[]) => Promise<readonly string[]>;
    readonly gem: (id: string) => Promise<IRoleGemGrowth | null>;
    readonly plans: () => Promise<readonly IRoleEquipPlan[]>;
    readonly filters: () => Promise<readonly { id: number; name: string }[]>;
    request<K extends keyof IRoleGrowthProtocol>(
        proto: K, payload: ProtoInput<IRoleGrowthProtocol[K][0]>,
        apply?: (response: IRoleGrowthProtocol[K][1]) => void,
    ): Promise<GameRequestStatus>;
}

type RoleOperationIntent = Exclude<IRoleIntent, { kind: 'bag' | 'nav' }>;

interface IRoleGemOperations {
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
    readonly growth?: IRoleGrowthOperations;
    readonly failed: (error: unknown) => void;
    readonly repository: {
        readonly load: () => Promise<T>;
    };
    readonly view: {
        readonly render: (snapshot: T) => Promise<void>;
        readonly showBag: (tab: RoleBagTabId, filter?: number, filterName?: string) => Promise<void>;
        readonly selectBag: (tab: RoleBagTabId) => void;
    };
    readonly popups: {
        readonly openTalent: () => void;
        readonly openEquipInfo?: (partId: number, bagUniqueId?: string) => void;
        readonly openEquipEvolve?: (partId?: number, tab?: 'strengthen' | 'upgrade') => void;
        readonly openGemInfo?: (gemId: string) => void;
        readonly openGongMing?: () => void;
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
    private gemFilter: { id: number; name: string } = { id: 0, name: ROLE_TEXTS.gemFilterAll };
    constructor(context: IControllerContext | (() => IControllerContext), private readonly options: IRoleControllerOptions<T>) {
        super(context, 'role');
    }
    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(RoleEvent.Intent, this.onIntent);
        this.listen(RoleEvent.GemChanged, this.onGemChanged);
    }
    private onGemChanged(): void {
        void this.refresh(false);
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
            else await this.showSelectedBag();
        } catch (error) {
            if (!this.isDisposed && revision === this.revision) this.options.failed(error);
        }
    }
    cancel(): void {
        this.revision++;
        this.selectionRevision++;
        this.gemSession++;
        this.selectedSocket = null;
        this.gemFilter = { id: 0, name: ROLE_TEXTS.gemFilterAll };
        if (this.gemBusy) this.options.gems?.cancel();
        this.gemBusy = false;
    }

    dispose(): void {
        this.cancel();
        super.dispose();
    }

    private onIntent(event: IRoleIntent): void {
        if (event.kind !== 'bag' && event.kind !== 'nav') {
            if (event.kind === 'forge' && this.options.popups.openEquipEvolve) {
                this.options.popups.openEquipEvolve(event.partId);
                return;
            }
            const gems = this.options.gems;
            if (gems && !this.gemBusy) void this.handleGem(event, gems);
            return;
        }
        if (event.kind === 'bag') { void this.selectBag(event.tab); return; }
        if (event.navId === 2) { this.options.popups.openTalent(); return; }
        if (event.navId === 3) { this.options.popups.openGongMing?.(); return; }
        if (!ROLE_NAV_READY.has(event.navId)) this.options.feedback.tip(ROLE_TEXTS.navMissing);
    }

    private async handleGem(
        event: RoleOperationIntent,
        operations: IRoleGemOperations,
    ): Promise<void> {
        const session = this.gemSession;
        this.gemBusy = true;
        try {
            if (event.kind === 'socket') await this.chooseSocket(event.partId, event.order, operations, session);
            else if (event.kind === 'gem') await this.inspectGem(event.id, operations, session);
            else if (event.kind === 'compose') await this.compose(operations, session);
            else if (this.options.growth) await this.handleGrowth(event, operations, this.options.growth, session);
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
            if (!socket && this.options.popups.openGemInfo) {
                this.options.popups.openGemInfo(id);
                return;
            }
            const growth = this.options.growth;
            const choice = await ops.dialog({
                title: gem.name,
                content: `${details}\n${socket ? ROLE_TEXTS.gemInvalid : ROLE_TEXTS.gemChooseSocket}`,
                sureText: growth ? ROLE_TEXTS.gemGrowth : undefined,
            });
            if (growth && choice === 'confirm' && this.isGemSession(session)) {
                await this.manageGem(gem, ops, growth, session);
            }
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

    private async handleGrowth(
        event: Exclude<RoleOperationIntent, { kind: 'gem' | 'socket' | 'compose' }>,
        ops: IRoleGemOperations, growth: IRoleGrowthOperations, session: number,
    ): Promise<void> {
        const t = ROLE_TEXTS;
        if (event.kind === 'gemFilter') {
            const filters = [{ id: 0, name: t.gemFilterAll }, ...await growth.filters()];
            let index = Math.max(0, filters.findIndex(filter => filter.id === this.gemFilter.id));
            while (this.isGemSession(session)) {
                const current = filters[index];
                const choice = await ops.dialog({
                    title: t.gemFilter, content: current.name,
                    cancelText: filters.length > 1 ? t.gemFilterNext : undefined,
                    sureText: current.name,
                });
                if (!this.isGemSession(session) || !choice) return;
                if (choice === 'confirm') {
                    this.gemFilter = current;
                    this.selectedSocket = null;
                    await this.selectBag(1);
                    return;
                }
                index = (index + 1) % filters.length;
            }
            return;
        }
        if (event.kind === 'forge') {
            if (this.options.popups.openEquipEvolve) {
                this.options.popups.openEquipEvolve(event.partId);
                return;
            }
            const choice = await ops.dialog({
                title: t.equipForge, content: t.equipChoose, sureText: t.equipAllLevel, cancelText: t.equipPlans,
            });
            if (choice === 'confirm' && this.isGemSession(session)) {
                await this.confirmEquipWrite(t.equipAllLevel, t.equipAllLevelConfirm, ops, session,
                    () => growth.request('CmdEquipUpLevelAllReqMsg', {}));
            } else if (choice === 'alternate' && this.isGemSession(session)) {
                await this.selectEquipPlan(ops, growth, session);
            }
            return;
        }

        if (event.kind === 'equipPart' && this.options.popups.openEquipInfo) {
            this.options.popups.openEquipInfo(event.partId);
            return;
        }
        if (event.kind === 'equip' && this.options.popups.openEquipInfo) {
            this.options.popups.openEquipInfo(0, event.id);
            return;
        }

        const gear = await (event.kind === 'equip'
            ? growth.equip(event.id, null)
            : growth.equip(null, event.partId));
        if (!this.isGemSession(session)) return;
        if (!gear) {
            this.options.feedback.tip(t.equipEmpty);
            return;
        }
        const details = [t.equipDetails(gear.rank, gear.level, gear.attack, gear.hpPercent), ...gear.effects].join('\n');
        if (!gear.worn) {
            const choice = await ops.dialog({
                title: gear.name, content: details, sureText: t.equipWear, cancelText: t.equipDecompose,
            });
            if (!this.isGemSession(session)) return;
            if (choice === 'confirm') {
                await this.finishEquipWrite(await growth.request('CmdEquipReplaceReqMsg', { uniqueId: gear.id }), session);
            } else if (choice === 'alternate') {
                await this.confirmEquipWrite(t.equipDecompose, t.equipDecomposeConfirm(gear.name), ops, session,
                    () => growth.request('CmdEquipDecomposeReqMsg', { tlUniqueIds: [gear.id] }, response => {
                        if (response.tlCmdGoods?.length) ops.showRewards(response.tlCmdGoods);
                    }));
            }
            return;
        }

        const more = gear.qualityCost !== null || gear.washCost !== null;
        const choice = await ops.dialog({
            title: gear.name, content: details, sureText: gear.levelCost.length ? t.equipLevel : more ? t.equipMore : undefined,
            cancelText: gear.levelCost.length && more ? t.equipMore : undefined,
        });
        if (!this.isGemSession(session) || !choice) return;
        if (choice === 'confirm' && gear.levelCost.length) {
            await this.confirmEquipWrite(t.equipLevel, t.equipConfirmCost(t.equipLevel, gear.levelCost.join('、')),
                ops, session, () => growth.request('CmdEquipUpLevelReqMsg', { id: gear.baseId, type: 0 }));
        } else if (more) {
            await this.equipMore(gear, ops, growth, session);
        }
    }

    private async selectEquipPlan(ops: IRoleGemOperations, growth: IRoleGrowthOperations, session: number): Promise<void> {
        const plans = await growth.plans();
        if (!this.isGemSession(session)) return;
        const t = ROLE_TEXTS;
        if (!plans.length) {
            this.options.feedback.tip(t.equipPlanEmpty);
            return;
        }
        let index = Math.max(0, plans.findIndex(plan => plan.selected));
        while (this.isGemSession(session)) {
            const plan = plans[index];
            const choice = await ops.dialog({
                title: t.equipPlans,
                content: [plan.name, plan.selected ? t.equipPlanCurrent :
                    plan.lockedUntil ? t.pageLocked(plan.lockedUntil) : ''].filter(Boolean).join('\n'),
                sureText: plan.selected || plan.lockedUntil ? t.equipPlans : t.equipPlanUse,
                cancelText: plans.length > 1 ? t.equipPlanNext : undefined,
            });
            if (!this.isGemSession(session) || !choice) return;
            if (choice === 'confirm') {
                if (!plan.selected && !plan.lockedUntil) {
                    await this.finishEquipWrite(await growth.request('CmdEquipSelectPageReqMsg', { page: plan.page }), session);
                }
                return;
            }
            index = (index + 1) % plans.length;
        }
    }

    private async equipMore(
        gear: IRoleEquipGrowth, ops: IRoleGemOperations, growth: IRoleGrowthOperations, session: number,
    ): Promise<void> {
        const t = ROLE_TEXTS;
        const { qualityCost, washCost } = gear;
        const choice = await ops.dialog({
            title: gear.name,
            content: [qualityCost && t.equipConfirmCost(t.equipQuality, qualityCost),
                washCost && t.equipConfirmCost(t.equipWash, washCost)].filter(Boolean).join('\n'),
            sureText: qualityCost ? t.equipQuality : t.equipWash,
            cancelText: qualityCost && washCost ? t.equipWash : undefined,
        });
        if (!this.isGemSession(session) || !choice) return;
        if (choice === 'confirm' && qualityCost) {
            await this.confirmEquipWrite(t.equipQuality, t.equipConfirmCost(t.equipQuality, qualityCost),
                ops, session, () => growth.request('CmdEquipUpQualityReqMsg', { equipId: gear.baseId }));
            return;
        }
        if (!washCost) return;
        const confirm = await ops.dialog({
            title: t.equipWash, content: t.equipConfirmCost(t.equipWash, washCost), sureText: t.equipWash,
        });
        if (confirm !== 'confirm' || !this.isGemSession(session)) return;
        let preview: CmdEquipWashRspMsg | null = null;
        const status = await growth.request('CmdEquipWashReqMsg', { equipId: gear.baseId }, response => {
            preview = response;
        });
        if (!this.isGemSession(session) || !this.gemSucceeded(status) || !preview) return;
        const after = await growth.washAttributes(preview.tlLibs ?? [], gear.washValues);
        if (!this.isGemSession(session)) return;
        const result = await ops.dialog({
            title: gear.name,
            content: [t.equipBefore, ...gear.effects, t.equipAfter, ...after].join('\n'),
            sureText: t.equipApplyWash, cancelText: t.equipKeepWash,
        });
        if (!this.isGemSession(session)) return;
        await this.finishEquipWrite(await growth.request('CmdEquipWashConformReqMsg', {
            equipId: preview.equipId ?? gear.baseId, change: result === 'confirm',
        }), session);
    }

    private async confirmEquipWrite(
        title: string, content: string, ops: IRoleGemOperations, session: number, write: () => Promise<GameRequestStatus>,
    ): Promise<void> {
        const choice = await ops.dialog({ title, content, sureText: title });
        if (choice === 'confirm' && this.isGemSession(session)) await this.finishEquipWrite(await write(), session);
    }

    private async finishEquipWrite(status: GameRequestStatus, session: number): Promise<void> {
        if (!this.isGemSession(session) || !this.gemSucceeded(status)) return;
        this.selectedSocket = null;
        this.options.feedback.tip(ROLE_TEXTS.equipChanged);
        await this.refresh(false);
    }

    private async manageGem(
        gem: IRoleGemEntry, ops: IRoleGemOperations, growth: IRoleGrowthOperations, session: number,
    ): Promise<void> {
        const state = await growth.gem(gem.gemId);
        if (!state || !this.isGemSession(session)) return;
        const t = ROLE_TEXTS;
        const label = state.lock ? t.gemUnlock : t.gemLock;
        const canRefine = state.refineCost > 0 || !!state.pendingAttribute;
        const choice = await ops.dialog({
            title: gem.name, content: gem.desc || gem.name, sureText: label,
            cancelText: canRefine ? t.gemRefine : undefined,
        });
        if (!this.isGemSession(session)) return;
        if (choice === 'alternate' && canRefine) {
            await this.refineGem(gem, state, ops, growth, session);
        } else if (choice === 'confirm') {
            const lock = state.lock >= 2 ? 2 : state.lock === 1 ? 0 : 1;
            if (lock === 2) {
                const unlock = await ops.dialog({ title: label, content: t.gemUnlockWorn, sureText: label });
                if (unlock !== 'confirm' || !this.isGemSession(session)) return;
            }
            await this.finishGemWrite(await growth.request('CmdGemLockReqMsg', { id: gem.gemId, lock }), session);
        }
    }

    private async refineGem(
        gem: IRoleGemEntry, state: IRoleGemGrowth, ops: IRoleGemOperations, growth: IRoleGrowthOperations, session: number,
    ): Promise<void> {
        const t = ROLE_TEXTS;
        const refineType = state.lock >= 2 ? 2 : 1;
        let candidate = state.pendingAttribute;
        let saveType = refineType;
        if (!candidate) {
            const choice = await ops.dialog({
                title: t.gemRefine,
                content: [t.gemRefineCost(state.refineCost), refineType === 2 ? t.gemRefineWorn : ''].filter(Boolean).join('\n'),
                sureText: t.gemRefine,
            });
            if (!this.isGemSession(session) || choice !== 'confirm') return;
            const status = await growth.request('CmdGemRefineReqMsg', { id: gem.gemId, type: refineType });
            if (!this.isGemSession(session) || !this.gemSucceeded(status)) return;
            const updated = await growth.gem(gem.gemId);
            if (!this.isGemSession(session)) return;
            candidate = updated?.pendingAttribute ?? '';
            saveType = 1;
            if (!candidate) {
                await this.refresh(false);
                return;
            }
        }
        const decision = await ops.dialog({
            title: t.gemRefine,
            content: [t.gemOldAttr(gem.desc), t.gemNewAttr(candidate)].join('\n'),
            sureText: t.gemSaveAttr, cancelText: t.gemDiscardAttr,
        });
        if (!this.isGemSession(session)) return;
        if (!decision) {
            await this.refresh(false);
            return;
        }
        await this.finishGemWrite(await growth.request('CmdGemRefineSaveReqMsg', {
            id: gem.gemId, type: decision === 'confirm' ? saveType : 0,
        }), session);
    }

    private async finishGemWrite(status: GameRequestStatus, session: number): Promise<void> {
        if (!this.isGemSession(session) || !this.gemSucceeded(status)) return;
        this.selectedSocket = null;
        this.options.feedback.tip(ROLE_TEXTS.gemChanged);
        await this.refresh(false);
    }

    private showSelectedBag(): Promise<void> {
        return this.selectedBag === 1 && this.gemFilter.id
            ? this.options.view.showBag(1, this.gemFilter.id, this.gemFilter.name)
            : this.options.view.showBag(this.selectedBag);
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
        try {
            await this.showSelectedBag();
        }
        catch (error) { if (!this.isDisposed) this.options.failed(error); }
    }
}
