/** owner 为真实运行期展示实例，各消费者仅处理当前持有的实例。 */
export const ZC_BATTLE_EVENTS = {
    PVE_RESULT: 'zcds:battle:pve-result',
    RUNTIME_DESTROYED: 'zcds:battle:runtime-destroyed',
    FRAME: 'zcds:battle:frame',
    /** 请求返回主界面；组合层使用本局入口恢复目标页与焦点。 */
    RETURN_TO_MAIN: 'zcds:battle:return-to-main',
    /** 单向提示展示命令，不携带回调。 */
    SHOW_TIP: 'zcds:battle:show-tip',
} as const;
export interface IZCBattleReturnToMain { readonly owner: object; }
export interface IZCBattleShowTip { readonly owner: object; readonly message: string; }
/** 仅 PVE 发布服务端结算结果；会话重复结果只回写一次。 */
export interface IZCBattleResult { readonly owner: object; readonly victory: boolean; }
export interface IZCBattleRuntimeDestroyed { readonly owner: object; }
/** 引擎只提供帧脉冲，单局控制器按 owner 消费。 */
export interface IZCBattleFrame { readonly owner: object; readonly dt: number; }
