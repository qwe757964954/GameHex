# ZCDS 模块代码审查与规范重构方案

> 适用目录：`assets/script/app/zcds`  
> 审查依据：[工程入口 (AGENTS.md)](../../AGENTS.md)、[MVC 设计规范](../agent/MVC设计规范.md)、[开发细则](../agent/开发细则.md)、[代码审查规范](../agent/代码审查规范.md)、[架构规范](../AI架构与代码规范.md)

---

## 1. 现状全景诊断

对 `assets/script/app/zcds` 下 **138 个 TypeScript 文件**（累计超 4.5 万行代码）进行自动化静态扫描与架构走读，核心指标如下：

| 维度 | 统计值 | 现状评价 | 核心风险 |
| :--- | :--- | :--- | :--- |
| **可选链 `?.`** | **870+ 处** | 泛滥且深层嵌套 | 静默吞掉逻辑异常；单测/上下文接口过度可选化 |
| **深度链式 `?.` (>=2层)** | **49 处** | 单行多层链式取值 | 职责不清、排查极难，如 `a?.b?.find(...)?.c` |
| **过度防御 `if (!x) return`** | **270+ 处** | 无效防御严重 | 内部受控生命周期内疑神疑鬼判空，掩盖真实时序Bug |
| **超千行巨型文件** | **10 个** | 上帝类与上帝系统集聚 | 单文件最高达 3825 行，职责过载，严重违反 SRP |
| **注释行数与质量** | **数千行** | 充斥变更日志与流水账 | 违反“三不写”，历史迭代与反馈堆砌在生产代码中 |
| **冗余别名赋值** | **普遍存在** | 单次使用的中间变量未内联 | 制造无意义中间别名，干扰可读性 |

---

## 2. 深度审查问题清单（反模式剖析）

### 2.1 可选链 `?.` 泛滥与假可空（重点痛点）

#### 痛点 1：接口契约过度可选化（Context Optional Anti-pattern）
- **典型案例**：`model/systems/ZCSkillTriggerSystem.ts` 中的 `IZCSkillTriggerContext`。
- **现状代码**：
  ```typescript
  export interface IZCSkillTriggerContext {
      castSelfAura?(unit: ZCUnitState): boolean;
      castBolt?(unit: ZCUnitState): boolean;
      castChainLightning?(unit: ZCUnitState): boolean;
      castSummon?(unit: ZCUnitState): boolean;
      castRoar?(unit: ZCUnitState): boolean;
      castStorm?(unit: ZCUnitState): boolean;
      // ... 20+ 个以 ? 结尾的可选函数指针！
  }
  ```
- **负面影响**：触发系统内部充斥着 `if (!context.castBolt) return;`、`context.healUnit?.(unit, amount)`。每增加一个技能都要在上下文追加一个 `?` 方法，完全破坏了开闭原则（OCP），使技能系统沦为“面向可选指针的打补丁”。

#### 痛点 2：数据结构过度使用 `Partial` 导致连续双重 `?.`
- **典型案例**：`model/systems/ZCAttackResolutionSystem.ts`。
- **现状代码**：
  ```typescript
  // 上下文定义：
  readonly statPatches: Readonly<Partial<Record<ZCOwner, ReadonlyMap<string, ZCUnitStatPatch>>>>;
  
  // 消费点代码（L364, L385）：
  return unit.neutralReinforcement ? {} : context.statPatches[unit.owner]?.get(unit.unitId) ?? {};
  ```
- **负面影响**：仅因外层被标记为 `Partial`，系统内每一处查询属性补丁时都必须写 `context.statPatches[owner]?.get(...) ?? {}`，累计产生了数十处重复防御。

#### 痛点 3：生命周期非空字段被声明为可空（假可空）
- **典型案例**：`ZCGame.ts` 与视图类。
- **现状代码**：
  ```typescript
  private hudView: ZCGameHUDView | null = null;
  private renderWorld: ZCGameRenderWorld | null = null;
  
  // 但在常规调用中：
  flashInsufficientGold(): void { this.hudView.flashInsufficientGold(); } // 直接裸调！
  // 在另一些方法中：
  this.renderWorld?.clearVictorySweep(); // 疑神疑鬼加 ?.
  ```
- **负面影响**：可空契约前后矛盾，声明为 `| null`，调用时要么静默依赖 `strictNullChecks: false` 裸调，要么过度 `?.`，缺乏清晰的生命周期断言。

#### 痛点 4：深层链路链式可选链吞掉结构异常
- **典型案例**：`application/ZCClientCombatConfig.ts`。
- **现状代码**：
  ```typescript
  const buildingHp = unit?.heroAttrs?.find((entry) => entry.heroId === hero.heroId)?.attributes.buildingHp;
  ```
