# -*- coding: utf-8 -*-
"""PVP 关卡：NPC 队伍补紫品级 + gradeProModifier 按章节难度重排。

几个改动（同一份表、同一次事务）：
 1. `npcTeam` 2001/3001/4003/4004/4013/4014/5003/5004/5013/5014 共 10 支队伍
    （覆盖 12 个「NPC 卡池缺紫 ⇒ 随机兵营-高级 100% 出金」的关卡）把
    「仙人侍卫 68021（蓝/盆栽/战士）」换成「南瓜战神 68023（紫/盆栽/坦克）」。
    ⚠️ 队伍上限 8 张（`ZCClientCombatConfig.ZC_MAX_BATTLE_HERO_CARDS`），第 9 张在正式
    对局会被 `buildBattleDeck` 截掉 ⇒ 只能等位替换，不能追加。
 2. `npcTeam` 2002：「镭射飞龙 68010」换成「仙桃行者 68009」（同为金品级，概率口径不变）。
 3. `npcTeam` 2015（第 2 章 10011 / 10013 的有效队伍）卡池缺**蓝**：
    「饥饿战士 68028（绿/僵尸/战士）」换成「金发统领 68029（蓝/僵尸/坦克）」。
    这两关的高级兵营本来就没问题（10004 的蓝权重是 0），缺蓝只把「中等兵营」的蓝 40%
    错挤给绿（B0 / G94.6）；同时补上队伍里唯一缺席的职业「坦克」（隔壁 2016 / 2017 都有 1 个）。
 4. `levelInfo.gradeProModifier` 按章节难度重排：只动匹配关（levelMod=1）第 1~7 章；
    第 0 章（大地图野怪/据点）与塔防关（levelMod=2）保持现值不动。

为什么用 zip 级手术：`PVP-关卡.xlsx` 有大列表格与公式，openpyxl 另存会把缓存值洗掉，
转表器读不到 ⇒ 整表导空。只替换目标 `<c>`，其余字节原样保留。

产物三写：源表 + `json/client` + `assets/remoteRef`（后两者序列化口径已逐字节验证）。

幂等：内容没变就跳过写盘，重跑 md5 不变。
用法：python tools/config/patch_npc_team_and_grade.py [--dry]
"""
import html
import io
import json
import os
import re
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import cell_xml  # noqa: E402

ROOT = 'D:/Alan/Project/POW'
XLSX = os.path.join(ROOT, 'doc', '塔防数据配置', 'PVP-关卡.xlsx')
SHEET_LEVEL = 'xl/worksheets/sheet1.xml'   # 关卡信息表
SHEET_TEAM = 'xl/worksheets/sheet2.xml'    # NPC队伍配置
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client')
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef')
BACKUP_DIR = os.path.join(ROOT, 'doc', '塔防数据配置_历史备份')
#  每轮新备份目录：v2 = 补紫卡之前，v3 = 2015 补蓝卡之前。别复用旧目录，会把上一轮的现场覆盖掉。
BACKUP_TAG = 'npc-purple-grade-v3'

#  覆盖缺紫关卡（11 关）的 10 支队伍（卡组内容逐字相同）。
PURPLE_REPLACE_TEAMS = (2001, 3001, 4003, 4004, 4013, 4014, 5003, 5004, 5013, 5014)
#  蓝 → 紫：同阵营（盆栽）、同为前排（战/坦），蓝桶仍剩 3 张不会空。
BLUE_TO_PURPLE = (68021, 68023)
#  2002 单独换卡：金 → 金，不改任何一个品级桶。
TEAM_2002_SWAP = (2002, 68010, 68009)
#  2015 缺蓝：绿 → 蓝，同在「僵尸」阵营、同为前排（战 → 坦），队伍职业补齐。
TEAM_2015_BLUE_SWAP = (2015, 68028, 68029)

