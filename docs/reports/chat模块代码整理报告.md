# 聊天模块代码整理报告（`assets/script/app/chat`）

整理范围：`assets/script/app/chat` 目录下全部 13 个 `.ts`（`ChatPage` / `ChatTable` / `ChatRepository` / `ChatArt` / `ChatTexts` / `RequestChatMsg` / `ChatBubble` / `ChatPrivateBubble` / `ChatRecruitRow` / `ChatPrivateHead` / `ChatAtRow` / `ChatEmojiItem` / `ChatEntryButton`）及其同名 `.meta`；`.meta` 未改。
硬约束：**行为零变更** —— 对外导出的名字与值不变、prefab 绑定路径不变、事件订阅不变。

## 1 结论

| 项目 | 结果 |
| --- | --- |
| 改动文件 | 13 个（全部为 `M`，`git diff --stat` = 411 增 / 772 删） |
| 回归测试 `tests/chat.test.ts` | **未修改**；58 例全绿 |
| 代码行数 | 2785 → 2437（净减 348 行） |
| 训诫式标记 `⚠️` | 39 处 → 0 处 |
| `tsc` 诊断（chat 目录） | 改动前后均为 **0 条** |
| 根目录卫生 | `npm run verify:hygiene` 通过（8 个白名单文件） |

## 2 改动前先确定的边界

1. **测试是硬边界**。`tests/chat.test.ts` 的 D 段是源码文本断言（`stripComments` 后断言标识符 / 调用 / 绑定次数），因此下列字面必须原样存在：
   `export const CHAT_READ_TIMEOUT_MS` / `CHAT_WRITE_TIMEOUT_MS`、`const READ_TIMEOUT_MS = 800`、`const WRITE_TIMEOUT_MS = 5000`、`private get alive`、`this.revision += 1`、`nextPopupFrame()`、7 条 `this.<list>.renderItemFn = (node, index) => this.renderXxx(node, index)`（各 1 次、位于 `onInit` 内 `onOpen` 之前）、`ChatTable.ts` 零 `import`、`CHAT_ART_SLICED.size === 9` 且键集等于 `CHAT_ART_DIRS` 键集。以上全部保留，未做任何重排。
2. **邻居模块才是本工程的风格基线**：`assets/script/app/friend/{FriendRepository,FriendPage,FriendRow,FriendAvatar}.ts`。它们同样使用 `@property = null`、`private get alive()`、`bind(node, handler)` 里 `console.warn`、`this.avatar?.apply(...)`、`try/catch` 包 `CacheMgr`。因此下面所有改动都以「向 friend 模块看齐」为准，而不是按更严格的 `null!` 规则单方面改造 chat（那会变成顺手格式化，且与邻居割裂）。
3. **prefab 事实决定「哪些写法不能动」**：`assets/bundles/main-pages/ui/Chat/Chat.prefab` 里 `cc.Button` 共 10 个，挂在 `CloseBtn / RowTemplate / JoinBtn / RemoveBtn / EmojiBtn(2) / AtBtn / SendBtn(2) / Mask` 上；`ChatAtRow` 根节点、`ChatEmojiItem` 节点、`ChatPrivateHead` 根节点、`ChatRecruitRow` 的 `Head` 节点**没有** `cc.Button`，它们靠 `Node.EventType.TOUCH_END` 工作。见 §4。

## 3 逐处改动

### 3.1 去 AI 生成痕迹（模板化注释、训诫式口吻、过度考据）