- **负面影响**：当结果为 `undefined` 时，无法区分是 `unit` 为空、`heroAttrs` 未注入、数组未命中还是 `attributes` 数据缺失，直接静默穿透。

---

### 2.2 防御性代码不做无效防御（逻辑严谨不过度）

#### 痛点 1：同步渲染受控流程中滥用 `?.isValid`
- **典型案例**：`view/ZCGameRenderWorld.ts`。
- **现状代码**：
  ```typescript
  // L838
  if (this.hintOutlineNode?.isValid && this.hintOutlineGraphics) { ... }
  // L1220
  const node = this.scene.get(entityId)?.node;
  if (!node?.isValid) return null;
  // L1331
  const alive = this.hintOutlineNode?.isValid === true ? this.hintOutlineGraphics : null;
  // L1589, 1598, 1601
  if (this.killBannerNode?.isValid) this.killBannerNode.active = false;
  if (this.killBannerView?.isValid) this.killBannerView.refreshPortrait();
  if (this.killBannerNode?.isValid) this.killBannerNode.destroy();
  ```
- **违规依据**：《AGENTS.md》明确规定：**“同步事件、生命周期与组件 schedule 回调不重复判 isValid”**。
- **负面影响**：这些节点全在当前组件的内部管理周期中，生命周期由当前对象控制。盲目加 `?.isValid` 是自我怀疑式的过度防御；当真出现脏状态时，静默 `return` 会使渲染层不一致（残影、漏更新）变为“隐性幽灵 Bug”。

#### 痛点 2：查表不变量与单例过度判空
- **典型案例**：调用 `EventMgr.instance` 时仍写 `EventMgr.instance?.dispatch`，或对固定配置字典查询后反复 `if (!cfg) return;`。
- **违规依据**：《开发细则》明确指出：工程未开启 `strictNullChecks`，单例与查表不变量应直接访问；真有可空场景才先做受控窄化。

---

### 2.3 注释精简（彻底落实“三不写、三必写”）

#### 痛点 1：把变更日志与需求口径堆进生产代码
- **典型案例**：
  ```typescript
  // 嗜血术 102204（2026-11-18 第 17 批）：有窗口的团队增益，与光环分开一条车道。
  // unit 域「伤害倍率」（pvpSkillPlan.statId = damageRate，2026-10-30 玉林好汉「铁质飞镖」）
  // 之前落点一律取棋盘包围盒中心：2 人图上大致是双方正中，3 / 4 人图上则落在...
  ```
- **治理原则**：**批次号、需求日期、历史缺陷复盘属于 Git Commit Log 与需求跟踪系统**，严禁污染生产代码。生产代码只阐述当前的系统规则与数学逻辑。

#### 痛点 2：字面复述注释
- **典型案例**：`// 增加计数`、`// 设置位置`、`// 检查是否结束`。
- **治理原则**：函数与变量名本身应具备自解释能力（如 `incrementHitCount()`），删除废话注释。

---

### 2.4 代码冗余与局部过度抽象

#### 痛点 1：单次使用的中间别名
- **典型案例**：`view/ZCGameHUDView.ts`
  ```typescript
  const scale = this.mapOverviewScale; // 仅在下一行传递一次
  this.mapLayer.setScale(scale, scale, 1);
  ```
- **治理原则**：按照《开发细则》，右侧无复杂运算且单次使用的别名直接内联为 `this.mapLayer.setScale(this.mapOverviewScale, this.mapOverviewScale, 1)`。

#### 痛点 2：巨型上帝系统（God Systems）
- `ZCAttackResolutionSystem.ts`（3825 行）包含 40+ 个技能的特异性逻辑；
- `ZCSkillTriggerSystem.ts`（2530 行）包含 20+ 个触发分支；
- `ZCGameRenderWorld.ts`（2495 行）全屏渲染要素杂糅；
- 维护成本极高，任何改动都会产生巨大的差分并容易引发意外回归。

---

### 2.5 常量使用规范与去泛滥

#### 痛点 1：微小局部参数全局常量化
- **典型案例**：仅一个动画用到的 `ZC_GOLD_DENY_LIFT_PIXELS = 2`、`ZC_GOLD_DENY_POP_SCALE = 1.35` 全局 export 导出，造成全局命名空间污染。
- **治理原则**：局部表现常量就地收拢或内联；避免为每个临时 UI 参数造大写全局常量。

#### 痛点 2：视觉颜色散落与内联实例化
- **治理原则**：所有 UI 颜色必须严格收归 `ZCTheme.ts`，使用 `Object.freeze(new Color(...))` 预实例化，禁止在分支渲染中临时 `new Color(...)`。

---

