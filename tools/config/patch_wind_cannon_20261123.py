# -*- coding: utf-8 -*-
"""第 44 批：风炮菇 68013「孢爆箭」101303 改名「风炮弹」+ 风弹前段移速 ×2.5（70 → 175）。

用户口径（2026-11-23）：
> 「凤炮菇的 孢爆箭 技能名字 改为风炮弹，前段的移动速度*2.5，同步相关的配置源表和设计案」

「前段的移动速度」= 风弹飞行段的速度，即 `skillParamJson.windSpeed`（表值逻辑 px/s，
`ZCAttackResolutionSystem.castWindBolt` 里 `speedWorld = windSpeed × combatDistanceScale`）。
不是 `windZoneSeconds` / `windCooldown`，也不是单位移速 `pvpCard.unitMoveSpeed`。

改动面（技能名的三处真源 + 参数袋一处）：
  · `pvpSkillPlan`：`skillName`（技能配置真源）、`skillParamJson` 的 `windSpeed`；
  · `armySkillLevelUp`：`name`（卡牌技能面板 UI 真读这一列，`desc` 里不含技能名，不动）；
  · `pvpCard`：68013 的 `description` 引用了技能名。
每处都要落 **三写**：xlsx 源表 + `json/client` 行对象 + `assets/remoteRef` 列存。

源表落点：
  · `J-技能表.xlsx / PVP技能配置`（sheet9.xml）E 列技能名称、AC 列技能参数JSON；
  · `K-卡牌升级.xlsx / 卡牌技能升级表`（sheet2.xml）B 列技能名称；
  · `PVP-卡牌.xlsx / 卡牌配置`（sheet1.xml）I 列说明。

为什么 JSON 走文本级替换而不是 `json.load` + `dump`：两份产物的序列化格式不同
（client 是单行紧凑 LF、remoteRef 是 `{k,v,c}` 列存 CRLF），重新序列化会整份重排，
diff 变成几万行。这里只替换目标子串，并**断言替换次数**——次数不对就整体放弃。

为什么 xlsx 走 zip 级 set_cell：这几张页签有大量公式单元格，openpyxl 保存只写公式不写缓存值，
转表器读缓存值 ⇒ 整表导成空（同 `patch_splash_shot_k.py` / `patch_wind_barrage_k.py`）。

幂等：内容已是目标值则跳过写盘。
用法：python tools/config/patch_wind_cannon_20261123.py
"""
import html
import io
import os
import re
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import cell_xml, read_zip_rows  # noqa: E402

ROOT = 'D:/Alan/Project/POW'
XLSX_DIR = os.path.join(ROOT, 'doc', '塔防数据配置')
CLIENT = os.path.join(XLSX_DIR, 'json', 'client')
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef')
BACKUP_DIR = os.path.join(XLSX_DIR + '_历史备份')

#  设计案真源**不在** `doc/塔防数据配置/` 下（那是转表输入），在策划文档目录里，
#  是策划 / 研发共用的口径文档。文件不在就跳过，不阻断转表侧的三写。
DESIGN = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
DESIGN_MEMBER = 'xl/worksheets/sheet1.xml'      # 「技能设计案 (2)」页（主表）
DESIGN_CARD_MEMBER = 'xl/worksheets/sheet9.xml'  # 「卡牌描述与落地」页（卡面描述 + 技能1..4）

OLD_NAME = '孢爆箭'
NEW_NAME = '风炮弹'
OLD_SPEED = 70          # 设计案原值：表值逻辑 px/s（× combatDistanceScale 0.3 ⇒ 世界 21 px/s）
NEW_SPEED = 175         # ×2.5
CHAIN = 101303
UNIT = '68013'
MODIFIERS = (94013031, 94013032, 94013033)


# ────────────────────────────────────────────── JSON：文本级替换

def replace_or_skip(text, old, new, expect, label):
    """把 `old` 换成 `new`，并要求命中 `expect` 次。已是目标值 ⇒ 原样返回。"""
    hits = text.count(old)
    if hits == 0:
        if text.count(new) >= expect:
            print('[skip] %s 已是目标值' % label)
            return text, 0
        raise SystemExit('[fail] %s 找不到 %r（也没有目标值 %r）' % (label, old, new))
    if hits != expect:
        raise SystemExit('[fail] %s 命中 %d 处（预期 %d）⇒ 停下来人工确认' % (label, hits, expect))
    print('[ok] %s：%d 处 %r → %r' % (label, hits, old, new))
    return text.replace(old, new), hits


