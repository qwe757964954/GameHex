"""把《植物大地图系统》文档里的字段表导成**策划配表 Excel**（D-具体系统中文名.xlsx）。

格式（用户 2026-10-19 指定的六行表头，与文档内参考图一致）：

    第 1 行  表名（abcXxx.json）        —— 合并整行
    第 2 行  字段类型（1=服务器+客户端 3=客户端 0=备注/策划用）
    第 3 行  字段中文名
    第 4 行  字段说明
    第 5 行  字段英文名
    第 6 行  数据类型（int / float / string / json / long）
    第 7 行起 数据行（按传统游戏的数据线推测填写）

字段来源：`植物大地图系统.docx` 的配置表 / 存档表字段说明，按原文顺序逐条转写。
原文表 id（editor_sdk `doc_list_tables` 的 table_id，便于回查）：
  · 基地建造：jt6otl6k(baseBuilding) / 8ry515gn(Level) / n8wpdpzr(Produce) /
    jakhnrg4(全局配置) / p0ec77bl(科技) / m5btpyah(玩家存档)
  · 城池：knudw7p8(cityConfig) / a5188u34(cityRank) / 8k033jys(cityLevel) /
    u5lroogk(Buff+Feature) / m7cxr8lq(Schedule+Reward) / i8okrwuq(8 张存档表)
  · 野怪：lxo54t9l(monsterConfig) / lkurz918(3 张存档表)
  · 基地：iiimv6ks(3 张配置 + 3 张存档)

数据行来源：与 `gen_bigmap_tables.py`（运行时 `bigmap*` 配置表）**同一套数值**，
避免「文档配表」和「游戏内表」两套数字打架。

用法：
    python tools/config/gen_bigmap_xlsx.py [输出目录]
默认输出到 `D:/Alan/占城玩法/策划文档/大地图/配表/`。
"""

from __future__ import annotations

import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

sys.path.insert(0, str(Path(__file__).resolve().parent))

from gen_bigmap_tables import (  # noqa: E402  （复用同一套数值真源）
    BUILDINGS,
    CITY_CHAINS,
    CITY_LEVEL,
    CITY_NAMES,
    INNER_CITIES,
    MAX_LEVEL,
    MONSTER_COUNT,
    MONSTERS,
    PRODUCE_CURVE,
    building_levels,
    building_produce,
)


# ── 样式 ────────────────────────────────────────────────────────────────────
HEADER_FILL = {
    1: PatternFill('solid', fgColor='2F5597'),
    2: PatternFill('solid', fgColor='D9E2F3'),
    3: PatternFill('solid', fgColor='FFF2CC'),
    4: PatternFill('solid', fgColor='F2F2F2'),
    5: PatternFill('solid', fgColor='E2EFDA'),
    6: PatternFill('solid', fgColor='FCE4D6'),
}
HEADER_FONT = {
    1: Font(bold=True, color='FFFFFF', size=14),
    2: Font(bold=True, size=11),
    3: Font(bold=True, size=11),
    4: Font(size=10, color='404040'),
    5: Font(bold=True, size=11, color='1F4E79'),
    6: Font(size=11),
}
THIN = Side(style='thin', color='BFBFBF')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
COLUMN_WIDTH = (28, 18, 52, 10, 12)   # 英文名 / 中文名 / 说明 / 字段类型 / 数据类型
HEADER_ROW_COUNT = 6