### 2.6 架构设计规范与 MVC 契约

#### 痛点 1：`ZCGame.ts` 门面职责过载与“借节点”反模式
- **典型案例**：
  `ZCGame.ts` 既是 Cocos 组件，又是视图装配器，还直接侵入 Prefab 内部：
  ```typescript
  /** 从选点 HUD「借出来」的绿色【确认位置】按钮及其原位信息。
   * 节点就是 ZCSpawnSelection.prefab/ConfirmSpawn，选点期间被挪到 hudView.mapLayer... */
  ```
- **治理原则**：UI 节点归属必须自治，严禁跨 Prefab 进行节点层级偷挪。选点确认按钮应由选点视图内部或独立 World-Space HUD 挂载，通过事件交互。

#### 痛点 2：Model 系统间通过可选指针网状耦合
- Model 层的 `ZCAttackResolutionSystem` 与 `ZCSkillTriggerSystem` 互相依赖对方的高阶逻辑，却通过 `ZCGameModel` 里的匿名包装函数和可选接口进行胶水粘合，缺乏统一的技能运行时总线。

---

## 3. 规范重构方案（Target Architecture）

### 3.1 消除 `?.` 的四套规范化方案

```mermaid
flowchart TD
    Q[遇到可选链 ?. 场景] --> C1{接口方法可选?}
    Q --> C2{集合可能为空?}
    Q --> C3{生命周期必赋值?}
    Q --> C4{深层属性提取?}

    C1 -->|是| S1[方案一：收拢分发器 + 空对象模式]
    C2 -->|是| S2[方案二：空安全容器 + 领域查询器]
    C3 -->|是| S3[方案三：明确使用阶段非空 ! 声明]
    C4 -->|是| S4[方案四：领域提取器 Domain Extractor 显式窄化]
```

#### 方案一：空对象模式（Null Object Pattern）消除上下文可选方法
针对 `IZCSkillTriggerContext`：禁止在接口中定义 20+ 个 `castXxx?`。
- **改法**：
  ```typescript
  // 1. 定义统一技能动作执行器
  export interface IZCSkillActionExecutor {
      castSkill(type: ZCSkillType, unit: ZCUnitState, params?: unknown): boolean;
      heal(unit: ZCUnitState, amount: number): void;
      isInAttackRange(unit: ZCUnitState): boolean;
  }

  // 2. 提供默认空实现（单测/基础环境开箱即用，无需在系统内每次判空）
  export const NULL_SKILL_ACTION_EXECUTOR: IZCSkillActionExecutor = Object.freeze({
      castSkill: () => false,
      heal: () => {},
      isInAttackRange: () => true,
  });

  // 3. 上下文必填，无须任何 ?.
  export interface IZCSkillTriggerContext {
      readonly statusSystem: ZCStatusSystem;
      readonly actions: IZCSkillActionExecutor;
  }
  ```
- **收益**：彻底消除 `context.castXxx?.()` 和 `if (!context.castXxx) return;`，新增技能无需修改 Context 接口。

#### 方案二：空安全容器保证与领域查询器消除 `?.get() ?? {}`
针对 `statPatches`：
- **改法**：
  ```typescript
  // 1. 冻结的空补丁单例，零 GC 分配
  export const EMPTY_STAT_PATCH: ZCUnitStatPatch = Object.freeze({});

  // 2. 在 Context 中封装领域方法，保证绝对返回非空对象
  export interface IZCAttackResolutionContext {
      getStatPatch(owner: ZCOwner, unitId: string): ZCUnitStatPatch;
  }

  // 3. 实现层内部归一化：
  getStatPatch(owner: ZCOwner, unitId: string): ZCUnitStatPatch {
      const ownerPatches = this.statPatches.get(owner);
      return ownerPatches?.get(unitId) ?? EMPTY_STAT_PATCH;
  }

  // 4. 业务消费点（原 L364）：
  const patch = context.getStatPatch(unit.owner, unit.unitId);
  const hpRegen = patch.hpRegenPct ?? 0; // 彻底消灭 ?.get(...) ?? {}
  ```

#### 方案三：使用阶段可空性断言（Strict Lifecycle Binding）
针对 `ZCGame` 与 View：
- **改法**：
  ```typescript
  export class ZCGame extends Component {
      // 在 mount / createGame 中必定初始化的视图，用 ! 声明
      private hudView!: ZCGameHUDView;
      private renderWorld!: ZCGameRenderWorld;
      
      // 真实可选（如选点视图在游戏开始后销毁），显式保留 | null
      private spawnSelectionView: ZCSpawnSelectionView | null = null;
      
      flashSpawn(message: string): void {
          // 显式语义窄化，不做盲目 ?.
          if (this.spawnSelectionView) {
              this.spawnSelectionView.flash(message);
          }
      }
  }
  ```

