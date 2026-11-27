import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { RoleEvent, type IRoleIntent, type RoleOutput } from './RoleEvents';
import { ROLE_NAV_READY, getGemChange, isRoleBagTabReady } from './RoleTable';
import type { GameRequestStatus } from '../net/RequestGuard';
import type { ProtoInput } from '../../framework/net/RequestMsg';
import type { IRoleEquipGrowth, IRoleEquipPlan, IRoleGemGrowth, IRoleGrowthProtocol } from './RoleTypes';
import { ROLE_TEXTS, roleQualityName } from './RoleTexts';
import type { IRoleDecomposeResult, IRoleEquipSlotData, IRoleGemEntry, IRoleGemSocket, RoleBagTabId, RoleGemChange } from './RoleTypes';
import {
    buildRoleComposeView,
    composeGemOf,
    ROLE_COMPOSE_HIGH_QUALITY,
    type IRoleComposeQuality,
    type IRoleComposeView,
} from './RoleComposeView';

export interface IRoleGemDialog {
    readonly title: string;
    readonly content?: string;
    readonly sureText?: string;
    readonly cancelText?: string;
    readonly confirmAgainText?: string;
    /** 一键合成的图标台账；有值时由 `RoleComposePopup` 渲染，而不是 `CommonTips` 文本。 */
    readonly compose?: IRoleComposeView;
}

export interface IRoleGrowthOperations {
    readonly equip: (id: string | null, partId: number | null) => Promise<IRoleEquipGrowth | null>;
    readonly washAttributes: (ids: readonly number[], values: readonly number[]) => Promise<readonly string[]>;
    readonly gem: (id: string) => Promise<IRoleGemGrowth | null>;
    readonly plans: () => Promise<readonly IRoleEquipPlan[]>;
    readonly filters: () => Promise<readonly { id: number; name: string }[]>;
    request<K extends keyof IRoleGrowthProtocol>(
        proto: K, payload: ProtoInput<IRoleGrowthProtocol[K][0]>, caller: object,
        apply?: (response: IRoleGrowthProtocol[K][1]) => void,
    ): Promise<GameRequestStatus>;
}

type RoleOperationIntent = Exclude<IRoleIntent, { kind: 'bag' | 'nav' }>;

export interface IRoleGemOperations {
    readonly slots: () => readonly IRoleEquipSlotData[];
    readonly find: (id: string) => IRoleGemEntry | null;
    readonly change: (change: RoleGemChange, caller: object) => Promise<GameRequestStatus>;
    readonly preview: (caller: object) => Promise<{ status: GameRequestStatus; materials: readonly { id: string; count: number }[] }>;
    readonly compose: (caller: object) => Promise<{ status: GameRequestStatus; rewards: CmdGoods[] }>;
    /** 批量分解：正常一次 `CmdEquipDecomposeReqMsg` 整包提交，仓库内部在缺件时才逐件补发。 */
    readonly decompose: (ids: readonly string[], caller: object) => Promise<IRoleDecomposeResult>;
    /** `gemQuality` 表（品质 → consume / icon），合成产出估算与棋子图标用。 */
    readonly qualities: () => Promise<readonly IRoleComposeQuality[]>;
    readonly showRewards: (rewards: CmdGoods[]) => void;
    readonly dialog: (data: IRoleGemDialog) => Promise<'confirm' | 'alternate' | null>;
    readonly cancel: () => void;
}

