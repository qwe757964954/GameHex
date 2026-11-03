/**
 * 「进入关卡战斗 / 匹配界面」的**整页过场**（零 cc 纯函数）。
 *
 * 需求（2026-11-02 用户）：
 *
 * > 进入关卡战斗界面/匹配界面的过渡动画
 * > 1. 界面所有 UI 向四周推出，下方 UI 从下方推出，上面从上上方推出，两侧分别从两侧推出
 * > 2. 地块同时变透明变小隐藏，云层往中间移动遮挡地块
 * > 3. 云层静止等待获得服务器回调，进入匹配或者战场时，再向四周散开变透明
 *
 * ## 三段（`out → hold → in`）
 *
 * | 段 | 时长 | 画面 |
 * | --- | --- | --- |
 * | `out` | {@link TERRITORY_BATTLE_INTRO_OUT_SECONDS} 0.55s | UI 沿各自方向推出 + 淡出；地块缩小 + 变透明；云层**向中间收拢**并显形 |
 * | `hold` | 由外部决定（等服务器回包 / 等目标页资源） | 位置一帧不动：UI 已在屏幕外，地块已隐，云铺满整屏；**只有云自己的待机循环在动** |
 * | `in` | {@link TERRITORY_BATTLE_INTRO_IN_SECONDS} 0.45s | 云层**向四周散开**，各朵先后淡到全透明（露出来的就是战斗 / 匹配页） |
 *
 * 三段用**同一份** `{ uiPush, uiOpacity, cellScale, cellOpacity, coverSpread, coverOpacity,
 * coverRelease }` 输出（{@link ITerritoryBattleIntroFx}）：视图那边只有一组写节点的代码，
 * 换段只是换一个函数喂它。
 *
 * ## 盖层用哪套美术：`cloud_body_0`（云体，第五版，2026-11-02 晚上）
 *
 * 前四版都在这件事上翻车，记下来免得再来一次：
 *
 *  ① 直接拿地图上的卡通云 `cloud_idle_0` 平铺 ⇒ "一屏贴纸"（硬边、满不透明、一样大）；
 *  ② 换成**程序生成**的径向羽化雾团（`ImageAsset` + smoothstep 羽化）⇒ 柔了，但那是"一团团
 *     发光的棉花"，跟项目里任何一张云都对不上；
 *  ③ 用户 2026-11-02 的原话是「浓雾静止等待散开的过程**使用通用的云雾效果**」——
 *     "通用的"= 项目现有的那套云，不是另造一种；
 *  ④ `cloud_idle_0..4`（五帧待机循环）+ 细密云海铺法 ⇒ 密度对了，但**整屏是灰的**（见下）；
 *  ⑤ 改用 `cloud_body_0`：**只画云体、不带影子** ⇒ 一屏白。
 *
 * 🔴 ④ 为什么灰：`cloud_idle_*` 是「云体 + 影子」的**合并图**，影子是纯黑低 alpha 那一层。
 *    地图上它不显灰，因为地图把影子**全部抽到云体之下**（`CloudShadow` 层，全局一个）；
 *    盖层是几百朵密铺，每朵自带的黑影子都盖在**邻居的白色云体**上 ⇒ 叠几层就是一片灰。
 *    实测（`tools/probe_cloud_cover_grey.py`，按真点阵合成）：合并图整屏均值 **147**，
 *    与实机截图 (147,145,136) 一致；换成纯云体后 **225**，与领地正常页 (231,230,217) 对齐。
 *
 * 所以盖层的美术口径是「**只取云体**」：`image/territory/cloud/cloud_body_0`
 * （= 美术从 `cloud_idle_0` 拆出来的上半层，白底 + 米色暗面，没有那层黑影）。
 * 顺带一个好处：一张图 ⇒ 无需换帧，`hold` 段本来就是"静止等回包"。
 *
 * 做法是**细密云海**：单朵只放大 1.3 倍（260×312）、间距 107×94、1080×1920 上约 375 朵 ——
 * 密到数不清，读成"一片云"而不是"一堆贴纸"；再叠**左右镜像**与逐朵相位。
 *
 * ⚠️ 不要靠"放大单朵"来省节点：试过 400 宽（2 倍、170 朵），单朵更清楚，但一眼就能数出
 *    "同一张图铺了几遍"。这里的判据是**密**，不是"大"。
 *
 * ## 为什么不按"节点离屏幕中心的方向向量"算推出方向
 *
 * 按「节点离屏幕中心的方向向量」推，顶部那一排会得到"大部分朝上、略微左右"的斜向位移 ——
 * 而用户要的是**四个方向**：下方往下、上方往上、两侧往左右（截图上的箭头全是水平/垂直的）。
 * 所以方向由 {@link TERRITORY_BATTLE_INTRO_TARGETS} 逐件声明，页面只管照着推。
 *
 * ⚠️ 表里是 **prefab 节点名**（`ArenaRoot` 那一层），与 `MainTerritoryMap` 现有的
 *    `TOP_HUD_NODE_NAME` / `BOTTOM_HUD_NODE_NAMES` 同一口径：按名字找、找不到就跳过，
 *    不写死路径（宿主页结构一动，路径就断）。
 *
 * ## 为什么散开时"先慢后快"
 *
 * `in` 段的位移与逐朵淡出都用 `easeIn`（前段几乎不动、后段一下甩开）。云要"静止等待"，
 * 起手就匀速平移会读成"一直在慢慢飘"，而 `easeIn` 让它**先咬住画面、再一口气散掉** ——
 * 这正是"等到了，走吧"的读法。
 */

