// 事件都带 owner：订阅方只处理自己当前持有的展示实例，换局后旧实例发的事件直接丢。
export const ZC_BATTLE_EVENTS = {
    PVE_RESULT: 'zcds:battle:pve-result',
    RUNTIME_DESTROYED: 'zcds:battle:runtime-destroyed',
    FRAME: 'zcds:battle:frame',
    /** 请求回主界面；组合层用本局入口恢复目标页和焦点。*/
    RETURN_TO_MAIN: 'zcds:battle:return-to-main',
    /** 单向提示，不带回调。*/
    SHOW_TIP: 'zcds:battle:show-tip',
} as const;

export interface IZCBattleReturnToMain { readonly owner: object; }

/** 只有 PVE 发服务端结算；同一会话的重复结果只回写一次。*/
export interface IZCBattleResult { readonly owner: object; readonly victory: boolean; }

export interface IZCBattleRuntimeDestroyed { readonly owner: object; }

export interface IZCBattleShowTip { readonly owner: object; readonly message: string; }

/** 引擎只给帧脉冲，单局控制器按 owner 消费。*/
export interface IZCBattleFrame { readonly owner: object; readonly dt: number; }