#  章节锚点（stage=1 的系数），章内按 stage 线性插值到下一章起点。
#
#  ⚠️ 紫/金必须**同系数**（第 3 个值 boost 同时给 purple 与 gold）：乘同一个数，
#  各地块的「紫:金」比例才不会变 —— 高级兵营永远 90/10、中等永远 80/20、问号永远 75/25。
#  第一版把 purple 和 gold 写成两个不同系数，结果 10004 变成 94.7/5.3，比改动前更偏，
#  等于「补了紫卡却又把金卡压下去」，所以这里只保留一个 boost。
#
#  难度曲线靠 green/blue 的相对下降实现：第 1 章绿蓝各 ×4（紫金 ×1）⇒ 紫金被稀释；
#  第 7 章绿蓝 ×1、紫金 ×1.5 ⇒ NPC 抽卡回到表值并略偏紫金。
ANCHORS = {
    1: (4.00, 4.00, 1.00),
    2: (3.50, 3.50, 1.00),
    3: (3.00, 3.00, 1.10),
    4: (2.50, 2.50, 1.20),
    5: (2.00, 2.00, 1.30),
    6: (1.50, 1.50, 1.40),
    7: (1.00, 1.00, 1.50),
    8: (0.90, 0.90, 1.60),   # 第 7 章末尾的延伸值，只为插值用，不落表
}


def tidy(value):
    """整数不带小数点，其余保留两位 —— 与既有 `{"green":3,"blue":3}` 的写法一致。"""
    value = round(value + 1e-12, 2)
    return int(value) if abs(value - round(value)) < 1e-9 else value


def curve(chapter, stage):
    """章内线性插值：stage 1 → 本章锚点，stage 9 → 下一章锚点。紫金同系数。"""
    start = ANCHORS[chapter]
    end = ANCHORS[chapter + 1]
    t = (max(1, min(9, stage)) - 1) / 8.0
    green, blue, boost = (tidy(x + (y - x) * t) for x, y in zip(start, end))
    return json.dumps({'blue': blue, 'gold': boost, 'green': green, 'purple': boost},
                      separators=(',', ':'))


# ---------------------------------------------------------------- xlsx 读写

CELL_RE = re.compile(r'<c\b[^>]*?(?:/>|>.*?</c>)', re.S)

#  `PVP-关卡.xlsx` 的文本单元格全是共享字符串，`<v>` 里是 sst 下标而不是文本。
#  读现值必须先经 sst 还原，否则拿 "45" 去比 `{}` 会永远「不相等」，重跑也不幂等。
SST = []


def load_shared_strings(z):
    try:
        xml = z.read('xl/sharedStrings.xml').decode('utf-8')
    except KeyError:
        return []
    return [html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', body, re.S)))
            for body in re.findall(r'<si>(.*?)</si>', xml, re.S)]



def write_book(path, members, backup):
    """一次事务里替换多个 sheet，其余 zip 条目逐字节原样搬运。"""
    if backup:
        os.makedirs(backup, exist_ok=True)
        shutil.copy2(path, os.path.join(backup, os.path.basename(path)))
    tmp = path + '.tmp'
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename in members:
                data = members[info.filename].encode('utf-8')
            dst.writestr(info, data)
    os.replace(tmp, path)



def row_cells(xml):
    """row 号 → {列字母: 单元格 xml 原文}。只为定位/替换，不重建整行。"""
    out = {}
    for row in re.finditer(r'<row\b([^>]*)>(.*?)</row>', xml, re.S):
        num = re.search(r'\br="(\d+)"', row.group(1))
        if not num:
            continue
        cells = {}
        for cell in CELL_RE.finditer(row.group(2)):
            ref = re.search(r'\br="([A-Z]+)\d+"', cell.group(0))
            if ref:
                cells[ref.group(1)] = cell.group(0)
        out[int(num.group(1))] = cells
    return out


def cell_value(cell):
    if cell is None:
        return ''
    shared = re.search(r'\bt="s"', cell)
    if shared:
        index = re.search(r'<v>(\d+)</v>', cell, re.S)
        return SST[int(index.group(1))] if index and int(index.group(1)) < len(SST) else ''
    texts = re.findall(r'<t[^>]*>(.*?)</t>', cell, re.S)
    texts += re.findall(r'<v>(.*?)</v>', cell, re.S)
    return html.unescape(texts[0]) if texts else ''


