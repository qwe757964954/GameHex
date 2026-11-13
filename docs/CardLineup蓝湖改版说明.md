# CardLineup 蓝湖改版说明

- 设计基准：蓝湖「卡牌阵容-新」`image_id=255ed6a4-160d-478e-9cad-fdac5f8df4a1`（pid `36a56744-56d2-4ae3-8952-870725ae4055`，snapshot `053d68c820bb5f2bf46cab42559e0d7c`），画布 720×1610，sliceScale=2。
- 品质框基准：蓝湖「品质框」`image_id=c15fdc2c-6b8d-4bd9-b7a1-4436f856a146`，画布 771×500。
- 切图来源：`C:\Users\hedao\Downloads\卡牌阵容-新_slices\mipmap-xhdpi`、`C:\Users\hedao\Downloads\品质框_slices\mipmap-xhdpi`。
- 运行时口径：设计 720×1610 映射到工程 720×1280；顶部钉顶、`CardGrid` 拉伸、`TabBar` 钉底（见文末待确认项）。

## 1. 改动摘要

| 文件 | 改动 |
| --- | --- |
| `assets/bundles/main-pages/ui/card/CardLineup.prefab` | 按新版式重写：背景两层、顶栏（品质星/品质加成/战力条）、`TeamArea` 两排 4 站台、`MidBar`（统计条 + 队伍编辑）、`Banner`、`CardGrid`、`TabBar`。新增 `PowerIcon` 子节点；`QualityLabel`/`PowerLabel` 改字号与位置。 |
| `assets/bundles/main-pages/ui/card/LineupSlot.prefab` | 站台 151×204：`Stage` 151×63、`Disc` 117×31、`Hero` 256×256 scale 0.65、`Meta` 下 `ClassBadge` 36×36 + `LevelLabel`（22px）。 |
| `assets/bundles/main-pages/ui/card/CardLineupCard.prefab` | 卡条目 169×230：`Face` 160×223、`HeroShadow`、`Hero` scale 0.57、`ClassBadge` 40×40、`OnField`、`LevelPlate`、`Progress`、`UpgradeArrow`、`LockVeil`、`Lock`。 |
| `assets/bundles/main-pages/ui/card/CardLineupBond.prefab` | 羁绊条目 40×40：`Icon` 40×40 + `CountLabel`（20px，右伸）。 |
| `assets/script/app/card/CardArtProvider.ts` | 新增阵容页固定图映射：站台光效按职业、职业角标、统计条职业/阵营图标、卡面品质框；`loadLineupSlot` / `loadLineupCard` / `loadTallyFrames` 切新图。布阵页 `loadBoardSlot` / `loadBoardCard` 未改。 |
| `assets/script/app/card/CardLineupCard.ts` | 新增 `lockVeil` / `upgradeArrow` 绑定；未解锁改为 `yx_mask` 遮罩显隐 + 锁标，不再用 `Sprite.color` 乘算压暗；碎片够且未满级显示可升级箭头。 |
| `assets/script/app/card/CardLineupTexts.ts` | `onField` 文案「已出战！」→「出战中」。 |
| `assets/bundles/main-pages/image/card/common_img_kp_01..04.png` | 用品质框 `yx_kp_01..04` 覆盖（160×223），UUID 不变，卡面绑定不变。 |
| `assets/bundles/main-pages/image/card_lineup/` | 新增 27 张阵容页切图 + `auto-atlas.pac(.meta)`（1024×2048），集中承载本页新图。 |
| `assets/bundles/main-pages/icons/card/` | 新增 12 张图标：`yx_zhiye_zs/fs/ss/tk`、`common_img_zs/fs/ss/tk/hg/js/mg/pz`。 |
| `assets/script/core/asset/BundleCatalog.ts` | `main-pages` 分包目录登记新增 `image/card_lineup`，否则 `bundleForPath` 会把它当首包 `resources`，运行时 `Bundle resources doesn't contain ...`。 |
| 测试 | `card-lineup-ui-regression` / `card-head-view` / `card-lineup-loading` / `card-lineup` / `card-art-dedup` / `bundle-scope` 同步新版式与取图断言。 |

未改：`CardLineupPage.ts` 的分页、排序、上阵/下阵、碎片进度、数据绑定与交互；`CardLineupSlot.ts`、`CardLineupBond.ts`；布阵页 prefab 与取图。

## 2. 资源映射

