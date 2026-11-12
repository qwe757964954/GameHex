import {
    isLeagueNameUsable,
    leagueCreateBannerIndexOf,
    type ILeagueCostView,
} from './LeagueTable';

/**
 * 一次打开创建弹窗的业务状态与纯规则。
 *
 * 不持有视图、请求、资源或事件；「提交锁 / 在飞作废」由 Controller 负责。
 * `quickJoin` 初值 `true` = FGUI `按钮_勾选 <Button checked="true"/>` 的默认已勾态。
 */
export class LeagueCreateModel {
    name = '';
    selectIndex = 0;
    quickJoin = true;
    cost: ILeagueCostView | null = null;

    /** 空名 / `***` 不可用；不 trim（老端也允许纯空格）。 */
    get canSubmit(): boolean {
        return isLeagueNameUsable(this.name);
    }

    /** 发给协议的旗帜色，越界夹回 `[0,7]`。 */
    get banner(): number {
        return leagueCreateBannerIndexOf(this.selectIndex);
    }
}