| 文件 | 位置 | 改动内容 | 依据 |
| --- | --- | --- | --- |
| `ChatTable.ts` | 1–7 文件头 | 「与 `FriendTable`/`GiftTable` 同一套分层」+「几何/层的真源是 FGUI」+ 加粗结论压成 3 行：职责、依赖方向、几何在 prefab | 注释应说明业务原因，不复述架构教科书；真源路径保留一句即可回溯 |
| `ChatTable.ts` | 29、57–63 | `channelsFor` / `isReadonlyChannel` 的 `gearDisplay` 逐条清单（4 行）压成 1 行结论，保留 `pages="2,4"`、`pages="3"` 两个实际约束 | 坐标与 gear 清单属 prefab 实现细节，留在 prefab；代码只保留会改行为的两个页签集合 |
| `ChatTable.ts` | 122–130 `toIdString` 注释 | 「⚠️ 必须兼容 Long 对象……否则静默变 0」压成陈述句，保留「静默变 0 → 未读恒假 / 排序错乱」这条真实陷阱 | 陷阱要留，训诫语气与重复加粗不要 |
| `ChatTable.ts` | 229–241 `isSystemRoleId` | 删掉「不能用 BigInt 字面量（TS2737）/ 不能 `Number()` 兜」的整段论证，改成一句「纯字符串比较：`Number()` 丢精度，`BigInt` 字面量过不了当前编译目标」 | 结论足够定位约束；编译目标可从 `tsconfig` 查 |
| `ChatTable.ts` | 241–252 `filterPrivateHeads` | 「两条规则，逐字照抄 ①②」+「⚠️ 不额外排序」压成两段陈述（过滤规则 + 排序原因） | 「逐字照抄」属于对读者的规训，不解释任何业务 |
| `ChatTable.ts` | 原 371–374（现已移除） | 悬空在 `fallbackStageName` 与「未读」分节之间的 4 行 `InfoGroup` / pivot / scale 说明整段删除；其中「`xy` 是 pivot 点、`scale` 围绕 pivot」两句移入 `ChatRecruitRow.ts` 头注释（该文件才是真正 `setPosition` 的地方） | 该段是当初反解 FGUI 的过程稿，且挂在没有任何几何代码的文件里、夹在两个函数之间，既误导又断裂；约束应跟着代码走 |
| `ChatArt.ts` | 1–30 头注释 | 删「⚠️ 共 9 项、少列一项不报错」与 md5 / 来源考据，保留「9 张 ct_* 在同一个 auto-atlas、切图参数必须与 prefab 一致」 | 前者只是对维护者的提醒，后者才是会静默错位的真实约束 |
| `ChatArt.ts` | 60–110 常量注释 | 各 `CHAT_ART_*` 上方 3–4 行注释压到 1 行；**九宫格 LRTB 表原样保留** | LRTB 是真实数据文档（改了会错位），不可压 |
| `ChatRepository.ts` | 150–160、183、225–240、405–415、500+ | 5 处 `⚠️` 段改为陈述句；保留「Long 静默变 0」「Rsp 的 channel/id 才是真源」「`guankaReward` 用 `level` 索引」「广播/已读两处退化原因」 | 这 4 条是会改行为的契约事实，其余是过程记录 |
| `ChatPage.ts` | 1–30 文件头 | 删「版面树 + 四 controller + 层序警告 + 本项目栽过」的大段，保留两条真实时序约束（`renderItemFn` 只绑一次并按下标现取；异步预加载先 `await`） | 层序已在 prefab 固化；文字版版面树必然与 prefab 漂移 |
| `ChatPage.ts` | 66–70 `prefabPath` | 大小写敏感说明由 4 行压成 2 行，路径更正为实际的 `ui/Chat/Chat` | 结论（真机区分大小写）保留，冗余的「Windows 编辑器照跑」省略 |
| `ChatPage.ts` | 316–340 `presentChannel` | 「n90/n63/n98/n75/n106」逐条编号注释压成「页签集合」陈述 | 节点编号属 prefab，代码只关心哪几个页签可见 |
| `ChatPage.ts` | 520–530 `onSendClick` | 「老端 `await SDKMgr.checkMessage` ……本轮不做任何过滤（不假装校验过）」压成 1 行 | 保留「没做过滤」这一事实，删掉自我表态 |
| `ChatPage.ts` | 627–637 `onRecruitJoin` | 战前属性快照的 5 行考据压成 2 行，保留「这一包发不出去」+「不能加入自己」 | 前者决定功能缺口，后者是本地判据 |
| `ChatBubble.ts` / `ChatPrivateBubble.ts` / `ChatRecruitRow.ts` / `ChatPrivateHead.ts` / `ChatAtRow.ts` / `ChatEmojiItem.ts` | 各自文件头 | 「结构树 + 1~3 条真实陷阱」两段式；删掉「44 个格子共用」以外的重复解释 | 行组件头注释的价值是结构树，其余与 `render()` 签名重复 |
| `ChatPrivateHead.ts` | 尾部 | 8 行「红点几何备好（`com_rd` 在 FGUI 里是 `xy="6,12"`……）」压成 2 行 | 备好但未接的红点只需说明「未接」与「位置在 prefab」，不需要抄 FGUI 坐标 |
| `ChatEntryButton.ts` | 1–15 | 20 行「引擎销毁链 ①②③④」考证压成 6 行，保留结论（不 `off` 是安全且刻意的）与依据（`Node._onPreDestroyBase`） | 结论影响「能不能加 onDestroy」，必须留；四步链路拆解属一次性推导 |
| `RequestChatMsg.ts` | 1–16 | 头注释压成「请求体字段照 `Cmd.d.ts` + `uint64` 一律走 `toIdString`」；4 个请求类的 proto 名与 Rsp 结构保留 | proto 名与 Rsp 是契约，注释仍需指明 |
| 全部 13 个文件 | — | 39 处 `⚠️` + 加粗 `**...**` 训诫句式全部清除，改为普通陈述或删除 | `⚠️` 在本工程被当作「重要」标记滥用，实际承担不了区分作用；真正的约束改用「必须/否则」的陈述句表达 |

