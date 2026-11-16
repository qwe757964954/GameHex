/** 奖励/物品的纯数据形状（不依赖生成协议类型）。 */
export interface IRewardAmount {
    readonly resId: number;
    readonly number: number;
}

/** `item` / `roleProperty` 统一后的奖励展示字段。 */
export interface IResGoodsInfo {
    readonly name: string;
    readonly quality: number;
    readonly icon: string;
    readonly iconIsPath: boolean;
}

/** 方案中的历史命名；与 IResGoodsInfo 同形。 */
export type IRewardGoodsInfo = IResGoodsInfo;
