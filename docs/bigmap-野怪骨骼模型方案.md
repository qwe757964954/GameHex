# 大地图野怪改用骨骼模型 · 生产级方案

> 状态：**方案（未实施）** · 日期 2026-11-11
> 代码：`assets/script/app/bigmap/` · 配置：`assets/remoteRef/bigmapMonster.json`（源 `D:/City1001/doc/塔防数据配置/DM-野怪配置.xlsx`）
> 本文只做设计；每一步落地后再按 §8 的顺序验证。

---

## 0. 结论先行（五条，含反直觉的）

1. **「工程现有的骨骼模型」= `assets/resources/skel/*` 下 30 个角色 Spine**。
   `assets/bundles/battle/units/*` 那 7 个（九头蛇 / 剑圣 / 女猎手 / 玛法 / 萨满 / 阿尔萨斯 / 驭兽师）是
   **`cc.Animation` 序列帧**（`anim/*.anim` + `atlas/*-idle_0.png` + `*.pac`），不是骨骼，别拿错。
   （原有第 8 个「冰法师」只被卡牌「水手菇」借用，2026-11-11 水手菇改用 `skel/水手蘑菇` 后整个目录已删。）
   `skel/` 里另 4 个（`yueka` / `neutral_hex` / `neutral_question` / `reddot`）是界面特效，也不进野怪池。

2. **`bigmapMonster.monsterModel` 这一列现在是死数据，而且语义自相矛盾**：
   中文名写「野怪模型资源」，第 4 行说明写「野怪图标资源名」，实际 34 行全填 `icons/cardHead/<拼音>`（卡牌头像图）。
   全工程 grep：**除 `BigMapConfig.parseMonster` 解析出 `modelPath` 之外零消费**。所以「接上骨骼」不是改渲染，
   **先得把这列的口径定死**（§3）。

3. **地图上不是 20 只野怪，是 60 只**。`assets/resources/config/bigmap-maps/bigMap.json` 的 `monsters` 有 **60 条实例**，
   worldId=1、100×100 格。表里 34 行，但布局只用了 `8001~8020` 这 **20 个 id**（`9001~9014` 精英没进布局）。
   ⇒ 同屏骨架预算按 **60 实例 / 20 种模型** 算，不是文档 §2.5 写的 20 只。

4. **表里 20 个 id 只对应 5 个不同的 `monsterModel` 值**
   （`wandouyouxia` / `huoyanshuyao` / `sanyexiaochou` / `tunshidazuihua` / `boliao`）。
   直接照表渲染的结果是「20 种野怪只有 5 张脸」。所以本方案除了接线，**必须连带定一份 id→模型的映射**（§2.3）。

5. **资源侧没有体积风险**：30 个角色纹理只有 240~636 px 见方，PNG 合计 7.2 MB，解压 RGBA 合计 **17 MB**。
   真正的成本在 **Skeleton 逐帧更新**（60 个），不在显存（§6）。

---

## 1. 现状盘点

### 1.1 渲染链路（现在）

```
bigmapMonster.json ──parseMonster──> IBigMapMonsterConfig.battle.{iconPath, modelPath}
                                              │
                                              └─(零消费)
IBigMapViewState.monsters ──> BigMapWorldView.refresh()
                                   └─ marker.kind==='monster'
                                        └─ applyMarker({ frame: this.art?.monster })
                                             └─ this.art.monster = 概念图 image/concept/sprites/mutant_camp
                                                  └─ BigMapWorldMarker.render() → 单个 Sprite
```

即：**60 只野怪共用一张概念图**，只靠名条的等级数字区分。

### 1.2 相关文件与职责

| 文件 | 现状 | 本方案要动 |
| --- | --- | --- |
| `view/BigMapWorldView.ts` | 建 157 个标记（81 城 + 60 野怪 + 16 基地），`cullMarkers` 按视口 active | 加「野怪骨架宿主」的懒创建与 active 同步 |
| `view/BigMapWorldMarker.ts` | `icon: Sprite` + 名条 + 头像 + 占据旗 | 加 `monsterVisual: Node` 宿主与新接口 |
| `view/BigMapWorldTemplates.ts` | `groundTemplate` / `decorTemplate` / `markerTemplate` | 不改（宿主节点在 marker 模板内部） |
| `view/BigMapWorldLayout.ts` | `BIGMAP_MARKER_MONSTER_WIDTH=121`、`FOOT_LIFT=16`、`bigMapMarkerLayout()` | 加骨架显示尺寸常量 |
| `application/BigMapArtLoader.ts` | 只装 SpriteFrame；`art.monster` 概念图 | **不改**（骨架是 Prefab，不该塞进 SpriteFrame 装载器） |
| `model/BigMapConfig.ts` | 已解析 `modelPath` | 不改 |
| `model/BigMapTypes.ts` | `IBigMapMonsterBattleConfig.modelPath` 已有 | 可能加一个 `resolvedModelPath` 语义注释 |

