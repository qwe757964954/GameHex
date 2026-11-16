import { _decorator, Color, Component, Label } from 'cc';
import { rankSegmentOf } from './CelebrationTable';
import {
    OS_POWER_TEXT_STROKE,
    OS_RANK_TEXT_STROKE,
    osPowerTextColor,
    osRankTextColor,
    osTint,
} from './CelebrationArt';
import { OSArtStrip } from './OSArtStrip';
import { OSRewardSlot } from './OSRewardSlot';
import { isRankReached, rankConditionTextOf, rankRowTextOf } from './CelebrationRepository';
import type { CelebrationFrames } from './CelebrationFrames';
import type { ICelebrationRankRow, ICelebrationSnapshot } from './CelebrationRepository';

const { ccclass, property } = _decorator;

/**
 * 庆典排名页的一行（prefab `ui/Celebration/OSRankRankItem`，659×103）。
 *
 * 这一行没有显隐三态，`item2` 的两个控制器都只驱动颜色 / 置灰：
 * - `状态`（达标 / 未达标）：未达标时 `com_goods` 整格置灰（不是隐藏）；
 *   `lab_power` 达标 `#818181`、未达标 `#eae2b6` —— 达标是灰、未达标是米黄，与直觉相反，不要对调
 *   （原因见 `CelebrationArt.OS_POWER_TEXT_REACHED`）。
 * - `名次`（第一名 / 2-3名 / 其他）：2-3名 `#33d6ff`、其他 `#eae2b6`，第一名走元素默认色 `#f33333`。
 *
 * FGUI 的 `grayed` 是真灰度滤镜，Cocos 没有内置灰度，这里用灰色 tint 近似（`osTint`），与 `FriendArt` 同口径。
 *
 * 三处数值口径：名次文案 `start == end ? 第N名 : N-M名`；战力要求用
 * `SERVER_LAUNCH_RANKING_CONDITION_TEXT_1`（`{0}达{1}`，不是目标页的「达到」）；
 * 右侧单格吃 `rewards2[0]`，左侧横排吃 `rewards1` —— 两部分不是同一份数据，抄反不报错、只是奖励显示错。
 */
@ccclass('OSRankItem')
export class OSRankItem extends Component {
    @property({ type: Label, tooltip: 'RankText：第1名 / 2-3名 / 21-50名（FGUI 文本_排名）' })
    rankText: Label = null!;

    @property({ type: OSArtStrip, tooltip: 'RewardList：横向奖励条（吃 rewards1）' })
    strip: OSArtStrip = null!;

    @property({ type: OSRewardSlot, tooltip: 'Goods：右侧单个奖励格（吃 rewards2[0]，FGUI com_goods）' })
    goods: OSRewardSlot = null!;

    @property({ type: Label, tooltip: 'PowerText：{战力口径}达{N}（FGUI lab_power）' })
    powerText: Label = null!;

    render(snapshot: ICelebrationSnapshot, row: ICelebrationRankRow, frames: CelebrationFrames): void {
        this.rankText.string = rankRowTextOf(row);
        this.rankText.color = toColor(osRankTextColor(rankSegmentOf(row.start, row.end)));
        this.rankText.outlineColor = toColor(OS_RANK_TEXT_STROKE);

        const reached = isRankReached(snapshot, row);
        this.powerText.string = rankConditionTextOf(snapshot, row);
        this.powerText.color = toColor(osPowerTextColor(reached));
        this.powerText.outlineColor = toColor(OS_POWER_TEXT_STROKE);

        this.strip.render(snapshot, row.rewards1, frames);

        const first = row.rewards2.length > 0 ? row.rewards2[0] : null;
        if (!first) {
            this.goods.hide();
            return;
        }
        this.goods.render(
            frames.iconOf(snapshot, first.resId),
            frames.qualityOf(snapshot, first.resId),
            first.number,
        );
        // 未达标整格置灰；tint 无条件写，避免首次「未达标 === 缓存初值」短路。
        const tint = toColor(osTint(!reached));
        this.goods.frame.color = tint;
        this.goods.icon.color = tint;
        this.goods.num.color = tint;
    }
}

/** 三通道 → `cc.Color`。 */
function toColor(rgb: readonly [number, number, number]): Color {
    return new Color(rgb[0], rgb[1], rgb[2], 255);
}