def write_book(out_dir: Path, spec: dict) -> Path:
    """写一本 D-xxx.xlsx：六行表头 + 数据行。"""
    fields = spec['fields']
    data = spec.get('data') or []
    if not data:
        # 没有数据行也要留一行空行，方便策划直接往下填。
        data = [['' for _ in fields]]

    book = Workbook()
    sheet = book.active
    sheet.title = spec['title'][:31]   # sheet 名上限 31 字符（Excel 限制）

    for column, spec_row in enumerate(
        ([f[3] for f in fields], [f[1] for f in fields], [f[2] for f in fields],
         [f[0] for f in fields], [f[4] for f in fields]),
        start=2,
    ):
        for index, value in enumerate(spec_row, start=1):
            cell = sheet.cell(row=column, column=index, value=value)
            cell.fill = HEADER_FILL[column]
            cell.font = HEADER_FONT[column]
            cell.border = BORDER
            cell.alignment = Alignment(
                horizontal='center' if column in (2, 5) else 'left',
                vertical='center',
                wrap_text=column in (3, 4),
            )

    # 第 1 行：表名，合并整行。
    sheet.cell(row=1, column=1, value=spec['json'])
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(fields))
    top = sheet.cell(row=1, column=1)
    top.fill = HEADER_FILL[1]
    top.font = HEADER_FONT[1]
    top.alignment = Alignment(horizontal='center', vertical='center')
    sheet.row_dimensions[1].height = 26

    for row_index, row in enumerate(data, start=HEADER_ROW_COUNT + 1):
        for column, value in enumerate(row, start=1):
            cell = sheet.cell(row=row_index, column=column, value=value)
            cell.border = BORDER
            cell.alignment = Alignment(
                horizontal='center' if column in (2, 5) else 'left',
                vertical='center',
                wrap_text=column == 3,
            )

    for index, width in enumerate(COLUMN_WIDTH, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    for row in range(2, HEADER_ROW_COUNT + 1):
        sheet.row_dimensions[row].height = 20 if row != 4 else 30
    sheet.freeze_panes = sheet.cell(row=HEADER_ROW_COUNT + 1, column=1)

    out_path = out_dir / f"D-{spec['title']}.xlsx"
    book.save(out_path)
    return out_path


# ── 字段表（顺序与文档一致；F = 英文名, 中文名, 说明, 端, 类型）────────────────
def F(en: str, cn: str, desc: str, side: int = 1, dtype: str = 'int'):
    return (en, cn, desc, side, dtype)


SYSTEMS: list[dict] = []


def system(json_name: str, title: str, fields: list, data: list | None = None) -> None:
    SYSTEMS.append({'json': json_name, 'title': title, 'fields': fields, 'data': data or []})


# ── 一、基地建造 ────────────────────────────────────────────────────────────
system('baseBuilding.json', '建筑配置', [
    F('id', '建筑ID', '建筑 id（主建筑 71001、粮食田 71002、木材田 71003、铁矿田 71004）'),
    F('baseBuildName', '建筑名称', '建筑名称，如「主城」「粮食田」', 3, 'string'),
    F('baseBuildType', '建筑类型', '1=主基地 2=资源田 3=货币田 4=科技 5=队列 6=装饰'),
    F('baseBuildIcon', '建筑图标', '建筑图标资源地址', 3, 'string'),
    F('baseBuildInfo', '建筑说明', '建筑说明文案，显示在建造列表与详情面板', 3, 'string'),
    F('occupyHex', '占用格数', '占用六边形格子数'),
    F('maxOwnNum', '拥有上限', '每名玩家可拥有数量上限；-1 表示按地块限制'),
    F('unlockType', '解锁方式', '1=章节 2=任务 3=付费 4=赛季 5=小玩法'),
    F('unlockParam', '解锁参数', '解锁参数（章节 id / 任务 id / 商品 id）'),
    F('unlockChapter', '解锁章节', '解锁所需冒险章节（第 1 章解锁主城，第 2 章解锁资源田）'),
    F('isSeason', '是否赛季建筑', '0=否 1=是；赛季建筑只在本赛季可建'),
    F('queueType', '队列类型', '使用队列类型：1=建造队列 2=研发队列'),
    F('canMove', '是否可移动', '建造后是否允许移动：0=否 1=是', 3),
    F('sort', '排序权重', '建造列表排序权重（经济 / 战争 / 赛季分页）', 3),
    F('tag', '策划备注', '策划备注标签，仅填表用', 0, 'string'),
], [
    [b[0], b[1], b[2], f'ui/bigmap/building/{b[0]}', b[8], b[3], b[4], 1, b[5], b[5], 0, b[6], 1, b[7], '']
    for b in BUILDINGS
])

system('baseBuildingLevel.json', '建筑升级', [
    F('id', '建筑ID', '建筑 id（外键，关联 baseBuilding.id）'),
    F('buildLevel', '建筑等级', '建筑等级（0 级为初始状态）'),
    F('costGrain', '消耗粮食', '升级消耗的粮食'),
    F('costWood', '消耗木材', '升级消耗的木材'),
    F('costIron', '消耗铁矿', '升级消耗的铁矿'),
    F('instantLevelUpCost', '立即升级钻石', '立即完成升级消耗的钻石数量，随等级递增'),
    F('preBuildId', '前置建筑ID', '升级前置建筑 id（0=无前置）'),
    F('preBuildLevel', '前置建筑等级', '升级前置建筑需要达到的等级'),
    F('buildTime', '升级耗时', '升级耗时（秒）'),
    F('maxOtherLevel', '其他建筑等级上限', '该等级下其他建筑的等级上限（主基地专用）'),
    F('resCap', '资源存储上限', '该等级下资源栏存储上限（主基地专用）'),
    F('attrBonus', '升级属性加成', '升级属性加成（伤害加成 / 产量加成，结构化 json）', 1, 'json'),
], building_levels())

system('baseBuildingProduce.json', '建筑产出', [
    F('id', '建筑ID', '建筑 id（外键，关联 baseBuilding.id）'),
    F('buildLevel', '建筑等级', '建筑等级'),
    F('resType', '产出资源类型', 'resGrain / resWood / resIron / resCoin', 1, 'string'),
    F('baseProducePerHour', '每小时基础产量', '每小时基础产量'),
    F('produceCap', '累积上限', '该建筑自身可累积上限（气泡收获上限）'),
    F('techGroup', '受加成科技组', '受哪类科技加成（economy=经济 / war=战争 / season=赛季）', 1, 'string'),
], [[r[0], r[1], r[2], r[3], r[4], r[5]] for r in building_produce()])

system('baseBuildGlobal.json', '建造全局配置', [
    F('maxBuildQueue', '最大建造队列数', '建造队列硬上限'),
    F('initBuildQueue', '初始建造队列数', '新建角色默认拥有的建造队列数'),
    F('queueUnlockCost', '队列解锁价格', '按队列序号配置的钻石解锁价格（json 数组）', 1, 'json'),
    F('queueUnlockDays', '队列解锁有效期', '0 表示永久'),
    F('maxResearchQueue', '最大研发队列数', '科技研发队列上限'),
    F('cancelReturnRate', '取消返还比例', '取消建造时返还资源比例（0~1）', 1, 'float'),
    F('offlineBuild', '离线是否继续建造', '1=离线继续建造 0=暂停'),
], [
    [3, 1, '[0, 100, 300]', 0, 1, 1.0, 1],
])

system('techTree.json', '科技树', [
    F('techId', '科技ID', '科技 id'),
    F('techName', '科技名称', '科技名称', 3, 'string'),
    F('branch', '科技线', '1=经济 2=战争 3=赛季'),
    F('preTechId', '前置科技ID', '前置科技 id（0=无前置）'),
    F('icon', '科技图标', '科技图标资源地址', 3, 'string'),
], [
    [91001, '屯田术', 1, 0, 'ui/bigmap/tech/91001'],
    [91002, '伐木术', 1, 91001, 'ui/bigmap/tech/91002'],
    [91003, '冶铁术', 1, 91001, 'ui/bigmap/tech/91003'],
    [92001, '征召训练', 2, 0, 'ui/bigmap/tech/92001'],
    [92002, '城防加固', 2, 92001, 'ui/bigmap/tech/92002'],
    [93001, '赛季动员', 3, 0, 'ui/bigmap/tech/93001'],
])

system('techLevel.json', '科技等级', [
    F('techId', '科技ID', '科技 id（外键，关联 techTree.techId）'),
    F('techLevel', '科技等级', '科技等级'),
    F('costTechPoint', '消耗科技点', '升级消耗的科技点'),
    F('researchTime', '研发耗时', '研发耗时（秒）'),
    F('instantCost', '立即完成钻石', '立即完成研发消耗的钻石'),
    F('attrBonus', '属性加成', '生效属性加成（结构化 json）', 1, 'json'),
], [
    [91001, level, 50 * level, 600 * level * level, 10 * level, f'{{"grainRate":{0.05 * level:.2f}}}']
    for level in (1, 2, 3)
] + [
    [92001, level, 80 * level, 900 * level * level, 15 * level, f'{{"attackRate":{0.04 * level:.2f}}}']
    for level in (1, 2)
])

system('player_building.json', '玩家建造存档', [
    F('uid', '玩家ID', '玩家 id', 1, 'long'),
    F('buildInstId', '建筑实例ID', '建筑实例 id（同类建筑可建多个）', 1, 'long'),
    F('id', '建筑配置ID', '建筑配置 id（关联 baseBuilding.id）'),
    F('buildLevel', '当前等级', '当前等级'),
    F('hexPos', '六边形坐标', '建造区域六边形坐标（q,r）', 1, 'string'),
    F('state', '状态', '1=正常 2=升级中'),
    F('startTime', '升级开始时间', '升级开始时间戳（毫秒）', 1, 'long'),
    F('endTime', '升级完成时间', '升级完成时间戳（毫秒）', 1, 'long'),
    F('harvestTime', '上次收获时间', '上次收获时间戳，用于离线产出结算', 1, 'long'),
], [
    [100001, 5001, 71001, 3, '0,0', 1, 0, 0, 1792300000000],
    [100001, 5002, 71002, 2, '1,0', 1, 0, 0, 1792300000000],
    [100001, 5003, 71004, 1, '-1,1', 2, 1792299000000, 1792302600000, 1792300000000],
])

system('player_build_queue.json', '玩家建造队列', [
    F('uid', '玩家ID', '玩家 id', 1, 'long'),
    F('queueType', '队列类型', '1=建造 2=研发'),
    F('slot', '队列槽位', '队列槽位序号（0 起）'),
    F('buildInstId', '占用建筑实例', '当前占用队列的建筑实例 id（0=空闲）', 1, 'long'),
    F('unlockType', '槽位解锁方式', '1=默认 2=付费'),
    F('expireTime', '付费到期时间', '付费队列到期时间戳（永久为 0）', 1, 'long'),
], [
    [100001, 1, 0, 5003, 1, 0],
    [100001, 1, 1, 0, 1, 0],
    [100001, 1, 2, 0, 2, 0],
])

# ── 二、城池 ────────────────────────────────────────────────────────────────
CITY_FIELDS = [
    F('cityId', '城池ID', '城池 id（章节-关卡编号，如 307 表示 3-7）'),
    F('cityName', '城池名称', '城池名称，如「前哨营地」「净化站」', 3, 'string'),
    F('chapter', '所属章节', '所属冒险章节'),
    F('gateNo', '关卡序号', '章节内的关卡序号'),
    F('layer', '层级', '1=个人（外围） 2=联盟 3=战盟 4=王座'),
    F('occupySubject', '占领主体', '1=个人 2=联盟 3=战盟 4=战盟归属（王座）'),
    F('exclusive', '是否排他占领', '0=外围非排他（辐射） 1=联盟层起排他'),
    F('cityLevel', '城池等级', '城池等级 1~5'),
    F('hexPos', '中心坐标', '中心六边形坐标（q,r）', 1, 'string'),
    F('occupyHex', '占用格数', '占用单位格子数'),
    F('rangeHex', '势力范围格子', '势力范围六边形格子列表（透明色区）', 1, 'json'),
    F('adjacentCityIds', '相邻城池ID', '相邻城池 id 列表（3 级及以上校验用）', 1, 'json'),
    F('needAdjacent', '是否校验相邻', '0=否（1/2 级外围） 1=是（3 级起）'),
    F('openDay', '开放开服天数', '开放所需开服天数（未开放显示倒计时）'),
    F('openWeek', '开放周次', '开放周次（W1 开 1-2 级…W7 开 7-8 级）'),
    F('dailyDeclareLimit', '每日宣战上限', '每日宣战上限（联盟层）'),
    F('staminaCost', '单次行动力消耗', '单次攻打消耗的行动力'),
    F('powerThreshold', '上榜战力门槛', '上榜战力门槛（按城池等级分档，挑战前明示）', 1, 'long'),
    F('warScoreRate', '战功积分倍率', '战功积分倍率', 1, 'float'),
    F('damageDecayCurve', '伤害转积分曲线', '伤害转积分边际递减曲线（分段系数）', 1, 'json'),
    F('singleDamageCap', '单次积分上限', '单次战斗伤害 / 积分上限', 1, 'long'),
    F('cityLevelCoeff', '城池等级系数', '收益公式第三乘数', 1, 'float'),
    F('radiateCapacity', '可辐射基地数', '每城可辐射基地数上限（外围）'),
    F('radiateRate', '辐射收益比例', '非主城辐射收益比例', 1, 'float'),
    F('minPlayerCount', '最低参与人数', '结算最低参与人数（低于则不结算或打折）'),
    F('lowCountRatio', '人数不足折扣', '人数不足时产出折扣（实际人数 / 门槛，封顶 1）', 1, 'float'),
    F('produceCapRatio', '个人产出封顶', '个人据点产出占玩家总产出封顶比例', 1, 'float'),
    F('offlineRecycleDays', '离线回收天数', '离线多少天后回收辐射位 / 占位'),
    F('wishSwitchCd', '心愿切换冷却', '心愿城池切换冷却（秒）'),
    F('snapshotTime', '快照结算时刻', '个人层每日快照结算时刻，如 22:00', 1, 'string'),
    F('lockBeforeMinutes', '结算前锁榜分钟', '结算前多少分钟锁榜'),
    F('occupyScore', '占领积分', '占领后获得的城池积分'),
    F('minOccupyWarScore', '最低占领战功', '占领所需的最低本轮战功'),
    F('warScoreResetLine', '周战功重置线', '每周战功重置线'),
    F('defenseHp', '城防耐久', '城防 / 防线耐久'),
    F('buffGroupId', '增益组ID', '增益效果组 id（关联 cityBuff.json）'),
    F('featureGroupId', '特性组ID', '城池特性组 id（关联 cityFeature.json）'),
    F('firstRewardId', '首占奖励组ID', '首占奖励组 id（关联 cityRewardConfig）'),
    F('rankRewardId', '排名奖励组ID', '个人榜排名奖励组 id'),
    F('rallyOpen', '是否开放集结', '0=否（个人层） 1=是（联盟层起）'),
    F('icon', '城池图标', '城池图标 / 资源名', 3, 'string'),
    F('cityDesc', '城池说明', '城池说明（增益效果描述、特性描述）', 3, 'string'),
]


def city_rows() -> list[list]:
    rows = []
    prev_in_chain: dict[int, int] = {}
    for city_id, chain, step, level, slot, chapter, open_day in CITY_CHAINS:
        war, occupy, power, coeff, stamina, min_war, hp = CITY_LEVEL[level]
        name = CITY_NAMES[city_id - 101]
        rows.append([
            city_id, name, chapter, step + 1, 1, 1, 0, level, f'{city_id},{slot}', 4,
            '[]', '[]', 0, open_day, open_day // 7 + 1, 3, stamina, power, war,
            '{"segments":[1.0,0.8,0.65,0.55]}', hp, coeff, 12, 0.35, 5, 1.0, 0.25, 7,
            86400, '22:00', 60, occupy, min_war, min_war * 5, hp,
            level * 10 + 1, level * 10 + 2, level * 100 + 1, level * 100 + 2, 0,
            f'ui/bigmap/city/{city_id}',
            f'{name}：占领后资源产出 +{round((coeff - 1) * 100)}%，战功倍率 ×{war}',
        ])
        prev_in_chain[chain] = city_id
    for city_id, layer, name, level, ring_slots, slot in INNER_CITIES:
        war, occupy, power, coeff, stamina, min_war, hp = CITY_LEVEL[level]
        rows.append([
            city_id, name, 99, slot + 1, layer, layer, 1, level, f'{city_id},{slot}', 4,
            '[]', '[]', 1, 9999, 99, 3, stamina, power, war,
            '{"segments":[1.0,0.8,0.65,0.55]}', hp, coeff, ring_slots, 0.5, 5, 1.0, 0.25, 7,
            86400, '22:00', 60, occupy, min_war, min_war * 5, hp,
            level * 10 + 1, level * 10 + 2, level * 100 + 1, level * 100 + 2, 1,
            f'ui/bigmap/city/{city_id}',
            '联盟 / 战盟玩法本期不开放',
        ])
    # 相邻城池 id 列表：同链的下一座
    by_id = {row[0]: row for row in rows}
    chain_next: dict[int, int] = {}
    for city_id, chain, step, *_ in CITY_CHAINS:
        if city_id in chain_next:
            continue
        ids = [c for c, ch, *_ in CITY_CHAINS if ch == chain]
        for index, cid in enumerate(ids[:-1]):
            by_id[cid][11] = f'[{ids[index + 1]}]'
        chain_next[chain] = 1
    return rows


system('cityConfig.json', '城池配置', CITY_FIELDS, city_rows())

system('cityRankConfig.json', '名次拥挤系数', [
    F('cityLevel', '城池等级', '城池等级（可按等级差异化，也可全局统一）'),
    F('rankCoeffList', '名次系数表', '第 1~10 名名次系数（json 数组，百分比）', 1, 'json'),
    F('rankExtendStep', '名次递减步长', '第 11 名起每名递减值', 1, 'float'),
    F('rankExtendMin', '名次系数下限', '名次系数下限', 1, 'float'),
    F('rankFullCount', '完整梯度人数', '完整名次梯度人数（≤ 此人数不触发拥挤）'),
    F('crowdFormula', '拥挤系数公式', '拥挤系数公式文本（0.5 + 0.5/N）', 1, 'string'),
    F('crowdCurve', '人均收益衰减曲线', '人均收益随 N 衰减曲线（N:人均）', 1, 'json'),
    F('totalOutputCurve', '总产出增长曲线', '城池总产出随 N 次线性增长曲线', 1, 'json'),
    F('mainCityRate', '主城兑现比例', '主城兑现比例', 1, 'float'),
], [
    [level, '[100,90,85,80,75,71,68,65,62,60]', 0.03, 0.30, 10, '0.5+0.5/N',
     '{"1":1.0,"4":0.55,"8":0.35,"12":0.28}', '{"1":1.0,"4":2.2,"8":3.4,"12":4.2}', 1.0]
    for level in (1, 2, 3, 4, 5)
])

system('cityLevelConfig.json', '城池等级', [
    F('cityLevel', '城池等级', '城池等级 1~5'),
    F('warScoreRate', '战功积分倍率', '战功积分倍率', 1, 'float'),
    F('occupyScore', '占领积分', '占领积分'),
    F('powerThreshold', '上榜战力门槛', '该等级上榜战力门槛', 1, 'long'),
    F('cityLevelCoeff', '城池等级系数', '城池等级系数', 1, 'float'),
    F('staminaCost', '单次行动力消耗', '单次攻打行动力消耗'),
    F('minOccupyWarScore', '最低占领战功', '最低占领战功'),
    F('warScoreResetLine', '周战功重置线', '每周战功重置线'),
], [
    [level, data[0], data[1], data[2], data[3], data[4], data[5], data[5] * 5]
    for level, data in sorted(CITY_LEVEL.items())
])

system('cityBuff.json', '城池增益', [
    F('buffGroupId', '增益组ID', '增益组 id'),
    F('buffType', '增益类型', '1=经济产出 2=战斗属性 3=定时产出 4=防线耐久'),
    F('attrId', '属性ID', '属性 id（产量 / 伤害 / 耐久等）'),
    F('value', '增益数值', '增益数值（百分比或固定值）', 1, 'float'),
    F('shareType', '分配方式', '1=辐射+拥挤（个人层） 2=全员一致（联盟层） 3=联盟仓库按贡献'),
    F('produceInterval', '定时产出间隔', '定时产出间隔（秒），非定时为 0'),
], [
    [11, 1, 1001, 0.10, 1, 0],
    [11, 3, 1002, 50, 1, 3600],
    [21, 2, 2001, 0.05, 2, 0],
    [31, 4, 3001, 500, 2, 0],
])

system('cityFeature.json', '城池特性', [
    F('featureGroupId', '特性组ID', '特性组 id'),
    F('featureId', '特性ID', '特性 id（如浓雾、易守难攻）'),
    F('featureName', '特性名称', '特性名称', 3, 'string'),
    F('featureDesc', '特性描述', '特性描述，如「怪物受到的最终伤害 -40%」', 3, 'string'),
    F('effectParam', '生效参数', '局内生效参数（伤害修正、怪物修正等）', 1, 'json'),
], [
    [101, 1, '浓雾', '怪物受到的最终伤害 -40%', '{"monsterDamageTaken":-0.4}'],
    [101, 2, '易守难攻', '城防耐久 +50%', '{"defenseHpRate":0.5}'],
    [102, 3, '资源丰饶', '占领后资源产出 +20%', '{"produceRate":0.2}'],
])

system('cityScheduleConfig.json', '攻城日程', [
    F('scheduleId', '日程ID', '日程 id'),
    F('layer', '适用层级', '1=个人快照 2/3=联盟战盟'),
    F('stage', '阶段', '1=标记 2=攻城 3=结算 4=锁榜 5=快照'),
    F('weekDays', '生效星期', '生效星期（json 数组，1=周一）', 1, 'json'),
    F('startTime', '开始时间', '开始时间 HH:MM', 1, 'string'),
    F('endTime', '结束时间', '结束时间 HH:MM', 1, 'string'),
    F('peakSwitchDay', '巅峰切换日程', '巅峰之战开启后切换的日程（仅周六 19:00-21:00）'),
    F('markDailyLimit', '每日标记上限', '每日标记次数上限'),
    F('markBonusRate', '标记额外加成', '标记目标额外积分加成', 1, 'float'),
], [
    [1, 1, 2, '[5,6,7]', '09:00', '21:00', 0, 3, 0.1],
    [2, 1, 4, '[5,6,7]', '21:30', '21:59', 0, 0, 0.0],
    [3, 1, 5, '[5,6,7]', '22:00', '22:10', 0, 0, 0.0],
    [4, 2, 1, '[5]', '09:00', '20:00', 0, 3, 0.1],
    [5, 3, 2, '[6]', '19:00', '21:00', 0, 3, 0.1],
])

system('cityRewardConfig.json', '城池奖励', [
    F('rewardId', '奖励组ID', '奖励组 id'),
    F('rewardType', '奖励类型', '1=个人首占 2=联盟首占 3=个人排名 4=周奖励 5=月奖励 6=赛季奖励 7=参战保底'),
    F('condition', '发放条件', '发放条件（名次 / 参战次数 / 占领积分区间 / 里程碑）', 1, 'json'),
    F('rewardItems', '奖励道具组', '奖励道具组（道具 id、数量；仅一次性资源）', 1, 'json'),
    F('mailTemplateId', '邮件模板ID', '发放使用的邮件模板 id'),
], [
    [1, 1, '{"milestone":"first"}', '[{"id":1001,"count":500}]', 7001],
    [3, 3, '{"rank":"1-10"}', '[{"id":1001,"count":300}]', 7002],
    [7, 7, '{"attackTimes":3}', '[{"id":1002,"count":5}]', 7003],
])

CITY_SAVE_TABLES = [
    ('city_state.json', '城池状态存档', [
        F('cityId', '城池ID', '城池 id'),
        F('seasonId', '赛季ID', '所属赛季'),
        F('state', '当前状态', '状态枚举：1=未开放 2=开放未争 3=宣战 4=争夺中 5=已占领 6=被攻破'),
        F('ownerType', '归属类型', '1=个人 2=联盟 3=战盟（王座同为战盟归属）'),
        F('ownerId', '归属ID', '归属玩家 / 联盟 / 战盟 id', 1, 'long'),
        F('ownerName', '归属名称', '归属名称（冗余，便于战报）', 1, 'string'),
        F('firstOccupyUid', '首占者ID', '首占玩家 / 联盟 id（0=未被首占）', 1, 'long'),
        F('firstOccupyTime', '首占时间', '首占时间戳', 1, 'long'),
        F('stageStartTime', '阶段开始时间', '当前阶段开始时间戳', 1, 'long'),
    ], [[101, 1, 5, 1, 100001, '玩家名字七个字', 100001, 1792300000000, 1792300000000]]),
    ('city_legion_score.json', '城池联盟积分', [
        F('cityId', '城池ID', '城池 id'),
        F('legionId', '联盟ID', '联盟 id', 1, 'long'),
        F('attackScore', '当日攻城积分', '当日攻城积分（参与归属判定，按周重置）', 1, 'long'),
        F('warScore', '累计战功', '累计战功（不受重置 / 弃城影响）', 1, 'long'),
        F('attackTimes', '攻城次数', '本日攻城次数'),
    ], [[101, 900001, 12000, 86000, 6]]),
    ('city_player_score.json', '城池个人积分', [
        F('cityId', '城池ID', '城池 id'),
        F('uid', '玩家ID', '玩家 id', 1, 'long'),
        F('warScore', '战功积分', '个人战功积分（边际递减后）', 1, 'long'),
        F('rank', '实时名次', '当日实时名次'),
        F('wishLocked', '是否主城', '是否为玩家主城（心愿城池）：0/1，每人仅 1 座'),
        F('keepScore', '保留积分', '非主城城池保留积分（切换主城后待兑现）', 1, 'long'),
        F('attackTimes', '攻城次数', '攻城次数'),
        F('joinTime', '首次参战时间', '首次参战时间戳（首占奖励判断）', 1, 'long'),
    ], [[101, 100001, 24000, 3, 1, 0, 6, 1792300000000]]),
    ('city_rank_snapshot.json', '城池排名快照', [
        F('snapshotId', '快照ID', '快照 id（每日 22:00 生成）', 1, 'long'),
        F('cityId', '城池ID', '城池 id'),
        F('uid', '玩家ID', '玩家 id', 1, 'long'),
        F('frozenRank', '冻结名次', '冻结名次'),
        F('rankCoeff', '名次系数', '快照名次系数', 1, 'float'),
        F('crowdCoeff', '拥挤系数', '快照拥挤系数', 1, 'float'),
        F('levelCoeff', '等级系数', '快照城池等级系数', 1, 'float'),
        F('finalRate', '最终兑现比例', '最终兑现比例（三系数乘积，主城 100% / 辐射 30~50%）', 1, 'float'),
    ], [[20261019001, 101, 100001, 3, 0.85, 0.67, 1.1, 0.626]]),
    ('city_radiate.json', '城池辐射', [
        F('cityId', '城池ID', '城池 id'),
        F('uid', '玩家ID', '辐射范围内的玩家 id', 1, 'long'),
        F('isMainCity', '是否主城', '是否主城：0/1'),
        F('enterTime', '进入时间', '进入辐射范围时间戳', 1, 'long'),
    ], [[101, 100001, 1, 1792300000000]]),
    ('city_first_occupy.json', '城池首占记录', [
        F('id', '记录ID', '首占记录 id', 1, 'long'),
        F('cityId', '城池ID', '城池 id'),
        F('occupyType', '首占类型', '1=个人首占 2=联盟首占'),
        F('ownerId', '首占者ID', '首占玩家 / 联盟 id', 1, 'long'),
        F('milestone', '里程碑', '里程碑：首次上榜 / 首次前 10 / 首次某等级城'),
        F('rewardSent', '奖励已发放', '0=未发 1=已发'),
    ], [[1, 101, 1, 100001, 1, 1]]),
    ('city_mark.json', '城池标记', [
        F('cityId', '城池ID', '城池 id'),
        F('legionId', '联盟ID', '标记联盟 id', 1, 'long'),
        F('markUid', '操作人', '操作人（联盟长 / 副团长）', 1, 'long'),
        F('markTime', '标记时间', '标记时间戳', 1, 'long'),
    ], [[101, 900001, 100001, 1792300000000]]),
    ('city_log.json', '城池日志', [
        F('logId', '日志ID', '日志 id', 1, 'long'),
        F('logType', '日志类型', '1=标记 2=弃城 3=攻城 4=上限未占领 5=归属变更 6=主城切换'),
        F('cityId', '城池ID', '城池 id'),
        F('legionId', '联盟ID', '联盟 id', 1, 'long'),
        F('operatorUid', '操作人', '操作人 id', 1, 'long'),
        F('content', '日志内容', '日志内容（模板化）', 1, 'string'),
        F('logTime', '时间戳', '时间戳', 1, 'long'),
    ], [[1, 5, 101, 900001, 100001, '{player} 占领了 {city}', 1792300000000]]),
]
for _json, _title, _fields, _data in CITY_SAVE_TABLES:
    system(_json, _title, _fields, _data)

# ── 三、野怪 ────────────────────────────────────────────────────────────────
system('monsterConfig.json', '野怪配置', [
    F('monsterId', '野怪ID', '野怪 id'),
    F('monsterName', '野怪名称', '野怪名称，如「腐化食腐鸟」', 3, 'string'),
    F('monsterLevel', '野怪等级', '野怪等级（顺序解锁判断）'),
    F('occupyHex', '占用格数', '占用单位格子数'),
    F('preLevel', '前置等级', '需要先通关的野怪等级'),
    F('recommendPower', '推荐战力', '推荐战力', 3, 'long'),
    F('staminaCost', '行动力消耗', '单次攻打行动力消耗'),
    F('warScore', '战功', '击杀 / 伤害转化的战功'),
    F('rallyOpen', '是否开放集结', '0=否 1=是（高级野怪）'),
    F('syncType', '架构层', '1=全图统一 2=个人实例 3=多人同步（组队怪 / 周常 BOSS）'),
    F('openCron', '开放时间表达式', '多人同步怪开放时间表达式（如周二 / 周四 BOSS）', 1, 'string'),
    F('fogType', '迷雾类型', '0=无 1=迷雾（解锁条件）'),
    F('firstKillDropId', '首杀奖励组', '首杀奖励组 id'),
    F('normalDropId', '常规掉落组', '常规掉落组 id'),
    F('respawnSeconds', '刷新间隔', '被击杀后刷新间隔（秒）'),
    F('icon', '野怪资源名', '野怪图标资源名', 3, 'string'),
], [
    [
        mid, name, level, occupy, max(0, level - 1), 300 * level, stamina, war, 1 if level >= 4 else 0,
        2, '', 1 if level >= 3 else 0, level * 100 + 1, level * 100 + 2, respawn,
        f'ui/bigmap/monster/{mid}',
    ]
    for mid, (level, name, occupy, stamina, war, _hp, respawn) in zip(
        range(8001, 8001 + sum(MONSTER_COUNT.values())),
        [m for level, *rest in MONSTERS for m in [(level, *rest)] for _ in range(MONSTER_COUNT[level])],
    )
])

MONSTER_SAVE_TABLES = [
    ('monster_state.json', '野怪状态存档', [
        F('monsterInstId', '野怪实例ID', '野怪实例 id（地图实例）', 1, 'long'),
        F('monsterId', '野怪配置ID', '野怪配置 id'),
        F('hexPos', '当前坐标', '当前六边形坐标（q,r）', 1, 'string'),
        F('state', '状态', '0=存活 1=战斗中 2=已击杀待刷新'),
        F('nextRefreshTime', '下次刷新时间', '下次刷新时间戳', 1, 'long'),
    ], [[700001, 8001, '4,5', 0, 0]]),
    ('monster_first_kill.json', '野怪首杀', [
        F('monsterId', '野怪配置ID', '野怪配置 id'),
        F('uid', '首杀玩家ID', '全服首杀玩家 id', 1, 'long'),
        F('legionId', '所属联盟ID', '首杀玩家所属联盟（战报用）', 1, 'long'),
        F('killTime', '首杀时间', '首杀时间戳', 1, 'long'),
    ], [[8001, 100001, 900001, 1792300000000]]),
    ('player_monster_progress.json', '野怪进度', [
        F('uid', '玩家ID', '玩家 id', 1, 'long'),
        F('maxPassLevel', '已通关最高等级', '已通关最高野怪等级'),
        F('killCount', '击杀次数统计', '各级野怪击杀次数统计', 1, 'json'),
    ], [[100001, 3, '{"1":12,"2":5,"3":1}']]),
]
for _json, _title, _fields, _data in MONSTER_SAVE_TABLES:
    system(_json, _title, _fields, _data)

# ── 四、基地与迁城 ──────────────────────────────────────────────────────────
BASE_SAVE_TABLES = [
    ('baseSpawnConfig.json', '基地出生配置', [
        F('spawnCityLevelRange', '出生区域城池等级', '出生区域城池等级范围（json 数组）', 1, 'json'),
        F('spawnMinDistance', '基地最小间距', '基地间最小间距（六边形格数）'),
        F('spawnCapRatio', '初始占用容量比例', '出生区块初始占用容量上限比例', 1, 'float'),
        F('clusterEnabled', '关系链聚集开关', '关系链（推广 / 师徒 / 军团）聚集开关：0/1'),
        F('clusterRadius', '聚集相邻区块数', '关系聚集时允许的相邻区块数'),
        F('distributionAlgo', '分配算法', '0=纯随机 1=区块均衡+最小间距（推荐）'),
    ], [[1, 3, 0.6, 1, 2, 1]]),
    ('baseAttackConfig.json', '基地攻防配置', [
        F('scoutStaminaCost', '侦察行动力消耗', '侦察行动力消耗'),
        F('attackStaminaCost', '攻打行动力消耗', '攻打基地行动力消耗'),
        F('maxAttackerTeams', '同时被攻队伍上限', '同一基地同时被攻击队伍上限'),
        F('sameLegionProtect', '同军团保护', '同军团 / 同战盟保护：0/1'),
        F('maxDefenseByLevel', '防御值上限分档', '各主城等级防御值上限分档', 1, 'json'),
        F('defenseLossPerDefeat', '被攻破防御扣减', '每次被攻破扣减防御值（比例 / 固定）', 1, 'float'),
        F('defenseRecoverRate', '防御每小时恢复', '防御值每小时恢复比例', 1, 'float'),
        F('plunderRatio', '掠夺资源比例', '攻破时掠夺超额资源比例', 1, 'float'),
        F('plunderCap', '单次掠夺上限', '单次掠夺资源上限'),
        F('dailyAttackLimit', '每日攻击上限', '同一玩家对同一基地每日攻击次数上限'),
        F('attackInterval', '攻击最小间隔', '两次攻击最小间隔（秒）'),
        F('truceAfterDefeat', '被攻破免战时长', '被攻破后免战时长（秒）'),
        F('offlineProtectDays', '离线保护天数', '离线休眠保护天数'),
    ], [[10, 20, 3, 1, '{"1":1600,"6":11000}', 0.2, 0.05, 0.3, 5000, 5, 60, 3600, 7]]),
    ('relocateConfig.json', '迁城配置', [
        F('itemId', '随机迁城道具ID', '随机迁城券道具 id'),
        F('itemCount', '随机迁城消耗数量', '随机迁城券每次消耗数量'),
        F('targetItemId', '定点迁城道具ID', '定点迁城道具 id'),
        F('targetItemCount', '定点迁城消耗数量', '定点迁城道具消耗数量'),
        F('cdSeconds', '迁城冷却时间', '主动迁城冷却时间（秒）'),
        F('newbieProtectDays', '新手保护天数', '新手保护期（开服天数）'),
        F('newbieProtectLevel', '新手保护等级', '新手保护期（主城等级）'),
        F('shieldAfterMove', '迁城后保护罩时长', '主动迁城后保护罩时长（秒）'),
        F('shieldAfterBreak', '破城后保护罩时长', '破城被动迁移后保护罩时长（秒）'),
        F('newbieFreeMove', '新手免费迁城次数', '新手期免费定点迁城次数'),
    ], [[12001, 1, 12002, 2, 86400, 7, 5, 28800, 14400, 3]]),
    ('player_base_state.json', '玩家基地状态', [
        F('uid', '玩家ID', '玩家 id', 1, 'long'),
        F('hexPos', '基地坐标', '基地六边形坐标（q,r）', 1, 'string'),
        F('baseLevel', '主基地等级', '主基地等级（冗余自建造数据）'),
        F('defenseValue', '当前防御值', '当前防御值（耐久），为 0 触发被动迁移'),
        F('shieldEndTime', '保护罩到期时间', '保护罩到期时间戳（含新手 / 迁城 / 破城）', 1, 'long'),
        F('truceEndTime', '免战到期时间', '免战到期时间戳', 1, 'long'),
        F('lastDefeatedTime', '上次被攻破时间', '上次被攻破时间戳', 1, 'long'),
        F('lastRelocateTime', '上次迁城时间', '上次迁城时间戳', 1, 'long'),
        F('relocateType', '落点来源', '0=初始 1=随机 2=定点 3=破城'),
        F('inCityId', '所在城池ID', '当前所在势力范围城池 id（0=不在任何范围）', 1, 'long'),
    ], [[100001, '10,12', 3, 4200, 0, 0, 0, 1792300000000, 0, 101]]),
    ('base_attack_log.json', '基地攻防日志', [
        F('attackId', '攻防记录ID', '攻防记录 id', 1, 'long'),
        F('attackerUid', '进攻方ID', '进攻方玩家 id', 1, 'long'),
        F('defenderUid', '防守方ID', '防守方玩家 id', 1, 'long'),
        F('result', '胜负', '1=进攻方胜 0=防守方胜'),
        F('troopLoss', '部队损失', '进攻方部队损失'),
        F('plunder', '掠夺资源量', '掠夺资源总量'),
        F('defenseBefore', '攻前防御值', '攻打前防御值'),
        F('defenseAfter', '攻后防御值', '攻打后防御值'),
        F('time', '时间戳', '战斗时间戳', 1, 'long'),
    ], [[1, 100001, 100002, 1, 320, 1500, 4200, 3360, 1792300000000]]),
    ('base_relocate_log.json', '基地迁移日志', [
        F('uid', '玩家ID', '迁移玩家 id', 1, 'long'),
        F('relocateType', '迁移类型', '0=初始 1=随机 2=定点 3=破城'),
        F('fromPos', '迁移前坐标', '迁移前六边形坐标（q,r）', 1, 'string'),
        F('toPos', '迁移后坐标', '迁移后六边形坐标（q,r）', 1, 'string'),
        F('reason', '迁移原因', '迁移原因（主动 / 破城 / 新手）', 1, 'string'),
        F('time', '时间戳', '迁移时间戳', 1, 'long'),
    ], [[100001, 1, '10,12', '18,7', '主动随机迁城', 1792300000000]]),
]
for _json, _title, _fields, _data in BASE_SAVE_TABLES:
    system(_json, _title, _fields, _data)


# ── 五、大地图世界 / 城池（100×100 初稿口径，2026-10-20）────────────────────────
# 这三张表是**运行时表**（`assets/remoteRef/bigmap*.json`）的策划配表版：
# 列顺序与运行时表的 `k` 完全一致，多出来的 `cityCount / rangeMin / rangeMax` 是
# 用户 2026-10-20 那张「城池等级-数量-势力范围」表带来的新字段（原来散在布局里）。
#
# 城池 id 从 2001 起、按「等级从高到低」分配，与 `tools/map-editor/gen_bigmap_draft.ts`
# 生成的 `presets/bigmap/dadi_tuchugao.json` **逐座对齐**（改一边就要改另一边）。
#
# 🔴 文件名叫「大地图XX」而不是「城池配置 / 城池等级」：文档派生的 `cityConfig.json` /
# `cityLevelConfig.json` 已经占了「D-城池配置」「D-城池等级」两个名字（那是策划设计表，
# 42 列 / 8 列，和这里 17 列 / 11 列的运行时表不是一回事）。

WORLD_ROWS = [
    {
        'worldId': 1,
        'worldName': '植物大地图',
        'rows': 100,
        'cols': 100,
        # 种子生成（没有布局文件时的兜底）用的环带：个人层外环 / 内层环 / 基地半径带。
        'cityRing1': 26,
        'cityRing2': 12,
        'baseRadiusMin': 16,
        'baseRadiusMax': 30,
        'npcBaseCount': 40,
        'monsterRingMax': 20,
    },
]

CITY_LEVEL_ROWS = [
    # level, 数量, 范围 min, max, 战功倍率, 占领积分, 战力门槛, 等级系数, 行动力, 最低占领战功, 城防
    (1, 22, 25, 35, 1.5, 300, 800, 1.1, 20, 800, 1600),
    (2, 15, 25, 35, 2.0, 600, 1500, 1.2, 30, 1600, 2600),
    (3, 13, 20, 30, 3.0, 1200, 2600, 1.3, 45, 3200, 4200),
    (4, 9, 20, 30, 5.0, 2400, 4200, 1.4, 60, 6400, 7000),
    (5, 8, 20, 30, 8.0, 4800, 6000, 1.5, 80, 12000, 11000),
    # 6~8 级为 2026-10-20 新补（原来只有 1~5 级）：按 5 级的斜率外推。
    (6, 7, 20, 30, 12.0, 7200, 9000, 1.6, 100, 24000, 16000),
    (7, 6, 17, 23, 18.0, 10800, 14000, 1.7, 120, 48000, 24000),
    (8, 1, 17, 23, 25.0, 20000, 20000, 2.0, 150, 70000, 40000),
]

CITY_NAME_POOL = {
    8: '王座',
    7: '战盟王城',
    6: '战盟要塞',
    5: '联盟壁垒',
    4: '联盟哨站',
    3: '军团营地',
    2: '荒野驿站',
    1: '前哨营地',
}
CN_NUMERALS = '一二三四五六七八九十'


def cn_number(value: int) -> str:
    """1..99 的中文数字（配表里给城名加序号用）。"""
    if value <= 10:
        return CN_NUMERALS[value - 1]
    if value < 20:
        return '十' + CN_NUMERALS[value - 11]
    tens, ones = divmod(value, 10)
    return CN_NUMERALS[tens - 1] + '十' + (CN_NUMERALS[ones - 1] if ones else '')


def city_rows() -> list[list]:
    """81 座城：等级从高到低、id 2001 起，与地图初稿逐座对齐。"""
    rows: list[list] = []
    next_id = 2001
    for level, count, _min, _max, war, _occupy, _power, coeff, stamina, _min_war, hp in sorted(
        CITY_LEVEL_ROWS, reverse=True
    ):
        layer = 4 if level >= 8 else 3 if level >= 5 else 2 if level >= 3 else 1
        for index in range(count):
            name = CITY_NAME_POOL[level] if count == 1 else f'{CITY_NAME_POOL[level]}·{cn_number(index + 1)}'
            rows.append([
                next_id, name, layer,
                # 本期只开放个人层（`BigMapConfig` 里有硬约束：available=1 时 layer 必须是 1）
                1 if layer == 1 else 0,
                level,
                0 if level <= 2 else 1,
                1 + level,                       # unlockChapter
                (level - 1) * 3,                 # openDay
                stamina, hp,
                12 if level <= 2 else 10 if level <= 4 else 8,
                coeff,
                0,                               # prevCityId：不做链式依赖，相邻关系由地图布局给
                level * 240,                     # rewardCoin
                f'{name}：占领后资源产出 +{round((coeff - 1) * 100)}%，战功倍率 ×{war}',
                index, count,
            ])
            next_id += 1
    return rows


system('bigmapWorld.json', '大地图世界', [
    F('worldId', '世界ID', '大世界 id，对应 `config/bigmap-maps/world_<两位>.json`'),
    F('worldName', '世界名称', '世界名称（编辑器标题显示这个）', 3, 'string'),
    F('rows', '行数', '地图行数（六边格）'),
    F('cols', '列数', '地图列数（六边格）'),
    F('cityRing1', '个人层城池环', '种子生成时个人层城池落的环号（有布局文件时不用）'),
    F('cityRing2', '内层城池环', '种子生成时军团/战盟层的环号'),
    F('baseRadiusMin', '基地半径下限', '种子生成时基地落点的最小环号'),
    F('baseRadiusMax', '基地半径上限', '种子生成时基地落点的最大环号'),
    F('npcBaseCount', 'NPC基地数量', '种子生成时撒的 NPC 基地个数'),
    F('monsterRingMax', '野怪最大环', '种子生成时野怪不超出这个环号'),
], [[
    WORLD_ROWS[0]['worldId'], WORLD_ROWS[0]['worldName'], WORLD_ROWS[0]['rows'], WORLD_ROWS[0]['cols'],
    WORLD_ROWS[0]['cityRing1'], WORLD_ROWS[0]['cityRing2'], WORLD_ROWS[0]['baseRadiusMin'],
    WORLD_ROWS[0]['baseRadiusMax'], WORLD_ROWS[0]['npcBaseCount'], WORLD_ROWS[0]['monsterRingMax'],
]])

system('bigmapCityLevel.json', '大地图城池等级', [
    F('cityLevel', '城池等级', '城池等级 1~8，越大越靠地图中心'),
    F('cityCount', '该等级城池数', '本等级要摆多少座城（100×100 初稿：22/15/13/9/8/7/6/1）'),
    F('rangeMin', '势力范围格数下限', '势力范围最少占多少格（布局生成时按 [下限,上限] 随机）'),
    F('rangeMax', '势力范围格数上限', '势力范围最多占多少格'),
    F('warScoreRate', '战功积分倍率', '战功积分倍率', 1, 'float'),
    F('occupyScore', '占领积分', '占领后获得的城池积分'),
    F('powerThreshold', '上榜战力门槛', '上榜战力门槛（挑战前明示）', 1, 'long'),
    F('cityLevelCoeff', '城池等级系数', '收益公式第三乘数', 1, 'float'),
    F('staminaCost', '单次行动力消耗', '单次攻打消耗的行动力'),
    F('minOccupyWarScore', '最低占领战功', '占领所需的最低本轮战功'),
    F('defenseHp', '城防耐久', '城防 / 防线耐久'),
], [list(row) for row in CITY_LEVEL_ROWS])

system('bigmapCity.json', '大地图城池', [
    F('cityId', '城池ID', '城池 id（2001 起，等级从高到低依次编号）'),
    F('cityName', '城池名称', '城池名称，如「王座」「前哨营地·三」', 3, 'string'),
    F('layer', '层级', '1=个人（外围） 2=联盟 3=战盟 4=王座'),
    F('available', '本期是否开放', '1=开放 0=仅占位；⚠️ 硬约束：available=1 时 layer 必须是 1'),
    F('cityLevel', '城池等级', '关联 bigmapCityLevel.cityLevel'),
    F('exclusive', '是否排他占领', '0=外围非排他（辐射） 1=联盟层起排他'),
    F('unlockChapter', '解锁章节', '冒险章节进度解锁'),
    F('openDay', '开放开服天数', '开服第几天开放'),
    F('staminaCost', '单次行动力消耗', '单次攻打消耗的行动力'),
    F('defenseHp', '城防耐久', '城防 / 防线耐久'),
    F('radiateCapacity', '可辐射基地数', '每城可辐射的基地数上限'),
    F('cityLevelCoeff', '城池等级系数', '冗余自 bigmapCityLevel，便于战报直接读', 1, 'float'),
    F('prevCityId', '前置城池ID', '链式解锁的前置城（0=无前置）'),
    F('rewardCoin', '占领奖励金币', '首占发放的金币'),
    F('cityDesc', '城池说明', '城池说明（增益效果描述）', 3, 'string'),
    F('slot', '环上槽位', '种子生成时的槽位序号（同等级内 0 起）'),
    F('slotCount', '环上槽位总数', '该等级城池总数（槽位等分弧长用）'),
], city_rows())


def main() -> None:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r'D:/Alan/占城玩法/策划文档/大地图/配表')
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for spec in SYSTEMS:
        missing = [f[0] for f in spec['fields'] if len(f) != 5]
        if missing:
            raise ValueError(f"{spec['json']} 字段元组不完整：{missing}")
        for row in spec.get('data') or []:
            if len(row) != len(spec['fields']):
                raise ValueError(
                    f"{spec['json']} 数据行有 {len(row)} 个值，但字段有 {len(spec['fields'])} 个：{row}")
        written.append(write_book(out_dir, spec))
    print(f'已写出 {len(written)} 本配表到 {out_dir}')
    for path in written:
        print('  ', path.name)


if __name__ == '__main__':
    main()
