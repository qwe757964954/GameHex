/**
 * 临时探针：定位「整屏渲染崩（frame should not be invalid, it may have been released）」
 * 的**真正持有方**。
 *
 * 两条互补的入口：
 *  · `reportDeadSpriteFrames(原因)` —— 资源释放后调用，发现坏帧点名并置空，让这一屏能继续画；
 *  · `installBrokenFrameWatch()`    —— 全局只读哨兵（`CocosAssetService` 构造时挂上），
 *    每 `WATCH_INTERVAL_FRAMES` 帧扫一遍场景，**只打印不改**，同一个节点 / 帧只报一次。
 *
 * 为什么需要第二条：崩的时候未必刚发生资源释放（可能是异步加载回来就是坏帧），
 * 而崩溃点在 `Batcher2D` 里，拿不到节点名。哨兵把节点路径 + 帧名 + 失效形态补上。
 * 定位到持有方后，整段连同 `CocosAssetService.releaseAfterDraw` 里的调用一起删掉。
 */

import { Director, director, Node, Sprite } from 'cc';
import { DEBUG } from 'cc/env';

/** 每多少帧扫一次场景（60fps 下约 0.1s；离场淡出窗口只有 ~10 帧，粒度必须细于此）。 */
const WATCH_INTERVAL_FRAMES = 6;

export interface IBrokenSpriteFrame {
    /** 场景内节点路径，可直接在层级面板定位。 */
    readonly path: string;
    /** 坏帧的 SpriteFrame.name。 */
    readonly frame: string;
    /** 帧资产 uuid（可反查是哪个 png）。 */
    readonly uuid: string;
    /** `false` = 帧已被 destroy（`Batcher2D` 的 assert 命中的就是这种）。 */
    readonly frameValid: boolean;
    /** 帧还在但贴图已解绑（`getGFXTexture` 空指针命中的就是这种）。 */
    readonly textureNull: boolean;
}

/** 哨兵是否已经挂上（`director` 是全局的，重复挂会重复扫）。 */
let watchInstalled = false;
/** 已报过的 `路径|帧名|形态`，避免每 30 帧刷同一批。 */
const reported = new Set<string>();

/**
 * 挂全局坏帧哨兵（仅调试构建）。幂等。
 *
 * ⚠️ 只读：**不要**在这里置空 `sprite.spriteFrame` —— 那会把证据抹掉，
 *    看到的现象会变成「结算页某几格奖励图空白」而不是崩。
 */
export function installBrokenFrameWatch(): void {
    if (!DEBUG || watchInstalled) return;
    // 用例里的假 `cc` 没有 Director：这是纯诊断件，缺引擎就当没装，不能把构造打挂。
    if (!Director || typeof director?.on !== 'function') return;
    watchInstalled = true;
    let tick = 0;
    // ⚠️ 必须挂在 `AFTER_UPDATE`（渲染前），不能挂 `AFTER_DRAW`：
    //    Batcher2D 在渲染阶段崩（`commitComp` 里 `getGFXTexture` 空指针）会中断整趟绘制，
    //    `EVENT_AFTER_DRAW` 根本不会发射 ⇒ 哨兵永远等不到，日志里只剩 assert 和 Uncaught。
    const event = Director.EVENT_AFTER_UPDATE ?? Director.EVENT_BEFORE_DRAW;
    director.on(event, () => {
        tick += 1;
        if (tick % WATCH_INTERVAL_FRAMES !== 0) return;
        dumpBrokenSpriteFrames('场景哨兵');
    });
}

/** 扫一遍场景，把挂着坏帧的 Sprite 打到控制台（只读）。返回本帧命中的全部条目。 */
export function dumpBrokenSpriteFrames(reason: string, limit = 30): IBrokenSpriteFrame[] {
    if (!DEBUG) return [];
    const hits = collectBrokenSpriteFrames(limit);
    const fresh = hits.filter((hit) => {
        const key = `${hit.path}|${hit.frame}|${hit.frameValid}`;
        if (reported.has(key)) return false;
        reported.add(key);
        return true;
    });
    if (fresh.length === 0) return hits;
    console.error(`[SpriteFrameGuard] ${reason}：${fresh.length} 个 Sprite 挂着坏帧`
        + '（isValid=false ⇒ 帧已 destroy；texture=null ⇒ 贴图已解绑）\n'
        + fresh.map((hit) => `  · ${hit.path} ← ${hit.frame}`
            + ` [uuid=${hit.uuid}, isValid=${hit.frameValid}, textureNull=${hit.textureNull}]`).join('\n'));
    return hits;
}

/** 纯扫描：不改场景，不去重。 */
export function collectBrokenSpriteFrames(limit = 30): IBrokenSpriteFrame[] {
    if (!DEBUG) return [];
    const scene = director.getScene();
    if (!scene) return [];
    const hits: IBrokenSpriteFrame[] = [];
    const walk = (node: Node): void => {
        if (hits.length >= limit) return;
        const sprite = node.getComponent(Sprite);
        const frame = sprite?.spriteFrame;
        if (sprite && frame && (!frame.isValid || !frame.texture)) {
            hits.push({
                path: pathOf(node),
                frame: frame.name || '(unnamed)',
                uuid: frame.uuid,
                frameValid: frame.isValid,
                textureNull: !frame.texture,
            });
        }
        for (const child of node.children) walk(child);
    };
    walk(scene);
    return hits;
}

/** 找出场景里挂着已释放贴图的 Sprite 并置空；仅调试构建执行。 */
export function findDeadSpriteFrames(limit = 20): IBrokenSpriteFrame[] {
    if (!DEBUG) return [];
    const scene = director.getScene();
    if (!scene) return [];
    const hits: IBrokenSpriteFrame[] = [];
    const walk = (node: Node): void => {
        if (hits.length >= limit) return;
        const sprite = node.getComponent(Sprite);
        const frame = sprite?.spriteFrame;
        if (sprite && frame && !frame.texture) {
            hits.push({
                path: pathOf(node),
                frame: frame.name || '(unnamed)',
                uuid: frame.uuid,
                frameValid: frame.isValid,
                textureNull: true,
            });
            // 让渲染器跳过空帧 —— Batcher2D 会跳过空帧，一张坏图不能拖垮整屏。
            sprite.spriteFrame = null;
        }
        for (const child of node.children) walk(child);
    };
    walk(scene);
    return hits;
}

/** 资源释放后调用：发现坏图点名报出并临时置空。 */
export function reportDeadSpriteFrames(reason: string): void {
    const hits = findDeadSpriteFrames();
    if (!hits.length) return;
    console.error(`[SpriteFrameGuard] ${reason}：${hits.length} 个 Sprite 挂着**已释放**的贴图`
        + '（已临时置空，避免整屏渲染崩；请把下面这些路径发回来定位真正的持有方）\n'
        + hits.map((hit) => `  · ${hit.path} ← ${hit.frame}`).join('\n'));
}

function pathOf(node: Node): string {
    const parts: string[] = [];
    let current: Node | null = node;
    while (current?.isValid && current.parent) {
        parts.unshift(current.name || '(unnamed)');
        current = current.parent;
    }
    return parts.join('/') || '(scene)';
}
