import type { Prefab, SpriteFrame } from 'cc';
import type { ResourceScope } from '../../core/asset/ResourceScope';
import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import { EventMgr } from '../../framework/event/EventMgr';
import type { ICardRepository } from './CardRepository';
import type { ICardMaterialIcon, ICardUpgradeMaterials, ICardUpgradeViewState, ICardSkillOpenData } from './CardPresentations';
import type { ZCUpgradeStatus } from './CardUpgradeCost';
import type { ICardDetailArt } from './CardArtProvider';
import type { ICardLineupCatalog } from './CardArtConfig';
import type { ICardUpgradedChrome } from './CardUpgradedArt';
import type { ICardUpgradedContent } from './CardUpgradedPresentation';
import { formatCritDamageGain } from './CardDetailCritDamage';
import { resolveDetailNeighbor } from './CardDetailPresenter';
import { cardClassName, resolveCardClass } from './CardLineupTypes';
import type { ZCCardClass } from './CardLineupTypes';
import { CardUpgradeModel } from './CardUpgradeModel';
import { CardPopupEvent, type CardUpgradeIntent } from './CardPopupEvents';
import { CardLineupEvent } from './CardLineupEvents';
import type { ZCCardRarity, ZCDeckCard } from '../zcds/model/ZCCombatCatalog';

