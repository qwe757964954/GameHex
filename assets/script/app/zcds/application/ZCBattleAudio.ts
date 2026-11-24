import { GAME_AUDIO, GAME_AUDIO_ROOT } from '../../ResConst';
import type { ZCAttackTrait } from '../model/ZCCombatCatalog';
import type { ZCCombatEvent } from '../model/ZCGameTypes';
import { ZCOwner } from '../model/ZCMapConfig';

export interface IZCBattleAudioSource {
    readonly trait: ZCAttackTrait;
    readonly attackSkillId: number;
    /**
     * 这条攻击档案上登记的**主动技能**行（武将技 `empoweredSkillId` / 副轨 `secondarySkillId`）。
     *
     * 「技能」音效只认这几条：被动触发的纯表现事件（冲锋护盾 / 召唤 / 践踏落点）也带着
     * 自己的 `skillId` 走在同一条 `combatEvents` 上，只按「skillId ≠ 普攻」去判会把它们
     * 一起当成主动技能，玩家就会听见「没放技能却有技能音」。
     * 缺省 / 空数组 ⇒ 这张卡没有主动技能行。
     */
    readonly activeSkillIds?: readonly number[];
}

type ZCAudibleEvent = Readonly<Pick<ZCCombatEvent, 'id' | 'owner' | 'sourceUnitId' | 'type' | 'skillId' | 'startedAt' | 'empowered'>>
    & Partial<Pick<ZCCombatEvent, 'beamHold' | 'damage' | 'effectKey' | 'effectPrefabPath'>>;

/**
 * 同一个 key 在这么多秒内只响一次。
 *
 * 用户口径（2026-11-23）：「同一时间有两个相同的音效播放，只播 1 个即可」——
 * 一排同职业单位同一拍出手、或一条技能在同一帧推好几条事件，都不该叠成一片噪音。
 */
const MIN_CLIP_INTERVAL_SECONDS = 0.18;

/**
 * 战斗音效（用户 2026-11-23）。
 *
 * 口径：
 *  1. **只播本机玩家这一方**（`event.owner === 'player'`）：敌方 / NPC 席位打出同样的职业与技能，
 *     一律静音，否则玩家读不出「这一发是我打的」。
 *  2. **普攻**按攻击方职业取 `<职业>普攻`；**主动技能**取 `<职业>技能`，且只在真正施法那一拍播
 *     （`empowered` 武将技 / `activeSkillIds` 里的技能行），命中余韵 / 末端爆炸 / 被动表现都不播。
 *  3. 同 key 在 {@link MIN_CLIP_INTERVAL_SECONDS} 内只响一次（跨事件、跨单位一起合并）。
 */
export class ZCBattleAudio {
    private seen = new Set<number>();
    private active = new Set<number>();
    private readonly lastPlayedAt = new Map<string, number>();
    present(events: readonly ZCAudibleEvent[], now: number, sourceOf: (id: number) => IZCBattleAudioSource | undefined,
        play: (key: string) => void, projectiles?: readonly ZCAudibleEvent[]): void {
        this.presentEvents(events, now, sourceOf, play);
        if (projectiles) this.presentEvents(projectiles, now, sourceOf, play);
        const previous = this.seen;
        this.seen = this.active;
        this.active = previous;
        this.active.clear();
    }

    private presentEvents(events: readonly ZCAudibleEvent[], now: number, sourceOf: (id: number) => IZCBattleAudioSource | undefined,
        play: (key: string) => void): void {
        for (const event of events) {
            if (event.startedAt > now) continue;
            if (this.active.has(event.id)) continue;
            this.active.add(event.id);
            if (this.seen.has(event.id)) continue;
            const key = this.clipOf(event, sourceOf);
            if (!key || now - (this.lastPlayedAt.get(key) ?? -Infinity) < MIN_CLIP_INTERVAL_SECONDS) continue;
            this.lastPlayedAt.set(key, now);
            play(key);
        }
    }

    private clipOf(event: ZCAudibleEvent, sourceOf: (id: number) => IZCBattleAudioSource | undefined): string {
        // 只播玩家这方：敌方 / NPC 打出的同职业技能不响（用户 2026-11-23 第 1 条）。
        if (event.owner !== ZCOwner.Player) return '';
        if (event.beamHold || event.effectKey === 'hit') return '';
        if (event.type === 'area' && (event.effectPrefabPath?.includes('爆炸') || event.effectPrefabPath?.includes('导弹技能命中'))) {
            return GAME_AUDIO.explosion;
        }
        const source = sourceOf(event.sourceUnitId);
        if (!source || event.skillId <= 0) return '';
        // 武将技那一击：多数卡沿用普攻的技能行、只放大表现 ⇒ 只能靠 `empowered` 认。
        if (event.empowered) return this.skillClipOf(source);
        if (event.skillId === source.attackSkillId) {
            // 普攻只认「出手」这一拍：命中爆炸 / 落点这些 0 伤害的地面表现不重复响。
            if (event.type === 'area' && event.damage === 0) return '';
            return `${GAME_AUDIO_ROOT}/${source.trait}普攻`;
        }
        // 其它技能行：只认主动技能，且必须真的结算了伤害 —— 末端爆炸 / 命中附加特效 / 被动表现
        // 都带着主动技能的 id、但 damage 为 0，那些是同一发的余韵，再响一次就是「放一次技能响两下」。
        if ((source.activeSkillIds ?? []).includes(event.skillId) && (event.type !== 'area' || (event.damage ?? 0) > 0)) {
            return this.skillClipOf(source);
        }
        return '';
    }

    private skillClipOf(source: IZCBattleAudioSource): string {
        return `${GAME_AUDIO_ROOT}/${source.trait}技能`;
    }
}