def patch_text_file(path, pairs):
    """pairs = [(old, new, expect, label), ...]，按顺序替换后写回。全无命中则不写盘。"""
    with io.open(path, encoding='utf-8', newline='') as handle:
        text = handle.read()
    changed = 0
    for old, new, expect, label in pairs:
        text, hits = replace_or_skip(text, old, new, expect, label)
        changed += hits
    if changed:
        with io.open(path, 'w', encoding='utf-8', newline='') as handle:
            handle.write(text)
    return changed


def patch_json_files():
    """两份产物的序列化形态不同，匹配串也不同：
      · `json/client` 是**行对象**（LF、单行紧凑）⇒ 名字带键：`"name":"孢爆箭"`；
      · `assets/remoteRef` 是**列存**（CRLF、每个元素独占一行）⇒ 名字是独立字符串 `"孢爆箭"`。
    后者用裸串替换，靠 `expect` 计数兜底：数对不上就整体放弃，不会误伤 desc。
    """
    total = 0
    naming = (
        (CLIENT, ((('"name":"%s"' % OLD_NAME), ('"name":"%s"' % NEW_NAME), 3,
                   'client/armySkillLevelUp.json 技能名'),
                  (('"skillName":"%s"' % OLD_NAME), ('"skillName":"%s"' % NEW_NAME), 3,
                   'client/pvpSkillPlan.json 技能名'))),
        (REMOTE, ((('"%s"' % OLD_NAME), ('"%s"' % NEW_NAME), 3,
                   'remoteRef/armySkillLevelUp.json 技能名'),
                  (('"%s"' % OLD_NAME), ('"%s"' % NEW_NAME), 3,
                   'remoteRef/pvpSkillPlan.json 技能名'))),
    )
    for folder, (level_pair, plan_pair) in naming:
        total += patch_text_file(os.path.join(folder, 'armySkillLevelUp.json'), [level_pair])
        total += patch_text_file(os.path.join(folder, 'pvpSkillPlan.json'), [
            plan_pair,
            #  参数袋是字符串，引号在 JSON 里是转义过的：`\"windSpeed\":70`
            ('"windSpeed\\":%d' % OLD_SPEED, '"windSpeed\\":%d' % NEW_SPEED, 3,
             '%s/pvpSkillPlan.json windSpeed' % os.path.basename(folder)),
        ])
    #  pvpCard：68013 的说明文字里引用了技能名（两份形态一样，整表只有这 1 处）
    for folder in (CLIENT, REMOTE):
        total += patch_text_file(os.path.join(folder, 'pvpCard.json'), [
            (OLD_NAME, NEW_NAME, 1, '%s/pvpCard.json 说明' % os.path.basename(folder)),
        ])
    return total


# ────────────────────────────────────────────── xlsx：zip 级 set_cell

SST_CACHE = {}


def shared_strings(path):
    if path in SST_CACHE:
        return SST_CACHE[path]
    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read('xl/sharedStrings.xml').decode('utf-8')
    except KeyError:
        SST_CACHE[path] = []
        return []
    out = [html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', body, re.S)))
           for body in re.findall(r'<si>(.*?)</si>', xml, re.S)]
    SST_CACHE[path] = out
    return out


