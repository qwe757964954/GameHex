# 卡牌升级与布阵弹窗 MVC

已确认沿用工程统一架构，直接实施本链路。所有权：PopupManager → 通用弹窗组合会话宿主 → app/bootstrap/card 组合对象 → Controller + View；Page 不保存 Controller/Entry/业务闭包。framework 只接收通用工厂端口，不引用 app。

弹窗管理器在 Page.onInit/onOpen 完成后创建外部组合会话并等待其首屏准备；关闭/销毁/打开失败先取消组合会话，再释放节点和资源。cache:true 重开创建新会话，旧异步回包不得影响新会话。沿用真实 caller 和既有回调归属，关闭让等待打开的 Promise 落定。

CardUpgradeModel 保存卡牌 id、等级、阶段与材料状态；CardUpgradeController 订阅 owner 作用域意图，读取升级状态、互斥提交、派发 HeroUpgraded，失败恢复可重试且不改等级。LoadingPopup 租约在请求结束或会话退出时只释放一次；迟到结果不改缓存、不派发结果事件、不打开技能窗。View 保留图标加载和全量渲染。

布阵继续复用 LineupDraftStore 与 buildPresetDecks；新 LineupBoardModel 拥有草稿及保存状态，Controller 处理方案切换、上/下阵、清空、保存。保存失败保持 dirty，成功只提交本次保存的快照；在途编辑不会被错误标成已保存，且结果事件携带实际提交的阵型与英雄列表。方案切换仍不额外发选中请求。Page 只收只读 ViewState、展示资源并派发意图；子卡片保留指向页面的展示输入宿主，不直达 Controller。

沿用 prefab 字段和布局、现有 Repository/升级纯规则/美术服务。控制器继承 ControllerBase，统一解除事件和请求；视图展示资源继续由 PopupBase 的每次打开作用域持有。保护所有并行大地图及文档改动。验证包括控制器行为、弹窗工厂生命周期、缓存重开、关闭取消、结果刷新链路与原有卡牌 UI 回归。
