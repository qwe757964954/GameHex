import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ZCClaimWave } from '../assets/script/app/zcds/view/ZCClaimWave';
import type { ZCHexView } from '../assets/script/app/zcds/view/ZCHexView';
import type { ZCFaction } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCClaimWaveCallbacks } from '../assets/script/app/zcds/view/ZCGameViewUtil';

/**
 * `ZCClaimWave` 是纯表现编排：时间表 / 进度 / 两端色全在 `ZCGameViewUtil` 的纯函数里，
 * 这里只验证它把纯函数结果按时间正确写进 `ZCHexView.setClaimWave`。用轻量 fake 视图，
 * 不依赖 cc（setClaimWave 内部直接写 tileSprite.color，无需真 Sprite）。
 */
type ClaimWave = Readonly<{ from: ZCFaction; to: ZCFaction; progress: number }> | null;

class FakeClaimHexView {
    public wave: ClaimWave = null;
    public setClaimWaveCalls = 0;

    setClaimWave(wave: ClaimWave): void {
        this.wave = wave;
        this.setClaimWaveCalls += 1;
    }
}

// 两座主城（0=player / 2=enemy）各带一个落在自己半区的中立邻格（1 / 3）。
const MAP = [
    { id: 0, x: 0, y: 0, neighbors: [1] },
    { id: 1, x: 1, y: 0, neighbors: [0] },
    { id: 2, x: 0, y: 2, neighbors: [3] },
    { id: 3, x: 1, y: 2, neighbors: [2] },
];

const HOMES = [0, 2];

const OWNER_OF = (id: number): ZCFaction => (id === 0 ? 'player' : id === 2 ? 'enemy' : 'neutral');
const SECTION_OF = (id: number): ZCFaction => (id === 0 || id === 1 ? 'player' : 'enemy');
// 终点色缺省落到 neutral：中立格不可开发时的观感（与 territoryTintOwner 的中立分支一致）。
const CALLBACKS: ZCClaimWaveCallbacks = {
    ownerOf: OWNER_OF,
    sectionOwnerOf: SECTION_OF,
    tintOwnerOf: () => 'neutral',
};

function makeHost(views: Map<number, FakeClaimHexView>): ZCClaimWave {
    // ZCClaimWave 的显式依赖包含两张只读索引：entityId→视图、hexId→entityId；测试里两种 id 相同。
    // 只把传进来的格建实体 —— 某格不在 views 里就等价于「实体尚未创建」。
    const hexViews = new Map<number, ZCHexView>();
    const entitiesByHex = new Map<number, number>();
    for (const [hexId, view] of views) {
        entitiesByHex.set(hexId, hexId);
        hexViews.set(hexId, view as unknown as ZCHexView);
    }
    return new ZCClaimWave({ hexViews, hexEntityBySource: entitiesByHex });
}

function viewsFor(ids: readonly number[]): Map<number, FakeClaimHexView> {
    return new Map(ids.map((id) => [id, new FakeClaimHexView()]));
}

describe('ZCClaimWave 开局归属扩散波（纯表现编排）', () => {
    it('没有可染的中立格时返回 false 且不激活（主城全中立 / 查不到半区）', () => {
        const host = makeHost(viewsFor([1, 3]));
        const allNeutral: ZCClaimWaveCallbacks = {
            ownerOf: () => 'neutral',
            sectionOwnerOf: SECTION_OF,
            tintOwnerOf: () => 'neutral',
        };
        assert.equal(host.start(MAP, HOMES, allNeutral, 0), false);
        assert.equal(host.active, false);
    });

    it('start 当帧就把中立格压回半区色（progress=0），主城归属格不进波', () => {
        const views = viewsFor([1, 3]);
        const host = makeHost(views);
        assert.equal(host.start(MAP, HOMES, CALLBACKS, 0), true);
        assert.equal(host.active, true);
        assert.deepEqual(views.get(1)!.wave, { from: 'player', to: 'neutral', progress: 0 });
        assert.deepEqual(views.get(3)!.wave, { from: 'enemy', to: 'neutral', progress: 0 });
    });

    it('start 幂等：已在播时重复调用不重排时间表、不重复压色', () => {
        const views = viewsFor([1, 3]);
        const host = makeHost(views);
        assert.equal(host.start(MAP, HOMES, CALLBACKS, 0), true);
        assert.equal(host.start(MAP, HOMES, CALLBACKS, 0), true);
        // 每格只在 start 压过一次（progress=0），幂等的第二次 start 不重写。
        assert.equal(views.get(1)!.setClaimWaveCalls, 1);
        assert.equal(views.get(3)!.setClaimWaveCalls, 1);
    });

    it('advance 把波前窗口内的格按进度逐帧插值（0.1s 过渡走到 0.5）', () => {
        const views = viewsFor([1, 3]);
        const host = makeHost(views);
        host.start(MAP, HOMES, CALLBACKS, 0);
        host.advance(0.05);
        assert.equal(views.get(1)!.wave?.progress, 0.5);
        assert.equal(views.get(3)!.wave?.progress, 0.5);
        assert.equal(host.active, true);
    });

    it('过渡到终点并交回常规后，不再每帧重复写视图（收工即静默）', () => {
        const views = viewsFor([1, 3]);
        const host = makeHost(views);
        host.start(MAP, HOMES, CALLBACKS, 0);
        host.advance(0.05);
        host.advance(2.0);
        const callsAtEnd = views.get(1)!.setClaimWaveCalls;
        assert.ok(callsAtEnd >= 1);
        host.advance(2.5);
        host.advance(3.0);
        assert.equal(views.get(1)!.setClaimWaveCalls, callsAtEnd);
    });

    it('全部格过渡到终点后交还常规渲染（setClaimWave(null)）并自动收工', () => {
        const views = viewsFor([1, 3]);
        const host = makeHost(views);
        host.start(MAP, HOMES, CALLBACKS, 0);
        host.advance(2.0);
        assert.equal(views.get(1)!.wave, null);
        assert.equal(views.get(3)!.wave, null);
        assert.equal(host.active, false);
    });

    it('clear 中途止波：所有格（含还没开始过渡的）都交还常规渲染', () => {
        const views = viewsFor([1, 3]);
        const host = makeHost(views);
        host.start(MAP, HOMES, CALLBACKS, 0);
        host.advance(0.05);
        host.clear();
        assert.equal(views.get(1)!.wave, null);
        assert.equal(views.get(3)!.wave, null);
        assert.equal(host.active, false);
    });

    it('某格实体尚未创建（不在实体映射里）时不崩，其余格照常收工', () => {
        const views = viewsFor([1]);
        const host = makeHost(views);
        assert.equal(host.start(MAP, HOMES, CALLBACKS, 0), true);
        host.advance(2.0);
        assert.equal(views.get(1)!.wave, null);
        assert.equal(host.active, false);
    });

    it('未启动时 advance / clear 都是安全空操作', () => {
        const host = makeHost(viewsFor([1, 3]));
        assert.doesNotThrow(() => host.advance(1.0));
        assert.doesNotThrow(() => host.clear());
        assert.equal(host.active, false);
    });
});
