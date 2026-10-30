import assert from 'node:assert/strict';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

test('扫场借用视图索引，支持初始化后填表和实体 0，返回变化状态供外层重绘', () => {
    const { load } = loadViews();
    const { ZCVictorySweep } = load('./ZCVictorySweep');
    const view = {
        owner: null as string | null,
        writes: 0,
        setSweepOwner(owner: string | null): void {
            this.owner = owner;
            this.writes += 1;
        },
    };
    const entities = new Map<number, number>();
    const views = new Map<number, typeof view>();
    const sweep = new ZCVictorySweep(views, entities);
    entities.set(7, 0);
    views.set(0, view);
    const map = [
        { id: 7, row: 1, x: 0, playable: true },
        { id: 9, row: 0, x: 0, playable: true },
    ];

    assert.equal(sweep.start(map, 'player'), true);
    assert.equal(view.owner, null, '开始时清除覆盖，等镜头就绪再点亮');
    assert.equal(view.writes, 1);
    sweep.start(map, 'player');
    assert.equal(view.writes, 1, '重复开始不重置进度或重写视图');
    assert.equal(sweep.advance(0), true);
    assert.equal(view.owner, 'player');
    assert.equal(view.writes, 2);
    assert.equal(sweep.isPlaying, true);
    assert.equal(sweep.advance(0), false, '进度未改变时不请求重绘');
    assert.equal(view.writes, 2);
    assert.equal(sweep.advance(1), true, '最后一帧仍需刷新，再通知外层播放结束');
    assert.equal(sweep.isPlaying, false, '缺少视图的格子不会阻止扫场结束');
    sweep.clear();
    const writes = view.writes;
    assert.equal(sweep.advance(1), false);
    assert.equal(view.writes, writes, '清理后不再写入视图');
    assert.equal(entities.size, 1, '模块清理不会清空借用的索引');
    assert.equal(views.size, 1);
});

test('扫场原样使用传进来的胜方席位（4 号紫方也要铺紫，不许折成玩家 / 敌人两档）', () => {
    const { load } = loadViews();
    const { ZCVictorySweep } = load('./ZCVictorySweep');
    const view = {
        owner: null as string | null,
        mix: 0,
        setSweepOwner(owner: string | null, mix = 0): void {
            this.owner = owner;
            this.mix = mix;
        },
    };
    // 实体的号从 0 开始：0 号格子也要染（写成 falsy 判断就会漏）。
    const sweep = new ZCVictorySweep(new Map([[0, view]]), new Map([[7, 0]]));
    const map = [{ id: 7, row: 1, x: 0, playable: true }];

    assert.equal(sweep.start(map, 'enemy3'), true);
    sweep.advance(0);
    assert.equal(view.owner, 'enemy3', '胜方是 4 号席就必须原样传下去');
    // 铺到顶就回正到该阵营的当前色（`mix = 1`），仍是同一个 owner。
    sweep.advance(10);
    assert.equal(view.owner, 'enemy3');
    assert.equal(view.mix, 1, '回正到 1 时用的是该阵营当前色，不是深饱和色');
});

test('扩散波借用视图索引，完成或中止后清除覆盖', () => {
    const { load } = loadViews();
    const { ZCClaimWave } = load('./ZCClaimWave');
    const view = {
        wave: null as { from: string; to: string; progress: number } | null,
        writes: 0,
        setClaimWave(wave: typeof this.wave): void {
            this.wave = wave;
            this.writes += 1;
        },
    };
    const entities = new Map([[1, 0]]);
    const views = new Map<number, typeof view>();
    const wave = new ZCClaimWave({ hexViews: views, hexEntityBySource: entities });
    views.set(0, view);
    const map = [
        { id: 0, x: 0, y: 0, neighbors: [1], playable: true },
        { id: 1, x: 0, y: -1, neighbors: [0], playable: true },
    ];
    const owners = {
        ownerOf(hexId: number): string {
            return hexId === 0 ? 'player' : 'neutral';
        },
        sectionOwnerOf(): string {
            return 'player';
        },
    };

    assert.equal(wave.start(map, [0], owners, 10), true);
    assert.equal(wave.active, true);
    assert.equal(view.wave?.from, 'player');
    assert.equal(view.wave?.to, 'neutral');
    assert.equal(view.wave?.progress, 0);
    wave.advance(10);
    assert.equal(view.writes, 1, '进度不变时不重复写色');
    wave.advance(10.05);
    assert.ok(view.wave && view.wave.progress > 0 && view.wave.progress < 1);
    wave.advance(11);
    assert.equal(view.wave, null);
    assert.equal(wave.active, false);
    wave.start(map, [0], owners, 20);
    wave.clear();
    assert.equal(view.wave, null, '中止时也要交还常规渲染');
    assert.equal(wave.active, false);
    assert.equal(entities.size, 1);
    assert.equal(views.size, 1, '模块清理不会删除借用的视图');
});
