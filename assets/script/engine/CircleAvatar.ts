import {
    _decorator, assetManager, Component, DynamicAtlasManager, EffectAsset, isValid,
    Material, resources, Sprite, UITransform, Vec4, warn,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';

const { ccclass, property, executeInEditMode, requireComponent, disallowMultiple, menu } = _decorator;

// 与 circle-avatar.effect.meta 一起保留；编辑模式没有 resources bundle 路径索引。
const AVATAR_EFFECT_UUID = 'b458043a-8c60-48ac-8883-89ba4d18e351';

/** 挂在头像 Sprite 上，自动加载圆形 Shader；支持编辑器预览和旋转图集。 */
@ccclass('CircleAvatar')
@executeInEditMode
@requireComponent(Sprite)
@disallowMultiple
@menu('UI/CircleAvatar')
export class CircleAvatar extends Component {
    @property({ range: [0, 0.5, 0.01], slide: true, tooltip: '圆半径占节点短边的比例，0.5 为内切圆。' })
    radius = 0.5;

    @property({ min: 0, tooltip: '圆边缘向内柔化的宽度，单位为 UI 像素。' })
    feather = 1;

    @property({ tooltip: '保持图片比例，居中裁切填满节点；关闭后随节点拉伸。' })
    cover = true;

    private sprite: Sprite | null = null;
    private avatarMaterial: Material | null = null;
    private previousMaterial: Material | null = null;
    private previousType = Sprite.Type.SIMPLE;
    private previousTrim = true;
    private loading = false;
    private readonly uvOrigin = new Vec4();
    private readonly uvAxes = new Vec4();
    private readonly avatarSize = new Vec4();
    private readonly circleParams = new Vec4();
    private readonly cachedValues: number[] = [];

    protected onEnable(): void {
        this.sprite = this.getComponent(Sprite);
        if (!this.sprite) return;
        this.previousMaterial = this.sprite.customMaterial;
        this.previousType = this.sprite.type;
        this.previousTrim = this.sprite.trim;
        this.sprite.type = Sprite.Type.SIMPLE;
        this.sprite.trim = true;
        this.loadMaterial();
    }

    protected lateUpdate(): void {
        this.refresh();
    }

    protected onDisable(): void {
        const sprite = this.sprite;
        if (isValid(sprite)) {
            if (sprite.customMaterial === this.avatarMaterial) {
                sprite.customMaterial = this.previousMaterial;
            }
            sprite.type = this.previousType;
            sprite.trim = this.previousTrim;
        }
        this.avatarMaterial?.destroy();
        this.avatarMaterial = null;
        this.cachedValues.length = 0;
    }

    private loadMaterial(): void {
        if (this.loading) return;
        this.loading = true;
        const onLoaded = (error: Error | null, effect: EffectAsset): void => {
            this.loading = false;
            const sprite = this.sprite;
            if (!isValid(this, true) || !this.enabledInHierarchy || !isValid(sprite, true)) return;
            if (error) {
                warn('[CircleAvatar] 无法加载 shaders/circle-avatar.effect', error);
                return;
            }
            const material = new Material();
            material.initialize({ effectAsset: effect });
            this.avatarMaterial = material;
            sprite.customMaterial = material;
            this.refresh();
        };
        if (EDITOR_NOT_IN_PREVIEW) {
            assetManager.loadAny<EffectAsset>(AVATAR_EFFECT_UUID, onLoaded);
        } else {
            resources.load('shaders/circle-avatar', EffectAsset, onLoaded);
        }
    }

    /** 更换 SpriteFrame 或尺寸后会自动刷新，也可在同帧主动调用。 */
    public refresh(): void {
        const sprite = this.sprite;
        const material = this.avatarMaterial;
        const frame = sprite?.spriteFrame;
        const transform = this.getComponent(UITransform);
        if (!sprite || !material || !frame || !transform) return;

        // 提前执行引擎同样的合图操作，再读取最终 UV，避免首次入图集时错位。
        DynamicAtlasManager.instance.packToDynamicAtlas(sprite, frame);
        const uv = frame.uv;
        const rect = frame.rect;
        const values = [
            uv[0], uv[1], uv[2] - uv[0], uv[3] - uv[1],
            uv[4] - uv[0], uv[5] - uv[1],
            Math.abs(transform.width), Math.abs(transform.height), rect.width, rect.height,
            Math.max(0, Math.min(0.5, this.radius)), Math.max(0, this.feather), this.cover ? 1 : 0,
        ];
        if (values.every((value, index) => value === this.cachedValues[index])) return;
        this.cachedValues.splice(0, this.cachedValues.length, ...values);
        this.uvOrigin.set(values[0], values[1], 0, 0);
        this.uvAxes.set(values[2], values[3], values[4], values[5]);
        this.avatarSize.set(values[6], values[7], values[8], values[9]);
        this.circleParams.set(values[10], values[11], values[12], 0);
        material.setProperty('uvOrigin', this.uvOrigin);
        material.setProperty('uvAxes', this.uvAxes);
        material.setProperty('avatarSize', this.avatarSize);
        material.setProperty('circleParams', this.circleParams);
    }
}