/**
 * `out` 段时长（秒）：UI 推出 + 地块隐藏 + 云合拢，三件事**同一条时间轴**。
 *
 * 0.55s 的依据：比宝箱开箱（2.3~3.2s）短得多 —— 这是个"过场"不是"表演"，
 * 玩家按下开战之后要尽快进战斗；再短（< 0.4s）云来不及"看出来是在往中间收"。
 */
export const TERRITORY_BATTLE_INTRO_OUT_SECONDS = 0.55;

/** `in` 段时长（秒）：云散开 + 淡到全透明。比 `out` 略短 —— 散场总比进场利索。 */
export const TERRITORY_BATTLE_INTRO_IN_SECONDS = 0.45;

/**
 * `in` 段到这个进度就**发起跳转**（0~1）。
 *
 * 不等到 1 才跳：跳转之后流程管理器还要预加载 + 切场景，这段时间里云已经散完，
 * 屏幕上会是"没有 UI、地块也透明"的空白页。提前到 0.6 起跳 ⇒ 切场景与最后那点云的
 * 淡出重叠，玩家看不到空白帧。
 */
export const TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO = 0.6;

/**
 * `hold` 段最长等多久（秒）；超时按**取消**处理（复位、不跳转）。
 *
 * 这是防"卡死"的兜底，不是手感参数：`hold` 由服务器回包驱动，回包丢了（断网 / 请求被顶掉）
 * 就必须自己解开 —— 否则整页被云盖住、输入锁着，玩家只能杀进程。
 * 3s 取在"明显是网络问题"与"再等等也许就回来了"之间。
 */
export const TERRITORY_BATTLE_INTRO_HOLD_MAX_SECONDS = 3;

/**
 * 回包已经到、但**目标页资源还没就绪**时，云最多再盖着等多久（秒）。
 *
 * 用户 2026-11-02：「需要等待战场资源加载后，云雾才散开」—— 实机 `首帧资源准备完成`
 * 要 **5 秒上下**（`[BattleLoading] 首帧资源准备完成 5079ms`）。所以这一段绝不能用
 * `HOLD_MAX` 那个 3 秒：那是"等回包"的超时，套过来就会在资源还没好时把云撤掉，
 * 玩家照样看 5 秒空屏 —— 等于什么也没改。
 *
 * 12s 只是防死锁上限（加载卡死 / promise 永不兑现）。**超时不是失败**：照样进 `in`、
 * 照样跳转，让战场页自己显示它的加载态；只是把云撤掉而已。
 */
export const TERRITORY_BATTLE_INTRO_READY_MAX_SECONDS = 12;

/**
 * 跳转已经发出、但页面还没被销毁时，**多久之后**才把主界面还原回来（秒）。
 *
 * `in` 段播完（云已散尽）到"流程真正切走"之间是**预加载**的剩余时间。这段时间里如果把
 * UI 复位、地块还原，主界面会整片闪回来一下（等于过场白做），所以默认**不复位**。
 *
 * 2026-11-02 起这条只管**最后一种**情况：连流程切换的"落定信号"都没收到
 * （路由注册漏了 / 切换被永久挂起）。正常失败由页面订阅
 * `ProcedureManager.onSwitchSettled(false)` 当场收尾并提示，成功则由
 * `onSwitchSettled(true)` 把待还原现场作废 —— 两头都不依赖这个定时器。
 *
 * 因此这里可以放宽：原来 1.5s 会误伤"preload 失败 ⇒ 退回 `prepareDirect` 现场加载"
 * 那种几秒级的正常切换（UI 提前闪回来，然后战斗页才压上来）。6s 只用来兜死局。
 *
 * ⚠️ 定时器挂在页面组件上：跳转成功 ⇒ 页面销毁 ⇒ 回调自然不执行。
 */
