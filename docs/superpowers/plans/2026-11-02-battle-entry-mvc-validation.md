# 战斗入口 MVC 验证记录

范围：外部 BattleComposition 持有 ZCBattleController 与 ZCGame；ProcedureGame 仅转发生命周期，保留 current 数据查询兼容入口。纯入口构筑复用服务端阵容、席位及 unitId 映射、离线 PVE 阵容和守城波次。ZCGame 接收 IControllerResources，PVE Context 只含数据；结果与销毁通知按 runtime owner 派发。

资源：匹配预加载成功后转交单局 Controller scope，直接加载同样归单局；流程 scope 登记会话释放。取消、加载失败、挂载失败、流程退出及组件直接销毁统一清理。先 shutdown 视图、destroy 组件，再释放单局资源。结果去重和捕获账号的存档适配留在控制器与组合层。

## 专项验证

以下命令 92 项通过，0 失败：

```powershell
npx tsx --test tests/battle-entry-controller.test.ts tests/zcds-game-resources.test.ts tests/zcds-matching-preload.test.ts tests/cocos-resource-lifecycle.test.ts tests/zcds-client-combat-config.test.ts tests/bigmap-battle-entry.test.ts tests/battle-preparation-entry.test.ts tests/zcds-battle-statistics.test.ts tests/flow-architecture.test.ts tests/callback-owner.test.ts tests/view-intent-events.test.ts
```

覆盖真实控制器取消/失败/初始化失败、销毁顺序、实例结果隔离与只存一次、直接销毁；真实组合层的匹配预加载接管、直接入口及 current 查询；服务端阵容、seed、SLG 人数、统计映射；PVE Context 无回调、守城波次排序与源配置不变；运行组件事件发送及外部资源注入。

新增控制器测试先运行确认缺实现失败，随后实现并通过。旧测试从 Procedure 私有字段改为实际挂载与释放结果，入口构筑断言跟随提取位置迁移。

## 扩展验证及基线

```powershell
npx tsx --test tests/zcds-settlement.test.ts tests/zcds-settlement-page.test.ts tests/main-tab-adventure-route.test.ts tests/zcds-rank-board-wiring.test.ts tests/framework-migration.test.ts
```

58 项中 46 项通过、12 项失败。用 HEAD 原始生产源码及对应原始测试对照后，同样 58 项中 46 项通过、12 项失败：结算夹具缺 SpriteFrameCache 依赖、奖励/列表/结算源码断言过期、领地 FALLBACK_CHAPTERS 旧断言、排行榜必填引用断言及 Loader framework 类型导入断言。本批未修改这些展示实现，也未将扩展验证记为通过。

入口类型检查：`npx tsc --noEmit --project .superpowers/sdd/battle-entry-mvc/tsconfig.json`。当前与 HEAD 源码对照均为 70 条诊断，输出逐行一致，无新增诊断。已有问题包括 ZCGameRenderWorld 缺少 goldCounter 参数、旧 engine 声明和 framework 全局类型缺失，工程类型检查仍未通过。

Cocos MCP 刷新 `db://assets/script/app` 成功，新脚本及目录 meta 由引擎生成；错误日志查询返回 0 条。未执行完整游戏对局或发布构建，不以编辑器无错误替代端到端验收。

## 尚未迁移

ZCGame 仍是运行期门面，内部保留模型推进、选点/HUD 输入、弹窗与结算编排。后续先提取战斗用例与结算控制器，再让 Cocos 组件集中负责生命周期、输入转发和渲染；复用既有 ZCGameModel、ZCBattlePhaseController 与表现时间轴，不另造状态机。本批仅标记战斗入口已实施。
