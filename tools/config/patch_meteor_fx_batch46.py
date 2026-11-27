# -*- coding: utf-8 -*-
"""第 46 批：运动霸 68033「天外飞石」30853 / 链 103304 换特效。

用户口径（2026-11-25）：
    「运动霸的天外飞石使用（截图）这个特效，并制作相关的预制体，
      特效大小需要和伤害判定范围保持一致，按照砸落爆炸
      （skill_1_34 图片实际有像素的区域）的特效大小去匹配范围」

美术：`assets/bundles/battle/units/projectiles/运动霸_砸落技能/`（33 帧 412x366），
prefab 由 `tools/build_yundongba_meteor_fx.py` 生成
（爆点外沿 = 判定直径 123 屏上 px、锚点落在冲击环椭圆圆心）。

🔴 原来的 `units/projectiles/驭兽师_巨象践踏/驭兽师_巨象践踏` **不能就地覆盖**：
驭兽师武将技 36401 也在用它（两行共用一个 prefab）。所以新建一套、只改 30853 这一行。

🔴 三写：xlsx 是转表器的唯一真源。只改 JSON 不写 Excel，转表器一跑
（以 Excel 为准）就把旧路径抄回来，屏幕上表现为「还是那头大象」。

写法沿用 `patch_basketball_zone_batch45.py`：
  · xlsx 走 zip 级只替换目标 `<c>`（这张表公式单元格多，openpyxl 保存会把缓存值写空）；
  · remoteRef 是列存 `{k,v,c}`（CRLF、元素独占行），整份用 `render` 重写；
  · client 是行对象数组，`json.dump` 紧凑写。

幂等：目标值固定，内容没变就跳过写盘。
用法：python tools/config/patch_meteor_fx_batch46.py
"""
import io
import json
import os
import re
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import cell_xml, read_zip_rows  # noqa: E402
from patch_splash_shot_k import render  # noqa: E402  同一个 render：数组一行一个元素、`\r\n`

ROOT = 'D:/Alan/Project/POW'
CLIENT = os.path.join(ROOT, 'doc', '塔防数据配置', 'json', 'client')
REMOTE = os.path.join(ROOT, 'Demo3.8', 'assets', 'remoteRef')
BACKUP_DIR = os.path.join(ROOT, 'doc', '塔防数据配置_历史备份')
XLSX_SKILL = os.path.join(ROOT, 'doc', '塔防数据配置', 'PVP-技能.xlsx')

SKILL_ID = 30853
#  pvpSkill 30853 在「PVP-技能.xlsx / 技能配置」里的行号（A 列 = 30853）。
SKILL_ROW = 78
#  J 列 = 「技能特效预设」= `pvpSkill.effectPrefabPath`。
CELL_REF = 'J%d' % SKILL_ROW

OLD_PATH = 'units/projectiles/驭兽师_巨象践踏/驭兽师_巨象践踏'
NEW_PATH = 'units/projectiles/运动霸_砸落技能/运动霸_砸落技能'


# ────────────────────────────────────────── xlsx 单元格手术

def value_of(xml, ref):
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not match:
        return None
    texts = re.findall(r'<t[^>]*>(.*?)</t>', match.group(1) or '', re.S)
    texts += re.findall(r'<v>(.*?)</v>', match.group(1) or '', re.S)
    return texts[0] if texts else ''


def write_cell(xml, ref, value):
    match = re.search(r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref, xml, re.S)
    if not match:
        raise SystemExit('[fail] 单元格 %s 不存在' % ref)
    style = re.search(r's="(\d+)"', match.group(0))
    return xml[:match.start()] + cell_xml(ref, style.group(1) if style else None, value) + xml[match.end():]