export const TERRITORY_BATTLE_INTRO_RESTORE_FALLBACK_SECONDS = 6;

/** 地块缩到多小（倍率，< 1 = 变小）。0.8 ⇒ 缩 20%，"变小"读得出来又不至于缩成一个点。 */
export const TERRITORY_BATTLE_INTRO_CELL_SCALE = 0.8;

/**
 * UI 推出的距离占**长边**的比例（0~…，1 = 整条长边）。
 *
 * 0.9 的依据：一行 UI 挂在屏幕边缘，要把它彻底推出画面，位移至少得跨过
 * 「屏幕中心到该边的距离 + 自身尺寸」≈ 0.5~0.6 条长边。0.9 留了余量，同时不至于让
 * 位移大到"前 20% 的进度就已经看不见"（那样淡出就白做了）。
 */
export const TERRITORY_BATTLE_INTRO_UI_PUSH_RATIO = 0.9;

/**
 * UI 从第几个进度开始淡（0~1）。之前保持全不透明。
 *
 * 0.4 ⇒ 前 40% 只位移不淡（"被推走"的动作先读出来），后 60% 一边推一边淡到看不见。
 * 一上来就淡会读成"闪一下没了"，与"推出"矛盾。
 */
export const TERRITORY_BATTLE_INTRO_UI_FADE_FROM = 0.4;

/**
 * 云团在 `out` 起手 / `in` 收尾时，离开**画面中心**的放大倍率。
 *
 * 1 = 就位（铺满整屏）；2.2 ⇒ 每团退到 2.2 倍远处 —— 750×1334 的屏幕上最外圈落在
 * ±1650 / ±2935，远在画面之外，所以起手那一帧屏幕是**干净**的。
 */
export const TERRITORY_BATTLE_INTRO_COVER_SPREAD = 2.2;

/**
 * 云贴图的**原始边长**（px）。`image/territory/cloud/cloud_body_0` 实测 200×240。
 *
 * 只用来校"放大几倍"（见 {@link TERRITORY_BATTLE_INTRO_COVER_WIDTH}）与用例的覆盖率推算，
 * 视图那边写的是**显示尺寸**（`sizeMode = CUSTOM`），不会跟着位图走。
 */
export const TERRITORY_BATTLE_INTRO_COVER_ART_WIDTH = 200;
export const TERRITORY_BATTLE_INTRO_COVER_ART_HEIGHT = 240;

/**
 * 一朵云在屏幕上**显示多大**（px）—— 1.3 倍（200×240 → 260×312）。
 *
 * 用户 2026-11-02 给的参照是领地图"云海铺满"的观感（细密小云、几乎无缝）。所以这里
 * **不做大团**：260 宽 ≈ 地图自己那些云的 1.3 倍，铺出来是同一张脸。
 *
 * 早先试过 400（2 倍）：单朵更清楚，但整屏只有 170 朵，一眼能数出"一张图铺了几遍"。
 * 现在靠**密**——1080×1920 上约 375 朵，小到数不清，读成云海。
 */
export const TERRITORY_BATTLE_INTRO_COVER_WIDTH = 260;
export const TERRITORY_BATTLE_INTRO_COVER_HEIGHT = 312;

/**
 * 云团倍率的随机区间（每团不一样，打散"一行行摆上去"的观感）。
 *
 * 窄区间是**故意**的：这里要的是"一屏云海"（用户参照图里每朵云长得差不多大），
 * 不是"大小错落的几团雾"。宽倍率会让大朵显眼、小朵留缝，反而露出"拼贴感"。
 * 靠的是**密**（~375 朵）而不是靠大小差。
 */
export const TERRITORY_BATTLE_INTRO_COVER_SCALE_MIN = 0.9;
export const TERRITORY_BATTLE_INTRO_COVER_SCALE_MAX = 1.12;

/**
 * 单团云的基准不透明度区间：0.95~1。
 *
 * 与旧的程序雾（0.6~0.88）相反 —— 这里要的是"盖住"而不是"透出来"。云图边缘本身就有
 * 抗锯齿的过渡，半透明叠半透明会叠成一层灰雾、把云体的明暗一起抹平（那就白换美术了）。
 */
export const TERRITORY_BATTLE_INTRO_COVER_ALPHA_MIN = 0.95;
export const TERRITORY_BATTLE_INTRO_COVER_ALPHA_MAX = 1;

