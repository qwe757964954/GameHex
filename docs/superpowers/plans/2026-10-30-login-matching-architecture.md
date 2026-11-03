# Login and Matching Architecture Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task in the original D:/City1001/Demo3.8 checkout.

**Goal:** 登录、匹配沿用外部组合层拥有控制器的工程架构。

**Architecture:** Procedure 仅承接流程生命周期；Composition 组装 View、Controller 与适配器；ControllerBase 复用事件与清理。View 经 owner 作用域事件上报意图及生命周期。

**Tech Stack:** Cocos Creator 3.8、TypeScript、tsx node:test。

**Spec:** docs/superpowers/specs/2026-10-30-login-matching-architecture-design.md

## Global Constraints

- Page 不持有 Controller/业务根/控制器回调；framework 不引用 app。
- 网络、资源沿用已有服务；不改生成产物或并行改动。
- 保留正式服务端开战确认、搜索 3 秒与成功展示 1.4 秒；退出先解除输入/请求/调度，再销毁节点与资源。

## Review Focus

- bootstrap、登录/注册、弹窗加载途中退出，不再写视图、发后续请求或导航。
- 登录成功后的延迟与连点互斥，重连会话不随登录页销毁而失效。
- 开战响应与最短展示先后顺序任意；只有二者都满足才展示成功且只导航一次。
- PVP 资料与本局战斗资料任意顺序合并，不混入已退出会话数据。
- 匹配取消释放未移交 preload，移交后的资源继续归战斗流程。

## Task 1: 登录

- [x] 写所有权/登录取消/意图作用域/选服/连点测试并观察 RED。
- [x] LoginController、LoginComposition、纯 View 与选服意图契约；修正 LoginRoot 归属和 await 取消边界。
- [x] 验证登录协议、生命周期、选服、断线重连及视图意图守卫。

## Task 2: 匹配

- [x] 写最短搜索/权威回包/失败退出/资料交错/资源移交测试并观察 RED。
- [x] MatchingModel/MatchingController/MatchingComposition，Procedure 与 Page 去业务回调。
- [x] 验证匹配资源、资料、UI、开战与退出生命周期。

## Task 3: 工程规范与交付

- [x] 工程规范增加所有权、依赖、生命周期、迁移范例和最小验证入口；新增架构守卫。
- [x] Cocos 资源刷新、类型诊断、定向测试、全量测试快照、独立审查，记录真实限制。

用户明确要求沿用同一设计并执行；沿用当前分支，不另建工作区，不再次审批已确定的架构。

后续业务迁移范围见 `docs/工程架构迁移清单.md`。本计划完成状态仅指登录、匹配两条链路；全量测试与类型诊断的限制以验证记录为准。