### 3.2 冗余代码与无效防御（含删除前的引用确认）

| # | 文件 | 位置 | 改动内容 | 依据 / 等价性 |
| --- | --- | --- | --- | --- |
| 1 | `ChatTable.ts` | 148–161 新增 `toRole(raw, idKey)` | `normalizeSpeaker` / `normalizeChatRole` / `normalizeFriendAsRole` 原本是 3 份逐字相同的 13 行实现，只差主键名（`roleId` / `friendId`）；合并为文件内私有 `toRole`，三者各留一行委托（163、225、276） | 三份实现在改动前逐字段比对完全一致（`roleId` / `name` / `img` / `serverId` / `selectServerId` 与 `''`、`num()` 兜底一致）；`toRole` 无 `import`，满足 D12「`ChatTable.ts` 零 import」 |
| 2 | `ChatTable.ts` | 234 `isSystemRoleId` | 删除私有 `isSmallRoleId`，判据并入已导出的 `isSystemRoleId`，`filterPrivateHeads`（247）改调后者 | 两者是同一函数的别名（`isSystemRoleId` 原本只有 `return isSmallRoleId(id);`）；判据逐字保留：去前导 0 → 长度 <5 真 / >5 假 / =5 比 `'09999'` |
| 3 | `ChatTexts.ts` | 17–50 `CHAT_TEXTS` | 删除 `channelReadonly: '该频道不可发言'` | 与 `recruitSilent` 同值，全仓库仅声明处出现（`rg channelReadonly assets tests` → 0 处调用；测试 E2 未断言该键）。**保留 `channelTitle` 的 `?? ''`**（越界返回空串被 E1 断言） |
| 4 | `ChatRepository.ts` | 91、93 接口 | `IChatRepository` 补 `isInited(channel, id)` / `isRecruitsFetched()` 两个签名 | 实现类（198、202）早已有这两个方法，只是接口没声明，页面才被迫走 `unknown` 包装函数 |
| 5 | `ChatRepository.ts` | 文件尾（原 500–510） | 删除 `isChannelInited(repo: unknown, ...)` / `isRecruitsFetched(repo: unknown)` 两个鸭类型包装函数；`ChatPage.ts` 293–299 改为 `this.repo.isInited(...)` / `this.repo.isRecruitsFetched()`（原 268 行） | 二者内部是 `repo as { isInited?: ... }` 的类型绕过 + 「不是函数就返回 false」的双重兜底：仓库是模块单例 `chatRepository`，方法必然存在。删除后 `rg "isChannelInited"` → 0 |
| 6 | `ChatRepository.ts` | 460–461 | 删除 `export const CHAT_READ_KEY_PREFIX`（键前缀常量仍以私有 `READ_KEY_PREFIX` 供内部使用） | 全仓库仅声明处出现，测试未引用；`CHAT_READ_TIMEOUT_MS` / `CHAT_WRITE_TIMEOUT_MS` 按 D3 保留 |
| 7 | `ChatRepository.ts` | 文件尾 | 删除 `export { ChatChannel }` 再导出 | `ChatPage`、`PlayerInfoOtherPage`、测试都直接从 `./ChatTable` 取；删除后 `rg "from './ChatRepository'"` 只剩 `ChatPage` 两行正常 import（`chatRepository` 与类型） |
| 8 | `ChatRepository.ts` | 185 `load()` | 手写的「选中项是否还在列表里、否则退回第一条」三行三元 → `const selected = nextPrivateRoleId(heads, selectedRoleId)`（纯函数在 `ChatTable.ts:260`） | 该纯函数原本只被测试调用，实现与这里的判定逐字一致（存在则保留、否则取首条、空则 `''`）；此行把「只给测试用的判定」接回生产路径，消除重复逻辑 |
| 9 | `ChatRepository.ts` | 316 `markRead` | 删 `if (map[roleId] === now) return;` 与临时变量，改为 `this.readedMap()[roleId] = Date.now();` | 原判断只在「同一毫秒内以同一 roleId 连调两次」成立且两值相同，写入结果一致；`readDirty` 由首次调用置真，无副作用差异 |
| 10 | `ChatRepository.ts` | 330 `reset` | `for (const caller of this.listeners.keys())` → `[...this.listeners.keys()]` | 原写法在迭代中 `delete` 同 Map，改为先取快照再逐个 `unlisten`，语义相同且不再依赖「删除当前项后迭代器仍有效」这一实现细节 |
| 11 | `ChatRepository.ts` | 391–397 `initChannel` 回调 | 先 `const list = normalizeMessages(...)`、末尾再使用 → 内联为 `list: normalizeMessages(rsp?.list)` | 中间变量只被用一次，且落在回调末尾，无提前返回依赖 |
| 12 | `ChatRepository.ts` | 418 `sendMessage` | `(content ?? '').trim()` → `content.trim()` | 形参类型为 `string`（接口 105 行同签名），`??` 永不触发 |
| 13 | `ChatPage.ts` | 62–75（原 100–111） | 删除 `type ChatTabLike = FriendTabButton` 及 `as ChatTabLike \| null` 断言；`renderTabNode`（398）直接 `node.getComponent(FriendTabButton)` | 别名没有任何窄化作用，只多一层间接；与 `FriendPage.renderRow` 的 `getComponent` 写法一致。`rg "ChatTabLike"` → 0 |
| 14 | `ChatPage.ts` | 316、332–334 | 删除 `setPlaceholder(box, text)`（单行赋值 + `if (box)` 判空） | 两个调用点改为 `this.inputBox.placeholder = ...` / `this.privateInputBox.placeholder = ...`：两个 `EditBox` 都是 `@property` 绑死引用，按工程规则不判空。`rg "setPlaceholder"` → 0 |
| 15 | `ChatPage.ts` | 502–507 原 `serverNameOf` | 删除单行函数 `serverNameOf(row)`，`renderAtNode` 内联 `String(view.selectServerId)` 并留一行说明（本工程无区服表，按老端 fallback 显示 id） | 函数体就是 `String(row.selectServerId)`，无分支。`rg "serverNameOf"` → 0 |
| 16 | `ChatPage.ts` | 454–487 五处回调 | 删除 `dispatchIndex(index, action)`（只判 `index < 0`，而回调来源的 index 恒 ≥0）；`onJoin` / `onHead` / `onSelect` / `onRemove` / `onPick` 改为直接调用；招募头像仍按 index 现取 `this.recruitRows[index]?.roleId ?? ''` | 5 个调用点的 index 都来自 `renderItemFn(node, index)`，非负；越界由各处理函数自身的 `if (!row) return` 兜住（行为与原一致）。`rg "dispatchIndex"` → 0 |
| 17 | `ChatPage.ts` | 697 新增 `private get selfId()` | `const selfId = this.snapshot?.selfId ?? ''` 在 `renderMessageNode` / `renderPrivateNode` / `renderRecruitNode` / `onRecruitJoin` 重复 4 次 → 收敛为 getter（4 处改用它） | 取值表达式完全一致；getter 命名统一，避免每处各写一遍 `?.` 兜底 |
| 18 | `ChatPage.ts` | 316–340 `presentChannel` | ① `silentLabel.active = channel === ChatChannel.Recruit` → `isReadonlyChannel(channel)`；② 两处 `channel === World \|\| channel === Union` → 一个 `const publicInput = canSpeak(channel) && !isPrivateChannel(channel)`，同时驱动 `inputBar.active` 与 `atButton.active` | `isReadonlyChannel` 的实现就是 `channel === Recruit`（`ChatTable.ts:63`）；`canSpeak` 为「2/4 真、3 假、0/1 假」。艾特按钮挂在输入条内部，其实际可见集合仍是 {2,4}，与原两行赋值等价；两处判定的「口径函数化」让页面不再内联频道枚举 |
| 19 | `ChatPage.ts` | 359–380 `presentBodies` | `this.applyList.node.active = ...; if (this.applyList.node.active)` 的自我回读 → 局部 `const showApply` | 与相邻 `showMessages` / `showPrivate` 两个局部变量同构；布尔值在三行内不会被外部改动 |
| 20 | `ChatPage.ts` | 489–500 `renderEmojiNode` | 先取 `const frame = this.emojiFrames[index] ?? null` 再判越界 → 先判 `index >= this.emojiFrames.length` 再 `item.render(this.emojiFrames[index])` | 越界分支里 `frame` 被丢弃，原写法白取一次；分支结果与调用顺序不变（`node.active = true` 仍只在未越界时执行） |
| 21 | `ChatPage.ts` | 214–225 `onOpen` | `roleId === undefined \|\| roleId === null ? '' : String(roleId)` → `String(userData?.roleId ?? '')` | 逐一核对：`undefined`/`null` → `''`；`0` → `'0'`；`''` → `''`；数字与数字串 → 同 `String()`。`??` 只拦 `null/undefined`，因此 `0` 不会被吞 |
| 22 | `ChatPage.ts` | 528–535 `onSendClick` | `(input?.string ?? '').trim()` → `input.string.trim()` | `input` 来自两个 `@property` `EditBox` 二选一，必有值；`EditBox.string` 类型为 `string` |
| 23 | `ChatPage.ts` | 569、583 | `` `${box.string ?? ''}${tag}` `` → `box.string += tag`（表情插两框、艾特插公共框） | `EditBox.string` 非空类型，`??` 无效；`+=` 与模板拼接结果相同 |
| 24 | `ChatPage.ts` | 705 `bind(node, handler)` | `node?.getComponent` / `node?.name ?? '?'` → `node.getComponent` / `node.name` | 与 `FriendPage.bind` 完全对齐：`bind` 只由 `onInit` 里的 `@property` 按钮调用，`node` 非空 |
| 25 | `ChatEntryButton.ts` | 44 `openChat` | 删掉中间变量 `manager`，直接 `PopupManager.inst.openAsync(ChatPage)` | 单次使用；`PopupManager` / `ChatPage` / `openAsync` 字面按 D11 保留；返回 `null` 的判空与 `console.error` 保留（管理器常驻节点被销毁时真实可达） |
| 26 | `ChatArt.ts` | 80–105 | `CHAT_ART_SLICED`（9 行手写名单）与 `CHAT_ART_DIRS`（9 个键）是同一批图名的两份清单 → 先定义 `CHAT_ART_DIRS`，`CHAT_ART_SLICED` 改为 `new Set(Object.keys(CHAT_ART_DIRS))` | 两份清单只要漏改一份就会「九宫格清单里有、目录表里没有」，测试 B 段正是在断言两者同一批。派生后 size 仍 9、键集仍相等、`chatSpriteType` 9 项仍返 1 |
| 27 | `ChatPage.ts` | 186–190 `onInit` | 关闭按钮原本单独走 `const close = this.closeButton.getComponent(Button); close?.node.on(...)`，改为 `this.bind(this.closeButton, this.onCloseClick)`，与其余 6 个按钮同一路径 | 同文件里同一件事两种写法；`bind` 已处理「节点没挂 `Button`」的情况（prefab 的 `CloseBtn` 有 `Button`，`console.warn` 不会触发） |
| 28 | `ChatPage.ts` | 464 `renderRecruitNode` | `row.onHead = () => this.onPlayerInfo(this.recruitRows[index]?.roleId ?? '')` → `() => this.onPlayerInfo(view.roleId)` | `view` 在上一行已被判为非空，且就是本行显示的那条；按下标重取在列表变短时会拿到别的 id。`onJoin` 仍走 `index`（处理函数自带 `if (!row) return`） |
| 29 | `ChatPage.ts` | 303–308 `present` | `if (!this.snapshot) return;` 之后连读三次 `this.snapshot` → 先取局部 `const snapshot` | 与同文件其他「判空后取局部再传」的写法一致；窄化后不再重复读属性 |