/**
 * 云团中心点的横向 / 纵向间距（px）。
 *
 * 硬约束：间距要小于**云体的有效宽高**。`cloud_body_0` 放大 1.3 倍后，云体（不透明那块）
 * 实测占 260 × 156，且**贴在上半截**（下半截整片透明）——所以纵向要比横向更保守：
 * 间距 94 < 云体 156。
 *
 * 107 / 94 是扫出来的（`tools/scan_cloud_cover.py`，按 `cloud_body_0` 真实 alpha 逐点按
 * `1 - Π(1 - a)` 合成）：1080×1920 上 **375 团、最低遮挡 0.950、平均 0.998**。
 * 间距是按"占显示宽的比例"定的（0.41 / 0.30）——小云版本最容易犯的错就是"尺寸缩小了、
 * 间距没跟着缩"，那会变成筛子（实测 118/104 时最薄处只有 **0.176**）。
 * **改间距/倍率必须重跑那个脚本**，光看预览图看不出漏缝。
 */
export const TERRITORY_BATTLE_INTRO_COVER_GAP_X = 107;
export const TERRITORY_BATTLE_INTRO_COVER_GAP_Y = 94;

/**
 * 待机循环每帧停留多久（秒）。
 *
 * ⚠️ **当前只有 1 帧**（`cloud_body_0`），这条时长实际不生效：用户 2026-11-02 晚上要的是
 *    「云**静止**在匹配界面下方」，而能换的 5 帧（`cloud_idle_1..4`）都带着那层黑影
 *    （见文件头第 ④ 版），换上去整屏就发灰。美术哪天给出**纯云体**的多帧，
 *    把帧塞进 `setBattleCloudFrames` 就自动恢复呼吸，这里不用改。
 *
 * 0.18 是当初定的节拍：一轮 0.9 秒。比这快读成"云在抽搐"，比这慢在 `hold` 那几秒里
 * 根本看不出在动。
 */
export const TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS = 0.18;

/**
 * 云层铺到视口外多远（px）。
 *
 * 不留余量的话，`out` 段云还在往里收的时候，屏幕四条边会先露出没被盖住的空当
 * （地块虽然已经透明，但底图/页面底色会透出来，读作"云没盖严"）。
 *
 * 160 是"够用"与"别白画"之间的值：再大只是多铺一圈永远出不了画面的云
 * （1080×1920 的屏，余量每加 100 ⇒ 多 ~15 团、多一份全屏 overdraw）。
 */
export const TERRITORY_BATTLE_INTRO_COVER_MARGIN = 160;

/**
 * 位置抖动幅度（占间距的比例，0~0.5）。
 *
 * 0.3 ⇒ 每团最多偏离格点 ±0.15 个间距（横向 ±25px、纵向 ±22px）：
 * 够把"网格"打散成随机错落，又留得住"每处都被两三团叠着"这件事。
 */
export const TERRITORY_BATTLE_INTRO_COVER_JITTER = 0.3;

/**
 * `in` 段的**错峰**上限（0~1）。
 *
 * 每团云各自晚走一点（`delay ∈ [0, 错峰上限]`）：散场是**一块块先后淡**的，
 * 不是整屏一起降透明度。0.5 ⇒ 最后一团到一半进度才开始淡，剩下的一半里淡完。
 * 取太大（>0.7）会让最后那批"刚要走画面就切了"，读作"没散完"。
 */
export const TERRITORY_BATTLE_INTRO_COVER_STAGGER = 0.5;

/** UI 推出的方向（只有四个：与用户截图上那些水平/垂直箭头一致）。 */
export type TerritoryBattleIntroDir = 'left' | 'right' | 'up' | 'down';

/** 一件要推出去的 HUD：`name` 是 prefab 节点名，`dir` 是它往哪边飞。 */
export interface ITerritoryBattleIntroTarget {
    readonly name: string;
    readonly dir: TerritoryBattleIntroDir;
}

/**
 * 过场要推出去的 HUD 清单（按用户截图逐个点名）。
 *
 * | 节点 | 方向 | 是什么 |
 * | --- | --- | --- |
 * | `PlayerCard` | 左 | 左上角玩家卡（头像 / 名字 / 战力） |
 * | `EntryBar` | 右 | 右上角 好友 / 邮件 / 排行榜 / 邀请 |
 * | `ResBarLayer` | 右 | 右上角资源条（银币 / 体力） |
 * | `LeftList` | 左 | 左侧入口列表 |
 * | `RightList` | 右 | 右侧入口列表 |
 * | `OSRankEntry` | 右 | 右侧排行入口 |
 * | `BeginGame` | 下 | 底部「快速寻敌」 |
 * | `BottomHud` | 下 | 底部任务入口 / 聊天条 |
 * | `ChestBar` | 右 | 右下角宝箱栏 |
 * | `BottomNav` | 下 | 最底部七格导航（在 `MainRoot` 上，不在 `ArenaRoot` 里） |
 *
 * 为什么 `TopHud` 拆成三件而不是整体往上推：用户的箭头是**左右分开**的
 * （左上那件往左、右上那些往右），整体往上推会读成"顶栏整体升天"，与要求不符。
 */
