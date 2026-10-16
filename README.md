# 占城大师（Cocos Creator 3.8）

这是从 `D:\City1001\client` 的 Cocos Creator 2.4.11 工程迁出的 3.8.8 独立项目。旧工程的“占城大师”只有登录成功后的占位入口；本工程已经补成无需服务器即可运行的核心玩法版本，同时保留此前迁好的基础框架。

## 当前可玩内容

- 12 座相邻连通的城池，玩家、赤焰军和中立势力三方版图
- 选择己方城池后进攻相邻目标，按兵力和城池等级结算
- 粮草消耗、城池建设、守军增长、民心变化
- 回合制敌方 AI，会扩张、攻打玩家或积蓄兵力
- 胜利/失败判定
- 自动保存和损坏存档回退
- 全部使用 Cocos Creator 3.8 原生 UI，不依赖旧 FGUI

## 运行

1. 使用 Cocos Creator **3.8.8** 打开 `D:\City1001\Demo3.8`。
2. 等待首次资源导入完成。
3. 打开 `assets/Test.scene`。
4. 点击预览运行。

`Test.scene` 原有的 `UIDemo` 组件 UUID 被保留为兼容启动器，它会先加载 3.8 原生登录页；线上登录成功或点击“离线试玩”后进入 `assets/script/app/zcds/ZCGame.ts`。无需在编辑器里重新挂脚本。

编辑器预览时，浏览器会受到旧后台 CORS 策略限制。另开一个终端运行下面的本地代理即可读取真实配置和服务器列表：

```powershell
npm run proxy
```

代理只监听 `127.0.0.1:8099`，并只允许源工程使用的 CDN、COS 与登录中心地址。

## 操作

1. 点击青色己方城池。
2. 点击与它有道路连接的灰色或红色城池发起进攻；每次出征消耗 8 粮草。
3. “建设”提升当前城池等级和守军；升级消耗为 `当前等级 × 30` 粮草。
4. “结束回合”征收粮草、补充各城守军并触发敌方行动。
5. 占领全部 12 座城池获得胜利。

## 代码结构

```text
assets/script/app/zcds/
├── ZCGame.ts        # 对局入口，加载配置并连接模型与视图
├── model/           # 战斗规则、地图、地块生成与运行时配置
├── view/            # 棋盘、单位、特效与 HUD 渲染
└── ui/              # 引导、对局结算及 HUD 子组件

assets/script/app/login/
├── LoginPage.ts      # 3.8 原生账号登录、选服与离线入口
├── LoginProtocol.ts  # 源工程 HTTP 登录协议与选服规则
└── ProtocolCodec.ts  # protobuf 请求包编码、响应包解码

assets/resources/subproto/  # 从 client 同步的完整业务协议与缓存描述

assets/script/main/UIDemo.ts  # Test.scene 的兼容启动入口
tests/zcds-model.test.ts      # 核心玩法单元测试
```

## 验证

安装一次开发依赖后运行：

```powershell
npm install
npm test
npm run check:zcds
npm run check:login
npm run check:mcp
```

说明：旧 framework 中仍保留少量尚未被本玩法引用的迁移桩和 FGUI 类型声明；“占城大师”启动链本身不依赖这些遗留模块。
