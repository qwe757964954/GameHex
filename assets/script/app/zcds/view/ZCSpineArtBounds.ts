/**
 * Spine 当前姿态的美术包围盒：只量 skin 上的区域/mesh 附件顶点，不依赖渲染。
 *
 * 为什么要单独量：`SkeletonData.height` 是骨架 canvas，不等于角色可见高度。
 * 实测磁电菇 canvas 1798，setup pose 还会把 `sg*` 闪光件算进去（1772）；
 * 按 idle 首帧量出来只有 772×980，才是角色真正占的画面。
 *
 * 纯函数、零 cc：宿主传入 `sp.spine.Skeleton`（鸭子类型），测试用假骨架即可覆盖。
 */
export interface ISpineArtAttachment {
    /** mesh 附件才有；区域附件没有该字段。*/
    worldVerticesLength?: number;
    width?: number;
    height?: number;
    /** ClippingAttachment 的字段：裁剪形状不可见，不参与包围盒。*/
    endSlot?: unknown;
    /** PathAttachment 的字段：路径不可见，不参与包围盒。*/
    lengths?: unknown;
    computeWorldVertices(...args: unknown[]): void;
}

export interface ISpineArtSlot {
    bone?: unknown;
    /** 当前姿态的槽位透明度；idle 首帧被动画藏掉的效果件要跳过。*/
    color?: { a: number };
    getAttachment(): ISpineArtAttachment | null;
}

export interface ISpineArtSkeleton {
    slots: readonly ISpineArtSlot[];
}

export interface ISpineArtBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
}

/**
 * 量当前姿态的可见包围盒（骨架本地坐标，y 向上）。
 *
 * 调用方应先把骨架摆到 idle 首帧；这里只负责把槽位上可见的区域/mesh 顶点取出来。
 * 区域附件按 `(bone, out, offset, stride)` 取四角；mesh 附件按
 * `(slot, start, count, out, offset, stride)` 取顶点。空槽、全透明槽、裁剪/路径附件跳过。
 * 没有可用顶点时返回 `null`，调用方自行退回 canvas 口径。
 */
export function measureSpineArtBounds(skeleton: ISpineArtSkeleton): ISpineArtBounds | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const slot of skeleton.slots) {
        if (slot.color && slot.color.a <= 0.05) continue;
        const attachment = slot.getAttachment();
        if (!attachment) continue;
        if (attachment.endSlot !== undefined || attachment.lengths !== undefined) continue;
        const meshLength = attachment.worldVerticesLength;
        let vertices: Float32Array | null = null;

        if (typeof meshLength === 'number' && meshLength > 0 && meshLength % 2 === 0) {
            vertices = new Float32Array(meshLength);
            attachment.computeWorldVertices(slot, 0, meshLength, vertices, 0, 2);
        } else if ((attachment.width ?? 0) > 0 && (attachment.height ?? 0) > 0) {
            vertices = new Float32Array(8);
            attachment.computeWorldVertices(slot.bone, vertices, 0, 2);
        }

        if (!vertices) continue;
        for (let i = 0; i + 1 < vertices.length; i += 2) {
            const x = vertices[i], y = vertices[i + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    const width = maxX - minX, height = maxY - minY;
    if (!(width > 0) || !(height > 0)) return null;
    return { minX, minY, maxX, maxY, width, height };
}
