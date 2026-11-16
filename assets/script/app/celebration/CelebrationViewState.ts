/**
 * 开服庆典的视图态纯函数。
 *
 * 这三个判定只吃 boolean / 枚举，不碰任何 `cc` 类型，所以从 `OSTabButton` / `OSShopItem` / `OSTargetItem`
 * 抽到了这里：那三个文件都 import `cc`，Node 单测进不来，判定写在里面会永久脱离回归网。
 * 三个视图脚本改成 re-export，外部 import 路径不变。
 *
 * 本文件不要出现 `from 'cc'`，否则 `tests/celebration.test.ts` 的 G 组会整片失效。
 * 依赖方向只允许 `CelebrationViewState → CelebrationTable`（两边都不带 `cc`）。
 */

import { ECelebrationTargetRewardType } from './CelebrationTable';

// ============================================================
// 页签选中态（`OSTabButton`）
// ============================================================

/**
 * 一个页签的四张图谁亮。
 *
 * `PlateUp` / `PlateDown` 是共用的 `TY_btn13` / `TY_btn14`（未选中 / 选中），
 * `IconOff` / `IconOn` 是各页签自己的 `icon` / `selectIcon`（100×100 / 80×80）。
 */
export interface IOsTabVisual {
    readonly plateUp: boolean;
    readonly plateDown: boolean;
    readonly iconOff: boolean;
    readonly iconOn: boolean;
}

/** 由「是否选中」推出四张图的显隐。 */
export function osTabVisual(selected: boolean): IOsTabVisual {
    return {
        plateUp: !selected,
        plateDown: selected,
        iconOff: !selected,
        iconOn: selected,
    };
}

// ============================================================
// 商品卡显隐（`OSShopItem`）
// ============================================================

/**
 * 商品卡的节点显隐。
 *
 * 两个控制器：`buyType`（`0,rmb / 1,cost`）+ `购买状态`（`0,可购买 / 1,不可购买`）。
 */
export interface IOsShopVisibility {
    /** `lab_price` 现价：可购买时才显示。 */
    readonly priceVisible: boolean;
    /** `n44` rmb 分支的现价 ￥。 */
    readonly rmbSignVisible: boolean;
    /** `icon_cost` cost 分支的货币图标。 */
    readonly costIconVisible: boolean;
    /** `n41` 售罄 / 达到限购。 */
    readonly soldOutVisible: boolean;
    /** 按钮是否置灰。老端只 `gearLook` 置灰，没有禁用，点了照样发请求。 */
    readonly buyGrayed: boolean;
}

/** 由「分支 + 购买状态」推出节点显隐。 */
export function osShopVisibility(branch: 'rmb' | 'cost', purchaseState: number): IOsShopVisibility {
    const buyable = purchaseState === 0;
    return {
        priceVisible: buyable,
        rmbSignVisible: branch === 'rmb' && buyable,
        costIconVisible: branch === 'cost' && buyable,
        soldOutVisible: !buyable,
        buyGrayed: !buyable,
    };
}

// ============================================================
// 目标行三态（`OSTargetItem`）
// ============================================================

/**
 * 庆典目标行的三种状态对应的节点组合（互斥且覆盖三态）。
 *
 * 节点上的 gear 用的是 FGUI 页 id，不是 `state` 下标：
 * `按钮_领取` = `pages="1"`（未领取）、`按钮_前往` = `pages="0"`（未达标）、
 * `n35`（已领取印章）= `pages="2"`（已完成）。页序是 `1,未领取 / 0,未达标 / 2,已完成`，
 * 所以页下标 0/1/2 分别对应老端 state 的 `Reward / Unfinished / Received`。
 */
export interface IOsTargetNodeState {
    readonly claimVisible: boolean;
    readonly goVisible: boolean;
    readonly claimedVisible: boolean;
}

/** 由三态枚举推出三个节点的显隐。 */
export function osTargetNodeState(state: ECelebrationTargetRewardType): IOsTargetNodeState {
    return {
        claimVisible: state === ECelebrationTargetRewardType.Reward,
        goVisible: state === ECelebrationTargetRewardType.Unfinished,
        claimedVisible: state === ECelebrationTargetRewardType.Received,
    };
}