def cell_text(path, xml, ref):
    """🔴 必须解共享字符串：这几张页签大量单元格是 `t="s"`，`<v>` 里存的是下标，
    直接读会把「孢爆箭」读成「123」⇒ 判等永远不成立、改写静默落空。"""
    match = re.search(r'<c r="%s"([^>]*?)(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not match:
        return None
    attrs, body = match.group(1), match.group(2) or ''
    kind = re.search(r'\bt="([^"]+)"', attrs)
    kind = kind.group(1) if kind else ''
    if kind == 's':
        value = re.search(r'<v>(.*?)</v>', body, re.S)
        table = shared_strings(path)
        index = int(value.group(1)) if value else -1
        return table[index] if 0 <= index < len(table) else ''
    if kind == 'inlineStr':
        body = re.search(r'<is>(.*?)</is>', body, re.S)
        return html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', body.group(1), re.S))) if body else ''
    texts = re.findall(r'<v>(.*?)</v>', body, re.S)
    return html.unescape(texts[0]) if texts else ''


def write_cell(xml, ref, value):
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, xml, re.S)
    if not match:
        raise SystemExit('[fail] 单元格 %s 不存在' % ref)
    style = re.search(r's="(\d+)"', match.group(0))
    return xml[:match.start()] + cell_xml(ref, style.group(1) if style else None, value) + xml[match.end():]


def row_of(path, xml, column, key, extra=None):
    """在 `column` 列里找值等于 `key` 的行号；`extra` = (列, 值) 追加约束。"""
    found = []
    for match in re.finditer(r'<c r="%s(\d+)"' % column, xml):
        row = int(match.group(1))
        if cell_text(path, xml, '%s%d' % (column, row)) != str(key):
            continue
        if extra and cell_text(path, xml, '%s%d' % (extra[0], row)) != str(extra[1]):
            continue
        found.append(row)
    return found


def commit(path, member, xml, backup_name):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, backup_name)
    commit_raw(path, member, xml, backup)


def commit_raw(path, member, xml, backup):
    """备份 + zip 级换掉一个成员。备份放哪由调用方定（设计案要留在它自己目录）。"""
    if backup and not os.path.exists(backup):
        shutil.copy2(path, backup)
    tmp = path + '.tmp'
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == member:
                data = xml.encode('utf-8')
            dst.writestr(info, data)
    os.replace(tmp, path)          # Windows 上先关句柄再替换，否则 WinError 5


def patch_xlsx():
    #  1. J-技能表 / PVP技能配置：E 列技能名、AC 列参数 JSON
    j_path = os.path.join(XLSX_DIR, 'J-技能表.xlsx')
    j_member = 'xl/worksheets/sheet9.xml'
    xml = read_zip_rows(j_path, j_member)
    changed = 0
    for tier, modifier in enumerate(MODIFIERS):
        rows = row_of(j_path, xml, 'B', modifier)
        if len(rows) != 1:
            raise SystemExit('[fail] J 表里修改器 %d 命中 %d 行（预期 1）' % (modifier, len(rows)))
        row = rows[0]
        name_ref, param_ref = 'E%d' % row, 'AC%d' % row
        if cell_text(j_path, xml, 'D%d' % row) != str(CHAIN):
            raise SystemExit('[fail] J 表 %d 行的成长技能ID 不是 %d' % (row, CHAIN))
        name_now = cell_text(j_path, xml, name_ref)
        if name_now not in (OLD_NAME, NEW_NAME):
            raise SystemExit('[fail] J 表 %s 既不是 %r 也不是 %r，实为 %r'
                             % (name_ref, OLD_NAME, NEW_NAME, name_now))
        params = cell_text(j_path, xml, param_ref)
        old_frag, new_frag = '"windSpeed":%d' % OLD_SPEED, '"windSpeed":%d' % NEW_SPEED
        need_name = name_now == OLD_NAME
        need_param = old_frag in params
        if not need_name and not need_param:
            continue
        if not need_param and new_frag not in params:
            raise SystemExit('[fail] J 表 %s 的参数袋里既没有 %s 也没有 %s：%s'
                             % (param_ref, old_frag, new_frag, params))
        if need_name:
            xml = write_cell(xml, name_ref, NEW_NAME)
            changed += 1
        if need_param:
            xml = write_cell(xml, param_ref, params.replace(old_frag, new_frag))
            changed += 1
    if changed:
        commit(j_path, j_member, xml, 'J-技能表.xlsx.bak-windcannon-20261123')
        print('[ok] J 表改 %d 格' % changed)
    else:
        print('[skip] J 表已是目标值')

    #  2. K-卡牌升级 / 卡牌技能升级表：B 列技能名
    k_path = os.path.join(XLSX_DIR, 'K-卡牌升级.xlsx')
    k_member = 'xl/worksheets/sheet2.xml'
    xml = read_zip_rows(k_path, k_member)
    changed = 0
    for tier in range(3):
        rows = row_of(k_path, xml, 'A', CHAIN, extra=('E', tier + 1))
        if len(rows) != 1:
            raise SystemExit('[fail] K 表 101303 第 %d 档命中 %d 行' % (tier + 1, len(rows)))
        ref = 'B%d' % rows[0]
        name_now = cell_text(k_path, xml, ref)
        if name_now == NEW_NAME:
            continue
        if name_now != OLD_NAME:
            raise SystemExit('[fail] K 表 %s 既不是 %r 也不是 %r，实为 %r'
                             % (ref, OLD_NAME, NEW_NAME, name_now))
        xml = write_cell(xml, ref, NEW_NAME)
        changed += 1
    if changed:
        commit(k_path, k_member, xml, 'K-卡牌升级.xlsx.bak-windcannon-20261123')
        print('[ok] K 表改 %d 格' % changed)
    else:
        print('[skip] K 表已是目标值')

    #  3. PVP-卡牌 / 卡牌配置：I 列说明
    c_path = os.path.join(XLSX_DIR, 'PVP-卡牌.xlsx')
    c_member = 'xl/worksheets/sheet1.xml'
    xml = read_zip_rows(c_path, c_member)
    rows = row_of(c_path, xml, 'A', UNIT)
    if len(rows) != 1:
        raise SystemExit('[fail] PVP-卡牌 里 %s 命中 %d 行' % (UNIT, len(rows)))
    ref = 'I%d' % rows[0]
    desc = cell_text(c_path, xml, ref)
    if OLD_NAME not in desc:
        print('[skip] PVP-卡牌 %s 说明里没有 %r' % (ref, OLD_NAME))
    else:
        if desc.count(OLD_NAME) != 1:
            raise SystemExit('[fail] PVP-卡牌 %s 里 %r 出现 %d 次' % (ref, OLD_NAME, desc.count(OLD_NAME)))
        commit(c_path, c_member, write_cell(xml, ref, desc.replace(OLD_NAME, NEW_NAME)),
               'PVP-卡牌.xlsx.bak-windcannon-20261123')
        print('[ok] PVP-卡牌 %s 说明改名' % ref)