### 1.3 可复用的既有封装

| 既有件 | 位置 | 能复用哪一点 | 不能照搬的地方 |
| --- | --- | --- | --- |
| `ZCUnitView` spine 分支 | `app/zcds/view/ZCUnitView.ts` | 骨架归一：`spineCanvasHeight()` + `SPINE_VISIBLE_RATIO=0.970`；`Skeleton.color` 染色 | 它连带描边副本、序列帧混用、对局席位逻辑，太重 |
| `CardUnitPreview` | `app/card/CardUnitPreview.ts` | 「实例化 prefab → 找 Skeleton → 校验有没有 idle → 归一缩放 → 脚点对齐」这一整套判断 | 它 `addComponent(CardUnitPreviewPlayer)`，而 `bigmap/view` **源码守卫禁止 `addComponent`**（`tests/bigmap-world-prefab.test.ts:103`） |
| `CardUnitPreviewAssets` | `app/card/CardUnitPreviewAssets.ts` | 「按路径缓存 Promise」的模式 | 它不接 `ResourceScope`，大世界必须能随页面释放 |

---

## 2. 资源选型

### 2.1 候选池

`assets/resources/skel/<中文名>/<中文名>.prefab`，30 个，全部 `sp.Skeleton`：

- `skel/` 下 31 个 prefab 里 **30 个 `defaultAnimation = 'idle'`**，唯一例外是 `yueka`（`'animation'`，月卡界面，不在角色池里）
  ⇒ **实例化即自动循环播 idle**，不需要运行时 `setAnimation`。
  这点很重要：`setAnimation` 在骨架 `onLoad` 之前调用**返回 null 且不生效**（`ZCUnitView:770` 的实测记录），
  能不调就不调。
- 骨架 canvas 高 685 ~ 1523，prefab 根节点 `UITransform.anchor` **不是统一的 (0.5,0)**
  （实测 `菇八戒` 是 `(0.330, 0.130)`）⇒ 脚点对齐只能按「`skeletonData.height` + 可见比 + anchor」算，**不能假设**。

### 2.2 完整清单（30 个，按纹理尺寸）

| 角色 | 目录 | 骨架 canvas 高 | 纹理 | 适合的野怪档 |
| --- | --- | --- | --- | --- |
| 魔术师召唤鹿 | `魔术师召唤鹿` | 685 | 240² | 1~3 级小怪 |
| 艺术家 | `艺术家` | 997 | 256² | 1~3 级小怪 |
| 饥饿战士 | `饥饿战士` | 945 | 264² | 1~6 级 |
| 水手蘑菇 | `水手蘑菇` | 887 | 284² | 蘑菇系（12~15） |
| 三叶小丑 | `三叶小丑` | 941 | 284² | 藤蔓系（7~11） |
| 豌豆射手 | `豌豆射手` | 916 | 292² | 幼苗系（1~6） |
| 杰克藕 | `杰克藕` | 976 | 300² | 7~11 级 |
| 玉林好汉 | `玉林好汉` | 1018 | 300² | 7~11 级 |
| 金发统领 | `金发统领` | 769 | 300² | 精英 |
| 科学家 | `科学家` | 1111 | 332² | 7~11 级 |
| 消灭学霸 | `消灭学霸` | 1047 | 340² | 7~11 级 |
| 坚果 | `坚果` | 769 | 348² | 幼苗系 |
| 吉他手 | `吉他手` | 1153 | 364² | 12~15 级 |
| 哈利波特 | `哈利波特` | 976 | 364² | 12~15 级 |
| 火焰树妖 | `火焰树妖` | 769 | 364² | **树精系（16~18）** |
| 篮球天才 | `篮球天才` | 769 | 364² | 精英 |
| 急冻瓜 | `急冻瓜` | 941 | 380² | 12~15 级 |
| 大威天芦 | `大威天芦` | 941 | 380² | 16~20 级 |
| 菇八戒 | `菇八戒` | 936 | 396² | **蘑菇系（12~15）** |
| 火龙果 | `火龙果` | 1524 | 396² | 19~20 巨花 |
| 吞噬大嘴花 | `吞噬大嘴花` | 769 | 412² | **巨花系（19~20）** |
| 仙人侍卫 | `仙人侍卫` | 941 | 428² | 精英 |
| 窝瓜人 | `窝瓜人` | 1078 | 428² | 19~20 巨花 |
| 麻辣铁锅 | `麻辣铁锅` | 941 | 444² | 16~20 级 |
| 爆锤莲王 | `爆锤莲王` | 941 | 452² | 19~20 巨花 |
| 仙桃行者 | `仙桃行者` | 941 | 460² | 16~18 级 |
| 椰蛋战士 | `椰蛋战士` | 1048 | 492² | 16~18 级 |
| 波利奥 | `波利奥` | 1098 | 508² | **19~20 巨花（表里已在用）** |
| 南瓜战神 | `南瓜战神` | 1034 | 536² | 精英（体型 4 格） |
| 香蕉雷神 | `香蕉雷神` | 1443 | 636² | 精英 BOSS |

