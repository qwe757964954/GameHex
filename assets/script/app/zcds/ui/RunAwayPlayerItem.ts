import { _decorator, Component, Label, ProgressBar, Sprite, SpriteFrame } from 'cc';

const { ccclass, property, disallowMultiple } = _decorator;

/** 伤害统计中的一行数据；最大值由父面板统一计算，保证各行可比较。 */
export interface RunAwayPlayerInfo {
    name: string;
    headSpriteFrame: SpriteFrame | null;
    /** 造成伤害。 */
    damage: number;
    /** 承受伤害。 */
    damageTaken: number;
    /** 伤害列的统一最大值；省略时以本行数值为上限。 */
    maxDamage?: number;
    /** 承伤列的统一最大值；省略时以本行数值为上限。 */
    maxDamageTaken?: number;
}

/** RunAwayPlayerItem.prefab 的展示组件，不执行撤退或对局结算。 */
@ccclass('RunAwayPlayerItem')
@disallowMultiple
export class RunAwayPlayerItem extends Component {
    @property({ type: Sprite, tooltip: 'AvatarFrame：头像装饰框' })
    avatarFrame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Avatar：玩家头像' })
    avatar: Sprite = null!;

    @property({ type: Label, tooltip: 'PlayerNameLabel：玩家昵称' })
    nameLabel: Label = null!;

    @property({ type: ProgressBar, tooltip: 'DamageProgress：造成伤害进度条' })
    damageProgress: ProgressBar = null!;

    @property({ type: ProgressBar, tooltip: 'DamageTakenProgress：承受伤害进度条' })
    damageTakenProgress: ProgressBar = null!;

    @property({ type: Label, tooltip: 'DamageValueLabel：造成伤害数值' })
    damageLabel: Label = null!;

    @property({ type: Label, tooltip: 'DamageTakenValueLabel：承受伤害数值' })
    damageTakenLabel: Label = null!;

    /** 刷新昵称、头像及伤害数据；空头像会清理上一位玩家的图片。 */
    public refresh(info: Readonly<RunAwayPlayerInfo>): void {
        const damage = this.normalize(info.damage);
        const damageTaken = this.normalize(info.damageTaken);
        this.nameLabel.string = info.name;
        this.avatar.spriteFrame = info.headSpriteFrame;
        this.damageLabel.string = String(damage);
        this.damageTakenLabel.string = String(damageTaken);
        this.damageProgress.progress = this.ratio(damage, info.maxDamage ?? damage);
        this.damageTakenProgress.progress = this.ratio(damageTaken, info.maxDamageTaken ?? damageTaken);
    }

    /** 列表项回收或面板清空时调用。 */
    public clear(): void {
        this.refresh({ name: '', headSpriteFrame: null, damage: 0, damageTaken: 0 });
    }

    private normalize(value: number): number {
        return Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value))) : 0;
    }

    private ratio(value: number, maximum: number): number {
        const limit = this.normalize(maximum);
        return limit > 0 ? Math.min(1, value / limit) : 0;
    }
}
