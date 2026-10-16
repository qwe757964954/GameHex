# 占城大师（zcds）表现层与领地专项规范

> **定位与适用范围**：
> * 本文档拆分自 [AI架构与代码规范.md](./AI架构与代码规范.md) 原第 `7.3.3` ~ `7.3.11` 节，是**对局表现层（`app/zcds/view`）与「冒险」领地页（`app/territory`）的唯一完整实现规格书**。
> * 凡涉及对局棋盘图层、地块激活/脉冲/卡牌/建筑动画、飘字曲线、自选主城、开局归属扩散波、胜利扫场、传说卡横幅以及领地页的修改，AI 与开发人员必须先核对本文档中的不变量与回归测试判据。

---

## 目录

1. [对局棋盘的图层结构与地块表现（`ZCGameBoard.prefab`）](#1-对局棋盘的图层结构与地块表现zcgameboardprefab)
2. [抽到金卡的「传说卡出场横幅」（`ZCGameLegendBanner.prefab`）](#2-抽到金卡的传说卡出场横幅zcgamelegendbannerprefab)
3. [「冒险」领地页的职责边界（Prefab 骨架 + 三个视图 + 纯 TS Presenter）](#3-冒险领地页的职责边界prefab-骨架--三个视图--纯-ts-presenter)
4. [其他玩家席位的视觉区分：顶点色相乘灰](#4-其他玩家席位的视觉区分顶点色相乘灰)
5. [自选主城（选择基地模式）：World 层表现 + 跟随基地的确认按钮](#5-自选主城选择基地模式world-层表现--跟随基地的确认按钮)
6. [战斗飘字「快进慢出」：前 45% 入场，后 55% 淡出](#6-战斗飘字快进慢出前-45-入场后-55-淡出)
7. [开局归属扩散波：归属格直接切换、中立格逐个替换](#7-开局归属扩散波归属格直接切换中立格逐个替换)
8. [脉冲水波纹的「黑边」：专用着色器 `shaders/hex-pulse.effect`](#8-脉冲水波纹的黑边专用着色器-shadershex-pulseeffect)
9. [体验反馈专项（row8~row13）：结算扫场 / 描边同步 / 金矿提示 / 横幅扇入 / 产金抖动](#9-体验反馈专项row8row13结算扫场--描边同步--金矿提示--横幅扇入--产金抖动)

---

## 1. 对局棋盘的图层结构与地块表现（`ZCGameBoard.prefab`）

### 1.1 声明式棋盘图层（代码不拼层）

`ZCGameRenderWorld` **不再自己 `new Node` 拼图层**。地图层下的结构固定声明在 `ZCGameBoard.prefab` 中：

```text
mapLayer（= ZCGameHUD.prefab 的 content）
└─ ZCGameBoard          ← ui/game/ZCGameBoard.prefab（ZCGameLoader 加载 → ZCGame 实例化后挂进来）
   ├─ MapWater          水面：cc.Graphics，矩形在 initialize 里按地图包围盒画
   ├─ HexLayer          地块实例挂这里
   ├─ OutlineLayer      整盘共享的领地轮廓：一个 cc.Graphics（ZCOutlineLayer 逐边描线）
   ├─ ResourceLayer     中立资源图标：从地块节点里**抬上来**的（见下方图标规则）
   ├─ DecorLayer        虚空装饰：ZCGameDecor.prefab 的条目挂这里
   ├─ BuildingOverlay   建筑剪影（从地块节点里提升上来的）
   └─ CooldownOverlay   生命条 + 冷却圈
```

**子节点顺序 = 渲染顺序**（后画的压在上面）。城墙砖层不在 prefab 里（它来自另一个 prefab），由 `initialize` 用 `wallLayer.setSiblingIndex(outlineLayer.getSiblingIndex() + 1)` 插进去 —— **锚点是 `OutlineLayer` 而不是 `HexLayer`**（按 `HexLayer + 1` 插会把墙塞到轮廓之下，轮廓线从墙砖里穿出来）。

⚠️ 这一插会把后面的层整体后移一位：`ResourceLayer` 于是从「轮廓之后」变成「**墙线之后**」，即资源图标压得过墙砖（有意为之：图标是内容标记，被墙线切一半比压住墙线难看得多）。

**别再退回「用 `siblingIndex` 现算层序」的写法。** 老代码用 `decorSlotIndex = 地块数 + 1` 算装饰层落点，那个算式默认「地块从 index 1 开始」，而 `wallLayer`（由 `ZCGame` 先挂进 `mapLayer`）正好占了 index 1 ⇒ 装饰层实际被插到了**最后一个地块之前**。改成声明式之后这类错位不存在，改层序 = 改 prefab 的子节点顺序。

* **墙砖之间还按屏幕 y 再排一次**：`renderWallSystem` 在铺砖前把**全盘**墙段按 `segment.y` **降序**排一遍 ⇒ 越下方的城墙层级越高、恒压住上方的城墙（跨格与格内用同一条规则）。
  * ⚠️ 必须**整盘一起排**，不能按格 / 按连通簇分段排：分段时「墙环绕一圈」的接角处上下关系仍随簇遍历顺序漂。不排的后果很具体 —— 单格 6 边按 edge 0→5 铺，落点 y 是 `edge1 > edge0/edge2 > edge3/edge5 > edge4`，于是顶点 v1（右上，edge0×edge1）与 v5（右下，edge4×edge5）变成「后画的砖更高 ⇒ 上方砖压下方砖」，而 v0/v2/v3/v4 四个顶点却是下方砖压上方砖，表现就是「有的角对齐、有的角带台阶」。
  * ⚠️ 这条排序会打乱 `segmentIndex` 与边的对应（`records` 下标不再等于 edge），也让共享材质里的**帧槽号**按新的取用顺序分配 —— 依赖顺序的用例必须改成「按落点反查边号」，别再把 `records[edge]` 或 `rightUp=0` 写死。
  * **判据**：`tests/zcds-render-performance.test.ts` 的「跨格城墙统一按屏幕 y 降序：下方地块的墙砖全部排在上方地块之后」。
* 层的引用一律走 `board.getChildByName('<层名>')`（`ZCGameRenderWorld.boardLayer()`），**别在别处再 `new Node` 同名层**。
* 各层（含水面）的 `layer` 必须都是 `UI_2D`：漏了 UI 相机不渲染，而且一条报错都没有。
* `destroy()` 只摘 ECS 实体与装饰节点；**board 与城墙层归调用方**（随 HUD 一起销毁），渲染层里不许拆。
* **图层判据**：`tests/zcds-progress.test.ts` 的「棋盘图层顺序声明在 ZCGameBoard.prefab 里…」（读 prefab 的 `_children` 序 + 逐层 `_layer`）+ 端到端 `tmp/_board_probe.mjs`（真引擎跑一遍 `initialize`，量运行时层序 / 每层节点数 / 水面组件，16 条）。

### 1.2 地块图标缩放、中立资源抬层与落点

* **地块上的图标缩放由代码定，不看 prefab 的 `_lscale`**：`iconSprite`（地块类型图标 `icon_jk` / `icon_by` / `icon_wh` / `icon_em`）与**资源点图标共用同一个节点**，`ZCHexView.renderContent` 是它 `scale` 的唯一写入口 —— 走资源点图标时按 `resourceIconScale` 缩到格子边长，其余情况写回 `TILE_ICON_SCALE = 0.8`。只改 `ZCGameHex.prefab` 会被这一句**静默覆盖成 1**（编辑器里怎么调都没反应，表现为「地块图标比设计稿大一号」）。已建建筑同口径：`buildingSprite` 基准 `BUILDING_ICON_SCALE = 0.72`，唯一写入口 `applyBuildingScale`。金币 `BuildingLayer/PriceIcon` 与数字 `BuildingLayer/IconLabel` **不参与**这套缩放。
  * **判据**：`tests/zcds-tile-icon-scale.test.ts`（0.8 由代码写、金币与数字不被牵连、资源点仍按图缩）；同族 `tests/zcds-building-icon-scale.test.ts`、`tests/zcds-resource-icon-scale.test.ts`。
* **中立资源图标必须画在格子线之上（`ResourceLayer`）**：地块整图是 130×119，而格距只有 92.25×90 ⇒ **相邻格整图互相重叠**，2.5D 那套「后画的整格盖住先画的」就靠这个顺序。资源图标节点 128×128，比地块**顶面** 123×90 还大还宽 ⇒ 只要它还挂在格节点里，伸进邻格的那一段就会被邻格整图沿**格边线**切掉（症状：资源图标的边被一条直线齐刷刷切断，甚至只剩半张）。
  * `ZCHexView.setResourceIconRaised` 把它抬到 `ZCGameBoard.prefab` 的 `ResourceLayer`（唯一写 parent 的入口），坐标随之改成**棋盘层局部口径**（格节点位置 + `BuildingLayer` 偏移 + 图标偏移），唯一写入口 `applyIconPosition` —— 少补一次偏移，图标就飞到棋盘原点附近。
  * **地块类型图标不抬**：它的可见字形只占节点中段（约 33×33），本来就落在顶面之内。抬层只在「这一格确实画资源图标」时发生（由 `renderContent` 的 `resourceFrame` 分支驱动），所以激活表现的「整格隐藏」段要单独跟一下这个节点的显隐（`applyActivationFx`）。
  * **判据**：`tests/zcds-resource-icon-layer.test.ts`（抬层 + 坐标换算 / 收回 / 缺层兼容 / 对象池复用 / 隐藏段显隐）。
* **地块类型图标的落点**：`ZCHexView.DEFAULT_TILE_ICON_POS`（BuildingLayer 局部坐标）与 `ZCGameHex.prefab` 的 `BuildingLayer/BuildingIcon._lpos` 必须同值：当前 `y = 4`，压在底部金币行上方（2026-10-14 从 12.628 下移，原来是「上半部图标 / 下半部价格」两段式）。下界 `y ≥ 1.4` —— 再小图标字形就会切到金币图标（`PriceIcon` 在 BuildingLayer 局部 y = -26.376、缩放 0.65 不参与缩放）。
  * ⚠️ `BuildingLayer` 挂着 `cc.Widget`（`_alignMode = ALWAYS`、`_verticalCenter = 15.101`），它运行时的局部 y 就是 **15.101**（早期注释里的 2.342 是过期值）；换算成格节点局部坐标要 +15.101。
* **中立资源点（`unit_cap`）格内那队兵的落点**（2026-10-15 改）：`ZCHexView.RESOURCE_UNIT_POS_Y` 由 `-18` 改为 `12` —— 需求「将中立资源-兵团的位置上移30个px」。原口径「骨骼脚底 = 格心偏下一点」会让兵力资源点里的 N 个兵陷进地块整图下半部、被侧壁压住。
  * ⚠️ 只动这一个数：横向间距 `RESOURCE_UNIT_SPACING = 16`、目标高 `RESOURCE_UNIT_TARGET_HEIGHT = 48.6` 不变；排序 / 缩放 / 待机动作（`layoutResourceUnits`）全部照旧。
  * **判据**：`tests/zcds-resource-unit-preview.test.ts`。

### 1.3 地块激活表现：点击动画（脉冲 ∥ 缩没）→ 卡牌弹出 → 建筑同拍由小变大

`ZCHexView.hexActivationFx` 把 `ZC_HEX_ACTIVATION_SECONDS`（定义在 `ZCBattlePresentationQueue`）**按秒**切成两段 —— ① **点击动画段** `ZC_CARD_START_SECONDS 0.7`（**脉冲与缩没并发**，同起同收）+ ② **卡牌段** `ZC_CARD_REVEAL_SECONDS 1.156` = **1.856s**。建筑**不单开一段**：它落在卡牌淡出窗（最后 38% = 0.43928s）内长完，所以总长 = 点击动画 + 卡牌段。

🔴 **2026-10-15 row13 需求「② 缩没段和 ① 脉冲段 同步播放，点击动画即将结束时，衔接卡牌段动画」**：两段改**并发**（退休了原先串行的「脉冲 0.7 + 缩没 0.384」合段，合段就是 `ZC_CARD_START_SECONDS`），用户同时把总长从 2.24 收到 **1.856**。口径已由「钉死总长、反推卡牌段」改成「**卡牌段固定 1.156、总长由它推**」：`ZC_HEX_ACTIVATION_SECONDS = ZC_CARD_START_SECONDS + ZC_CARD_REVEAL_SECONDS`。这样做的理由是**解耦** —— 卡牌段不动 ⇒「卡牌淡出窗必须长过建筑生长时长」这条不变式与总长无关，以后调点击动画不会碰它。旧公式 `2.784 = 缩没 0.384 + 卡牌 2.4` 与 `2.24 = 0.7 + 0.384 + 1.156` 都已作废，别再改回去。**不再有任何占比常数**（旧 `ZC_HEX_FLIP_RATIO` 已删除），换算一律按秒：段内秒数 / `ZC_HEX_ACTIVATION_SECONDS`；卡牌段也可用 `ZC_CARD_START_RATIO` + 卡牌进度 × `ZC_CARD_AXIS_RATIO`。

#### ① 点击动画段（脉冲 ∥ 缩没，0.7s）

合成函数 `hexPulseShrinkFx(seconds)`（`view/ZCHexView.ts`）：

* **脉冲**：点击地块后播**一道**美术水波纹（`image/effects/hex_pulse` 30 帧序列帧，一个周期 `HEX_PULSE_CYCLE_SECONDS = 0.7s` ≈ 43fps，按地块类型染色）。曲线 `hexPulseFx`（`core/hex/HexFlipPresentation.ts`）**只写波纹层**（见下）。
* **缩没**：`hexShrinkFx(k)`，`k = 段内秒数 / ZC_HEX_SHRINK_SECONDS`。`ZC_HEX_SHRINK_SECONDS` **必须等于 `ZC_HEX_PULSE_SECONDS`**（同起同收），否则会剩一段「格子已经没了、波还在原地扩」的空窗 ⇒ 整格**原地等比缩到 `HEX_SHRINK_MIN_SCALE = 0.1`**，`tileLift` 恒 0、`tileFlip` 恒 1（只缩，不抬、不压扁）。脉冲让人看清点的是哪一格、缩没同步把这一格收掉，0.7s 末**格子收干净**，舞台交给卡牌 —— 这就是需求要的「点击地块收缩」，也是 row13「同步播放」的落地。

🔴 **合成 = 照抄脉冲那份、把格根缩放换成缩没的**（`{ ...pulse, tileScale: shrink.tileScale }`）。2026-10-15 row16（「脉冲效果从缩小改成向外扩散消失，最大扩散 1.25 个单位格子大小，扩散的部分虚化，**其他阶段的动画保持不变**」）之后，**脉冲一根手指都不碰格根**（`hexPulseFx` 的 `tileScale` 恒 1，原先「缩到 0.92 再弹回」的原地呼吸连同 `HEX_PULSE_MIN_SCALE` 一起删除）⇒ 点击动画段整格的收小**全部由缩没负责**，别的阶段一点没动。合成从「两条曲线相乘」退化成本行，别再改回去。

**波纹层的两件事**（都写在 `GroundGlow` 节点上，**不写格根**）：

1. **向外扩散**：`pulseScale` 由 1 单调涨到 `HEX_PULSE_MAX_SCALE = 1.25`（= 1.25 个格子大小）。
   * ⚠️ 波纹层是**格根的子节点**，而格根正被并发的缩没一路收小 ⇒ `applyPulseRipple` 必须把父缩放**抵消掉**（`局部缩放 = pulseScale / 格根缩放`），写出去的才是**绝对**的格子倍率。不抵消的话波纹只会跟着地块一起缩 —— 那正是 row16 要改掉的「缩小」。位置同理反补（`局部 y = ZC_LAND_TOP_CENTER_LIFT / 格根缩放`），世界落点才恒钉在台面中心。离开脉冲段（卡牌 / 复位 / 没帧降级）由 `restoreRippleScale` 把缩放归 1（对象池复用不留残影）。
2. **外缘虚化**：`pulseFade` 由 0 单调涨到 1，`applyPulseFade` 每帧写进脉冲材质的 `pulseFade` uniform；着色器按**归一化半径** `r`（0 = 波纹中心，1 = 原图边缘）做径向遮罩 —— `r ≥ pulseShape.x` 的那一圈按强度逐渐变淡、**中心保持较实**（冲击波观感）。
   * ⚠️ 半径必须由**顶点局部坐标**（`localPos = a_position.xy`）算，不能用 `a_texCoord`：`fkz_*` 的 SpriteFrame 是**裁剪过**的（trim），UV 只覆盖裁剪框。节点 `sizeMode` 是 RAW ⇒ 四边形恒等于**原图尺寸**，局部坐标与像素 1:1 ⇒ 除以 `pulseShape.yz`（原图半尺寸 77.5 / 72）就是与帧无关的归一化半径。
   * ⚠️ `pulseShape.yz` 必须与 `fkz_*.png` 的原始尺寸（155×144）一致，换了美术图要同步改（`tests/zcds-hex-activation.test.ts` 有一条用例拿 PNG 头里的实测尺寸对齐）。
   * ⚠️ 脉冲材质是**每格克隆一份**的（`ZCHexView.ensurePulseMaterial`，懒建）：`pulseFade` 是**每帧写的 uniform**，而材质按**实例**持有 uniform ⇒ 共用一份时两格同时脉冲会互相盖掉对方的虚化强度；`onDestroy` 负责释放这份克隆（`new Material()` 不归资源管理器管）。
   * ⚠️ `CCEffect %{ ... }%` 是 YAML 块，**块内不写注释**（项目里其余 effect 都这样）。

🔴 **判据 = 整段格根 `tileScale` 单调不增 + `pulseScale` / `pulseFade` 单调增**：`tests/zcds-hex-activation.test.ts` 里有两条 `[0, 0.1, …, 0.999] × 段长` 的单调性循环。脉冲一旦回退成「缩格根」（`tileScale < 1`）、或哪天真被拆成串行（先脉冲、再缩没），前者立刻红；扩散 / 虚化若被改成往回走，后者立刻红。

🔴 **`tileLift` 恒 `0`（零位移）**：旧「收场段」那版「原地抬起 48px、停在最高点、缩到 `HEX_SHRINK_MIN_SCALE = 0.1`」被**拆成两件事**：抬升整段**删掉**（需求要**保持图片中心点坐标不变**，「先抬后缩」会让格心整段动画往上跑，读起来像「飞走」），缩没**保留**（原地、零位移）。所以 `applyTileOffset` 在点击动画段写回去的永远是布局基准，格内图标 / 价格数字的中心也不会跟着偏。

波纹的速度只由 `HEX_PULSE_CYCLE_SECONDS` 决定；视图侧 `pulsePhase` 只用来选帧（帧自带起波 → 扩散 → 收掉的 alpha 曲线，不再叠第二层强度），`pulseScale` / `pulseFade` 则分别驱动**扩散**与**外缘虚化**（两条都是相位的线性函数，见上面「波纹层的两件事」）。

写缩放的位置是**格根节点**（`applyTileTransform` 是 `node.setScale` 的唯一写入口）—— 图标、金币数字、血条都在子节点上，随父一起缩（这就是「连带着图标和数字 UI 一起缩」的落地方式）。
⚠️ 点击动画段的 `buildingPopScale` 恒 0（两条曲线都这么给）：开发落地后模型已是 `developed`，若不按阶段强制渲染「开发前」外观，点击动画段就会带着**已落地的建筑**缩，而不是图标+数字 —— 所以 `render` 里算一个 `showDevelopable`（= 点击动画段且 `hasCardReveal`），`renderContent` 据此把 `canDevelop` 临时抬成 true、`hasBuilding` 压成 false。对局**不再绕水平轴翻面、也不再加载/注入 `hex-flip.effect`**；那份透视材质与 `hexFlipBodyGlow` **只剩领地地图的随机资源格翻开在用**（`TerritoryHexFlip`）。

⚠️ **零位移的两个连带结果**（都不是 bug，别去「修」）：
1. 底光（`hex-ground-glow` 序列帧）的强度含 `clamp01(tileLift / HEX_FLIP_LIFT_PIXELS)` ⇒ 对局点击动画段**不再点亮底光**。那道光画的是「地块抬起后露出的原格开口」，不抬就没有开口。要保住它就**另找驱动量**，绝对不许把 `tileLift` 填回非零 —— 那等于把位移加回来。序列帧、注入入口与 `hexCollapseProgress` 那条等价 flip 轴都照旧保留（领地还在用）。
2. `setRaised(tileLift > 0)` 不再成立 ⇒ **不再换父置顶**。换父会打断合批、还要记/还原兄弟序，既然不抬（也就没有「顶面被上层压住」），整段留在 `HexLayer` 才是对的。

🔴 缩没这一段曾因 SVN 冲突整个丢失（用户报「点击地块收缩替换的动画丢失」），`tests/territory-hex-flip.test.ts` 有**正向守卫**（`assert.match(view, /hexShrinkFx\(/)`）钉住它在对局链路上。⚠️ **别再把它删成「只有脉冲」**，也别把它的跨度从 `ZC_HEX_SHRINK_SECONDS` 换回领地侧那个 `ZC_HEX_FLIP_SECONDS`（0.384，对局已不用它分段 —— 换回去就成了串行）。
⚠️ 无卡牌（`hasCardReveal = false`）时**点击动画照播**（脉冲 + 缩没两段都要），只是播完直接回常规定格、不进隐藏段。

#### ② 卡牌段

点击动画播完的**当帧**（`afterClick === 0`）弹卡牌 —— 卡牌 `startedAt` 由 `pushCardReveal` 推到「开发时刻 + `ZC_CARD_START_SECONDS`」＝点击动画末尾。小→大的节奏由**共用纯函数** `elasticPopScale`（`view/ZCGameViewUtil.ts`，卡牌与建筑共用）：`0.2 → 峰值 1.2(@POP_PEAK_AT 0.5) → 下探 0.92(@POP_DIP_AT 0.82) → 落位 1`，**弹性就来自穿过 1 的那一下下探**。卡牌在 `ZC_CARD_FADE_START_PROGRESS = 0.62` 开始淡出。

> **「出现」与「开始变大」必须是同一时刻（2026-10-15 定）**
>
> 需求原文：「地块开出卡牌，卡牌生成阶段不需要等待静止不动的阶段，出现小卡后马上播放卡片变大的动画」。
>
> 起因是卡牌的「未开始」态**没有真的做出来**：`pushCardReveal` 把 `startedAt` 推到未来，视图侧只把进度 `clamp` 到 0 —— 而进度 0 对应 `popScale = 0.2` 且 alpha 满，于是整卡**可见却一动不动**地干等一整个前置段。当时的注释以为「0.2 缩放整卡本就快缩没了，不需要额外的未开始状态」—— 这个假设是错的：0.2 缩放的卡在 720×1280 上很显眼，读作「卡牌卡住了」而不是「还没轮到它出场」。
>
> 两条一起才成立：① 起点锚回**前置段末尾**（现在是 `ZC_CARD_START_SECONDS` = 点击动画段长 = 0.7）；② 起点之前**整卡不渲染**（`ZCCardRevealView.render` 里 `now < startedAt` ⇒ 写**绝对** `node.active = false`，与建筑 `buildingPopScale = 0` 同一套惯例）。只做 ① 的话，点击动画那 0.7s 里仍会有一张静止的小卡。
>
> 🔴 **卡牌起点必须与 `hexActivationFx` 的「按秒切段」严格同源**：切段用的是 `ZC_CARD_START_SECONDS`，`pushCardReveal` 就必须推它（首批兵也锚同一个值）。⚠️ 别各自去拼 `ZC_HEX_PULSE_SECONDS`（数值上眼下相等，但语义不同 —— 改点击动画时会跟着漂）或 `ZC_HEX_FLIP_SECONDS`（0.384，领地侧那个 ⇒ 锚在上面会**偏早 0.316**，所有「从卡牌起算」的窗口全错位；row6 的 `ZC_HEX_NEIGHBOR_HOLD_SECONDS` 就被这个坑过，已改成 `ZC_CARD_START_SECONDS + 0.2`）。多算 / 少算一段不会报错，只会整体错位。

#### ③ 建筑段（与淡出同拍）

卡牌开始淡出的**那一刻**，地块原尺寸回场、建筑从 `BUILDING_POP_FROM_SCALE = 0.15` 经**同一条 `elasticPopScale`** 长到 1（`ZC_HEX_BUILDING_SECONDS 0.36s` 是建筑自己的生长时长，落在淡出窗 `ZC_CARD_REVEAL_SECONDS × (1 − 0.62) = 1.156 × 0.38 = 0.43928s` 内 ⇒ 卡牌淡完时建筑已长齐，**中间没有空窗**。这条约束是**改总长 / 插段之后仍必须成立**的检查项：卡牌段固定 1.156 ⇒ 不变式的两头都与总长无关，所以把总长从 2.784 压到 2.24、再压到 1.856（点击动画从 1.084 收到 0.7，卡牌段恒 1.156）后仍有 0.43928 > 0.36，`tests/zcds-hex-activation.test.ts` 里有断言钉它）。`buildingPopScale === 0 ⇒ node.active = false` —— 隐藏写的是**绝对** `active`（防对象池残留），不是把一个精灵缩成 0 留着白占一次绘制。

⚠️ 段末比较必须带 `HEX_ACT_SECONDS_EPSILON = 1e-9` 容差：`progress × 总时长` 重组成秒会带出 ~1e-16 的误差，末帧可能永远进不去。`progress < 0`（无激活 / 已过期）必须**先返回 idle**，别交给 `clamp01` 折成 0（那会得到「前置段起点、建筑还没长出来」的 `buildingPopScale 0`，把正常渲染里的建筑藏起来）。无卡牌路径（`hasCardReveal = false`）**不走卡牌段**：点击动画播完直接回常规定格（`HEX_FLIP_IDLE_FX`），整格全程不进「隐藏」，也没有建筑生长段（但**点击动画照播**，与有无卡牌无关）。

* **激活表现判据**：
  * `tests/zcds-hex-activation.test.ts`（**激活全程零位移（逐帧扫坐标）**、**点击动画段「脉冲 ∥ 缩没」的单调性循环（并发 vs 串行的判别式）**、**缩没段（原地、缩放落到 (0.1, 1)）**、隐藏段、**总长 = 点击动画 0.7 + 卡牌 1.156 = 1.856s**、**建筑生长必须能在淡出窗内完成**、建筑与淡出同拍的峰值、全程不挂翻转材质、**底光恒灭且不残留帧**、**不再换父置顶**、`progress < 0` 复位）
  * `tests/zcds-card-reveal-pop.test.ts`（弹性曲线三段含下探、**起点之前整卡不渲染 + 起点那一刻立刻显形且处在起手缩放 + 池复用不留可见态**）
  * `tests/zcds-building-icon-scale.test.ts`（建筑在卡牌独占段隐藏、淡出段峰值）
  * `tests/territory-hex-flip.test.ts`（**对局侧「缩没还在链路上」的正向守卫**（`hexShrinkFx` 必须在链路上）、`hexShrinkFx` / `hexShrinkBackFx` 的零位移与「抬升常量没被清零」的守卫、底光随抬升量的同源关系、`hexCollapseProgress` 与领地压扁曲线的同源关系）。🔴 缩没**已回到对局链路上**（并进点击动画段）—— 之前一度只剩领地侧用例守着，那是 SVN 冲突丢代码的窗口期。

### 1.4 单位出生抖动、建筑产兵抖动与新邻格延迟展示

* **建筑生成单位时播一次「出生抖动」**：`ZCUnitView.playSpawnShake(now)` 只记起点、不建 tween，`render` 按 `now − 起点` 反推 `spawnShakePulse`（`view/ZCGameViewUtil.ts`，`1 → 1.1 → 1` 正弦脉冲）：先 Y 轴拉 110% 回落、再 X 轴拉 110% 回落，各 `SPAWN_SHAKE_PHASE_SECONDS = 0.12s`，叠在朝向翻转之上（`scaleX = base.x × facing × shakeX`、`scaleY = base.y × shakeY`，副本 `applyOutlineCopyScale` 跟着同拍）。触发点 = `ZCGameRenderWorld.renderUnitEntity` 的单位**首次出现**（`isBirth`）分支，与出生光柱同源。
  * **判据**：见 `tests/zcds-unit-spawn-shake.test.ts`。
* **建筑每次结束「生成单位倒计时」时，建筑模型也抖一次**（2026-10-15 加；拉伸量在 row12 中抬至 120%，详见第 9.5 节）：与上一条是**同一条曲线、换一个宿主** —— `ZCHexView.playBuildingShake(now)` 只记起点、不建 tween，`advanceBuildingShake(now)` 每帧按 `now − buildingShakeStartedAt` 反推 `ZCGameViewUtil` 的两个纯函数 `spawnShakeScaleY` / `spawnShakeScaleX`（由 `spawnShakePulse` 拼出）：**先 Y 轴回落、再 X 轴回落**，各 `SPAWN_SHAKE_PHASE_SECONDS = 0.12s`。抖动因子**乘进** `applyBuildingScale`（`scale = BUILDING_ICON_SCALE × multiplier × 抖动因子`）而不是另开一条写 `scale` 的路径 —— 否则 0.15s 一次的静态刷新会把在飞的抖动拍平（`applyBuildingScale` 是建筑缩放唯一写入口）。触发点 = `ZCGameRenderWorld.renderUnitEntity` 的 `isBirth` 分支（单位首次出现 = 倒计时结束），经 `triggerBuildingShake` **只对 `barracks` 建筑登记**（`hex?.building !== 'barracks'` 直接 return），`renderDynamic` 末尾的 `renderBuildingShakes` 逐帧推进、结束即从 `buildingShakeHexes` 摘除（`destroy()` 里 clear）。
  * **判据**：见 `tests/zcds-building-spawn-shake.test.ts`。
* **开发后「新点亮」的邻格，可开发外观延后到卡牌弹出之后**（2026-10-15 加）：需求「消耗金币点击方块后，三个新扩展的方块展示时间延迟 0.2s，等待卡牌生成动画开始播放后再展示出来」。
  * 等待窗 = `ZC_HEX_NEIGHBOR_HOLD_SECONDS = ZC_CARD_START_SECONDS + ZC_HEX_NEIGHBOR_REVEAL_DELAY_SECONDS(0.2)`（`model/ZCBattlePresentationQueue.ts`；`ZC_CARD_START_SECONDS` = 点击动画（脉冲 ∥ 缩没）= 0.7）—— 两个分句都要成立，所以从**卡牌弹出那一刻**（= 点击动画播完）起再等 0.2s。
  * ⚠️ 锚错名会让按住窗与卡牌**错拍**：去拼 `ZC_HEX_PULSE_SECONDS`（数值上眼下相等，但改点击动画时会跟漂），或领地侧的 `ZC_HEX_FLIP_SECONDS`（0.384 ⇒ 偏早 0.316s）。
  * 判定在 `view/ZCHexView.resolveDevelopableHold(now, canDevelop)`：
    * 只认 **`canDevelop` 由假变真** 的那一格（视图自己记 `lastCanDevelop`）。🔴 **不能**写成「谁挨着激活格就藏谁」：本来就可开发的邻格会被藏一遍再回来（闪一下），这条反向守卫在用例里单独钉了一条。
    * 按住期间把假值喂给 `contentSignature` / `renderTerrain` / `renderContent` ⇒ 地块图标（`iconSprite`）、价格图标（`priceIcon`）、价格数字（`iconLabel`）、中立格按玩家色的染色（`territoryTint`）**全部不出现**，与该格「点亮前」的观感一致。
    * 三态复位：`initialize` 里把 `developableHoldUntil` / `lastCanDevelop` / `developableBootstrapped` 归位（对象池会把上一局的等待窗带过来，不复位会静默吞掉这一格的第一次点亮）；首帧只记基线（`developableBootstrapped`），否则开局所有可开发格的价格牌集体迟到 0.9s（= `ZC_CARD_START_SECONDS` 0.7 + 0.2 的按住窗）。
  * **判据**：见 `tests/zcds-hex-neighbor-reveal-delay.test.ts`（常量关系 / 按住→到点恢复 / 持续可开发不闪 / 复位源码守卫）。

---

## 2. 抽到金卡的「传说卡出场横幅」（`ZCGameLegendBanner.prefab`）

抽卡有两层表现，**同一批数据、两条独立的池**（同一张金卡两样都出）：

| 维度 | 小卡牌 | 出场横幅 |
| :--- | :--- | :--- |
| **prefab** | `ui/game/ZCGameCardReveal` | `ui/game/ZCGameLegendBanner` |
| **挂哪** | `mapLayer`（跟着地块走） | `options.overlayLayer` **= HUD 根**（屏幕正中） |
| **触发** | 每次抽卡 | **只有 `tier === 4`（金 / 传说）** |
| **数据** | `model.cardReveals` | 同一份 `model.cardReveals`，渲染层筛 tier |

横幅尺寸 720×417（蓝湖「出场横幅」设计稿单组），四色底板 + 四色头像环按 `owner` 取（色相对齐 `ZC_CLIENT_COLORS`：我方蓝 / 2 号红 / 3 号黄 / 4 号紫 —— **按色相不按设计稿的组序**，因为设计稿的组序是 红蓝紫黄）。竖版几何全部是设计稿量测值，写在生成脚本 `tmp/_gen_legend_banner.mjs` 里。

**四条硬约束**（踩过任何一个都是静默失效）：

1. **横幅不能挂 `mapLayer`** —— 那是 `ScrollView` 的 content，会跟着拖动跑、还会被 `view` 的 Mask 裁掉。
2. **立绘是 256×256 的方形原图**（23 个兵种全部如此）⇒ `Role` 节点必须 `sizeMode = RAW(2)` + 锚点 `(0.5, 0)`，由视图按 `frame.height` **等比**缩放到设计稿高度 333。给它一个固定 258×333 的框会把它纵向拉伸 30%（与 `CardLineupNav` 的图标同一个坑）。
3. **CUSTOM 尺寸的 Sprite 必须 `_isTrimmedMode = false`** —— 开着时引擎会在赋值 spriteFrame 的那一刻把 `contentSize` 覆写成图的 trim 包围盒，设计稿尺寸白写。
4. **头像要圆裁**：`icons/head` 的图是方形（204×204）⇒ `Head` 上挂工程既有的 `CircleAvatar`（`assets/script/engine/CircleAvatar.ts`，shader `circle-avatar`），不要退回 `cc.Mask`。

**动画计算**：按**进度计算**（与 `ZCCardRevealView` / `ZCFloatTextView` 同一口径，不用 tween）：前 18% 从屏幕外滑入（ease-out cubic；注：2026-10-15 row11 已统一改为从左往右扇入 + Role 下落生成，详见第 9.4 节）、前 8% 顺带淡入、78% 之后整体淡出（根节点一个 `UIOpacity` 承担）。

**玩家头像异步注入**：走 `ZCGame.loadLegendPortraits()`：头像要过 head/icon 表 + `resources.load`，是异步的，而 `createGame` 是同步路径 ⇒ fire-and-forget，拿到就 `renderWorld.setLegendPortraitResolver(...)`（**晚于横幅弹出也没关系**：渲染层会连已经弹出来的横幅一起刷新，视图内 `setPortraitResolver` 会作废内容键强制重绘）。拿不到就只留四个玩家色的头像环，不阻断对局。`avatarId` 由 `ProcedureGame` 与昵称一起暂存（`ZCGame.stagePlayerAvatars`）。

* **判据**：`tests/zcds-legend-banner.test.ts`（prefab 结构与几何、八个配色帧与 `.meta` 对账、视图选色与等比缩放与曲线、解析器晚注入、渲染层只对 tier 4 弹横幅且挂 overlayLayer）+ 端到端 `tmp/_legendbanner_probe.mjs`（真引擎 55 条，含直接加载 `units/民兵/atlas/民兵-idle_0` 验等比、`icons/head` 验头像）。

---

## 3. 「冒险」领地页的职责边界（Prefab 骨架 + 三个视图 + 纯 TS Presenter）

`TerritoryPage` 曾是 1001 行的一个类：流程编排 + 坐标换算 + `box()/text()/image()/spriteButton()/stationNode()` 五个 UI 工厂（全部 `new Node` + `addComponent` 现搭）+ 手写触摸拖拽 + 两个代码搭的详情弹窗（每次重画 `destroyAllChildren` 全量重建）。2026-09-30 先把 UI 切到 prefab / 三个视图 / ScrollView；2026-10-09 再把**业务编排与状态从 Component 抽到纯 TS 的 `TerritoryPresenter`**（Passive View）。

### 3.1 职责切分表

| 关注点 | 归属 |
| :--- | :--- |
| 页面骨架、布局、Widget 对齐 | `ui/territory/TerritoryPage.prefab` |
| 滚动 / 裁剪 / 拖拽 / 惯性 / **拖动中抑制子节点点击** | `cc.ScrollView`（挂在 `MapViewport`，`content` = `MapLayer`） |
| 六边格 + 站点（按 cellId diff 复用） | `view/TerritoryMapView.ts` |
| 顶部章节信息与底部提示条 | `view/TerritoryHeaderView.ts` |
| 站点条目 | `ui/territory/TerritoryStation.prefab` + `view/TerritoryStationView.ts` |
| 站点 / 待配置据点详情 | `ui/territory/TerritorySiteDetail.prefab` + `view/TerritorySiteDetailPanel.ts` |
| 配色真源 | `view/TerritoryTheme.ts` |
| 坐标换算（纯函数、可单测） | `model/TerritoryMapLayout.ts` |
| 地图协议归一化（纯函数、可单测） | `model/TerritoryMapConfig.ts` |
| 地图 JSON 与美术加载（走 `AssetService`） | `application/TerritoryPageAssets.ts` |
| **状态与业务编排（纯 TS、可单测）** | `application/TerritoryPresenter.ts` |
| **端口适配器**：章节加载 / 本地存档 | `application/TerritoryChapterLoader.ts` / `application/TerritorySaveStoreAdapter.ts` |
| 引擎生命周期、接线、渲染编排（只剩这些） | `view/TerritoryPage.ts`（1001 → 581 → ~180 行） |

### 3.2 七条硬口径

1. **滚动容器用 `cc.ScrollView`，别手写拖拽。** 引擎的 `view` getter 是 `this._content?.parent`（`scroll-view.ts`）⇒ 把 ScrollView 挂在**带 `Mask` 的 `MapViewport`** 上、`content` 绑 `MapLayer` 即可，**不需要**再建一个名为 `view` 的子节点。`cancelInnerEvents`（默认 **true**）在拖动超过 7px 时会**给子节点补发 `TOUCH_CANCEL`** —— 这一条直接替掉了手写的 `mapDragMoved` 标记 + `scheduleOnce(clearMapDrag, 0)` 抑制，以及 `applyMapOffset` / `resetMapPosition` / `onMapTouch*` 一整块（约 50 行）。换章节回地图中心 = `scrollToOffset(Vec2.ZERO, 0)`。
2. **站点按 cellId diff 复用，禁止 `destroyAllChildren` 全量重建**：`tickProgress` 每秒都会重画一次，而地图几何**只有换章节才变**；旧实现每秒销毁重建 100+ 个格子节点。判据见端到端探针的「同一章节重复渲染复用节点实例」。
3. **HUD 定位一律用 `cc.Widget`（距顶 / 距底固定）**，不再用 `hudSize.height / 2 - N` 现算 —— 后者在长屏（可见区 1463）上会把整排 HUD 跟着屏幕中心往下带（标题会跑到 y≈639）。**2026-10-12 起没有整页 LoadingPanel**（节点与 `setLoading`/`onLoadingChange` 已删除）：进入页面 / 切章先用本地存档渲染，服务端格子状态后台合并（`loadChapter` 里 `emitStateChange` 在 `mergeServerState` 之前），加载失败只 `outputs.showTip`，不再锁屏。
4. **`@property` 的两种引用形态**（规则 105）：`{type: Node}` 的目标**就是节点本身**（没有 `.node` 字段），组件引用才走 `target.node`。写结构断言时混用会得到 `Cannot read properties of undefined`。
5. **站点解锁连线只在编辑器里有**（2026-10-01）：运行时不再画 —— `RouteLayer` 节点、`TerritoryMapView.routeGraphics`、`TerritoryTheme` 的 `line` 色已一并删除（原来按 `site.unlock.requiredCells` 整层重画，视觉太乱）。查看依赖关系改到编辑器 `tools/map-editor/territory.html` 工具栏的 **「依赖连线」勾选框**（默认勾上，只切 `g.layer-links` 的显隐，**不写进地图 JSON**）。
6. **页内只允许 Presenter 的 `onStateChange` 一个回调，不做细粒度事件、不接事件总线。** tick / 加载是确定性流程，事件总线会让监听顺序、重入、`loadId` 取消语义变隐式；全局 `FWEventCenter` 做页内刷新会跨页面泄漏（违反「不引入新的全局可变状态」）。Presenter 必须是**纯 TS**：剥掉 `import type` 后不 import `cc` / `framework` / 四个边界模块（PageAssets、CellRepository、CampaignRepository、SaveStore），所有副作用走端口（loader / gateway / store / outputs）。网络 / 存档的 fail-open 口径（离线不停战、失败不阻断、服务端状态单调合并）在 Presenter 里保持不变。
7. **建筑 / 站点落在格子的可见台面中心（2026-10-15 复核修正）**：`TerritoryMapView.cellCenter()` 返回 `{ x: point.x, y: point.y + HEX_GRID_CONTENT_LIFT }`。
   * ⚠️ **曾按「建筑坐标与格子节点坐标字面一致」把这里改成恒等映射，2026-10-15 复核时判定为错并改回。** 原因是 2.5D 地块的**可见台面中心不在节点锚点上**：底图 `img_land_01_gray` 为 130×119，逐行扫 alpha 实测**可见台面只占 y=2~91**（高 90px = `HEX_GRID_FACE_HEIGHT`），下方 28px 是侧壁；`Sprite` 锚点在整图中心 y=59 ⇒ 台面中心（46.5）比锚点**高 12.5px**。摆在锚点上恒偏下 12.5 美术px，截图逐格实测总偏差 13~23px（= 12.5 恒定项 + 逐图 trim 偏移）。
   * ⚠️ **偏移的只有「格内内容」**：格子节点在 `syncGrid` 里必须仍是 `setPosition(point.x, point.y, 0)` —— 行距 90 / 列距 92.25 与画家顺序全以它为前提。
   * ⚠️ **逐图 trim 偏移必须补偿**（`TerritoryStationView.applyIconPlacement`）：引擎 `simple.ts` / `updateVertexData` 在 `trim === false` 时用 `frame.trimmedBorder` 定位，**只保证整块画布居中、不会把 trim 后的可见区居中**。美术留白不对称时可见区就偏（实测 `territory_outpost_v1` 偏上 5px、`territory_bonus_v1` 偏上 9px）⇒ 同类建筑高低不齐。同处还按 **trim 后可见宽**归一缩放：这批美术画布有 128 与 212 两种规格，而 `Icon` 节点是 128×128 + `sizeMode=CUSTOM` ⇒ 212 的被压到 0.604，同屏大小差约 25%。
   * 🔴 归一读 `frame.rect` / `originalSize` / `offset` 是**进动态合批安全**的：合批只改 `rect.x/y` 与 `texture`（引擎 `_resetDynamicAtlasFrame` 只还原这三个）。
   * 🔴 **目标可见宽定 70，不定更大**（山猫 2026-10-15 看截图定）：可见宽 70 ⇒ 可见高 **54~63**，占地块台面高 90 的 **60~69%**，上下留出呼吸空间。早先取 100 是错的 —— 那让可见高到 78~89、**几乎与台面等高、顶满格子**，截图上读作「建筑撑满格子 / 偏下」，但根因是**尺寸不是居中**。判据里「可见高 ≤ 台面高 × 0.75」这条就是为拦住它加的（旧判据写的是 1.6 倍 ⇒ 100 顺利通过、没拦住）。
   * 判据：`tests/territory-cell-center-align.test.ts`（三层：落点 / 逐图补偿 / 可见宽度归一，数值护栏直接读 `.meta` 的 `trimX/width/offsetX` 复算，换美术图会如实变红）。⚠️ 该文件在 2026-10-15 之前**从未存在** —— 本节与 `AGENTS.md` 引用了它三处却一直没落地。
   * `HEX_GRID_CONTENT_LIFT` 在**对局侧**（`ZCHexTopGeometry` / `ZCGameViewUtil.ZC_LAND_TOP_CENTER_LIFT`）仍合法使用 —— 那条链是蜂窝顶面几何，别一起删。

### 3.3 工程细节与判据

* **手写 prefab JSON 不会触发引擎的 `@requireComponent` 自动补挂** —— 每个节点都必须自己写 `cc.UITransform`（本次 `Icon` / `CaptionBg` / `CaptionLabel` / `BadgeLabel` 四个节点都漏过，靠生成器的写盘前自检逮到）。
* 弹窗是「页面内弹层」：跟着页面一起销毁 ⇒ 不走 `PopupManager`，由页面 `instantiate(detailPrefab)` 后 `getComponent` 持有（与 `ZCSpawnSelection` 同口径）。
* 面板自己也要吞点击（`Panel` 挂一个空回调的 `cc.Button`），否则点面板会穿透到暗底把弹窗关掉。
* 资源入口由宿主注入：`MainTabHost.setAssetService(ProcedureMain.assets)`，`showPage` 时 `page.getComponent(TerritoryPage)?.initialize(assets)`（**必须在 `setParent` 之前**，那会触发页面 `onLoad`）。
* **判据**：
  * `tests/territory-map-layout.test.ts`（4 条，纯函数）
  * `tests/territory-map-config.test.ts`（14 条，协议归一化）
  * `tests/territory-page-split.test.ts`（7 条：三个 prefab 的结构与绑定 + 源码守卫「不许回流 `new Node` / `addComponent` / `resources.load` / 手写拖拽 / 业务编排」+ Presenter 纯度守卫）
  * `tests/territory-presenter.test.ts`（16 条，Presenter 加载 / 详情 / 开战 / tick / 切章 / dispose）
  * 端到端 `tmp/_territory_probe.mjs`（真引擎跑 `renderMap` / HUD / 弹窗 / 节点实例复用 / ScrollView 配置）。
  * 另：`tests/territory-page-current-json.test.ts` 与 `tests/main-tab-adventure-route.test.ts` 里那批**源码正则断言已按新真源改写**（地图渲染 → `TerritoryMapView`、布局 → `TerritoryMapLayout`、美术 → `TerritoryPageAssets`、编排与文案 → `TerritoryPresenter` / `TerritoryTexts`）—— 重构后别再回 `TerritoryPage.ts` 里找它们。

---

## 4. 其他玩家席位的视觉区分：顶点色相乘灰

同一场对局里每个席位都会看到别的席位生成的角色单位，得一眼分得清（2026-10-14）：

| 效果 | 实现 | 落到哪 | 谁负责 |
| :--- | :--- | :--- | :--- |
| 整体叠一层 `#828282` 灰 | **顶点色相乘**（`Sprite.color` / `Skeleton.color`） | 任意一种美术 | `ZCUnitView.applyVisualTint` |

**判据统一是 `owner !== 'player'`** —— 与领地染色、城墙敌我判定同一个口径，别新造「是不是我的单位」的第二种算法。

### 4.1 为什么走顶点色相乘、而不是再加一层节点

既有「阵亡灰」用的就是顶点色（`UNIT_DEAD_TINT = (135,135,135,190)`），这里沿用同一条通道：**相乘**保留原画色相、只压暗，`OTHER_PLAYER_TINT` 取 `0x82`（0.51）而不是 0（全黑），是为了还看得出体积与明暗。覆盖一层半透明灰节点看似更「直接」，代价是每单位多一个节点、且会盖掉美术的明暗层次。

三种状态用**枚举值**表达（`TINT_WHITE / TINT_OTHER_PLAYER / TINT_DEAD`），折成 `boolean` 就表达不了「其他玩家**且**阵亡」该走哪一档。**优先级：阵亡 > 其他玩家 > 原色** —— 阵亡那条 alpha 190 已经在表达「躺下」，再叠一层灰没有额外信息。

⚠️ 写色必须带 `else`（`if (sprite) … else if (skeleton) …`）。序列帧单位有 `Sprite`、spine 单位有 `Skeleton`，二者互斥；只写 `if (sprite)` 不带 `else` 时 **spine 单位永远不变色** —— 不报错、逻辑也没问题，纯表现缺失，靠人眼很容易当成「美术本来就这样」。

### 4.2 回归护栏

* `tests/zcds-unit-view-render.test.ts` 里那条「静止帧不重复写」的用例同步更新了顶点色写入次数（切阵营 +1、阵亡再 +1）。

---

## 5. 自选主城（选择基地模式）：World 层表现 + 跟随基地的确认按钮

钉钉表「demo 体验反馈」的【战斗系统】选择基地模式（2026-10-14）。**它不是新玩法**：`cityMode: 'select'` 的自选主城流程（`ZCSpawnSelection` 状态机 + `ZCSpawnSelectionView` 常驻 HUD）本来就跑通了倒计时 / 半区限制 / AI 自动确认，需求只是给这段流程补上「看得见基地、看得见邻格、点得到确认」。所以落地口径是**沿用既有 select 开关，只改 world 层的表现**，没有新增 `cityMode`、也没有第二套选点状态机。

| 需求 | 落点 |
| :--- | :--- |
| 进入即展示基地模型 | `ZCHexView.renderSpawnSelection` 画 `hq` → `hq-base`（与正式对局同源）+ `defaultHexFor` 预置落点 |
| 基地相邻 6 格深蓝高亮 | `ZCHexView.SPAWN_BASE_NEIGHBOR_FILL`（`#1D24C8`，alpha 170），由 `homeHighlight` 触发 |
| 基地正下方 2 格的绿色【确认位置】按钮 | **复用** `ZCSpawnSelection.prefab/ConfirmSpawn`（绿勾），`ZCGame.borrowSpawnConfirmButton()` 借出改挂 `mapLayer`，位置走 `spawnBaseConfirmPoint()` |
| 点其他格 = 移动基地（不确认） | `ZCGame.onHexClick` → `selection.select('player', hexId)`（既有路径，未改） |
| 点【确认位置】= 退出并收掉高亮 | 按钮点击仍由 `ZCSpawnSelectionView` 接到 `actions.confirm()` → `ZCGame.confirmSpawnSelection()` |

### 5.1 默认落点必须预置给玩家、且退路必须确定

需求 1 的「在该位置展示基地建筑模型」在此之前**做不到** —— 玩家进选点阶段时 `selectedHexId` 是 `null`，基地与邻格都无从画起。解法是把默认落点写进构造期（`ZCSpawnSelection.defaultHexFor`）：优先取地图声明的默认主城（`map.homes[0]`，即 `{row,column}` 翻出来的格子 id），不合法（虚空 / 别人半区 / 贴着已确认主城）才退到 `legalHexes()[0]`。

⚠️ **只预置玩家，不预置 AI**；而且要保证这条路径**一次随机源都不消耗**。整个选点阶段只有调用方注入的那一条随机源（种子可复现「选点 + 正式对局」），构造期多摇一次，AI 的确认时机与资源点抽取的次序就整体错开（表现是「换个默认落点，资源就变了」这种极难归因的漂移）。判据：构造期消耗次数恒等于 `owners.length - 1`（每个 AI 一次确认延时）。

### 5.2 「1 个格子单位」= 行距，不是列距

需求写「按钮与基地之间保持 2 个格子单位的间距」。棋盘有两套格距（`HEX_GRID_VIEW_ROW_SPACING = 90` / `HEX_GRID_VIEW_COLUMN_SPACING = 92.25`），**「正下方」是同列方向 ⇒ 只能乘行距**。列距是斜邻居的横向分量，拿它算 y 偏移会让同一个「2」在别的口径下对不上。

偏移取**中心到中心**（`spawnBaseConfirmPoint`，`SPAWN_BASE_CONFIRM_ROW_OFFSET = 2`），不是「基地底边到按钮顶边」：基地是按卡面尺寸换图的 Sprite，按边距算就得先知道它此刻多高，基地一换外观按钮就跳；中心距与外观无关。

### 5.3 深蓝高亮的 alpha 与优先级

`#1D24C8` 没有按十六进制原样 100% 不透明使用，取 alpha 170：那 6 格若整块实心，地块贴图被盖没后会读成「凭空多出 6 块蓝板」而不是「基地周围这 6 格被点亮了」，也与全篇「领地填充 60% 透明度」的口径不一致（170 比领地的 150 略实一档，与普通半区色拉开「这是高亮」的差别）。深蓝**不是玩家色**（`zcFactionColor('player')`），否则「高亮」与「己方半区」看起来一样。

优先级：**基地邻格高亮 > 受阻红 > 半区 / 中立色**。高亮压过受阻色是有意的 —— 需求把「基地周围 6 格」定义成一律高亮，而受阻这件事仍由格面上的 `×` 文案表达，不必再借底色说第二遍。

高亮**只给我方**（`selection.baseNeighborIds('player')`）。旧实现是「任何一方的已选 / 已确认主城邻格都归属到该方染色」（`isHomeNeighbor`），三方同为深蓝会分不清是谁的圈，已下线；`homeNeighborOwner` 那一份保留下来**只管领地底色与轮廓**。

### 5.4 确认按钮复用 HUD 那颗绿勾，不新造一颗（2026-10-15 改）

第一版是手画一颗 `ui/game/ZCSpawnBaseConfirm.prefab`（`cc.Graphics` 画亮绿圆角底板 + `cc.Label` 写「确认位置」），**已删除**，改成复用选点 HUD 里现成的 `ConfirmSpawn`（`btn_gou.png` 绿勾，实测主色 `#5ED545`）。

理由是**两颗按钮必然长出两套判据**：`ZCSpawnSelectionView` 已经管着这颗绿勾的全部语义 —— 按选点合法性染色（`CONFIRM_INVALID / READY / IDLE`）、「等待其他玩家」期间 `active = false`、`TOUCH_END` 接到 `actions.confirm()`。另起一颗就得把这三件事抄一遍，抄漏任何一条的表现都是「按钮的颜色/显隐跟实际能不能确认对不上」，而且不报错。（当初手画也有个技术理由：Sprite 是**相乘**染色，仓库唯一通用按钮底 `btn_01.png` 是深灰 `#404256`，乘任何绿都压成脏绿 —— 但用现成的绿勾图就绕开了这条路，不必为此再造一颗按钮。）

借用的实现是 `ZCGame.borrowSpawnConfirmButton()` / `restoreSpawnConfirmButton()`，三条不能省的细节：

1. **必须关掉它自带的 `cc.Widget`**。绿勾在选点 HUD 里靠 Widget 钉在屏幕底部（`_alignFlags = 20`、`_horizontalCenter = 28`、`_bottom = 200`）；换父级到棋盘层后 Widget 仍会每帧按这套规则把它拽回原位，跟逐帧写的基地坐标互相打架 —— 表现为按钮卡在屏幕底部纹丝不动，而坐标每帧都写对了。
2. **归还必须在 `spawnSelectionView.node.destroy()` 之前**。按钮此刻挂在棋盘层，不送回原父级它就不会随选点 HUD 一起销毁，会永久留在地图上；归还时要把 parent / 兄弟序 / 坐标 / Widget 全部还原。
3. **原父级已经没了就直接销毁**。对局被强制拆掉时（`shutdown`）原父级可能先失效，此时不能 `setParent`，否则按钮失去归宿留在棋盘上。

### 5.5 按钮挂世界层，不挂 HUD 层

绿勾被借出后改挂 `hudView.mapLayer`，坐标就是棋盘层局部坐标 —— 基地与地块都用 `mapToViewX/Y`，同层同缩放 ⇒「下方 2 格」在世界坐标里恒成立，不需要任何坐标换算；整盘拉远时按钮与基地一起缩，长宽比不失真，拖动棋盘时也跟着基地走。这也是工程既有口径（单位 / 卡牌 / 飘字同样挂 `mapLayer`），**只有需要钉在屏幕上的东西才挂 HUD 根**（例如传说卡横幅，见第 2 节）。

清理必须显式：按钮借出后不属于任何会自动销毁的容器，`ZCGame.restoreSpawnConfirmButton()` 在**选点结束**与**退出对局**两条路径都要调，并顺手把世界层里的引用置 `null`（`Node.destroy()` 当帧 `isValid` 仍为 `true`，不置空会多写一帧坐标到正在销毁的节点上）。

### 5.6 高亮 / 按钮的显示判据是 `isPlacing`，不是 `finished`

玩家点了【确认位置】只是**我方**落定；整体阶段要等我方与 AI 都确认才 `finished`（`ZC_SPAWN_COMPRESSED_SECONDS` 把窗口压到 3s + AI 1s 后跟随）。需求 4 要的是「点完就收掉高亮与按钮」，所以判据用 `ZCSpawnSelection.isPlacing('player')`（`confirmedHexId === null && selectedHexId !== null && !completed`）。用 `finished` 会让高亮与按钮在「等待其他玩家」那几秒里继续亮着。落点本身**不清空**（结算要用）。

### 5.7 回归护栏

* `tests/zcds-spawn-base-confirm.test.ts`（12 条）逐条钉上述口径：构造期随机源消耗次数 / 默认落点 / 邻格集合取自 `baseNeighborIds` / 点格子只移动不确认 / `isPlacing` 与 `finished` 的差别 / 偏移量 = 行距 × 2 / 深蓝填充与优先级 / **借出（改挂 `mapLayer` + 关 Widget + 记原位）与归还（还原父级 / 兄弟序 / 坐标 / Widget，原父级失效则销毁）** / 绿勾节点就是 `ConfirmSpawn`（`btn_gou.png`） / 以及「没有第二套按钮 prefab、染色与点击仍只归 `ZCSpawnSelectionView`、归还早于销毁 HUD」的接线守卫。

---

## 6. 战斗飘字「快进慢出」：前 45% 入场，后 55% 淡出

需求原文：**前 35% 时长内快速完成入场（位移 + 缩放），后 65% 时长内缓慢淡出，整体动画的总时长保持不变**；2026-10-15 追加两条微调：**入场占比 35% → 45%**、**慢出段收尾漂移 3~5px → 5~10px（取 7）**。

### 6.1 总时长守恒与单旋钮曲线

第一条要守住的是**总时长不变**：改的是曲线怎么分配这段时间，不是 `FLOAT_TEXT_DAMAGE_SECONDS = 0.85` / `FLOAT_TEXT_GOLD_SECONDS = 1.1`。飘字是按 `startedAt / durationSeconds` **逐帧重算**的（和 `ZCHexView` / `ZCCardRevealView` 同口径，切流程 / 暂停不留补间），所以只要不动 `durationSeconds`，时长就自动守恒 —— 反过来，一旦有人去调那两个常量来「让淡出更慢」，就等于把整条飘字拖长，节拍会跟战斗结算错开。

**一个旋钮管两端**（`ZCFloatTextView.entranceProgress`，缺省取自 `ZCGameViewUtil.FLOAT_TEXT_ENTRANCE_PROGRESS = 0.45`）：

> **为什么 35% → 45%**：35% 时入场太急，位移「唰」一下就走完了，读不出数字是**从目标头顶飘出来**的。放宽到 45% 后，入场仍是少数派（慢出仍占 55%），「快进 / 慢出」的定性没变 —— 这也是上限：一旦超过 50%，「入场」就比「淡出」还长，名字就不成立了。

* `floatTextEntrance(progress, entranceProgress)` —— 入场段把 `progress / entranceProgress` 喂给 easeOutCubic（`1 - (1-k)³`：起步最快、末段收稳，这就是「快进」的手感来源），**之后恒 1**；
* `floatTextFade(progress, entranceProgress)` —— 入场段**恒 1**（数字还在「进」的时候不该同时变淡），之后在剩下的时长里**线性**淡到 0。「慢出」要的是匀速地慢慢消失，这里再叠一层 easing 会让中段忽快忽慢、反而显脏；
* `floatTextDrift(progress, entranceProgress)` —— 入场段恒 `0`，之后 easeOutQuad 推到 1，乘 `driftDistance`（5~10px，取 7）就是慢出段的收尾漂移。

早先是**两个不挨着的数**：代码常量 `POP_PROGRESS = 0.3` 管缩放、`fadeStartProgress = 0.55` 管淡出，中间那 0.25 段数字**既不动也不淡**，读起来是「卡了一下才消失」—— 这是本次改动真正要解决的手感问题。合并成一个之后，进到位的那一刻正是开始淡出的那一刻。

两条曲线都是 `ZCGameViewUtil` 里的**纯函数**，视图只做调用：用例（尤其 `tests/zcds-progress.test.ts`）一律**转发真模块**取值，不在桩里再实现一遍 —— 在桩里复制一份等于把「快进慢出」写成两份，源码改了用例还照样绿。

🔴 **位移 / 缩放 / 图标自转一律喂 `enter`，不是整条 `progress`**：
* 散落（`spreadProgress`）、下坠、摇摆、金币上浮 —— 换成 `progress` 数字会飘满整条时长，看着是「一直在飘」而不是「进场」，而且慢速位移会一直抢走淡出的注意力；
* 金币图标自转（`renderGoldIcon(enter, fade)`）—— 上浮收进前 45% 后，自转若还铺满整条时长，就会变成「数字已经停住、金币还在旁边自己转」。

⚠️ `entranceProgress` 是 `@property`，`ZCGameFloatText.prefab` 上**序列化了一份 0.45**（`driftDistance` 同理，7）。改缺省值必须同步 prefab 那份，否则面板值把代码缺省顶掉，改了像没改。

### 6.2 慢出段带 5~10px 的同向收尾漂移（`floatTextDrift` + `driftDistance = 7`）

入场一结束如果只是「静止着淡出」，读起来是**贴图卡在那儿被调透明度**，而不是飘走。所以慢出段沿**入场的方向**再走 7px：伤害继续下沉、金币继续上飘，两者同量反向。

> **为什么 4 → 7**：4px 在 720×1280 上太含蓄，慢出那 55% 里几乎看不出在动，惯性收尾的感觉没出来。7px 能看见「还在飘」，又不至于抢淡出的戏。

* 曲线是 easeOutQuad `u(2-u)`：起步还带着一点入场剩下的惯性、越往后越慢，最后几乎停住 —— 半程走完约 3/4，后半程只挪 1~2px。
* 入场段恒 `0`：那段位移归 `floatTextEntrance`，两段叠加会互相打架（表现为入场末段突然加速 / 顿一下）。
* 🔴 **幅度压在 5~10px**。这里的位移只负责「别显得死掉」，几十像素就会跟淡出抢注意力，变回「一直在飘」—— 那等于把刚做的快进慢出又退回去。用例里直接断言了 `5 ≤ driftDistance ≤ 10`。

### 6.3 回归护栏

* `tests/zcds-float-text-gold-icon.test.ts`（5 条）钉图标侧：只有 `gold` 显示 / 按文字宽度定位 / **入场段内转满一圈、之后停住**（半程 `→ 315°`、`入场段末 → 360°`，之后仍是 360°）/ 淡出与数字同步。
* `tests/zcds-progress.test.ts` 钉曲线侧，两条：
  * 「Old Client 战斗飘字按轨道下落，金币保持上浮」—— 入场占比与常量同源且 **< 50%**、**半程已过半**（easeOutCubic 的判据）、入场段一结束下坠就走满、慢出段中点约半透明、末帧归 0 并隐藏；
  * 「慢出段带 5~10px 同向收尾漂移」—— 幅度落在 5~10px、入场段**零漂移**、伤害下沉 / 金币上飘各正好 `driftDistance`、以及**递减收尾**（半程过半、后半程比前半程走得少）。
* ⚠️ 用例里的时间点**一律从 `entranceProgress` 推，不写死 0.45 / 0.55**：这次把 35% 改成 45% 时，写死的 `t=0.175/0.35` 全都要跟着改一遍。同理「淡出段中点 = 128」这类取整值也不能写死 —— `255 × 0.5` 会随浮点尾数在 127/128 之间跳，期望值要按真曲线算，且用**与视图同一条 progress 表达式**（`(10 + x) - 10` 与直接算 `x` 差 1 ulp）。

---

## 7. 开局归属扩散波：归属格直接切换、中立格逐个替换

需求原文（`row15`，2026-10-15 改口径）：**「开局归属扩散波动画优化。如图例，红色框，归属格子的颜色直接切换；绿色框，中立格子的颜色则是逐个替换，以玩家基地为圆心，圆形的扩散替换，替换的速度越来越快，范围越来越大」**。

拆开就是两条互不重叠的口径，实现里也是两条独立的分支：

| 图例 | 那一格是什么 | 表现 |
| :--- | :--- | :--- |
| 🔴 红框 | **开局就归属**的格（主城 + 其 6 邻格） | **不入波**，走常规渲染**一帧直接到位** |
| 🟢 绿框 | 半区里的**中立格** | 进波：起点 = 该格选点阶段铺的**半区色**，终点 = 战斗**底色** |

之前的实现把红框那 14 格也塞进了波里（先压成中立观感、再逐个淡入归属色），读起来像「归属还在推进」—— 正是这一版要修掉的东西。现在 `buildClaimWavePlan` 的过滤条件是 `ownerOf(hexId) === 'neutral' && sectionOwnerOf(hexId) === 主城方`：归属格无论在哪一侧都不入表。

三个旋钮口径（2026-10-15 确认）：**只在自选主城局**（`cityMode: 'select'`）触发；**每格 0.1s** 快速过渡；「越来越快」= 相邻快照的时间间隔**单调递减**；**两座主城各自为圆心**（两侧同拍，不是一条波扫全盘）。

### 7.1 覆盖范围：每个半区里的全部中立可通行格

`select_river`（20×11 = 220 格，14 格开局归属）实测：波从 **14 格 → 152 格**（两侧各 **76** 格），也就是半场里除归属格以外的**每一个**可通行格都在表里。三条排除规则（都在 `buildClaimWavePlan` 的过滤里）：

* `ownerOf !== 'neutral'` ⇒ 归属格，一帧到位（红框）；
* `sectionOwnerOf !== 主城方` ⇒ **别的半区**归那座主城自己的波管，这边不许碰（否则一条波会跨过半场去染对方的色）；
* `playable === false` ⇒ 虚空格没有地块视图、也铺不到半区色，进表只会白占一个名次、把波前的节拍拉稀。

### 7.2 触发范围：只在自选主城局

唯一的调用点是 `ZCGame.finishSpawnSelection` —— 它是**自选主城（选择基地）模式专有**的收尾函数，由 `ProcedureManager` / `tick` 在 `spawnSelection.snapshot.finished` 时走到（见第 5 节）。固定主城图走的是 `startSpawnSelection` 之外的另一条路，压根不经过这里，所以「只在自选主城局」是**结构上的必然**，不需要再写一个 `cityMode === 'select'` 的分支去守 —— 那种分支反而会漏掉未来新增的入口。若哪天要在固定主城局也播，应显式在它的建局路径上再调一次 `startTerritoryClaimWave`，而不是放宽这个函数的调用条件。

### 7.3 顺序：先整盘渲染，再压回半区色

```ts
this.model = new ZCGameModel(null, this.matchRandom, matchConfig);
this.renderWorld.render(this.model);                          // ① 按真实归属画一遍
this.renderWorld.startTerritoryClaimWave(this.model, selection); // ② 再起波把中立格压回「半区色」
```

**这个顺序不能反。** 归属格不在波里（红框那条），它们的底色**只**由这一次 `render` 画出来 —— 波起手只写它要染的那 152 格。所以必须先渲染：让那 14 格拿到归属色、也让共享领地轮廓按战斗态重画一次。反过来（先起波再渲染）虽然波里的格不受影响（`territoryTint` 让两条路径算出同一个颜色），但那 14 格会停在选点阶段的深蓝高亮上，一直等到下一次 0.15s 的静态刷新才补上。`start()` 的内部逻辑是：建时间表 → **立刻把所有要染的格写到进度 0**（`forEach` 里 `write(hexId, entry, 0)`）→ 此后每帧只往上推。

⚠️ 第二个参数 `selection` 必须是**局部引用**：`finishSpawnSelection` 前面已经把 `this.spawnSelection` 置空了，而波要拿它查「这一格属于哪个半区」（见下）。置空之后再读 `this.spawnSelection` 会拿到 `null`。

### 7.4 半区口径只有一处，终点色三处同源

两个容易长出「第二份口径」的地方，都钉死了单一来源：

* **半区**（起点色）—— 只认 `ZCSpawnSelection.regionOwnerOf`（地图画了分区就用地图的，没画按 `defaultZCSectionAt` 推导）。渲染层不自己拼分区表，只在 `startTerritoryClaimWave` 里把它包成一个回调；
* **战斗底色**（终点色）—— 只认 `ZCGameViewUtil.territoryTintOwner(owner, canDevelop)`：「中立格且这一拍可开发 ⇒ 按可开发方（玩家）染色，其余按真实归属」。三个调用点必须同源，否则同一格会出现「底图一个色、领地轮廓另一个色」：`ZCHexView.territoryTint`（地块底图）、`ZCGameRenderWorld.renderHexSystem`（轮廓）、波的 `tintOwnerOf`（终点色）。
  * 实测开局那一刻全部中立格都还不可开发（状态是 `occupiable`，`canDevelopFor` 直接返回 `false`），所以 152 格的终点色事实上全是中立观感；走同一个函数是为了**万一**已经可开发时不会在收工那一帧跳色。
  * ⚠️ 唯一的小缝：选点阶段被标成「受阻红」的格（只可能是贴着敌方主城 2 格内的己方半区格）在选点界面是另一种红，而波按**半区色**起手，那几格会有一次换色。数量极少，且旧实现同样会闪（红 → 中立），未处理。

### 7.5 为什么是纯表现层

和 `ZCVictorySweep`（胜利扫场）完全同形：**只写地块视图的临时覆盖色，绝不回写模型**。没有「逐格占领」的模型过程 —— 归属是一个已经发生的事实，动画只决定它**何时**显示出来。快照、战报、领地统计任何时候读到的都是「已经归属」，不会读到中间态。波结束后 `ZCClaimWave.clear()` 把所有覆盖清成 `null`，交还给常规渲染路径（`canDevelop`、领地面板高亮等旁路只在常规路径里才算得对，覆盖一直挂着会把这些旁路遮住）。

### 7.6 时间表：BFS 分层 + 同环按极角 + 幂次加速

三条规则都在 `ZCGameViewUtil.buildClaimWavePlan`（纯函数，可单测）：

1. **BFS 距离分层** —— 从主城出发做广度优先，`distance` 就是环号。波前天然由主城向外推。
2. **同环内按极角排序** —— 同一环的格到主城距离相等，BFS 摆平后顺序不稳定。用 `atan2(y − 主城y, x − 主城x)` 把它们绕主城排一圈，读起来才有「以主城为圆心扩散」的方向感。
   * ⚠️ **`atan2` 的值域是 (−π, π]，不是 [0, 2π)**。180° 那一支返回的是 `+π`，是**最大**角而不是最小角。写排序期望时若按「0° 起、顺时针、180° 收」的直觉列，会得到相反的环内顺序。`tests/zcds-territory-claim-wave.test.ts` 里有一条断言把这个顺序钉死了（`240° → 300° → 0° → 60° → 120° → 180°`），是刻意留的「防写反」备注。
3. **名次 → 时刻用幂次加速** —— 每座主城**各排各的**（名次在自己的表里重新从 0 起），归一化成 `r = rank / (总数 − 1)`，到达时刻 `= ZC_CLAIM_WAVE_SECONDS × r^ZC_CLAIM_WAVE_ACCEL_POWER`。`POWER = 0.65 < 1` ⇒ `r^k` 在 `k<1` 时导数递减，即**相邻间隔单调递减**：名次越靠后、相邻两格之间的时间差越小，视觉上就是「越来越快」。纯函数的换算表：

| 名次 r | 到达时刻 (s) | 相邻间隔 (s) |
| :--- | :--- | :--- |
| 0（离主城最近的中立格） | 0 | — |
| 0.2 | 0.351 | 0.351 |
| 0.4 | 0.551 | 0.200 |
| 0.6 | 0.717 | 0.166 |
| 0.8 | 0.865 | 0.148 |
| 1.0 | 1.000 | 0.135 |

`select_river` 每侧 76 格 ⇒ 实际首间隔 `(1/75)^0.65 ≈ 60ms`、末间隔 `1 − (74/75)^0.65 ≈ 8.7ms`，整段 1.0s 里间隔单调收窄 7 倍。若 `POWER > 1` 会反过来变成「先慢后快、越往后越顿」，与需求相反。

> 名次 0 是**离主城最近的中立格**，不是主城自己 —— 主城与其 6 邻格都是归属格、不入表，所以最内环实际是「邻格的邻格」（`select_river` 上就是环 2）。主城那块刚切完，波立马从它边上开吃。

### 7.7 每格的 0.1s 换色过渡与 `renderDynamic` 挂载

到达时刻只决定「**这一格什么时候开始**换」，换本身占 `ZC_CLAIM_WAVE_FADE_SECONDS = 0.1s`：`claimWaveProgress(now, startSeconds, startedAt)` 把 `now − startedAt − startSeconds` 除以 0.1 并 clamp 到 `[0, 1]`，`ZCHexView.claimWaveTint(from, to, progress)` 再在**两个端点色之间**按通道线性插值（`Color` 逐分量 lerp）。

两端都用 `territoryFill()` 算 ⇒ 与常规渲染**逐位一致**：
* `progress ≤ 0` 返回的就是选点界面那个半区色 ⇒ 起手那一帧不闪；
* `progress ≥ 1` 返回的就是战斗底色（含 `territoryTintOwner` 那条可开发分支）⇒ 收工那一帧不跳。`from === to` 的格（半区色恰好等于战斗底色的可开发中立格）整段恒色，不会被波「洗」一次。

**挂载：必须走 `renderDynamic`**。`ZCGameRenderWorld.renderDynamic` 末尾调 `renderTerritoryClaimWave(model)`，内部 `claimWave.advance(visualTime(model))`。**不能挂 `renderStatic`**：静态层节流 0.15s（≈6.7fps），而换色过渡只有 0.1s —— 会被节流直接压成一帧硬切，「逐格过渡」的观感整个没了。

### 7.8 唯一绕过 `contentSignature` 闸门的着色入口

`ZCHexView` 的静态渲染整块受 `contentSignature()` 闸门保护：视觉字段拼成一个指纹，指纹不变就**跳过整块渲染**。扩散波改的明明是**颜色**，但颜色没进指纹 —— 走常规入口的话，波推进时指纹不变、整块被跳过，格子颜色纹丝不动。所以 `setClaimWave({ from, to, progress })` **直接写** `terrainTintColor` / `applyGroundGlowTint` / `tileSprite.color`，**绕开闸门**（这一点在 `ZCHexView` 里写成了显式注释，免得后人「顺手统一」回闸门后面）。参数收一个**可空对象**而不是位置参数：`null` = 收工这个语义只能有一种写法，`(from, to, progress)` 三个位置参数容易写出「只传了 from」的半截调用。

🔴 收工的 `null` 分支要**清空 `contentKey`**（`this.contentKey = ''`）：清覆盖后颜色会变回常规值，但常规渲染若以为「上一帧画过、这帧不用重画」就直接跳过，格子会**卡在过渡色的最后一帧**。清掉指纹强制下一帧重画一次，颜色才落回归属色。

### 7.9 生命周期、性能与回归护栏

* `ZCClaimWave.start` **幂等**（已在播时忽略），返回 `false` = 这一盘没有要染的格（没有主城 / 主城全是中立 / 半区查不到），调用方不必等；
* `advance(now)` 返回 `true` = 还在播；全部到 1 时**自动 `clear()`** 并返回 `false`，不需要外部额外收尾；
* `write()` 内部按 `written: Map<hexId, progress>` **跳过没变化的格**（`Sprite.color` 每次赋值都会标脏重绘）。这一条在半场规模下才真正吃紧：`select_river` 每侧 76 格 × 每格约 7 次进度变化 ≈ 500 次写入，不闸住就是每帧 152 次重绘；
* 重开一局 / 退出对局必须 `clearTerritoryClaimWave()`（`ZCGame.destroy` 里调），否则下一局的格子会带着上一局中途的过渡色出场；
* 进度一律按 `now − startedAt` 反推（`now` 来自 `ZCGameRenderWorld.visualTime`），**不用 `dt` 累加** —— 暂停 / 切后台 / 掉帧都不会让波前跑偏，也不需要额外的「暂停时停表」处理（与 `ZCHexView` / `ZCCardRevealView` 同口径）。
* **回归护栏**：`tests/zcds-territory-claim-wave.test.ts`（17 条）钉：**归属格不入波**（红框那条）/ 只收本半区的中立格（别的半区、无半区、虚空格一律不收）/ **环内极角升序**（含防写反的顺序断言）与**间隔单调递减** / 名次 0 在 0s、最外圈正好 `ZC_CLAIM_WAVE_SECONDS` / 空盘（无主城 / 半区对不上）返回空表 / `territoryTintOwner` 的四种组合 / 终点色走 `tintOwnerOf` / `claimWaveProgress` 的 clamp / 真图 `select_river` = **152 格（两侧各 76）**、14 格归属格一个都不在表里、左右逐格同时刻 / `ZCHexView.setClaimWave` 在 0 / 0.5 / 1 三点的颜色（含两端同色恒色）/ **静态渲染不会把波的颜色冲掉** / `ZCClaimWave` 生命周期（`start` 只写中立格且落到半区色、`advance` 推进、播完自动写 `null`、`clear` 幂等）/ `renderDynamic` 的挂载守卫 / `ZCGame.finishSpawnSelection` 里「先 render 后起波 + 把 `selection` 一起传下去」的顺序守卫 / **半区口径只有一处、终点色三处同源**的接线守卫。

---

## 8. 脉冲水波纹的「黑边」：专用着色器 `shaders/hex-pulse.effect`

需求（row13 第 1 条，2026-10-15）：「脉冲效果的**边缘颜色与整体颜色保持相近色系，更亮一点**（现在是黑色的）」。

### 8.1 病因：灰度帧 + 乘性染色

美术的脉冲帧 `image/effects/hex_pulse/fkz_*.png` 是**灰度**图 —— 填充 `(255,255,255)`、外圈边缘 `(117,117,117)`，**两者 alpha 相同**（用 PIL 逐像素统计看过，不是猜的）。Cocos 的 `Sprite.color` 是**乘性**的：`out = tex × color`。于是：

| 部位 | 贴图亮度 | 染色后（`#888CFF`） | 观感 |
| :--- | :--- | :--- | :--- |
| 填充 | 255 → 100% | `#888CFF` | 正常蓝紫 |
| 边缘 | 117 → 45.9% | `#3E4075` | **近黑** |

**结论：纯乘性染色在数学上做不到「边缘变亮而填充不变」** —— 那要求给颜色乘 > 2 的系数，填充会连带过曝 / 掉饱和。所以必须换着色器，不能靠调 `Sprite.color` 解决。

### 8.2 方案：保底乘（floor-preserving multiply）

`assets/resources/shaders/hex-pulse.effect`：

```glsl
uniform HexPulse { vec4 pulseParams; };   // pulseParams.x = 边缘保底亮度，默认 0.72（见 properties）

vec4 frag () {
  vec2 uv = frameUV;
  #if SAMPLE_FROM_RT
    CC_HANDLE_RT_SAMPLE_FLIP(uv);
  #endif
  vec4 tex = CCSampleWithAlphaSeparated(cc_spriteTexture, uv);
  float lum = clamp(max(max(tex.r, tex.g), tex.b), 0.0, 1.0);
  float k = mix(clamp(pulseParams.x, 0.0, 1.0), 1.0, lum);
  return vec4(tex.rgb * k, tex.a) * color;
}
```

* `lum = max(tex.rgb)` —— 灰度帧的「亮度」就是灰度值本身，不用加权求和（避免把纯色边读歪）。
* `k = mix(floor, 1, lum)` —— 暗部抬到 `floor`，亮部保持 `1`。
* 填充 `lum = 1 ⇒ k = 1` ⇒ `tex × color` **与内置 Sprite shader 逐像素等价**，所以**不会**动到原本正常的填充色（这是选这个正交设计的唯一理由）。
* 边缘 `lum ≈ 0.459 ⇒ k = 0.72 + 0.28 × 0.459 ≈ 0.85` ⇒ 边缘从 45.9% 抬到约 85%，与填充同色系、只是略暗 ⇒ 读作「一圈亮边」而不是黑边（兵营色下由 `#3E4075` 提到 `#7377D9`）。
* `pulseParams.x = 0` ⇒ `k = lum`，即**回到旧的纯乘法观感** —— 这是回退开关。别把它当可随便调的「强度」旋钮：改大 → 边缘趋同填充（波纹轮廓消失）；改小 → 退回黑边。观感不对时先调它，而不是去改 `ZCHexView.applyPulseRipple` 的染色逻辑。
* ⚠️ 参数用 `vec4` 而不是裸 `float`：与项目其余 sprite 着色器同口径，避开 UBO 对齐差异。

### 8.3 材质只挂脉冲段（`ZCHexView.applyPulseMaterial`）

`GroundGlow` 这个中间层节点与**底光的序列帧共用**（见第 1.3 节）。若整段挂着这个材质，底光那条老路径也会被一起抬亮 ⇒ 观感全变。所以材质**只覆盖脉冲分支**：

```ts
private applyActivationFx(fx: IZCHexActivationFx): void {
    // …脉冲分支里：
    this.applyPulseMaterial(true);
    // 其余所有分支（隐藏 / 卡牌淡出 / idle）：
    this.applyPulseMaterial(false);
}
```

`applyPulseMaterial` 里用 `pulseMaterialApplied` 去重 —— 每帧都调，重复写 `customMaterial` 会让引擎反复重建材质槽（且 `initialize()` 会把它清回 `pulseMaterialApplied = false`，这正是对象池复用要的：上一局的材质不能带过来）。

### 8.4 接线链（无 `*.mtl` 文件，材质运行时构建）

```text
assets/resources/shaders/hex-pulse.effect          ← 唯一真源（+ .meta 声明为 effect 资源）
  └─ ZCGameLoader.loadHexPulseMaterial()
       assets.load('shaders/hex-pulse', EffectAsset)
       → new Material(); initialize({ effectAsset })
  └─ ZCGamePreparedResources.hexPulseMaterial
  └─ ZCGame（createGameWorld 时透传）
  └─ ZCGameRenderWorld({ hexPulseMaterial })
  └─ ZCHexView.setHexPulseMaterial(material)
```

⚠️ `assets.load` 的路径**不带扩展名**也不要前导 `assets/resources/`（与 `loadWallMaterial` / `loadUnitOutlineCopyEffect` 同一惯例）。加载失败只 `console.warn` 并落回 `null`（视图侧 `want && !!this.pulseMaterial` 会拦住），**不许抛** —— 序列帧仍在，黑边只是观感退化，不该让对局起不来。

### 8.5 回归护栏

`tests/zcds-hex-activation.test.ts` 的「脉冲黑边靠专用着色器抬亮」那条。着色器的 GLSL 无法在 node 里跑，所以它只钉**算式与接线**（都已先剥注释，避免「注释里也写了同一段」导致假绿）：

* **effect**：`lum = max(tex.rgb)` 与 `k = mix(clamp(pulseParams.x, 0, 1), 1, lum)` 两行**逐字**在（前者保证亮度口径不被改成加权和，后者是「填充恒等映射」的判别式）、`properties` 里 `pulseParams: { value: [0.72, 0, 0, 0] }`、且**不许**出现 `exp(-abs(`（领地那套转轴亮带）。
* **视图**：`setHexPulseMaterial` 入口在、`applyPulseMaterial(true)` 与 `applyPulseMaterial(false)` 成对出现、`pulseMaterialApplied` 去重字段在。
* **加载链**：`HEX_PULSE_EFFECT_URL = 'shaders/hex-pulse'`、`loadHexPulseMaterial`、`material.initialize({ effectAsset })`、`ZCGame` 的 `hexPulseMaterial: prepared.hexPulseMaterial`、渲染层的 `setHexPulseMaterial(this.options.hexPulseMaterial …)`。
* ⚠️ 真正「边缘变亮了没有」只能人眼在编辑器里看 —— 单测钉的是**接线没被拆掉**，不是画面效果。

---

## 9. 体验反馈专项（row8~row13）：结算扫场 / 描边同步 / 金矿提示 / 横幅扇入 / 产金抖动

这一批六条需求（2026-10-15）有两组共用机制，所以放在同一节：row12 + row13 是同一条「建筑抖动」，row9 与 row6 是同一条「按住窗」的两个侧面。

### 9.1 row8 胜利结算填充动画：深色铺场（带闪烁）→ 从起始点回正

需求原文：*「用和阵营颜色一致、但饱和度更深的颜色填充格子，**其他玩家从最上方的格子往下填充，玩家自己依旧是从下方往上填充**；深色格子**即将**完成全部填充时，再从**起始点**开始逐渐过渡到对应阵营的当前颜色」*。

2026-10-16 追加两条：
1. *「铺场的颜色格子会闪烁，颜色在同色系偏白色的范围内快速变化」*
2. *「回正动画播放时间往前移，普通动画播了 3、4 行格子时，马上播放回正动画」*

**① 方向判据是「赢家是谁」，不是「这一格归谁」。** 这是最容易写错的一处：

| 赢家 | 层号（决定填充次序） | 观感 |
| :--- | :--- | :--- |
| `player` | `maxRow - row` | **从下往上** |
| `enemy` / `enemy2` / `enemy3`（其他玩家） | `row - minRow` | **从上往下** |

旧实现写的是 `winner === 'enemy'`，于是 3 / 4 号席位（`enemy2` / `enemy3`）被错判成「玩家方」、从下往上填充 —— 与需求相反。判据钉在 `tests/zcds-progress.test.ts`。

**② 两段重叠，不是串行。**

| 段 | 时长 / 起点 | 行为 |
| :--- | :--- | :--- |
| ① 铺场 | 每 `ZC_VICTORY_SWEEP_STEP_SECONDS = 0.06s` 铺**一整行** | 填该阵营的**深饱和色**，并**闪烁** |
| ② 回正 | 铺过 `ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS = 3` 行即起跑 | 由深色混到该阵营**当前色** |

🔴 **② 的起跑时刻 2026-10-16 换了口径。** 旧口径是「比铺满提前 0.12s 的**秒数**」，要等铺到倒数第二行才动 —— 前大半段屏幕上只有一片一动不动的深色。新口径按**行数**（需求原文就是按行说的），锚点也从「填充末尾」挪到「填充开头」：

```text
起跑时刻 = LEAD_ROWS × 填充步长        ← 与整盘有多少行无关
```

行数比 `LEAD_ROWS` 还少的盘退化成「铺满即起跑」（`victorySweepRevertStartSeconds` 用 `Math.min` 兜住，**不许算出负的起跑时刻** —— 那会让游标从第一帧就是正值、整盘一起回正）。

两段同速 ⇒ 中间**恒留一条 `LEAD_ROWS` 行宽的深色带**：填到第 n 行时，游标正好在 n − 3。
⚠️ 判据里别把带宽写成等号：填充步是 `floor` 出来的整数、游标是连续的，差落在 `(LEAD_ROWS − 1, LEAD_ROWS]` 这半开区间，浮点一抖就差 1。

顺带：整段总长 = `LEAD_ROWS × STEP + stepCount × REVERT_STEP`，比旧口径**短了一大截**（20 行的盘：2.28s → 1.38s）。`ZCGame.update` 的结算分支要等它播完才弹结算页，所以弹窗也跟着提前。

**③ 回正用一个「小数游标」表达**（`victorySweepRevertCursor`）：整数部分 = 已经整行回正的层数，小数部分 = 该行内部的过渡比例。某格要混多少由 `victorySweepRevertMix(cursor, step)` 给出（0 = 纯深色、1 = 当前色，对游标单调）。游标在起跑前返回负值、播完返回层数，两端都要判。

**④ 深色怎么算：`zcDeepFactionColor(owner)`（`view/ZCTheme.ts`）。** 两条铁律：
* **全程纯 RGB，不许走 HSV。** 测试桩里的 `Color` 没有 HSV；而且 h ∈ [0,360] 往返会让**灰色丢色相**（中立色 `#c4dae5` 一进一出就变色）。
* **顺序不能反：先 clamp 再加暗。** 推饱和会让蓝通道越界（`#7e82ff` 的蓝 = 305），先加暗会把越界值洗成一个**偏色**的中间态（实测过一次：`[92,97,238]` 而正确值是 `[92,97,199]`）。

实测五档（供回归比对）：

| 阵营 | 原色 | 深色 |
| :--- | :--- | :--- |
| `player` | `#7e82ff` | `#5c61c7` |
| `enemy` | `#fb4969` | `#c72549` |
| `enemy2` | `#fbcc49` | `#c79f0b` |
| `enemy3` | `#bd49fb` | `#a926c7` |
| `neutral` | `#c4dae5` | `#93acb8` |

**⑤ 铺场闪烁：`victorySweepShimmer(elapsed, step)`（2026-10-16）。**

| 常量 | 值 | 理由 |
| :--- | :--- | :--- |
| `ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS` | `0.15s` | ≈6.7Hz：比一帧（16.7ms）慢一个量级 ⇒ 每帧都能取到新相位；又比填充步长（0.06s/行）长 ⇒ 不会和「铺过去」混起来 |
| `ZC_VICTORY_SWEEP_SHIMMER_MAX` | `0.5` | 深色与纯白的中点：我方 `#5c61c7` 到最白是 `#adb0e3`，明显偏白但仍认得出同一色系 |
| `ZC_VICTORY_SWEEP_SHIMMER_ROW_PHASE` | `1/3` 周期 | 相邻行错开相位 ⇒ 高光斜着跑；取 0 会读成「整盘一起呼吸」 |
| `ZC_VICTORY_SWEEP_SHIMMER_STEPS` | `16` | 相位量化档数，当「要不要重画」的闸门（107 档/s > 60fps ⇒ 事实上每帧重画） |

* 🔴 **三角波，不是正弦。** 三角波的顶点是折角，看上去是「啪一下亮起来」；正弦顶点平缓，读起来是「慢慢呼吸」而不是「闪」。整周期 0 → 峰 → 0 **恒非负** ⇒ `elapsed = 0` 拿到纯深色，起手不会先白一下。
* 往白里偏走 `zcTowardWhite(color, amount)`：逐通道线性插值到 255。往白里偏**天然保持色相**（通道间的大小关系与比例不变），所以偏出来的一定是「同色系偏白」而不是另一个颜色。
* 🔴 **只偏深色那一端。** `sweepFill` 算的是 `lerp(whiten(deep, shimmer), current, mix)`，于是：`mix = 0` 闪得最明显、`mix = 1` 闪烁**完全不参与**、中间态按 `1 − mix` **自动**淡出 —— **不需要第二套「什么时候停闪」的规则**。这也是 `sweepKey` 敢在 `mix >= 1` 时把 shimmer 剔出指纹的依据（那时再算进去就是每帧无故重绘一片不会再变的格子）。
* ⚠️ 别断言「闪烁后的颜色一定比阵营当前色暗」：往白里推是把**每个**通道都抬上去，而阵营当前色是饱和色（我方 `126,130,255`），红绿两通道反而比偏白的深色**低**。

**⑥ 写色入口：`ZCHexView.setSweepOwner(owner, mix = 0, shimmer = 0)`。** 三个实现要点：
* `mix` 按 **32 档**、`shimmer` 按 **16 档**量化成 `sweepKey` 塞进 `contentSignature`。不量化的话，每帧的回正 / 闪烁都会改指纹、每帧抖一次 `spriteFrame`。
* `sweepFill(owner, mix, shimmer)` 混两份 `territoryFill` 采样；**`mix = 1` 与常规渲染逐位一致**，所以播完摘掉覆盖层不会「弹」一下（这条是能安全收工的前提）。
* 闪烁相位档位（`victorySweepShimmerTick`）是 `ZCVictorySweep.advance` 的**第三个**「要不要重画」判据（前两个是填充步号、回正游标）。真正在闪的只有那条 3~4 行的深色带，其余格子要么指纹没变、要么 `mix >= 1` 把闪烁剔出了指纹。
* 镜头动画本身**不变**。

**⑦ 用例写法提醒。** 扫场是**累加式**推进（`elapsed += dt`，且带 `Math.max(0, dt)`），所以用例内部要自己记进度、按**绝对时刻**推（`advanceTo(target)`）—— 直接传两次时刻的差值，一旦回正起跑时刻前移，差值就可能变成负数而被 `Math.max(0, dt)` **静默吃掉**，表现是用例莫名其妙地「推不动」。

### 9.2 row9 描边不许抢在地块图标前面

需求：*「地块的描边部分的展示时间需要和新的地块图标出现同步展示，不要先展示描边」*。

row6 的按住窗（`ZC_HEX_NEIGHBOR_HOLD_SECONDS` = 卡牌弹出 + 0.2s）只挡住了**图标 / 价格 / 数字**，**没挡轮廓** —— 轮廓由渲染世界的 `ownerForHex` 闭包交给 `canPlayerDevelop` 直接上玩家色，于是那 0.2s 里会出现「只有描边、没有图标」的空窗，正是需求要消掉的东西。

改法：`ZCHexView.resolveDevelopableHold` 开成 **public**，`ownerForHex` 在让 `canPlayerDevelop` 上色**之前**先问每格视图「这一格还在按住窗里吗」。查表是**幂等**的，所以视图自己在同一帧后面对 `render` 再问一次同一个方法是安全的（不需要在两边各存一份状态）。

* **判据**：`tests/zcds-hex-neighbor-reveal-delay.test.ts` 的 ★row9 那条直接驱动 `renderHexSystem`，用桩掉的 `resolveDevelopableHold` 读 `world.outlineDrawn`（`ownerIndexInOutline()`：1 = 中立、2 = 玩家）。

### 9.3 row10 开局金矿格的整圈描边闪烁

需求：*「参照图例，进入游戏初始时，给金矿图标所在的地块格子增加一个整体的描边闪烁，提示玩家点击金矿」*。

**曲线**（`ZCGameViewUtil.zcNeutralHintAlpha`，纯函数）：

```text
窗口   = ZC_NEUTRAL_HINT_CYCLE_SECONDS(1.1) × ZC_NEUTRAL_HINT_CYCLES(4) = 4.4s
相位   = (elapsed % 1.1) / 1.1
脉冲   = 0.35 + 0.65 × (0.5 + 0.5·cos(2π·相位))     // 用 cos ⇒ elapsed = 0 最亮
末段   = 最后一周期内再乘 (1 − u)²                    // 不是线性
窗口外 = 0
```

🔴 **末段包络必须是 `(1 − u)²`、不能线性。** 线性包络下，上升中的脉冲会把乘积**重新提亮**，读起来是「闪两下再灭」而不是「渐隐收工」。判据里有一条「整段尾部严格单调递减」专门守它 —— 峰值比较是抓不到这个 bug 的。

**落点**：画在**每格自己的 `TerritoryOutline`（`Graphics`）**上 —— 为这一个用途把它复活：每帧 6 条边，比重建整块共享轮廓便宜得多。颜色 `ZC_CLIENT_COLORS.gold`、线宽 7，顶点与内缩复用 `ZCOutlineLayer` 的 `ZC_OUTLINE_HEX_POINTS` / `OWNED_OUTLINE_INSET_SCALE`。`ZCHexView.renderHintOutline(alpha)` 带 **2% 不透明死区** + `graphics.enabled` 闸门（每帧写 6 条边不便宜），`alpha ≤ 0` 时清空并关掉。

**通道**（`ZCGameRenderWorld.renderNeutralHint`）：挂 `renderDynamic`，窗口**锚在对局时间** `visualTime`（进对局那一刻为 0）—— 于是「进入游戏初始时」不需要另开状态机，换局 / 重连换 `elapsedSeconds` 天然重新计时。`hintOutlineSettled` 是一道**单向**闩锁。三个收手条件任一成立即停：窗口播完、金矿被领取 / 被开发（模型 `neutralResourceId` 被清空）、这盘根本没有金矿格。

* **判据**：`tests/zcds-neutral-hint-outline.test.ts`（曲线 / 视图 / 源守卫 / 通道共 4 条）。两条踩过的坑：
  1. 视图片那条**不能断言 `graphics.commands.length`** —— `clear()` 会换掉整个数组，重建后长度又一样；要抓**数组引用**做 `assert.equal` / `assert.notEqual`。
  2. 断言「透明度 ≥ 下限」**只能在自己算出的 `tailStart` 之前** —— 尾部本来就该低于脉冲下限。

### 9.4 row11 传说牌横幅 `ZCGameLegendBanner`：扇入 + role 生成

需求原文：*「预制体从屏幕外生成，**从左往右**快速扇入屏幕，当生成动画块完成时，再展示 role 节点生成动画（role 初始透明度为 0 或不加载显示），role 节点初始位置 **Y 轴为 80，0.7s 内降至 0**（X 轴根据父节点移动）」*。

* **一律从左往右**，不再按「我方从左、敌方从右」分方向 —— `isLeftSide` 已删除，起点恒为 `−viewWidth / 2 − halfWidth`。
* `LEGEND_ROLE_DROP_Y = 80`、`LEGEND_ROLE_GENERATE_SECONDS = 0.7`；`legendRoleProgress(elapsed, slideSeconds)`：**扇入期间恒 0**，扇入结束后 0.7s 内线性 0 → 1。⚠️ 它算的是**已用时**，不是 reveal 进度 —— row6 那条「锚错段长只会整体错位」的教训同样适用。
* `legendRoleEase = easeOutCubic`，**下落与淡入共用同一条缓动**（不然两者会错拍，读作「位置到了才开始显形」）。
* 🔴 **「Y 轴 80 → 0」是相对 prefab 静止位的偏移，不是绝对 0。** role 节点的静止 `y = −28.24`，写成绝对值会把它**永久抬高 28px**（画面看起来「角色浮在横幅上方」）。`roleRestY` 在第一次写之前惰性捕获。
* 透明度走 **`roleSprite.color.a`**（不是 `UIOpacity`）：`renderContent` 从不碰 `color`，两者不会互相覆盖，于是**不需要改 prefab**。
* **判据**：`tests/zcds-legend-banner.test.ts` 的 ★row11 那条（按 0.05s 采样整段）。⚠️ 半程透明度不是 128 —— 缓动是 `easeOutCubic`，半程 ⇒ 87.5%，断言必须**按真缓动算**，不许写死 128。

### 9.5 row12 + row13 建筑抖动扩展到产金，且建筑档拉伸量抬到 120%

两条需求共用一条机制，一起实现、分开回写：
* row12：*「建筑生成金币的倒计时结束也播放一次已经【建筑生成单位动画】参照已经做好的，同时优化【建筑生成动画】，**建筑模型放大比例从 110% 改成 120%**」*
* row13：*「基地和金矿建筑生成金币时，也播放一次建筑的抖动效果，效果和已经做好的【建筑生成单位角色】动画一致」*

**① 拉伸量分成两档。**

```ts
SPAWN_SHAKE_STRETCH    = 0.1;  // 110% —— 单位自己出生那一下（ZCUnitView.playSpawnShake）
BUILDING_SHAKE_STRETCH = 0.2;  // 120% —— 建筑（产兵 / 产金共用）
```

`spawnShakePulse / spawnShakeScaleX / spawnShakeScaleY` 都收一个可选 `stretch`，缺省是**单位**档。row12 那句「建筑模型放大比例从 110% 改成 120%」只点建筑模型，所以单位那档不动。

> **口径说明（免得后人以为写错了）**：这条抖动最初是 110%（row5 原文「先是 Y 轴变成 1.1，回落到 1，再是 X 轴 1.1」），row12 明确把它抬到 120%。同一条需求里的「【建筑生成动画】」也可以读成「建筑由小长出来的那一段」（`elasticPopScale`，峰值 `POP_PEAK_SCALE` **本来就是 1.2**）—— **两种读法下「建筑模型放大比例 = 120%」都成立**，所以这里只抬抖动这一处，`POP_PEAK_SCALE` 保持 1.2。

**② 通知通道是「取走即空」，不是「读快照 + 按时间 prune」。** 其它表现队列（飘字 / 卡牌 / 受击）都是后者，这条**故意**不同：

`ZCBuildingShake { id, hexId }` **不带时长也不带起点** —— 抖动曲线（时长、拉多少、先 Y 后 X）的真源在 `ZCGameViewUtil`，视图自己知道怎么播；而「从哪一刻开始算」由渲染层在**收走这一拍的同一帧**用它与其它动画共用的那口时钟（`visualTime`）落定。原因：

> 🔴 抖动**不幂等** —— `playBuildingShake` 会把起点重置到「现在」。同一条通知被读两次，就等于**重头再抖一遍**；攒着不取也一样。

于是 `drainBuildingShakes()` 必须**原子地读走并清空**，并**交出去原来那条数组**、内部换一条新的接手（否则调用方遍历时遇到 `length = 0` 会把正在读的内容清掉）。由此 `buildingShakeQueue` **不能标 `readonly`**。空队列走共享的 `EMPTY_BUILDING_SHAKES`（常态零分配）；上限 `BUILDING_SHAKE_CAP = 32` 只兜「渲染层整段没在跑还一直产金」，丢最旧的。

**③ 两个触发源，别混。**

| 来源 | 触发点 | 判据 |
| :--- | :--- | :--- |
| 产兵（row5） | `renderUnitEntity` 的 `isBirth` 分支直接调 `triggerBuildingShake` | `unit.sourceHexId` 那格 `building === 'barracks'` |
| 产金（row12 / row13） | `economyContext.grantGold` 推队列，`renderBuildingShakes` 取走后再调 | 金额有效（见下） |

🔴 **推通知挂 `economyContext.grantGold`，不挂私有的 `grantGold`**：私有那条**击杀 / 拆建筑奖励**也在走，它们没有「建筑在产金币」这回事、不该抖。而 `economyContext.grantGold` 的调用点只有两处，正好就是需求点的这两个对象：主城（`context.homeId(owner)`）与金矿（`mine.id`）。金额非法 / ≤ 0 不抖 —— 这是 `grantGold` 内部那道闸的**故意重复**：「发出去了」与「通知了」必须同步。

🔴 **判据别改成「有没有冷却环」。** 主城 / 金矿也有环（收入 / 产出），而产兵那条要的是**产兵建筑**，两者混起来就会让主城在产兵时也抖一下。

**④ 必须挂 `renderDynamic`。** 抖动只有 `2 × 0.12 = 0.24s`，而 `renderHexSystem` 挂在 `renderStatic` 上、由 `ZCGame.update` 按 0.15s 节流 —— 6.7fps 根本播不出「先 Y 后 X」，只会闪一下。

**⑤ 渲染层入口统一成 `triggerBuildingShake(hexId, now)`**（原 `triggerBuildingSpawnShake(model, hexId, now)`），兵营那层判断**上移到调用点**（`isBirth` 分支里内联），因为产金那条不走它。

* **判据**：`tests/zcds-building-spawn-shake.test.ts`（6 条，含队列的取走即空 / 上限 / `reset`，以及 `ZCGameModel` 侧「产金真的发出去才推通知」的源守卫）。