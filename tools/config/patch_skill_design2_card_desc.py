# -*- coding: utf-8 -*-
"""给《技能设计案2》追加一页「卡牌描述与落地」：每张卡一句定位描述 + 四个技能的落地方式与状态。

为什么是追加新页而不是改主表
────────────────────────────
主表 175 行是「逐技能」口径，卡级描述没有落点；本轮要补的正是「卡牌名 → 描述 + 落地方式」，
单独一页既能直接交给文案/研发，也不会污染主表既有的列语义。

为什么用 zip 级手术
──────────────────
这张表 8 个页签、主表 176 行且带大量样式，openpyxl 保存会丢公式缓存值与 WPS 私有元数据
（历史上同类表从 20KB 涨到 5.4MB）。这里只新增 `xl/worksheets/sheet9.xml` 并改三处索引
（workbook.xml / workbook.xml.rels / [Content_Types].xml），其余条目逐字节复制。

用法：python tools/config/patch_skill_design2_card_desc.py
"""
import io
import json
import os
import re
import shutil
import sys
import zipfile
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PROJECT = 'D:/Alan/Project/POW'
DESIGN_ROOT = 'D:/Alan/占城玩法/策划文档/战斗系统'
XLSX = os.path.join(DESIGN_ROOT, '技能设计案2.xlsx')
MEMBER = 'xl/worksheets/sheet9.xml'
SHEET_NAME = '卡牌描述与落地'
BACKUP_DIR = os.path.join(DESIGN_ROOT, '_backup')
DESIGN_ROWS = os.path.join(PROJECT, 'Demo3.8', 'tmp', 'skillimpl', 'design_full.json')

#  卡级描述：一句话讲清「阵营/职业/品级 + 怎么打」。技能名一律用设计案里的新名。
DESCRIPTIONS = {
    '68001': '起手型射手：靠超视孢子拉开射程先开火，异种猎杀协议专压蘑菇阵营，「豌豆机关枪」在强化那一击后连发收尾。',
    '68002': '纯坦：坚骨撑血量、抗性装甲协议顶住被克制那一击，巨力护盾给自己一段硬吃的窗口。',
    '68003': '范围法师：火球弹射配合灼热地带把地面烧穿，攻击与射程双修，站中排持续消耗。',
    '68004': '单点射手：职业猎杀协议对战士增伤，精英猎手一记穿透镖打穿一整列。',
    '68005': '近战爆发：蔓生连打补段、横扫清两侧、暴风在收招后铺出三片移动伤害区。',
    '68006': '吸血坦：孢子回流持续回血，共生信号·迅给同阵营提速，斗气爆发把自己变成移动伤害圈。',
    '68007': '吸血战士：破阵投枪每几刀甩一记穿透枪，嗜血窗口期把打出的伤害转成生命。',
    '68008': '穿透溅射射手：穿甲苔刺让普攻穿 2 个目标，爆囊扩散补一圈溅射，疾风箭与戈壁狂箭负责爆发。',
    '68009': '群战战士：蔓生三连 + 爆囊扩散双 AOE，大地之力推出一道直线冲击波压住一路。',
    '68010': '远程炮台：孢群弹幕裂出额外弹，裂变爆炸让每发都带溅射，镭射死光横扫一整条线。',
    '68011': '减速法师：冰晶弹配合孢子凝珠，在落点炸开一片减速区。',
    '68012': '冲阵战士：灵巧投掷提升攻速，菌盾冲锋顶盾突进，用盾换一段推进距离。',
    '68013': '多段射手：连发苔针额外发弹，孢爆箭在命中点炸开补范围。',
    '68014': '近战连击：蔓生连打补段，菌丝突刺突进并定身，贴脸打满连段。',
    '68015': '吸血战士：吸养根须把伤害转生命，爆囊扩散补溅射，射线集束向前贯穿。',
    '68016': 'AOE 法师：裂变爆炸与巨囊弹体把普攻做成大范围爆点，五雷轰顶连落多道雷。',
    '68017': '吸血射手：苔针双连双发，噬血蔓延让溅射也能回血，群星坠落贯穿全场。',
    '68018': '毒伤战士：蔓生三连近身多段，毒液喷吐持续掉血，菌核爆裂把贴脸的敌人击退。',
    '68019': '基础战士：废土铁芽配灵巧投掷双修，生命爆发短时抬血续命。',
    '68020': '双克制射手：异种/职业猎杀同时管阵营与职业，飓风把敌人牵成一团再打。',
    '68021': '抗压战士：异种/职业猎杀双克制，巨型仙人掌在脚下长出持续伤害区。',
    '68022': '链电法师：孢子弹幕额外发弹，闪电链在敌群之间逐跳衰减。',
    '68023': '团队坦：共生信号·迅给同阵营提速，职业抗性协议减伤，大吼大叫削掉敌人的攻击。',
    #  2026-11-23 第 43 批：68015 的 101504 换成射线集束、68035 的 103503 换成文明之火，
    #  卡面描述同步（旧口径「菌毯爆发站桩输出」「射线集束持续灼烧一条线」已作废）。
    #  2026-11-17 第 10 批：102401 换机制（裂变共鸣 → 贯穿滋养），卡面描述同步。
    #  本脚本是「一次性追加第 9 页」的生成器（页已存在就 SystemExit），改这里只为让文档里的
    #  描述表与现状一致；真正回填 `PVP-卡牌.xlsx` / `pvpCard.json` 的是
    #  `patch_card_description.py` / `.js`（它们读第 9 页当上游）。
    '68024': '控制法师：贯穿滋养让普攻子弹穿过己方单位回血，冰山陨落大范围冻结。',
    '68025': '暴击战士：裂变暴击堆暴击率并带溅射，天降神拳一记大范围重击定胜负。',
    '68026': '火系法师：孢群弹幕配裂变爆炸，喷射火焰近身灼烧，凤凰降临强化那一击铺场。',
    '68027': '吸血战士：噬血蔓延吸血兼溅射，尖刺冲锋开场，战神附体收尾。',
    '68028': '基础战士：废土铁芽配灵巧投掷，餐箱炸弹补一发范围伤害。',
    '68029': '厚血坦：菌甲厚化抬血量，抗性装甲协议减伤，重击一记单体高伤。',
    '68030': '远程法师：废土铁芽配超视孢子，篮球火击退并沉默。',
    '68031': '团队坦：共生信号·迅给同阵营提速，抗性装甲协议减伤，舞王召唤分身分担火力。',
    '68032': '多弹射手：苔针双连配爆囊扩散，声波扫射朝三个方向扇形覆盖。',
    '68033': '暴击战士：裂变暴击配破阵投枪，天外飞石砸场并眩晕。',
    '68034': '位移法师：孢群弹幕配裂变爆炸，移形换影闪现两端结算，鹿神守护放追踪弹。',
    '68035': '穿透射手：穿甲苔刺配苔针双连，精密陷阱踩中即炸，文明之火在目标处撒三片火雨。',
}

