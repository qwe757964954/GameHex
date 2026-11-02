# 工程 Agent 约定

Cocos Creator 3.8.8 + TypeScript。

## 工作方式

1. 修改前检查工作区；保留用户已有改动，不顺手格式化、重构或回退无关文件。
2. 先明确 feature、流程、数据来源与资源归属，再定位实现。存在 `.codegraph/` 时先用 `codegraph_explore` / `codegraph explore`，1～2 次精准查询定位符号、调用链与测试；缺失/过期内容再用 `rg` / 定向读取。无索引则跳过，不自行建立。
3. 不重复读取已有源码；只读相关规范章节。独立查询批量执行，输出限相关片段及失败信息。
4. 优先复用已有模式、类型、文本常量、资源加载器与测试夹具；不另建平行状态机或工具类。

## 工程约束与业务需求

- 工程约束规定实现方式，业务规格描述功能，历史记录仅供追溯。Agent 不自行补充业务需求，不把具体参数或旧范围升级为全工程红线。
- 本次明确变更同步落实到代码、配置和相关测试；旧参数/旧测试不是拒绝变更的依据，无关行为保持原样。涉及协议或资源事实先核实契约，不能单侧修改。
- 只读本次相关业务规格；发现规格、历史与当前需求冲突时说明差异，无法确定目标再询问。历史记录不作为必读规则。

## 按风险选择流程

本仓库按风险执行，不以宽泛技能触发词增加流程。

- 文案、常量、局部样式、文档整理：定位 → 修改 → 针对性验证；不强制头脑风暴、书面设计/计划、TDD、多 Agent 或多轮审查。
- 业务规则、状态、异步与生命周期：先明确输入、输出、错误/取消语义与不变量，再追踪调用链，新增/更新必要回归测试。
- 跨模块、新系统或资源归属重构：先做简明设计与实施计划，再分步实现、验证边界；需求或方案已确认时不重复确认。
- 技能只加载明确适用的部分。默认单 Agent；仅在用户明确要求或适用仓库约定要求时委派。
- 先跑绑定的最小验证集；跨模块或公共契约变更再扩到受影响范围。检查通过且无新改动/疑点时不重复运行。纯文档修改检查迁移完整性和引用即可。

## MVC 职责与数据流

新增/重构 feature 遵守以下职责；详见 [MVC 设计规范](docs/agent/MVC设计规范.md)。

| 角色 | 负责 | 禁止 |
| --- | --- | --- |
| Model（M） | 业务状态、规则、不变量；输出状态变化 | 引用 Cocos 节点、控制视图、广播全局 UI 事件 |
| View（V） | 生命周期、输入、幂等渲染；经 EventMgr 派发意图 | 持有 Controller/Entry、业务回调、业务扣费与网络请求 |
| Controller（C） | 集中接收意图/推送，调用 Model 与仓库，输出展示数据/命令；管理请求、时钟与资源归属 | 堆积领域算法、用节点状态当业务真源 |

事件流：View → Intent → Controller → Model/Repository → Controller → 只读 ViewState / 展示命令 → View。Model 的实例输出由 Controller 订阅，View 不直接修改 Model。
组合层（bootstrap 的 Composition 或既有 Entry）创建并持有 M/C/V，流程持有组合对象；Page 不创建、保存或释放 Controller/Entry，只报告带作用域的生命周期事件。禁止回调穿透；可用性用 hasXxx/canXxx 数据表达，事件在 onInit/onLoad 绑定，不加“只绑一次”门闩，按钮 handler 不重复判 interactable。

## 通用红线

