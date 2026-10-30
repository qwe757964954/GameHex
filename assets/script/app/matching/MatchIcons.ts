import type { IIconLoader } from '../common/SpriteFrameCache';

export { createIconLoader as createMatchIconLoader } from '../common/SpriteFrameCache';
export type MatchIconLoader = IIconLoader;

export async function preloadMatchIcons(
    names: readonly string[],
    root: string,
    loader: MatchIconLoader,
): Promise<void> {
    await Promise.all(names.map((name) => loader(name, root)));
}
