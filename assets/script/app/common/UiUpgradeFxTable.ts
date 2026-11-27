/**
 * UI「升级 / 升阶 / 升星」字特效的**纯数据表**（零 `cc`，可被 node 用例直接 import）。
 *
 * 素材只有一个：`skel/UI升级升星升阶特效字/shengduan`，一个 `.skel` 里三条动画
 * （各 1.07s）；预制是它的单节点 `sp.Skeleton` 壳子。播放逻辑在 `UiUpgradeFx.ts`。
 *
 * 为什么单独一层：`UiUpgradeFx.ts` 要 `import { sp } from 'cc'`，用例 import 它就跑不起来；
 * 而「预制路径 / 动画名 / 时长」恰恰是**最容易悄悄写错**的东西（写错不报错，只是演错字或
 * 演成空场），必须有守卫钉住。
 */

/** 字特效预制路径（相对 `resources` 根，不带 `assets/resources` 前缀）。 */
export const UI_UPGRADE_FX_PREFAB = 'ui/territory/TerritoryMonsterBoxUpgradeFx';

/** 动画名（`shengduan.skel` 里就这三条）。 */
export const UI_UPGRADE_ANIMATION = {
    /** 升级成功。 */
    levelUp: 'shengji',
    /** 升阶成功。 */
    rankUp: 'shengjie',
    /** 升星成功。 */
    starUp: 'shengxing',
} as const;

export type UiUpgradeAnimation = typeof UI_UPGRADE_ANIMATION[keyof typeof UI_UPGRADE_ANIMATION];

/**
 * 收起时刻（秒）。
 *
 * 素材实测 1.07s；留 0.05s 让最后一帧演完再收。与
 * `TERRITORY_MONSTER_BOX_FX.upgradeFxSeconds` 同值（那份归巡逻宝箱，这份归通用播放器，
 * 两处都是「照着素材长度写死」，换素材要两边一起动）。
 */
export const UI_UPGRADE_FX_SECONDS = 1.12;
