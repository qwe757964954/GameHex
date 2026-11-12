import { visibleLineupCards } from '../assets/script/app/card/CardLineupTypes';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as detailPresenter from '../assets/script/app/card/CardDetailPresenter';
import * as critDamage from '../assets/script/app/card/CardDetailCritDamage';
import * as levelAttr from '../assets/script/app/card/CardLevelAttr';
import * as upgradeCost from '../assets/script/app/card/CardUpgradeCost';
import * as lineupPower from '../assets/script/app/card/CardLineupPower';
import * as skillList from '../assets/script/app/card/CardSkillList';
import { resolveSelectedDeck } from '../assets/script/app/card/LineupPresets';

test('真实详情仓库返回完整卡库与最新缓存等级，不借用卡库为空的首帧快照', async () => {
    const catalog = [{ id: '1' }, { id: '2' }, { id: '3' }];
    let infos: Array<{ heroId: number; level: number }> | null = [{ heroId: 2, level: 7 }];
    let networkCalls = 0;
    const exports: Record<string, any> = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/card/CardRepository.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    runInNewContext(code, { exports, console, require: name => {
        if (name === './CardLineupDecks') return { loadPvpCatalogCards: async () => catalog, currentDeckBonuses: () => ({}) };
        if (name === './LineupSnapshot') return { readLineupSnapshot: () => ({ cards: [catalog[0]], levels: { '1': 4 } }) };
        if (name === './PvpHeroService') return {
            getCachedPvpHeroInfos: () => infos,
            fetchPvpHeroInfos: () => { networkCalls++; throw new Error('切卡不应发起英雄列表请求'); },
        };
        if (name === './CardLineupTypes') return { visibleLineupCards };
        return {};
    } });
    const repository = new exports.RuntimeCardRepository();
    assert.equal(repository.loadLineupSnapshot(), null, '配置未就绪前不发布不完整快照');
    repository.artConfig = {};
    assert.equal(repository.loadLineupSnapshot().catalog.length, 0);
    const data = await repository.loadDetailNavigation();
    assert.deepEqual(Array.from(data.catalog), catalog);
    assert.equal(data.heroLevels.get('2'), 7);
    assert.equal(data.heroListKnown, true);
    infos = [{ heroId: 2, level: 8 }];
    assert.equal((await repository.loadDetailNavigation()).heroLevels.get('2'), 8);
    infos = null;
    const offline = await repository.loadDetailNavigation();
    assert.deepEqual(Array.from(offline.catalog), catalog);
    assert.equal(offline.heroListKnown, false);
    assert.equal(offline.heroLevels.size, 0);
    assert.equal(networkCalls, 0);
});

