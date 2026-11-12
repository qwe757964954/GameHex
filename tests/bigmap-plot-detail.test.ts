/**
 * 建筑详情投影（`IBigMapPlotDetailView`）与展示文案的回归测试。
 *
 * 为什么单独一个文件：2026-11-11 之前 `plotDetail` 只吐「三种成本 + 建造时长」，
 * 而 `bigmapProduce` / `baseBuildingLevel` 里的 `producePerHour`、`produceCap`、
 * `attrBonus`、`preBuild`、`instantCost` **一个都没 expose**，界面只能写一句
 * 「提升建筑等级与发展能力」。补字段之后这些断言就是那道门：谁把字段又抹了，
 * 「升级换来什么」会重新变成一句废话，但界面上不会报错。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BigMapModel } from '../assets/script/app/bigmap/application/BigMapModel';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import {
    bigMapPlotHexId,
    bigMapStartBuild,
    bigMapTick,
    createBigMapBaseState,
    type IBigMapMissingRes,
} from '../assets/script/app/bigmap/model/BigMapBase';
import type { IBigMapBaseState } from '../assets/script/app/bigmap/model/BigMapTypes';
import {
    formatBigMapDuration,
    formatBigMapPlotDetail,
    formatBigMapRate,
} from '../assets/script/app/bigmap/view/BigMapPresentationText';
import { loadBigMapConfig, makeUnlockContext } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();
const NOW = 1_000_000;
const MAIN = 71001;
const GRAIN_FIELD = 71002;

/** 直接把基地状态塞进 Model：不跑队列时序，专注验「详情投影」本身。 */
function modelWithBase(base: IBigMapBaseState): BigMapModel {
    const model = new BigMapModel({
        config, storage: createMemoryBigMapStorage(), saveKey: 'plot-detail',
        now: () => NOW, adventureChapter: () => 12,
    });
    const holder = model as unknown as { data: { base: IBigMapBaseState } };
    holder.data = { ...holder.data, base };
    return model;
}

function richState(): IBigMapBaseState {
    let state = createBigMapBaseState(config, NOW);
    state = { ...state, res: { ...state.res, grain: 5000, wood: 5000, iron: 5000 } };
    const built = bigMapStartBuild(config, state, makeUnlockContext({ adventureChapter: 12 }),
        GRAIN_FIELD, bigMapPlotHexId(1, 1, 5), NOW);
    assert.equal(built.ok, true, `夹具应能建出粮食田：${built.reason}`);
    // 推到建造完成 + 累积一段产出（`stored` 非 0 才测得到 `storedRatio`）。
    return bigMapTick(config, built.state!, NOW + 100_000).state;
}

test('主城详情：不产资源但带前置条件，且缺料是结构化清单而不是一句英文 key', () => {
    const model = modelWithBase(createBigMapBaseState(config, NOW));
    const main = model.plotCells().find((plot) => plot.buildingId === MAIN);
    assert.ok(main, '新号应自动放好主城');
    const detail = model.plotDetail(main.hexId);
    assert.ok(detail);

    assert.equal(detail.resType, '', '主城不是产出建筑');
    assert.equal(detail.produceNow, 0);

    // 主城升 2 级要「木材田-1 + 铁矿田-1」，新号都没建 ⇒ 全未完成。
    assert.ok(detail.preBuild.length >= 1, '主城升 2 级应有前置建筑');
    assert.equal(detail.preBuild.every((pre) => pre.name !== '' && pre.done === false), true);

    // 缺料必须带中文名：`bigMapMissingRes` 早先直接拼英文 resource key 漏到界面。
    for (const item of detail.missing as readonly IBigMapMissingRes[]) {
        assert.notEqual(item.label, 'grain');
        assert.notEqual(item.label, 'wood');
        assert.notEqual(item.label, 'iron');
        assert.ok(item.amount >= 1);
    }
});

test('已建成的资源田：给出当前产量、下一级产量与储存进度', () => {
    const model = modelWithBase(richState());
    const field = model.plotCells().find((plot) => plot.buildingId === GRAIN_FIELD);
    assert.ok(field, '夹具应已建成粮食田');
    const detail = model.plotDetail(field.hexId);
    assert.ok(detail);

    assert.equal(detail.resType, 'grain');
    assert.ok(detail.produceNow > 0, '1 级粮食田应有产量');
    assert.ok(detail.produceNext >= detail.produceNow, '下一级产量不应低于当前级');
    assert.ok(detail.produceCap > 0);
    assert.ok(detail.storedRatio >= 0 && detail.storedRatio <= 1, '储存进度必须归一到 0~1');
});

test('建造中的空地：当前产量为 0，下一级产量才是「建成后」', () => {
    let state = createBigMapBaseState(config, NOW);
    state = { ...state, res: { ...state.res, grain: 5000, wood: 5000, iron: 5000 } };
    const built = bigMapStartBuild(config, state, makeUnlockContext({ adventureChapter: 12 }),
        GRAIN_FIELD, bigMapPlotHexId(1, 1, 5), NOW);
    const model = modelWithBase(built.state!);
    const hexId = bigMapPlotHexId(1, 1, 5);
    const detail = model.plotDetail(hexId);
    assert.ok(detail, '在建格子也要有详情（取消建造入口靠它）');
    assert.equal(detail.level, 0);
    assert.equal(detail.produceNow, 0, '还没建成，不能拿下一级冒充当前');
    assert.ok(detail.produceNext > 0);
    assert.ok(detail.queueSlotIndex >= 0);
    assert.ok(detail.remainSeconds > 0);
});

test('时长与产量格式化：裸秒数 / 裸数字不再进界面', () => {
    assert.equal(formatBigMapDuration(0), '00:00');
    assert.equal(formatBigMapDuration(59), '00:59');
    assert.equal(formatBigMapDuration(60), '01:00');
    assert.equal(formatBigMapDuration(3599), '59:59');
    assert.equal(formatBigMapDuration(3600), '1:00:00');
    // 向上取整：最后半秒显示 00:01，避免「还能收却显示 0」。
    assert.equal(formatBigMapDuration(0.4), '00:01');

    assert.equal(formatBigMapRate(0), '0/h');
    assert.equal(formatBigMapRate(120), '120/h');
    assert.equal(formatBigMapRate(1200), '1.2K/h');
    assert.equal(formatBigMapRate(12_000), '12K/h');
});

test('详情正文：升级要能看到产量对比，不再只写「提升建筑等级与发展能力」', () => {
    const model = modelWithBase(richState());
    const field = model.plotCells().find((plot) => plot.buildingId === GRAIN_FIELD)!;
    const text = formatBigMapPlotDetail(model.plotDetail(field.hexId)!);
    assert.match(text, /\/h/, '应出现产量');
    assert.match(text, /→/, '应出现「当前 → 升级后」对比');
    assert.doesNotMatch(text, /提升建筑等级与发展能力/, '旧模板文案必须退役');
    assert.doesNotMatch(text, /\bgrain\b|\bwood\b|\biron\b/, '正文不得漏英文资源 key');
});
