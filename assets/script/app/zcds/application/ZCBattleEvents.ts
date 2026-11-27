import type { IZCGuidePreparedContent } from '../model/ZCGuideConfig';
import type { IRankSeat, RankSeatProfiles } from '../model/ZCRankBoard';
import type { IZCDamageStatsSeats, IZCDamageStatsUnit } from '../model/ZCDamageStats';
import type { IZCSettlementOptions } from '../ui/ZCSettlementPage';

// 订阅方按事件来源识别当前对局的展示实例。
export const ZC_BATTLE_EVENTS = {
    PVE_RESULT: 'zcds:battle:pve-result',
    RUNTIME_DESTROYED: 'zcds:battle:runtime-destroyed',
    FRAME: 'zcds:battle:frame',
    /** 请求回主界面；组合层用本局入口恢复目标页和焦点。*/
    RETURN_TO_MAIN: 'zcds:battle:return-to-main',
    /** 单向提示，不带回调。*/
    SHOW_TIP: 'zcds:battle:show-tip',
    /** 展示型弹窗命令（由组合层托管开启、刷新、关闭与迟到回收）。*/
    POPUP_COMMAND: 'zcds:battle:popup-command',
    /** 战斗统计弹窗开关状态回告（视图打开完成或关闭时通知对应控制器）。*/
    DAMAGE_POPUP_STATE: 'zcds:battle:damage-popup-state',
} as const;

export type ZCBattlePopupPhase = 'runtime' | 'settlement';

export type ZCBattlePopupCommand =
    | { readonly kind: 'openGuide'; readonly content: IZCGuidePreparedContent }
    | { readonly kind: 'openDamage'; readonly phase: ZCBattlePopupPhase; readonly units: readonly IZCDamageStatsUnit[]; readonly seats?: IZCDamageStatsSeats }
    | { readonly kind: 'refreshDamage'; readonly units: readonly IZCDamageStatsUnit[] }
    | { readonly kind: 'openRank'; readonly seats: readonly IRankSeat[]; readonly profiles: RankSeatProfiles }
    | { readonly kind: 'closeRuntimePopups' }
    | { readonly kind: 'openSettlement'; readonly options: IZCSettlementOptions; readonly playOutcome: boolean }
    | { readonly kind: 'closeSettlement'; readonly reason: 'manual' | 'force' }
    | { readonly kind: 'closeSettlementPopups' };

export interface IZCBattleDamagePopupState {
    readonly phase: ZCBattlePopupPhase;
    readonly open: boolean;
}

/** 只有 PVE 发服务端结算；同一会话的重复结果只回写一次。*/
export interface IZCBattleResult { readonly victory: boolean; }

export interface IZCBattleShowTip { readonly message: string; }

/** 引擎只给帧脉冲，单局控制器按来源消费。*/
export interface IZCBattleFrame { readonly dt: number; }