COLUMNS = [
    ('卡牌ID', 10), ('卡牌', 14), ('阵营', 8), ('职业', 8), ('品级', 10), ('卡牌描述', 64),
    ('技能1', 16), ('技能1 状态', 10), ('技能1 落地方式', 58),
    ('技能2', 16), ('技能2 状态', 10), ('技能2 落地方式', 58),
    ('技能3', 16), ('技能3 状态', 10), ('技能3 落地方式', 58),
    ('技能4', 16), ('技能4 状态', 10), ('技能4 落地方式', 58),
]


def col_letter(index):
    letters = ''
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def cell(ref, value):
    if value is None or value == '':
        return '<c r="%s"/>' % ref
    return '<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, escape(str(value)))


def card_traits():
    path = os.path.join(PROJECT, 'Demo3.8/assets/remoteRef/pvpCard.json')
    with io.open(path, encoding='utf-8') as handle:
        source = json.load(handle)
    keys = source['k']
    traits = {}
    for values in source['v']:
        row = dict(zip(keys, values))
        unit = str(row.get('id'))
        detail = row.get('traits') or {}
        if isinstance(detail, str):
            try:
                detail = json.loads(detail)
            except ValueError:
                detail = {}
        traits[unit] = (detail.get('camp') or '', detail.get('attack') or '')
    return traits


def build_rows():
    with io.open(DESIGN_ROWS, encoding='utf-8') as handle:
        rows = json.load(handle)
    traits = card_traits()
    grouped = {}
    order = []
    for row in rows:
        key = row['cardId']
        if key not in grouped:
            grouped[key] = []
            order.append(key)
        grouped[key].append(row)

    out = []
    header = [name for name, _ in COLUMNS]
    out.append(header)
    for unit in order:
        skills = grouped[unit]
        camp, role = traits.get(unit, ('', ''))
        first = skills[0]
        line = [unit, first['card'], camp, role, first['rarity'], DESCRIPTIONS.get(unit, '')]
        for index in range(4):
            if index < len(skills):
                skill = skills[index]
                landing = (skill.get('land') or '').strip()
                line += [skill['skill'], skill['status'], landing]
            else:
                line += ['', '', '']
        out.append(line)
    return out


