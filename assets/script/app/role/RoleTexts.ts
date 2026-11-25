/**
 * 角色模块的文案**唯一出口**（对齐 `GiftTexts` / `SevenDayTexts` 的约定）。
 *
 * 静态文案（页签名、按钮字）已经烘进 prefab 的 `cc.Label` 里，这里只放
 * **运行时要替换 / 要弹提示**的那几条 —— 代码里不许再出现裸字符串。
 *
 * 零 `cc` 依赖（可被 `tests/role.test.ts` 直接 import）。
 */
export const ROLE_TEXTS = {
    /** 战斗力占位（`--`）。角色页现在统一按数值写（0 也显示），保留给需要区分「未取到」的界面。 */
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

    gemDetails: (desc: string, count: number, equipped: boolean) =>
        [desc, `数量：${count}`, equipped ? '已镶嵌' : '未镶嵌'].filter(Boolean).join('\n'),
    gemChoose: (order: number) => `已选中第 ${order} 孔，请在背包选择对应部位的宝石`,
    gemChooseSocket: '请先选择装备上的宝石孔',
    gemInvalid: '该宝石无法用于当前孔位',
    gemUnavailable: '当前装备方案没有这个宝石孔',
    gemSocket: (order: number) => `宝石孔 ${order}`,
    gemUnknown: (id: string) => `宝石 ${id}`,
    gemLine: (name: string, count: number) => `${name} × ${count}`,
    gemOn: '镶嵌',
    gemReplace: '替换',
    gemDown: '卸下',
    gemChooseReplacement: '选择替换',
    gemCompose: '一键合成',
    gemComposeConfirm: '合成',
    gemComposeAgain: '确认合成高品质宝石',
    gemComposeEmpty: '暂无可合成的宝石',
    gemComposeMaterials: '以下宝石将用于合成',
    gemChanged: '宝石操作成功',
    gemFilter: '按装备部位筛选',
    gemFilterAll: '全部',
    gemFilterNext: '下一个部位',
    gemGrowth: '宝石养成',
    gemRefine: '宝石洗练',
    gemLock: '锁定',
    gemUnlock: '解锁',
    gemUnlockWorn: '解锁会将这颗宝石从所有装备方案卸下，是否继续？',
    gemRefineWorn: '洗练已镶嵌宝石会将其卸下。',
    gemRefineCost: (cost: number) => `消耗洗练石 × ${cost}`,
    gemSaveAttr: '采用新属性',
    gemDiscardAttr: '保留原属性',
    gemOldAttr: (value: string) => `原属性：${value}`,
    gemNewAttr: (value: string) => `新属性：${value}`,
    equipForge: '装备锻造',
    equipChoose: '点击角色身上的装备，查看属性或单件锻造。',
    equipPlans: '装备方案',
    equipPlanNext: '下一个方案',
    equipPlanUse: '切换',
    equipPlanCurrent: '当前使用',
    equipPlanEmpty: '暂无装备方案',
    equipAllLevel: '一键强化',
    equipAllLevelConfirm: '一键强化会消耗金币及对应装备的图纸，是否继续？',
    equipWear: '穿戴',
    equipDecompose: '分解',
    equipDecomposeConfirm: (name: string) => `分解「${name}」后无法找回，是否继续？`,
    equipLevel: '强化',
    equipQuality: '升品',
    equipWash: '洗练',
    equipMore: '更多锻造',
    equipChanged: '装备操作成功',
    equipApplyWash: '替换属性',
    equipKeepWash: '保留原属性',
    equipBefore: '洗练前',
    equipAfter: '洗练后',
    equipConfirmCost: (action: string, cost: string) => `${action}消耗：${cost}`,
    equipDetails: (rank: number, level: number, attack: number, hp: number) =>
        [`${rank}阶`, level > 0 ? `Lv.${level}` : '', `攻击力 +${attack}`, `生命 +${hp}%`].filter(Boolean).join('\n'),
    gemComposed: '宝石合成成功',

    /** 宝石页签没有可显示的分页。 */
    equipEmpty: '暂无装备',

    /** 尚未接的请求（明确提示，不静默失败）。 */
    offline: '网络未连接，请稍后再试',
    failed: '操作失败，请稍后再试',
} as const;

export type RoleTexts = typeof ROLE_TEXTS;