- 依赖从外向内：`app/bootstrap → app/procedure、app/<feature>/application、view → core`；`platform` / `framework → core`。`core` 为纯 TS，禁止引入 `cc/framework/app/platform`、直接 I/O 或全局服务访问；`framework` 不依赖 feature / `Procedure*`；adapter 不放业务规则。
- 页面经 `GameRoute` 导航。正式流程资源、配置、网络经 `AssetService`、`ConfigService`、`NetworkTransport` 或既有 repository/gateway；feature 禁直调 `resources.load/fetch`。规则放 `model/domain` 或 `core`。
- `await` / Promise 回调之后处理失效与取消：tab 换页销毁，弹窗默认 `cache=false`；`PopupBase` 用 `nextPopupFrame()` 后判 `isValid`，流程预加载判 `context.cancelled`。同步事件、生命周期与组件 `schedule` 回调不重复判 `isValid`。
- caller 直接传真实宿主；退出时统一解除事件、缓存和网络请求。普通组件销毁时 `GameNet.removeCaller(this)`；取消须释放回调并让 Promise 以 `false` 落定。禁止伪造归属或靠派发时判有效代替解除。
- render 幂等、全量赋值；动画用 `startedAt` + 纯函数计算进度，视图不零散建 tween 或累加 dt。`update` 不加载资源、查全局配置、创建临时数组/节点或混业务规则；遵守现有动态/静态节流。
- 单例可用于生命周期内唯一的共享服务；明确初始化归属及必要的重置/释放策略。页面、对局、实体状态优先由宿主持有实例；禁止无归属 static 暂存或借单例绕过分层，详见[单例与状态作用域](docs/agent/单例与状态作用域.md)。
- 必填 Inspector 引用用 `null!`，真可空字段用 `| null`；不以 `as any`、非空断言或静默 `?.` 掩盖错误。`strictNullChecks` 未开启：节点/组件查询及查表不变量直接访问；可空值先窄化，await 前保存局部引用。单例和 prefab 必绑引用直接访问。
- 交互节点在 prefab 挂 `cc.Button`（NONE、target=null），代码只绑 CLICK；禁止 CLICK/TOUCH_END 兜底。Prefab/Scene 用 Cocos MCP 定位验证并刷新，meta 由引擎生成；脚本造节点须有 UITransform，CUSTOM Sprite 设 `_isTrimmedMode=false`。
- 未经明确要求，不直接修改生成文件及 `library/temp/build/native`。改资源/配表遵守下表工具链。

## 按需读取（修改前必须命中对应项）

路径相对仓库根目录；进入子目录时显式打开对应规范，不假定子目录指令自动加载。

| 本次涉及 | 读取入口 |
| --- | --- |
| 单例、共享服务、状态作用域 | [单例与状态作用域](docs/agent/单例与状态作用域.md) |
| MVC 职责划分、Model/View/Controller、Page 与组合层 | [MVC 设计规范](docs/agent/MVC设计规范.md)，再查架构规范中对应模块的归属章节 |
| 分层、跨模块、Procedure、资源/控制器归属 | [架构规范](docs/AI架构与代码规范.md) §2 及对应模块归属章节 |
| 视图事件、按钮、caller、异步、池化、渲染 | [架构规范](docs/AI架构与代码规范.md) §2.1、§2.2、§3；[开发细则](docs/agent/开发细则.md) 对应条目 |
| 引用、类型、命名、风格 | [开发细则](docs/agent/开发细则.md) 的引用与类型、命名与风格 |
| Prefab、Sprite、碎图、Spine、导表 | [架构规范](docs/AI架构与代码规范.md) §5、§7.3；[开发细则](docs/agent/开发细则.md) 工具链条目 |
| 对局、领地、共享奖励/HUD 表现 | [规范路由与最小验证](docs/agent/规范路由与最小验证.md)仅定位相关规格与测试，不承载业务要求 |
| 大地图、基地玩法 | [大地图实现说明](docs/bigmap-系统实现说明.md)相关章节，结合本次需求及当前协议/配置核对 |
| 提交、发布或版本库操作 | [版本库约定](docs/agent/版本库约定.md)；Git/SVN 双库、中文日志、TortoiseProc 及人工确认要求均有效 |

## 验证与交付

- 视图意图改动跑 `npx tsx --test tests/view-intent-events.test.ts`；caller 改动跑 `npx tsx --test tests/callback-owner.test.ts`；其余按相关流程/模块测试及路由绑定集验证。
- 测试直接 import 真实函数/常量，不复制算法；结构约束用守卫，业务规则用行为测试，复杂引擎行为用探针；详见架构规范 §6。
- 交付简述修改文件、关键边界、实际验证命令/结果及未覆盖风险。未运行不声称通过；无依据不承诺 token 或耗时降幅。
- 规则维护：入口只放 MVC 与通用约束；业务规格/历史记录按需读取，复用既有护栏。根文件维持 6～8 KiB。
