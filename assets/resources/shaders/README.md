# 圆形头像

适用 Cocos Creator 3.8.8 的 UI Sprite。

1. 创建或选中带有 `Sprite` 的头像节点，设置 `Sprite Frame`。
2. 添加 `CircleAvatar` 组件（脚本位于 `assets/script/engine/CircleAvatar.ts`）。
3. 推荐将 Sprite 的 `Size Mode` 设为 `CUSTOM`，在 UITransform 中设置头像尺寸，例如 100 × 100。
4. 组件自动加载本目录的 `circle-avatar.effect`，无需手动创建或绑定材质。

场景编辑模式通过 Effect UUID 加载，游戏预览和构建通过 `resources` 路径加载。复制组件到其他项目时请同时复制 Effect 的 `.meta` 文件，以保留 UUID；若重新生成了 `.meta`，需同步修改脚本中的 `AVATAR_EFFECT_UUID`。

- `Radius`：半径相对于节点短边的比例，默认 0.5。
- `Feather`：边缘向内柔化宽度，默认 1 UI 像素；0 为硬边。
- `Cover`：默认开启，图片保持比例并居中裁切；关闭时按节点尺寸拉伸。

支持独立图片、静态/旋转图集及动态图集；更换 SpriteFrame、节点尺寸或参数后自动刷新。矩形节点也按短边绘制圆形；节点和父节点请使用等比缩放，非等比缩放会把圆拉成椭圆。透明图片保留原有透明度。组件启用期间使用 SIMPLE 和 Trimmed Mode，禁用时恢复原材质、类型及 Trim 设置。

每个头像拥有独立材质，参数互不影响，但会增加 UI draw call。Shader 只裁切该 Sprite 的显示，不裁切子节点，也不改变节点的矩形点击区域。

Shader 使用引擎自动绑定的 `cc_spriteTexture`，不需要传入头像纹理。直接使用 Effect 时，需要自行设置帧 UV 原点/坐标轴、节点与图片尺寸；推荐通过组件使用。参考：[Cocos 3.8 自定义 UI 材质](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/engine/ui-material.html)。
