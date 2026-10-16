import { RequestPvpHeroInfoList } from '../generated/requestMsg/RequestPvpMsg';
import { GameNet } from '../net/GameNet';

/** 单个 PVP 技能等级（后端 `CmdPvpHeroSkillInfo`）。 */
export interface PvpHeroSkillLevel {
    skillId: number;
    level: number;
}

/** 卡牌页实际消费的、经过边界校验的英雄信息。 */
export interface PvpHeroInfo {
    heroId: number;
    level: number;
    /**
     * 英雄的技能等级表（后端 `CmdPvpHeroInfo.skills`）。
     *
     * 服务端可能给空数组（没技能 / 老数据），也可能整个字段缺省 —— 两种都归一成
     * **空数组**，消费方不必判 `null`。
     */
    readonly skills: readonly PvpHeroSkillLevel[];
}

let cachedInfos: readonly PvpHeroInfo[] | null = null;
let pendingRequest: Promise<readonly PvpHeroInfo[] | null> | null = null;

/**
 * 拉取角色的 PVP 英雄列表。
 *
 * 返回 `null` 表示当前没有可用的后端数据（未连接、请求失败）；空数组则是服务端明确返回空列表。
 * 并发调用会合并成同一个请求，成功结果会留给布阵弹窗复用。
 */
export function fetchPvpHeroInfos(): Promise<readonly PvpHeroInfo[] | null> {
    if (pendingRequest) return pendingRequest;
    pendingRequest = requestPvpHeroInfos().finally(() => {
        pendingRequest = null;
    });
    return pendingRequest;
}

/** 读取最近一次成功响应；布阵弹窗用它避免重复发包。 */
export function getCachedPvpHeroInfos(): readonly PvpHeroInfo[] | null {
    return cachedInfos;
}

/**
 * 把「刚升级成功」的新等级写回本地缓存。
 *
 * 升级响应（`CmdPvpHeroUpLevelRspMsg`）只回一条 `CmdPvpHeroInfo`，
 * **不会**顺带刷新整份英雄列表缓存，而 `LineupBoardPage.refresh()` 在
 * `getCachedPvpHeroInfos()` 非空时是**不再发包**的 —— 不补这一步，
 * 升完级打开布阵面板看到的还是旧等级。
 *
 * 缓存为空（从未成功拉过列表）时直接忽略：那种情况下页面一定会去发一次请求，
 * 服务端返回的就是最新值，凭空造一份只有一条的缓存反而会把别的英雄挤没。
 *
 * ⚠️ 技能等级**原样搬运**（响应里带 `skills` 就整份替换），不能因为只升了等级
 * 就把技能清空 —— 升完英雄等级打开技能页会看到技能全没了。
 */
export function applyPvpHeroLevel(heroId: number, level: number, skills?: readonly PvpHeroSkillLevel[]): void {
    if (!cachedInfos) return;
    if (!Number.isSafeInteger(heroId) || heroId <= 0) return;
    if (!Number.isSafeInteger(level) || level < 0) return;

    let replaced = false;
    const next = cachedInfos.map((info) => {
        if (info.heroId !== heroId) return info;
        replaced = true;
        return { heroId, level, skills: skills ?? info.skills };
    });
    // 列表里没有这条（服务端加了新英雄而本地缓存还旧）→ 追加，别丢。
    if (!replaced) next.push({ heroId, level, skills: skills ?? [] });
    cachedInfos = next;
}

/**
 * 把「刚升完技能」的新等级写回本地缓存。
 *
 * 与 {@link applyPvpHeroLevel} 同理：技能升级响应只回一条 `CmdPvpHeroInfo`，
 * 列表缓存不会自动刷新，不回写就会一直读到旧技能等级。
 *
 * 技能不存在于该英雄的缓存里（服务端刚给英雄开了新技能）→ **追加**而不是丢弃，
 * 与等级那条同口径：服务端加的东西客户端不该吃掉。
 */