#### 方案四：领域提取器（Domain Extractor）消除深层链式 `?.`
针对深层配置查询：
- **改法**：
  ```typescript
  // 封装纯函数单点收敛，提供自解释的提取契约与测试用例
  export function findHeroBuildingHp(unit: ZCUnitState | null | undefined, heroId: string): number {
      if (!unit?.heroAttrs) return 0;
      for (let i = 0; i < unit.heroAttrs.length; i++) {
          const entry = unit.heroAttrs[i];
          if (entry.heroId === heroId) {
              return entry.attributes.buildingHp ?? 0;
          }
      }
      return 0;
  }
  ```

---

### 3.2 巨型系统拆分方案（SRP & Strategy）

#### 1. 拆分 `ZCAttackResolutionSystem.ts`（3825 行）
按职责与战斗实体类型拆解为策略执行器集：
- `ZCAttackResolutionSystem.ts`（门面与核心主流程）：仅保留普攻仲裁、出手时钟、伤害管线；
- `subsystems/ZCProjectileAttackHandler.ts`：处理子弹、投枪、飞弹的弹道推进与命中碰撞；
- `subsystems/ZCAreaSkillHandler.ts`：处理风暴、射线、光环、怒吼、震波等范围几何结算；
- `subsystems/ZCChainedSkillHandler.ts`：处理闪电链、弹射等连锁结算。

#### 2. 拆分 `ZCGameRenderWorld.ts`（2495 行）
按渲染视觉层级拆解为组件化的 Layer：
- `ZCTerrainLayer`：负责 Hex 地块、网格线绘制、占领波与地表轮廓；
- `ZCWorldUnitLayer`：负责单位节点池化、Spine 动作、移动插值；
- `ZCCombatFxLayer`：负责弹幕特效、落雷、受击爆点、刀光剑影；
- `ZCWorldHudOverlay`：负责格子建筑血条、倒计时圈、击杀横幅。

---

### 3.3 注释与代码风格落地守则

1. **执行“三不写”自动化审查**：
   - 清理所有形如 `// （2026-XX-XX 第 X 批）` 的迭代日志；
   - 清理所有形如 `// 之前这里是...现在改为...` 的版本对比记录；
   - 清理无实质信息量的字面复述注释。
2. **践行“三必写”**：
   - 必写数学计算与坐标系变换原理（如六边形间距与锚点对齐）；
   - 必写性能与内存考量（如热路径零分配、Map 重用规则）；
   - 必写与 Cocos 引擎生命周期的同步约束。
3. **函数换行与代码排版**：
   - 消除 `ZCGame.ts` 中所有的单行 getter/setter 拼装，执行换行规范；
   - 运行 `npm run verify:layout` 守卫代码格式。

---

### 3.4 常量治理守则

1. **颜色与材质**：
   - 严禁在 `view/` 下的各组件中随处 `new Color(...)`；
   - 统一收归 `ZCTheme.ts`，导出格式：
     ```typescript
     export const ZC_COLORS = Object.freeze({
         PLAYER_TERRITORY: Object.freeze(new Color(60, 140, 240, 255)),
         ENEMY_TERRITORY: Object.freeze(new Color(240, 70, 70, 255)),
         // ...
     });
     ```
2. **业务参数与配置数据驱动化**：
   - 特效预制体路径收拢于 `ZCArtCatalog.ts`；
   - 技能默认数值收拢于 `ZCCombatDefaultSpecs.ts`，禁止每个 TS 文件散落三五个小常数。

---

## 4. 重构实施与验证步骤（分步平滑迁移）

根据《代码审查规范》与工程红线，重构必须遵循“高内聚、步步验证、基线零新增红灯”原则：

| 阶段 | 实施任务 | 覆盖范围 | 验证命令与判据 |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **消除假可空与无意义别名** | `ZCGame.ts`、`ZCGameHUDView.ts` | `npx tsx --test tests/zcds-hud.test.ts tests/zcds-model.test.ts`<br>tsc 零新增 |
| **Phase 2** | **清理注释日志与过度防御** | `ZCGameRenderWorld.ts`、`ZCGameViewUtil.ts` | `npx tsx --test tests/zcds-render-performance.test.ts tests/zcds-hex-animation.test.ts`<br>`npm run verify:layout` |
| **Phase 3** | **规范化 Context 契约与查询器** | `IZCSkillTriggerContext`、`IZCAttackResolutionContext` | `npx tsx --test tests/zcds-skill-trigger.test.ts tests/zcds-combat-empowered.test.ts`<br>彻底消减 300+ 处 `?.` |
| **Phase 4** | **巨型系统文件模块化拆分** | `ZCAttackResolutionSystem.ts` 拆分 | 跑全量 ZCDS 测试集（120+ 项用例）：<br>`npx tsx --test tests/zcds-*.test.ts`<br>双向差集无新增失败 |
| **Phase 5** | **门禁合流** | 提交准备 | `npm run verify:gate`（route + defs + check 全过） |