### 3.3 命名一致性 / 格式 / 结构

| 文件 | 位置 | 改动内容 | 依据 |
| --- | --- | --- | --- |
| `ChatTable.ts` | 111–130 `toIdString` | 局部 `o` / `s` → `row` / `text` | 与 `FriendRepository` / `ChatRepository` 的 `row` 习惯统一；单字母名在 3 层嵌套里不可读 |
| `ChatTable.ts` | 132–190 `num` / `normalizeMessage` / `normalizeMessages` / `isSelfMessage` | `o` → `row`、`msg` → `message` | 同上；`message` 与接口 `IChatMessage` 对齐 |
| `ChatTable.ts` | 148–161 | 新增 `toRole` 放在 `normalizeSpeaker` 之前并写明「三处字段同构、只有主键名不同」 | 私有 helper 紧邻首个使用者；注释解释「为什么要合并」，而非复述实现 |
| `ChatTexts.ts` | 54–60 `formatText` | 回调参数 `_m, i` → `_placeholder, index`，内层 `v` → `value` | `_placeholder` 保留「未使用」语义（`_` 前缀），`index` 与 `String.replace` 第二参数一致；逻辑（全局替换、缺参补空串）不变 |
| `ChatAtRow.ts`、`ChatEmojiItem.ts`、`ChatPrivateHead.ts`、`ChatRecruitRow.ts` | 43、28、49、80 | `onLoad()` → `protected onLoad()` | 与 `FriendRow.ts` / `ChatBubble.ts` 的声明一致性；四个文件里此前混用 `public`/无修饰 |
| 6 个行组件 | `hide()` 方法 | 统一补一句「整格 / 整行藏掉（数据不足时由宿主调用）」 | 六个 `hide()` 行为相同，之前只有 2 个有注释，形成随机差异 |
| `ChatRepository.ts` | 183–196 | 私有字段注释改为「字段作用 + 数据来源」两句式，去掉 `（老端 xxx）` 的逐个出处 | 出处只对首次追溯有价值，保留在关键契约（timeout、Rsp 真源、level 索引）处 |
| 全部 13 个文件 | — | 删除行尾多余空格与连续空行超过 2 行的段落，保持 4 空格缩进 / 单引号 / 分号 | `docs/agent/开发细则.md` 命名与风格章节 |
| `ChatRepository.ts` | 292–300 `joinedUnion` | `catch {}` 静默吞异常 → `catch (error) { console.warn(...); return false; }` | 同文件另外三处缓存读取（`selfId` / `cachedChatRoles` / `friendRows`）都会留痕，只有这一处静默，排查时看不到；仅日志差异 |
| `ChatEntryButton.ts` | 12–16 `redDot` | 英文 tooltip `Optional notification dot supplied by the host` → 中文「红点节点（可选，由宿主提供；当前底部聊天条未挂）」 | 模块内其余 `@property` tooltip 全是中文 + 节点路径格式；D11 未约束 tooltip 文案 |
| `ChatPrivateBubble.ts` | 45 `lastSelf` | 补一行「上一次铺的是不是自己发的」说明（与 `ChatBubble` 同字段同注释） | 两份同构组件里只有一个写了注释，属于随机差异 |

