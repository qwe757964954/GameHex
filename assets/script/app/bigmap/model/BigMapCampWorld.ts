import { hexGridNeighborIds } from '../../../core/hex/HexGridLayout';
import type { IBigMapCityConfig, IBigMapConfig } from './BigMapTypes';
import type { IBigMapLayout, IBigMapLayoutCity } from './BigMapLayout';
import { placeBigMapCities } from './BigMapWorld';

/** 正式城池身份由 DM 表提供。旧表仅保留离线预览数值；正式开战/结算仍由服务端处理。 */
export function withBigMapCampCities(config: IBigMapConfig): IBigMapConfig {
    const camps = [...config.camps.values()].sort((a, b) => a.campId - b.campId);
    const levels = [...config.cityLevels.values()].sort((a, b) => a.level - b.level);
    if (!levels.length) throw new Error('[BigMap] 缺少城池预览等级配置');
    const cities = new Map<number, IBigMapCityConfig>();
    for (const camp of camps) {
        const group = camps.filter((item) => item.occupyType === camp.occupyType);
        const legacy = config.cities.get(camp.campId);
        const level = levels.filter((item) => item.level <= camp.chapter).pop() ?? levels[0];
        cities.set(camp.campId, {
            cityId: camp.campId, name: camp.name, layer: camp.occupyType,
            available: camp.occupyType === 1, cityLevel: level.level,
            unlockChapter: camp.chapter, openDay: camp.openDay, staminaCost: camp.staminaCost,
            defenseHp: legacy?.defenseHp ?? level.defenseHp,
            radiateCapacity: legacy?.radiateCapacity ?? 1,
            cityLevelCoeff: legacy?.cityLevelCoeff ?? level.cityLevelCoeff,
            prevCityId: 0, rewardCoin: 0, desc: camp.desc,
            slot: group.findIndex((item) => item.campId === camp.campId), slotCount: group.length,
        });
    }
    return { ...config, cities };
}

/** 保留有效锚点、怪物与基地；新增城池复用原环位算法，重新分配相连且不重叠的势力范围。 */
export function completeBigMapCampLayout(config: IBigMapConfig, layout: IBigMapLayout): IBigMapLayout {
    const kept = layout.cities.filter((city) => config.cities.has(city.cityId));
    if (kept.length === layout.cities.length && kept.length === config.cities.size) return layout;
    const keptIds = new Set(kept.map((city) => city.cityId));
    const reserved = new Set([
        ...kept.flatMap((city) => [...city.hexIds]),
        ...layout.monsters.flatMap((monster) => [...monster.hexIds]),
        ...layout.bases.map((base) => base.hexId), ...layout.blocked,
        ...layout.points.flatMap((point) => [...point.hexIds]),
    ]);
    const missing = new Map([...config.cities].filter(([id]) => !keptIds.has(id)));
    const added = placeBigMapCities({ ...config, cities: missing }, layout.terrainSeed, reserved);
    if (added.size !== missing.size) throw new Error('[BigMap] 当前地图无法容纳全部城池');
    const cities: IBigMapLayoutCity[] = [...kept, ...[...added.values()].map((site) => ({
        cityId: site.cityId, anchorHexId: site.anchorHexId, hexIds: site.hexIds, ring: site.ring,
        rangeHex: [], adjacentCityIds: [], label: config.cities.get(site.cityId)?.name ?? String(site.cityId),
    }))].sort((a, b) => a.cityId - b.cityId);
    const regions = cities.map((city) => ({ city, rangeHex: [] as number[], adjacent: new Set<number>() }));
    type Region = typeof regions[number];
    const owners = new Map<number, Region>();
    const queue: { id: number; owner: Region }[] = [];
    for (const owner of regions) for (const id of owner.city.hexIds) {
        owners.set(id, owner); owner.rangeHex.push(id); queue.push({ id, owner });
    }
    // 多源 BFS：同距离由城池 ID 兜底，格子只归属一次，各城范围从自己的占格连通扩展。
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const { id, owner } = queue[cursor];
        for (const next of hexGridNeighborIds(id, layout.rows, layout.columns)) {
            const other = owners.get(next);
            if (other) {
                if (other !== owner) { owner.adjacent.add(other.city.cityId); other.adjacent.add(owner.city.cityId); }
                continue;
            }
            owners.set(next, owner);
            owner.rangeHex.push(next);
            queue.push({ id: next, owner });
        }
    }
    return { ...layout, cities: regions.map(({ city, rangeHex, adjacent }) => ({ ...city,
        rangeHex: rangeHex.sort((a, b) => a - b),
        adjacentCityIds: [...adjacent].sort((a, b) => a - b),
    })) };
}
