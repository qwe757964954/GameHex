# 卡牌升级与布阵 MVC 验证记录

日期：2026-11-02；工作区：D:/City1001/Demo3.8。

## 已实施

- `PopupManager` 注入通用组合工厂，`PopupCompositionHost` 管理每次打开的会话。关闭、直接销毁宿主、管理器退出及打开失败均释放会话；未完成的首屏等待立即取消；缓存重开创建新会话。framework 不依赖 app。
- `bootstrap/card/CardPopupComposition` 创建并持有升级/布阵 Model 和 Controller。Page 没有控制器、业务请求或草稿实例，只接收展示快照、加载展示资源并派发 owner 意图。保留原 prefab 绑定。
- 升级沿用既有升级规则和 Repository；请求防重，失败保留原等级；Loading 租约在结束或退出时释放一次。真实 Controller 作为 caller，退出解除；迟到结果不写缓存、不发成功事件。
- 布阵沿用 `LineupDraftStore` 和 `buildPresetDecks`。保存捕获方案与英雄列表；在途编辑/切换不标新草稿为已保存，不触发自动关闭。草稿的 dirty 按方案记录，保存一个方案不会清掉其他方案的修改。结果事件刷新现有卡牌页控制器。

## 专项：61 / 61 通过

```powershell
npx tsx --test tests/card-popup-controllers.test.ts tests/popup-lifecycle.test.ts tests/popup-composition.test.ts tests/card-lineup-ui-regression.test.ts tests/formation-board.test.ts tests/card-architecture.test.ts tests/view-intent-events.test.ts tests/callback-owner.test.ts
```

含意图实例隔离、解锁仍需材料、经验合计与满级规则、重复提交、失败及异常重试、请求期间关闭、技能入口、保存快照、跨方案未保存状态、closeAfterSave，以及升级/保存 → 主 tab 刷新和退出解除订阅。初始控制器测试和宿主测试均先确认缺少实现时失败，再实现通过。

日志：`.superpowers/sdd/card-popup-mvc/targeted-tests.log`。

## 扩展检查及限制

1. `npx tsx --test tests/card-upgrade.test.ts tests/card-head-icon.test.ts`：13 通过、8 失败。7 项旧升级断言继续使用已重编号的 `66001`、旧卡数 34 或将现有 `68001` 判为无配置；头像断言预期 44，当前映射为 50。本批未修改配表、头像资源或升级算法；新增固定输入的真实规则测试验证解锁/材料/满级，避免以旧编号判断本次架构。未为通过测试修改资源事实。
2. `npx tsx --test tests/popup-blank-close.test.ts tests/popup-fullscreen-widget.test.ts tests/reward-popup-wiring.test.ts tests/main-tab-controller.test.ts tests/main-tab-lazy-loading.test.ts`：32 通过、4 失败。3 项全屏清单规模/代表项断言与现资源位置不一致，1 项奖励全仓扫描列出大地图/领地 5 条请求未接 FW.ShowReward；不属于本次卡牌改造。
3. `npx tsc --noEmit -p .superpowers/sdd/card-popup-mvc/tsconfig.json` 未通过：工程仍有生成枚举重名、旧引擎/全局类型和其他模块错误。诊断未落在本批卡牌、PopupManager/PopupCompositionHost、ProcedureBootstrap 文件；不能据此宣称全工程类型检查通过。日志 `typecheck.log` 保留完整结果。
4. Cocos MCP 确认当前项目为 D:/City1001/Demo3.8；刷新 `db://assets/script` 成功，引擎生成新增脚本/目录 meta。读取编辑器错误日志返回 0 条。未进行真实服务器升级扣费、保存阵型和完整游戏点击验收。
5. 本批文件 `git diff --check` 通过。保留并行大地图及原有文档改动；未提交版本库。

扩展日志分别为 `.superpowers/sdd/card-popup-mvc/config-resource-tests.log` 和 `popup-integration-tests.log`。上述限制与专项结果分开记录，不代表全仓测试通过。