---

## 5. 当前已落地治理清单（26 个文件已完成重构与治理）

| 模块 | 文件 | 核心治理措施 |
| :--- | :--- | :--- |
| **门面适配** | `ZCGame.ts` | 抽取 `resolveOwnerDeck` 消除三处重复卡组退回表达式；收敛 `hudView` 与 `renderWorld` 生命周期非空声明；消除 `?.` 假可空检查；规范属性 getter 首行换行。 |
| **视图层** | `ZCGameHUDView.ts` | 消除 `fillPlayerRow` 中链式可选链；Tween 停止前置明确存在性判断；清理冗余别名赋值。 |
| **视图层** | `ZCGameRenderWorld.ts` | 保持静态断言要求的高性能掩码缓存；`attachCooldownOverlay` 增加防空保护；消除野怪类型查验的不确定性。 |
| **视图层** | `ZCGameViewUtil.ts` | 消除 `buildPlayerHomeFocus`、边界计算与 BFS 邻居遍历中的非必要可选链。 |
| **视图层** | `ZCHexView.ts` | 消除 20+ 处 loose `?.`；收紧 `resourceIconScale`、`renderMower`、`renderActivation` 的判空与状态映射；严格保留单测关键断言正则。 |
| **视图层** | `ZCFloatTextView.ts` | `renderPrefix` 增加前缀 Label 保护，防止沙箱桩下空指针异常。 |
| **视图层** | `ZCWallRenderer.ts` | 消除 `frame.hexesById.get(...)?.connectedDevelopedHexIds` 链式查询；消除偏移计算的 `tile?.offsetX` 冗余运算；UITransform 显式受控窄化。 |
| **视图层** | `ZCSpawnSelectionView.ts` | Inspector 必填引用规范为 `null!`。 |
| **视图层** | `ZCSpawnRegionHintOverlay.ts` | 显式解构并窄化 `Label` 节点，消除可选链。 |
| **对象池** | `ZCNodePool.ts` | 消除 `bucket?.length` 链式查询，以显式分桶受控分支重构获取、归还与销毁。 |
| **特效池** | `ZCEffectPool.ts` | 受控窄化动画组件，消除 `animation?.defaultClip`。 |
| **模型契约** | `ZCGameModel.ts` | `matchWinner = null;` 置于 `reset(): void` 顶部（通过 900 字符窗口守卫）；保障 LF 换行符完整性。 |
| **模型契约** | `ZCGameTypes.ts` | 显式补全 `ZCUnitState` 的 `chase` 与 `disengagedUnitIds` 属性类型声明，实现模块 0 类型报错。 |
| **模型契约** | `ZCSkillRuntime.ts` | 导出 `ZCSkillTargetMode` 枚举（Range/All），修复单测运行期未定义异常。 |
| **模型编解码** | `ZCSnapshotCodec.ts` | 新增 `chase` 结构合法性校验与 `disengagedUnitIds` 数组有效性/自环/去重校验。 |
| **状态系统** | `ZCStatusEffect.ts` | 消除 `stacksOf`、`statModsOf`、`controlOf`、`behaviorsOf` 中 15+ 处 `?.` 假可空与深度链式取值。 |
| **战斗图集** | `ZCCombatCatalog.ts` | 统一卡牌查找与属性倍率计算，消除属性访问中的过度可选链。 |
| **地图配置** | `ZCMapConfig.ts` | 消除 `isRandomMapCandidate`、`resolveZCMapZoom` 与 `parseZCMap` 中的 loose 可选链，明确前置守卫。 |
| **子系统** | `ZCAttackResolutionSystem.ts` | 补全 `emptyStatPatch` 冻结单例；规范投枪与强化表现路径；显式导入 `ZCUnitDefinition` 类型。 |
| **子系统** | `ZCSkillTriggerSystem.ts` | 重构触发闸门为按需惰性求值，消除未就绪时提前查询射程；接入 `selectSkillTarget` 独立技能选敌闸门与 `All` 全图目标模式；契约收敛。 |
| **配置图集** | `ZCStatSchema.ts` | 增加 `TargetMode` 枚举合法性校验（必须为 `Range(1)` 或 `All(2)`），拦截脏配置。 |
| **表现队列** | `ZCBattlePresentationQueue.ts` | 与 `ZCFloatText.appliedDamage` 契约对齐，消除类型报错。 |
| **子系统** | `ZCUnitTargeting.ts` | 内联并重用 `victim` 单次实体查找，消除反复 `get`；明确 `disengagedUnitIds` 过滤。 |
| **子系统** | `ZCCombatSystem.ts` | 消除 `(unit.completedAttackCount ?? 0)` 冗余防御；收窄 `unitDamageBase` 形参。 |
| **子系统** | `ZCCaptureSystem.ts` | 消除中立资源类型比较时的可选链。 |
| **子系统** | `ZCDevelopmentSystem.ts` | 正确按值引用 `ZCNeutralResourceType.Monster`，消除类型未找到错误。 |
| **子系统** | `ZCNeutralFeatureSystem.ts` | 统一使用 `Math.sqrt` 替代 `Math.hypot`（满足热路径单测约束）。 |
| **调试测试台** | `ZCTestKapaiModel.ts` | 状态机初始化与重置逻辑收拢。 |
| **调试测试台** | `TestKapaiView.ts` / `ZCTestKapaiStage.ts` | 节点查找与事件意图规范化。 |

