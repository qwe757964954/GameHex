# SLG堡垒（13 张）落地：交互建议与优化

> 依据：`zarts/art/植物占领世界美术/场景资源/SLG堡垒` 13 张 PNG **实测**（画布 / alpha 边界 / 逐张判读）
> ＋ 本仓基地渲染链路只读（`BigMapBaseView.fitPlotIcon`、`baseBuilding.json`、`pvpCard.json`）
> ＋ 既有方案 [`bigmap-基地建筑交互改进方案.md`](./bigmap-基地建筑交互改进方案.md) §10（上一批 6 张基地图的落库与尺寸修正）。
> 本文只提建议与判据，**未改任何代码 / 配表 / 资源**。

---

## 0. 结论先行

1. **这 13 张是「基地（bigmap base）」资源，不是对局资源。** 与 `场景资源/基地建筑` 那 6 张**同画布（212×212）、同画风（厚描边手绘等距）、同底座语言**，是同一套的续作；而对局用的是植物系 `barracks-*.png`（树桩/蘑菇屋）。⇒ 落 `assets/resources/image/buildings/`，走 `baseBuildIcon` 的既有口径，不需要动 bundle 登记（铁律 420 绕开）。
2. **它第一价值不是"换风格"，是解掉那条卡住的美术阻塞（P1-11）**：6 座装饰雕像里 4 座共用 `territory_random_resource_v1`，`71017 小玩法入口` 至今**无图**。13 张足够把「同屏多座长一样 / 干脆空白」一次填平。
3. **但不要拿它替换粮食 / 木材 / 铁矿 / 货币田。** 田是**平面地块**（栅栏 + 作物），这批是**立体堡垒**；玩家扫读基地靠的正是「平 = 产资源、立 = 功能」这条隐含读法，替换会把它打散。田的重复问题只能靠「出田的变体」或客户端去同质化。
4. **直接上图会有 3 个可量化的错位**：基线差 15px、体量差 22%、96px 显示时描边糊成一团。前两个必须在资源侧归一（代码侧归一会有 21% 的体量被透明留白吃掉）。
5. **顺带查到一个对局既有 bug**：`pvpCard` 2002（主城）的 `buildIcon='mine'`，而 2001（金矿）`buildIcon` 为空 ⇒ **主城与金矿显示同一张 `mine.png`**，进游戏后玩家分不清要死守的主城。与这批资源无关，但同属"建筑外观"，一并列出（§4.6）。

---

## 1. 资源盘点（实测）

13 张全部 **212×212 RGBA**，透明底；下表 bbox 为 alpha 实际边界（`Image.getbbox()`）。

| 文件 | alpha bbox（x0,y0,x1,y1） | 内容宽×高 | 内容判读 | 建议用途 |
| --- | --- | --- | --- | --- |
| SLG 1 | 20,3,193,179 | 173×176 | 熔炉/冶炼炉：熔岩基岩 + 铁架 + 冒烟烟囱 | 铁矿类（升级态）/ 71017 备选 |
| SLG 2 | 24,8,190,174 | 166×166 | 雷达站/瞭望：绿色雷达碟 + 天线 + 沙包 + 木栅 | 侦察类 / 装饰 |
| SLG 3 | 22,9,192,173 | 170×164 | 军械库：军绿 + 黄黑警示条 + 弹药木箱 | 仓库 / 兵营类 |
| SLG 4 | 29,4,185,178 | 156×174 | 太阳神殿：金色太阳徽记 + 圆台 + 旗 + 木桶 | **71001 主城**（最华丽、中心对称、有旗=权威） |
| SLG 5 | 20,11,194,171 | 174×160 | 黏液巢穴：绿黏液 + 骨 + 紫管 + 齿状开口 | **71017 小玩法入口**（画风最异质=入口/传送） |
| SLG 6 | 28,13,186,168 | 158×155 | 车库/车间：灰金属棚 + 卷帘门 + 树 + 铁栅 | 仓库 / 装饰 |
| SLG 7 | 27,21,191,165 | 164×144 | 地堡：黄黑警示 + 铁丝网 + 沙袋 + 铁门 | 装饰（防御气质） |
| SLG 8 | 27,20,191,167 | 164×147 | 紫环塔：紫色环形穹顶 + 黄柱石阶 | 装饰（能量/议会气质） |
| SLG 9 | 32,17,187,169 | 155×152 | 齿轮厂：红色齿轮 + 警示条 + 尖刺石台 | 装饰（工厂） |
| SLG 10 | 26,14,193,172 | 167×158 | 蓝晶塔：蓝色发光穹顶 + 橙色装甲板 | **71016 研究院**（与现有 `base_main` 同族，科技感最强） |
| SLG 11 | 30,23,188,164 | 158×141 | 冰霜塔：雪花徽记 + 冰蓝 + 白冰层 | 装饰（克制/减速气质） |
| SLG 12 | 26,13,193,173 | 167×160 | 巨炮台：巨型炮管 + 红黑 + 熔岩 + 金门 | 装饰 / 防御类 |
| SLG 13 | 24,15,194,172 | 170×157 | 机械要塞：大齿轮 + 警示门 + 尖刺 | 主城备选 / 要塞类 |