### 3.4 删除项引用确认（命令与结果）

```text
rg -n "isChannelInited|CHAT_READ_KEY_PREFIX|ChatTabLike|dispatchIndex|setPlaceholder|serverNameOf" assets tests
→ 无输出（exit 1）

rg -n "channelReadonly" assets tests
→ 无输出（exit 1）

rg -n "from './ChatRepository'|from '../chat/ChatRepository'" assets tests
→ assets\script\app\chat\ChatPage.ts:37  import { chatRepository } from './ChatRepository';
→ assets\script\app\chat\ChatPage.ts:38  import type { IChatRepository, IChatSnapshot, IRecruitView } from './ChatRepository';
（即删掉 `export { ChatChannel }` 后，没有任何文件再从 ChatRepository 取该枚举）
```

## 4 明确未改动的项与理由

| 项 | 未改理由 |
| --- | --- |
| `ChatAtRow` / `ChatEmojiItem` / `ChatPrivateHead` / `ChatRecruitRow.Head` 的 `TOUCH_END` 绑定 | prefab 里这 4 个节点**没有** `cc.Button`。改成 `Button.EventType.CLICK` 会变成静默死按钮，且需要同时改 prefab 并刷新 MCP，超出本次「代码整理」范围 |
| `@property ... = null` 未批量改 `null!` | 邻居 `FriendRow` / `FriendPage` 即为 `= null` 写法；单方面改 chat 会与同层模块割裂，且属于「顺手格式化」 |
| `alive` getter、`bind()` 里的 `console.warn`、`this.avatar?.apply(...)`、`try/catch` 包 `CacheMgr`、`readStorage/writeStorage` 的 `globalThis.localStorage?.` | 与 friend 模块同款边界防御，删掉会改变异常路径 |
| `ChatBubble` 与 `ChatPrivateBubble` 不合并 | 两份 `render` 虽近似，但几何与模板不同（气泡左右锚点、私聊多一行时间戳），合并只能把布局差异塞进代码分支，且需改类继承关系、触及 prefab 序列化 |
| `as never` 请求体转换（`ChatRepository`） | proto 类型是 `id?: Long \| null`，而实际传 `string` 给 `ProtoInput` 存在真实类型缺口；与 `FriendRepository` 的 `(rsp: any)` / `make: () => any` 风格一致 |
| `hasUnread` / `canSpeak` / `isReadonlyChannel` / `needsAtButton` / `nextPrivateRoleId` / `chatTint` / `CHAT_HEAD_ART` / `chatSpriteType` / `CHAT_ART_DIRS` 保留导出 | 测试 B/E 段把它们钉为「口径」，删了会破断言；其中 `canSpeak` / `isReadonlyChannel` / `nextPrivateRoleId` 已在本次接回生产路径 |
| `ChatRecruitRow` 的 `normalPositions` + `SelfLayout` 两档坐标 | prefab 中 `SelfLayout` 节点存在（1 处），该代码路径有效 |
| `sendTime` 升序、`formatStageName` 的 `replace`（非插入）、`chatKey` 的频道枚举分支 | 属行为口径，改了会变语义（尤其 `chatKey` 只对已枚举频道共用 key，未枚举频道原本逐频道独立） |
| `ChatPage` 的 `renderItemFn` 7 条绑定、`revision` 校验、`nextPopupFrame()` | 测试 D7/D8 的源码断言 + 真实时序依赖，均原样保留 |

