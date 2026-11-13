# 对局地图野怪巡逻实施计划

**目标**：资源点增加可选 `patrolCells`，保留既有唤醒条件；唤醒后逐格巡逻、攻击时停下、死亡仅结算一次。旧地图不变。

**设计依据**：本聊天已确认的方案。复用资源格身份与 `ZCNeutralFeatureSystem`；Model 保存移动时间轴，战斗与 View 共用当前位置。范围绑定点位，不随地形镜像自动复制。

**技术栈**：Cocos Creator 3.8.8、TypeScript、原生浏览器 JS、现有 Python 发布工具。沿用当前工作区，单 Agent，不提交、不发布现有地图。

- [x] 配置：`ZCMapConfig.ts` 解析巡逻格，复用 `ZCMatchConfig.ts` 深复制；校验出生格、连通、虚空、主城和资源点冲突；正式开局 `ZCClientCombatConfig.ts` 保留同坐标同组合的本地地图范围，不修改协议。
- [x] 逻辑：`ZCNeutralFeatureSystem.ts` 复用对局随机源选择可行邻格，记录移动起止格/起始时间/耗时；阻塞等待；`ZCGameTypes.ts` / `ZCSnapshotCodec.ts` 校验及恢复移动状态。
- [x] 战斗：索敌、当前目标和弹道碰撞使用当前位置；保留出生格作为稳定身份和奖励归属；覆盖移动中受击和死亡只结算一次；保留既有范围伤害目标规则。
- [x] 表现：`ZCHexView.ts` 只移动野怪模型、状态标记和血条，按逻辑时间轴幂等渲染，不移动地格节点；领取后复位，不影响原格后续建筑。
- [x] 编辑器：`app.js` / `index.html` 增加选点、涂擦、清空和范围覆盖层；保存/导入/历史/尺寸迁移保留范围；`server.mjs` 保留字段并校验；`map_format.py` 校验发布输入；更新 README。
- [x] 验证：编辑器行为与导出、地图格式、野怪行为、索敌/弹道/快照相关回归；检查改动差异和类型错误。结果见下。

## 验证记录

- `npx tsc --noEmit --pretty false`：通过。
- `npx tsx --test --test-name-pattern='巡逻' tests/zcds-neutral-features.test.ts tests/zcds-hex-activation.test.ts tests/map-editor.test.ts tests/map-editor-server.test.ts tests/map-editor-export.test.ts`：8/8 通过，覆盖阻塞中途暂停与无瞬移恢复、存档非法段、死亡奖励、模型/标记/血条幂等、涂擦/撤销/迁移/导入回滚、保存字段和范围校验。
- `python -X utf8 tests/test_gamemap_patrol.py`：3/3 通过。
- `npx tsx --test tests/zcds-client-combat-config.test.ts`：25/25 通过，正式开局保留范围；后端点位组合改变时不误用旧范围。
- `npx tsx --test tests/map-editor.test.ts tests/map-editor-export.test.ts tests/map-editor-server.test.ts tests/map-editor-static-modules.test.ts tests/zcds-neutral-features.test.ts tests/zcds-projectile.test.ts tests/zcds-projectile-structure-block.test.ts tests/zcds-state-consistency.test.ts tests/zcds-neutral-resource-reward.test.ts tests/zcds-hex-activation.test.ts`：264/268 通过；仅以下 4 项既有失败（无新增失败）：
  - “常规随机池每张地图都投放趣味资源，源预设与发布资源一致并进入开局快照”：`corset.json` 缺少类型 8。
  - “验收地图包含所有新类型，真实模型可开局、推进和重置”：既有 `neutral_fun.json` 缺失。
  - “相邻即自动领取：金币与神器充能都入袋，格子变成已占领且不重复领”。
  - “资源点中立无归属：一方先拿到即锁定，双方都领不到第二次”。后两项用内存加载改动前 HEAD 模型复跑，失败名称、断言完全相同，没有改写工作区。
- `npx tsx --test tests/map-editor.test.ts tests/zcds-initial-tiles.test.ts tests/zcds-spawn-selection.test.ts tests/zcds-seeded-random.test.ts tests/zcds-resource-unit-preview.test.ts tests/zcds-resource-icon-layer.test.ts tests/zcds-neutral-reward-fx.test.ts tests/zcds-artifact-claim-burst.test.ts`：186/186 通过（与上组部分重叠，不累计总数）。
- Chrome 编辑器实操：在内存测试图选野怪、指针涂格、右键擦除、撤销，生成 `[93,104]`，覆盖层和状态文字一致，控制台无警告/错误；截图工具超时，未取得可核对截图。测试图未保存到地图库。
- 本次改动文件 `git diff --check`：通过。临时编辑器服务已停止。

## 边界

不增加共享巡逻区域、路线编辑或追出范围行为。运行时建筑阻塞则停下等待。没有修改或发布现有地图。未运行 Cocos 引擎内实机对局；渲染使用既有视图夹具验证。服务端实现不在本工作区；现有协议只冻结资源点和抽签，客户端按同地图、同坐标、同组合保留范围，多客户端须同步地图资源与客户端版本；未验证服务端重算。