**统一性实测**：

| 指标 | 实测范围 | 画布基准 | 偏差 | 后果（96px 显示时） |
| --- | --- | --- | --- | --- |
| 底边 y | 164 ~ 179 | — | **15px（7.1%）** | 建筑上下浮 **±3.4px**，看起来「有的悬空、有的陷进地里」 |
| 内容高 | 141 ~ 176 | 212 | **22%** | 地堡明显矮于熔炉（语义合理），但**未受控**，靠运气 |
| 内容宽 | 155 ~ 174 | 212 | 11% | 可接受 |
| 水平中心 | 106.5 ~ 109.5 | 106 | **+3px 右偏** | 96px 下偏 1.4px，可忽略，但顺手统一更好 |
| 内容占画布 | 高 66.5% ~ 83.0% | — | 16.5pt | 透明留白比例不一致 ⇒ 代码侧按画布归一必然吃体量 |

---

## 2. 为什么判「基地」而不是「对局」

| 依据 | 事实 |
| --- | --- |
| 规格 | 与 `场景资源/基地建筑` 的 6 张**逐项一致**：212×212 RGBA、透明底、厚描边、等距俯视 |
| 画风 | 同属「金属/军事 + 厚描边 + 自带彩绘底座」；对局建筑是植物系（树桩/蘑菇屋），底座只有一枚灰软阴影椭圆 |
| 表结构 | `baseBuilding.json` 全 23 行 `baseBuildSize = 1`（一格一建筑），`baseBuildIcon` 口径就是 `image/buildings/*`；对局侧 `pvpCard.buildIcon` 走 `barracks-*` |
| 缺口 | 基地侧正好缺 7 个外观位：`71017` 无图、6 座装饰共用 1 张 |

⇒ 若将来要让它进对局，必须整批替换植物系外观并同步 35 张卡的 `buildIcon`，是另一个立项，不在本次范围。

---

## 3. 规格：三条必须先定的规范

### 3.1 出图规范（给美术，一次说清）

| 项 | 规范 | 理由 |
| --- | --- | --- |
| 画布 | 212×212，透明底 | 与既有 6 张、`fitPlotIcon` 口径一致 |
| **落地基线** | 内容底边统一 **y = 178 ± 2** | 现在 164~179，差 15px；引擎按"底边贴格"摆，不定基线就永远在浮 |
| **内容高度** | 占画布 **78% ~ 84%**（165~178px） | 现在 66.5%~83%，跨 16.5pt。低于 78% 的（SLG 7/11）要重排或明确"它就是矮建筑"并登记 |
| 水平中心 | 106 ± 1 | 现在 106.5~109.5，批次性右偏 3px |
| 描边 | **外扩 ≥ 2px**，不要贴 alpha 边 | 进 auto-atlas 后相邻图只隔 2px，贴边会被邻图的深棕描边渗色 |
| 命名 | `base_<kind>_v<n>.png`，纯 ASCII、无空格 | `SLG 1.png` 带空格+大写，会成为 atlas key 与表里的字段值，热更/表配置都容易出错 |

### 3.2 引擎侧两个必须配套的点

**（1）`frame.rect` 不用管，真正会漂的是 `offset`（原判断已实测推翻）**

~~`fitPlotIcon` 按 `frame.rect` 撑 `tileHeight = 96`，这批图内容只占画布 66%~83% ⇒ 新图会小 17%~34%。~~

**实测不成立。** `image/buildings/*.png.meta` 的 `trimType` 是 `auto`（见 `barracks-default.png.meta`：
`width:114 / height:120 / rawWidth:343`）⇒ 引擎导入时就把 `rect` 裁到 alpha 内容，代码拿到的
`frame.rect` 已经是内容尺寸，**留白不会进尺寸计算**。

真正会漂的是 **`offset`**：`BigMapWorldMarker.render` 的位置是
`iconY = height/2 - FOOT_LIFT(16)` **再减 `offset.y × scale`**。`offset` 记录的是「内容中心相对画布中心」的偏移，
减一次等于把内容**反向**推回去 —— 内容偏上多少，整座建筑就往下沉多少。

