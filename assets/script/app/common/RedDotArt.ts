import { resources, SpriteFrame } from 'cc';
import { artKey, COMMON_ART_ROOT, spriteFramePath } from '../ArtPaths';
import type { RedDotArtKey } from './RedDotState';

/**
 * 红点（FGUI `组件_公用_红点`）的**美术口径唯一入口**。
 *
 * ## 三张静态图
 * 来自 FGUI 包 `公用0/图片`（`ui://w3m64m87…`，见 `组件_公用_红点.xml` 的 loader `gearIcon`）：
 *
 * | key | FGUI 原名 | 原图 | FGUI 显示（`scaleMatchWidth`，容器 30 宽） |
 * |---|---|---|---|
 * | `ordinary` | `公用_图标_红点.png`   | 29×28 | 30×28.97 → 取 **30×29** |
 * | `number`   | `公用_图标_红点02.png` | 30×30 | 30×30 |
 * | `new`      | `公用_图标_新.png`     | 42×40 | 30×28.57 → 取 **30×29** |
 *
 * ⚠️ 三张图都落在 **`image/common/`**（工程既有目录，r121 起就带 `auto-atlas.pac`，红点会随之进图集）
 * —— 装载一律走 `resources.load('<路径>/spriteFrame')`，与是否进图集无关（见 `ArtPaths.spriteFramePathOf`）。
 *
 * ## spine（普通红点）
 * `client/assets/resources/塔防/spine/reddot/` → `assets/resources/skel/reddot/`：
 * `.skel` + `.atlas.txt` + `.png` + `.prefab`（spine 3.8.95，与已验证可用的 `skel/yueka` 同版本）。
 *
 * 显示尺寸 **33×38.4**，来源是**反解 `.skel` 二进制**（不是猜、也不是抄老端 prefab 的节点尺寸）：
 * - 骨架画布 `x=-16.0059 y=-17.4404 w=33.0000076 h=38.4`（spine 二进制里 float 是**大端**）；
 * - 唯一骨骼 `base_bg` 的 `scaleX = scaleY = 0.6`；
 * - 唯一 region `base_bg` 在图集里是 55×64 ⇒ **55×0.6 = 33**、**64×0.6 = 38.4**，两个方向都对上。
 *
 * ⚠️ 老端 `reddot.prefab` 里节点的 contentSize 写的是 **27.5×32**（= 图集的一半），
 * 那**不是**渲染尺寸 —— 老端 loader（`GLoaderProtocalRes.UpdateNodeSize`）有个
 * `if (width != 0 && height != 0 …)` 的短路，而 `reddot.prefab` 根节点 width=0 ⇒ 那条缩放分支**根本不执行**
 * ⇒ 老端实际就是按骨架自然尺寸 33×38.4 渲染。**这边 node scale 保持 1，不要再缩放。**
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

/**
 * 每张图在界面上该占的尺寸。
 *
 * FGUI 的 loader 是 30×30 容器 + `fill="scaleMatchWidth"` ⇒ 按**宽度**缩到 30、高度按原图比例。
 * 三张图比例不同，所以尺寸必须逐张给，不能统一写 30×30（× 也会让数字底被压扁 1px）。
 */
export const RED_DOT_ICON_SIZES: Readonly<Record<RedDotArtKey, readonly [number, number]>> = {
    ordinary: [30, 29],
    number: [30, 30],
    new: [30, 29],
};

/** 取某张图的装配路径；`key` 未知时返回 `null`。 */
export function redDotArtPath(key: RedDotArtKey): string | null {
    const name = RED_DOT_ART_NAMES[key];
    if (!name) return null;
    return spriteFramePath(RED_DOT_ART_ROOT, name);
}

/** 取某张图的显示尺寸（`[宽, 高]`）。 */
export function redDotIconSize(key: RedDotArtKey): readonly [number, number] {
    return RED_DOT_ICON_SIZES[key] ?? RED_DOT_ICON_SIZES.ordinary;
}

// ============================================================
// spine（普通红点 —— 老端的「红点闪闪」）
// ============================================================

/** spine 四件套所在目录。 */
export const RED_DOT_SPINE_DIR = 'skel/reddot';