## 5 验证记录（本次实跑）

| 命令 | 结果 |
| --- | --- |
| `npx tsx --test tests/chat.test.ts` | `# tests 58` / `# pass 58` / `# fail 0`（改动前基线同为 58/58） |
| `npx tsx --test tests/view-intent-events.test.ts tests/callback-owner.test.ts tests/component-controller.test.ts` | 12 例全绿（`# fail 0`） |
| `npx tsc --noEmit -p tsconfig.json --pretty false` | 过滤 `app/chat` → **0 条**。全工程仍有既有诊断，全部落在本次未触碰的模块：`bigmap/BigMapConfigLoader`（`BigMapRawTables` 未声明）、`celebration/{CelebrationFrames,OSRankItem,OSRankPage,OSShopItem}`、`friend/{FriendApplyPage,FriendPage}`（`FriendTab.list/add/black` 大小写）、`gift/GiftPage`（参数个数） |
| `npm run verify:hygiene` | `root hygiene OK: 8 个白名单文件` |
| `git status --porcelain -- assets/script/app/chat tests/chat.test.ts` | 13 个 chat 源文件 `M`，`tests/chat.test.ts` 无改动 |
| `git diff --stat -- assets/script/app/chat` | `13 files changed, 411 insertions(+), 772 deletions(-)` |