> `image/card_lineup` 已登记到 `main-pages` 分包的 `BUNDLE_DIRECTORIES`；否则 `bundleForPath` 会把它当首包 `resources`，运行时取图报 `Bundle resources doesn't contain ...`。

### 2.1 页面/通用切图（`image/card_lineup`）

| 设计切图 | 工程资源 | SpriteFrame UUID | 使用节点 |
| --- | --- | --- | --- |
| `yx_bg.png` 720×1293 | `image/card_lineup/yx_bg.png` | `76606e63-132d-41af-a115-97ffe9068b57@f9941` | `CardLineup/Bg01` |
| `yx_bg_02.png` 720×886 | `image/card_lineup/yx_bg_02.png` | `571866e5-f29d-43c0-9e71-3829b07e271d@f9941` | `CardLineup/Bg02` |
| `yx_icon_pzjc.png` 79×78 | 同名 | `8b222d59-897d-441f-9593-35f58a772958@f9941` | `TopBar/QualityLabel` 左侧 `Star` |
| `xxk_di.png` 228×39 | 同名 | `677262f3-275a-4a96-9f37-5b458ca72ca0@f9941` | `TopBar/Ribbon` |
| `icon_zhanli.png` 38×38 | 同名 | `4ec5f13c-2bce-4518-9a32-c97f3e899c59@f9941` | `TopBar/Ribbon/PowerIcon` |
| `yx_title_01.png` 576×52 | 同名 | `d32df1fa-0602-452b-9d5c-53db4936ff51@f9941` | `Banner/BannerBar` |
| `btn_03.png` 166×68 | 同名 | `6e638c5d-0796-466c-8d33-2c4d8dee37dd@f9941` | `MidBar/TeamEdit` |
| `btn_04.png` 249×65 | 同名 | `23df428a-093b-4a1f-bede-e0273ecfb573@f9941` | `TabBar/Highlight` |
| `yx_img_heidi.png` 495×60 | 同名 | `c4390204-6c7d-42da-9762-d6e5d1c6340e@f9941` | `TabBar/TabStrip` |
| `icon_lock.png` 29×40 | 同名 | `2d2f47c1-e82c-4725-b864-06b1b57171f2@f9941` | `CardLineupCard/Lock` |
| `icon_lock_02.png` 28×36 | 同名 | `19427a86-38ac-4153-81e6-dee5c4d7bc59@f9941` | `TabBar/Lock` |
| `yx_img_taizi.png` 151×63 | 同名 | `5729b272-2fb2-490b-8721-51593fde7dbe@f9941` | `LineupSlot/Stage` |
| `yx_img_guang_01..04.png` 117×31 | 同名 | `bc1fe86e…` / `e4a93a8a…` / `4a20aadb…` / `7d841fd0…` | `LineupSlot/Disc`（按职业取图） |
| `yx_img_yinying.png` 107×17 | 同名 | `855b2400-6030-441e-996e-c5b3c0783627@f9941` | `CardLineupCard/HeroShadow` |
| `yx_mask.png` 167×227 | 同名 | `10ed9e5f-3f88-4185-8549-86afd8f06e74@f9941` | `CardLineupCard/LockVeil` |
| `progress_bg.png` 156×28 | 同名 | `c98d0898-17ed-4221-af30-20160deb8b02@f9941` | `CardLineupCard/Progress` |
| `progress_01.png` 144×16 | 同名 | `18cb47d4-1896-4dc2-9aba-0bc9fabc32a0@f9941` | `Progress/ProgressBar/Fill` |
| `common_dengjidi.png` 36×39 | 同名 | `6b410c84-bd53-42d9-99e5-0bddc6d0ef75@f9941` | `LevelPlate` |
| `common_label_01.png` 74×26 | 同名 | `ded508ed-2aaa-4c6d-9ebe-1e7355e1e36c@f9941` | `OnField` |
| `common_jiantou.png` 30×32 | 同名 | `de09ec1f-9f66-48d4-be88-97b7acd958fe@f9941` | `UpgradeArrow` |
| `common_img_pzk_01..04.png` 113×113 | 同名 | `048299e2…` / `761ec3c1…` / `5015c644…` / `cccc0fe8…` | 本页未引用，备用（见待确认 2） |

> 光效颜色实测：01 金（战士）、02 蓝（射手）、03 绿（坦克）、04 紫（法师）。

### 2.2 职业/阵营图标（`icons/card`）