export const TERRITORY_BATTLE_INTRO_TARGETS: readonly ITerritoryBattleIntroTarget[] = [
    { name: 'PlayerCard', dir: 'left' },
    { name: 'EntryBar', dir: 'right' },
    { name: 'ResBarLayer', dir: 'right' },
    { name: 'LeftList', dir: 'left' },
    { name: 'RightList', dir: 'right' },
    { name: 'OSRankEntry', dir: 'right' },
    { name: 'BeginGame', dir: 'down' },
    { name: 'BottomHud', dir: 'down' },
    { name: 'ChestBar', dir: 'right' },
    { name: 'BottomNav', dir: 'down' },
];

/** 方向 → 单位向量（y 向上为正，与 Cocos 本地坐标一致）。 */
export function territoryBattleIntroDirVector(dir: TerritoryBattleIntroDir): { readonly x: number; readonly y: number } {
    switch (dir) {
        case 'left': return { x: -1, y: 0 };
        case 'right': return { x: 1, y: 0 };
        case 'up': return { x: 0, y: 1 };
        // 兜底落在 `down`：脏值宁可往下飞（屏幕上最快的方向），也不要静止不动。
        default: return { x: 0, y: -1 };
    }
}

/**
 * 推出的距离（px）：取视口长边 × {@link TERRITORY_BATTLE_INTRO_UI_PUSH_RATIO}。
 *
 * 入参非法（0 / 负数 / `NaN` / `Infinity`）⇒ 返回 0：宁可"没推出"（UI 还留在原位、只是淡掉），
 * 也不要拿一个脏值把 UI 甩到几十万像素外 —— 那样连淡出都看不见，只剩"UI 凭空消失"。
 */
export function territoryBattleIntroPushPx(width: number, height: number): number {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return 0;
    // 任一边非正 ⇒ 视口没量到（或量歪了）：返回 0（过场退化成"只淡不推"），
    // 绝不拿半条边去算距离 —— 那会把 UI 推出一个和屏幕无关的量。
    if (!(width > 0) || !(height > 0)) return 0;
    return Math.max(width, height) * TERRITORY_BATTLE_INTRO_UI_PUSH_RATIO;
}

/** 一帧的过场姿态。视图照着写节点，不做二次换算。 */
export interface ITerritoryBattleIntroFx {
    /** UI 沿各自方向推出的比例（0 = 原位，1 = 完整距离）。 */
    readonly uiPush: number;
    /** UI 不透明度（1 → 0）。 */
    readonly uiOpacity: number;
    /** 地块倍率（1 → {@link TERRITORY_BATTLE_INTRO_CELL_SCALE}）。 */
    readonly cellScale: number;
    /** 地块不透明度（1 → 0）。 */
    readonly cellOpacity: number;
    /** 云层每朵云离画面中心的距离倍率（{@link TERRITORY_BATTLE_INTRO_COVER_SPREAD} ↔ 1）。 */
    readonly coverSpread: number;
    /** 云层**整层**不透明度（0 → 1 显形；`hold` / `in` 段恒 1，散场是逐朵淡，见 `coverRelease`）。 */
    readonly coverOpacity: number;
    /**
     * `in` 段的**散开进度**（0 = 还没开始散；`out` / `hold` 段恒 0）。
     *
     * 与 {@link coverSpread} 分工：`coverSpread` 是整层一起往四周退的位移，这一段是
     * **逐团**淡出的时间（每团按自己的 `delay` 起走，谁都别整屏一起眨眼）。
     * 交给 {@link territoryBattleIntroCoverAlpha} 换算成那一朵当帧的不透明度。
     */
    readonly coverRelease: number;
    /** 这一段是否已经播到终点（`out` = 合拢到位；`in` = 散尽，可以收工）。 */
    readonly done: boolean;
    /** `in` 段是否已过 {@link TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO}（该发起跳转了）；其它段恒 `false`。 */
    readonly navigate: boolean;
}

function clamp01(value: number): number {
    if (!(value > 0)) return 0;
    return value > 1 ? 1 : value;
}