实测：`barracks-default` 内容偏上 36.5px、scale 2.06 ⇒ 底边被推到 `-91`，而设计值是 `-16`（名条顶边）
⇒ **旧据点在格子上沉了 75px，与名条错开一整截**。

⇒ 出图口径定为「**内容在画布正中**」（`offset ≈ 0`），底边才会恒等于 `-16`，且**与内容高无关**
（`iconY` 已含 `height/2`，高度差被它吸收）。这一条比「统一底边」重要：「统一底边」在 trim+offset 机制下
反而让落点随内容高变（`h` 差 35px ⇒ 落点差 49px）。

**（2）`sizeMode / trim` 每张都要设**

`Sprite.sizeMode = CUSTOM` + `trim = false` 是 `fitPlotIcon` / `render` 的前提（否则设 `spriteFrame` 时引擎按 RAW 把 `contentSize` 改成原图尺寸，位置与尺寸一起漂）。现在只在函数内部设，若哪条新路径（缩略图、ghost、建造目录）复用了 Sprite 而没走这个函数，就会静默漂一次。

---

## 4. 现状差距（代码事实，不是主观感受）

| # | 项 | 代码事实 | 影响 |
| --- | --- | --- | --- |
| 4.1 | 尺寸按画布归一 | `fitPlotIcon` 用 `frame.rect.height` 撑 96 | 新图留白 17%~34%，视觉体量被动缩水 |
| 4.2 | 名字牌定位 | `y = iconHeight/2 + height*0.16`（`iconHeight` 是**设定值** 96，不是内容顶） | 新堡垒顶部有烟囱/雷达/炮管 → 名牌**压在本体上**。田的顶部是空的，所以旧图不出问题 |
| 4.3 | 状态文字 / 收取图标 | 同样按 `iconHeight/2 + 0.08h / 0.3h` | 同上，会盖住炮管与雷达 |
| 4.4 | Lv 角标 | `slot.badge.node.active = false`（永不显示） | 高建筑体量大，反而更该用角标；现在只能靠选中时的两行白字 |
| 4.5 | 建造目录 | 纯文本行（名称 + 成本） | 13 张现成图没有用在"选建筑"这一步，玩家靠读文字选 |
| 4.6 | **主城外观串位** | `pvpCard` 2002 主城 `buildIcon='mine'` ⇒ `buildingFramesByCardId` 命中 `mine.png`；2001 金矿 `buildIcon` 空 ⇒ 走 `frameForBuildingType('mine')` 也命中 `mine.png` | **对局里主城和金矿长得一模一样**（`hq-base.png` 只在自选阶段用得到）。两张图差异极大，属配置串行 |
| 4.7 | 田 / 装饰同图 | 5 座粮食田共用 `base_grain`、3 座铁矿共用 `base_iron`、6 座装饰 4 座共用 `territory_random_resource_v1` | 同屏像复制粘贴，玩家记不住"哪座是我升到 8 级的" |
| 4.8 | `71017` 无图 | `baseBuildIcon = null` | 走概念图兜底，基地里出现一块"不属于这套画风"的占位 |

---

## 5. 交互建议

### P0（做完就有明显体感差）

**P0-1 建造目录加缩略图（零新美术）**

| 项 | 内容 |
| --- | --- |
| 现象 | `BigMapBuildMenuPopup` 的行是「名称 + 成本」纯文本，13 张图完全没用上 |
| 建议 | 行内左加 **64×64 缩略图**（同一张图，`CUSTOM + 裁边`），右两行：名称 / `粮 12 木 8`（不足标红） |
| 落点 | `BigMapBuildMenuPopup` prefab 行模板加 `Icon` 节点；`fitPlotIcon` 抽成纯函数供缩略图复用 |
| 判据 | `tests/bigmap-page-prefab.test.ts` 增「建造目录行含缩略图且 Sprite 为 CUSTOM」 |

**P0-2 选中态与名字牌让位给"高建筑"**

| 项 | 内容 |
| --- | --- |
| 现象 | 选中是格面双环 + 底光；建筑越高，双环被挡得越多（新图内容高 96px，格面高 96px，几乎全挡） |
| 建议 | 三层读法：**地面**（归属/可放置红绿/选中双环）→ **底座**（功能色环）→ **本体** → **头顶**（名牌/Lv/进度/产出）。名牌 y 改用**内容顶** `visualTop + 12`，不用 `iconHeight/2` |
| 落点 | `BigMapBaseView.render`：`slot.name.node.setPosition(0, visualTop + 12, 0)`；`visualTop` 由 `fitPlotIcon` 返回 |
| 判据 | `tests/bigmap-base-render.test.ts` 增「名牌不压建筑本体（y ≥ 内容顶）」 |

