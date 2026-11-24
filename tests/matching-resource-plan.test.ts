import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ARTIFACT_ART_ROOT, CARD_ROLE_ICON_BY_ATTACK, HEAD_ART_ROOT, ICON_ART_ROOT,
    MATCH_ART_ROOT, MATCH_CARD_FRAME_ART, MATCH_SEARCH_BARS, MATCH_SLOT_BARS, MATCH_SLOT_PILLS,
} from '../assets/script/app/ArtPaths';
import { buildMatchProfileLookup } from '../assets/script/app/battle/BattleStartModel';
import {
    buildMatchingArtPlan, DEFAULT_MATCH_AVATAR, preloadArtPlan, type IArtDescriptor,
} from '../assets/script/app/matching/MatchingResourcePlan';

test('buildMatchingArtPlan 纯函数计算匹配所需全部美术描述符', () => {
    const lookup = buildMatchProfileLookup(
        null,
        [
            { artifactId: '69001', name: '希瓦的守护', icon: '霜封冰刃' },
            { artifactId: '69002', name: '疾风之靴', icon: '狂猎皮靴' },
        ],
        [{ resId: 1, icon: 'head-key' }],
        [{ key: 'head-key', path: 'ui://图标/mine' }],
    );

    const plan = buildMatchingArtPlan(lookup, '1');

    // 1. 头像
    assert.ok(plan.some(art => art.root === HEAD_ART_ROOT && art.name === 'mine'), '应包含本机头像');

    // 2. 基础匹配 UI
    assert.ok(plan.some(art => art.root === MATCH_ART_ROOT && art.name === DEFAULT_MATCH_AVATAR));
    assert.ok(plan.some(art => art.root === MATCH_ART_ROOT && art.name === 'icon_fdj'));
    assert.ok(plan.some(art => art.root === MATCH_ART_ROOT && art.name === 'search_avatar'));

    // 3. 槽位与卡框美术
    for (const name of MATCH_SLOT_BARS) {
        assert.ok(plan.some(art => art.root === MATCH_ART_ROOT && art.name === name), `缺少槽位条底: ${name}`);
    }
    for (const name of MATCH_SEARCH_BARS) {
        assert.ok(plan.some(art => art.root === MATCH_ART_ROOT && art.name === name), `缺少搜索条底: ${name}`);
    }
    for (const name of MATCH_SLOT_PILLS) {
        assert.ok(plan.some(art => art.root === MATCH_ART_ROOT && art.name === name), `缺少药丸底: ${name}`);
    }
    for (const name of Object.values(MATCH_CARD_FRAME_ART)) {
        assert.ok(plan.some(art => art.root === MATCH_ART_ROOT && art.name === name), `缺少卡框: ${name}`);
    }

    // 4. 职业角标
    for (const name of Object.values(CARD_ROLE_ICON_BY_ATTACK)) {
        assert.ok(plan.some(art => art.root === ICON_ART_ROOT && art.name === name), `缺少职业角标: ${name}`);
    }

    // 5. 神器图标全表预热
    assert.ok(plan.some(art => art.root === ARTIFACT_ART_ROOT && art.name === '霜封冰刃'));
    assert.ok(plan.some(art => art.root === ARTIFACT_ART_ROOT && art.name === '狂猎皮靴'));
});

test('buildMatchingArtPlan 容错：空查表时不抛出，返回基础匹配资产', () => {
    const lookup = buildMatchProfileLookup(null, null);
    const plan = buildMatchingArtPlan(lookup, '');
    assert.ok(plan.length > 0, '应返回基础匹配资产清单');
    assert.ok(!plan.some(art => art.root === HEAD_ART_ROOT), '无头像时不得插入空头像项');
    assert.ok(!plan.some(art => art.root === ARTIFACT_ART_ROOT), '无神器表时不插入神器');
});

test('preloadArtPlan 批量执行资源加载', async () => {
    const loaded: IArtDescriptor[] = [];
    const mockLoader = async (name: string, root: string) => {
        loaded.push({ root, name });
        return null;
    };

    const descriptors: IArtDescriptor[] = [
        { root: 'root_a', name: 'icon_1' },
        { root: 'root_b', name: 'icon_2' },
    ];

    await preloadArtPlan(mockLoader, descriptors);
    assert.deepEqual(loaded, descriptors);
});
