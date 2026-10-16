import { RequestMsg } from '../../../framework/net/RequestMsg';

/**
 * 占城（领地）· 章节汇总信息请求。
 *
 * 协议位置：`client_proto/protoCompiled.proto:4527-4541`
 *
 * | 协议 | 消息号 | 用途 |
 * |---|---|---|
 * | `CmdCityChapterInfoReqMsg` | —（请求方向） | 拉章节汇总：`idleTime` + `chapters[]` |
 * | `CmdCityChapterInfoRspMsg` | 904257191 | 回包，`info` 字段即 `ChapterInfo` |
 * | `CmdCityChapterInfoBroMsg` | 1350377416 | 服务端主动推：章节通关后整包刷新 |
 *
 * 与 {@link RequestTerritoryCellInfo} 那一组的差别：
 * - 那组是**单章格子**状态（按 `levelChapter` 拉），页面级、随开随拉；
 * - 这一条是**账号级章节汇总**（账号已解锁/通关了哪些章、上次挂机时间），
 *   登录后拉一次存本地，冒险页打开时直接读，不随页面销毁。
 */

/** 拉章节汇总信息。请求体为空（`CmdCityChapterInfoReqMsg {}`）。 */
export class RequestCityChapterInfo extends RequestMsg<
    CmdCityChapterInfoReqMsg,
    CmdCityChapterInfoRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdCityChapterInfoReqMsg';
    }
}