def sheet_xml(rows):
    cols = ''.join('<col min="%d" max="%d" width="%d" customWidth="1"/>' % (index + 1, index + 1, width)
                   for index, (_, width) in enumerate(COLUMNS))
    body = []
    for row_index, values in enumerate(rows, start=1):
        cells = ''.join(cell('%s%d' % (col_letter(at + 1), row_index), value)
                        for at, value in enumerate(values))
        body.append('<row r="%d">%s</row>' % (row_index, cells))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<dimension ref="A1:%s%d"/>'
            '<sheetViews><sheetView tabSelected="0" workbookViewId="0">'
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            '</sheetView></sheetViews>'
            '<sheetFormatPr defaultRowHeight="15"/>'
            '<cols>%s</cols>'
            '<sheetData>%s</sheetData>'
            '<autoFilter ref="A1:%s%d"/>'
            '</worksheet>') % (
                col_letter(len(COLUMNS)), len(rows), cols, ''.join(body),
                col_letter(len(COLUMNS)), len(rows))


def patch_workbook(xml):
    if 'name="%s"' % SHEET_NAME in xml:
        raise SystemExit('[skip] 已经有「%s」页，先删掉再跑' % SHEET_NAME)
    sheet_ids = [int(value) for value in re.findall(r'<sheet name="[^"]*" sheetId="(\d+)"', xml)]
    next_id = max(sheet_ids) + 1
    entry = '<sheet name="%s" sheetId="%d" r:id="rId12"/>' % (SHEET_NAME, next_id)
    return xml.replace('</sheets>', entry + '</sheets>', 1)


def patch_rels(xml):
    if 'Id="rId12"' in xml:
        raise SystemExit('[skip] rId12 已被占用')
    entry = ('<Relationship Id="rId12" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
             'relationships/worksheet" Target="worksheets/sheet9.xml"/>')
    return xml.replace('</Relationships>', entry + '</Relationships>', 1)


def patch_types(xml):
    if '/xl/worksheets/sheet9.xml' in xml:
        raise SystemExit('[skip] Content_Types 已登记 sheet9')
    entry = ('<Override PartName="/xl/worksheets/sheet9.xml" ContentType="application/'
             'vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
    return xml.replace('</Types>', entry + '</Types>', 1)


def main():
    rows = build_rows()
    os.makedirs(BACKUP_DIR, exist_ok=True)
    shutil.copy2(XLSX, os.path.join(BACKUP_DIR, '技能设计案2.xlsx.bak-carddesc'))

    with zipfile.ZipFile(XLSX) as source:
        members = {info.filename: source.read(info.filename) for info in source.infolist()}
    infos = None
    with zipfile.ZipFile(XLSX) as source:
        infos = source.infolist()

    members['xl/workbook.xml'] = patch_workbook(members['xl/workbook.xml'].decode('utf-8')).encode('utf-8')
    members['xl/_rels/workbook.xml.rels'] = patch_rels(
        members['xl/_rels/workbook.xml.rels'].decode('utf-8')).encode('utf-8')
    members['[Content_Types].xml'] = patch_types(members['[Content_Types].xml'].decode('utf-8')).encode('utf-8')
    members[MEMBER] = sheet_xml(rows).encode('utf-8')

    tmp = XLSX + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as target:
        for info in infos:
            target.writestr(info, members[info.filename])
        target.writestr(MEMBER, members[MEMBER])
    os.replace(tmp, XLSX)
    print('[ok] %s：新增「%s」页，%d 行' % (os.path.basename(XLSX), SHEET_NAME, len(rows)))


def verify():
    import xlsx_read

    name, rows = xlsx_read.read_sheet(XLSX, 8, 3)
    if name != SHEET_NAME:
        raise SystemExit('[fail] 第 9 页是 %r' % name)
    head = rows[0][1]
    if head[:6] != ['卡牌ID', '卡牌', '阵营', '职业', '品级', '卡牌描述']:
        raise SystemExit('[fail] 表头不符：%r' % head[:8])
    print('[ok] 回读 %r：%d 行 × %d 列；首张卡 %s / %s' % (
        name, len(rows), len(head), rows[1][1][1], rows[1][1][4]))


if __name__ == '__main__':
    main()
    verify()
