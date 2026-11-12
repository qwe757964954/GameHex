import type { ILeagueDonateSnapshot } from './LeagueRepository';
import { LEAGUE_COIN_RES_ID } from './LeagueTable';

/**
 * 一次打开捐献弹窗的业务状态与纯规则。
 *
 * 不持有视图、请求、广告播放或确认框；「写锁 / 在飞作废」由 Controller 负责。
 */
export class LeagueDonateModel {
    snapshot: ILeagueDonateSnapshot | null = null;

    /** 金币捐献还有次数（老端 `todayDonateTimes >= unionDonateMaxCount` 的反面）。 */
    get hasTimes(): boolean {
        return this.snapshot?.hasTimes === true;
    }

    /** 扣金币够不够。 */
    get enough(): boolean {
        return this.snapshot?.enough === true;
    }

    /** 广告捐献次数闸（老端 `GetAdvertRestTimes(AdType.unionDonate) <= 0`）。 */
    get freeAvailable(): boolean {
        const snapshot = this.snapshot;
        return !!snapshot && snapshot.todayDonateAdvTimes < snapshot.config.donateAdvCount;
    }

    /** 「免费：{剩余}/{上限}」里的剩余次数，负数钳成 0。 */
    get freeRest(): number {
        const snapshot = this.snapshot;
        if (!snapshot) return 0;
        return Math.max(0, snapshot.config.donateAdvCount - snapshot.todayDonateAdvTimes);
    }

    /** 金币的名字（「金币」）—— 从 `roleProperty` 表取 `resId=10` 那行。 */
    get coinName(): string {
        return this.snapshot?.resources.get(LEAGUE_COIN_RES_ID)?.name ?? '';
    }
}
