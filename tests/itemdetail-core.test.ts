/**
 * itemdetail 纯函数层（`ItemDetailTable` / `ItemDetailArt`）的单测。
 *
 * 2026-11-24：`ItemDetailPage` 下线后，本文件只保留仍被 ItemInfo / RewardItem / Card 复用的口径：
 * 品质名、缎带档位、品质框档位（含卡牌抬档）、数量文案、item 行解析、获取途径、美术表对账。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    BASE_CARD_ITEM_IDS,
    CARD_ITEM_FRAME_STEP_MAX,
    CARD_ITEM_FRAME_STEP_SHIFT,
    QUALITY_FRAME_COUNT,
    QUALITY_NAME_FALLBACK,
    TITLE_ART_STEPS,
    accessRefsOf,
    accessTextsOf,
    cardItemIdsOf,
    itemFrameQualityOf,
    itemNumberTextOf,
    parseItemRow,
    parseItemRows,
    parseViewTypeRows,
    qualityFrameStepOf,
    qualityFrameSuffixOf,
    qualityNameOf,
    qualityTitleStepOf,
} from '../assets/script/app/itemdetail/ItemDetailTable';
import type { IViewTypeRow } from '../assets/script/app/itemdetail/ItemDetailTable';
import {
    ID_ART_DIR,
    ID_ART_NAMES,
    ID_ART_SLICED,
    ID_ART_TILED,
    ID_TITLE_KEYS,
    QUALITY_FRAME_ART_DIR,
    qualityFrameArtPath,
    titleArtPathOf,
} from '../assets/script/app/itemdetail/ItemDetailArt';
import { assetExists, assetPath } from './helpers/asset-paths';

// ============================================================
// A. 品质 / 档位
// ============================================================

test('A1 qualityNameOf：1 基查 0 基表，越界/空 CSV 安全', () => {
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, 1), '普通');
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, 2), '精良');
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, 3), '优秀');
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, 7), '神话');
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, 8), '');
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, 0), '普通');
    assert.equal(qualityNameOf('', 3), '优秀');
    assert.equal(qualityNameOf('甲,乙', 2), '乙');
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, Number.NaN), '普通');
});

test('A2 qualityTitleStepOf：1..7 → gray..caise，第 8 档回灰', () => {
    assert.deepEqual(TITLE_ART_STEPS, ['gray', 'green', 'blue', 'purple', 'yellow', 'red', 'caise']);
    for (let quality = 1; quality <= 7; quality += 1) {
        assert.equal(qualityTitleStepOf(quality), TITLE_ART_STEPS[quality - 1]);
    }
    assert.equal(qualityTitleStepOf(8), 'gray');
    assert.equal(qualityTitleStepOf(0), 'gray');
});

test('A3 qualityFrameStepOf / Suffix：8 档、两位补零', () => {
    assert.equal(QUALITY_FRAME_COUNT, 8);
    assert.equal(qualityFrameStepOf(1), 1);
    assert.equal(qualityFrameStepOf(8), 8);
    assert.equal(qualityFrameStepOf(9), 8);
    assert.equal(qualityFrameStepOf(0), 1);
    assert.equal(qualityFrameStepOf(Number.NaN), 1);
    assert.equal(qualityFrameSuffixOf(1), '01');
    assert.equal(qualityFrameSuffixOf(7), '07');
    assert.equal(qualityFrameSuffixOf(8), '08');
});

test('A4 卡牌道具底框抬一档并封顶金框', () => {
    assert.equal(CARD_ITEM_FRAME_STEP_SHIFT, 1);
    assert.equal(CARD_ITEM_FRAME_STEP_MAX, 5);
    assert.equal(itemFrameQualityOf(1, false), 1);
    assert.equal(itemFrameQualityOf(4, false), 4);
    assert.equal(itemFrameQualityOf(1, true), 2, '普通卡 → 绿框');
    assert.equal(itemFrameQualityOf(2, true), 3, '稀有卡 → 蓝框');
    assert.equal(itemFrameQualityOf(3, true), 4, '史诗卡 → 紫框');
    assert.equal(itemFrameQualityOf(4, true), 5, '传说卡 → 金框');
    assert.equal(itemFrameQualityOf(9, true), 5, '大于 4 一律金框');

    const ids = cardItemIdsOf([{ costCardID: 18003 }, { costCardID: 'x' }, { costCardID: 18003 }]);
    assert.ok(ids.has(18003));
    for (const base of BASE_CARD_ITEM_IDS) assert.ok(ids.has(base), `基础卡 ${base} 必须在内`);
    assert.equal(cardItemIdsOf(null).size, BASE_CARD_ITEM_IDS.length);
});

test('A5 itemNumberTextOf：0 ⇒ 空串，其余纯整数不缩写', () => {
    assert.equal(itemNumberTextOf(0), '');
    assert.equal(itemNumberTextOf(1), '1');
    assert.equal(itemNumberTextOf(999999), '999999');
    assert.equal(itemNumberTextOf(12.9), '12');
    assert.equal(itemNumberTextOf(Number.NaN), '');
    assert.equal(itemNumberTextOf(-5), '-5');
});

// ============================================================
// B. item / 获取途径解析
// ============================================================

test('B1 parseItemRow：缺字段安全默认，resId ≤ 0 丢行', () => {
    assert.equal(parseItemRow(null), null);
    assert.equal(parseItemRow('x'), null);
    assert.equal(parseItemRow({}), null);
    assert.equal(parseItemRow({ resId: 0 }), null);
    assert.equal(parseItemRow({ resId: -1 }), null);

    const row = parseItemRow({
        resId: 18014,
        name: '猎头者',
        desc: '一片碎片',
        type: 2,
        quality: 4,
        icon: 'icons/item/图鉴_帽子',
        access: [1, 0, 2, 'x', null, 3],
        itemBox: [11, 12],
        useJump: 5,
    })!;
    assert.equal(row.name, '猎头者');
    assert.equal(row.quality, 4);
    assert.deepEqual(row.access, [1, 2, 3]);
    assert.deepEqual(row.itemBox, [11, 12]);
    assert.equal(row.useJump, 5);

    const bare = parseItemRow({ resId: 7 })!;
    assert.equal(bare.quality, 1);
    assert.deepEqual(bare.access, []);
    assert.deepEqual(bare.itemBox, []);
    assert.equal(bare.useJump, 0);
});

test('B2 parseItemRows：同 resId 后行覆盖前行', () => {
    const rows = parseItemRows([{ resId: 1, name: 'A' }, { resId: 2 }, { resId: 1, name: 'B' }, { resId: 0 }]);
    assert.equal(rows.size, 2);
    assert.equal(rows.get(1)!.name, 'B');
});

test('B3 accessRefsOf 保留 id；空文案 / 查不到的 id 不产行', () => {
    const viewTypes = new Map<number, IViewTypeRow>([
        [1, { resId: 1, value: '排行榜' }],
        [2, { resId: 2, value: '' }],
        [3, { resId: 3, value: '首充' }],
    ]);
    assert.deepEqual(accessRefsOf(viewTypes, [1, 2, 3, 4]), [
        { resId: 1, text: '排行榜' },
        { resId: 3, text: '首充' },
    ]);
    assert.deepEqual(accessTextsOf(viewTypes, [3, 1]), ['首充', '排行榜']);
    assert.deepEqual(accessRefsOf(viewTypes, []), []);
});

test('B4 parseViewTypeRows 剔除 resId ≤ 0 / 非对象', () => {
    const rows = parseViewTypeRows([{ resId: 5, value: '战令' }, { resId: 0 }, 'x', null, { value: '无 id' }]);
    assert.equal(rows.size, 1);
    assert.equal(rows.get(5)!.value, '战令');
});

// ============================================================
// C. 美术表
// ============================================================

test('C1 每张图 .png / .png.meta 都在盘上', () => {
    for (const [key, rel] of Object.entries(ID_ART_NAMES)) {
        assert.ok(existsSync(assetPath(`image/${rel}.png`)), `缺图 ${key} → ${rel}.png`);
        assert.ok(existsSync(assetPath(`image/${rel}.png.meta`)), `缺 meta ${key} → ${rel}.png.meta`);
    }
});

test('C2 SLICED 名单与 .meta border 双向一致', () => {
    const borderOf = (rel: string): { t: number; b: number; l: number; r: number } => {
        const meta = JSON.parse(readFileSync(assetPath(`image/${rel}.png.meta`), 'utf8')) as {
            subMetas: Record<string, { userData: Record<string, number> }>;
        };
        const data = meta.subMetas.f9941.userData;
        return {
            t: Number(data.borderTop ?? 0),
            b: Number(data.borderBottom ?? 0),
            l: Number(data.borderLeft ?? 0),
            r: Number(data.borderRight ?? 0),
        };
    };
    for (const [key, rel] of Object.entries(ID_ART_NAMES)) {
        const b = borderOf(rel);
        const hasBorder = b.t + b.b + b.l + b.r > 0;
        assert.equal(ID_ART_SLICED.has(key), hasBorder, `${key} (${rel}) SLICED 名单与 border 不一致`);
    }
    for (const key of ID_ART_SLICED) assert.ok(key in ID_ART_NAMES, `ID_ART_SLICED 引用了不存在的 key ${key}`);
});

test('C3 缎带 key ↔ steps 1:1；品质框 8 档齐全', () => {
    assert.equal(ID_TITLE_KEYS.length, TITLE_ART_STEPS.length);
    for (let i = 0; i < TITLE_ART_STEPS.length; i += 1) {
        assert.equal(titleArtPathOf(TITLE_ART_STEPS[i]), ID_ART_NAMES[ID_TITLE_KEYS[i]]);
    }
    assert.equal(titleArtPathOf('不存在'), ID_ART_NAMES.titleGray);
    assert.equal(ID_ART_DIR, 'itemdetail');
    assert.equal(QUALITY_FRAME_ART_DIR, 'common');
    assert.equal(ID_ART_TILED.size, 0);

    for (let quality = 1; quality <= QUALITY_FRAME_COUNT; quality += 1) {
        const rel = qualityFrameArtPath(qualityFrameSuffixOf(quality));
        assert.ok(existsSync(assetPath(`image/${rel}.png`)), `缺品质框图 ${rel}.png`);
    }
});