/** 缓入（前慢后快）—— 散开、地块淡出都用它：先咬住画面，再一下甩掉。 */
function easeIn(x: number): number {
    const value = clamp01(x);
    return value * value;
}

/** 缓出（前快后慢）—— 云合拢用它：起手就明显在收，尾段收住不抖。 */
function easeOut(x: number): number {
    const value = clamp01(x);
    return 1 - (1 - value) * (1 - value);
}

/**
 * `out` 段的进度（0~1）。`elapsed` 非法（`NaN` / 负数）按 0 处理。
 *
 * 三组曲线各有各的理由：
 *  · UI 位移 `easeIn`：被"推"出去，越推越快；
 *  · UI 透明度：前 {@link TERRITORY_BATTLE_INTRO_UI_FADE_FROM} 不淡，之后线性到底；
 *  · 地块 `easeOut`（缩小）/ `easeIn`（透明）：先明显缩一下，再随着云盖上来透掉。
 */
export function territoryBattleIntroOutProgress(elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return clamp01(elapsed / TERRITORY_BATTLE_INTRO_OUT_SECONDS);
}

/** 把 `out` 段进度（0~1）换算成一帧姿态。`done` 在 `progress >= 1` 时为真。 */
export function territoryBattleIntroOutFxAt(progress: number): ITerritoryBattleIntroFx {
    const p = clamp01(progress);
    const fadeFrom = clamp01(TERRITORY_BATTLE_INTRO_UI_FADE_FROM);
    const coverSpan = TERRITORY_BATTLE_INTRO_COVER_SPREAD - 1;
    const cellSpan = 1 - TERRITORY_BATTLE_INTRO_CELL_SCALE;
    return {
        uiPush: easeIn(p),
        uiOpacity: p <= fadeFrom ? 1 : 1 - clamp01((p - fadeFrom) / (1 - fadeFrom)),
        cellScale: 1 - cellSpan * easeOut(p),
        cellOpacity: 1 - easeIn(p),
        coverSpread: TERRITORY_BATTLE_INTRO_COVER_SPREAD - coverSpan * easeOut(p),
        coverOpacity: easeOut(p),
        coverRelease: 0,
        done: p >= 1,
        navigate: false,
    };
}

/** `elapsed` 秒时的 `out` 段姿态。 */
export function territoryBattleIntroOutFx(elapsed: number): ITerritoryBattleIntroFx {
    return territoryBattleIntroOutFxAt(territoryBattleIntroOutProgress(elapsed));
}

/**
 * `hold` 段的姿态 = `out` 段的**末帧**（逐字段相同）。
 *
 * 单独给一个函数而不是让调用方自己 `outFx(OUT_SECONDS)`：`hold` 是"一帧不动"的语义，
 * 用例要能直接断言"`hold` 与 `out` 末帧完全一致"这条不变量（三段之间不许有跳变）。
 */
export function territoryBattleIntroHoldFx(): ITerritoryBattleIntroFx {
    return { ...territoryBattleIntroOutFxAt(1), done: false };
}

/** `in` 段的进度（0~1）。 */
export function territoryBattleIntroInProgress(elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return clamp01(elapsed / TERRITORY_BATTLE_INTRO_IN_SECONDS);
}

/**
 * 把 `in` 段进度（0~1）换算成一帧姿态。
 *
 * UI 与地块**恒为末态**（它们已经被推出 / 已经透明，散场这一段不许回来）；
 * 只有云在动：整层往四周退（`coverSpread`，缓入 ⇒ 先咬住画面再一口气甩开），
 * 同时逐团各自淡出（`coverRelease`）。
 *
 * ⚠️ `coverOpacity` 在 `in` 段**恒为 1**：散场的"变透明"是**一团一团**淡的
 *    （参考图就是这么散的），不是整层一起降 alpha —— 那样会读成"画面整体闪一下"。
 *
 * `navigate` 在 `progress >= TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO` 时为真。
 */
export function territoryBattleIntroInFxAt(progress: number): ITerritoryBattleIntroFx {
    const p = clamp01(progress);
    const eased = easeIn(p);
    const coverSpan = TERRITORY_BATTLE_INTRO_COVER_SPREAD - 1;
    const ratio = clamp01(TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO);
    return {
        uiPush: 1,
        uiOpacity: 0,
        cellScale: TERRITORY_BATTLE_INTRO_CELL_SCALE,
        cellOpacity: 0,
        coverSpread: 1 + coverSpan * eased,
        coverOpacity: 1,
        coverRelease: p,
        done: p >= 1,
        navigate: p >= ratio,
    };
}

