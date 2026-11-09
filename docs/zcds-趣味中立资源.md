# 趣味中立资源

本轮以钉钉需求的“简明修正版”为准；用户确认待定项沿用现有规则。旧的六类资源和原有地图资源点保留，常规地图补充趣味中立资源。

## 配置入口

源表：`D:\City1001\doc\塔防数据配置\PVP-中立资源配置.xlsx`，工作表“中立资源组合”。运行 `npm run config:export` 发布压缩 JSON；资源值不在脚本中另设一份。

| groupId | 新资源 | resourceType |
| --- | --- | --- |
| 14001～14004 | 加法、乘法、缩小、放大门 | 7 |
| 14005 | 随机轮换强化门 | 7 |
| 14006 | 衍生地块 | 8 |
| 14007 | 传送门 | 9 |
| 14008 | 号角 | 10 |
| 14009 | 随机野怪（同组每局固定一种） | 11 |

门参数：`effect` 为 add/multiply/shrink/enlarge；`mode` 为 fixed/random；`value` 为加法数量或乘法倍率；`cooldownSeconds`、`windowSeconds` 控制时间；`scale`、`hpFlat`、`moveMultiplier`、`attackSpeedMultiplier`、`damageMultiplier` 控制体型和属性。乘法、缩小及随机模式的窗口必须大于 0。源表给出基础调试值，数值调整仍由该表完成。

衍生、传送、号角参数为 `{}`。野怪参数为卡牌字符串 `resId`、`wakeRange`、`attackRange`；唤醒使用地图邻接最短距离，攻击范围独立。卡牌引用在加载边界校验，预加载复用已有单位资源入口。

## 状态与接入

- `ZCNeutralFeatureSystem` 为每局实例；冷却、判定窗口、格内单位、领取状态、衍生线建造权、传送出口和野怪锁敌均保存于格子快照。重开重新初始化，恢复不重发一次性收益。
- 门通过移动前后脚点检测穿越；停留不重复触发。两方共用窗口和冷却。门和传送门不进入攻击候选，可通过原有占领流程易手。
- 克隆走原有产兵入口和人口上限，继承基础属性、门效果及最大生命，满血出生；当前状态使用独立实例和原剩余时间复制，常驻被动不丢失，也不把加成重复固化。
- 衍生线借用原有付费开发入口；失败不耗建造权，成功落建筑时消耗一次，并占领相邻无资源中立格。后续仍按普通锚点规则扩张。
- 周期产兵、首波和号角波共用兵营批次入口；仅改变出生格，不更改原兵营时钟。出口变化只影响之后出生的单位。
- 野怪复用格子生命与建筑目标命中链；睡眠不入索敌、不能受伤，唤醒后原地锁敌，脱战保留生命。死亡只发一次现有单位击杀金币奖励。
- 强化门、衍生地块、传送门使用新增透明图标，号角复用现有黄金号角素材，野怪复用已有单位待机骨骼和格子血条。对局不显示趣味资源的名称、状态或冷却文字，图标缩小至原来的 85%。四种门分别使用 `gate_add`（绿、多兵）、`gate_multiply`（金、分裂分支）、`gate_shrink`（蓝、内收箭头）、`gate_enlarge`（红、外扩箭头）；随机门按快照中的当前 effect 切换图标。
- 强化门冷却时图标变暗，现有圆环按配置总时长与快照 readyAt 显示恢复进度；窗口生效时显示完整放大亮环，可用时收起。冷却配置在资源抽取接入时注入视图，不在帧循环查表；换格和选点时恢复原圆环尺寸。

图标位于 `assets/bundles/battle/image/map-resource/`，沿用该目录的自动图集。`ZCGameLoader` 使用本局 AssetService/scope 从 battle 包加载，经过 `ZCGame`、`ZCGameRenderWorld` 注入地块视图；趣味资源缺图时也不回退文字。新生成的三张图标按 256×256 导入。

地图编辑器从同一个 battle 目录提供图标；组合点预览最高正权重项，强化门由配置 param.effect 选择对应变体，不参与或改变游戏随机抽取。左栏提供带名称的组合 ID 候选和当前画笔图标，画布保留组合编号与悬停名称；野怪按 param.resId 引用卡牌 buildIcon，不再统一使用大嘴花示意图。修改候选卡牌后重启编辑器服务以更新预览资源清单。

野怪类型由各自单位骨骼区分；沉睡使用蓝色月牙小标，模型偏暗、待机速度为 0.35；唤醒使用红色利爪小标，恢复白色和正常速度。状态标记目标尺寸为 32 像素，位于模型右上方；不显示文字，击败后模型与标记一起隐藏。状态变化进入视图内容签名，复用模型时全量重置颜色与速度，不重建节点。

强化门默认整局固定，随机模式每次从另外三种效果中选下一种。野怪平均等级、强度倍率、归属结算及复活仍不引入新算法，沿用现有配置卡属性和击杀奖励口径。

## 验收

