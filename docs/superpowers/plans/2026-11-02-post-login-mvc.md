# 登录后加载 MVC 实施计划

沿用已确认的外部组合架构，使用 executing-plans 在当前工作区实施；保护既有卡牌与并行大地图修改，不提交版本库。

设计：ProcedurePostLogin 只转发 preload/enter/cancel/leave/destroy。PostLoginComposition 创建并拥有 Controller 和 LaunchProgressUI，装配身份存储、章节仓库和音频端口；Controller 编排准备、加载通知、错误与导航，继承 ControllerBase 解除订阅。无需为无独立业务状态的加载页机械新增 Model；身份解析和进度映射用纯函数。

契约：入口与缓存身份分别完整校验，不混合角色/服务器；合法入口优先，缺失时恢复缓存，损坏缓存不阻塞进主城。章节刷新仍属账号仓库的后台同步。进度沿用热更实际进度起点、会话 70% + Main 30%；准备失败保留错误遮罩，取消后不显示迟到进度、错误或导航。Main 成功切入时沿用其现有移除遮罩契约；非 Main 退出/销毁则移除本轮 UI。共享 session prepare 不因单个流程退出而清空。

- [x] 新增真实控制器行为测试与纯身份/进度测试，先确认失败，再实现。
- [x] 新增 PostLoginController、纯契约和 PostLoginComposition；Procedure 只持有组合对象并转发生命周期。
- [x] 更新原加载回归与组合层生命周期测试，验证进度衔接、预加载取消、重复进入、失败与遮罩交接。
- [x] 运行相关流程、资源归属、视图/caller 护栏；刷新 Cocos，记录类型诊断及覆盖限制，更新迁移清单。

实际结果与覆盖限制见 [验证记录](2026-11-02-post-login-mvc-validation.md)：45 项通过，工程类型检查仍有存量错误。