export interface IRoleControllerOptions<T> {
    readonly gems?: IRoleGemOperations;
    readonly growth?: IRoleGrowthOperations;
    readonly repository: {
        readonly load: () => Promise<T>;
    };
    readonly popups?: {
        readonly equipInfo?: boolean;
        readonly equipEvolve?: boolean;
        readonly gemInfo?: boolean;
    };
}
export class RoleController<T> extends ControllerBase {
    private revision = 0;
    private selectionRevision = 0;
    private selectedBag: RoleBagTabId = 1;
    private selectedSocket: IRoleGemSocket | null = null;
    private gemBusy = false;
    private gemSession = 0;
    private gemFilter: { id: number; name: string } = { id: 0, name: ROLE_TEXTS.gemFilterAll };
    constructor(context: IControllerContext | (() => IControllerContext), private readonly options: IRoleControllerOptions<T>) {
        super(context, 'role');
    }
    start(): void {
        this.listen(RoleEvent.Intent, this.onIntent);
        this.listen(RoleEvent.GemChanged, this.onGemChanged);
        this.listen(RoleEvent.EquipChanged, this.onEquipChanged);
    }
    private onGemChanged(): void {
        void this.refresh(false);
    }
    /** 装备写入由锻造弹窗完成。收到成功事件后保留当前背包选择并重新读取快照。 */
    private onEquipChanged(): void {
        void this.refresh(false);
    }
    async refresh(resetBag = true): Promise<void> {
        if (this.isDisposed) return;
        const revision = ++this.revision, selection = this.selectionRevision;
        try {
            const snapshot = await this.options.repository.load();
            if (this.isDisposed || revision !== this.revision) return;
            this.emitOutput({ kind: 'render', snapshot });
            if (this.isDisposed || revision !== this.revision || selection !== this.selectionRevision) return;
            if (resetBag) this.selectBag(1);
            else this.showSelectedBag();
        } catch (error) {
            if (!this.isDisposed && revision === this.revision) this.emitOutput({ kind: 'failed', error });
        }
    }
    private resetSession(): void {
        this.revision++;
        this.selectionRevision++;
        this.gemSession++;
        this.selectedSocket = null;
        this.gemFilter = { id: 0, name: ROLE_TEXTS.gemFilterAll };
        if (this.gemBusy) this.options.gems?.cancel();
        this.gemBusy = false;
    }

    cancel(): void {
        this.resetSession();
        this.clearCallbackOwners();
    }

    dispose(): void {
        this.resetSession();
        super.dispose();
    }