**P0-3 体量层级用「高度倍率表」表达，不要逐图调 prefab**

| 类型 | 倍率 | 理由 |
| --- | --- | --- |
| 主城 71001 | 1.06（现状保留） | 视觉重心 |
| 研究院 71016 / 小玩法入口 71017 | **1.10** | 功能性建筑要比田显眼 |
| 装饰雕像 | 0.92 | 背景物，不该抢主城 |
| 田（2~5） | 1.00 | 基准 |

落点：`BigMapBaseView` 里把 1.06 那处三元换成一张 `BUILDING_HEIGHT_SCALE[type]` 常量表 —— 与 `ZCHexView.BUILDING_ICON_TYPE_SCALE`（金矿 ×1.1）同一套做法，别在两处各写一遍。

### P1（明显掉分）

| # | 建议 | 落点 / 判据 |
| --- | --- | --- |
| P1-1 | **进度环从格面移到「建筑底部椭圆」**：环画在格面中心会被高建筑挡掉下半，玩家看不见建到几成 | `buildBigMapProgressPolyline` 半径改按 `visualBottom` 算；`bigmap-base-render` |
| P1-2 | **可收取气泡**：产出满时现在只有头顶一行小数字（`stored N`）。改为「底座呼吸光 + 头顶气泡图标」，数字收进气泡 | 复用现成 `Glow` 节点；`bigmap-base-view` |
| P1-3 | **Lv 角标开放**：`badge` 现在永久 `active=false`。建议只在**选中**与**可升级**时显示 `Lv.N` 角标（贴在底座右下） | 与 P0-2 的头牌并存会重复，取其一：常态角标、选中才出头牌 |
| P1-4 | **ghost 用同一张图**（已做）**但加"落格预览底光"**：现在只有红绿染色，高建筑放大后 ghost 会盖住落点格 | `renderGhost` 加 `Glow` |
| P1-5 | **同图去同质化（客户端侧，零美术）**：5 座田现在完全一样。可用 `flipX` 随机 + 底座光点色 ±6% 色相，配合名牌区分 | `render` 里按 `hexId` 取稳定随机（不要 `Math.random()`，会每帧抖） |

### P2（打磨 / 待排期）

- 建筑升级瞬间的「成长爆点」（scale 1→1.08→1，0.28s）——现在升级只换数字。
- 建造目录按「产出 / 功能 / 装饰」分组，13 张图分组后视觉上自然成簇。
- 长按建筑的「详情卡」里放一张大图（`256×256`），复用同一资源，提升"这是我要升的那座"的确认感。

---

## 6. 资产与性能优化

| 项 | 判断 |
| --- | --- |
| 图集容量 | `auto-atlas.pac` 是 2048²（4.19M px），现有约 2.57M，加 13 张（13×212² ≈ 0.58M）到 **3.15M**，**够**（约 75% 占用）。⚠️ 若将来为每类补 2~3 个变体（P1-11 的正解），会逼近上限，需提前拆第二张图集或降到 4×4 压缩 |
| 压缩 | 统一 **ASTC 6×6**（与 `compressSettings` 现有预设一致）。这批是厚描边大色块，6×6 的块状伪影在 96px 下几乎不可见，不必上 4×4 |
| **不要为状态另出图** | 「建造中 / 受损 / 废墟」若各出一套，图集直接翻 3 倍。建议：建造中用 `UIOpacity` 0.55 + 脚手架叠加；受损用 `color` 压暗 + 裂纹叠加 Sprite（单张小图，共用） |
| DC | 建筑同在一张 auto-atlas ⇒ 同材质，`color` 走顶点色**不打断合批**。但 ghost / 缩略图若用了别的图集，会多一次 DC，可接受（各 1 次） |
| 溢出与遮挡 | 大图溢出邻格时，绘制顺序必须"后行压前行"。基地侧已按 `paintOrder` 铺节点（`BigMapBaseView.ts:226`），天然满足；**对局侧不同**——`BuildingOverlay` 是固定层、不排序，若将来进对局必须先补 Y-sort |

---

## 7. 无障碍与可读性（WCAG 2.2 AA）

