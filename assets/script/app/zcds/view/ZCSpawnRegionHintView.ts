import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import type { ZCDepth } from '../model/ZCMapConfig';

const { ccclass, property } = _decorator;

/**
 * 自选主城区域提示气泡（挂在 `SpawnRegionHint.prefab` 根节点）。
 *
 * 尺寸、九宫格、字体排版及各纵深底图帧均在 prefab Inspector 上直接绑定；
 * 运行时只按当前区域纵深与文案刷新显示。
 */
@ccclass('ZCSpawnRegionHintView')
export class ZCSpawnRegionHintView extends Component {
    @property({ type: Sprite })
    backgroundSprite: Sprite = null!;

    @property({ type: Label })
    titleLabel: Label = null!;

    @property({ type: SpriteFrame })
    frontFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame })
    midFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame })
    backFrame: SpriteFrame = null!;

    private appliedDepth: ZCDepth | null = null;
    private appliedText: string | null = null;

    /**
     * 更新气泡纵深底图与文案；仅在状态发生变化时写入组件，避免每帧触发渲染脏标记。
     */
    applyHint(depth: ZCDepth, text: string): void {
        if (this.appliedDepth !== depth) {
            this.backgroundSprite.spriteFrame = this.frameForDepth(depth);
            this.appliedDepth = depth;
        }
        if (this.appliedText !== text) {
            this.titleLabel.string = text;
            this.appliedText = text;
        }
    }

    private frameForDepth(depth: ZCDepth): SpriteFrame {
        if (depth === 'front') return this.frontFrame;
        if (depth === 'mid') return this.midFrame;
        return this.backFrame;
    }
}