test('真实详情仓库按当前卡牌和等级返回战力，升级表绝对值与攻击展示一致', async () => {
    const readRows = (name: string): Array<Record<string, any>> => {
        const table = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
        return table.v.map((values: unknown[]) => Object.fromEntries(table.k.map((key: string, i: number) => [key, values[i]])));
    };
    const cards = readRows('pvpCard');
    const levels = readRows('cardLevelUp');
    const growth = readRows('pvpUnitGrowth');
    const skillPlans = readRows('pvpSkillPlan');
    let heroInfos = [{ heroId: 68001, level: 2 }, { heroId: 68005, level: 10 }, { heroId: 68033, level: 50 }];
    let formations = [{ formationId: 1, selected: true, heroIds: [68001, 68005] }];
    let formationRequests = 0;
    const exports: Record<string, any> = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/card/CardRepository.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    runInNewContext(code, { exports, console, require: name => {
        if (name === './CardDetailPresenter') return detailPresenter;
        if (name === './CardDetailCritDamage') return critDamage;
        if (name === './CardLevelAttr') return levelAttr;
        if (name === './CardUpgradeCost') return upgradeCost;
        if (name === './CardLineupPower') return lineupPower;
        if (name === './CardSkillList') return skillList;
        if (name === '../zcds/model/ZCCombatCatalog') return { getPlayerDeck: () => [] };
        //  详情页的「升级增加全队暴击伤害」读 pvpSkillPlan 的 109001 链。
        if (name === '../../framework/ref/RefUtil') return {
            RefUtil: { instance: { getRefAllAsync: async (table: string) => table === 'pvpSkillPlan' ? skillPlans : [] } },
        };
        if (name === './LineupPresets') return { resolveSelectedDeck };
        if (name === './LineupSnapshot') return { writeLineupSnapshot() {} };
        if (name === './FormationService') return {
            fetchFormations: async () => { formationRequests++; return formations; },
            getCachedFormations: () => formations,
        };
        if (name === './PvpHeroService') return { getCachedPvpHeroInfo: () => null, getCachedPvpHeroInfos: () => heroInfos };
        if (name === './CardLineupDecks') return {
            currentDeckBonuses: () => ({}),
            loadPvpHeroLevelCaps: async () => new Map(),
            loadPvpCardRawRow: async (id: string) => cards.find(card => String(card.id) === id),
            loadPvpCardRawRows: async () => cards,
            loadPvpCatalogCards: async () => cards.map(card => ({ ...card, id: String(card.id) })),
            loadCardLevelUpRows: async () => levels,
            loadPvpUnitGrowthRows: async () => growth,
            loadArmySkillLevelUpRows: async () => [],
        };
        if (name === './CardLineupTypes') return { visibleLineupCards };
        return {};
    } });
    const repository = new exports.RuntimeCardRepository();
    repository.loadArtConfig = async () => ({});
    for (const row of levels) {
        const detail = await repository.loadCardDetail(String(row.id), row.level);
        const attack = row.attrList.find((attr: { statId: string }) => attr.statId === 'attack').value;
        assert.equal(detail.powerText, String(attack), `${row.id} Lv.${row.level}`);
        assert.equal(detail.powerText, detail.stats.find((stat: { key: string }) => stat.key === 'attack').value);
    }
    for (const id of ['2001', '2002']) {
        assert.equal((await repository.loadCardDetail(id, 0)).powerText, '0');
    }
    //  暴击伤害按卡牌稀有度每级给固定百分点：绿 0.5 / 蓝 1 / 紫 2 / 金 3，取「目标等级」那一行。
    assert.equal((await repository.loadCardDetail('68001', 2)).critDamageGain, 0.5, '绿卡 68001 升到 3 级 +0.5%');
    assert.equal((await repository.loadCardDetail('68003', 12)).critDamageGain, 1, '蓝卡 68003 升到 13 级 +1%');
    assert.equal((await repository.loadCardDetail('68033', 50)).critDamageGain, 0, '满级没有下一档');
    assert.equal((await repository.loadCardDetail('2001', 1)).critDamageGain, 0, '建筑卡不在暴击链上');
    assert.equal((await repository.loadLineup(false)).power, 14 + 160, '只统计上阵卡，未上阵的 Lv.50 卡不计入');
    heroInfos = [{ heroId: 68001, level: 10 }, ...heroInfos.slice(1)];
    assert.equal((await repository.loadLineup(false, false)).power, 37 + 160, '升级后使用最新等级');
    assert.equal(formationRequests, 1, '升级重算战力不请求阵型');
    const cachedFormations = formations;
    formations = null;
    assert.equal((await repository.loadLineup(false, false)).formationsKnown, false);
    assert.equal(formationRequests, 1, '没有缓存也不因升级补发阵型请求');
    formations = cachedFormations;
    formations = [{ formationId: 1, selected: true, heroIds: [68033] }];
    assert.equal((await repository.loadLineup(false)).power, 5434, '切换出战阵容后重算');
    assert.equal(await repository.loadLineupPower(), 5434, '主界面共用同一战力结果');
    formations = [{ formationId: 1, selected: true, heroIds: [] }];
    assert.equal((await repository.loadLineup(false)).power, 0, '明确下阵后清零');
});