| 检查 | 结论 |
| --- | --- |
| 96px 下同色系难分 | 13 张里 **5 张是红/橙暖色 + 黄黑警示条**（SLG 1/3/7/12/13），缩到 96px 后靠颜色分不出。**形状差异够**（烟囱/雷达/炮管/齿轮/雪花），但缩略图必须 ≥ 64×64，不能压到 48 |
| 归属/敌我不得只靠染色 | 这批深色建筑（SLG 7 黑黄、SLG 12 红黑）染红几乎无变化 ⇒ 若进对局，阵营要用「地面阵营环 + 名牌红框」双编码，别只 tint |
| 状态不得只靠颜色 | 延续既有规则：可放置 ✓ / 不可放置 ✕ + 红绿；资源不足要写缺多少，不能只变红 |
| 触控目标 | 格心拾取（`pickBigMapBasePlot`）+ `tileHeight × 1.1` 吸附已满足 ≥44×44；**别改成按图 rect 拾取**，高建筑会吃掉相邻格（§14.1 P1-12 已修过） |
| 文字对比 | 名牌在沙地上用 `BIGMAP_SKIN_COLORS.text`（暖棕 `(90,58,24)` 对沙地 4.90:1 ✅）已达标，沿用 |

---

## 8. 13 张的具体填法（建议，改表前需策划确认）

> 真源是 `doc/塔防数据配置/DM-建筑配置.xlsx` 的 **I 列（`baseBuildIcon`）**，不是 `remoteRef/baseBuilding.json`（改 json 会被导表覆盖）。

| 表 id | 建筑 | 现在 | 建议 | 是否解决 4.7/4.8 |
| --- | --- | --- | --- | --- |
| 71001 | 主城 | `base_main` | `base_main`（保留）或换 `SLG 4` 太阳神殿 | — |
| 71016 | 研究院 | `base_research` | `SLG 10` 蓝晶塔 | 视觉升级 |
| **71017** | **小玩法入口** | **空（概念图兜底）** | **`SLG 5` 黏液巢穴** | ✅ 解决 4.8 |
| 71018 | 装饰雕像1 | `territory_home_v1` | `SLG 2` 雷达站 | ✅ |
| 71019 | 装饰雕像2 | `territory_random_resource_v1` | `SLG 7` 地堡 | ✅ |
| 71020 | 装饰雕像3 | 同上 | `SLG 8` 紫环塔 | ✅ |
| 71021 | 装饰雕像4（maxNum 5） | 同上 | `SLG 9` 齿轮厂 | ✅ |
| 71022 | 装饰雕像5（maxNum 5） | `territory_decor_02_v1` | `SLG 11` 冰霜塔 | ✅ |
| 71023 | 装饰雕像6（maxNum 5） | `territory_random_resource_v1` | `SLG 12` 巨炮台 | ✅ |
| 71002~71006 | 粮食田 ×5 | 全 `base_grain` | **不动**（田不能顶替，见 §0.3） | ❌ 仍需田的变体 |
| 71007~71011 | 木材田 ×5 | 全 `base_wood` | 不动 | ❌ 同上 |
| 71012~71014 | 铁矿田 ×3 | 全 `base_iron` | 不动 | ❌ 同上 |
| 71015 | 货币田 | `base_coin` | 不动 | — |

**剩余 5 张**（SLG 1 熔炉 / SLG 3 军械库 / SLG 6 车库 / SLG 13 机械要塞 + 主城未用的那张）**先不入表**，留给：
- 未来新增建筑类型（兵营/仓库/防御塔）；
- 或田的「升级态」（Lv.5 以上把田换成带加工厂的版本）——这是"田重复"的解，但不是本次范围。

---

## 9. 落地顺序（按「客户端能否独立闭环」排）

| 序 | 项 | 成本 | 依赖 | 判据 |
| --- | --- | --- | --- | --- |
| 1 | 资源裁边 + 重命名（`tmp/_trim_buildings.py`） | 低 | 无 | 13 张 `frame.rect == 内容`、底边 y=178±2 |
| 2 | 落库 `assets/resources/image/buildings/`（走 auto-atlas） | 低 | 1 | 图集 ≤ 4.19M px、`asset_system refresh` 后 resource 索引可见 |
| 3 | 改 xlsx I 列 9 处（71016~71023） | 低 | 2 | 导表后逐格 diff 恰 9 格 |
| 4 | P0-3 高度倍率表 | 低 | 无 | `bigmap-base-render` 新增一条 |
| 5 | P0-1 建造目录缩略图 | 中 | 2 | `bigmap-page-prefab` 新增一条 |
| 6 | P0-2 名牌改按内容顶 | 中 | 1 | `bigmap-base-render`（断言 y ≥ visualTop） |
| 7 | P1-1 进度环移到建筑底部 | 中 | 6 | `bigmap-base-render` |
| 8 | 4.6 主城图串位（`xlsx` 2002 行 `buildIcon` 清空） | 低 | 策划确认 | 对局里主城走 `hq-base`、金矿走 `mine` |