# ────────────────────────────────────────────── 回读

def verify():
    import json

    bad = []

    def check(condition, message):
        if not condition:
            bad.append(message)

    #  JSON 四份
    client_plan = {int(row['modifierId']): row for row in
                   json.load(io.open(os.path.join(CLIENT, 'pvpSkillPlan.json'), encoding='utf-8'))
                   if int(row['skillChainId']) == CHAIN}
    packed = json.load(io.open(os.path.join(REMOTE, 'pvpSkillPlan.json'), encoding='utf-8'))
    remote_plan = {int(dict(zip(packed['k'], row))['modifierId']): dict(zip(packed['k'], row))
                   for row in packed['v'] if int(dict(zip(packed['k'], row))['skillChainId']) == CHAIN}
    check(len(client_plan) == 3 and len(remote_plan) == 3, 'pvpSkillPlan 三档不全')
    for modifier in MODIFIERS:
        for label, row in (('client', client_plan.get(modifier)), ('remoteRef', remote_plan.get(modifier))):
            if row is None:
                bad.append('pvpSkillPlan %s 缺 %d' % (label, modifier))
                continue
            check(row['skillName'] == NEW_NAME, 'pvpSkillPlan %s %d 名字 = %r' % (label, modifier, row['skillName']))
            params = json.loads(row['skillParamJson'])
            check(params['windSpeed'] == NEW_SPEED,
                  'pvpSkillPlan %s %d windSpeed = %r' % (label, modifier, params.get('windSpeed')))
            check(sorted(params) == sorted(['windCooldown', 'windDamageRate', 'windSpeed',
                                           'windLifeSeconds', 'windZoneRadius',
                                           'windZoneSeconds', 'windZoneDamageRate']),
                  'pvpSkillPlan %s %d 参数键变了：%s' % (label, modifier, sorted(params)))

    for folder in (CLIENT, REMOTE):
        level = json.load(io.open(os.path.join(folder, 'armySkillLevelUp.json'), encoding='utf-8'))
        if os.path.basename(folder) == 'remoteRef':
            level = [dict(zip(level['k'], row)) for row in level['v']]
        rows = [row for row in level if int(row['id']) == CHAIN]
        check(len(rows) == 3, '%s armySkillLevelUp 三档不全' % folder)
        for row in rows:
            check(row['name'] == NEW_NAME, '%s armySkillLevelUp L%s 名字 = %r'
                  % (folder, row['skilllevel'], row['name']))

        card = json.load(io.open(os.path.join(folder, 'pvpCard.json'), encoding='utf-8'))
        if os.path.basename(folder) == 'remoteRef':
            card = card if isinstance(card, list) else [dict(zip(card['k'], row)) for row in card['v']]
        hit = [row for row in card if str(row['id']) == UNIT]
        check(len(hit) == 1, '%s pvpCard 缺 %s' % (folder, UNIT))
        if hit:
            check(OLD_NAME not in str(hit[0]['description']), '%s pvpCard 说明还留着旧名' % folder)
            check(NEW_NAME in str(hit[0]['description']), '%s pvpCard 说明没改名' % folder)

    #  xlsx 三份（用 read_sheet 解过的文本，不信正则抓的 xml）
    from xlsx_read import read_sheet
    _, j_rows = read_sheet(os.path.join(XLSX_DIR, 'J-技能表.xlsx'), 8)
    j_hit = {}
    for _row_no, row in j_rows:                  # read_sheet 返回 (行号, 单元格列表)
        if not row or len(row) <= 28:
            continue
        cells = [str(cell) for cell in row]      # 数值格可能是 int / float
        if cells[0].strip() != '1' or not cells[1].isdigit():
            continue
        if int(cells[1]) in MODIFIERS:
            j_hit[int(cells[1])] = cells
    check(len(j_hit) == 3, 'J 表三档不全')
    for modifier in MODIFIERS:
        row = j_hit.get(modifier)
        if not row:
            bad.append('J 表缺 %d' % modifier)
            continue
        check(row[4] == NEW_NAME, 'J 表 %d 技能名称 = %r' % (modifier, row[4]))
        check('"windSpeed":%d' % NEW_SPEED in row[28], 'J 表 %d 参数 = %r' % (modifier, row[28]))

    _, k_rows = read_sheet(os.path.join(XLSX_DIR, 'K-卡牌升级.xlsx'), 1)
    for tier in range(3):
        hit = [v for _row_no, v in k_rows if v and len(v) > 4
               and str(v[0]) == str(CHAIN) and str(v[4]) == str(tier + 1)]
        check(len(hit) == 1, 'K 表 101303 第 %d 档不全' % (tier + 1))
        if hit:
            check(str(hit[0][1]) == NEW_NAME, 'K 表 L%d 技能名 = %r' % (tier + 1, hit[0][1]))

    _, c_rows = read_sheet(os.path.join(XLSX_DIR, 'PVP-卡牌.xlsx'), 0)
    hit = [v for _row_no, v in c_rows if v and str(v[0]) == UNIT]
    check(len(hit) == 1, 'PVP-卡牌 缺 %s' % UNIT)
    if hit:
        check(OLD_NAME not in str(hit[0][8]), 'PVP-卡牌说明还留着旧名')
        check(NEW_NAME in str(hit[0][8]), 'PVP-卡牌说明没改名')

    #  设计案（真源在 D:/Alan/占城玩法/策划文档/战斗系统，不在塔防数据配置目录下）
    if not os.path.exists(DESIGN):
        print('[warn] 设计案不在，跳过它的校验')
        if bad:
            raise SystemExit('[fail] 回读不一致：\n  ' + '\n  '.join(bad))
        print('[ok] 回读通过：4 份 JSON × 3 表 + 3 份 xlsx（设计案缺席）')
        return
    _, d_rows = read_sheet(DESIGN, 0)
    hit = [v for _row_no, v in d_rows if v and len(v) > 15 and str(v[6]) == str(CHAIN)]
    check(len(hit) == 1, '设计案缺 101303 行')
    if hit:
        row = [str(cell) for cell in hit[0]]
        check(row[7] == NEW_NAME, '设计案 H 列技能名 = %r' % row[7])
        for column, tier in (('K', 0), ('L', 1), ('M', 2)):
            check(('弹速 %d' % NEW_SPEED) in row[10 + tier],
                  '设计案 %s 列弹速不是 %d：%r' % (column, NEW_SPEED, row[10 + tier][:40]))
        check(('弹速 %d' % OLD_SPEED) not in ''.join(row[10:13]), '设计案三档还留着旧弹速')
        check('%dpx的移动速度' % NEW_SPEED in row[13], '设计案 N 列移动速度 = %r' % row[13][:40])
        check('"windSpeed":%d' % NEW_SPEED in row[15], '设计案 P 列参数袋示例还是旧值')
        check('velocity = %d×0.3' % NEW_SPEED in row[15], '设计案 P 列 velocity 说明还是旧值')
        check('%dpx 的移动速度' % OLD_SPEED not in row[15], '设计案 P 列关于旧口径的说明没改')

    _, card_rows = read_sheet(DESIGN, 8)
    hit = [v for _row_no, v in card_rows if v and str(v[0]) == UNIT]
    check(len(hit) == 1, '设计案卡牌描述页缺 %s' % UNIT)
    if hit:
        cells = [str(cell) for cell in hit[0]]
        check(OLD_NAME not in cells[5], '设计案卡牌描述还留着旧名')
        check(NEW_NAME in cells[5], '设计案卡牌描述没改名')
        check(cells[15] == NEW_NAME, '设计案技能4 名称 = %r' % cells[15])

    if bad:
        raise SystemExit('[fail] 回读不一致：\n  ' + '\n  '.join(bad))
    print('[ok] 回读通过：4 份 JSON × 3 表 + 3 份 xlsx + 设计案')


