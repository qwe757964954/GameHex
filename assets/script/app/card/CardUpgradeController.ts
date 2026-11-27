import type { ResourceScope } from '../../core/asset/ResourceScope';
import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import type { ICardRepository } from './CardRepository';
import type { ICardMaterialIcon, ICardUpgradeMaterials } from './CardPresentations';
import type { ZCUpgradeStatus } from './CardUpgradeCost';
import type { ICardDetailArt } from './CardArtProvider';
import type { ICardLineupCatalog } from './CardArtConfig';
import type { ICardUpgradedArtBundle } from './CardUpgradedArt';
import type { ICardUpgradedContent } from './CardUpgradedPresentation';
import type { CardDetailPresentation } from './CardDetailPresenter';
import { formatCritDamageGain } from './CardDetailCritDamage';
import { resolveDetailNeighbor } from './CardDetailPresenter';
import { cardClassName, resolveCardClass, resolveCardDisplayLevel } from './CardLineupTypes';
import type { ZCCardClass } from './CardLineupTypes';
import { CardUpgradeModel } from './CardUpgradeModel';
import { CardPopupEvent, type CardUpgradeIntent, type CardUpgradeOutput } from './CardPopupEvents';
import { CardLineupEvent } from './CardLineupEvents';
import type { ZCDeckCard } from './CardLineupTypes';

export interface ICardUpgradeControllerOptions {
    readonly model: CardUpgradeModel;
    readonly repository: Pick<ICardRepository, 'loadUpgradeStatus' | 'loadCardDetail' | 'upgradeHero' | 'applyHeroLevel' | 'loadDetailNavigation' | 'loadDetailArt' | 'loadArtConfig' | 'loadMaterialIcon'>;
    readonly loadUpgradedArt?: (
        card: ZCDeckCard,
        cardClass: ZCCardClass,
        scope: ResourceScope,
    ) => Promise<ICardUpgradedArtBundle>;
}