第二轮（追加 §3.2 的 26–29、§3.3 的三条）已重跑同一组命令：`tests/chat.test.ts` 58/58、`tsc` 过滤 `app/chat` 0 条、`verify:hygiene` 通过。

说明：全工程 `tsc` 的既有诊断条数在同一台机器上多次运行会给出 6~16 条不等的输出（均为上述未触碰模块，与 chat 无关），因此本次判定口径取「chat 目录诊断数」——改动前后均为 0。

## 6 汇总改动清单

### 6.1 按文件（行数 前 → 后）

| 文件 | 前 | 后 | 改动 |
| --- | --- | --- | --- |
| `ChatTable.ts` | 497 | 422 | 合并 3 份角色归一化 → `toRole`；合并 `isSmallRoleId` → `isSystemRoleId`；`o/s/msg` 改 `row/text/message`；FGUI 反解笔记与悬空 pivot 段删除；注释去训诫化 |
| `ChatArt.ts` | 187 | 136 | 头注释与常量注释压缩；`CHAT_ART_SLICED` 改为由 `CHAT_ART_DIRS` 派生；九宫格 LRTB 表保留；导出名与值不变 |
| `ChatPage.ts` | 798 | 718 | 删 `ChatTabLike` / `setPlaceholder` / `serverNameOf` / `dispatchIndex`；新增 `selfId` getter；`isReadonlyChannel` / `canSpeak` 接入；`showApply` 局部化；关闭按钮走 `bind()`；`onHead` 去掉按下标重取；无效 `??` / `?.` 清理；`bind` 对齐 `FriendPage` |
| `ChatRepository.ts` | 510 | 463 | 接口补 `isInited` / `isRecruitsFetched`；删 2 个鸭类型包装 + 2 个死导出；`load` 接回 `nextPrivateRoleId`；`markRead` / `reset` / `initChannel` / `sendMessage` 清理；`joinedUnion` 补异常日志 |
| `ChatRecruitRow.ts` | 162 | 159 | 注释压缩并接收 FGUI 坐标说明；`protected onLoad`；布局与 `SelfLayout` 逻辑零改动 |
| `ChatBubble.ts` | 100 | 91 | 注释压缩（结构树 + 陷阱） |
| `ChatPrivateHead.ts` | 97 | 81 | 注释压缩，尾部红点块 8 行 → 2 行 |
| `ChatPrivateBubble.ts` | 82 | 80 | 注释压缩，`lastSelf` 补说明 |
| `ChatAtRow.ts` | 77 | 75 | 注释压缩；`protected onLoad` |
| `RequestChatMsg.ts` | 59 | 47 | 头注释压缩，保留 proto 名与 Rsp 说明 |
| `ChatEntryButton.ts` | 71 | 54 | 销毁链考证压缩；`protected onLoad`；内联 `manager`；tooltip 改中文 |
| `ChatEmojiItem.ts` | 51 | 46 | 注释压缩；`protected onLoad` |
| `ChatTexts.ts` | 94 | 65 | 删 `channelReadonly`；头注释压缩；`formatText` 参数改名 |
| **合计** | **2785** | **2437** | 净减 348 行 |

