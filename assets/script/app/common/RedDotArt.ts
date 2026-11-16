import type { SpriteFrame } from 'cc';
import { createRoutedSpriteFrameCache } from './SpriteFrameCache';
import { COMMON_ART_ROOT, spriteFramePath } from '../ArtPaths';
import type { RedDotArtKey } from './RedDotState';

/**
 * 红点（FGUI `组件_公用_红点`）的美术口径唯一入口。
 *
 * 三张静态图来自 FGUI 包 `公用0/图片`，都落在 `image/common/`（会随工程图集打包）：
 *
 * | key | 文件名 | 显示尺寸 |
 * |---|---|---|
 * | `ordinary` | `cm_red_dot` | 30×29 |
 * | `number` | `cm_red_dot_num` | 30×30 |
 * | `new` | `cm_red_dot_new` | 30×29 |
 *
 * 尺寸按 FGUI loader 的 `scaleMatchWidth`（30 宽容器按宽缩放）逐张给，
 * 不能统一写 30×30，否则数字底会被压扁 1px。
 *
 * 普通红点在老端是 spine 动画：`skel/reddot` 四件套，动画名 `anmation`（上游少一个 i，别改）。
 * 渲染尺寸 33×38.4 是骨架的自然尺寸（图集 region 55×64 × 骨骼 scale 0.6），
 * 老端按同样尺寸渲染，所以节点 scale 保持 1，不要再缩放。
 */

/** 红点静态图所在目录（`image/common`）。 */
export const RED_DOT_ART_ROOT = COMMON_ART_ROOT;

/** 三张静态图的文件名（不含扩展名）。 */
export const RED_DOT_ART_NAMES: Readonly<Record<RedDotArtKey, string>> = {
    ordinary: 'cm_red_dot',
    number: 'cm_red_dot_num',
    new: 'cm_red_dot_new',
};

/** 全部 key（稳定顺序，供预加载遍历）。 */
export const RED_DOT_ART_KEYS: readonly RedDotArtKey[] = ['ordinary', 'number', 'new'];

/** 每张图在界面上该占的尺寸：`[宽, 高]`。 */
export const RED_DOT_ICON_SIZES: Readonly<Record<RedDotArtKey, readonly [number, number]>> = {
    ordinary: [30, 29],
    number: [30, 30],
    new: [30, 29],
};

/** 取某张图的装配路径。 */
export function redDotArtPath(key: RedDotArtKey): string {
    const name = RED_DOT_ART_NAMES[key];
    return spriteFramePath(RED_DOT_ART_ROOT, name);
}

/** 取某张图的显示尺寸。 */
export function redDotIconSize(key: RedDotArtKey): readonly [number, number] {
    return RED_DOT_ICON_SIZES[key];
}

/** 动画名就长这样，别「修正」它：写成 `animation` 会静默不播。 */
export const RED_DOT_SPINE_ANIMATION = 'anmation';

/** spine 节点的显示尺寸（骨架自然尺寸）。 */
export const RED_DOT_SPINE_SIZE: { readonly width: number; readonly height: number } = {
    width: 33,
    height: 38.4,
};

const frameCache = createRoutedSpriteFrameCache('RedDot');

export function loadRedDotFrame(key: RedDotArtKey): Promise<SpriteFrame | null> {
    return frameCache.load(redDotArtPath(key));
}

/** 预加载三张红点图（进界面前调一次，减少首帧空白）。 */
export function preloadRedDotFrames(): Promise<void> {
    return Promise.all(RED_DOT_ART_KEYS.map((key) => loadRedDotFrame(key))).then(() => undefined);
}

/** 退出登录时释放本次会话持有的动态美术引用。 */
export function releaseRedDotFrames(): void {
    frameCache.clear();
}