export function applyPvpHeroSkillLevel(heroId: number, skillId: number, level: number): void {
    if (!cachedInfos) return;
    if (!Number.isSafeInteger(heroId) || heroId <= 0) return;
    if (!Number.isSafeInteger(skillId) || skillId <= 0) return;
    if (!Number.isSafeInteger(level) || level < 0) return;

    cachedInfos = cachedInfos.map((info) => {
        if (info.heroId !== heroId) return info;
        const skills = info.skills.some((skill) => skill.skillId === skillId)
            ? info.skills.map((skill) => (skill.skillId === skillId ? { skillId, level } : skill))
            : [...info.skills, { skillId, level }];
        return { ...info, skills };
    });
}

async function requestPvpHeroInfos(): Promise<readonly PvpHeroInfo[] | null> {
    const net = GameNet.instance;
    if (!net.isConnected) return cachedInfos;

    let response: CmdPvpHeroInfoListRspMsg | null = null;
    try {
        const ok = await net.send(new RequestPvpHeroInfoList(
            {},
            undefined,
            (rsp) => { response = rsp; },
        ), false);
        if (!ok || !response) return cachedInfos;
    } catch (error) {
        console.warn('[PvpHeroService] 请求 PVP 英雄列表失败，继续使用本地卡牌数据', error);
        return cachedInfos;
    }

    cachedInfos = normalizePvpHeroInfos(response.infos);
    return cachedInfos;
}

/** 去掉非法项，并按 heroId 去重；后出现的值覆盖前值。技能表同样归一化。 */
export function normalizePvpHeroInfos(infos: CmdPvpHeroInfoListRspMsg['infos']): readonly PvpHeroInfo[] {
    const result = new Map<number, PvpHeroInfo>();
    for (const info of infos ?? []) {
        if (!info) continue;
        const heroId = Number(info.heroId);
        const level = Number(info.level);
        if (!Number.isSafeInteger(heroId) || heroId <= 0 || !Number.isSafeInteger(level) || level < 0) {
            console.warn('[PvpHeroService] 服务端返回了非法英雄数据，已跳过', info);
            continue;
        }
        result.set(heroId, { heroId, level, skills: normalizeHeroSkills(info.skills) });
    }
    // 必须用 `Array.from` 而不是 `[...result.values()]`：构建期 Babel（loose）会把展开
    // 降级成 `[].concat(map.values())`，而 concat 不展开迭代器 → 返回的是 [MapIterator]，
    // 调用方拿到的「英雄列表」长度恒为 1 且元素不是 PvpHeroInfo。
    return Array.from(result.values());
}

/**
 * 技能等级表归一化：去非法项、按 skillId 去重（后值覆盖前值）、按 skillId 升序。
 *
 * ⚠️ **返回新数组**（技能列表本身也要冻结语义）：`applyPvpHeroSkillLevel` 靠
 * 「共享旧数组 + 生成新数组」表达更新，若这里返回服务端数组本身，
 * 缓存里的引用会被外部改到。
 */
function normalizeHeroSkills(skills: CmdPvpHeroInfo['skills']): readonly PvpHeroSkillLevel[] {
    const result = new Map<number, PvpHeroSkillLevel>();
    for (const skill of skills ?? []) {
        if (!skill) continue;
        // 后端字段名是 `id`（proto 注释写的是「等级」，但语义与请求体的 `skillId` 同一位），
        // 两个都读以防后端改口。
        const skillId = Number(skill.id ?? (skill as unknown as { skillId?: number }).skillId);
        const level = Number(skill.level);
        if (!Number.isSafeInteger(skillId) || skillId <= 0 || !Number.isSafeInteger(level) || level < 0) {
            console.warn('[PvpHeroService] 服务端返回了非法技能等级数据，已跳过', skill);
            continue;
        }
        result.set(skillId, { skillId, level });
    }
    return Array.from(result.values()).sort((a, b) => a.skillId - b.skillId);
}