def patch_design():
    """设计案 `技能设计案2.xlsx` 第 65 行（68013 / 101303）八处文字。

    这份文件的真源在 `D:/Alan/占城玩法/策划文档/战斗系统/`（不在 `doc/塔防数据配置/` 下），
    是策划与研发共用的口径文档，不是转表输入 —— 改它只为让文档与落地一致。
    K/L/M 三档描述里的「弹速 70」与 P 列落地口径里的 windSpeed / velocity / 换算说明要一起改，
    否则文档会自相矛盾（同一行里既写 175 又写 70）。
    """
    if not os.path.exists(DESIGN):
        print('[skip] 设计案不存在：%s' % DESIGN)
        return
    xml = read_zip_rows(DESIGN, DESIGN_MEMBER)
    rows = row_of(DESIGN, xml, 'G', CHAIN)       # G 列 = 技能ID
    if len(rows) != 1:
        raise SystemExit('[fail] 设计案里 101303 命中 %d 行（预期 1）' % len(rows))
    row = rows[0]

    edits = {
        'H': [(OLD_NAME, NEW_NAME)],
        'K': [('弹速 %d' % OLD_SPEED, '弹速 %d' % NEW_SPEED)],
        'L': [('弹速 %d' % OLD_SPEED, '弹速 %d' % NEW_SPEED)],
        'M': [('弹速 %d' % OLD_SPEED, '弹速 %d' % NEW_SPEED)],
        'N': [('%dpx的移动速度' % OLD_SPEED, '%dpx的移动速度' % NEW_SPEED)],
        'P': [
            ('"windSpeed":%d' % OLD_SPEED, '"windSpeed":%d' % NEW_SPEED),
            ('velocity = %d×0.3 世界 px/s' % OLD_SPEED, 'velocity = %d×0.3 世界 px/s' % NEW_SPEED),
            #  旧的那句「70px ⇒ 世界 21 ⇒ 4 秒最远 84」是**按 70 推的**，速度一改就整句失效，
            #  不只是换个数字 —— 4 秒最远变成 210 世界 px，且要补上「为什么提」的来由。
            ('⚠️ 「%dpx 的移动速度」按项目口径理解为**表值逻辑 px/s**（世界 21px/s ⇒ 4 秒最远约 84 世界 px）。'
             % OLD_SPEED,
             '⚠️ 「移动速度」按项目口径理解为**表值逻辑 px/s**。2026-11-23 由 %d 提到 **%d**（×2.5）：\n'
             '  · 世界 = %d×0.3 = %.1f px/s（屏上再 ×0.76875），4 秒最远约 %d 世界 px；\n'
             '  · 原 %d 飞满普攻射程 260 表值要 3.71 秒、逼近 4 秒寿命 ⇒ 目标一后撤就「弹还在飞、寿命先到」'
             '（技能放了没伤害）；提到 %d 后只要 1.49 秒。'
             % (OLD_SPEED, NEW_SPEED, NEW_SPEED, NEW_SPEED * 0.3, int(NEW_SPEED * 0.3 * 4), OLD_SPEED, NEW_SPEED)),
        ],
    }

    changed = 0
    for column, pairs in edits.items():
        ref = '%s%d' % (column, row)
        text = cell_text(DESIGN, xml, ref)
        if text is None:
            raise SystemExit('[fail] 设计案 %s 不存在' % ref)
        now = text
        for old, new in pairs:
            hits = now.count(old)
            if hits == 0:
                if new in now:
                    continue
                raise SystemExit('[fail] 设计案 %s 找不到 %r' % (ref, old[:40]))
            if hits != 1:
                raise SystemExit('[fail] 设计案 %s 里 %r 命中 %d 次' % (ref, old[:40], hits))
            now = now.replace(old, new)
            changed += 1
        if now != text:
            xml = write_cell(xml, ref, now)

    if not changed:
        print('[skip] 设计案已是目标值')
    else:
        commit_raw(DESIGN, DESIGN_MEMBER, xml, DESIGN + '.bak-windcannon-20261123')
        print('[ok] 设计案主表改 %d 处（H/K/L/M/N/P）' % changed)

    patch_design_cards()