def replace_cell(xml, ref, value):
    pattern = re.compile(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, re.S)
    match = pattern.search(xml)
    if not match:
        raise SystemExit('[fail] 单元格 %s 不存在，先确认表结构没变' % ref)
    style = re.search(r's="(\d+)"', match.group(0))
    return xml[:match.start()] + cell_xml(ref, style.group(1) if style else None, value) + xml[match.end():]


def patch_sheet_team(xml, dry):
    """NPC队伍配置：D 列（npcCard）换卡。"""
    changed = []
    for row_no, cells in sorted(row_cells(xml).items()):
        if row_no < 7:      # 1 表名 / 2 列宽 / 3 中文表头 / 4 说明 / 5 字段名 / 6 类型
            continue
        team = cell_value(cells.get('A')).strip()
        if not team.isdigit():
            continue
        team_id = int(team)
        if team_id in PURPLE_REPLACE_TEAMS:
            old, new = BLUE_TO_PURPLE
        elif team_id == TEAM_2002_SWAP[0]:
            old, new = TEAM_2002_SWAP[1], TEAM_2002_SWAP[2]
        elif team_id == TEAM_2015_BLUE_SWAP[0]:
            old, new = TEAM_2015_BLUE_SWAP[1], TEAM_2015_BLUE_SWAP[2]
        else:
            continue
        text = cell_value(cells.get('D'))
        if '"cardID": %d' % old not in text:
            print('[skip] 队伍 %d 的 D 列没有 cardID %d' % (team_id, old))
            continue
        updated = text.replace('"cardID": %d' % old, '"cardID": %d' % new)
        changed.append((team_id, old, new))
        if not dry:
            xml = replace_cell(xml, 'D%d' % row_no, updated)
    return xml, changed


def patch_sheet_level(xml, dry):
    """关卡信息表：J 列（gradeProModifier）按章节难度重排。"""
    changed = []
    for row_no, cells in sorted(row_cells(xml).items()):
        if row_no < 7:
            continue
        level = cell_value(cells.get('A')).strip()
        if not level.isdigit():
            continue
        mode = cell_value(cells.get('C')).strip()
        chapter = cell_value(cells.get('H')).strip()
        stage = cell_value(cells.get('I')).strip()
        if mode != '1' or not chapter.isdigit() or not stage.isdigit():
            continue
        chapter = int(chapter)
        if chapter not in ANCHORS or chapter == 0:
            continue
        expected = curve(chapter, int(stage))
        current = cell_value(cells.get('J')).strip()
        if current == expected:
            continue
        changed.append((int(level), chapter, int(stage), current, expected))
        if not dry:
            xml = replace_cell(xml, 'J%d' % row_no, expected)
    return xml, changed


# ---------------------------------------------------------------- json 同步

def load(path):
    return json.load(io.open(path, encoding='utf-8'))


def dump_client(rows):
    """client 侧：一行一个对象、紧凑分隔符、LF、无末尾换行。"""
    return '[' + ',\n'.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in rows) + ']'


def dump_remote(data):
    """remoteRef 侧：indent=0、冒号不带空格、CRLF。"""
    return json.dumps(data, ensure_ascii=False, indent=0, separators=(',', ':')).replace('\n', '\r\n')


def write_text(path, text, backup):
    raw = io.open(path, 'rb').read()
    if raw.decode('utf-8') == text:
        return False
    if backup:
        os.makedirs(backup, exist_ok=True)
        shutil.copy2(path, os.path.join(backup, os.path.basename(path)))
    with io.open(path, 'w', encoding='utf-8', newline='') as handle:
        handle.write(text)
    return True