/** spine 预制体路径（`resources.load` 用；红点组件本身把 `sp.Skeleton` 直接嵌在 prefab 里，不依赖它）。 */
export const RED_DOT_SPINE_PREFAB_PATH = `${RED_DOT_SPINE_DIR}/reddot`;

/** SkeletonData 资源路径（不带扩展名）。 */
export const RED_DOT_SPINE_DATA_PATH = `${RED_DOT_SPINE_DIR}/reddot`;

/**
 * 动画名 —— **就长这样，别「修正」它**。
 * `.skel` 里存的动画名是 `anmation`（上游 spelling 少一个 `i`），老端 prefab 的
 * `_animationName` / `defaultAnimation` 也是 `anmation`。写成 `animation` 会静默不播。
 */
export const RED_DOT_SPINE_ANIMATION = 'anmation';

/**
 * spine 节点的显示尺寸 = 骨架的**自然渲染尺寸**（反解 `.skel` 得来，见文件头注释）。
 * 比 FGUI 的 30×30 容器略大 —— 老端也是这样（loader 的缩放分支被 width=0 短路掉了）。
 */
export const RED_DOT_SPINE_SIZE: { readonly width: number; readonly height: number } = {
    width: 33,
    height: 38.4,
};

// ============================================================
// 帧缓存（自持，不依赖 Host 预加载）
// ============================================================

/**
 * 红点会在非常多的界面里出现（页签 / 按钮 / 入口），让每个宿主各自预加载这三张小图是重复劳动，
 * 所以本模块自带一份缓存。
 *
 * ⚠️ 没有复用 `card/CardLineupIcons.loadCommonArt()`（那份 idiom 一模一样）——
 * `app/common` 是**通用层**，反过来依赖 `app/card` 会把依赖方向搞颠倒。
 * 代价是这一段 20 行左右的重复，等以后有人把「按 root 加载 spriteFrame」提到 `app/` 层再合并。
 */
const frameCache = new Map<string, SpriteFrame>();
const pendingLoads = new Map<string, Promise<SpriteFrame | null>>();
let cacheGeneration = 0;

/** 加载红点静态图（带缓存；失败返回 `null` 且只打一条 warn，不抛）。 */
export function loadRedDotFrame(key: RedDotArtKey): Promise<SpriteFrame | null> {
    const path = redDotArtPath(key);
    if (!path) return Promise.resolve(null);
    const cached = frameCache.get(path);
    if (cached?.isValid) return Promise.resolve(cached);
    if (cached) frameCache.delete(path);
    const running = pendingLoads.get(path);
    if (running) return running;
    const generation = cacheGeneration;

    const task = new Promise<SpriteFrame | null>((resolve) => {
        resources.load(path, SpriteFrame, (error, frame) => {
            if (error || !frame || !frame.isValid) {
                console.warn(`[RedDot] 红点图加载失败：${path}`, error);
                resolve(null);
                return;
            }
            if (generation !== cacheGeneration) {
                resolve(null);
                return;
            }
            // JS Map 不参与 Cocos 引用计数，缓存必须自己持有引用。
            frame.addRef();
            frameCache.set(path, frame);
            resolve(frame);
        });
    });
    pendingLoads.set(path, task);
    const clearPending = (): void => {
        if (pendingLoads.get(path) === task) pendingLoads.delete(path);
    };
    void task.then(clearPending, clearPending);
    return task;
}

/** 预加载三张红点图（进界面前调一次，减少首帧空白）。 */
export function preloadRedDotFrames(): Promise<void> {
    return Promise.all(RED_DOT_ART_KEYS.map((key) => loadRedDotFrame(key))).then(() => undefined);
}

/** 退出登录时释放本次会话持有的动态美术引用。 */
export function releaseRedDotFrames(): void {
    cacheGeneration += 1;
    pendingLoads.clear();
    for (const frame of frameCache.values()) {
        if (frame?.isValid) frame.decRef();
    }
    frameCache.clear();
}

/** 缓存键（与其它美术加载器同口径：`<root>/<name>`）。 */
export function redDotArtCacheKey(key: RedDotArtKey): string {
    return artKey(RED_DOT_ART_ROOT, RED_DOT_ART_NAMES[key]);
}