### 6.2 按类别（共 32 项，全部为行为等价的清理）

**删除 / 合并重复（14 项）**

1. `ChatTexts.ts`：未引用的文案键 `channelReadonly`
2. `ChatTable.ts`：私有别名函数 `isSmallRoleId`
3. `ChatTable.ts`：两份重复的角色归一化实现（并入 `toRole`）
4. `ChatRepository.ts`：`isChannelInited` / `isRecruitsFetched` 两个 `unknown` 包装函数
5. `ChatRepository.ts`：死导出 `CHAT_READ_KEY_PREFIX`
6. `ChatRepository.ts`：`export { ChatChannel }` 再导出
7. `ChatRepository.ts`：`markRead` 的同毫秒同值提前返回
8. `ChatRepository.ts`：`initChannel` 回调里的单次中间变量 `list`
9. `ChatPage.ts`：类型别名 `ChatTabLike` 与类型断言
10. `ChatPage.ts`：`setPlaceholder` / `serverNameOf` / `dispatchIndex` 三个过度封装小函数
11. `ChatPage.ts`：`presentBodies` 里对 `node.active` 的自我回读
12. `ChatPage.ts`：4 处重复的 `const selfId = this.snapshot?.selfId ?? ''`（收敛为 getter）
13. `ChatTable.ts`：悬空在「未读」分节前的 4 行 FGUI 坐标说明（移入 `ChatRecruitRow` 头注释）
14. `ChatArt.ts`：`CHAT_ART_SLICED` 与 `CHAT_ART_DIRS` 的同一份图名清单（改为派生）

**复用既有实现（4 项）**

15. `ChatRepository.load`：改为调用既有纯函数 `nextPrivateRoleId`
16. `ChatPage.presentChannel`：改用既有 `isReadonlyChannel` / `canSpeak`
17. `ChatPage.renderTabNode`：直接 `getComponent(FriendTabButton)`（与 `FriendPage` 同写法）
18. `ChatPage.onInit`：关闭按钮改走已有的 `bind()`（原本单独写了一套）

**无效防御清理（6 项）**

19. `ChatRepository.sendMessage`：`(content ?? '').trim()` → `content.trim()`
20. `ChatPage.onSendClick`：`(input?.string ?? '').trim()` → `input.string.trim()`
21. `ChatPage.onEmojiPick` / `onAtPick`：模板拼接里的 `?? ''` → `+=`
22. `ChatPage.bind`：`node?.` 与非空 `?? '?'` 移除
23. `ChatPage.onOpen`：三段式 `undefined/null` 判断 → `String(userData?.roleId ?? '')`
24. `ChatPage.renderRecruitNode`：`this.recruitRows[index]?.roleId ?? ''` → 已判非空的 `view.roleId`

**结构与注释（8 项）**

25. `ChatRepository.reset`：迭代 Map 时删除 → 先取快照
26. `ChatRepository`：接口补齐两个已存在方法的签名
27. `ChatRepository.joinedUnion`：静默 `catch {}` 补 `console.warn`
28. 6 个行组件：`onLoad()` 统一为 `protected`，`hide()` 补统一说明
29. `ChatTable` / `ChatPage` / `ChatArt` / `ChatRepository` / `RequestChatMsg` / `ChatEntryButton`：模板化与训诫式注释压缩（`⚠️` 39 → 0），保留会改行为的约束（Long 静默变 0、Rsp 真源、`level` 索引、页签 gear 集合、`renderItemFn` 时序、超时常量）
30. `ChatTable` / `ChatTexts` / `ChatRepository`：局部变量与回调参数命名统一（`row` / `text` / `message` / `_placeholder` / `index`）
31. `ChatPage.present`：判空后取局部 `snapshot`，不再连读三次属性
32. `ChatEntryButton`：英文 tooltip 改中文；`ChatPrivateBubble.lastSelf` 补与 `ChatBubble` 一致的说明

## 7 风险与后续

- 功能逻辑按「表达式等价 + 分支等价」逐处核对，未新增或删除任何分支的可达结果；`tests/chat.test.ts` 未调整即以 58/58 通过。
- 未纳入本次范围（保持原状）：`ChatAtRow` / `ChatEmojiItem` / `ChatPrivateHead` / `ChatRecruitRow.Head` 的 `TOUCH_END` 绑定方式（需改 prefab + MCP 刷新）；`ChatBubble` / `ChatPrivateBubble` 的合并（需改继承关系与 prefab 序列化）。
- 工作树仅保留改动，未做任何提交；入库按 `docs/agent/版本库约定.md` 由人工确认。