**验证口径**（沿用项目既有约定）：改动后跑绑定的最小集
`npx tsx --test tests/bigmap-base-render.test.ts tests/bigmap-base-view.test.ts tests/bigmap-page-prefab.test.ts`，
按**失败用例名集合双向差集**判零新增（不看总数）。
已知基线红见 `docs/bigmap-基地建筑交互改进方案.md` §14/§15.4，本轮不应触碰其符号。

---

## 10. 一句话总结

这批图的价值是**把基地里"没图 / 同图"的 7 个位置一次填满**，
但它自带 15px 基线漂移与 22% 体量差 —— 先定出图规范（底边 178、内容高 78~84%、ASCII 命名），
再让代码按**内容**而不是画布归一尺寸、把名牌与进度环移到"建筑之上 / 建筑底部"，
最后用**高度倍率表**建立「主城 > 功能建筑 > 田 > 装饰」的视觉层级。
不要拿堡垒顶替田，也不要把这批当对局资源用。

---

## 11. 落地记录（2026-11-12，**世界侧**先做，基地不动）

口径：山猫「先替换 SLG 世界那边，基地的有现有资源」。基地（`image/buildings/base_*`）**一张没动**。

### 11.1 资源

`zarts/.../SLG堡垒` 13 张 → `assets/resources/image/buildings/`，由 `tmp/_world_camp_art.py` 统一处理：
画布 212×212、内容**居中**（`offset ≈ 0`，实测 max|offset| = 0.5）。

| 源 | 目标 | 语义 | 用于（`campId // 100`） |
| --- | --- | --- | --- |
| SLG 5 | `camp_outpost.png` | 黏液巢穴 | 1xx 前哨营地 |
| SLG 2 | `camp_outpost_2.png` | 雷达站 | 1xx 段内变体 |
| SLG 7 | `camp_mist_fort.png` | 地堡 | 2xx 雾隐堡 |
| SLG 6 | `camp_mist_fort_2.png` | 车库车间 | 2xx 段内变体 |
| SLG 3 | `camp_legion.png` | 军械库 | 3xx 军团壁垒 / 城池兜底 |
| SLG 9 | `camp_legion_2.png` | 齿轮厂 | 3xx 段内变体 |
| SLG 1 | `camp_abyss.png` | 熔炉 | 4xx 深渊地堡 |
| SLG 8 | `camp_rot_tower.png` | 紫环塔 | 5xx 腐化高塔 |
| SLG 11 | `camp_rot_tower_2.png` | 冰霜塔 | 5xx 段内变体 |
| SLG 12 | `camp_lava.png` | 巨炮台 | 6xx 熔岩要塞 |
| SLG 10 | `camp_sky.png` | 蓝晶塔 | 7xx 苍穹圣城 |
| SLG 4 | `camp_sun_throne.png` | 太阳神殿 | 8xx 太阳神座 |
| SLG 13 | `camp_home.png` | 机械要塞 | 玩家主城 / 基地（`art.home`） |

图集：`image/buildings` auto-atlas 86 张 / **1.62M px / 2048² 占 38.7%**（`tests/auto-atlas-capacity.test.ts` C2 绿）。

### 11.2 代码

| 文件 | 改动 |
| --- | --- |
| `bigmap/application/BigMapArtCatalog.ts` | 新增 `BIGMAP_WORLD_CAMP_ART`（按段分档 + 段内变体）、`BIGMAP_WORLD_HOME_ART`、`BIGMAP_WORLD_CITY_ART`、`worldCampArtFor()` |
| `bigmap/application/BigMapArtLoader.ts` | `art.home` / `art.city` 换新图；`campTask` 过 `worldCampArtFor()` |
| `tests/bigmap-art-loading.test.ts` | 3 条断言的期望路径同步；补「相邻据点不同图」「同一张只请求一次」「没有一条停在概念占位图」 |

**为什么不直接改 `bigMapCamp.campIcon`（81 行）**：那一列现在全是 `image/concept/sprites/*` 占位值，
不是「这座据点该长这样」的数据真源。`worldCampArtFor()` 只认这 8 个占位路径，策划/服务器换成真实图名后自动让位
—— 与「图名来自表、目录在这里拼」（规则 137）不冲突，也不用动 81 行表。

### 11.3 落点变化（要预览确认的事）

新图 `offset≈0` ⇒ 建筑底边 = `iconY - height/2` = **`-16`**（正好是名条顶边，即设计意图）。旧图因为内容偏上被
`-offset` 反推下沉：

| 标记 | 旧底边 | 新底边 | 变化 |
| --- | --- | --- | --- |
| 城（`camp_legion`，235 宽） | `-91` | `-16` | **上移 75px** |
| 主城（`camp_home`，148 宽） | `-72` | `-16` | **上移 56px** |

