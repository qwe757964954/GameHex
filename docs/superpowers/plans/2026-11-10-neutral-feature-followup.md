# 趣味中立资源补齐

以本次用户规则为准，保留工作区已有实现及配置，单 Agent 原地实施。

## 设计与边界

- 强化门沿用独立源表、同帧单模板、乘法窗口和随机不重复机制。原有缩小门保留：本次仍提到“另外三种”，没有要求删除第四种。
- 割草机沿用实例快照的路径、开始时间、触发时全队总攻击力和命中列表；检查前进时才伤害/占领、建筑/虚空截断与无自由建造权。
- 传送沿用双人投放、邻接兵营、最近敌人和主城方向的出口规则。每批返回出口与入口，向新单位写入入口、兵营与起始时间，避免靠当帧全局状态猜来源。
- 传送抛物线由纯函数和表现时间计算，飞行期间保留出生状态，结束后正常战斗。只延续现有出生规则，不额外赋予无敌。
- 入口与出口复用已加载的 portal 图形，在现有特效池独立开合、回收；次数/冷却圆环不再被开合动画改写。
- 范围、次数、冷却、伤害和速度继续使用正式源表；表现参数集中常量、尺寸按格面推导，不在渲染分支散写魔法数。不新增资源文件或依赖。

## 实施顺序与验证

1. 基线运行 `tests/zcds-neutral-features.test.ts` 与 `tests/zcds-resource-unit-preview.test.ts`。
2. 扩展兵营批次出生契约、单位飞行快照和校验；补真实模型测试：整批一次扣次、入口/出口记录、出生锁定与恢复。
3. 在 `ZCGameViewUtil` / `ZCGameRenderWorld` 补抛物线，在 `ZCEffectPool` 补独立开合图形并删除旧 `renderPortalFlash` 通路。测试起点/中点/终点、复用与回收，以及次数圆环不被覆盖。
4. 检查主城方向最大范围的边界；补回归并复用原有割草机、门测试。
5. 更新 `docs/zcds-趣味中立资源.md`。运行上述相关测试及出生/单位渲染、快照、表现池测试、`npm run check:zcds`，按失败扩大相关范围。

## 未覆盖

用户所述 MP4 未附在当前消息中，项目和文档目录未找到同名视频；本次按描述复用现有图形做开合及抛物线，不声称复刻视频。

## 完成与验证

- 以上步骤已实施；源表已具备本次范围/次数/CD、割草机伤害/速度及门效果参数，本次没有重复加表或另设业务默认值。
- `npx tsx --test tests/zcds-neutral-features.test.ts tests/zcds-portal-flight.test.ts tests/zcds-resource-unit-preview.test.ts tests/zcds-unit-spawn-shake.test.ts tests/zcds-unit-view-render.test.ts tests/zcds-progress.test.ts tests/zcds-spawn-fx.test.ts tests/zcds-hit-fx.test.ts tests/zcds-unit-system.test.ts tests/zcds-render-performance.test.ts tests/zcds-neutral-resource-reward.test.ts`：165/165 通过。
- `npm run check:zcds` 通过；Cocos MCP 核对项目路径并刷新 `db://assets/script/app/zcds`。
- 扩大验证的阻碍：`tests/zcds-model.test.ts` 初始化时缺少 `D:\City1001\doc\塔防数据配置\json\client\pvpBaseTeamWeight.json`；`tests/zcds-neutral-resource-mask.test.ts` 对旧文字兜底条件的连续源码匹配不接受已有的 `!state.neutralFeature` 条件。未改这些无关入口。
- `npx tsc --noEmit -p tsconfig.json` 未通过，有引擎声明和工程/测试诊断。加 `--skipLibCheck --allowSyntheticDefaultImports` 后筛查本次修改文件，仍有 `ZCGameRenderWorld.ts` 原有地块 render 入参的 DeepReadonly 类型不兼容；该入参不属于本次改动。定向模型编译通过不能代表全工程编译通过。
- 未做设备对局视觉验收。