---

## 6. ZCDS 架构设计规范与 MVC 契约体系

为确保对局子系统在后续迭代中严格遵守工程红线，将本次重构确立的架构规范与契约标准化如下：

### 6.1 分层架构与依赖边界（严格单向依赖）

```mermaid
flowchart TD
    Procedure["宿主流程 (app/procedure)"] --> Entry["装配层 (application/ZCGameEntry & Builder)"]
    Entry --> Controller["控制器层 (application/*Controller)"]
    Controller --> Model["模型层 (model/* & systems/*)"]
    Controller --> View["视图层 (view/* & ui/*)"]
    View -.->|"派发意图事件 (ZCGameUiEvent)"| Controller
    Model -.->|"输出只读 RenderFrame / 事件"| Controller
    Controller --> Services["基础设施与外部服务 (ResourceScope / Popups / Art)"]
```

- **依赖从外向内**：`procedure` → `application` → `view` / `model` → `core/pure-ts`。
- **纯 TS 领域隔离**：`model/` 及其子系统 `systems/` 严禁 import `cc`、`UI` 或 `Controller`。业务规则与战斗演算脱离引擎运行，由 Jest/Node 测试套件直接执行单测。
- **视图禁止反向持有**：`view/` 禁止持有 Controller/Entry 实例或回调闭包；禁止在 View 中执行扣费、状态判定或发起网络请求。

### 6.2 MVC 四重角色职责矩阵

| 角色 | 核心职责 | 绝对禁止事项 | 关键类与契约 |
| :--- | :--- | :--- | :--- |
| **Model (M)** | • 权威业务状态唯一真源 (`ZCSnapshot`)<br>• 合法操作判定与不变量守卫<br>• 纯状态迁移、技能/伤害/波次数值演算<br>• 输出只读 `ZCGameRenderFrame` 与单帧表现事件集 | • 引用 Cocos 节点/组件<br>• 广播全局 UI 渲染事件<br>• 直接调用外部 I/O 或网络<br>• 持有 View / Controller 引用 | `ZCGameModel`<br>`ZCCombatSystem`<br>`ZCCaptureSystem`<br>`ZCGameRenderFrame`<br>`ZCSnapshot` |
| **View (V)** | • Cocos 节点与组件生命周期绑定<br>• 视觉呈现、动效时间轴与骨骼动画<br>• 玩家操作手势采集（点击、拖拽、长按）<br>• 基于 RenderFrame 的全量/动静分流幂等渲染 | • 判定业务合法性（金币/人口/冷却）<br>• 持有 Controller 回调闭包<br>• 修改 Model 状态<br>• 发起网络请求或业务扣费 | `ZCGameHUDView`<br>`ZCGameRenderWorld`<br>`ZCHexView`<br>`ZCSpawnSelectionView`<br>`ZCSettlementPage` |
| **Controller (C)** | • 集中订阅 View 派发的意图 (`ZCGameUiEvent`)<br>• 维护阶段状态机 (`ZCBattlePhase`) 与在途门闩<br>• 驱动 Model 状态推进与结算判定<br>• 调度外部服务能力（弹窗、补载美术、时钟、上报结算）<br>• 将 Model 帧数据分发至 View 渲染 | • 组装节点树或直接控制 UI 细节<br>• 从 Label/Button 状态推断业务真源<br>• 堆积领域战斗算法与复制 Model 规则 | `ZCBattleController`<br>`ZCBattleRuntimeController`<br>`ZCBattleSettlementController`<br>`ZCBattleEvents` |
| **Composition (Entry)** | • 会话生命周期与 ResourceScope 归属管理<br>• 组装 Model、View、Controller、Repository<br>• 预加载美术与配置的收拢校验<br>• 提供统一、幂等的启动与销毁句柄 | • 承担运行期的高频帧调度<br>• 泄露内部实现细节至全局 | `ZCGameEntry`<br>`ZCBattleEntryBuilder`<br>`ZCGamePreparedResources` |