方向上「回到设计位置」（与名条严丝合缝），但世界地图上所有据点会整体上移 —— **必须真机看一眼**。
若要压回原位，改 `BIGMAP_MARKER_FOOT_LIFT`（现 16）或给 `art.home` 单独加偏移，别改回按 offset 反推。

主城另有体量变化：`hq-base` 是 103×121（瘦高），`camp_home` 是 170×157（接近正方），按 148 宽归一会**变矮 21%**（174 → 137）。要不要给 `BIGMAP_MARKER_BASE_WIDTH` 单独提一档，需视觉拍板。

### 11.4 遗留

1. `data.cities`（25 座，`bigmapCity`）与 `art.camps`（81 个，`bigMapCamp`）靠 **id 撞号**取图：`camps.get(city.cityId)`。
   撞上才有分段图，撞不上回退 `art.city`（`camp_legion`）。如 `cityId 401 王座` → `campId 401 深渊地堡`，语义已经错位，属既有耦合。
   彻底解需要 city 侧按 `layer` 直接取图（`IBigMapCityView.layer` 已有），并在 view 里把优先级从「campIcon 优先」改成「layer 优先」——**本次没动**。
2. 野怪（`art.monster`）仍走 `image/territory/buildings/territory_boss_v1`（同为 212 画布同族图），本批 13 张没有对应素材。
3. 基地（`base_*` 6 张 / 23 座建筑）按山猫口径**不动**；§1~§9 的建议仍有效，待单独排期。

---

## 12. 旧资源删库记录（2026-11-12）

口径：山猫「基地与世界的旧资源删除掉」。删的是**两边共用的初版概念图**（`bundles/bigmap/image/concept/sprites/`），
基地新图 `base_*` 与世界新图 `camp_*` 一张没动。

### 12.1 删了 9 张（图 + `.meta`，`svn delete`）

`barracks` / `farm` / `fortress` / `headquarters` / `ironworks` / `mutant_camp` / `sawmill` / `warehouse` / `water_tower`

**能删的前提是先拆引用**（否则会静默失效：`has=false` → `null` → 界面上少一张图，日志只有一条 warn）：

| 原引用 | 处理 |
| --- | --- |
| `BIGMAP_BUILDING_ART`（8 项，按 `baseBuildType` 对概念图） | **整表删除**，改 `BIGMAP_BASE_FALLBACK_ART = 'image/buildings/camp_outpost'` 一张通用图（只有 71017 会走到） |
| `art.city` 的 `?? fortress` 兜底 | 去掉 |
| `art.monster` 的 `?? mutantCamp` 兜底 | 去掉 |
| `camps` 的 `?? city ?? fortress` 三级链 | 收成 `?? city` |
| `bigMapCamp.campIcon`（表，7 张被引用） | **不动**：运行时先过 `worldCampArtFor()` 归一成新图，根本不加载旧路径 |
| `manifest.json`（25 条带 sha256 校验） | 同步裁到 16 条 |

删前用**旧 `.meta` 的 uuid + Cocos 压缩 uuid**（去横线保留前 5 位、每 3 hex → 2 base64）反查了全工程
`.prefab/.scene/.ts/.json`：**9/9 零 uuid 引用**，不存在 prefab 硬绑图片的情况。

### 12.2 保留 7 张（各有消费方）

| 图 | 谁在用 |
| --- | --- |
| `coin` / `grain` / `iron` / `wood` | 资源图标兜底（`resourceTask`），`bigMapResource.itemId` 没配时用 |
| `construction` | 基地「建造中」外观（`art.construction`） |
| `rocks` / `grass` | 地形装饰兜底（`art.rock` / `art.grass`） |

### 12.3 `hq-base` / `barracks-default` **没删**（世界不用了，对局还在用）

| 引用点 | 用途 |
| --- | --- |
| `ZCGameViewUtil.ts:1153-1154` | 对局 `building === 'hq' / 'barracks'` 的外观回退 |
| `ZCGuideConfig.ts:52` | 新手引导「兵营」那张图 |
| `remoteRef/monsterCard.json:75` | 怪物卡的建筑外观名 |

它们在世界侧已经让位给 `camp_home` / `camp_legion`，但对局是植物系世界观，不能跟着换金属堡垒。
真要删必须先改上面三处 —— 属于另一个改动，**本次没做**。

### 12.4 验证

`bigmap-art-loading` 10、`bigmap-art-assets` 3、`bundle-scope` 2、`bigmap-latest-camp-config` 5、
`bigmap-bundle-coverage`、`bigmap-world`、`bigmap-page-prefab`、`bigmap-resource-item-icons`、`auto-atlas-capacity`
合计 **47 例全绿**；`tsc --noEmit` 过滤 bigmap 零错。

