# 登录后加载 MVC 验证记录

日期：2026-11-02；工作区：D:/City1001/Demo3.8。

## 实现

- `ProcedurePostLogin` 仅持有外部组合对象并转发 preload、enter、预加载取消、leave 和 destroy。
- `bootstrap/login/PostLoginComposition` 创建控制器与启动 UI，装配 localStorage 身份读取、章节仓库、音频及导航。页面不持有控制器或业务回调。
- `loading/PostLoginController` 继承 ControllerBase，编排身份初始化、共享会话 prepare、Main 加载通知、错误与导航；退出解除订阅，迟到 prepare 进度/结果不会更新旧 UI 或导航。
- `PostLoginContract` 纯函数校验完整角色/服务器身份并映射加载进度。合法入口优先，否则恢复缓存；不跨来源拼接身份，损坏缓存不阻塞主流程。大整数角色 id 以字符串保留。
- 启动 UI 重建前读取热更留下的实际进度，保留剩余区间 70% 会话 / 30% Main 的映射。Main 报告首屏完成后按现有契约交接遮罩；准备中退出或销毁则释放本轮 UI。
- 章节汇总仍由账号仓库管理后台同步；退出流程不清空共享快照或 session 资源。未新增 Model 状态机、网络接口或 prefab。

## 验证：45 / 45 通过

```powershell
npx tsx --test tests/post-login-controller.test.ts tests/post-login-loading.test.ts tests/flow-architecture.test.ts tests/main-page-ownership.test.ts tests/procedure-manager-preload.test.ts tests/view-intent-events.test.ts tests/callback-owner.test.ts tests/hot-update-core.test.ts
```

覆盖启动去重、进度连续映射、热更跳过、身份优先级/非法缓存、准备失败、Main 失败、退出后迟到成功/失败、预加载取消、重复进入、UI 缺失、正常遮罩交接，以及既有热更和流程取消资源行为。控制器用例先确认缺少实现时失败，再实现通过。

日志：`.superpowers/sdd/post-login-mvc/tests.log`。

## 类型、编辑器与覆盖限制

- `npx tsc --noEmit -p .superpowers/sdd/post-login-mvc/tsconfig.json` 未通过，仍由旧 engine/framework 全局类型与类型兼容错误阻塞；诊断未落在本批 PostLogin 文件。完整输出在同目录 `typecheck.log`，不能宣称全工程类型检查通过。
- Cocos MCP 刷新 `db://assets/script/app` 成功，新增脚本 meta 由引擎生成；刷新后读取编辑器错误日志为 0 条。
- 本批文件 `git diff --check` 通过。未进行真实账号登录、服务端章节回包和完整主城点击验收。
- 保留既有卡牌架构改动与并行大地图修改，未提交版本库。后续迁移范围为战斗入口。
