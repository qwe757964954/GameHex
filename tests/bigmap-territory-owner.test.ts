/**
 * 势力范围**归属染色**的回归（2026-10-28 用户口径）：
 * 1. 无主势力按色板上色、相邻不同色（`bigmap-territory-color.test.ts` 已守）；
 * 2. 其他玩家占据城池 → 那片范围变红；
 * 3. 我占据城池 → 那片范围变绿。
 *
 * 这里守的是 2 / 3 的**判据**，也就是 `IBigMapCityView.territoryOwner`。
 *
 * 为什么不能只看 `state === 'occupied'`：联机档的据点协议只给 `opType`（有人占了），
 * 到底是谁占的要靠 `SlgGameInfo.toCampId`；离线档没有 `toCampId`，本地进度里的「已占领」
 * 反过来就是**我**打的。两种档得各测一遍，否则红绿必然有一种是错的。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import {
    BigMapCampRepository,
    type IBigMapCampGateway,
} from '../assets/script/app/bigmap/application/BigMapCampRepository';
import {
    BigMapSlgRepository,
    type IBigMapSlgGateway,
    type IBigMapSlgRequestName,
} from '../assets/script/app/bigmap/application/BigMapSlgRepository';
import { bigMapTerritoryOwnerOf } from '../assets/script/app/bigmap/model/BigMapTerritoryColor';
import { parseBigMapSave, serializeBigMapSave } from '../assets/script/app/bigmap/model/BigMapSaveData';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();
const NOW = 1_000_000;
const CITY_IDS = [...config.cities.keys()].sort((a, b) => a - b);
const [MY_CITY, ENEMY_CITY, NEUTRAL_CITY] = CITY_IDS;

// ---------------------------------------------------------------------------
// 纯判定
// ---------------------------------------------------------------------------

test('归属三分：己方优先于「被占」，被占且不是我的就是他人，其余无主', () => {
    assert.equal(bigMapTerritoryOwnerOf(true, true), 'self', '我占的城就算 opType=1 也是己方（绿）');
    assert.equal(bigMapTerritoryOwnerOf(true, false), 'self', '所属城池即使服务端还没标已占领，也是己方');
    assert.equal(bigMapTerritoryOwnerOf(false, true), 'other', '被占但不是我的城 = 其他玩家（红）');
    assert.equal(bigMapTerritoryOwnerOf(false, false), 'neutral', '没被占 = 走色板');
});

// ---------------------------------------------------------------------------
// 联机档：opType 只说明「有人占」，归属认 toCampId
// ---------------------------------------------------------------------------

class SlgGateway implements IBigMapSlgGateway {
    readonly calls: IBigMapSlgRequestName[] = [];
    listener: ((kind: 'game' | 'build') => void) | null = null;
    constructor(private readonly toCampId: number) {}
    request(name: IBigMapSlgRequestName): Promise<unknown> {
        this.calls.push(name);
        if (name === 'CmdSlgGameInfoReqMsg') return Promise.resolve({ info: { maxMonsterLevel: 5, toCampId: this.toCampId } });
        if (name === 'CmdSlgBuildInfoReqMsg') return Promise.resolve({ info: { builds: [], queues: [], unlockQueue: 1 } });
        if (name === 'CmdSlgActionUpdateReqMsg') return Promise.resolve({ info: { nextRevertTime: 20 } });
        return Promise.resolve({});
    }
    subscribe(listener: (kind: 'game' | 'build') => void): () => void {
        this.listener = listener;
        return () => { this.listener = null; };
    }
}

class CampGateway implements IBigMapCampGateway {
    constructor(private readonly infos: readonly { campId: number; opType: 0 | 1; state: 0 | 1 | 2 | 3 }[]) {}
    fetchSimple(campIds: readonly number[]): Promise<unknown> {
        return Promise.resolve({ infos: this.infos.filter((info) => campIds.includes(info.campId)) });
    }
    fetchDetail(campIds: readonly number[]): Promise<unknown> { return this.fetchSimple(campIds); }
    fetchRoles(): Promise<unknown> { return Promise.resolve({ infos: [] }); }
    requestMove(): Promise<unknown> { return Promise.resolve({}); }
    subscribeRoleEvents(): () => void { return () => undefined; }
}

async function onlinePresenter(): Promise<BigMapPresenter> {
    const slg = new BigMapSlgRepository(new SlgGateway(MY_CITY), config, () => NOW, 100);
    const camps = new BigMapCampRepository(new CampGateway([
        // 我的城被标已占领；另一座被别的玩家占了；第三座还开着。
        { campId: MY_CITY, opType: 1, state: 1 },
        { campId: ENEMY_CITY, opType: 1, state: 1 },
        { campId: NEUTRAL_CITY, opType: 0, state: 1 },
    ]), () => NOW);
    const presenter = new BigMapPresenter({
        config,
        storage: { read: () => { throw new Error('联机不能读取离线基地'); }, write: () => {} },
        saveKey: 'territory-owner-online',
        adventureChapter: () => 10,
        now: () => NOW,
        campRepository: camps,
        slgRepository: slg,
    });
    assert.equal(await presenter.initializeSlg(), true);
    await presenter.refreshVisibleCamps([MY_CITY, ENEMY_CITY, NEUTRAL_CITY]);
    return presenter;
}

test('联机档：我的城染绿，其他玩家占的城染红，没被占的走色板', async () => {
    const presenter = await onlinePresenter();
    assert.equal(presenter.cityView(MY_CITY)?.territoryOwner, 'self');
    assert.equal(presenter.cityView(MY_CITY)?.isPlayerCamp, true);
    assert.equal(presenter.cityView(ENEMY_CITY)?.territoryOwner, 'other');
    assert.equal(presenter.cityView(ENEMY_CITY)?.isPlayerCamp, false);
    assert.equal(presenter.cityView(NEUTRAL_CITY)?.territoryOwner, 'neutral');
    presenter.dispose();
});

test('联机档：还没查到据点状态的城按无主处理，不猜成「别人的红」', () => {
    const slg = new BigMapSlgRepository(new SlgGateway(MY_CITY), config, () => NOW, 100);
    const presenter = new BigMapPresenter({
        config,
        storage: { read: () => { throw new Error('联机不能读取离线基地'); }, write: () => {} },
        saveKey: 'territory-owner-online-empty',
        adventureChapter: () => 10,
        now: () => NOW,
        campRepository: new BigMapCampRepository(new CampGateway([]), () => NOW),
        slgRepository: slg,
    });
    assert.equal(presenter.cityView(ENEMY_CITY)?.territoryOwner, 'neutral');
    presenter.dispose();
});

// ---------------------------------------------------------------------------
// 离线档：本地「已占领」就是我自己打的
// ---------------------------------------------------------------------------

function offlinePresenter(occupiedCityIds: readonly number[]): BigMapPresenter {
    const fresh = parseBigMapSave(null, config, NOW).save;
    const text = serializeBigMapSave({ ...fresh, battle: { ...fresh.battle, occupiedCityIds: [...occupiedCityIds] } });
    return new BigMapPresenter({
        config,
        storage: { read: () => text, write: () => {} },
        saveKey: 'territory-owner-offline',
        adventureChapter: () => 10,
        now: () => NOW,
    });
}

test('离线档：自己打下的城染绿（不能因为「已占领」就刷成别人的红）', () => {
    const presenter = offlinePresenter([MY_CITY]);
    assert.equal(presenter.playerCampId, 0, '离线档没有 toCampId');
    assert.equal(presenter.cityView(MY_CITY)?.state, 'occupied');
    assert.equal(presenter.cityView(MY_CITY)?.territoryOwner, 'self');
    assert.equal(presenter.cityView(ENEMY_CITY)?.territoryOwner, 'neutral');
    presenter.dispose();
});

test('离线档：一座都没占时全图都是无主色（不出现红绿）', () => {
    const presenter = offlinePresenter([]);
    for (const city of presenter.allCityViews()) {
        assert.equal(city.territoryOwner, 'neutral', `城池 ${city.cityId} 不该有归属色`);
    }
    presenter.dispose();
});