def sync_npc_team(dry, backup):
    client_path = os.path.join(CLIENT, 'npcTeam.json')
    remote_path = os.path.join(REMOTE, 'npcTeam.json')
    client = load(client_path)
    remote = load(remote_path)
    keys = remote['k']
    card_col = keys.index('npcCard')

    swaps = {}
    for team_id in PURPLE_REPLACE_TEAMS:
        swaps[team_id] = BLUE_TO_PURPLE
    swaps[TEAM_2002_SWAP[0]] = (TEAM_2002_SWAP[1], TEAM_2002_SWAP[2])
    swaps[TEAM_2015_BLUE_SWAP[0]] = (TEAM_2015_BLUE_SWAP[1], TEAM_2015_BLUE_SWAP[2])

    touched = []
    for row in client:
        swap = swaps.get(row.get('npcTeamId'))
        if not swap:
            continue
        old, new = swap
        for entry in row.get('npcCard') or []:
            if entry.get('cardID') == old:
                entry['cardID'] = new
                touched.append(row['npcTeamId'])
    for row in remote['v']:
        record = dict(zip(keys, row))
        swap = swaps.get(record.get('npcTeamId'))
        if not swap:
            continue
        old, new = swap
        for entry in row[card_col]:
            if entry.get('cardID') == old:
                entry['cardID'] = new

    if not dry:
        write_text(client_path, dump_client(client), backup)
        write_text(remote_path, dump_remote(remote), backup)
    return touched


def sync_level(dry, backup):
    client_path = os.path.join(CLIENT, 'levelInfo.json')
    remote_path = os.path.join(REMOTE, 'levelInfo.json')
    client = load(client_path)
    remote = load(remote_path)
    keys = remote['k']
    gpm_col = keys.index('gradeProModifier')

    touched = []
    for row in client:
        if row.get('levelMod') != 1:
            continue
        chapter = row.get('levelChapter')
        if chapter not in ANCHORS or chapter == 0:
            continue
        expected = curve(chapter, row.get('chapterStage') or 0)
        if json.dumps(row.get('gradeProModifier') or {}, separators=(',', ':')) == expected:
            continue
        row['gradeProModifier'] = json.loads(expected)
        touched.append(row['levelId'])
    for row in remote['v']:
        record = dict(zip(keys, row))
        if record.get('levelMod') != 1:
            continue
        chapter = record.get('levelChapter')
        if chapter not in ANCHORS or chapter == 0:
            continue
        row[gpm_col] = json.loads(curve(chapter, record.get('chapterStage') or 0))

    if not dry:
        write_text(client_path, dump_client(client), backup)
        write_text(remote_path, dump_remote(remote), backup)
    return touched


def main():
    dry = '--dry' in sys.argv
    backup = None if dry else os.path.join(BACKUP_DIR, BACKUP_TAG)

    with zipfile.ZipFile(XLSX) as z:
        SST[:] = load_shared_strings(z)
        team_xml = z.read(SHEET_TEAM).decode('utf-8')
        level_xml = z.read(SHEET_LEVEL).decode('utf-8')

    team_xml, team_changed = patch_sheet_team(team_xml, dry)
    level_xml, level_changed = patch_sheet_level(level_xml, dry)

    print('[队伍] %d 支：' % len(team_changed))
    for team_id, old, new in team_changed:
        print('   %d  %d → %d' % (team_id, old, new))
    print('[关卡] %d 关改 gradeProModifier：' % len(level_changed))
    for level, chapter, stage, old, new in level_changed[:8]:
        print('   %d (章%d-%d)  %s → %s' % (level, chapter, stage, old, new))
    if len(level_changed) > 8:
        print('   … 其余 %d 关' % (len(level_changed) - 8))

    if dry:
        print('[dry] 不写盘')
        return

    members = {}
    if team_changed:
        members[SHEET_TEAM] = team_xml
    if level_changed:
        members[SHEET_LEVEL] = level_xml
    if members:
        write_book(XLSX, members, backup)

    print('[json] 队伍改动 %d 条，关卡改动 %d 条' % (
        len(sync_npc_team(False, backup)), len(sync_level(False, backup))))


if __name__ == '__main__':
    main()