### 2.3 id → 模型的推荐映射（必须显式写死，不能按名字推导）

现有 20 个 id 只映射 5 个角色。推荐按「名称语义 + 等级档 + 体型」铺成 20 个不同角色（够铺：池里 30 个）：

| monsterId | 名称 | 体型 | 推荐角色 |
| --- | --- | --- | --- |
| 8001~8003 | 腐化幼苗 1~3 | 1 | 豌豆射手 / 艺术家 / 魔术师召唤鹿 |
| 8004~8006 | 腐化幼苗 4~6 | 1 | 饥饿战士 / 坚果 / 水手蘑菇 |
| 8007~8008 | 腐化藤蔓 7~8 | 1 | 三叶小丑 / 杰克藕 |
| 8009~8011 | 腐化藤蔓 9~11 | 1 | 玉林好汉 / 科学家 / 金发统领 |
| 8012~8014 | 腐化蘑菇 12~14 | 2 | 菇八戒 / 仙人侍卫 / 仙桃行者 |
| 8015 | 腐化蘑菇 15 | 2 | 椰蛋战士 |
| 8016~8018 | 腐化树精 16~18 | 2 | 火焰树妖 / 大威天芦 / 麻辣铁锅 |
| 8019 | 腐化巨花 19 | 2 | 吞噬大嘴花 |
| 8020 | 腐化巨花 20 | 2 | 波利奥 |
| 9001~9007 | 腐化幼苗-精英 | 4 | 吉他手 / 哈利波特 / 急冻瓜 / 篮球天才 / 火龙果 / 窝瓜人 / 爆锤莲王 |
| 9008~9014 | 腐化藤蔓/巨花-精英 | 4 | 南瓜战神 / 香蕉雷神 / 消灭学霸 / 仙人侍卫 / 仙桃行者 / 椰蛋战士 / 麻辣铁锅 |

> 这张表**是方案建议，不是需求**。最终由策划在表里定；客户端只负责「表没填就用内置映射」的兜底。

### 2.4 名字对不上的四处（为什么不能自动推导）

`icons/cardHead` 的拼音与 `skel/` 的中文目录**不是一一对应的**：

| cardHead 拼音 | skel 目录 | 差异 |
| --- | --- | --- |
| `jinfalaoban`（金发老板） | `金发统领` | 名字不同 |
| `lanqiushaonian`（篮球少年） | `篮球天才` | 名字不同 |
| `shuishougu`（水手菇） | `水手蘑菇` | 名字不同 |
| `wandouyouxia`（豌豆游侠） | `豌豆射手` | 名字不同 |
| `julijianguo`（巨力坚果） | `坚果` | 疑似同源，未证 |

另有 8 个 cardHead **根本没有骨骼**：`diancigu`（磁电菇）/ `dujiangu`（毒箭菇）/ `fengpaogu`（风炮菇）/
`fenliegu`（分裂菇）/ `jijiagu`（鸡甲菇）/ `leijiao`（雷蕉）/ `zuzhougu`（诅咒菇）/ `julijianguo`（待定）。

⇒ **映射必须是显式常量表，且未命中要能退回概念图**，不能 `拼音→中文` 反查。

---

