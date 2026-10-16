# ZCDS 本地 3 / 4 人玩法

当前多人模式是本地自由混战：第 1 席由本机玩家操作，第 2~4 席分别由独立 AI 操作。每个席位拥有自己的主城、金币、领地、抽卡进度、建筑和单位；任意不同席位互为敌方。

默认进入对局时会在可用的 2 / 3 / 4 人固定主城地图中随机。要在浏览器预览里固定人数，可在开发者控制台执行：

```js
localStorage.setItem('zcds.playerCount', '3'); // 固定三人
location.reload();
```

四人玩法把值改为 `4`。恢复全人数随机：

```js
localStorage.removeItem('zcds.playerCount');
location.reload();
```

原生或自动化环境可在对局资源加载前设置：

```js
globalThis.__ZCDS_PLAYER_COUNT__ = 4;
```

该覆盖只影响本地选图，不会伪造服务器玩家。当前线上匹配协议仍是双方数据结构；服务端真 3 / 4 人匹配需要另行扩展房间成员列表、每席操作同步与结算协议。
