import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ITEM_ICON_ALIASES,
    resolveItemIconPath,
    resolveItemIconRef,
    resolveRewardIconRef,
    splitIconPath,
} from '../assets/script/app/common/RewardIcon';
import {
    parseCmdGoodsList,
    sortRewardEntries,
    rewardEntryOf,
    rewardIconPathOf,
    toCmdGoods,
    type IShowRewardEntry,
} from '../assets/script/app/common/RewardEntries';
import { resIconRoot } from '../assets/script/app/common/ResTypes';

test('RewardIcon: item 路径只认 icons/ 前缀，roleProperty 落 resIconRoot', () => {
    assert.deepEqual(splitIconPath('icons/item/icon_a'), { root: 'icons/item', name: 'icon_a' });
    assert.equal(splitIconPath('image/item/icon_a'), null);
    assert.deepEqual(resolveItemIconRef('icons/item/icon_a'), { root: 'icons/item', name: 'icon_a' });
    assert.equal(resolveItemIconPath('icons/item/icon_a'), 'icons/item/icon_a/spriteFrame');
    assert.equal(resolveItemIconRef(''), null);
    assert.equal(ITEM_ICON_ALIASES.size, 0);
    assert.deepEqual(
        resolveRewardIconRef({ name: '', quality: 1, icon: 'icons/item/icon_a', iconIsPath: true }),
        { root: 'icons/item', name: 'icon_a' },
    );
    assert.deepEqual(
        resolveRewardIconRef({ name: '', quality: 1, icon: '图标_活跃度', iconIsPath: false }),
        { root: resIconRoot('图标_活跃度'), name: '图标_活跃度' },
    );
    assert.equal(resolveRewardIconRef(null), null);
});

test('RewardEntries: 原始奖励归一化、排序与展示降级', () => {
    assert.deepEqual(toCmdGoods({ resId: 1, number: 2 }), { resId: 1, number: 2 });
    assert.equal(toCmdGoods({ resId: 0, number: 2 }), null);
    assert.deepEqual(parseCmdGoodsList([{ resId: 2, number: 3 }, null, { resId: 0 }]), [{ resId: 2, number: 3 }]);

    const entries: IShowRewardEntry[] = [
        { resId: 2, number: 1, quality: 1, iconPath: '' },
        { resId: 1, number: 1, quality: 3, iconPath: '' },
        { resId: 3, number: 1, quality: 3, iconPath: '' },
    ];
    assert.deepEqual(sortRewardEntries(entries).map((one) => one.resId), [1, 3, 2]);

    const items = new Map<number, { name: string; quality: number; icon: string; iconIsPath: boolean }>([
        [1, { name: 'a', quality: 3, icon: 'icons/item/a', iconIsPath: true }],
    ]);
    const resources = new Map<number, { name: string; quality: number; icon: string; iconIsPath: boolean }>([
        [1, { name: 'a', quality: 2, icon: 'icons/item/a', iconIsPath: false }],
    ]);
    const entry = rewardEntryOf({ resId: 1, number: 2 }, items, resources);
    assert.deepEqual(entry, { resId: 1, number: 2, quality: 3, iconPath: 'icons/item/a' });
    assert.equal(rewardIconPathOf(null), '');
});
