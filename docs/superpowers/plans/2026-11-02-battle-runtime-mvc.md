# 战斗运行期 MVC Implementation Plan

目标：按已确认方案拆出 ZCGame 中的模型推进、HUD 输入和结算用例；不改规则、选点和表现算法。使用 writing-plans / executing-plans，在当前工作区单 Agent 实施，不提交。

架构：BattleComposition 显式拥有 ZCBattleRuntimeController、ZCBattleSettlementController 和 ZCGame。运行控制器持有模型、同一随机源、既有阶段与选点模型，监听 HUD 意图和带 owner 的帧事件；结算控制器持有请求、弹窗及导航订阅。ZCGame 实现展示端口，不保存业务控制器或回调。通用机制复用 ControllerBase，规则复用 ZCGameModel / ZCSpawnSelection / ZCBattlePhaseController。

契约与不变量：固定地图和选点结束只创建一次模型；同一种子维持随机消费顺序；动态每帧、静态沿用 0.15s 节流；终局帧仍 tick，然后等待镜头和扫场才结算，撤退直接结算；先挂结果等待再上报；服务端胜负优先；重复意图不上报两次；关闭后迟到窗口立即关闭，不再加载奖励或导航；结算确认先关窗口，导航取消后原样重开；退出解除时钟、事件、网络 caller、结果等待及导航订阅，先关展示再释放资源。

文件：新增 application/ZCBattleRuntimeContract.ts、ZCBattleRuntimeController.ts、ZCBattleSettlementController.ts；修改 ZCGame.ts 为展示适配、BattleComposition.ts 为唯一装配点、ZCBattleController.ts 支持外部初始化与释放用例。相关行为测试直接测试真实控制器，展示契约和调用位置护栏跟随迁移，不复制业务算法。

- [x] 写必要的运行期与结算回归测试，先确认缺实现失败。
- [x] 提取结算控制器与运行控制器，迁移模型与输入，组合层装配并接通展示端口。
- [x] 更新受影响测试与规范，验证主链路、选点/扫场/统计/异步取消及架构护栏。
- [x] Cocos 刷新、类型诊断基线比较，记录结果及未覆盖范围。

结果与范围限制见 [验证记录](2026-11-02-battle-runtime-mvc-validation.md)。
