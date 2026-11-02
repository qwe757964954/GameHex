# 底栏 MVC 实施与验证记录

日期：2026-10-30。改动位于 `D:/City1001/Demo3.8`，分支 `codex/main-tabs-mvc`，未提交或发布。

## 已实施

- `ControllerBase` 统一持有事件订阅、清理动作、销毁状态与资源 scope；先解除输入，再释放资源。
- `MainTabModel`、`MainTabController` 管理七个底栏入口、当前页、加载版本与世界覆盖页；`MainTabHost` 保留节点、首屏 ready、预热和展示适配。
- 商店、英雄、角色、联盟引入各自控制器和作用域明确的意图事件，复用已有数据服务；挑战仍保持原有锁定行为。
- 领地与世界沿用已有控制器，接入基类清理；领地退出时保留模型输出配对收尾的特殊顺序。
- 保留原有外部入口，不改 Prefab。新增脚本已通过 Cocos MCP 刷新并由引擎生成 meta。

控制器之间共享的是生命周期机制；购买规则、角色选择、卡组数据与联盟状态仍由各功能负责。现有子页面的展示代码和其他历史回调未做全仓改造。

## 审查与修复

独立审查确认两项问题，均补充失败用例后修复：退出世界后下一页加载失败时底栏高亮应恢复基础页；英雄升级后重新打开升级入口应立即使用最新等级，不等待权威刷新。相关回归 27/27 通过。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 控制器资源、功能与领地/世界生命周期 | 26/26 通过 |
| 意图事件、回调归属、底栏按钮、联盟通知等边界 | 78/78 通过 |
| 定向集，含领地规定最小集 | 249/250 通过 |
| 全量 `npm test` | 4274 项，4108 通过，166 失败 |
| `git diff --check` | 通过，存在行尾转换提示 |
| TypeScript 全量及缩小范围检查 | 未通过；依赖链仍有生成枚举重复、引擎声明、既有表现层类型错误等；缩小范围日志未出现本次修改生产文件的错误 |
| Cocos MCP 脚本刷新、错误日志查询 | 刷新成功；查询时返回 0 条 error；未进行游戏预览人工验收 |

定向唯一失败为 `tests/territory-cell-center-align.test.ts` 的建筑尺寸断言：`territory_decor_03_v1` 可见高 90.1 超过台面高 90 的 85%。相关资产与该测试未修改，独立 HEAD 基线也复现该失败。

全量失败不能全部判定为既有问题。独立 HEAD 基线为 4129 项、3965 通过、164 失败；基线与当前工作区生成资源、测试可加载范围不同，因此失败数不能直接作差归因。本次导航与功能控制器定向测试已通过，其余全量失败仍需单独排查，不能据此宣称工程全绿。

完整日志与失败名称清单保留在本机忽略目录 `.superpowers/sdd/main-tabs-mvc/`：`.mvc-tests-final.log`、`full-test-failures.txt`、`.mvc-focused-tests.log`、`.mvc-baseline-tests.log`、`.mvc-scoped-typecheck.log`。

定向验证命令：

```powershell
npx tsx --test tests/main-tab-controller.test.ts tests/main-feature-controllers.test.ts tests/main-tab-lazy-loading.test.ts tests/bigmap-fullscreen-entry.test.ts tests/card-lineup-ui-regression.test.ts tests/controller-resources.test.ts tests/component-controller.test.ts tests/bigmap-controller.test.ts tests/bigmap-mvc-boundary.test.ts tests/territory-controller.test.ts tests/territory-cell-subscriptions.test.ts tests/game-view-click.test.ts tests/view-intent-events.test.ts tests/callback-owner.test.ts tests/territory-presenter.test.ts tests/territory-page-split.test.ts tests/territory-cell-center-align.test.ts tests/territory-hex-flip.test.ts tests/territory-building-shake.test.ts tests/territory-hex-spawn.test.ts
```

## 工作区说明

保留用户原有 `TerritoryModel.ts`、`territory-presenter.test.ts` 和执行期间出现的 `client_proto/protoCompiled.proto` 改动。

基线验证所建托管 worktree 位于 `C:/Users/hedao/.codex/worktrees/mvc-baseline-check/Demo3.8`。应用将其设为当前聊天的主 checkout，归档接口因此拒绝移除；关联原始目录的接口也拒绝非托管 checkout。本次实现始终留在 D 盘原目录，基线目录中没有本次实现。未修改应用内部存储以绕过接口限制。

## Page 所有权修正后的最终记录

用户反馈“Page 持有控制器不合理”后，已将所有权改为：

```text
ProcedureMain
  └─ MainTabsComposition
       ├─ MainTabController
       └─ MainPageComposition
            └─ 各功能 Controller / TerritoryEntry
```

组合对象位于 `app/bootstrap/main`，在节点挂载前完成组装。MainTabHost、MainPage、MainTerritoryMap、CardLineupPage、RolePage、StorePage、LeagueTabPage 不再创建、保存或 dispose Controller/Entry；展示资源通过契约注入。ready/enabled/disabled/destroyed/presented 事件由外部组合层订阅，View 无控制器引用或其释放回调。快速寻敌改派发 focusBoss 意图，首屏完成改派发 presented。已有宝箱、装备展示等存量业务并未在本轮作全仓迁移。

最终验证快照：

- 含流程、页面组合、导航、视图边界及领地规定最小集：326 项，325 通过，1 项建筑尺寸断言失败，与上文同项。
- 补充构造失败回滚后，页面所有权与组合测试：5/5 通过；资源归属、预下载、返回焦点、宝箱生命周期及页面组合回归：18/18 通过。
- 独立审查：相关 18 项通过，未发现可明确复现的重要问题。
- 全量第一次快照：4278 项，4108 通过，170 失败；其中 4 项仍断言原 Page/Host 内的组装位置，已改为验证外部组合与注入契约。
- 全量最终快照：4190 项，3997 通过，193 失败。验证期间工作区另有大世界配置与业务代码变更（包括 gameConfig、BigMapConfigLoader、BigMapModel、BigMapCampRepository 等）；额外失败出现“跨天禁攻分钟非法：undefined”、资源配置和据点状态等错误。测试可加载范围与运行内容已变，不能与前次数字直接作差归因。这些并行改动未覆盖、回退或纳入本次修复。
- TypeScript 缩小范围检查仍因依赖链错误未通过；该次日志中没有本轮修改生产文件的诊断。git diff --check 通过。
- Cocos 脚本刷新成功，查询返回 0 条 error；未作游戏预览人工验收。新增脚本与目录 meta 由引擎生成。

日志在本机忽略目录 `.superpowers/sdd/main-tabs-mvc/`：`ownership-focused.log`、`ownership-resources.log`、`ownership-final-boundary.log`、`ownership-full-final.log`、`ownership-typecheck.log`。以上结果取代上文初次交付的结果作为最新快照。