/** `elapsed` 秒时的 `in` 段姿态。 */
export function territoryBattleIntroInFx(elapsed: number): ITerritoryBattleIntroFx {
    return territoryBattleIntroInFxAt(territoryBattleIntroInProgress(elapsed));
}

/**
 * 一朵盖层云（画面坐标，原点 = 画面中心）。
 *
 * 每朵自带**倍率 / 不透明度 / 起走延迟 / 镜像 / 待机相位**：
 *
 * | 字段 | 打散的是什么 |
 * | --- | --- |
 * | `scale` | 大小 —— 一样大一眼就是"同一个贴图" |
 * | `alpha` | 浓淡 |
 * | `delay` | 散场先后（"一块块散"而不是整屏闪一下） |
 * | `flip` | 左右镜像 —— 云本来就没有正反之分，翻一下就多一倍形态 |
 * | `frame` | 待机循环的**固定相位**（0~4）—— 同一瞬间屏幕上要同时出现五种云形 |
 *
 * ⚠️ `frame` 是**相位偏移**不是"第几帧"：真正的帧号 = `(全局步进 + frame) % 帧数`
 *    （见 {@link territoryBattleIntroCoverFrameStep}）。这样整层云踩着**同一个节拍**
 *    循环（不会各走各的、读出"屏幕在抖"），但每一朵的形态不同。
 *
 * ⚠️ 2026-11-02 晚上起盖层只有 1 帧（`cloud_body_0`），所以 `frame` 目前是**空转**的
 *    （`% 1` 恒为 0）。留着不动：美术一旦给出纯云体的多帧，`setBattleCloudFrames` 塞进去
 *    就自动生效，点阵这边一个字都不用改。
 */
export interface ITerritoryBattleIntroCover {
    readonly x: number;
    readonly y: number;
    /** 相对 {@link TERRITORY_BATTLE_INTRO_COVER_WIDTH} 的倍率。 */
    readonly scale: number;
    /** 这一朵的基准不透明度（0~1，`in` 段还要再乘淡出进度）。 */
    readonly alpha: number;
    /** `in` 段的起走延迟（0 ~ {@link TERRITORY_BATTLE_INTRO_COVER_STAGGER}）。 */
    readonly delay: number;
    /** 左右镜像（`scaleX = -1`）。 */
    readonly flip: boolean;
    /** 待机循环的相位偏移（0 ~ 帧数-1）。 */
    readonly frame: number;
}

/**
 * 确定性伪随机（同一个 `(a, b)` 永远得到同一个 0~1）。
 *
 * 为什么不用 `Math.random()`：云的位置/大小/浓度必须**每局长得一样**
 * （同一场过场播两遍不一样会读成"地图在抖"），用例也才能逐值断言。
 * `sin` 取小数是经典做法，纯函数、零状态、跨平台一致（engine 的 `sin` 是 IEEE754 实现）。
 */
function coverNoise(a: number, b: number): number {
    const raw = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return raw - Math.floor(raw);
}

/**
 * 铺满整个视口（含 {@link TERRITORY_BATTLE_INTRO_COVER_MARGIN} 余量）的**云层**。
 *
 * 三层打散：
 *  ① 格网隔行错半格（真实云层的团心本来就是错落的）；
 *  ② 每团再按 `coverNoise` 抖一次位置（{@link TERRITORY_BATTLE_INTRO_COVER_JITTER}）；
 *  ③ 每团的倍率 / 不透明度 / 起走延迟 / 镜像 / 待机相位各自随机 —— 这一层是"云"与"贴纸"
 *     的分水岭，五个维度少一个都能一眼看出"是一张图平铺的"。
 *
 * 返回以 (0,0) 为中心的点阵；任一入参非法 ⇒ 空数组（视图据此跳过整个盖层）。
 */
