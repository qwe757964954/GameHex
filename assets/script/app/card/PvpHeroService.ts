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
    /** 技能等级表；服务端缺省时归一成空数组，消费方不用判 null。 */
    readonly skills: readonly PvpHeroSkillLevel[];
}

let cachedInfos: readonly PvpHeroInfo[] | null = null;
let pendingRequest: Promise<readonly PvpHeroInfo[] | null> | null = null;

/**
 * 拉取 PVP 英雄列表。null 表示没有可用后端数据，空数组表示服务端确认没有英雄。
 * 并发调用合并成一个请求，成功结果留给布阵弹窗复用。
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
 * 取单个英雄。缓存为空返回 null；技能升级后缓存已写回，这里读到的是服务端确认值。
 */
export function getCachedPvpHeroInfo(heroId: number): PvpHeroInfo | null {
    if (!cachedInfos) return null;
    return cachedInfos.find((info) => info.heroId === heroId) ?? null;
}

/**
 * 把升级成功后的等级写回缓存。不补这一步，再打开布阵面板看到的还是旧等级。
 * 缓存为空时忽略，页面会重新拉一次；技能表缺省时保留原值，避免升等级把技能清空。
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
 * 把技能升级结果写回缓存。技能不在缓存里时追加，不丢服务端新开的内容。
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
    // 用 Array.from 而不是展开 Map：构建期 Babel 的 loose 模式会把展开降级成 concat，
    // concat 不展开迭代器，调用方拿到的列表长度恒为 1。
    return Array.from(result.values());
}

/**
 * 技能表归一化：过滤非法项、按 skillId 去重升序，返回新数组避免外部改到缓存。
 */
function normalizeHeroSkills(skills: CmdPvpHeroInfo['skills']): readonly PvpHeroSkillLevel[] {
    const result = new Map<number, PvpHeroSkillLevel>();
    for (const skill of skills ?? []) {
        if (!skill) continue;
        // 协议字段是 id，语义与请求体的 skillId 同一位。
        const skillId = Number(skill.id);
        const level = Number(skill.level);
        if (!Number.isSafeInteger(skillId) || skillId <= 0 || !Number.isSafeInteger(level) || level < 0) {
            console.warn('[PvpHeroService] 服务端返回了非法技能等级数据，已跳过', skill);
            continue;
        }
        result.set(skillId, { skillId, level });
    }
    return Array.from(result.values()).sort((a, b) => a.skillId - b.skillId);
}