| 资源 | 尺寸 | UUID | 用途 |
| --- | --- | --- | --- |
| `yx_zhiye_zs` | 40×40 | `f9dff47d-dd02-48ce-ba07-101611f8ebea@f9941` | 战士角标（站台 36×36、卡 40×40） |
| `yx_zhiye_fs` | 40×40 | `6a19c823-20b5-4172-9d9c-4cf3c52bd6c5@f9941` | 法师角标 |
| `yx_zhiye_ss` | 40×40 | `604b0832-9c5b-419a-a7ae-f842c4fb27f2@f9941` | 射手角标 |
| `yx_zhiye_tk` | 40×40 | `e5f2d370-1fab-410b-86a3-da7e05947447@f9941` | 坦克角标 |
| `common_img_zs` | 34×38 | `f4bbbf63-f6ee-451b-97cf-47f941638923@f9941` | 统计条·战士 |
| `common_img_fs` | 34×36 | `6538c414-9e8b-4652-b1d4-28e6becea8f7@f9941` | 统计条·法师 |
| `common_img_ss` | 39×38 | `d288d8b2-8901-43c3-9de9-40d8993368dd@f9941` | 统计条·射手 |
| `common_img_tk` | 38×39 | `dd8d3b15-d94a-48af-9eb7-fa501244023c@f9941` | 统计条·坦克 |
| `common_img_hg` | 33×39 | `afc45152-e7c8-4962-88a1-576c88f7de3f@f9941` | 统计条·花果 |
| `common_img_js` | 35×39 | `0b204021-20ba-40e2-9f5a-fc1a45a1f2d3@f9941` | 统计条·僵尸 |
| `common_img_mg` | 38×39 | `d3dd45aa-f0ea-4619-82f7-8fbf3ab36d72@f9941` | 统计条·蘑菇 |
| `common_img_pz` | 30×37 | `2be7c9bc-bc6d-43ac-9870-638da1c3f23c@f9941` | 统计条·盆栽 |

### 2.3 品质框（覆盖 `image/card/common_img_kp_01..04`）

| 设计切图 | 工程资源 | 尺寸 | UUID |
| --- | --- | --- | --- |
| `yx_kp_01.png`（金） | `image/card/common_img_kp_01.png` | 160×223 | `a21c4c86-e7b0-4be6-870b-8068514c50c2@f9941` |
| `yx_kp_02.png`（紫） | `image/card/common_img_kp_02.png` | 160×223 | `b9e1b79c-522c-4d63-a4ff-23768f493fd8@f9941` |
| `yx_kp_03.png`（绿） | `image/card/common_img_kp_03.png` | 160×223 | `f3f76a72-66c7-4c0b-ac63-d86ed0a8b6cd@f9941` |
| `yx_kp_04.png`（蓝） | `image/card/common_img_kp_04.png` | 160×223 | `6df5494b-fbac-4ab3-9dcc-6039302dbe63@f9941` |

覆盖后 UUID 不变，因此 `CardLineupCard/Face` 的静态引用、`cardUiArtRarity` 的 `face.gold/purple/green/blue` 路径都无需改动。

## 3. 版式对照（设计值 → prefab 值）

### 3.1 CardLineup（720×1280）

| 节点 | 设计 bounds（720×1610） | prefab |
| --- | --- | --- |
| `Bg01` | 0,0 720×1293 | 720×1293，`Widget.top=0` |
| `Bg02` | 0,634 720×886 | 720×886，`Widget.top=634` |
| `TopBar` | 0,0 720×170 | 720×170，`Widget.top=0` |
| `Star` | 28,71 79×78 | 79×78 @ (-292.5,-25) |
| `QualityLabel` | 26,141 82×21 | 82×21，font 20 @ (-293,-66.5) |
| `Ribbon` | 246,110 228×39 | 228×39 @ (0,-44.5) |
| `PowerIcon` | 280,110 38×38 | 38×38 @ (-61,0.5) |
| `PowerLabel` | 339,120 91×21 | 91×21，font 24 @ (24.5,-1) |
| `TeamArea` | 0,197 720×413（两行 204 + 行距 5） | 720×413，`Widget.top=197` |
| `Layout` | 4 列：x=22/197/371/545，cell 151×204，水平间距 23.5、垂直 5 | `cell=151×204`，`spacingX=23.5`，`spacingY=5`，`gridCount=4` |
| `MidBar` | 0,643 720×68 | 720×68，`Widget.top=643` |
| `BondList` | 20,656 512×68 | 512×68，锚点 (0,0.5) @ (-340,0)，content 512×40 |
| `TeamEdit` | 540,643 166×68 | 166×68 @ (263,0) |
| `Banner` | 72,732 576×52 | 576×52，`Widget.top=732` |
| `Title` | 211,745 158×25 | 158×25，font 24 @ (-70,0.5)；文案「暴击伤害加成：」 |
| `Value` | 396,744 81×29 | 81×29，font 32 @ (76.5,-0.5) |