export class CardUpgradeController extends ControllerBase {
    private art: ICardDetailArt | null = null;
    private lineup: ICardLineupCatalog | null = null;
    private materials: ICardUpgradeMaterials = { card: null, exp: null };
    private materialKey: string | null = null;
    private materialTask: Promise<[ICardMaterialIcon | null, ICardMaterialIcon | null]> | null = null;
    private switching = false;
    private submitting = false;
    private refreshRevision = 0;
    constructor(context: IControllerContext, private readonly options: ICardUpgradeControllerOptions) {
        super(context, 'card-upgrade');
    }
    async start(): Promise<void> {
        this.listen(CardPopupEvent.UpgradeIntent, this.onIntent);
        const revision = ++this.refreshRevision;
        const [art, config] = await Promise.all([
            this.options.repository.loadDetailArt(this.options.model.snapshot.data.card),
            this.options.repository.loadArtConfig(),
        ]);
        if (this.isDisposed || revision !== this.refreshRevision) return;
        this.art = art;
        this.lineup = config.lineup;
        this.publish();
        await this.refresh();
    }
    private emitOutput(output: CardUpgradeOutput): void {
        EventMgr.instance.emit(CardPopupEvent.UpgradeOutput, output, this);
    }
    private publish(): void {
        this.emitOutput({
            kind: 'render',
            state: { ...this.options.model.snapshot, art: this.art, lineup: this.lineup, materials: this.materials },
        });
    }
    private async refreshMaterials(status: ZCUpgradeStatus): Promise<void> {
        const cardId = status.requirements.find(row => row.key === 'card')?.itemId ?? '';
        const key = JSON.stringify([cardId, status.generalExpItemId, status.armyExpItemId]);
        if (this.materialKey !== key) {
            this.materials = { card: null, exp: null };
            this.materialKey = key;
            this.materialTask = Promise.all([
                this.options.repository.loadMaterialIcon([cardId]),
                this.options.repository.loadMaterialIcon([status.generalExpItemId, status.armyExpItemId]),
            ]);
        }
        // 持有量随状态更新，图标任务只随材料身份变化。
        this.setMaterials(status, this.materials.card, this.materials.exp);
        const task = this.materialTask;
        if (!task) return;
        try {
            const [card, exp] = await task;
            if (this.isDisposed || this.materialTask !== task) return;
            this.materialTask = null;
            if (!card && !exp) return;
            const currentStatus = this.options.model.snapshot.status;
            this.setMaterials(currentStatus ?? status, card, exp);
            if (currentStatus) this.publish();
        } catch (error) {
            if (this.isDisposed || this.materialTask !== task) return;
            this.materialTask = null;
            this.materialKey = null;
            console.warn('[CardUpgradeController] 材料图标加载失败', error);
        }
    }
    private setMaterials(status: ZCUpgradeStatus, card: ICardMaterialIcon | null, exp: ICardMaterialIcon | null): void {
        this.materials = {
            card: card ? { ...card, owned: status.requirements.find(row => row.key === 'card').owned } : null,
            exp: exp ? { ...exp, owned: exp.itemId === status.generalExpItemId ? status.generalExpOwned : status.armyExpOwned } : null,
        };
    }
    private async refresh(): Promise<void> {
        const { model, repository } = this.options;
        const revision = ++this.refreshRevision;
        const { cardId, level } = model.snapshot;
        const current = () => !this.isDisposed && revision === this.refreshRevision;
        // 各区就绪即展示；升级开始后旧等级的在途结果全部失效。
        await Promise.all([
            repository.loadUpgradeStatus(cardId, level)
                .then((value) => {
                    if (!current()) {
                        return;
                    }
                    model.setStatus(value);
                    void this.refreshMaterials(value);
                    this.publish();
                })
                .catch((error) => {
                    if (!current()) {
                        return;
                    }
                    model.setPhase('failed');
                    this.emitOutput({ kind: 'failed', error });
                    this.publish();
                }),
            repository.loadCardDetail(cardId, level)
                .then((detail) => {
                    if (!current()) {
                        return;
                    }
                    model.setDetail(detail);
                    this.publish();
                })
                .catch((error) => {
                    if (!current()) {
                        return;
                    }
                    console.warn('[CardUpgradeController] 详情数据加载失败，详情区保持占位', error);
                    model.setDetail(null);
                    this.publish();
                }),
        ]);
    }
    private onIntent(event: CardUpgradeIntent): void {
        if (this.switching) {
            return;
        }
        if (event.kind === 'submit') {
            void this.submit();
            return;
        }
        const { model } = this.options;
        if (model.snapshot.phase === 'loading' || model.snapshot.phase === 'submitting') {
            return;
        }
        if (event.kind === 'previous' || event.kind === 'next') {
            void this.switchDetail(event.kind === 'previous' ? -1 : 1);
            return;
        }
        if (event.kind !== 'skills' || !Number.isSafeInteger(model.heroId) || model.heroId <= 0) {
            return;
        }
        if (!model.snapshot.detail?.chain.some(slot => !slot.empty && slot.skillId === event.skillId)) {
            return;
        }
        const data = { heroId: model.heroId, skillId: event.skillId };
        this.emitOutput({ kind: 'openSkills', data });
    }
    private async switchDetail(direction: -1 | 1): Promise<void> {
        this.switching = true;
        try {
            const data = await this.options.repository.loadDetailNavigation();
            if (this.isDisposed) return;
            const card = resolveDetailNeighbor(data.catalog, this.options.model.snapshot.cardId, direction);
            if (!card) return;
            const level = resolveCardDisplayLevel(card.id, data.heroLevels, data.heroListKnown, 1);
            const [status, detail, art] = await Promise.allSettled([
                this.options.repository.loadUpgradeStatus(card.id, level),
                this.options.repository.loadCardDetail(card.id, level),
                this.options.repository.loadDetailArt(card),
            ]);
            if (this.isDisposed) return;
            if (status.status === 'rejected') {
                this.emitOutput({ kind: 'failed', error: status.reason });
                return;
            }
            if (art.status === 'rejected') {
                this.emitOutput({ kind: 'failed', error: art.reason });
                return;
            }
            if (detail.status === 'rejected') {
                console.warn('[CardUpgradeController] 详情数据加载失败，详情区保持占位', detail.reason);
            }
            // 同一弹窗原位提交，旧卡的在途刷新不能覆盖新卡。
            this.refreshRevision++;
            this.art = art.value;
            this.options.model.selectCard({ card, cardId: card.id, level });
            this.options.model.setStatus(status.value);
            this.options.model.setDetail(detail.status === 'fulfilled' ? detail.value : null);
            void this.refreshMaterials(status.value);
            this.publish();
        } catch (error) {
            if (!this.isDisposed) this.emitOutput({ kind: 'failed', error });
        } finally { this.switching = false; }
    }
    /** 在当前提交流程作用域内发出并托管 loading 状态，确保销毁或结束时至多收起一次。 */
    private async withLoading<T>(level: number, task: (hideLoading: () => void) => Promise<T>): Promise<T> {
        let released = false;
        const release = (): void => {
            if (released) return;
            released = true;
            this.emitOutput({ kind: 'loading', level: null });
        };
        const detach = this.own(release);
        this.emitOutput({ kind: 'loading', level });
        try {
            return await task(() => {
                release();
                detach();
            });
        } finally {
            release();
            detach();
        }
    }
    /**
     * 升级成功后的展示弹窗。
     *
     * 进度取「本次升级实际消耗」那一档的 need/need：升级已经扣完材料，用升级后的剩余量
     * 会得到一条空槽，和设计稿的满格语义也不一致；没有材料行时退回新等级的持有/需求。
     *
     * 动画需要「旧值 → 新值」，所以除了新等级/新属性，还要把**升级前**那一份一起带上：
     * `consumed` 是提交前的材料状态，`previousDetail` 包含旧属性和本次升级的预览增量。
     * 下一级的材料行取升级后的 `snapshot.status` —— 刷光后进度条从满格退到它。
     */
    private async openUpgraded(
        level: number,
        consumed: ZCUpgradeStatus | null,
        previousDetail: CardDetailPresentation | null,
        prefetchedArt: Promise<ICardUpgradedArtBundle>,
    ): Promise<void> {
        const snapshot = this.options.model.snapshot;
        const card = snapshot.data.card;
        if (this.isDisposed || !card) return;
        const lineup = this.lineup;
        const cardClass: ZCCardClass = lineup ? resolveCardClass(card, lineup) : 'tank';
        const className = lineup ? cardClassName(cardClass, lineup) : card.traits?.attack ?? '';
        const { chrome, classIcon, heroPrefab } = await prefetchedArt;
        if (this.isDisposed) return;
        if (!chrome.background) {
            console.warn('[CardUpgradeController] 升级弹窗背景缺失，跳过展示');
            return;
        }
        const hp = snapshot.detail?.stats.find(line => line.key === 'hp');
        const attack = snapshot.detail?.stats.find(line => line.key === 'attack');
        const consumedRow = consumed?.requirements.find(row => row.key === 'card') ?? consumed?.requirements[0];
        const nextRow = snapshot.status?.requirements.find(row => row.key === 'card') ?? snapshot.status?.requirements[0];
        const row = consumedRow ?? nextRow;
        const need = row?.need ?? 0;
        const owned = consumedRow ? need : Math.min(row?.owned ?? 0, need);
        const ratio = need > 0 ? Math.min(1, Math.max(0, owned / need)) : 0;
        // 升级后的材料行 = 下一级的需求；满级时 `status` 为空 ⇒ 不退回。
        const nextNeed = nextRow?.need ?? 0;
        const nextOwned = Math.min(nextRow?.owned ?? 0, nextNeed);
        const nextRatio = nextNeed > 0 ? Math.min(1, Math.max(0, nextOwned / nextNeed)) : 0;
        // 进度条分三段演：先「刚好凑满的那一档」满格 → 清空归零 → 绿色从左往右涨到下一级的真实进度。
        //
        // 起点**恒取满格**：能走到这里就说明本次是「攒够了才升」的，满格才是那一刻的事实。
        // 别再用 `consumedRow` 去探测起点 —— 需求行的形状一变（key 改名、只有属性行、
        // 只有经验行），起点就会退化成「下一级的真实比例」，于是 `from == to`、条不动；
        // 更糟的是配合刷光看过去，读起来像进度条自己在从左往右长。
        const progressTo = nextNeed > 0 ? nextRatio : ratio;
        const progressFrom = progressTo < 1 ? 1 : ratio;
        // 文字与条必须同源：起点满格就写满格。
        // `need` 取不到时退回 `nextNeed` —— 否则 `progressText` 是空串、整条进度条被
        // `CardUpgradedPage` 判为「没有材料行」直接隐藏，满格与归零两段演出都看不到。
        const trackNeed = need > 0 ? need : nextNeed;
        const trackOwned = progressFrom >= 1 ? trackNeed : owned;
        const previousHp = previousDetail?.stats.find(line => line.key === 'hp');
        const previousAttack = previousDetail?.stats.find(line => line.key === 'attack');
        const bonus = formatCritDamageGain(previousDetail?.critDamageGain ?? 0);
        const data: ICardUpgradedContent = {
            background: chrome.background,
            frame: chrome.frame,
            hero: this.art?.hero ?? null,
            heroPrefab,
            quality: this.art?.diamond ?? null,
            classIcon,
            name: card.name,
            className,
            levelText: `${level}级`,
            previousLevelText: consumed && consumed.level > 0 ? `${consumed.level}级` : undefined,
            progressText: trackNeed > 0 ? `${trackOwned}/${trackNeed}` : '',
            progressRatio: progressFrom,
            nextProgressText: nextNeed > 0 ? `${nextOwned}/${nextNeed}` : undefined,
            nextProgressRatio: nextNeed > 0 ? nextRatio : undefined,
            hpValue: hp?.value ?? '',
            hpGain: previousHp?.gain ?? '',
            attackValue: attack?.value ?? '',
            attackGain: previousAttack?.gain ?? '',
            previousHpValue: previousHp?.value || undefined,
            previousAttackValue: previousAttack?.value || undefined,
            bonusText: bonus ? `所有单位暴击伤害提升<color=#1E9007>${bonus}</color>` : '',
        };
        this.emitOutput({ kind: 'openUpgraded', data });
    }
    private async submit(): Promise<void> {
        const { model, repository } = this.options;
        if (!model.canSubmit || this.submitting || this.isDisposed) {
            return;
        }
        this.submitting = true;
        this.refreshRevision++;
        model.setPhase('submitting');
        try {
            this.publish();
            if (this.isDisposed) return;
            await this.withLoading(model.snapshot.level, async (hideLoading) => {
                if (this.isDisposed) return;
                const { data: { card }, status: consumed, detail, cardId, level } = model.snapshot;
                // 成功弹窗的美术与升级请求**并行**起跑：它只取决于卡 / 品级 / 职业，与升级结果无关。
                // 串行等的话，点完升级要依次等「请求 + 刷新 + 三张图」才见到弹窗，体感就是「进弹窗很慢」。
                const upgradedArt = card && this.options.loadUpgradedArt?.(
                    card, this.lineup ? resolveCardClass(card, this.lineup) : 'tank', this.scope,
                );
                const result = await repository.upgradeHero(model.heroId, this);
                if (this.isDisposed) {
                    return;
                }
                if (result.kind === 'success') {
                    model.confirm(result.level);
                    repository.applyHeroLevel(result.heroId, result.level);
                    EventMgr.instance.emit(CardLineupEvent.HeroUpgraded, { heroId: result.heroId, level: result.level });
                    if (this.isDisposed) {
                        return;
                    }
                    this.publish();
                    // 升级按钮可早于详情就绪，缺旧详情时与新等级刷新并行补读。
                    const previousDetail = upgradedArt && result.level === level + 1
                        ? detail ?? repository.loadCardDetail(cardId, level).catch(() => null)
                        : null;
                    const [, upgradedFrom] = await Promise.all([this.refresh(), previousDetail]);
                    if (this.isDisposed || model.snapshot.cardId !== cardId || model.snapshot.level !== result.level) {
                        return;
                    }
                    // 先收起“升级中”，让成功弹窗自己承担出入场；刷新失败也不改升级结果。
                    hideLoading();
                    if (upgradedArt) await this.openUpgraded(result.level, consumed, upgradedFrom, upgradedArt);
                } else {
                    model.setPhase(result.kind);
                    this.publish();
                }
            });
        } catch (error) {
            if (!this.isDisposed) {
                model.setPhase('failed');
                this.publish();
                this.emitOutput({ kind: 'failed', error });
            }
        } finally {
            this.submitting = false;
        }
    }
}
