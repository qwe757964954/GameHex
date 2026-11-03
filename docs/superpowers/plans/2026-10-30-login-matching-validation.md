# 登录与匹配架构验证记录

2026-11-02 在 D:/City1001/Demo3.8 重新验证。

- 登录、匹配、协议、选服、重连、资源转交、视图意图和请求归属的 16 份定向测试：118 项通过，0 失败。原始输出 `.superpowers/sdd/main-tabs-mvc/flows-focused-final.log`。
- 独立审查发现父页面 onLoad 首绘可能抢先使用尚未初始化的子组件；已将 MatchingPage ready 信号移至 start，并补回归测试。
- Cocos MCP 已为 ServerSelectItem 根节点补 cc.Button；transition=NONE、target=null。脚本及 prefab 已刷新，选服 prefab 测试验证其序列化绑定。
- 类型诊断未达到全工程通过：生成 RefEnum 重复标识符、MainTerritoryMap 的 focusBoss 意图类型、ZCGameRenderWorld 参数及旧引擎适配层等仍报错。本次登录、匹配与组合层路径未出现诊断。输出 `.superpowers/sdd/main-tabs-mvc/tsc-flows-final.log`。
- 全量测试：4441 项，4266 通过，175 失败，0 取消。快照输出 `.superpowers/sdd/main-tabs-mvc/flows-full-final.log`；它包含当前仓库并行开发状态，不能将全量错误直接归因于本轮迁移。

追加的工程迁移清单是后续范围说明；卡牌弹窗、PostLogin、战斗入口及联盟/社交模块未在本轮宣称迁移完成。