    private onIntent(event: IRoleIntent): void {
        if (event.kind !== 'bag' && event.kind !== 'nav') {
            if (event.kind === 'forge' && this.options.popups?.equipEvolve) {
                this.emitOutput({ kind: 'openEquipEvolve', partId: event.partId });
                return;
            }
            const gems = this.options.gems;
            if (gems && !this.gemBusy) void this.handleGem(event, gems);
            return;
        }
        if (event.kind === 'bag') { this.selectBag(event.tab); return; }
        if (event.navId === 2) { this.emitOutput({ kind: 'openTalent' }); return; }
        if (event.navId === 3) { this.emitOutput({ kind: 'openGongMing' }); return; }
        if (!ROLE_NAV_READY.has(event.navId)) this.tip(ROLE_TEXTS.navMissing);
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
            else if (event.kind === 'decompose') await this.decompose(event.ids, operations, session);
            else if (this.options.growth) await this.handleGrowth(event, operations, this.options.growth, session);
        } catch (error) {
            if (this.isGemSession(session)) {
                if (event.kind === 'decompose') {
                    this.emitOutput({ kind: 'decomposeDone', status: 'failed', removedIds: [], rewards: [] });
                }
                this.emitOutput({ kind: 'failed', error });
                this.tip(ROLE_TEXTS.failed);
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
            this.tip(ROLE_TEXTS.gemUnavailable);
            return;
        }
        if (this.selectedBag !== 1) this.selectBag(1);
        if (!this.isGemSession(session)) return;
        if (!socket.gemId) {
            this.selectedSocket = socket;
            this.tip(ROLE_TEXTS.gemChoose(order));
            return;
        }

        const gem = ops.find(socket.gemId);
        const choice = await ops.dialog({
            title: gem?.name ?? ROLE_TEXTS.gemUnknown(socket.gemId),
            content: [gem?.desc, ROLE_TEXTS.gemDownPrompt].filter(Boolean).join('\n'),
            sureText: ROLE_TEXTS.gemDown,
            cancelText: ROLE_TEXTS.gemChooseReplacement,
        });
        if (!this.isGemSession(session)) return;
        if (choice === 'alternate') {
            this.selectedSocket = socket;
            this.tip(ROLE_TEXTS.gemChoose(order));
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
            if (!socket && this.options.popups?.gemInfo) {
                this.emitOutput({ kind: 'openGemInfo', gemId: id });
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
            this.tip(ROLE_TEXTS.gemInvalid);
            return;
        }
        const status = await ops.change(change, this);
        if (!this.isGemSession(session) || !this.gemSucceeded(status)) return;
        this.selectedSocket = null;
        this.tip(ROLE_TEXTS.gemChanged);
        await this.refresh(false);
    }

    private async compose(ops: IRoleGemOperations, session: number): Promise<void> {
        const [preview, qualities] = await Promise.all([ops.preview(this), ops.qualities()]);
        if (!this.isGemSession(session) || !this.gemSucceeded(preview.status)) return;
        if (!preview.materials.length) {
            this.tip(ROLE_TEXTS.gemComposeEmpty);
            return;
        }
        const view = buildRoleComposeView(
            preview.materials,
            id => {
                const gem = ops.find(id);
                return gem ? composeGemOf(gem) : null;
            },
            qualities,
        );
        if (!view.materials.length) {
            this.tip(ROLE_TEXTS.gemComposeEmpty);
            return;
        }
        const choice = await ops.dialog({
            title: ROLE_TEXTS.gemCompose,
            compose: view,
            sureText: ROLE_TEXTS.gemComposeConfirm,
            // 具体品质名（传说 / 绝世 / 神话），不用笼统的「高品质」。
            confirmAgainText: view.topQuality >= ROLE_COMPOSE_HIGH_QUALITY
                ? ROLE_TEXTS.gemComposeAgain(roleQualityName(view.topQuality))
                : undefined,
        });
        if (choice !== 'confirm' || !this.isGemSession(session)) return;
        const result = await ops.compose(this);
        if (!this.isGemSession(session) || !this.gemSucceeded(result.status)) return;
        this.selectedSocket = null;
        if (result.rewards.length) ops.showRewards(result.rewards);
        else this.tip(ROLE_TEXTS.gemComposed);
        await this.refresh(false);
    }

    private async decompose(ids: readonly string[], ops: IRoleGemOperations, session: number): Promise<void> {
        if (!ids.length) return;
        const result = await ops.decompose(ids, this);
        if (!this.isGemSession(session)) return;
        this.emitOutput({ kind: 'decomposeDone', ...result });
    }

    private async handleGrowth(
        event: Exclude<RoleOperationIntent, { kind: 'gem' | 'socket' | 'compose' | 'decompose' }>,
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
            if (this.options.popups?.equipEvolve) {
                this.emitOutput({ kind: 'openEquipEvolve', partId: event.partId });
                return;
            }
            const choice = await ops.dialog({
                title: t.equipForge, content: t.equipChoose, sureText: t.equipAllLevel, cancelText: t.equipPlans,
            });
            if (choice === 'confirm' && this.isGemSession(session)) {
                await this.confirmEquipWrite(t.equipAllLevel, t.equipAllLevelConfirm, ops, session,
                    () => growth.request('CmdEquipUpLevelAllReqMsg', {}, this));
            } else if (choice === 'alternate' && this.isGemSession(session)) {
                await this.selectEquipPlan(ops, growth, session);
            }
            return;
        }

        if (event.kind === 'equipPart' && this.options.popups?.equipInfo) {
            this.emitOutput({ kind: 'openEquipInfo', partId: event.partId });
            return;
        }
        if (event.kind === 'equip' && !event.manage && this.options.popups?.equipInfo) {
            this.emitOutput({ kind: 'openEquipInfo', partId: 0, bagUniqueId: event.id });
            return;
        }

        const gear = await (event.kind === 'equip'
            ? growth.equip(event.id, null)
            : growth.equip(null, event.partId));
        if (!this.isGemSession(session)) return;
        if (!gear) {
            this.tip(t.equipEmpty);
            return;
        }
        const details = [t.equipDetails(gear.rank, gear.level, gear.attack, gear.hpPercent), ...gear.effects].join('\n');
        if (!gear.worn) {
            const choice = await ops.dialog({
                title: gear.name, content: details, sureText: t.equipWear, cancelText: t.equipDecompose,
            });
            if (!this.isGemSession(session)) return;
            if (choice === 'confirm') {
                await this.finishEquipWrite(await growth.request('CmdEquipReplaceReqMsg', { uniqueId: gear.id }, this), session);
            } else if (choice === 'alternate') {
                await this.confirmEquipWrite(t.equipDecompose, t.equipDecomposeConfirm(gear.name), ops, session,
                    () => growth.request('CmdEquipDecomposeReqMsg', { tlUniqueIds: [gear.id] }, this, response => {
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
                ops, session, () => growth.request('CmdEquipUpLevelReqMsg', { id: gear.baseId, type: 0 }, this));
        } else if (more) {
            await this.equipMore(gear, ops, growth, session);
        }
    }

    private async selectEquipPlan(ops: IRoleGemOperations, growth: IRoleGrowthOperations, session: number): Promise<void> {
        const plans = await growth.plans();
        if (!this.isGemSession(session)) return;
        const t = ROLE_TEXTS;
        if (!plans.length) {
            this.tip(t.equipPlanEmpty);
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
                    await this.finishEquipWrite(await growth.request('CmdEquipSelectPageReqMsg', { page: plan.page }, this), session);
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
                ops, session, () => growth.request('CmdEquipUpQualityReqMsg', { equipId: gear.baseId }, this));
            return;
        }
        if (!washCost) return;
        const confirm = await ops.dialog({
            title: t.equipWash, content: t.equipConfirmCost(t.equipWash, washCost), sureText: t.equipWash,
        });
        if (confirm !== 'confirm' || !this.isGemSession(session)) return;
        let preview: CmdEquipWashRspMsg | null = null;
        const status = await growth.request('CmdEquipWashReqMsg', { equipId: gear.baseId }, this, response => {
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
        }, this), session);
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
        this.tip(ROLE_TEXTS.equipChanged);
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
            await this.finishGemWrite(await growth.request('CmdGemLockReqMsg', { id: gem.gemId, lock }, this), session);
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
            const status = await growth.request('CmdGemRefineReqMsg', { id: gem.gemId, type: refineType }, this);
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
        }, this), session);
    }

    private async finishGemWrite(status: GameRequestStatus, session: number): Promise<void> {
        if (!this.isGemSession(session) || !this.gemSucceeded(status)) return;
        this.selectedSocket = null;
        this.tip(ROLE_TEXTS.gemChanged);
        await this.refresh(false);
    }

    private showSelectedBag(): void {
        if (this.selectedBag === 1 && this.gemFilter.id) {
            this.emitOutput({ kind: 'showBag', tab: 1, filter: this.gemFilter.id, filterName: this.gemFilter.name });
            return;
        }
        this.emitOutput({ kind: 'showBag', tab: this.selectedBag });
    }

    private isGemSession(session: number): boolean {
        return !this.isDisposed && session === this.gemSession;
    }

    private gemSucceeded(status: GameRequestStatus): boolean {
        if (status === 'ok') return true;
        this.tip(status === 'offline' ? ROLE_TEXTS.offline : ROLE_TEXTS.failed);
        return false;
    }
    private selectBag(tab: RoleBagTabId): void {
        if (!isRoleBagTabReady(tab)) { this.tip(ROLE_TEXTS.bagTabMissing); return; }
        this.selectionRevision++;
        this.selectedBag = tab;
        if (tab !== 1) this.selectedSocket = null;
        this.emitOutput({ kind: 'selectBag', tab });
        this.showSelectedBag();
    }
    private tip(text: string): void {
        this.emitOutput({ kind: 'tip', text });
    }
    private emitOutput(output: RoleOutput<T>): void {
        EventMgr.instance.emit(RoleEvent.Output, output);
    }
}