## 3. 配置口径（要先定，否则代码无真源）

### 3.1 三种做法

| 方案 | 做法 | 优点 | 代价 | 结论 |
| --- | --- | --- | --- | --- |
| A | **让 `monsterModel` 填 `skel/<角色>/<角色>`** | 不加列；字段中文名「野怪模型资源」与语义一致；`parseMonster` 已有 `modelPath` 无需改配置层 | 要策划改 34 行数据；`monsterHeaIcon` 恢复成头像用途 | ✅ **推荐** |
| B | 新增一列 `monsterPrefab` | 老数据零迁移 | 一表两列都叫「模型」；导表/服务端下游要同步加列；`tests/bigmap-latest-monster-config.test.ts:29` 的 `deepEqual` 要改 | 备选 |
| C | 客户端内置映射，表不动 | 立即可见效果；不阻塞策划 | 长期双真源 | 只做**过渡层** |

### 3.2 落地口径（A + C 组合，分三步收敛）

```
解析层：IBigMapMonsterConfig.battle.modelPath  ← 表（可能为空 / 可能是图标名）
        ↓
解析层：bigMapMonsterModelKey(monsterId, modelPath)   ← 纯函数，零 cc
        ① modelPath 以 'skel/' 开头且格式合法  → 用它
        ② 否则查 FALLBACK_MONSTER_MODEL（§2.3 内置表）
        ③ 都没有                              → null（视图退回概念图）
        ↓
视图层：null ⇒ 维持今天的 Sprite 概念图；非 null ⇒ 骨架宿主
```

**为什么不认 `icons/…` 开头的 modelPath**：今天 34 行全是图标名，把它当模型路径去 load 会 404 并且每只野怪刷一条 warn。

⚠️ 表里 `monsterHeaIcon` 34 行全填 `ui/bigmap/monster/8001`，而 `assets/bundles/bigmap/ui/bigmap/monster/`
**目录不存在**（资源未入库）。这列也是死的 —— 本方案**不用它**，但要在 §8 第 5 步顺手登记为已知缺口。

---

## 4. 代码设计

分层遵守 `AGENTS.md`：模型零 `cc`，视图不判业务，加载经 `AssetService` + `ResourceScope`。

### 4.1 `model/BigMapMonsterArt.ts`（新增，纯 TS）

```ts
/** 表里没填 / 填错时的模型真源；键 = monsterId，值 = skel 内相对路径。 */
export const FALLBACK_MONSTER_MODEL: Readonly<Record<number, string>> = {
    8001: 'skel/豌豆射手/豌豆射手',
    // … §2.3 的 20 个 id
};

/**
 * 决定这只野怪该用哪个骨架。
 * @returns `null` = 没有可用模型，视图退回概念图（绝不返回空串）
 */
export function bigMapMonsterModelKey(monsterId: number, modelPath: string): string | null {
    const path = modelPath.trim();
    // 只认 `skel/<目录>/<同名>` 这种形状：今天表里全填 `icons/cardHead/x`，
    // 拿它去 load prefab 会 404 并逐只刷日志。
    if (/^skel\/[^/]+\/[^/]+$/.test(path)) return path;
    return FALLBACK_MONSTER_MODEL[monsterId] ?? null;
}
```

要点：
- 纯函数 ⇒ 能直接进单测，不会被 `cc` 拖下水；
- **永远返回 `null` 而不是空串**，视图只判 `null`，不做字符串判断；
- 正则白名单比「以 skel/ 开头」更严：`skel/a/b/c` 这种脏数据不会被当合法路径。

### 4.2 `application/BigMapMonsterArt.ts`（新增，接 AssetService）

```ts
export class BigMapMonsterArt {
    constructor(
        private readonly assets: Pick<AssetService, 'load' | 'has'>,
        private readonly scope: ResourceScope,
    ) {}

    /** 同一路径全页只加载一次；失败缓存为 null，绝不重复请求。 */
    load(path: string): Promise<Prefab | null>;
}
```

要点：
- 键 = `path`，值 = `Promise<Prefab | null>`（同 `CardUnitPreviewAssets`）；
- `scope.disposed` 之后一律返回 `null`，迟到的结果不再交付（`BigMapPage` 的既有约定）；
- **不缓存 SkeletonData**：它在 prefab 的依赖里，引擎 `assetManager` 负责引用计数，额外管一层反而会泄。

### 4.3 `view/BigMapWorldMarker.ts`（改）

