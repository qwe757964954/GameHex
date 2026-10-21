#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从配表元数据生成策划可读的字段说明 Markdown。

数据源与 `gen_bigmap_esheets.py`（写 xlsx）、`gen_bigmap_tables.py`（写运行时 json）**完全同一份**，
所以不会出现「表改了文档没改」。改完表跑一次本脚本即可：

    python tools/config/gen_bigmap_doc.py                 # 默认写 doc/塔防数据配置/DM-大地图配表说明.md
    python tools/config/gen_bigmap_doc.py <输出文件>

文档里刻意包含三块「策划最容易踩」的内容：
1. **填表须知** —— 哪些值会让客户端当场报错（对应 `BigMapConfig.parse*` 的 throw）；
2. **表间关系** —— 哪些字段是外键，改 id 要连带改哪张表；
3. **待确认口径** —— 代码里为它留了两种解释的地方（不写清楚，策划填了也是白填）。
"""

from __future__ import annotations

import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import gen_bigmap_esheets as sheets  # noqa: E402
import gen_bigmap_tables as tables  # noqa: E402

DEFAULT_OUT = Path(r'D:/City1001/doc/塔防数据配置/DM-大地图配表说明.md')

# 每张表一句话说明（顺序即成表顺序）
PURPOSE = {
    'bigmapWorld': '世界尺寸、基地/城池/野怪分布半径、NPC 数量。换 worldId 等于换一张图。',
    'bigmapSchedule': '一天里四个切换时点（开放 / 锁榜 / 结算 / 快照）与时区。',
    'bigmapBuilding': '基地里能造的 8 座建筑的解锁条件、占格、数量上限。',
    'bigmapBuildingLevel': '每座建筑每一级的消耗、耗时、前置条件，主城还额外管资源上限。',
    'bigmapBuildingProduce': '资源田/货币田每级的每小时产量与可累积上限。',
    'bigmapResource': '五种资源的名称、图标、新档初始量（五种必须齐）。',
    'bigmapQueue': '建造队列数量、解锁价格、取消返还比例、离线结算上限、建造区尺寸。',
    'bigmapCity': '每座城池的层级、解锁条件、战功/城防覆盖值、前置城池、占位。',
    'bigmapCityLevel': '1~5 级的战功倍率、占领积分、战力门槛、默认行动力与城防。',
    'bigmapRank': '攻城榜单 1~10 名的战功折扣（第 11 名起按积分规则递减）。',
    'bigmapScoreRule': '伤害转战功的边际递减上限、名次外延、拥挤系数、越界削减。',
    'bigmapMonster': '5 级野怪的血量、行动力消耗、战功、刷新时间与掉落。',
    'bigmapStamina': '行动力上限、恢复间隔、每日可买次数与价格。',
}

# 表间外键（写进文档，改 id 时要连带改）
RELATIONS = [
    ('bigmapBuildingLevel.`id`', 'bigmapBuilding.`id`', '建筑升级引用不存在的建筑 ⇒ 解析直接抛错'),
    ('bigmapBuildingProduce.`id`', 'bigmapBuilding.`id`', '同上'),
    ('bigmapCity.`cityLevel`', 'bigmapCityLevel.`cityLevel`', '等级没配 ⇒ 抛「城池等级 N 未配置」'),
    ('bigmapCity.`prevCityId`', 'bigmapCity.`cityId`', '前置城池不存在 ⇒ 抛错（0 = 无前置）'),
    ('bigmapResource.`resType`', '代码白名单 `BIGMAP_RES_ORDER`', 'grain/wood/iron/coin/stamina 缺一个 ⇒ 抛错'),
    ('bigmapBuildingProduce.`resType`', '同上', '写错枚举会被当场拒绝，而不是静默不出产'),
]

# 填表须知：每一条都对应代码里的一处 throw 或钳制
RULES = [
    ('建筑升级', '同一座建筑的等级必须**从 1 连续排到最高级**，中间不能缺；缺了「升到 L+1」会查不到配置。'),
    ('建筑升级', '`buildTime` 不能为负。'),
    ('建筑产出', '`produceCap`（累积上限）**不得小于** `producePerHour`（每小时产量）。'),
    ('建筑配置', '`baseBuildType = 1`（主城）**有且只能有一条**。'),
    ('城池配置', '`slot` 必须满足 `0 ≤ slot < slotCount`。'),
    ('城池配置', '`available = 1`（本期开放）的城池，`layer` 必须是 **1（个人层）** —— 联盟/战盟层本期不做。'),
    ('城池配置', '`staminaCost` / `defenseHp` / `cityLevelCoeff` 填 0 会**回退到城池等级表**的值，不是「免费」。'),
    ('城池等级', '每座城池引用的 `cityLevel` 必须在这张表里存在。'),
    ('名次系数', '`rank` 必须从 **1 开始连续**，`coeffPct` 必须为正数。'),
    ('积分规则', '`rankExtendMinPct`（名次系数下限）不得超过 100。'),
    ('队列配置', '`plotRows` / `plotCols` 必须是**奇数**（中心格要放主城）；`initBuildQueue` 不得大于 `maxBuildQueue`。'),
    ('攻城日程', '四个时间写 `HH:MM`，且必须满足 `openTime ≤ lockTime ≤ settleTime ≤ snapshotTime`；写 `9:0`、`25:00` 都会报错。'),
    ('世界地图配置', '`rows` / `cols` 不得小于 8；`cityRing1` 必须落在 `(2, 地图半径)` 之间；`baseRadiusMin` 不得大于 `baseRadiusMax`。'),
    ('资源定义', '五种资源**必须全部配齐**（grain / wood / iron / coin / stamina），少一种就起不来。'),
    ('所有表', '字段的「端」写 **0** 时，这一列**不会被导出**成 JSON —— 只有纯策划备注才写 0。'),
]

# 待策划确认（代码里留了两种解释的地方）
PENDING = [
    ('`radiateCapacity` 到底是什么意思',
     '客户端现在拿它当 **势力范围半径（格）** 用：基地到城池超过这个格数，攻城伤害 −20%。'
     '但需求文档另有一句「每城辐射 8~12 个**基地**」，那是**容量**。同一个字段两种语义，必须选一个。',
     '辐射制整块 + 心愿城池；选「容量」的话另需要新增「势力范围半径」字段。'),
    ('队列解锁：付费 vs 建筑',
     '`bigmapQueue` 里有 `queueUnlockCost2 / queueUnlockCost3`（120 / 360 货币），'
     '`bigmapBuilding` 里又有一座 71007「建造队列」。两套都能「加队列」，现在**代码只认建筑**，付费那两个字段是死的。',
     '要么删掉建筑走付费，要么删掉付费字段走建筑。'),
    ('战功公式里的名次/拥挤',
     '接上榜单后，攻城首城从 **4 刀变 6 刀**（战功 477 → 137：名次第 11 名 57% × 同场 10 人拥挤 0.51 叠乘）。'
     'NPC 基准战功按「最低占领战功」等比缩放，偏高。',
     '开局行动力 120 刚好打光。三选一：① 保持 ② 降 NPC 基准 ③ 开局 N 天不出 NPC 榜。'),
    ('野怪三层架构只做了第一层',
     '`bigmapMonster` 只有「单机逐级解锁」这一层；文档要的「个人实例层 / 多人同步 / 集结分怪」还没表。',
     'P0 只做个人实例层，P2 再补集结。'),
]


def table_of(info: dict) -> str:
    return info['title']


def dump(path: Path) -> None:
    tables.main()  # 填 tables.TABLES（同时写一遍 remoteRef，幂等）
    meta_all = sheets.META

    lines: list[str] = []
    add = lines.append

    add('# 大地图（BigMap）配表说明')
    add('')
    add('> 本文由 `python tools/config/gen_bigmap_doc.py` 自动生成，**不要手改**。')
    add('> 改字段请改 `tools/config/gen_bigmap_esheets.py` 的 `META`，改数值请改 `tools/config/gen_bigmap_tables.py`。')
    add(f'> 生成时间 {datetime.datetime.now():%Y-%m-%d %H:%M}，共 {len(tables.TABLES)} 张表。')
    add('')

    add('## 一、总览')
    add('')
    add('| 文件 | Sheet | 导出的 JSON | 数据行 | 作用 |')
    add('| --- | --- | --- | --- | --- |')
    for name, info in tables.TABLES.items():
        add(f"| `DM-{info['title']}.xlsx` | {info['title']} | `{name}.json` | {len(info['rows'])} | {PURPOSE.get(name, '')} |")
    add('')
    add('六行表头：**第 1 行表名 / 第 2 行字段端 / 第 3 行中文名 / 第 4 行说明 / 第 5 行英文名 / 第 6 行类型 / 第 7 行起数据**。'
        '改表时只动第 7 行往后的数据区，前六行是导表依据。')
    add('')

    add('## 二、表间关系（改 id 要连带改）')
    add('')
    add('| 字段 | 指向 | 不满足会怎样 |')
    add('| --- | --- | --- |')
    for source, target, why in RELATIONS:
        add(f'| {source} | {target} | {why} |')
    add('')

    add('## 三、各表字段')
    add('')
    for name, info in tables.TABLES.items():
        add(f"### `DM-{info['title']}.xlsx` · {name}.json · {len(info['rows'])} 行")
        add('')
        add(f"{PURPOSE.get(name, '')}")
        add('')
        add('| 英文名 | 中文名 | 类型 | 端 | 说明 |')
        add('| --- | --- | --- | --- | --- |')
        for field in meta_all[name]:
            side = {1: '服务端+客户端', 3: '仅客户端', 0: '⚠️ 不导出'}.get(field['side'], str(field['side']))
            add(f"| `{field['name']}` | {field['title']} | {field['kind']} | {side} | {field['desc']} |")
        add('')

    add('## 四、填表须知（不满足会当场报错）')
    add('')
    add('客户端在解析配置时做严格校验，**宁可起不来也不静默跑错**。以下每一条都对应一处检查：')
    add('')
    for index, (scope, rule) in enumerate(RULES, start=1):
        add(f'{index}. **{scope}**：{rule}')
    add('')

    add('## 五、待确认口径（这几处代码留了两种解释）')
    add('')
    for title, detail, impact in PENDING:
        add(f'### {title}')
        add('')
        add(detail)
        add('')
        add(f'**影响**：{impact}')
        add('')

    add('## 六、改完表之后怎么生效')
    add('')
    add('```')
    add('1. 改 DM-*.xlsx（只动第 7 行起的数据）')
    add('2. npm run config:export        # 跑 eSon 导表 + 压缩 + 更新 remoteRef')
    add('3. 客户端刷新按钮 / 重启预览')
    add('```')
    add('')
    add('只想快速自检某一张：把 xlsx 复制到临时目录，用 `java EsonCli <输入目录> <输出目录>` 单独导，'
        '产物在 `<输出目录>/client/<表名>.json`，与 `assets/remoteRef/<表名>.json` 解压后逐行对比即可。')
    add('')

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(lines), encoding='utf-8')
    print(f'已生成 {path}（{len(tables.TABLES)} 张表，{len(lines)} 行）')


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dump(Path(args[0]) if args else DEFAULT_OUT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
