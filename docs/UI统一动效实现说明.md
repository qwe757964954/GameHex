# UI 统一进出场动效 · 实现说明

> 状态：实现说明（最后核对 2026-11-20，增补 §7 卡牌升级详情时间轴动效）。

> 对应需求（2026-11-18）：
>
> > 游戏 UI 统一动效制作
> > 1. 所有的 2 级 3 级界面打开增加界面切换动效；
> > 2. 所有的弹窗增加一个统一的打开关闭过渡动画；
> > 3. 回到【章节地图】各模块的 UI 平滑进入的动画效果。

本工程 2 级 / 3 级界面**全部是 `PopupBase` 子类**（联盟、商店、卡牌、邮件、排行、活动等 60+ 个，
经 `PopupManager` 统一加载与入栈），所以需求 1 与需求 2 落在**同一处**：弹窗框架的打开 / 关闭链路。
需求 3 单独落在主城页（`ArenaRoot`）的模块级入场。

---

## 1. 一句话结构

| 关注点 | 归属 | 说明 |
| --- | --- | --- |
| 过渡曲线（起止值 / 缓动 / 时长） | `framework/ui/UIMotion.ts` | 纯函数、零 `cc`，可单测；视图不写时间常量 |
| 把曲线写进节点 | `framework/ui/UIMotionPlayer.ts` | 判定档位 → `startedAt` 逐帧采样 → 写 `UIOpacity` / 缩放 / 位置 |
| 打开即起播、关闭先播离场再销毁 | `framework/ui/PopupManager.ts` | 唯一的接线点，业务弹窗不用写任何代码 |
| 谁来播、能不能播 | `framework/ui/PopupBase.ts` | `motionEnabled`（默认 `true`），子类可关 |
| 章节地图各模块的节奏表 | `app/main/MainHudMotion.ts` | `MAIN_HUD_INTRO_PLAN` 纯参数 + 进度公式 |
| 章节地图模块入场的执行者 | `app/main/MainHudIntro.ts` | 运行时挂在页面根，按模块名找节点 |
| 起播时机 | `app/main/MainPage.ts` → `onViewLifecycle` | 地图首帧就绪（`VIEW_LIFECYCLE presented`）才播 |

**全程不建 tween。** 弹窗实例会进缓存池、主城页每次切 tab 都重建，tween 在节点停用 / 回收后仍会跑完，
回调里访问到的已是别人的节点（同 `docs/章节地图动画与点击反馈实现说明.md` 的口径）。
这里一律 `startedAt` + `schedule(step, 0)`，**静止时完全不进函数**。

---

## 2. 曲线参数（唯一真源 `UIMotion.ts`）

| | 进场 · 面板档 | 进场 · 整屏档 | 关闭（两档同值） |
| --- | --- | --- | --- |
| 时长 | 0.28s | 0.24s | 0.16s |
| 缓动 | `out-back`（带过冲） | `out-cubic` | `in-quad`（加速离场） |
| 透明度 | 0 → 1 | 0 → 1 | 1 → 0 |
| 缩放 | 0.92 → 1 | 0.96 → 1 | 1 → 0.94 |
| 纵向位移 | −18px → 0（从下方浮起） | 0（不做位移） | 0 → −10px |

三条口径：

1. **关闭永远比进场短、比进场急**：玩家已经做了决定，动画只负责收尾，不能让人等。
2. **整页缩放必须收敛**（0.96 而不是 0.92）：整页缩太多会把页面边缘缩进屏幕、露出底下那一页，
   看起来像「页面没铺满」而不是「在切换」。整页也**不做位移** —— 整页平移同样会露底。
3. **透明度单独 clamp**：`out-back` 在中后段会顶过 1，直接乘 255 会写出 285（非法值）。
   `uiMotionSample` 里对透明度单独 `clamp01`，过冲只允许作用在缩放上。

### 档位判定（`uiMotionKindOf`）

根节点自身、**或任一直接子节点**铺满设计分辨率 90% ⇒ `screen`；否则 `panel`。

