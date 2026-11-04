import type { CardUpgradePhase, CardUpgradePresentation, ICardUpgradeOpenData } from './CardPresentations';
import type { ZCUpgradeStatus } from './CardUpgradeCost';
import type { CardDetailPresentation } from './CardDetailPresenter';

export class CardUpgradeModel {
    private level: number;
    private status: ZCUpgradeStatus | null = null;
    private phase: CardUpgradePhase = 'loading';
    private detail: CardDetailPresentation | null = null;
    constructor(private readonly data: ICardUpgradeOpenData) { this.level = data.level; }
    get snapshot(): CardUpgradePresentation {
        return { data: this.data, cardId: this.data.cardId, level: this.level, status: this.status, phase: this.phase, detail: this.detail };
    }
    get heroId(): number { return Number(this.data.cardId); }
    get canSubmit(): boolean {
        return Number.isSafeInteger(this.heroId) && this.heroId > 0 && !!this.status?.canUpgrade && this.phase !== 'loading' && this.phase !== 'submitting';
    }
    setPhase(phase: CardUpgradePhase): void { this.phase = phase; }
    setStatus(status: ZCUpgradeStatus): void { this.status = status; this.phase = 'ready'; }
    /** 详情数据到货（成功给值；失败给 null 占位，不影响升级面板）。 */
    setDetail(detail: CardDetailPresentation | null): void { this.detail = detail; }
    confirm(level: number): void { this.level = level; this.status = null; this.phase = 'loading'; }
}
