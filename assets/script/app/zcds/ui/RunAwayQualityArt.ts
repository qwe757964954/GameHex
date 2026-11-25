import { FRAME_ART_ROOT } from '../../ArtPaths';
import type { ZCCardRarity } from '../model/ZCCombatCatalog';

/**
 * 战斗统计行的**品级底框**：直接复用卡框原图 `image/frame/common_img_pzk_0N`（103×126 整张）。
 *
 * 底框颜色跟卡牌品级走，映射与 `cardUiArtRarity.frame` 同源：
 * 金 `common_img_pzk_01` / 紫 `02` / 绿 `03` / 蓝 `04`。
 *
 * 🔴 这里**只认原图、不做派生图**：整张 pzk 带一条底部深灰「卡名条」（约占 21% 高），
 * 统计行头像位是 69×69 方块，靠 `RunAwayUnitItem.prefab` 里 `Avatar` 上的 `cc.Mask`（69×69）
 * 裁掉下方多出的部分——底图节点 `Base` 是 69×85、上对齐 Mask 顶边（y=-8），
 * 可见区正好压掉名条、只留方形底。换图直接换 pzk 原名，不要另出裁切版。
 */
export const RUNAWAY_QUALITY_FRAME_ROOT = FRAME_ART_ROOT;

export const RUNAWAY_QUALITY_FRAME_NAMES: Readonly<Record<ZCCardRarity, string>> = {
    gold: 'common_img_pzk_01',
    purple: 'common_img_pzk_02',
    green: 'common_img_pzk_03',
    blue: 'common_img_pzk_04',
};
