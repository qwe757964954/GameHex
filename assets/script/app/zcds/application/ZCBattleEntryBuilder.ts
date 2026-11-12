import type { IZCGamePreparedResources } from './ZCGamePreparedResources';
import type { IZCGameEntry } from './ZCGameEntry';
import type { ZCGameEntryParams } from './ZCGameEntry';
import { buildZCClientCombatConfig } from './ZCClientCombatConfig';
import { buildSeatProfiles, buildSeatUnitIds } from '../model/ZCRankBoard';

/** 单次返回参数随导航传递，领地页按章节与格子恢复焦点。 */
export function buildZCBattleReturnParams(entry: Pick<IZCGameEntry, 'slgBattleType' | 'pveContext'>) {
    const pve = entry.pveContext;
    return entry.slgBattleType ? { initialTab: 'world' }
        : pve ? { initialTab: 'territory', focusChapterId: pve.chapterId, focusCellId: pve.territoryCellId } : undefined;
}

export function resolveZCBattlePlayerCount(params?: ZCGameEntryParams): 2 | 3 | 4 | undefined {
    if (!params?.slgBattleType) return params?.pve?.playerCount;
    const count = params.battle?.units.length;
    if (count !== 2 && count !== 3 && count !== 4) throw new Error('SLG 开战数据缺少有效参战人数');
    return count;
}

/** 纯构筑：不修改预加载配置，不捕获存档服务或控制器回调。 */
export function buildZCBattleEntry(prepared: IZCGamePreparedResources, entry?: ZCGameEntryParams): IZCGameEntry {
    const battle = entry?.battle ?? null;
    const pve = entry?.pve;
    const captureOptions = { allowUnresolvedSelect: true } as const;
    const baseConfig = prepared.baseMatchConfig;
    const requestedEnemyCards = new Set((pve?.enemyCardIds ?? []).map(String));
    // 本地关卡名单仅供离线使用；提前裁剪会让正式回包中的英雄在构筑前就被丢掉。
    //
    // 🔴 例外是**塔防（首领）关**：它拿到 `battle` 也必须裁，否则「触发 npcCard 卡组」形同虚设 ——
    //    整份敌方卡池（36 张）全上，羁绊 / 卡组加成按整池算，`extraCards.enemy → npcTeam.npcCard`
    //    那套配置根本读不到（用户 2026-11-07）。塔防的敌人只有出怪表里的怪 + 首领，不靠玩家式英雄，
    //    裁掉不会丢服务端阵容：出怪卡由 `pveDefence.cards` 兜底查表，见 `ZCMatchRuntimeCompiler`。
    const clipToLevelCards = requestedEnemyCards.size > 0 && (!battle || pve?.mode === 'defence');
    const pveEnemyDeck = clipToLevelCards
        ? baseConfig.enemyDeck.filter((card) => requestedEnemyCards.has(card.id))
        : baseConfig.enemyDeck;
    const pveDefence = pve?.mode === 'defence' && pve.waves.length > 0 ? {
        cards: baseConfig.enemyDeck.filter(card => pve.waves.some(wave => String(wave.pvpCardId) === card.id)),
        waves: pve.waves
            .filter((wave) => wave.monsterCount > 0 && wave.showAtSeconds >= 0)
            .sort((a, b) => a.showAtSeconds - b.showAtSeconds || a.waveId - b.waveId)
            .map((wave) => ({
                waveId: wave.waveId,
                showAtSeconds: wave.showAtSeconds,
                cardId: String(wave.pvpCardId),
                monsterCount: wave.monsterCount,
                // 波次只决定出怪计划；战斗倍率统一来自服务端 buffInfo。
                tier: 1,
                // 只随配置走 `isBoss`：BOSS 波决定 HUD 大血条与「击败首领才算赢」。
                ...(wave.isBoss ? { isBoss: true } : {}),
                // 怪物体型（`defenceModWave.monsterSize`）只在 >1 时写：1 是普通体型，
                // 写进去也只是让对局多做一次无效乘算。
                ...(wave.monsterSize && wave.monsterSize > 1 ? { monsterSize: wave.monsterSize } : {}),
            })),
    } : undefined;
    let matchConfig = baseConfig;
    if (pve) {
        matchConfig = Object.assign({}, baseConfig);
        // 关卡「翻地块频率」：只压 NPC 的翻地块速度（对局内 `runEnemyAI` 的最小间隔）。
        const openGrideTime = Number(pve.openGrideTime);
        if (Number.isFinite(openGrideTime) && openGrideTime > 0) {
            matchConfig.openGrideTime = openGrideTime;
        }
        // 关卡「NPC 抽卡品质乘数」：有配置就带上，缺省不写（对局内按原表权重抽）。
        if (pve.gradeProModifier) matchConfig.gradeProModifier = pve.gradeProModifier;
        if (pveEnemyDeck.length > 0) matchConfig.enemyDeck = pveEnemyDeck;
        if (pveDefence?.waves.length) matchConfig.pveDefence = pveDefence;
    }
    const clientCombat = buildZCClientCombatConfig(
        matchConfig,
        battle,
        entry?.selfRoleId,
        captureOptions,
    );
    const selfRoleId = entry?.selfRoleId;
    let playerAvatars: IZCGameEntry['playerAvatars'] = null;
    let seatProfiles: IZCGameEntry['seatProfiles'] = [];
    let seatUnitIds: IZCGameEntry['seatUnitIds'] = [];
    if (battle?.units?.length) {
        const sorted = battle.units.slice().sort((a, b) => a.campId - b.campId);
        const self = (selfRoleId ? sorted.find((u) => u.roleId === selfRoleId) : undefined) ?? sorted[0];
        const foe = sorted.find((u) => u !== self) ?? sorted[1];
        playerAvatars = { player: self?.avatarId ?? '', enemy: foe?.avatarId ?? '' };
        // 对局内排行榜按 2~4 席逐行渲染，必须把全量档案随 entry 一起交接。
        // `buildSeatProfiles` 返回 Map：release 构建会把 `[...map]` 降级成 `[].concat(map)`，
        // 而 concat 不展开迭代器 ⇒ 变成 `[Map]` ⇒ `new Map([[Map]])` 的**值是 undefined**
        // ⇒ HUD 里 `profile.headKey` 崩，整局停在空白（报错点在 setSeatProfiles，真凶在这行）。
        // ⚠️ 展开源是**函数返回值**，不是 `.keys()/.values()/.entries()`，正则判据容易漏。
        seatProfiles = Array.from(buildSeatProfiles(battle.units, selfRoleId ?? null));
        // 战斗统计要按**服务端单元 id** 归属，同一份席位分配逻辑派生（见 buildSeatUnitIds）。
        seatUnitIds = Array.from(buildSeatUnitIds(battle.units, selfRoleId ?? null));
    }
    return {
        resources: prepared,
        battleSeed: battle?.seed ?? null,
        matchConfig: clientCombat.config,
        playerAvatars, seatProfiles, seatUnitIds,
        pveContext: pve ? { chapterId: pve.chapterId, territoryCellId: pve.territoryCellId, levelId: pve.levelId } : null,
        slgBattleType: entry?.slgBattleType ?? null,
        // 结算等广播认这个字段：匹配入口的 battleType（宝箱栏「开始战斗」= 1002）必须一路带到这里，
        // 否则运行时 `battleType` 落到 null ⇒ 不等 `CmdBattleResultBroMsg` ⇒ 结算页奖励区空着。
        battleType: entry?.battleType ?? entry?.slgBattleType ?? null,
    };
}