> 加成条两个 Label 均为单行：`BondTitleLabel` 158×25、`BondValueLabel` 81×29，`enableWrapText=false` + `overflow=SHRINK`。动态羁绊名/百分比过长时自动缩放，避免在窄框内换行裁切。
| `CardGrid` | 14,790 688×586 | 688×586，`Widget.top=790`，`bottom=234` |
| `CardGrid` 内容 | cell 169×230，4 列，列间距 4，行间距 6，顶部留白 10 | `gridCount=4`，`gridSpacing=4`，`spacing=6`，`headerSpacing=10`，content 688×920 |
| `TabBar` | 110,1379 495×65 | 495×65，`Widget.bottom=166` @ (-2.5,-441.5) |
| `TabStrip` | 110,1380 495×60 | 495×60 @ (0,0.5) |
| `Highlight` | 111,1379 249×65 | 249×65 @ (-123,0) |
| `Label1/Label2` | 208/454,1397 52/54×27 | 100×40，font 26 @ (-123,0.5)/(123.5,0.5) |
| `Lock` | 580,1386 28×36 | 28×36 @ (235.5,7.5) |

### 3.2 LineupSlot（151×204）

| 节点 | 设计 bounds | prefab |
| --- | --- | --- |
| `Stage` | 22,338 151×63 | 151×63 @ (0,-70.5) |
| `Disc` | 41,344 117×31 | 117×31 @ (2,-59.5) |
| `Hero` | — | 256×256，scale 0.65，锚点 (0.5,0)，@ (0,-70.5) |
| `Meta` | — | 151×40 @ (0,-89)，Layout 关闭 |
| `ClassBadge` | 48,370 36×36 | 36×36 @ (-31.5,0) |
| `LevelLabel` | 88,377 34×23 | 70×30，font 22 @ (14.5,-1.5) |

### 3.3 CardLineupCard（169×230）

| 节点 | 设计 bounds（相对卡格） | prefab |
| --- | --- | --- |
| `Face` | +7,+5 160×223 | 160×223 @ (2.5,-1.5) |
| `HeroShadow` | +35,+163 107×17 | 107×17 @ (4,-56.5) |
| `Hero` | — | 256×256，scale 0.57 @ (0,6.5) |
| `ClassBadge` | +0,+0 40×40 | 40×40 @ (-64.5,95) |
| `OnField` | +5,+159 74×26 | 74×26 @ (-42.5,-57)，font 20「出战中」 |
| `LevelPlate` | +12,+186 36×39 | 36×39 @ (-54.5,-90.5)；`LevelLabel` 30×30，font 18 |
| `Progress` | +9,+191 156×28 | 156×28 @ (2.5,-90) |
| `ProgressBar/Fill` | +15,+197 144×16 | 144×16，`totalLength=144`，锚点 (0,0.5) @ (-69.5,-90) |
| `CardFragmentCountLabel` | +78,+197 41×17 | 60×22，font 16 @ (14,-90.5) |
| `UpgradeArrow` | +137,+187 30×32 | 30×32 @ (67.5,-88)，默认隐藏 |
| `LockVeil` | +0,+0 167×227 | 167×227 @ (-1,1.5)，默认隐藏 |
| `Lock` | +143,+0 29×40 | 29×40 @ (73,98)，默认隐藏 |

### 3.4 CardLineupBond（40×40）

| 节点 | 设计 bounds | prefab |
| --- | --- | --- |
| `Icon` | +20,+0 40×40 | 40×40 |
| `CountLabel` | +40,+0 23×20 | 44×30，font 20 @ (31.5,-8) |

## 4. 状态差异