新增：

```ts
@property({ type: Node, group: '野怪' }) private monsterVisual: Node = null;

/** 骨架宿主；`null` = 退回 `icon` 的 Sprite 概念图。 */
setMonsterHost(prefab: Prefab | null): sp.Skeleton | null;

/** 视觉染色：sprite 走 `icon.color`，骨架走 `Skeleton.color`。 */
setVisualTint(color: Color): void;
```

约束（都是既有守卫逼出来的）：
- **不能 `addComponent`、不能 `new Node`**（`tests/bigmap-world-prefab.test.ts:103` 的正则）⇒ `monsterVisual` 必须来自 prefab 模板；
- 模板内每个节点最多 1 个渲染组件（同测试 58 行）⇒ 宿主用**空节点**，Spine 挂在实例内部；
- 节点名不能含 `Template`（同测试 54 行）⇒ 叫 `MonsterVisual`。

### 4.4 `view/BigMapWorldView.ts`（改）

```ts
/** 已建好骨架的标记（键 = instanceId）；null 项只创建一次，避免每帧重试。 */
private readonly monsterVisuals = new Map<number, sp.Skeleton | null>();

/** 在 cullMarkers 之后跑：只给「刚进视口」的野怪建骨架，其余只改 active。 */
private syncMonsterVisuals(): void;
```

关键点：
1. **懒创建**：`build()` 时 60 个 marker 只建节点，不建骨架。骨架在首次进视口时创建；
2. **常驻不销毁**：出视口只 `active=false`（`Skeleton` 在 inactive 时不 update，成本为零），
   页面关闭由 scope 统一释放。**不要池化**——20 种模型、60 实例，池化收益不抵复杂度；
3. **分帧**：`syncMonsterVisuals` 每帧最多建 **3 个**（`MAX_MONSTER_VISUAL_BUILDS_PER_FRAME`），
   首屏 60 只铺满约 20 帧（≈0.33s），避免 `build()` 一帧掉到底；
4. `contentKey` 的野怪段要加 `monsterId`
   （现在只有 `instanceId:unlocked:respawn`，换表后模型变了页面不重绘）；
5. `marker.icon.node.active` 与 `monsterVisual.active` **互斥**：有骨架就关 Sprite，没骨架才显示概念图。

### 4.5 `view/BigMapWorldLayout.ts`（改）

```ts
/** 骨架归一目标：设计稿野怪 121×129 的可见高。 */
export const BIGMAP_MONSTER_VISIBLE_HEIGHT = 129;
/** 体型档位（`monsterSize` 1/2/4）→ 视觉放大；不改变命中框宽度。 */
export function bigMapMonsterVisualScale(size: number): number;   // 1 → 1.0, 2 → 1.15, 4 → 1.35
```

### 4.6 Prefab 改动（**必须走 Cocos MCP**，不手写 JSON）

`assets/bundles/bigmap/ui/bigmap/BigMapWorldTemplates.prefab`：

在 `MarkerTemplate` 下新增空节点 `MonsterVisual`：
- `layer = 33554432`（UI_2D，与同级一致）；
- `UITransform` 尺寸 `121 × 129`，`anchor (0.5, 0)`（脚点在底边）；
- 位置 `(0, BIGMAP_MARKER_FOOT_LIFT = 16, 0)`（与 `BIGMAP_MARKER_BADGE_Y` 的口径同源）；
- 默认 `active = false`；**不挂任何渲染组件**；
- 在 `BigMapWorldMarker` 组件上绑到 `monsterVisual` 字段。

⚠️ **不改 `BigMapWorldTemplates` 根节点的子清单**（`GroundTemplate`/`DecorTemplate`/`MarkerTemplate`）——
`tests/bigmap-world-prefab.test.ts:41` 是 `deepEqual` 精确断言，多一个节点就红。宿主放在模板内部，这条断言不用动。

---

## 5. 表现细节（每个都是会静默出错的地方）