为什么不只看根节点：本工程不少大页 prefab 的根节点是随手给的 `100×100`，
整屏尺寸靠子节点上的 `Widget` 撑开（联盟系列 14 个弹窗里 13 个如此）。
只看根节点会把整屏大页判成小面板 ⇒ 整页被缩到 0.92、边缘露底。

为什么不看「有没有全屏底图」：`Chat` 这类对话框同样带一张 720×1280 的 `Mask`，
与整屏页在结构上分不开。两档都只是「淡入 + 缩放」，判错也不穿帮。

---

## 3. 接线（业务弹窗零改动）

```
open:   PopupManager._openNew
          node.active = true
          UIMotionPlayer.playEnter(node)      ← 此刻还没渲染过一帧，写起始帧不会闪
          popup._internalOpen(...)            ← 业务 onOpen 照旧

close:  PopupManager.close
          出栈 → onClose → 资源释放            ← 全部同步做完（业务侧「已关闭」）
          UIMotionPlayer.playExit(node, () => 销毁 / 回收)
          this._exiting += 1                  ← 淡出期间仍占着最上面几个兄弟位
```

两点必须记住：

- **「业务已关闭」与「画面上还在淡出」是两件事**。`close()` 返回后 `get / has / count` 已经看不到它了，
  只有节点的视觉寿命被延后 0.16s。不要在 `close()` 之后还指望能拿到节点上的引用。
- **`_baseSiblingIndex()` 要扣掉 `_exiting`**：漏了这一步，刚露出来的下层弹窗会被排到淡出层之上，
  离场就变成「直接被盖掉」（动画白做，且没有任何报错）。

### 显式关掉的清单（`motionEnabled = false`）

| 页面 | 为什么 |
| --- | --- |
| `Toast` | 瞬时提示，1.6s 的存活期里塞两段过渡会和下一条抢拍 |
| `LoadingPopup` | 它的意义是「立刻让玩家知道在等」，淡入把这层意义抹掉 |
| `CommonTips` | `initStandalone` 场景（不走 `PopupManager`），显式关掉以免将来挪回去时行为突变 |
| `ZCGuidePanel` | 引导按「面板出现」推台词与焦点孔，整页淡入会让 `active` 与「看得见」错开 0.24s |
| `HeroObtainPage` | 自带整套入场编排（底图 / 放射光 / 标题 / 英雄各走各的曲线），再叠一层会拉长一倍 |

---

## 4. 章节地图（`ArenaRoot`）的模块入场

节奏表 `MAIN_HUD_INTRO_PLAN`（`name` 必须是 `ArenaRoot.prefab` 的**直接子节点名**，
`tests/main-hud-intro.test.ts` 会拿 prefab 对一遍，改名即红）：

| 模块 | 延迟 | 时长 | 起始偏移 | 起始缩放 |
| --- | --- | --- | --- | --- |
| `MapRoot` | 0 | 0.40s | −14px | 1（不叠页面级缩放，会和相机推拉打架） |
| `EntranceLayer` | 0.06 | 0.32s | −18px | 1 |
| `TopHud` | 0.10 | 0.32s | +40px（从上落下） | 1 |
| `BottomHud` | 0.14 | 0.32s | −40px（从下升起） | 1 |
| `OSRankEntry` | 0.18 | 0.30s | 0 | 0.72（弹出来） |
| `BeginGame` | 0.22 | 0.30s | 0 | 0.80 |
| `ChestBar` | 0.26 | 0.30s | −24px | 1（默认收起，播放时跳过） |

- **延迟一律递增**，相邻只差 40~60ms：差得再多就变成「一件一件出现」，像卡了。
- 收起的模块（未解锁的宝箱入口 / 快速寻敌）**跳过**：它们自己在解锁那一刻有生成动画，抢着淡入会「先虚一下再弹出来」。
- 收尾与打断**逐项复位**（位置 / 缩放 / 透明度全量写回）。切 tab、进战斗、`active=false` 都不能把 HUD 留在半透明。

### 起播时机

