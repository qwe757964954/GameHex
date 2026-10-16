/**
 * 角色模块的文案**唯一出口**（对齐 `GiftTexts` / `SevenDayTexts` 的约定）。
 *
 * 静态文案（页签名、按钮字）已经烘进 prefab 的 `cc.Label` 里，这里只放
 * **运行时要替换 / 要弹提示**的那几条 —— 代码里不许再出现裸字符串。
 *
 * 零 `cc` 依赖（可被 `tests/role.test.ts` 直接 import）。
 */
export const ROLE_TEXTS = {
    /** 战斗力取不到时的占位（老端是本地算的属性聚合，Demo3.8 没有 ⇒ 不显示假的 0）。 */
    powerUnknown: '--',

    /** 宝石页签还没自定义名字时的缺省名（老端 `getVOEquipPage()` 为空时界面上是空串，这里给个可读的）。 */
    pageFallback: (page: number) => `宝石页${page}`,

    /** 页签未解锁的提示（老端 `LayerEquipPageNameEdit_1`，带一个等级占位）。 */
    pageLocked: (level: number) => `角色${level}级解锁`,

    /** 新手引导气泡（老端 FGUI `组件_角色_气泡/n1` 烘的就是这句）。 */
    qipao: '前期建议优先提升攻击力',

    /** 左侧导航的目标界面还没落地。 */
    navMissing: '该功能还没移植到新版本',

    /** 背包页签还没落地。 */
    bagTabMissing: '该页签还没移植到新版本',

    /** 民兵菜单层「皮肤」页签（`TabMilitiaSkin` 未移植，老端是独立的 tab）。 */
    tabSkinMissing: '皮肤功能还没移植到新版本',

    /** 宝物 / 天赋页读不到数据（离线或缓存为空）。 */
    artifactEmpty: '暂未获得宝物',
    talentEmpty: '暂无已解锁的天赋',

    /** 天赋「激活」的两种拦截（老端 `ModelGoods` 的不足提示 + 只能点下一级）。 */
    talentNotNext: '只能激活下一级天赋',
    talentLack: '材料不足，无法激活',
    talentUpOk: '天赋升级成功',

    /** 宝石页签没有可显示的分页。 */
    equipEmpty: '暂无装备',

    /** 尚未接的请求（明确提示，不静默失败）。 */
    offline: '网络未连接，请稍后再试',
    failed: '操作失败，请稍后再试',
} as const;

export type RoleTexts = typeof ROLE_TEXTS;
