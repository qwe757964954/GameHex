import { GameNet } from '../../net/GameNet';
import type { RequestMsg } from '../../../framework/net/RequestMsg';
import type { IBigMapSlgGateway, IBigMapSlgRequestBody, IBigMapSlgRequestName } from './BigMapSlgRepository';
import { bigMapServerInstanceId, bigMapServerUint } from '../model/BigMapServerState';
import {
    RequestSlgActionUpdate, RequestSlgGameInfo, RequestSlgBuildInfo, RequestSlgBuild, RequestSlgBuildUpgrade,
    RequestSlgBuildCancel, RequestSlgBuildMove, RequestSlgBuildCollect, RequestSlgBuildUnlockQueue,
} from './RequestBigMapSlgMsg';

/
 *同一类拦截只吼一次。
 *
 * 为什么必须留下这条日志：`request` 在「没连上 / 存档已切换」时返回 `null`，
 *`BigMapSlgRepository.request` 把它当超时吞掉，最终界面只显示一句
 *「正在同步基地信息」——请求根本没发出去，但界面看起来像在等回包。
 *2026-11-11 用户反馈「放置时提示正在同步、服务器没收到请求」，就是被这层静默挡住的。
 */
const warnedOnce = new Set<string>();
function warnBlocked(reason: string): void {
    if (warnedOnce.has(reason)) return;
    warnedOnce.add(reason);
    console.warn(`[BigMap] SLG 请求被拦下（${reason}），基地信息拉不到 ⇒ 建造/升级会一直提示「正在同步基地信息」`);
}

/ 复用现有 Socket、缓存与广播分发；页面生命周期由 Repository 管理。 */
export class GameNetBigMapSlgGateway implements IBigMapSlgGateway {
    private isDisposed = false;
    constructor(private readonly isOwnerCurrent: () => boolean) {}

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        GameNet.instance.removeCaller(this);
    }

    async request(name: IBigMapSlgRequestName, body: IBigMapSlgRequestBody): Promise<unknown> {
        const net = GameNet.instance;
        if (this.isDisposed) return null;
        if (!net.isConnected) { warnBlocked('未连接服务器'); return null; }
        if (!this.isOwnerCurrent()) { warnBlocked('存档已切换 / 页面已关闭'); return null; }
        let response: unknown = null;
        const receive = (rsp: unknown): void => { response = rsp; };
        const uint = (key: string): number => {
            const value = bigMapServerUint(body[key]);
            if (value === null) throw new Error(`[SLG] 非法请求字段 ${key}`);
            return value;
        };
        const id = (): number => {
            const value = bigMapServerInstanceId(body.buildInstId);
            if (!value) throw new Error('[SLG] 非法建筑实例 ID');
            return value;
        };
        / 批量领取的实例列表：空数组、越界或非数字都拒绝，不编码截断。 */
        const ids = (): number[] => {
            const raw = body.buildInstIds;
            if (!Array.isArray(raw) || raw.length === 0) throw new Error('[SLG] 非法建筑实例 ID');
            return raw.map((value) => {
                const instanceId = bigMapServerInstanceId(value);
                if (!instanceId) throw new Error('[SLG] 非法建筑实例 ID');
                return instanceId;
            });
        };
        let request: RequestMsg<unknown, unknown>;
        switch (name) {
            case 'CmdSlgActionUpdateReqMsg': request = new RequestSlgActionUpdate({}, this, receive); break;
            case 'CmdSlgGameInfoReqMsg': request = new RequestSlgGameInfo({}, this, receive); break;
            case 'CmdSlgBuildInfoReqMsg': request = new RequestSlgBuildInfo({}, this, receive); break;
            case 'CmdSlgBuildReqMsg':
                request = new RequestSlgBuild({
                    buildingId: uint('buildingId'), position: uint('position'), instant: uint('instant'),
                }, this, receive);
                break;
            case 'CmdSlgBuildUpgradeReqMsg':
                request = new RequestSlgBuildUpgrade({ buildInstId: id(), instant: uint('instant') }, this, receive);
                break;
            case 'CmdSlgBuildCancelReqMsg': request = new RequestSlgBuildCancel({ buildInstId: id() }, this, receive); break;
            case 'CmdSlgBuildMoveReqMsg': request = new RequestSlgBuildMove({ buildInstId: id(), position: uint('position') }, this, receive); break;
            case 'CmdSlgBuildCollectReqMsg': request = new RequestSlgBuildCollect({ buildInstIds: ids() }, this, receive); break;
            case 'CmdSlgBuildUnlockQueueReqMsg': request = new RequestSlgBuildUnlockQueue({ queueId: uint('queueId') }, this, receive); break;
        }
        const expiresAt = Date.now() + 5000;
        request.canSend = () => !this.isDisposed && this.isOwnerCurrent() && Date.now() < expiresAt;
        request.allowRetry = name === 'CmdSlgGameInfoReqMsg' || name === 'CmdSlgActionUpdateReqMsg'
            || name === 'CmdSlgBuildInfoReqMsg';
        const sent = await net.send(request, false);
        //发送失败（协议未注册 / 通道关闭）同样要留痕，否则表现和「没连上」一模一样：
        //一切静默，界面只剩「正在同步基地信息」。
        if (!sent) warnBlocked(`发送失败 ${name}`);
        return sent && !this.isDisposed && this.isOwnerCurrent() ? response : null;
    }

}
