# 战斗运行期 MVC 验证记录

日期：2026-11-02。延续战斗入口拆分；本批完成模型推进、HUD 输入、结算编排的外部装配，未提交代码。

## 实现边界

- `BattleComposition` 创建并释放单局运行控制器、结算控制器和展示组件，提供网络、弹窗、导航及引擎调度端口。
- `ZCBattleRuntimeController` 持有 `ZCGameModel`、选点模型、同一随机源和既有阶段对象；集中订阅 HUD 意图，处理带实例 owner 的帧事件，保持动态每帧和静态 0.15s 刷新。
- `ZCBattleSettlementController` 负责先等待再上报、服务端胜负覆盖、奖励解析、弹窗及返回。确认先关闭弹窗，导航取消后复用首次结果重开；退出取消 caller 请求、结果等待和导航订阅。
- `ZCGame` 只接收展示数据与资源，提供镜头、扫场、选点 HUD 和渲染端口，不保存控制器、业务回调或规则模型。HUD 读取模型的查询类型，不获得推进接口。选点结束先同步资源并渲染，再启动归属扩散波。
- 沿用现有规则、选点、阶段和表现实现；未另建状态机，也未调整美术资产。

## 验证结果

专项命令：

```powershell
npx tsx --test tests/battle-runtime-controller.test.ts tests/battle-entry-controller.test.ts tests/zcds-matching-preload.test.ts tests/zcds-client-combat-config.test.ts tests/bigmap-battle-entry.test.ts tests/zcds-battle-statistics.test.ts tests/view-intent-events.test.ts tests/callback-owner.test.ts tests/zcds-guide-lazy-lifecycle.test.ts tests/zcds-spawn-frame-report.test.ts tests/zcds-seeded-random.test.ts tests/zcds-settlement.test.ts tests/zcds-game-resources.test.ts tests/flow-architecture.test.ts
```

112 项通过，0 失败。覆盖帧实例隔离、事件单次消费、刷新节奏、终局扫场等待、撤退防重、选点建模与 op=4、各席位统计、SLG 结果、图鉴延迟打开、资源释放、迟到结果/窗口和请求失败。

```powershell
npx tsx --test --test-name-pattern 'PVE settlement|只在自选主城局|外部战斗控制器' tests/main-tab-adventure-route.test.ts tests/zcds-territory-claim-wave.test.ts tests/zcds-settlement-page.test.ts
```

3 项通过，0 失败。返回参数同时有纯函数行为测试，覆盖世界地图、领地章节/格子焦点及普通返回。

扩展受影响测试集共 433 项：401 通过、32 失败。用本批修改前保存的 `ZCGame.ts`、`BattleComposition.ts`、`ZCBattleController.ts` 源码替换读取，再执行同一组当前测试，得到 386 通过、47 失败；当前 32 个失败名称全部存在于该对照。对照沿用当前测试与其余文件，属于此次提取的源码边界对照，不是干净提交的全仓回归。15 个额外对照失败主要是已经迁移到新接口的接线断言，不能解释为修复了 15 个旧缺陷。

剩余失败涉及既有规则/配表夹具、奖励页旧结构断言、表现层旧模型签名和选点 prefab 守卫等。未据此宣称全仓测试通过，也未扩大本批范围修复它们。执行文件清单及日志保存在本地 `.superpowers/runtime-expanded-files.txt`、`.superpowers/runtime-expanded-final.log`、`.superpowers/runtime-expanded-baseline-final.log`。

类型检查使用入口依赖图配置 `.superpowers/sdd/battle-entry-mvc/tsconfig.json`：当前与源码对照均为 70 条诊断，诊断集合一致。新增控制器、契约、组合层和改动的展示组件没有新增类型诊断；全工程类型检查仍未通过。

Cocos MCP 已刷新 `db://assets/script/app`，新增脚本 `.meta` 已由引擎生成，查询返回 0 条 error 日志。未进行真实服务器对局或编辑器内完整游玩；镜头、选点、扫场和结算的最终视觉效果仍需运行验收。
