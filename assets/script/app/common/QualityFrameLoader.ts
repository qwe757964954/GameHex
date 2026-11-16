/** 品质框批量加载（4 张固定图）；页面只保留自己的实例缓存。 */
import type { SpriteFrame } from 'cc';
import { loadFrameArt } from '../card/CardLineupIcons';
import { QUALITY_FRAME_NAMES } from './QualityFrameArt';

export async function loadQualityFrameMap(): Promise<Map<string, SpriteFrame>> {
    const frames = new Map<string, SpriteFrame>();
    await Promise.all(QUALITY_FRAME_NAMES.map(async (name) => {
        const frame = await loadFrameArt(name);
        if (frame) frames.set(name, frame);
    }));
    return frames;
}
