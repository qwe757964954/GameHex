import { _decorator, Color, Component, Label, Sprite } from 'cc';
import { ECelebrationRankSegment, rankSegmentOf } from './CelebrationTable';
import {
    OS_POWER_TEXT_STROKE,
    OS_RANK_TEXT_STROKE,
    osPowerTextColor,
    osRankTextColor,
    osTint,
} from './CelebrationArt';
import { OSArtStrip } from './OSArtStrip';
import { OSRewardSlot } from './OSRewardSlot';
import { rankConditionTextOf, rankReached, rankRowTextOf } from './CelebrationRepository';
import type { CelebrationFrames } from './CelebrationFrames';
import type { ICelebrationRankRow, ICelebrationSnapshot } from './CelebrationRepository';

const { ccclass, property } = _decorator;

/**
 * 庆典排名页的**一行**（prefab `ui/Celebration/OSRankRankItem`，659×103）。
 *
 * ## 这一行**没有显隐三态**，全是**颜色 / 置灰**（`item2` 原稿）
 *
 * 这是本模块最容易照抄错的一处 —— 两个控制器都只驱动颜色，不驱动显示：
 *
 * | 控制器 | 页 | 驱动谁 | 效果 |
 * |---|---|---|---|
 * | `状态`（`0,达标 / 1,未达标`） | `pages="1"` | `com_goods` 的 `gearLook values="1,0,1,1"` | 未达标 ⇒ **置灰**（不是隐藏） |
 * | 同上 | `pages="0,1"` | `lab_power` 的 `gearColor` | 达标 `#818181` / 未达标 `#eae2b6` |
 * | `名次`（`0,第一名 / 1,2-3名 / 2,其他`） | `pages="1,2"` | `文本_排名` 的 `gearColor` | 2-3名 `#33d6ff` / 其他 `#eae2b6`；第一名走 `default` `#f33333` |
 *
 * 🔴 **达标是灰色、未达标是米黄** —— 与直觉相反。原因见 `CelebrationArt.OS_POWER_TEXT_REACHED`
 * 的注释（`values` 只覆盖了「未达标」那一页，达标走 `default`）。**别对调**。
 *
 * ⚠️ FGUI 的 `grayed` 是**真灰度滤镜**，Cocos 没有内置灰度 ⇒ 用灰色 tint 近似（`osTint`），
 * 与 `FriendArt` / `ChatArt` 同口径，属**有意偏离**。
 *
 * ## 三个数值的口径
 *
 * | 处 | 老端 | 落点 |
 * |---|---|---|
 * | 名次文案 | `data.start == data.end ? '第N名' : 'N-M名'` | `rankRowTextOf` |
 * | 战力要求 | `SERVER_LAUNCH_RANKING_CONDITION_TEXT_1`（`{0}达{1}`，**不是**目标页的「达到」） | `rankConditionTextOf` |
 * | 右侧单个奖励 | `data.rewards2[0]`（`rewards1` 走左边的横排奖励条） | `firstReward2Of` |
 *
 * ⚠️ 左右两个奖励区**不是同一份数据**：`rewards1`（横排，多个）走 `RewardList`；
 * `rewards2[0]`（单个，品质框 + 数量）走 `com_goods`。抄反了不报错，只是奖励显示错。
 */
@ccclass('OSRankItem')
export class OSRankItem extends Component {
    @property({ type: Label, tooltip: 'RankText：`第1名` / `2-3名` / `21-50名`（FGUI `文本_排名`）' })
    rankText: Label = null!;

    @property({ type: OSArtStrip, tooltip: 'RewardList：横向奖励条（吃 `rewards1`）' })
    strip: OSArtStrip = null!;

    @property({ type: OSRewardSlot, tooltip: 'Goods：右侧单个奖励格（吃 `rewards2[0]`，FGUI `com_goods`）' })
    goods: OSRewardSlot = null!;

    @property({ type: Label, tooltip: 'PowerText：`{战力口径}达{N}`（FGUI `lab_power`）' })
    powerText: Label = null!;

    render(snapshot: ICelebrationSnapshot, row: ICelebrationRankRow, frames: CelebrationFrames): void {
        // ---- 名次文案 + 颜色（gearColor `名次`）----
        if (this.rankText) {
            this.rankText.string = rankRowTextOf(row);
            const segment = osSegmentOf(row);
            this.rankText.color = toColor(osRankTextColor(segment));
            this.rankText.outlineColor = toColor(OS_RANK_TEXT_STROKE);
        }

        // ---- 战力要求文案 + 颜色（gearColor `状态`）----
        const reached = rankReached(snapshot, row);
        if (this.powerText) {
            this.powerText.string = rankConditionTextOf(snapshot, row);
            this.powerText.color = toColor(osPowerTextColor(reached));
            this.powerText.outlineColor = toColor(OS_POWER_TEXT_STROKE);
        }

        // ---- 左侧横排奖励（`rewards1`）----
        if (this.strip) this.strip.render(snapshot, row.rewards1, frames);

        // ---- 右侧单个奖励（`rewards2[0]`）----
        if (this.goods) {
            const first = row.rewards2.length > 0 ? row.rewards2[0] : null;
            if (!first) {
                this.goods.hide();
            } else {
                this.goods.render(
                    frames.iconOf(snapshot, first.resId),
                    frames.qualityOf(snapshot, first.resId),
                    first.number,
                );
                // gearLook `状态 pages="1" values="1,0,1,1"` ⇒ 未达标整格置灰。
                // ⚠️ tint **无条件写**（规则 82）：`gearLook` 的默认是「不置灰」，
                //    只在翻转时写会让首次「未达标 === 缓存初值」短路、永久不灰。
                const tint = toColor(osTint(!reached));
                for (const sprite of collectSprites(this.goods)) sprite.color = tint;
                if (this.goods.num) this.goods.num.color = tint;
            }
        }
    }
}

/**
 * 行数据 → 名次分段（`名次` 控制器的页）。
 *
 * ⚠️ 分段判定**只有一份**（`CelebrationTable.rankSegmentOf`，可单测）—— 这里只把
 * 枚举转成给 `osRankTextColor` 用的字符串键，别再写一遍 `start === 1 / start >= 2 && end <= 3`。
 */
function osSegmentOf(row: ICelebrationRankRow): 'first' | 'secondThird' | 'other' {
    return OS_RANK_SEGMENT_NAMES[rankSegmentOf(row.start, row.end)];
}

/** 三通道 → `cc.Color`。 */
function toColor(rgb: readonly [number, number, number]): Color {
    return new Color(rgb[0], rgb[1], rgb[2], 255);
}

/** 一个奖励格里会被染色的 `cc.Sprite`（框 + 图标）。 */
function collectSprites(slot: OSRewardSlot): Sprite[] {
    const out: Sprite[] = [];
    if (slot.frame) out.push(slot.frame);
    if (slot.icon) out.push(slot.icon);
    return out;
}

/** `ECelebrationRankSegment` 与字符串分段是同一套口径的两个表示 —— 给单测对账用。 */
export const OS_RANK_SEGMENT_NAMES: Readonly<Record<ECelebrationRankSegment, 'first' | 'secondThird' | 'other'>> = {
    [ECelebrationRankSegment.First]: 'first',
    [ECelebrationRankSegment.SecondThird]: 'secondThird',
    [ECelebrationRankSegment.Other]: 'other',
};
