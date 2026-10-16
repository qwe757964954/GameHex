/**
 * 开服庆典的**视图态**唯一真源（**零 `cc` 依赖** ⇒ 可被 `tests/celebration.test.ts` 直接 import）。
 *
 * ## 为什么单独成文件（规则 78）
 *
 * `osTabVisual` / `osShopVisibility` / `osTargetNodeState` 这三个函数是**纯函数**：
 * 入参是 `boolean` / 字符串 / 枚举，出参是普通对象，**不碰任何 `cc` 类型**。
 * 但它们原先分别住在 `OSTabButton.ts` / `OSShopItem.ts` / `OSTargetItem.ts` 里，
 * 而那三个文件都**值导入 `cc`**（`_decorator` / `Component` / `Sprite` / `Label` …）——
 * `cc` 是编辑器/运行时提供的虚拟模块，Node 环境下解析不了 ⇒
 * 「判定逻辑写在带 `cc` 的 import 链上 ⇒ Node 用例 import 不进来 ⇒ 永久脱离回归网」。
 *
 * 抽到这里之后：
 * - 三个视图脚本改为 `export { … } from './CelebrationViewState'` ⇒ **外部 import 路径不变**；
 * - 单测直接 `import { osTabVisual, … } from '../assets/script/app/celebration/CelebrationViewState'`，
 *   真跑逻辑，而不是退化成「源码文本断言」。
 *
 * ⚠️ 本文件**禁止**出现 `import … from 'cc'`。加一行就会让上面三组单测**静默失效**
 * （要到测试文件自己编译不过时才会被发现）。
 *
 * ⚠️ 依赖方向：只许 `CelebrationViewState` → `CelebrationTable`（也是零 `cc`），
 * **反向不允许**（`CelebrationTable` 是纯数据层，不该认识视图态）。
 */

import { ECelebrationTargetRewardType } from './CelebrationTable';

// ============================================================
// 页签选中态（`OSTabButton`）
// ============================================================

/**
 * 一个页签的四张图谁亮。
 *
 * | 节点 | FGUI 名 | 图 | 何时显示 |
 * |---|---|---|---|
 * | `PlateUp` | `n10` | `TY_btn13` 168×132（`scale=0.7`） | **未选中** |
 * | `PlateDown` | `n11` | `TY_btn14` 168×132（`scale=0.7`） | **选中** |
 * | `IconOff` | `icon` | `zd_icon_qingdian*` 100×100 | **未选中** |
 * | `IconOn` | `selectIcon` | `zd_icon_qingdian*_1` 80×80 | **选中** |
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
    /** `lab_price` 现价：**可购买**时才显示。 */
    readonly priceVisible: boolean;
    /** `n44` rmb 分支的现价 ￥。 */
    readonly rmbSignVisible: boolean;
    /** `icon_cost` cost 分支的货币图标。 */
    readonly costIconVisible: boolean;
    /** `n41` 售罄 / 达到限购。 */
    readonly soldOutVisible: boolean;
    /** 按钮是否**置灰**（不是禁用 —— 老端只 `gearLook` 置灰，点了照样发请求）。 */
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
 * 庆典目标行的三种状态对应的节点组合（**互斥且覆盖全部三态**）。
 *
 * ⚠️ 节点上的 gear 用的是**页 id**，不是 `state` 下标：
 * `按钮_领取` = `pages="1"`（未领取）、`按钮_前往` = `pages="0"`（未达标）、
 * `n35`（已领取印章）= `pages="2"`（已完成）。
 *
 * | 页下标 | 页 id | 页名 | 老端 `setSelectedIndex(state)` 的 state |
 * |---|---|---|---|
 * | 0 | `1` | 未领取 | `Reward = 0`（可领取） |
 * | 1 | `0` | 未达标 | `Unfinished = 1` |
 * | 2 | `2` | 已完成 | `Received = 2` |
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