地图编辑器预设 `neutral_fun`（“趣味中立资源验收”），同步资源位于 `assets/resources/config/maps/neutral_fun.json`；包含四种固定门、随机门、两处衍生地块、四座传送门、号角和野怪。可作为本地地图配置加载，不替换线上默认地图。

常规随机池的 15 张地图均已投放趣味资源：除已有验收图外，14 张普通地图共补充 100 个点位。11 张双人图各新增 8 个点位（强化门、衍生地块、号角、野怪及 4 座传送门）；3 张多人图各新增 4 个点位，不投放传送门。只增加 `resourcePoints`，保留原有点位、地形、主城与选图权重；源预设通过 `python tools/map-editor/copy_maps.py` 同步到游戏地图资源。

地图在开局时生成快照，已开始的对局不会动态补点。刷新预览并退出当前对局、重新开局后加载新配置。

行为回归：`npx tsx --test tests/zcds-neutral-features.test.ts tests/zcds-resource-unit-preview.test.ts`。

模型类型检查：`npm run check:zcds`。配表引用检查：`python tools/pvp_card_check.py`。地图源格式检查：`python tools/map-editor/copy_maps.py --id neutral_fun --dry-run`。

真实终端画面、操作手感和新增资源专用美术仍需在编辑器/设备中人工验收；模型与视图桩测试不能代替这部分。

本轮验证结果（2026-11-06）：

- 无文字强化门差异表现：`npx tsx --test tests/zcds-resource-unit-preview.test.ts tests/zcds-render-performance.test.ts tests/zcds-progress.test.ts tests/zcds-resource-icon-scale.test.ts tests/zcds-resource-icon-layer.test.ts`，86/86 通过；编辑器服务 7/7、`--test-name-pattern='组合预览' tests/map-editor.test.ts` 1/1 通过。覆盖四类门切图、随机门效果变更、窗口亮环、冷却灰显与进度、到期恢复、换格重置，以及四张 PNG 的实际服务路由。素材由 Cocos 生成 meta，均为 256×256，沿用既有自动图集；尚未设备实测。
- 图形表现与编辑器接入：地图编辑器、资源接口、视图与预加载相关 7 个测试文件共 161 项，157 通过，4 项失败已在去除本次改动后复现（3 项原有编辑器断言、1 项 PVE 预加载缺失稀有度配置桩）。新增图形、池化换格、最高权重预览、真实 PNG 路由用例通过。`npm run check:zcds` 通过；全工程 `tsc --noEmit` 仍失败，本次修改的四个运行时 TS 文件没有输出类型错误。已在浏览器实际检查验收图和传送门画笔预览，并由 Cocos MCP 刷新素材与脚本；检查时编辑器错误日志为 0。尚未进行设备对局画面验收。
- 常规地图漏投放修复：`npx tsx --test tests/zcds-neutral-features.test.ts tests/zcds-map-loading.test.ts tests/zcds-spawn-selection.test.ts tests/zcds-initial-tiles.test.ts tests/zcds-seeded-random.test.ts tests/zcds-resource-unit-preview.test.ts`，61/61 通过。新增回归遍历全部地图，检查源预设与发布资源一致，并经主城选点、资源抽取到真实开局快照。核对 14 张地图只有资源点变化，原有点位完整保留；Cocos MCP 已刷新地图目录，检查时编辑器错误日志为 0。
- 受影响 17 个测试文件共 217 项通过；含新增 19 项资源规则用例，以及门状态/野怪骨骼展示用例。最后补充的副本再入、低血量覆盖生命加成边界再次通过 19/19。
- `npm run check:zcds`、`python tools/pvp_card_check.py`、验收地图格式校验通过；源 Excel 19 条资源项与发布 JSON 逐项一致，既有单元格无非预期改动。
- `npm run verify:guards`：32/32；本次文件白名单的 `verify.mjs defs` 无缺失定义。Cocos MCP 完成脚本、配表、地图刷新，检查时编辑器错误日志为 0。
- 全量初跑采用 `npx tsx --test --test-reporter=tap "tests/**/*.test.ts"`，5124 项中 5031 通过、93 失败；其中本次新增的野怪掉落导致旧“两处掉落”结构断言失败，已同步为三处，并在上述回归中通过。其余全量差异涉及未改动的卡牌名称、头像与原有导弹诊断日志，另有基线已知失败；不宣称全工程全绿。
- 全工程类型检查仍有既有错误，`verify.mjs full` 的源码类型错误指纹为 218 条，较基线 219 条无新增。该脚本的测试解析器只识别 TAP，当前默认 reporter 会显示 `-1/-1`，因此本轮未采用它的测试 PASS 结论，以上全量计数来自显式 TAP 输出。
- 两位只读审查者分别复核规则与架构接入。已修复并复核：副本原地结束出生状态被误判为再次入门；克隆只复制被动标记、遗漏远程减伤状态。克隆状态现保持独立 UID、层计时和剩余时间，门倍率和状态加成各生效一次。