export function territoryBattleIntroCoverPuffs(
    width: number,
    height: number,
    gapX: number = TERRITORY_BATTLE_INTRO_COVER_GAP_X,
    gapY: number = TERRITORY_BATTLE_INTRO_COVER_GAP_Y,
    margin: number = TERRITORY_BATTLE_INTRO_COVER_MARGIN,
): ITerritoryBattleIntroCover[] {
    const out: ITerritoryBattleIntroCover[] = [];
    if (!Number.isFinite(width) || !Number.isFinite(height)) return out;
    if (!(width > 0) || !(height > 0)) return out;
    const stepX = Number.isFinite(gapX) && gapX > 0 ? gapX : TERRITORY_BATTLE_INTRO_COVER_GAP_X;
    const stepY = Number.isFinite(gapY) && gapY > 0 ? gapY : TERRITORY_BATTLE_INTRO_COVER_GAP_Y;
    const pad = Number.isFinite(margin) && margin > 0 ? margin : TERRITORY_BATTLE_INTRO_COVER_MARGIN;
    const halfWidth = width / 2 + pad;
    const halfHeight = height / 2 + pad;
    // `+1` 是为了让最外一列/一行**落在**余量之外，而不是恰好在边界上（边界那团只盖住一半）。
    const columns = Math.ceil((halfWidth * 2) / stepX) + 1;
    const rows = Math.ceil((halfHeight * 2) / stepY) + 1;
    const startX = -((columns - 1) * stepX) / 2;
    const startY = -((rows - 1) * stepY) / 2;
    const scaleSpan = TERRITORY_BATTLE_INTRO_COVER_SCALE_MAX - TERRITORY_BATTLE_INTRO_COVER_SCALE_MIN;
    const alphaSpan = TERRITORY_BATTLE_INTRO_COVER_ALPHA_MAX - TERRITORY_BATTLE_INTRO_COVER_ALPHA_MIN;
    const jitterSpan = TERRITORY_BATTLE_INTRO_COVER_JITTER;
    for (let row = 0; row < rows; row += 1) {
        const rowShift = (row % 2) * stepX * 0.5;
        for (let column = 0; column < columns; column += 1) {
            // 各维度用互不相同的 seed（`coverNoise` 对调参数就是另一条序列），
            // 保证"位置 / 倍率 / 浓度 / 延迟 / 镜像 / 相位"彼此不相关 —— 否则"大团一定更浓"
            // 这种相关性一眼就能看出来（云不该有规律）。
            out.push({
                x: startX + column * stepX + rowShift
                    + (coverNoise(row * 3 + 1, column * 5 + 2) - 0.5) * stepX * jitterSpan,
                y: startY + row * stepY
                    + (coverNoise(column * 7 + 3, row * 11 + 4) - 0.5) * stepY * jitterSpan,
                scale: TERRITORY_BATTLE_INTRO_COVER_SCALE_MIN
                    + scaleSpan * coverNoise(row + 17, column + 23),
                alpha: TERRITORY_BATTLE_INTRO_COVER_ALPHA_MIN
                    + alphaSpan * coverNoise(column + 31, row + 37),
                delay: TERRITORY_BATTLE_INTRO_COVER_STAGGER * coverNoise(row + 41, column + 43),
                flip: coverNoise(row + 59, column + 61) > 0.5,
                // 相位只取 0~4：与 `cloud_idle_0..4` 的帧数对齐。视图会再对它取模，
                // 所以帧数变了也不会越界。
                frame: Math.floor(coverNoise(column + 67, row + 71) * 5),
            });
        }
    }
    return out;
}

/**
 * 一朵云在 `in` 段某一帧的**淡出系数**（0~1，乘在 `cover.alpha` 上）。
 *
 * @param release `in` 段进度（0~1）；`out` / `hold` 段传 0 ⇒ 恒 1（云保持原样，
 *                这一段是"显形 + 就位"，不该有哪朵先淡）
 *
 * 每团按自己的 `delay` 起走：`local = (release - delay) / (1 - delay)`。
 * 除以 `1 - delay` 是让**每一朵都在 `release = 1` 时刚好淡到 0** —— 否则起走晚的那批
 * 到进度 1 还剩一半，屏幕上会挂着几朵没散完的云（那时画面已经该交给匹配/战场了）。
 */
export function territoryBattleIntroCoverAlpha(cover: ITerritoryBattleIntroCover, release: number): number {
    if (!cover) return 0;
    const base = Number.isFinite(cover.alpha) ? clamp01(cover.alpha) : 0;
    if (!Number.isFinite(release) || release <= 0) return base;
    const delay = Number.isFinite(cover.delay) ? clamp01(cover.delay) : 0;
    const local = delay >= 1 ? 1 : clamp01((release - delay) / (1 - delay));
    return base * (1 - easeIn(local));
}

/**
 * 待机循环走到第**几步**（整数，每 {@link TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS} 加一）。
 *
 * 步进而非"秒"：视图拿它去算帧号 `(step + cover.frame) % 帧数`，整层云因此踩着同一个
 * 节拍（各走各的会读出"屏幕在抖"）。`clock` 是过场起演到现在的秒数，脏值当 0。
 */
export function territoryBattleIntroCoverFrameStep(clock: number): number {
    if (!Number.isFinite(clock) || clock <= 0) return 0;
    return Math.floor(clock / TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS);
}