测试改了 4 处期望，都是**语义跟着走**而不是放宽：
- `bigmap-art-assets`：清单 25 → 16，`BIGMAP_BUILDING_ART` 循环改成验 `BIGMAP_BASE_FALLBACK_ART`
- `bigmap-art-loading`：「按 type 回退概念图」→「统一回退通用图」，71017 期望 `camp_outpost`
- `bigmap-latest-camp-config`：图存在性从验 `campIcon` 原值改为验 `worldCampArtFor()` 归一后的路径
  （原写法删库后必然假红，因为旧图本来就不该被加载）
- `bundle-scope`：`image/concept/sprites/farm` 示例改成 `grain`

### 12.5 遗留

`bigMapCamp.json` 的 `campIcon` 列仍写着 7 个已删路径（表真源在 xlsx，改它要导表）。
运行时无影响（`worldCampArtFor` 先归一），但策划看表会以为图还在。要清就得改 xlsx 那一列 81 行。

---

## 13. 表同步（2026-11-12，收掉 §12.5 的遗留）

口径：山猫「遗留问题要同步现有资源」。即 `bigMapCamp.campIcon` 那一列不能再指着已删的概念图。

真源是 `D:/City1001/doc/塔防数据配置/DM-城池配置.xlsx`（单 sheet「城池配置」，
**AC 列 = 城池图标**，数据 row 7~87 共 81 行，表头 6 行：产物名 / 导出标志 / 中文 / 中文补充 / 英文 key / 类型）。

### 13.1 三处一起改，值完全一致

| 位置 | 角色 | 改法 |
| --- | --- | --- |
| `DM-城池配置.xlsx` AC 列 | **真源** | zip 级 XML：`sharedStrings` 末尾追加 12 个新串（旧串与既有索引全不动），只改 AC 列 81 个 `<v>` 索引，`uniqueCount 206 → 218`；重打包保留原 `ZipInfo`，`testzip()` 校验 |
| `assets/remoteRef/bigMapCamp.json` | 客户端产物 | **按行替换**（该文件是 eSon 自定义排法：每元素一行、无缩进、数组字段跨多行）；`svn diff` = 164 行 = 81 删 + 81 增 + 2 header，结构零重排 |
| `doc/.../json/client/bigMapCamp.json` | 策划 JSON 中间产物 | 同上，逐行正则换；`campIcon` 单行紧凑 |

`json/sever/bigMapCamp.json` 不动 —— 服务端表本来就没有 `campIcon` 列（0 次命中）。

### 13.2 分配（与 `BIGMAP_WORLD_CAMP_ART` 同口径，段内 `campId % len`）

| 段 | 图 | 实际条数 |
| --- | --- | --- |
| 1xx 前哨营地 | `camp_outpost` / `_2` | 11 + 11 |
| 2xx 雾隐堡 | `camp_mist_fort` / `_2` | 7 + 8 |
| 3xx 军团壁垒 | `camp_legion` / `_2` | 6 + 7 |
| 4xx 深渊地堡 | `camp_abyss` | 9 |
| 5xx 腐化高塔 | `camp_rot_tower` / `_2` | 4 + 4 |
| 6xx 熔岩要塞 | `camp_lava` | 7 |
| 7xx 苍穹圣城 | `camp_sky` | 6 |
| 8xx 太阳神座 | `camp_sun_throne` | 1 |

残留旧路径：**0**。

### 13.3 逐格证明

```text
k 相同: True | 行数 81 -> 81
有差异的行: 81
每行差异列号集合: [(26,)]      ← 只有 campIcon 这一列
总差异格: 81
```

### 13.4 为什么要写「按行替换」这个脚本

第一版用 `json.dumps` 重写，`svn diff` 直接变成 `@@ -1,7091 +1 @@`（整文件换一行）——
真实差异完全不可见，正是铁律 3 点名的形态。回退后改成按出现顺序定位 campIcon 值行，
并先断言「每段旧图名与段号一致」防止行序与 campId 错位，才得到上表那份 81 格的干净 diff。

### 13.5 验证

`bigmap-art-loading` **11**（新增 1 条 `worldCampArtFor` 纯函数守护，因为表改成真图名后正常链路不再命中该映射，
不能靠集成用例间接覆盖）、`bigmap-latest-camp-config` 5、`bigmap-art-assets` 3、
`bigmap-bundle-coverage`、`bigmap-world`、`bigmap-page-prefab` 合计 **41 例全绿**。

备份：`tmp/_bak/DM-城池配置.xlsx.20261112`、`tmp/_bak/bigMapCamp.json.20261112`、
`tmp/_bak/bigMapCamp.json.client.20261112`。
