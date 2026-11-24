// 订阅方按事件来源识别当前对局的展示实例。
export const ZC_BATTLE_EVENTS = {
    PVE_RESULT: 'zcds:battle:pve-result',
    RUNTIME_DESTROYED: 'zcds:battle:runtime-destroyed',
    FRAME: 'zcds:battle:frame',
    /** 请求回主界面；组合层用本局入口恢复目标页和焦点。*/
    RETURN_TO_MAIN: 'zcds:battle:return-to-main',
    /** 单向提示，不带回调。*/
    SHOW_TIP: 'zcds:battle:show-tip',
} as const;

/** 只有 PVE 发服务端结算；同一会话的重复结果只回写一次。*/
export interface IZCBattleResult { readonly victory: boolean; }

export interface IZCBattleShowTip { readonly message: string; }

/** 引擎只给帧脉冲，单局控制器按来源消费。*/
export interface IZCBattleFrame { readonly dt: number; }
