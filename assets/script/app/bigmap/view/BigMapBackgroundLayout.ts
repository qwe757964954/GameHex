export interface IBigMapBackgroundLayout {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** 整纹理边界固定在世界坐标中，扩缩覆盖范围时不会改变平铺相位。 */
export function bigMapBackgroundLayout(
    viewportWidth: number, viewportHeight: number, zoom: number,
    cameraX: number, cameraY: number, tileWidth: number, tileHeight: number,
): IBigMapBackgroundLayout {
    if (![viewportWidth, viewportHeight, zoom, tileWidth, tileHeight]
        .every((value) => Number.isFinite(value) && value > 0)
        || !Number.isFinite(cameraX) || !Number.isFinite(cameraY)) {
        throw new Error('[BigMap] 背景尺寸与缩放必须为正有限数，相机坐标必须有限');
    }
    const left = Math.floor((-viewportWidth / 2 - cameraX) / zoom / tileWidth) * tileWidth;
    const right = Math.ceil((viewportWidth / 2 - cameraX) / zoom / tileWidth) * tileWidth;
    const bottom = Math.floor((-viewportHeight / 2 - cameraY) / zoom / tileHeight) * tileHeight;
    const top = Math.ceil((viewportHeight / 2 - cameraY) / zoom / tileHeight) * tileHeight;
    return { x: (left + right) / 2, y: (bottom + top) / 2, width: right - left, height: top - bottom };
}