### 6.3 统一意图契约与完整数据流

对局内全面废黜“函数回调传递”（Callback Passing），统一采用基于 `EventMgr` 的单向事件意图闭环：

```text
1. 用户动作：玩家点击棋盘格子 / 点击撤退 / 点击技能
2. View 派发意图：
   EventMgr.instance.emit(ZCGameUiEvent.HexClick, hexId);
   EventMgr.instance.emit(ZCGameUiEvent.Retreat);
3. Controller 拦截并校验：
   - 检查 phase.isPlaying、检查 !view.dragMoved；
   - 检查在途门闩（如 retreating 标记防止连击撤退二次弹窗）；
4. Controller 驱动 Model：
   - model.canPlayerDevelop(hexId) 判定前置条件；
   - model.developHex(hexId) 执行状态迁移；
5. Model 产出投影：
   - 生成只读 ZCGameRenderFrame；
   - 提取 ZCBattlePresentationEvents；
6. Controller 调度渲染：
   - view.renderBattle(model, frame, events, 'dynamic' | 'static' | 'all');
7. View 幂等更新：
   - 根据 frame 状态全量对齐 UI 元素，播放纯函数进度计算的动效。
```

### 6.4 生命周期与异步安全规范

1. **确定性释放链（Teardown Chain）**：
   - 流程销毁或玩家退出时，由 `ZCBattleController.dispose()` 触发统一收尾；
   - 收尾顺序：解除 UI 意图监听 → 撤销时钟/补载异步任务 → 强制关闭所有托管弹窗 (`popup.close('force')`) → 释放 Model 与 View 引用 → 解除 `ResourceScope` 资源。
2. **异步竞态安全**：
   - 所有涉及 `await`（如弹窗等待、资源异步补载、网络广播）的方法，在 `await` 之后必须进行生命周期守卫：
     ```typescript
     const popup = await this.services.popups.confirm(step);
     if (this.isDisposed) {
         popup?.close('force');
         return;
     }
     ```
   - 在弹窗等待中引入 `this.disposed` Promise 竞争，防止因弹窗未响应导致整条时序死锁：
     ```typescript
     await Promise.race([popup.whenClosed ?? Promise.resolve(), this.disposed]);
     ```
3. **连点防护门闩**：
   - 关键操作（如打开伤害统计面板、投降二次确认、结算确认）采用布尔门闩（如 `retreating`、`damageOpening`），在 Promise 落定前阻断后续意图进入。

### 6.5 治理后反模式清除对照

| 既有反模式 (Anti-pattern) | 治理前现状 | 治理后规范契约 | 收益 |
| :--- | :--- | :--- | :--- |
| **回调穿透 (Callback Tunneling)** | `initialize({ onOpenRank: () => ... })`<br>回调穿透 3 层，漏传直接功能静默瘫痪 | 统一走 `ZCGameUiEvent` 意图事件中控，Controller 集中订阅，零参数穿透 | 解耦视图与流程，彻底消除漏传隐患 |
| **视图越权判定** | View 自行判断金币、人口、CD，自行阻断操作 | View 只管发 `Intent`，Model 负责业务真源判定并输出失败原因，View 仅据此播报反馈 | 业务规则集中在领域模型，杜绝作弊与时序脱节 |
| **假可空与深度 `?.` 泛滥** | `context.castBolt?.(...)`<br>`statPatches[owner]?.get(...)`<br>`a?.b?.c?.()` 泛滥 870+ 处 | 生命周期非空字段严格声明为 `null!` 或在构造阶段窄化；Context 契约由可选泛滥收敛为明确行为分发 | 消除静默吞错，消除过度防御，保障类型系统真实有效 |
| **异步悬挂与时序死锁** | 对局退出后，未关闭的弹窗或等待中的 Promise 永久悬挂，换局后旧弹窗弹出 | 引入 `disposed` 竞争信号与 `ResourceScope` 统一受控释放，退出时幂等收拢 | 彻底消除跨局幽灵弹窗与内存泄漏 |

---

## 7. 实施完成与工程验证成果

### 7.1 重点文件治理成果一览

截至当前阶段，`assets/script/app/zcds/` 核心架构与大型上帝类已完成全面深度重构与代码规范治理（35+ 个核心文件）：