| 项 | 口径 | 错了会怎样 |
| --- | --- | --- |
| 归一缩放 | `scale = BIGMAP_MONSTER_VISIBLE_HEIGHT / (skeletonData.height × 0.970) × prefab自带宽高比 × 体型档` | 不听 `skeletonData.height` 而读 prefab `UITransform`（942×769 是设计稿占位，不是骨架）⇒ 大小全错 |
| 脚点 | 骨架**原点≈脚底**（`ZCUnitView:51` 实测），宿主 `anchor (0.5,0)`，位置 `y = FOOT_LIFT` | 按 Sprite 那套 `-frame.offset.y * scale` 去算 ⇒ 整体浮空/埋地里 |
| 名条几何 | `bigMapMarkerLayout(121, 129)`，与概念图同一条公式 | spine 实际高度不同却不传 ⇒ 名条与模型脱开或叠字 |
| 染色 | `Skeleton.color`（乘算，`ZCUnitView:759` 已验） | 只写 `icon.color` ⇒ 锁定态不灰、刷新中不暗 |
| `premultipliedAlpha` | 沿用 prefab 自带值，**不要覆写** | 覆写成 false 会让 30 个角色的边缘出现黑边（素材是 premultiplied 的） |
| 动画 | 依赖 `defaultAnimation = 'idle'`；实例化后校验骨架动画名表，没有 `idle` 就退回概念图 | 硬调 `setAnimation` 在骨架就绪前**静默失败**（返回 null） |
| 城池聚焦 | `cullMarkers` 把非城池标记 `active=false` ⇒ 骨架自动停更，无需额外处理 | 若只隐藏 `icon` 不隐藏宿主 ⇒ 聚焦时野怪骨架还在 |
| 命中框 | 仍用 `marker.view.hitArea`，**不改** `pickBigMapMarker` | 改命中框会连带影响相邻标记的误点区（`bigMapMarkerLayout` 的注释已警告） |
| 销毁 | 页面关闭走 `artScope`，标记节点随 `worldView.node` 销毁 | 手动 `destroy()` 骨架节点会与 scope release 打架 |

---

## 6. 性能预算（数字待探针实测，先给设计口径）

| 项 | 估算 | 依据 / 处置 |
| --- | --- | --- |
| 纹理显存 | **≤17 MB** RGBA | 30 个角色合计实测；实际只加载用到的（≤20 个 ⇒ ~11 MB） |
| 节点常驻 | 60 个 Skeleton 实例 | inactive 不 update，成本≈0；**不要**为省内存去销毁重建 |
| 逐帧成本 | 视口内 ~15~25 个骨架 × 0.05~0.15 ms | **待实测**：`ZCUnitView` 只在对局里跑过个位数骨架，60 实例同场景无先例 |
| 首屏卡顿 | 60 × 实例化（`CardLineupSlot` 实测单个 **1.4~2.7 ms**） | ⇒ **必须分帧**，否则 `build()` 一帧多出 90~160 ms |
| LOD | `zoom < 0.55` 时关骨架、显示概念图 | 初始 `resetCamera` 的 zoom 是 `clamp(viewport/720, 0.55, 1)`，**最低正好 0.55** ⇒ 阈值取 0.55 以下才不会「一进页面就掉 LOD」 |
| 加载时机 | 骨架加载与页面 `loadArt` **串行之外**、并行发起 | 不阻塞世界页首帧（现有首屏口径：美术就绪后再搭页面，缺图不阻塞） |

⚠️ 别在 `update` 里做 `syncMonsterVisuals` —— 它只在 `cullMarkers`（平移/缩放/聚焦变化）后跑一次。

---

## 7. 测试与判据

### 7.1 新增

| 用例 | 钉住什么 |
| --- | --- |
| `tests/bigmap-monster-model-key.test.ts`（新） | `bigMapMonsterModelKey`：`skel/` 合法走表值；`icons/...` 走内置表；两者都没有返回 `null`；脏路径（`skel/a`／`skel/a/b/c`／空串）不通过 |
| 同上 | 内置映射**覆盖布局里出现的全部 20 个 id**（读 `bigMap.json` 的 `monsters` 反查，不是硬编码 20） |
| 同上 | 内置映射的每个路径**在磁盘上真实存在**（`assets/resources/skel/<名>/<名>.prefab`），防止名字打错静默回退 |
| `tests/bigmap-world-prefab.test.ts`（加） | `MarkerTemplate/MonsterVisual` 存在、`layer=33554432`、`active=false`、`anchor=(0.5,0)`、**无渲染组件**、已绑到 `monsterVisual` |
| 同上（加反向） | 源码仍不含 `new Node(` / `addComponent(` / `destroyAllChildren`；`syncMonsterVisuals` 不在 `update` 里 |
| `tests/bigmap-monster-visual.test.ts`（新） | 有模型的野怪 `icon.node.active === false` 且宿主 active；无模型的两者相反；聚焦态两者都关 |