export interface ICardUpgradeControllerOptions {
    readonly owner: object;
    readonly model: CardUpgradeModel;
    readonly repository: Pick<ICardRepository, 'loadUpgradeStatus' | 'loadCardDetail' | 'upgradeHero' | 'applyHeroLevel' | 'loadDetailNavigation' | 'loadDetailArt' | 'loadArtConfig' | 'loadMaterialIcon'>;
    readonly failed: (error: unknown) => void;
    readonly view: {
        readonly render: (state: ICardUpgradeViewState) => void;
    };
    readonly loading: {
        readonly beginLoading: () => () => void;
    };
    readonly requests: {
        readonly removeCaller: (caller: object) => void;
    };
    readonly popups: {
        readonly openSkills: (data: ICardSkillOpenData) => void;
        readonly openUpgraded?: (content: ICardUpgradedContent) => void;
    };
    /** 成功弹窗的按品质背景/属性框与职业图标；测试或纯数据场景可省略。 */
    readonly upgradedArt?: {
        readonly loadChrome: (rarity: ZCCardRarity) => Promise<ICardUpgradedChrome>;
        readonly loadClassIcon: (cardClass: ZCCardClass) => Promise<SpriteFrame | null>;
        /** 按兵种 prefab 路径加载骨骼；作用域由控制器传入，弹窗关闭时一起释放。 */
        readonly loadHeroPrefab?: (path: string, scope: ResourceScope) => Promise<Prefab | null>;
    };
}
export class CardUpgradeController extends ControllerBase {
    private art: ICardDetailArt | null = null;
    private lineup: ICardLineupCatalog | null = null;
    private materials: ICardUpgradeMaterials = { card: null, exp: null };
    private materialKey: string | null = null;
    private materialTask: Promise<[ICardMaterialIcon | null, ICardMaterialIcon | null]> | null = null;
    private started = false;
    private switching = false;
    private refreshRevision = 0;
    private releaseLoading: (() => void) | null = null;
    constructor(context: IControllerContext, private readonly options: ICardUpgradeControllerOptions) {
        super(context, 'card-upgrade');
        this.own(() => options.requests.removeCaller(this));
        this.own(() => this.stopLoading());
    }
    async start(): Promise<void> {
        if (this.started || this.isDisposed) return;
        this.started = true;
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
    private publish(): void {
        this.options.view.render({ ...this.options.model.snapshot, art: this.art, lineup: this.lineup, materials: this.materials });
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
                    if (!current()) return;
                    model.setStatus(value);
                    void this.refreshMaterials(value);
                    this.publish();
                })
                .catch((error) => {
                    if (!current()) return;
                    model.setPhase('failed'); this.options.failed(error); this.publish();
                }),
            repository.loadCardDetail(cardId, level)
                .then((detail) => {
                    if (!current()) return;
                    model.setDetail(detail); this.publish();
                })
                .catch((error) => {
                    if (!current()) return;
                    console.warn('[CardUpgradeController] 详情数据加载失败，详情区保持占位', error);
                    model.setDetail(null); this.publish();
                }),
        ]);
    }
    private onIntent(event: CardUpgradeIntent): void {
        if (event.owner !== this.options.owner || this.switching) return;
        if (event.kind === 'submit') { void this.submit(); return; }
        const { model } = this.options;
        if (model.snapshot.phase === 'loading' || model.snapshot.phase === 'submitting') return;
        if (event.kind === 'previous' || event.kind === 'next') {
            void this.switchDetail(event.kind === 'previous' ? -1 : 1);
            return;
        }
        if (event.kind !== 'skills' || !Number.isSafeInteger(model.heroId) || model.heroId <= 0) return;
        if (!model.snapshot.detail?.chain.some(slot => !slot.empty && slot.skillId === event.skillId)) return;
        const data = { heroId: model.heroId, skillId: event.skillId };
        this.options.popups.openSkills(data);
    }
    private async switchDetail(direction: -1 | 1): Promise<void> {
        this.switching = true;
        try {
            const data = await this.options.repository.loadDetailNavigation();
            if (this.isDisposed) return;
            const card = resolveDetailNeighbor(data.catalog, this.options.model.snapshot.cardId, direction);
            if (!card) return;
            const level = data.heroLevels.get(card.id) ?? (data.heroListKnown ? 0 : 1);
            const [status, detail, art] = await Promise.allSettled([
                this.options.repository.loadUpgradeStatus(card.id, level),
                this.options.repository.loadCardDetail(card.id, level),
                this.options.repository.loadDetailArt(card),
            ]);
            if (this.isDisposed) return;
            if (status.status === 'rejected') {
                this.options.failed(status.reason);
                return;
            }
            if (art.status === 'rejected') {
                this.options.failed(art.reason);
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
            if (!this.isDisposed) this.options.failed(error);
        } finally { this.switching = false; }
    }
    private stopLoading(): void {
        const release = this.releaseLoading;
        this.releaseLoading = null;
        release?.();
    }
    /**
     * 升级弹窗英雄位的兵种骨骼 prefab。
     *
     * 走控制器自己的资源作用域：弹窗关闭、控制器释放时，prefab 与 Spine 依赖一起归还。
     * 建造卡没有 unitPrefabPath，或骨骼加载失败时返回 null，由视图退回静态立绘。
     */
    private loadUnitPrefab(
        card: ZCDeckCard,
        provider: ICardUpgradeControllerOptions['upgradedArt'] | undefined,
    ): Promise<Prefab | null> {
        const path = card.unitPrefabPath;
        const load = provider?.loadHeroPrefab;
        if (!path || !load) return Promise.resolve(null);
        return load(path, this.scope)
            .catch((error: unknown) => {
                console.warn(`[CardUpgradeController] 升级弹窗骨骼加载失败：${path}`, error);
                return null;
            });
    }

    /**
     * 升级成功后的展示弹窗。
     *
     * 进度取「本次升级实际消耗」那一档的 need/need：升级已经扣完材料，用升级后的剩余量
     * 会得到一条空槽，和设计稿的满格语义也不一致；没有材料行时退回新等级的持有/需求。
     */
    private async openUpgraded(level: number, consumed: ZCUpgradeStatus | null): Promise<void> {
        const open = this.options.popups.openUpgraded;
        const card = this.options.model.snapshot.data.card;
        if (!open || this.isDisposed || !card) return;
        const lineup = this.lineup;
        const cardClass: ZCCardClass = lineup ? resolveCardClass(card, lineup) : 'tank';
        const className = lineup ? cardClassName(cardClass, lineup) : card.traits?.attack ?? '';
        let chrome: ICardUpgradedChrome = { background: null, frame: null };
        let classIcon: SpriteFrame | null = null;
        let heroPrefab: Prefab | null = null;
        const provider = this.options.upgradedArt;
        if (provider) {
            try {
                [chrome, classIcon, heroPrefab] = await Promise.all([
                    provider.loadChrome(card.rarity),
                    provider.loadClassIcon(cardClass),
                    this.loadUnitPrefab(card, provider),
                ]);
            } catch (error) {
                console.warn('[CardUpgradeController] 升级弹窗美术加载失败', error);
            }
        }
        if (this.isDisposed) return;
        if (!chrome.background) {
            console.warn('[CardUpgradeController] 升级弹窗背景缺失，跳过展示');
            return;
        }
        const snapshot = this.options.model.snapshot;
        const hp = snapshot.detail?.stats.find(line => line.key === 'hp');
        const attack = snapshot.detail?.stats.find(line => line.key === 'attack');
        const consumedRow = consumed?.requirements.find(row => row.key === 'card') ?? consumed?.requirements[0];
        const nextRow = snapshot.status?.requirements.find(row => row.key === 'card') ?? snapshot.status?.requirements[0];
        const row = consumedRow ?? nextRow;
        const need = row?.need ?? 0;
        const owned = consumedRow ? need : Math.min(row?.owned ?? 0, need);
        const ratio = need > 0 ? Math.min(1, Math.max(0, owned / need)) : 0;
        const bonus = formatCritDamageGain(snapshot.detail?.critDamageGain ?? 0);
        open({
            background: chrome.background,
            frame: chrome.frame,
            hero: this.art?.hero ?? null,
            heroPrefab,
            quality: this.art?.diamond ?? null,
            classIcon,
            name: card.name,
            className,
            levelText: `${level}级`,
            progressText: need > 0 ? `${owned}/${need}` : '',
            progressRatio: ratio,
            hpValue: hp?.value ?? '',
            hpGain: hp?.gain ?? '',
            attackValue: attack?.value ?? '',
            attackGain: attack?.gain ?? '',
            bonusText: bonus ? `所有单位暴击伤害提升<color=#1E9007>${bonus}</color>` : '',
        });
    }
    private async submit(): Promise<void> {
        const { model, repository } = this.options;
        if (!model.canSubmit || this.isDisposed) return;
        this.refreshRevision++;
        model.setPhase('submitting'); this.publish();
        this.releaseLoading = this.options.loading.beginLoading();
        try {
            const consumed = model.snapshot.status;
            const result = await repository.upgradeHero(model.heroId, this);
            if (this.isDisposed) return;
            if (result.kind === 'success') {
                model.confirm(result.level);
                repository.applyHeroLevel(result.heroId, result.level);
                EventMgr.instance.emit(CardLineupEvent.HeroUpgraded, { heroId: result.heroId, level: result.level });
                if (this.isDisposed) return;
                this.publish(); await this.refresh();
                if (this.isDisposed) return;
                // 先收起“升级中”，让成功弹窗自己承担出入场；刷新失败也不改升级结果。
                this.stopLoading();
                await this.openUpgraded(result.level, consumed);
            } else { model.setPhase(result.kind); this.publish(); }
        } catch (error) {
            if (!this.isDisposed) { model.setPhase('failed'); this.publish(); this.options.failed(error); }
        } finally { this.stopLoading(); }
    }
}