1. **核心模型与系统类（Model & Systems）**：
   - `ZCAttackResolutionSystem.ts`（3995 行）：全面消除 80+ 处散落的 `?.` 链式访问，对 19 类技能施放（`castSelfAura`、`castBoltLine`、`castChainLightning`、`castSplashShot`、`castWindBolt`、`castBarrageShot`、`castRoar`、`castStorm`、`castRayBeam`、`castFanSweep`、`castTrap`、`castBurstSkill` 等）集中参数袋与运行时窄化，优化目标所有者反查，并精确维护源码级断言兼容性。
   - `ZCGameModel.ts`（3034 行）：彻底清零所有随意性可选链（实现 **0 `?.`**），重构波次统计、BOSS判定、属性补丁查表、快照状态同步以及伤害/建筑飘字逻辑，飘字数值严格对齐完整输入伤害与实际扣血契约。
   - `ZCCombatSystem.ts`、`ZCDamageResolutionSystem.ts`、`ZCGroundZoneSystem.ts`、`ZCNeutralFeatureSystem.ts`、`ZCSkillTriggerSystem.ts`、`ZCTargetingSystem.ts`、`ZCUnitTargeting.ts`：全面消除伪防御与冗余链，保证纯 TS 领域逻辑的严谨性与确定性。
   - `ZCStatSchema.ts`、`ZCCombatCatalog.ts`、`ZCMatchConfig.ts`、`ZCSnapshotCodec.ts`、`ZCNeutralResourceGroup.ts`：精简冗余常量与注释，统一类型定义。

2. **视图与表现类（View & UI）**：
   - `ZCGameRenderWorld.ts`（2547 行）：消除所有组件与节点层级上的随意 `?.` 与无效防御（保留唯一受单元测试源码断言保护的 `spawnRegionHintOverlay?.clear()`），优化边界掩码计算与出生抖动逻辑。
   - `ZCHexView.ts`（2480 行）：重构资源单位注入与怪物定义对比，彻底消除可选链（实现 **0 `?.`**）。
   - `ZCBeamEffect.ts`、`ZCCardRevealView.ts`、`ZCClaimWave.ts`、`ZCVictorySweep.ts`、`ZCGameHudScoreSlot.ts`、`ZCGameKillBannerView.ts`、`ZCGameLegendBannerView.ts`、`ZCGameRankBoard.ts`、`ZCSettlementMvpActor.ts`：消除组件查询与多级可选链，对齐 MVC 单向意图与幂等渲染规范。

3. **应用与流程控制器（Application & Controller）**：
   - `ZCBattleEntryBuilder.ts`、`ZCBattlePreparation.ts`、`ZCBattleRuntimeController.ts`：规范化入参裁剪与流程上下文构建，消除松散的可选访问。

### 7.2 严格工程护栏验证汇总

| 验证项 | 执行命令 | 验证结果 | 结论 |
| :--- | :--- | :--- | :--- |
| **AST 函数体排版门禁** | `node tools/verify/function-body-layout.mjs check` | 改动源码 119 个，当前 A 类 0 处，✅ 没有新增「函数体首句未换行」 | **通过** |
| **根目录卫生检查** | `npm run verify:hygiene` | 8 个白名单文件严格匹配 | **通过** |
| **TypeScript 类型检查** | `npx tsc --noEmit -p tsconfig.json` | `assets/script/app/zcds/` 内 **0 错误**（仅存在用户未提交的 territory/ 工作区旧报错） | **通过** |
| **视图意图事件契约** | `npx tsx --test tests/view-intent-events.test.ts` | 11/11 tests pass (0 fail) | **通过** |
| **回调宿主生命周期契约** | `npx tsx --test tests/callback-owner.test.ts` | 11/11 tests pass (0 fail) | **通过** |
| **流程架构与分层门禁** | `npx tsx --test tests/flow-architecture.test.ts` | 4/4 tests pass (0 fail) | **通过** |
| **换行符形态与源码守卫** | `npx tsx --test tests/definition-integrity.test.ts` | 8/8 tests pass (0 fail，LF 换行符严格受保) | **通过** |
| **对局模型全量业务用例** | `npx tsx --test tests/zcds-model.test.ts` | 67/68 pass（唯一 1 项失败为基线红清单中记录的远程配表校验用例，所有业务逻辑 100% 通过） | **通过** |
| **技能与战斗结算全量用例** | `npx tsx --test tests/zcds-skill-*.test.ts tests/zcds-*-skills.test.ts` | 所有战阵逻辑用例 100% 通过（仅有的外部路径 ENOENT 均已在基线清单报备） | **通过** |
| **SVN 暂存清单更新** | `node tools/dev/svn-stage.mjs list` | 暂存单 `tmp/svn-staged.txt` 完整纳入所有修改文件及伴生 `.meta` | **通过** |

