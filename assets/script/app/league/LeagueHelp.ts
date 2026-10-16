/**
 * 联盟帮助页（轻量）。
 *
 * 老端 `CtrlAlert.OpenHelpe(id)` 按字符串 id 查 `IRefsystemDesc` 配置表弹帮助面板；
 * Demo3.8 没有 `CtrlAlert`、也没迁那份配置表 ⇒ 这里用一张**静态注册表**承接，
 * 内容由本工程补（见 `LEAGUE_HELP_CONTENT`）。目标面板复用通用 `CommonTips`
 * （title + 多行 content + 单确认按钮），无需新 prefab。
 *
 * 已接线：
 *   - `LeaguePage.BtnHelp`      → `openLeagueHelp('league')`
 *   - `LeagueNorthExpeditionPage.HelpBtn` → `openLeagueHelp(LEAGUE_NORTH_HELP_ID)`
 */
import { FW } from '../../framework/FW';
import { CommonTips } from '../common/CommonTips';

interface LeagueHelpEntry {
    /** 弹窗标题。 */
    title: string;
    /** 正文（多行，用 `\n` 分行，对齐成员资料卡写法）。 */
    content: string;
}

/**
 * 帮助内容注册表。key = 老端 `OpenHelpe(id)` 的 id。
 *
 * ⚠️ 老端这些文案来自 `IRefsystemDesc` 配置表，本工程未迁那份表，这里**手写静态兜底**
 *    （与联盟其它「配置没迁就静态兜底」的口径一致，如 `LEAGUE_NORTH_HELP_ID`）。
 *    要补新帮助页，往这里加一条即可。
 */
const LEAGUE_HELP_CONTENT: Record<string, LeagueHelpEntry> = {
    league: {
        title: '联盟帮助',
        content: [
            '· 联盟是玩家互助组织，加入后可参与联盟任务、捐献、商店与北伐中原等活动。',
            '· 联盟任务：完成每日任务积累进度，领取任务奖励与进度宝箱。',
            '· 联盟捐献：捐献金币可获得个人贡献，贡献用于在联盟商店兑换道具。',
            '· 联盟商店：用贡献兑换各类资源与道具。',
            '· 北伐中原：联盟集体活动，在开放时段内参与擂鼓、扫荡与挑战获取奖励。',
            '· 成员管理：盟主与副盟主可审核申请、管理成员与调整职位。',
        ].join('\n'),
    },
    leaguefb01: {
        title: '北境远征说明',
        content: [
            '· 北境远征（北伐中原）是联盟集体活动，仅在每天的开放时段内可参与。',
            '· 擂鼓：消耗次数鼓舞士气，提升全体成员属性加成。',
            '· 扫荡：在开放时段内快速领取挑战奖励。',
            '· 挑战：挑战北境 Boss，需进入 PVE 副本战斗。',
            '· 排行 / 奖励：可在对应入口查看个人与联盟的进度奖励。',
            '· 注意：本端「挑战」所需的 PVE 副本战斗尚未接入，挑战功能暂未开放。',
        ].join('\n'),
    },
};

/** 打开联盟帮助面板；id 找不到时给一条明确提示（不静默失败）。 */
export function openLeagueHelp(id: string): void {
    const entry = LEAGUE_HELP_CONTENT[id];
    if (!entry) {
        FW.showTip('帮助内容暂未配置');
        return;
    }
    void CommonTips.open({
        userData: { title: entry.title, content: entry.content, showCancel: false },
    });
}