def patch_xlsx():
    xml = read_zip_rows(XLSX_SKILL, 'xl/worksheets/sheet1.xml')
    current = value_of(xml, CELL_REF)
    if current == NEW_PATH:
        print('[skip] %s：%s 已是新路径' % (os.path.basename(XLSX_SKILL), CELL_REF))
        return
    if current != OLD_PATH:
        raise SystemExit('[fail] %s 现值是 %r，既不是旧路径也不是新路径，先人工确认'
                         % (CELL_REF, current))
    xml = write_cell(xml, CELL_REF, NEW_PATH)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(XLSX_SKILL, os.path.join(BACKUP_DIR, os.path.basename(XLSX_SKILL) + '.bak-batch46'))
    tmp = XLSX_SKILL + '.tmp'
    with zipfile.ZipFile(XLSX_SKILL) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == 'xl/worksheets/sheet1.xml':
                data = xml.encode('utf-8')
            dst.writestr(info, data)
    #  Windows 上先关掉句柄再替换，否则 `os.replace` 报 WinError 5（WPS 占表）。
    os.replace(tmp, XLSX_SKILL)
    print('[ok] %s：%s 旧 -> 新' % (os.path.basename(XLSX_SKILL), CELL_REF))


# ────────────────────────────────────────── JSON 三写

def load_json(folder, name):
    path = os.path.join(folder, name + '.json')
    with io.open(path, encoding='utf-8') as handle:
        return path, json.load(handle)


def patch_skill(folder, packed):
    path, data = load_json(folder, 'pvpSkill')
    keys = data['k'] if packed else None
    rows = data['v'] if packed else data

    def get(row, name):
        return row[keys.index(name)] if packed else row.get(name)

    def put(row, name, value):
        if packed:
            row[keys.index(name)] = value
        else:
            row[name] = value

    hits = [row for row in rows if int(get(row, 'skillId')) == SKILL_ID]
    if len(hits) != 1:
        raise SystemExit('[fail] %s 里 %d 有 %d 行' % (path, SKILL_ID, len(hits)))
    row = hits[0]
    if get(row, 'effectPrefabPath') == NEW_PATH:
        print('[skip] %s/pvpSkill：已是新路径' % os.path.basename(folder))
        return
    put(row, 'effectPrefabPath', NEW_PATH)
    if packed:
        with io.open(path, 'w', encoding='utf-8', newline='') as handle:
            handle.write('{\r\n"k":%s,\r\n"v":%s,\r\n"c":%s\r\n}'
                         % (render(data['k']), render(rows), render(data['c'])))
    else:
        with io.open(path, 'w', encoding='utf-8', newline='') as handle:
            json.dump(rows, handle, ensure_ascii=False, separators=(',', ':'))
    print('[ok] %s/pvpSkill：effectPrefabPath 旧 -> 新' % os.path.basename(folder))


# ────────────────────────────────────────── 体检

def verify():
    """三方对账：xlsx / remoteRef / client 都必须是新路径，且别处没人被带跑。"""
    xml = read_zip_rows(XLSX_SKILL, 'xl/worksheets/sheet1.xml')
    problems = []
    if value_of(xml, CELL_REF) != NEW_PATH:
        problems.append('xlsx %s = %r' % (CELL_REF, value_of(xml, CELL_REF)))

    for folder, packed in ((REMOTE, True), (CLIENT, False)):
        path, data = load_json(folder, 'pvpSkill')
        keys = data['k'] if packed else None
        rows = data['v'] if packed else data
        index = keys.index('effectPrefabPath') if packed else 'effectPrefabPath'
        found = {}
        for row in rows:
            value = row[index]
            if value and '运动霸_砸落技能' in str(value):
                found[row[keys.index('skillId')] if packed else row['skillId']] = str(value)
        if found != {SKILL_ID: NEW_PATH}:
            problems.append('%s 里新路径的使用者是 %r' % (os.path.basename(folder), found))
        #  旧路径必须还在：驭兽师武将技 36401 还在用。
        owner = [row[keys.index('skillId')] if packed else row['skillId']
                 for row in rows if str(row[index]) == OLD_PATH]
        if 36401 not in owner:
            problems.append('%s 里 36401 丢了旧路径（%r）' % (os.path.basename(folder), owner))
    if problems:
        for item in problems:
            print('[fail]', item)
        raise SystemExit(1)
    print('[verify] 三方一致：xlsx J78 / remoteRef / client 都是新路径，36401 未受影响')


if __name__ == '__main__':
    patch_xlsx()
    patch_skill(REMOTE, True)
    patch_skill(CLIENT, False)
    verify()