def patch_design_cards():
    """设计案「卡牌描述与落地」页：F 列卡面描述、P 列技能4 名称。

    这一页的卡面描述与 `pvpCard.description` 是同一句话，改名必须一起动，
    否则文档里还是「孢爆箭在命中点炸开补范围」而游戏里已经叫「风炮弹」。
    Q/R 两列（状态 / 落地方式）仍是第 12 批 `splash_shot` 的旧口径 —— 那是另一件事，
    不在本次改名范围内，留着由策划决定是否重写。
    """
    if not os.path.exists(DESIGN):
        return
    xml = read_zip_rows(DESIGN, DESIGN_CARD_MEMBER)
    rows = row_of(DESIGN, xml, 'A', UNIT)
    if len(rows) != 1:
        raise SystemExit('[fail] 卡牌描述页里 %s 命中 %d 行' % (UNIT, len(rows)))
    row = rows[0]

    changed = 0
    for ref, pairs in (('F%d' % row, [(OLD_NAME, NEW_NAME)]),
                       ('P%d' % row, [(OLD_NAME, NEW_NAME)])):
        text = cell_text(DESIGN, xml, ref)
        if text is None:
            raise SystemExit('[fail] 卡牌描述页 %s 不存在' % ref)
        now = text
        for old, new in pairs:
            hits = now.count(old)
            if hits == 0:
                if new in now:
                    continue
                raise SystemExit('[fail] 卡牌描述页 %s 找不到 %r' % (ref, old))
            if hits != 1:
                raise SystemExit('[fail] 卡牌描述页 %s 里 %r 命中 %d 次' % (ref, old, hits))
            now = now.replace(old, new)
            changed += 1
        if now != text:
            xml = write_cell(xml, ref, now)

    if not changed:
        print('[skip] 设计案卡牌描述页已是目标值')
        return
    commit_raw(DESIGN, DESIGN_CARD_MEMBER, xml, DESIGN + '.bak-windcannon-cards-20261123')
    print('[ok] 设计案卡牌描述页改 %d 处（F/P）' % changed)


def main():
    changed = patch_json_files()
    print('[sum] JSON 共改 %d 处' % changed)
    patch_xlsx()
    patch_design()
    verify()


if __name__ == '__main__':
    main()
