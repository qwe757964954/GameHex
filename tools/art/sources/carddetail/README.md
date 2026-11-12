# 卡牌详情 / 技能弹窗美术源档（已退役）

`skin.png`（887×1774 详情页无字底稿）、`forest.png`（场景插画）、
`skill-popup-source.png`（旧技能弹窗底稿）仅作美术存档，**不再导出**。
旧版详情页的 34 张顶层切图、旧技能弹窗的 15 张切图、`slices.json` 清单与生成器
`tools/art/slice_card_detail.py` 均已删除；`CardSkillRow.prefab` 也已移除。

## 当前运行时资源

- `assets/bundles/main-pages/image/carddetail/upgrade/` —— 详情页蓝湖切图（`CardUpgrade.prefab`）。
- 同级 `skill/` —— 单技能弹窗切图（`CardSkill.prefab`）。
- 同级 `identity/` —— 职业 / 品级图标，由 `PVP-卡牌美术.xlsx` 的 `cardUiArt*` 表按路径引用；
  `diamond.*` 对应 `icon_quality_{legendary,epic,rare,uncommon}`（金 / 紫 / 蓝 / 绿）。
- 顶层不再放任何 `.png`，全部资源复用父目录 `auto-atlas.pac`，子目录不另建图集。
- 新增 / 删除资源必须通过 Cocos MCP 在编辑器里操作，让引擎生成 meta 并刷新图集；禁止手写 meta UUID。

## 界面组合

`CardUpgrade.prefab` / `CardSkill.prefab` 必须通过 Cocos MCP 编辑、保存、退出并验证。
旧 `build_card_detail_prefab.py` 已移除，不能用直接写 JSON 的历史生成器重建，
以免覆盖 Inspector 引用或重新引入复合切图。

`Header` / `PowerBar` 的旧底板 Sprite 保留组件、但 `_enabled=false` 且 `spriteFrame=null`；
容器与子节点不可删（`CardUpgradePage.ts` 的 `@property` 指向 `Header/...`）。
技能页 Dim 必须先于内容绘制，标题 / 等级标牌必须先于文字绘制；
保存后核对实际 children 顺序，当前 MCP move 的 siblingIndex 参数未被应用。
头像 RAW 缩放使用 SpriteFrame.originalSize，不能用合图纹理的 width/height。

## 验证

`npx tsx --test tests/card-detail-art.test.ts tests/card-detail-layout.test.ts
tests/card-lineup-ui-regression.test.ts tests/card-runtime-regression.test.ts
tests/auto-atlas-capacity.test.ts`