### 7.2 必过的既有用例（改到就红，别指望「跑全绿」）

- `tests/bigmap-world-prefab.test.ts` —— 模板结构 + 源码正则双守卫；
- `tests/bigmap-latest-monster-config.test.ts` —— 若走方案 B（加列），第 29 行 `deepEqual(monster.battle, {...})` 必须同步；
- `tests/bigmap-transparent-tiles.test.ts` / `bigmap-art-loading.test.ts` —— `art.monster` 仍要保留（概念图没退役，仍是无模型时的兜底）；
- `tests/bigmap-focus-city.test.ts` —— 聚焦隔离时野怪标记的 active 语义不能变。

### 7.3 端到端探针（Engine 内跑，不是 Node 单测）

`tmp/bigmap-monster-spine-probe.mjs`（`.mjs` 不进 `tsc`，符合铁律 2）：

1. 真实加载 `BigMapWorldView.prefab` + `bigMap.json` 正式布局；
2. 断言 60 个野怪标记里，有模型的 `icon.enabled === false`、宿主有 `sp.Skeleton`；
3. 断言骨架 `getRuntimeData().animations` 含 `idle`；
4. 在 zoom 0.55 / 1.0 / 1.6 三档各跑 60 帧，记录 `director.totalFrames` 与 frameTime（对比关骨架的基线）；
5. 断言无 `Invalid skeleton data` / `SpriteFrame is null` 类报错。

---

## 8. 落地顺序（每步可单独验证，中断也不留半成品）

| 步 | 内容 | 验证 | 可回滚性 |
| --- | --- | --- | --- |
| 1 | `model/BigMapMonsterArt.ts` + `bigMapMonsterModelKey` + 内置映射 + 单测 | `npx tsx --test tests/bigmap-monster-model-key.test.ts` | 纯新增，零影响 |
| 2 | `application/BigMapMonsterArt.ts`（Prefab 加载 + scope） | 单测桩 + 真机日志 | 纯新增 |
| 3 | **MCP 改 `BigMapWorldTemplates.prefab`**：加 `MonsterVisual` + 绑字段 | `bigmap-world-prefab.test.ts` + 编辑器内看层级 | prefab 单文件，`svn revert` 即回 |
| 4 | `BigMapWorldMarker` 加 `monsterVisual` / `setMonsterHost` / `setVisualTint` | 同上 + `bigmap-marker-portrait-hittest` | 代码级可回滚 |
| 5 | `BigMapWorldView` 接懒创建 + 分帧 + LOD + `contentKey` | 探针 + 三档 zoom | 加开关常量可一键关回概念图 |
| 6 | 策划改表（`monsterModel` 填 `skel/…`） | 表改了不改代码也生效 | 表回退即回概念图 |
| 7 | 删内置映射（长期收敛） | 同上 | —— |

> 第 3 步是唯一不可逆感最强的一步（改 prefab）。**先做完 1、2 再动 prefab**，这样 MCP 一步不成也不影响主干。

---

## 9. 风险与未决

| # | 项 | 影响 | 处置 |
| --- | --- | --- | --- |
| 1 | 策划是否愿意把 `monsterModel` 改填模型路径 | 决定 §3 走 A 还是长期挂 C | 先按 A+C 落地，不阻塞 |
| 2 | 20 个 id 是否要 20 个不同角色 | 影响「野怪辨识度」这个需求本身 | §2.3 是建议值，等策划确认 |
| 3 | 精英怪（`9001~9014`）没进布局 | 现在无论怎么配都不会显示 | 不在本方案范围；若日后进布局，内置映射已覆盖 |
| 4 | `monsterHeaIcon` 指向的 `ui/bigmap/monster/` 目录不存在 | 详情弹窗/匹配界面若要用头像会取不到 | 登记为美术缺口，本方案不使用 |
| 5 | 骨架 `anchor` 各角色不一致（实测 0.330/0.130） | 脚点对齐要按角色实测 | 探针逐角色输出脚点偏移，写进常量表 |
| 6 | 60 个骨架在低端机的帧成本未实测 | 可能需要在 LOD 之外再加「视野内最多 N 个」 | 探针数据出来后定，不预设 |
| 7 | 手绘概念图 `mutant_camp` 仍在链路里 | 无模型时仍显示同一张图 | 刻意保留为兜底，不退役 |
