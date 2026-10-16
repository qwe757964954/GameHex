/**
 * GM 工具与配置（从 client 的 app/utils/GMUtils.ts 同步）。
 */
export class GMUtils {
    /** 是否显示物品ID（与源工程一致，GM 指令 changeShowGoodsId 切换）。 */
    public static showGoodsId: boolean = false;

    /**
     * GM 功能总开关。
     * 源工程为 ModelPublicData.getIsGM() = appCustomData.isEdit（后台下发的内网/编辑标记）；
     * Demo3.8 无后台配置，改成本地常量控制。上线打包前应改为 false。
     */
    public static isGM: boolean = true;
}
