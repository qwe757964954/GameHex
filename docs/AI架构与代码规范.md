# AI 架构与代码规范（全局总纲）

> **定位与适用范围**：
> - 本文档是 Cocos Creator 3.8 + TypeScript 项目的**全局架构、工程实现、Prefab 规范与美术配表工具链总纲**。
> - 日常开发与 AI 会话入口摘要见根目录 [AGENTS.md](https://www.google.com/search?q=..%2FAGENTS.md)；对局表现层（`app/zcds/view`）与「冒险」领地页（`app/territory`）的详细规格（原 §7.3.3 ~ §7.3.11）已拆分为独立文档 [docs/zcds-表现层与领地规范.md](https://www.google.com/search?q=.%2Fzcds-%E8%A1%A8%E7%8E%B0%E5%B1%82%E4%B8%8E%E9%A2%86%E5%9C%B0%E8%A7%84%E8%8C%83.md)。

## 1. 开发工作流与导航约定

1. **先定边界再动手**：修改代码前，先确认需求所属的 feature、流程（`Procedure*`）、数据真源（Model / Repository）与资源生命周期，禁止仅凭文件名猜测。
2. **优先使用 Codegraph**：仓库存在 `.codegraph/` 时，先通过 `codegraph explore` 追踪符号定义、调用链与关联单测，定位后再打开目标文件，避免大范围盲目搜索。
3. **工作区安全**：下刀前检查 `git status` / `svn status`；严禁覆盖、格式化或回退与当前任务无关的用户改动；严禁手改 `library/`、`temp/`、`build/`、`native/` 及生成产物。
4. **复用既有设施**：优先复用工程内已有的 Presenter 模式、端口定义、文本常量表、`AssetService` 加载器与测试夹具（Test Fixtures），禁止平行造轮子。

## 2. 分层架构与依赖硬约束

项目遵循严格的由外向内单向依赖原则：

```text
app/bootstrap（组合根：装配全局端口与流程）
  -> app/procedure（流程编排）、app/<feature>/application（用例/Presenter）、app/<feature>/view（Cocos 视图组件）
  -> core（领域端口、运行时契约、纯业务与几何规则）
platform（Cocos 引擎资源/网络/配置/热更新适配器） -> core
framework（通用 UI 基类 / 弹窗 / 路由机制）       -> core
```

| 层级 / 目录 | 允许依赖 | 严禁依赖 / 严禁行为 |
| :--- | :--- | :--- |
| `core/**` | 仅限 `core/**` 内部纯 TS 模块 | 严禁 `import 'cc'`、`framework`、`app`、`platform`；严禁直接 I/O（网络/本地存储）与全局可变单例 |
| `framework/**` | `core/**`、`cc` | 严禁依赖任何具体业务 `app/<feature>` 或具体 `Procedure*` |
| `platform/**` | `core/**`、引擎或底层 SDK | 只实现 `core` 端口（Adapter），严禁混入具体业务规则或 UI 状态 |
| `app/<feature>/model` 或 `application` | `core/**`、本 feature 内部纯契约 | 纯 TS 的 Presenter / Model 剥掉 `import type` 后不得依赖 `cc` 或直接调 `resources.load` |
| `app/<feature>/view` | 本 feature 的 `application`/`model`、`framework`、`cc` | 只负责引擎生命周期、输入转发与渲染编排；严禁跨页面直接切换 `Procedure*`（必须走 `GameRoute`）；严禁直调 `resources.load` 或 `fetch` |

## 3. 运行时实现硬约束

### 3.1 契约先行与边界归一化
- 先定义清晰的输入、输出、错误/取消语义与数学不变量，再写实现。
- 服务端协议、配表 JSON、本地存档等外部数据必须在 Repository / Config 边界完成归一化与合法性校验，内部模型不背负脏数据兜底分支。

### 3.2 异步安全与生命周期守卫
- 所有 `async / await` 或回调逻辑必须显式处理以下 4 种中断场景：**节点/弹窗已销毁、流程预加载已取消、玩家重复点击、请求失败**。
- `PopupBase` 子类统一使用 `nextPopupFrame()`，并在每次 `await` 恢复后立即检查 `if (!this.isValid) return;`。
- 流程级预加载（`Procedure*`）必须在异步阶段检查 `if (context.cancelled) return;`，防止切流程后幽灵回调污染新页面。

### 3.3 渲染幂等、纯函数时间轴与唯一写入口
- **全量幂等 `render`**：视图 `render(state)` 必须是幂等的全量赋值。对象池复用节点或虚拟列表项在绑定新数据时，必须显式写全所有受控属性（含 `node.active`、缩放、染色、自定义材质开关），不得依赖上一帧或上一次池化前的残留状态。
- **纯函数时间轴**：动画表现统一记录 `startedAt` 时间戳，在 `render` 中按 `now - startedAt` 调用纯函数计算当前帧状态；禁止在视图组件内零散创建 `tween` 或使用 `dt` 累加状态（免疫暂停、切后台与帧率抖动，且可直接单测）。
- **单属性唯一写入口**：同一节点的 `scale`、`position`、`color`、`parent`、`customMaterial` 在视图类中必须收拢到**唯一私有方法**写入（例如 `applyBuildingScale`、`applyIconPosition`、`applyPulseMaterial`），杜绝多处直接写 `node.setScale` 导致静态刷新拍平动态动画。
- **内容指纹闸门（Content Signature）**：静态高频渲染应通过 `contentSignature()` 比对指纹跳过无变化重绘；若动态特写（如扩散波 `setClaimWave`）绕过闸门直写属性，收工时必须清空 `contentKey = ''` 强制下一帧常规重绘。

### 3.4 帧循环（`update`）与状态管理禁令
- **严禁在 `update` 中**：加载资源、查询全局配置表、每帧 `new` 临时数组/对象/节点、或混入业务结算规则。
- **动静分离节流**：短周期逐帧动画（如 0.1s~0.4s 的抖动、过渡波、金矿闪烁）必须挂在逐帧执行的 `renderDynamic` 上；低频状态同步挂在节流的 `renderStatic`（如 0.15s）上。
- **严禁新增全局可变状态**：禁止新增全局单例或 `static` 暂存区。跨流程传值一律走显式的 `entry params / context`；确需临时桥接时，必须保证**单次消费、读取即清空**，并配套单测守卫。

## 4. 命名、类型与代码风格规范

- **文件与类**：`PascalCase` 且文件名与导出类名严格同名；一个文件只承担一个清晰职责，禁止 `Utils.ts`、`Common.ts`、`Manager.ts` 等大杂烩收容箱。
- **接口与类型**：`PascalCase` 且**强制以 `I` 开头**（`I` 必须在最前，如 `IMailRepository`、`IZCSnapshot`，禁止写成 `ZCISnapshot`）；枚举成员 `PascalCase`；常量 `UPPER_SNAKE_CASE`。
- **变量与函数**：`camelCase`；布尔值以 `is / has / can` 开头；私有属性用 `private` + `camelCase`，**严禁使用 C# 风格的 `m_` 前缀**。函数名须体现动作意图（`load…`、`build…`、`present…`、`handle…`），禁用 `doIt`、`data`、`temp`。
- **模块前缀**：对局玩法 `zcds` 内的类统一以 `ZC` 开头；全仓严禁拼音命名。
- **TypeScript 严格性**：4 空格缩进、单引号、显式分号；纯类型依赖强制使用 `import type`；接口与入参优先标 `readonly`（除非如 `drainBuildingShakes` 需内部替换数组引用）；用 `unknown` 替代 `any`；Cocos Inspector 必填引用标 `null!`，可空引用显式标 `| null`，严禁用 `as any` 或静默 `?.` 掩盖绑定缺失。
- **注释原则**：注释只解释**业务原因、Cocos 引擎陷阱、数学不变式或兼容分支的删除条件**，严禁复述代码字面逻辑。

## 5. Cocos Creator 预制体（Prefab）与静默陷阱守卫

Cocos 引擎中许多配置错误**完全不报错但表现静默失效**，修改或生成 Prefab 时必须核对以下清单：

| 陷阱类别 | 强制规范 | 违背症状（静默失效） |
| :--- | :--- | :--- |
| **图层位掩码 (`_layer`)** | 所有 UI 与棋盘子节点（含 `MapWater`、Spine 根与子节点）必须设为 `UI_2D` | UI 相机直接跳过渲染，画面缺失且控制台零报错 |
| **手写/脚本生成 Prefab** | 每个节点必须显式包含 `cc.UITransform` 组件 | 手写 JSON 不会触发 `@requireComponent` 自动补挂，运行时取宽高或挂 Widget 崩溃 |
| **CUSTOM 尺寸 Sprite** | `sizeMode = CUSTOM(0)` 的 Sprite 必须设 `_isTrimmedMode = false` | 引擎在赋 `spriteFrame` 时把 `contentSize` 强行覆写为裁剪框大小，设计稿尺寸失效 |
| **立绘等比缩放** | 方形原图（如 256×256 立绘）放进非方形设计框时，必须 `sizeMode = RAW(2)` 并由代码按 `frame.height` 等比算 scale | 设为固定框会把角色纵向拉伸变形 |
| **借用带 Widget 的节点** | 跨父级借用节点（如借 `ConfirmSpawn` 绿勾到 `mapLayer`）必须先 `widget.enabled = false`，销毁前归还父级与 Widget | Widget 每帧按原父级边距把节点拽回屏幕底部，覆盖代码写入的世界坐标 |
| **属性序列化覆盖** | 修改组件代码中 `@property` 的默认值（如 `entranceProgress`、`driftDistance`）时，必须同步更新 `.prefab` 中的序列化值 | 面板序列化值优先级高于代码默认值，只改代码在运行期完全不生效 |
| **双通道顶点染色** | 同时支持序列帧（`Sprite`）与骨骼（`sp.Skeleton`）的组件写色必须写 `if (sprite) ... else if (skeleton) ...` | 漏写 `else if (skeleton)` 会导致所有 Spine 单位永远不变色且无报错 |
| **克隆材质释放** | 每实例独立写 uniform 的材质（如 `pulseFade`）必须 `new Material()` 克隆，并在 `onDestroy` 中显式 `.destroy()` | 共用材质会导致多格同播时互相覆盖 uniform；不销毁则造成非托管内存泄漏 |

## 6. 测试护栏与交付验证标准

1. **三层验证体系**：
   - **纯函数与模型单测（首选、极速）**：曲线计算（`ZCGameViewUtil`）、布局换算（`TerritoryMapLayout`）、状态编排（`TerritoryPresenter`）直接用 `npx tsx --test tests/<name>.test.ts` 验证。测试必须直接 `import` 源码真实函数与常量，**严禁在测试桩里复制算式或写死易过期的中间浮点数**。
   - **Prefab 与源码结构守卫单测**：通过读取 `.prefab` / `.meta` JSON 与剥离注释后的源码正则，断言图层顺序、组件属性（`_enableBatch`、`_isTrimmedMode`）、单属性唯一写入口与接线链完整性。
   - **真引擎端到端探针（`tmp/_*_probe.mjs`）**：涉及复杂节点树装配、动态合批或真实资源加载时，使用探针脚本在引擎环境实测。
2. **交付报告要求**：任务完成时必须明确汇报：**修改了哪些文件、关键架构边界、实际运行的验证命令与通过条数、尚未覆盖的风险**。严禁未跑测试就声称“应该能运行”。

## 7. 专项领域规范与工具链（§7.3）

### 7.3.1 配置导表与引用校验工具链
修改任何 Excel 配置表或卡牌资源路径后，必须按顺序执行以下工具链（严禁手改生成的 `.json` 或 `refGen` TS 代码）：
1. 运行 `tools/config`：将 Excel 导出为 `json`、`remoteRef` 与 `refGen` 类型定义。
2. 运行 `tools/ref`：将产物同步至工程目录并执行引用守卫检查。
3. 运行 `python tools/pvp_card_check.py`：逐行校验卡表中每个 `unitPrefabPath` 对应的 `assets/resources/<unitPrefabPath>.prefab` 真实存在（在编译/提交期拦截，避免等到运行时才报 `Bundle resources doesn't contain ...`）。
4. 产物落地后，通过 Cocos MCP 刷新 `db://assets/remoteRef`。

### 7.3.2 美术碎图自动图集（`auto-atlas.pac`）与单位资源规范
1. **自动图集（`auto-atlas.pac`）拓扑铁律**：
   - 每棵碎图目录树的**最外层一级分类目录**必须放置且仅放置一份 `auto-atlas.pac`（如 `assets/resources/image/<分类>/`、`assets/resources/icons/<分类>/`）。
   - `auto-atlas.pac` 会**递归覆盖整个子目录树**（即使父目录自身没有直接放散图也生效，例如 `decor/` 的 pac 已覆盖 `decor/wasteland/`）。
   - **两条严禁**：① **严禁父子目录同时放 pac**（会导致子目录贴图重复打包）；② **严禁在 `image/` 根目录放 pac**（其下 35 个子目录各有独立 pac）。
   - 漏配 pac 引擎**不会报任何错误或警告**，新增美术目录时必须专项核查。
2. **兵种单位美术的两种形态**：
   - **序列帧单位**：路径为 `assets/resources/units/<名>/<名>.prefab`。
   - **Spine 骨骼单位**：路径为 `assets/resources/skel/<目录>/<目录>.prefab`，目录内固定三件套 `<前缀>.atlas.txt`（源 `.atlas` 必须改名为 `.atlas.txt`）+ `<前缀>.png` + `<前缀>.skel`。
   - **Spine Prefab 三条硬约束**：① 根节点与 `spine` 子节点的 `_layer` 均为 `UI_2D`；② `sp.Skeleton.defaultAnimation` 必须设为 `idle`；③ **`sp.Skeleton.enableBatch` 必须开启**（落盘 `_enableBatch: true`，引擎组件默认为 `false`，新建或脚本生成时必须显式写入）。
3. **卡表路径与目录命名关系**：
   - 卡表 `unitPrefabPath` 统一使用**正斜杠**（如 `skel/<目录>/<目录>`），走 `units/**` 还是 `skel/**` 唯一以卡表为准。
   - **目录名 = Prefab 名，但不必等于卡牌显示名**（如卡名 `豌豆游侠` 对应目录 `豌豆射手`，卡名 `巨力坚果` 对应目录 `坚果`；美术源文件夹名如 `金发老板exp`、`吞噬大嘴花exp` 不得直接作为工程目录名）。
   - 唯一硬约束是 `assets/resources/<unitPrefabPath>.prefab` 真实存在且通过 `tools/pvp_card_check.py`。**改目录名或挪位置必须同步改卡表**；仅改卡牌显示文案则无需动目录。

### 7.3.3 ~ 7.3.11 对局表现层与领地专项规范（已拆分独立维护）
为保持主架构文档轻量清晰，原 §7.3.3 ~ §7.3.11 的完整规格说明与回归测试判据已统一收拢至 [docs/zcds-表现层与领地规范.md](https://www.google.com/search?q=.%2Fzcds-%E8%A1%A8%E7%8E%B0%E5%B1%82%E4%B8%8E%E9%A2%86%E5%9C%B0%E8%A7%84%E8%8C%83.md)，章节映射如下：
- **原 §7.3.3**（棋盘图层、地块/建筑/特效缩放、资源抬层、地块激活脉冲∥缩没、出生与产金抖动、邻格延迟、城墙排序）➔ 见专项规范 **§1、§8、§9.5**
- **原 §7.3.4**（金卡「传说卡出场横幅」`ZCGameLegendBanner` 与扇入动画）➔ 见专项规范 **§2、§9.4**
- **原 §7.3.5**（「冒险」领地页 `TerritoryPage` 职责切分、Presenter 纯度与台面中心对齐）➔ 见专项规范 **§3**
- **原 §7.3.6**（其他玩家席位单位暗色叠加 `#828282`）➔ 见专项规范 **§4**
- **原 §7.3.7**（自选主城模式 World 层表现与借用绿勾确认按钮）➔ 见专项规范 **§5**
- **原 §7.3.8**（战斗飘字「快进慢出」45%/55% 单旋钮曲线与收尾漂移）➔ 见专项规范 **§6**
- **原 §7.3.9**（开局归属扩散波 `ZCClaimWave`）➔ 见专项规范 **§7**
- **原 §7.3.10 ~ §7.3.11**（体验反馈专项：胜利三段式扫场 row8、描边同步 row9、开局金矿闪烁 row10）➔ 见专项规范 **§9.1 ~ §9.3**