`MainTerritoryMap` 首帧渲染成功后派发的 `VIEW_LIFECYCLE { phase: 'presented' }`，不是 `onLoad`：

- 登录首屏时 `ArenaRoot` 是在登录图底下**预挂载**的，`onLoad` 起播等于在遮挡物后面演完；
- 切 tab 回来时 prefab 才刚 `instantiate`、地图数据还没到，`onLoad` 起播只能看到「先亮一下再淡」。

没有地图宿主的场景（测试桩 / 预览）没人发 `presented`，`MainPage.start()` 里延后一帧补一次。

---

## 5. 怎么改 / 怎么扩

| 想做的事 | 改哪里 |
| --- | --- |
| 调快慢、加大/减小幅度 | `UIMotion.ts` 的 `UI_MOTION_*` 常量（改一处，界面与弹窗同时生效） |
| 让某个弹窗不做过渡 | 子类写一行 `motionEnabled = false`（理由写进注释） |
| 主城新增一个模块要跟进场 | 在 `MAIN_HUD_INTRO_PLAN` 里加一行（名字必须是 `ArenaRoot` 直接子节点） |
| 主城入场整体更快/更晚 | 改对应行的 `delay` / `seconds`，保持 `delay` 递增 |

---

## 6. 验证

| 用例 | 钉住什么 |
| --- | --- |
| `tests/ui-motion.test.ts` | 曲线参数（进场从全透明起、关闭更短更急）、过冲只作用在缩放、进度边界、播放器起播/收尾/打断、档位判定、管理器接线与延迟销毁 |
| `tests/main-hud-intro.test.ts` | 节奏表对得上 prefab 真实节点、延迟递增、方向正确、播放器逐项复位、`presented` 触发 |

```
npx tsx --test tests/ui-motion.test.ts tests/main-hud-intro.test.ts
```

`tests/popup-lifecycle.test.ts` 里 `UIMotionPlayer` 被桩成「播不上」，让关闭链路走同步销毁 / 回收，
继续守住原有的生命周期与实例池语义 —— 过渡是否真的逐帧跑由上面两个文件负责。

---

## 7. 卡牌升级详情时间轴动效（CardUpgradedTimeline，2026-11-20）

对应需求：「增加升级详情界面的 UI 表现动画」，由 5 阶段串联成一条严格的时间轴：

1. **① 入场（Entrance）**：从上到下逐块从屏幕外滑到各自设计坐标，块间错峰间隔 `ENTRANCE_STAGGER = 0.1s`，单块时长 `0.55s`，滑移距离统一 `1500px`（五块分别为：Header / 立绘与影子 / 等级 / 属性 / 增益）。
2. **② 角色升级特效（Fx）**：立绘块（Block 1）落位后开始播放，15 帧序列帧（`007-2-run_loop_05..19`，采样 12fps，时长 1.25s）。
3. **③ 等级数字跳动（Level Pop）**：特效起播 0.35s 后开始跳动，先放大至峰值切成新等级文字，再回弹复位。
4. **④ 进度条刷光** 与 **⑤ 属性数值刷光**：
   - 🔴 **硬约束**：「所有的刷光动画同步」。
   - `CardUpgradedTimeline.ts` 中**只有一个 `shineProgressAt`**，进度条与属性区共用同一个 `0→1` 扫过进度，严禁各自分开计算。刷光结束后属性数值直接切换。

### 架构与生命周期约束

- **纯函数、零引擎依赖**：所有时序、缓动曲线与归一化进度在 `assets/script/app/card/CardUpgradedTimeline.ts` 中计算，可独立单测。
- **全程不建 tween**：`CardUpgradedPage` 节点进对象池复用，采用 `startedAt` + 逐帧调度采样。关闭或销毁时直接停止，杜绝 tween 回调访问已回收节点的风险。
- **关联资源**：预制体 `assets/bundles/main-pages/ui/card/CardUpgradeFx.prefab`。

### 验证

```powershell
npx tsx --test tests/card-upgraded-animation.test.ts tests/card-upgraded-layout.test.ts
```