| 状态 | 表现 |
| --- | --- |
| 已解锁 | `LockVeil` 与 `Lock` 隐藏；`Face`/`Hero`/`Badge` 保持原色（`COLOR_NORMAL`）。 |
| 未解锁 | `LockVeil`（`yx_mask`）与右上角 `Lock`（`icon_lock`）显示；锁标排在遮罩之后，保持白色描边，不再被遮罩压灰。 |
| 出战中 | `OnField`（`common_label_01`）显示，文案「出战中」。 |
| 碎片进度 | `ProgressBar.progress = owned/need`；`CardFragmentCountLabel = owned/need`。 |
| 已满级 | 进度条 1，文案「已满级」，不显示可升级箭头。 |
| 可升级 | 已解锁、未满级、`need > 0` 且 `owned >= need` 时显示 `UpgradeArrow`（`common_jiantou`）。 |

## 5. 验证

- 编辑器 `prefab_prefab_browse validate`：`CardLineup` / `LineupSlot` / `CardLineupCard` / `CardLineupBond` 均 `isValid=true`、`issues=[]`。
- 聚焦回归：`npx tsx --test tests/card-lineup-ui-regression.test.ts tests/card-head-view.test.ts tests/card-lineup-loading.test.ts tests/card-lineup.test.ts tests/card-art-config.test.ts tests/card-art-dedup.test.ts tests/art-paths.test.ts` → 87/87 通过，exit 0。
- `tests/bundle-scope.test.ts` 当前 2/3：新增未跟踪的 `image/guide`、`ui/Guide` 未被 `BUNDLE_DIRECTORIES` 命中，属工作区 Guide 模块改动，与 CardLineup 无关。
- 运行时取图：`[ArtIcons] ... Bundle resources doesn't contain image/card_lineup/...` 的根因是该目录未登记到 `BUNDLE_DIRECTORIES`，已补 `image/card_lineup` 并加 `bundle-scope` 断言。
- 图集护栏：`auto-atlas-topology` / `auto-atlas-capacity` 中与本次新增 `image/card_lineup` 相关的断言通过；容量 1024×2048，单图 720×1293 不超限。
- 仓库 `npm run verify`：`tsc(assets/script)` 0 条；仍有 1 条新增失败，来自既有的战斗投射物目录，与本次 CardLineup 改动无关：
  - `T2 严禁父子目录同时放 pac`：`assets/bundles/battle/units/projectiles/磁电菇_劈雷技能/atlas`（父目录另有 pac）。
  - 同批 `T1` 另报 `assets/bundles/battle/units/projectiles/射手枪口发射子弹` 未被图集覆盖。
  - `profiles/v2/packages/reference-image.json` 是编辑器会话生成的未跟踪文件，不属本次改动。

## 6. 与效果图的差异 / 待确认

1. **画布高度**：设计 720×1610，运行时 720×1280。当前按「顶部钉顶 + `CardGrid` 拉伸 + `TabBar` 钉底」映射；1280 高设备卡库只完整露出约 1 行，设计长屏约 2.5 行。需确认是否接受，或改为整页等比缩放 / 纵向滚动。
2. **`common_img_pzk_01..04`（113×113）**：本页无节点引用，已导入 `image/card_lineup` 备用；是否替换全局品质框 `image/frame/common_img_pzk_*`（会影响首充/挂机/庆典/卡牌揭示/联盟/商店/角色等页面）需确认，本次未替换。
3. **品质框落位**：`yx_kp_01..04` 覆盖到既有 `image/card/common_img_kp_01..04`（UUID 不变）。已核对：`face.*` 仅 `CardArtProvider.loadLineupCard` 使用，静态引用仅 `CardLineupCard.prefab`，因此不会影响其他页面；但这是共享文件名覆盖，需在版本库中知会。
4. **新图集**：`image/card_lineup` 独立 `auto-atlas.pac`（1024×2048）。原因：`yx_bg` 720×1293 超过原 `image/card` 图集的 1024 高度，且原目录已有 `auto-atlas.pac`，子目录再放 pac 会触发父子目录重复打包守卫。总量约 1.80M 像素，预计 2 页。
5. **字号**：按蓝湖文字 bounds 高度换算（品质 20、战力 24、统计条 26、Banner 标题 24/数值 32、卡等级 18、卡进度 16、出战 20、羁绊数字 20）。蓝湖接口未返回字体名称/字重，若美术指定字体需再对齐。
6. **截图比对**：用户运行截图暴露的加成条换行问题已修复（标题 158×25、数值 81×29，单行 SHRINK）；整页截图比对仍未完成，本次以蓝湖节点坐标、prefab 序列化值、单测与 prefab validate 为准。

