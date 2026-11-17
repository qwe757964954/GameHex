#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""2026-11-14 设计案回填：多目标递减 + 处决移出卡牌 + 【优化中】状态。

对应口径（用户原话）：
    技能设计中的处决机制先从卡牌中移除，处决机制只能留在其他的养成系统中；
    普通攻击带来的穿透类/分裂子弹/溅射 的伤害设计上需要遵循 多个目标递减的机制，
    初始值必须低于普通攻击，主要形成大面积的造成伤害的效果，但是数值不能太大。

落地到 `技能设计案2.xlsx` sheet「技能设计案 (2)」：

    · 穿透（穿甲苔刺 100801 / 101301 / 102402 / 102702 / 103501）
        首次穿透 60%、每多穿一个 ×0.6 ⇒ 60% / 36% / 21.6%
        K/L/M 补「（穿透目标承受 …）」；P 从 `pierceCount` 换成 `normalPierceCount`
        + `normalPierceFalloff 0.4`（`pierceCount` 只服务「强化那一击」，普攻写它等于没配）
    · 溅射（爆囊扩散 / 吸养根须 / 裂变暴击，共 13 条链）
        基准 20% / 26% / 32%（三档都低于普攻），同一爆点第 2 个目标起每次 ×0.7
        P 从引擎不认的 `explosionDamageRate` 换成 `splashDamageRate` + `splashFalloff 0.3`
    · 处决（枯萎收割 102401 / 103502）
        删 K/L/M 的「普攻有 NN%概率处决残血目标，」、删 P 的 `executeChance`、改 N / O 文案
    · 全文「处决」句式清掉（模板句 30 行 / 紫档机制句 12 行 / 1 行旁注）
    · S 列涉改 20 行标 **【优化中】**，S1 表头补状态图例

写法：zip 级手术（`sync_treant_excel.write_zip`），不换 openpyxl 另存 —— 保住条件格式 /
列宽 / 冻结窗格。正文是共享字符串（`t="s"`），读回必须 `html.unescape`；写回用 inlineStr
并把换行转成 `&#10;`（raw \\n 会被 WPS 挤成一行）。

用法：python tools/config/patch_design_doc_multitarget.py [--check]
"""

from __future__ import annotations

import html as html_mod
import os
import re
import sys
import zipfile
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from patch_multi_target_falloff import CELL_RE  # noqa: E402
from sync_treant_excel import write_zip  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DESIGN = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
SHEET = 'xl/worksheets/sheet1.xml'
BACKUP = os.path.join(ROOT, 'tmp', 'backup_design_20261114')

PIERCE_CHAINS = ('100801', '101301', '102402', '102702', '103501')
SPLASH_CHAINS = ('100802', '101302', '101501', '101502', '101601', '101602',
                 '101702', '102202', '102502', '102602', '102701', '103202', '103402')
EXECUTE_CHAINS = ('102401', '103502')
#  普攻「多打 N 发」（`pvpAttrMap.bulletNum`）= 用户口径里的「分裂子弹」，4 张卡的「孢子弹幕」
BULLET_CHAINS = ('101001', '101701', '102601', '103401')
LEVEL_COLS = {'K': 1, 'L': 2, 'M': 3}

SPLASH_RATE = {1: 0.20, 2: 0.26, 3: 0.32}
SPLASH_FALLOFF = 0.3
PIERCE_FALLOFF = 0.4
BULLET_FALLOFF = 0.4
SPLASH_SUFFIX = '（同一爆点第2个目标起每次×0.7）'
PIERCE_NOTE = '（首次 60%、每多穿一个 ×0.6）'
STATUS_TAG = '【优化中】'
STATUS_HEADER = '技能状态（已实现 / 优化中 / 待规划）'

SPLASH_TEXT = re.compile(r'造成\d+%溅射伤害(?:' + re.escape(SPLASH_SUFFIX) + r')*')
PIERCE_TEXT = re.compile(r'普攻穿透(\d+)个目标(?:（穿透目标承受 [^）]*）)?')
PIERCE_SUMMARY = re.compile(r'【穿甲苔刺】穿透 (\d+(?: → \d+)?)(（[^）]*）)?；')
EXECUTE_TEXT = re.compile(r'普攻有\d+%概率处决残血目标，')
BULLET_TEXT = re.compile(r'普攻额外发射(\d+)发(?:（额外弹[^）]*）)?')
BULLET_SUMMARY = re.compile(r'(【孢子弹幕】弹数 \d+ → \d+)(（[^）]*）)?；')
BULLET_PARAM = re.compile(r'skill 域 skillParamJson=\{"bulletNum":1/1/2\}')
BULLET_UNIT = 'unit 域 bulletNum add=1/1/2'
SPLASH_SUMMARY = re.compile(r'溅射 \d+% → \d+%(?:' + re.escape(SPLASH_SUFFIX) + r')?(?=；)')
#  🔴 幂等：匹配串必须把**已经写进去的** `,"splashFalloff":0.3` 一起吃掉。
#  老写法只匹配到 `:[\d./]+` 就停 ⇒ 每跑一次追加一个 `"splashFalloff":0.3`（踩过）。
SPLASH_PARAM = re.compile(
    r'"(?:explosionDamageRate|splashDamageRate)":[\d./]+(?:,"splashFalloff":[\d.]+)*')
PIERCE_PARAM = re.compile(r'"pierceCount":([\d/]+)')
EXECUTE_PARAM = re.compile(r'skill 域 skillParamJson=\{"executeChance":[\d./]+\} \+ ')

EXECUTE_BODY_OLD = '对已经枯萎到临界的目标直接执行终止程序，省掉收尾的那几下。'
EXECUTE_BODY_NEW = ('枯萎的植株一碰就碎：暴击率与伤害两路同时把收尾那几下压短。'
                    '【处决已从卡牌链路移除】2026-11-14 起处决只保留给其他养成系统，'
                    '本卡不再带处决，两条词缀各自独立生效。')
EXECUTE_SUMMARY_OLD = re.compile(r'【枯萎收割】处决 \d+% → \d+%；')
EXECUTE_SUMMARY_NEW = ('【枯萎收割】处决 35% → 55% 已移除（改由其他养成系统提供，'
                       '满级价值需重算）；')

SWEEP = (
    ('穿透、连击、多弹、溅射、附加伤害或处决为主干', '穿透、连击、多弹、溅射、附加伤害为主干'),
    ('（穿透 / 溅射 / 连击 / 护盾 / 减速 / 处决）', '（穿透 / 溅射 / 连击 / 护盾 / 减速）'),
    ('不额外触发状态与处决', '不额外触发状态'),
)


def pct(value: float) -> str:
    return ('%g' % round(value * 100, 1)) + '%'


# ---------------------------------------------------------------- xlsx 读写

def load_shared(path, member='xl/sharedStrings.xml'):
    with zipfile.ZipFile(path) as archive:
        if member not in archive.namelist():
            return []
        raw = archive.read(member).decode('utf-8')
    return [html_mod.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S)))
            for si in re.findall(r'<si>(.*?)</si>', raw, re.S)]


def cells_of_row(xml, row_number, shared):
    """一行 → `{列字母: 文本}`。共享串（t="s"）与 inlineStr 都要解。"""
    match = re.search(r'<row r="%d"[^>]*>(.*?)</row>' % row_number, xml, re.S)
    if not match:
        return {}
    found = {}
    for attrs, body in CELL_RE.findall(match.group(1)):
        ref = re.search(r'r="([A-Z]+)\d+"', attrs)
        if not ref:
            continue
        body = body or ''
        inline = re.search(r'<is><t[^>]*>(.*?)</t></is>', body, re.S)
        if inline:
            found[ref.group(1)] = html_mod.unescape(inline.group(1))
            continue
        value = re.search(r'<v>(.*?)</v>', body, re.S)
        if not value:
            found[ref.group(1)] = ''
        elif 't="s"' in attrs and shared:
            found[ref.group(1)] = shared[int(value.group(1))]
        else:
            found[ref.group(1)] = html_mod.unescape(value.group(1))
    return found


def put_cell(xml, ref, value):
    """写 inlineStr；换行转 `&#10;`（raw \\n 会被 WPS 挤成一行）。"""
    pattern = r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref
    match = re.search(pattern, xml, re.S)
    if not match:
        raise SystemExit('单元格 %s 不存在' % ref)
    style = re.search(r's="(\d+)"', match.group(0))
    s = ' s="%s"' % style.group(1) if style else ''
    text = escape(str(value)).replace('\n', '&#10;')
    cell = '<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, s, text)
    return xml[:match.start()] + cell + xml[match.end():]


# ---------------------------------------------------------------- 三组规则

def plan_pierce(cells) -> dict:
    want = {}
    for col in LEVEL_COLS:
        text = cells.get(col, '')
        match = PIERCE_TEXT.search(text)
        if not match or not text.startswith('L'):
            continue
        count = int(match.group(1))
        shares = [pct((1 - PIERCE_FALLOFF) ** index) for index in range(1, count + 1)]
        new = PIERCE_TEXT.sub('普攻穿透%d个目标（穿透目标承受 %s）' % (count, '/'.join(shares)), text)
        if new != text:
            want[col] = new

    desc = cells.get('N', '')
    match = PIERCE_SUMMARY.search(desc)
    if match and match.group(2) != PIERCE_NOTE:
        prefix = '【穿甲苔刺】穿透 %s%s；' % (match.group(1), PIERCE_NOTE)
        want['N'] = desc[:match.start()] + prefix + desc[match.end():]

    param = cells.get('P', '')
    if PIERCE_PARAM.search(param):
        new = PIERCE_PARAM.sub(
            lambda m: '"normalPierceCount":%s,"normalPierceFalloff":0.4' % m.group(1), param)
        if new != param:
            want['P'] = new
    return want


def plan_splash(cells) -> dict:
    want = {}
    for col, level in LEVEL_COLS.items():
        text = cells.get(col, '')
        if '溅射伤害' not in text:
            continue
        new = SPLASH_TEXT.sub('造成%s溅射伤害%s' % (pct(SPLASH_RATE[level]), SPLASH_SUFFIX), text)
        if new != text:
            want[col] = new

    desc = cells.get('N', '')
    match = SPLASH_SUMMARY.search(desc)
    if match:
        note = '溅射 %s → %s%s' % (pct(SPLASH_RATE[1]), pct(SPLASH_RATE[3]), SPLASH_SUFFIX)
        if match.group(0) != note:
            want['N'] = desc[:match.start()] + note + desc[match.end():]

    param = cells.get('P', '')
    if SPLASH_PARAM.search(param):
        new = SPLASH_PARAM.sub('"splashDamageRate":0.20/0.26/0.32,"splashFalloff":0.3', param)
        if new != param:
            want['P'] = new
    return want


def plan_execute(cells) -> dict:
    want = {}
    for col in LEVEL_COLS:
        text = cells.get(col, '')
        if EXECUTE_TEXT.search(text):
            want[col] = EXECUTE_TEXT.sub('', text)

    desc = cells.get('N', '')
    new = desc
    if EXECUTE_BODY_OLD in new:
        new = new.replace(EXECUTE_BODY_OLD, EXECUTE_BODY_NEW)
    new = EXECUTE_SUMMARY_OLD.sub(EXECUTE_SUMMARY_NEW, new)
    #  档位句里的「一处必杀机制」原先指的就是处决，移除后只剩倍率
    new = new.replace('金档是「一处必杀机制 + 一到两处倍率」：', '金档是「两处倍率」：')
    if new != desc:
        want['N'] = new

    other = cells.get('O', '')
    if '处决触发时飘字换深红档' in other:
        want['O'] = other.replace(
            '【纯 UI】处决触发时飘字换深红档。',
            '【纯 UI】暴击触发时飘字换深红档（处决飘字随该机制一并移出卡牌链路）。')

    param = cells.get('P', '')
    if EXECUTE_PARAM.search(param):
        new = EXECUTE_PARAM.sub('', param).replace(
            '；skill 域参数按',
            '（2026-11-14：skillParamJson 不再写 executeChance，卡牌链路不带处决）；skill 域参数按')
        if new != param:
            want['P'] = new
    return want


def plan_bullet(cells) -> dict:
    """多弹（分裂子弹）：K/L/M 补每发递减、N 摘要补口径、P 补 bulletFalloff。"""
    want = {}
    for col in LEVEL_COLS:
        text = cells.get(col, '')
        match = BULLET_TEXT.search(text)
        if not match or not text.startswith('L'):
            continue
        extra = int(match.group(1))
        shares = [pct((1 - BULLET_FALLOFF) ** index) for index in range(1, extra + 1)]
        note = '（额外弹：%s）' % ' / '.join(shares)
        new = BULLET_TEXT.sub('普攻额外发射%d发%s' % (extra, note), text)
        if new != text:
            want[col] = new

    desc = cells.get('N', '')
    match = BULLET_SUMMARY.search(desc)
    if match:
        note = '（额外弹 60% / 36%，第 1 发仍是本体 100%）'
        if match.group(2) != note:
            want['N'] = desc[:match.start()] + match.group(1) + note + '；' + desc[match.end():]

    param = cells.get('P', '')
    new = param
    if BULLET_PARAM.search(new):
        new = BULLET_PARAM.sub(
            'skill 域 skillParamJson={"bulletFalloff":0.4}（多目标递减：第 1 发是本体 100%，'
            '额外弹 60% / 36%）', new)
        #  顺带纠正：`bulletNum` 是 unit 域修改器，写进 skillParamJson 不会被 flat 映射读到
        new = new.replace('（配 bulletAngle 扇形均分）',
                          '（`bulletNum` 是 unit 域修改器，别写进 skillParamJson —— 没有 flat 映射会静默不生效）')
    elif BULLET_UNIT in new and 'bulletFalloff' not in new:
        new = new.replace(' + unit 域 attackSpeed',
                          ' + skill 域 skillParamJson={"bulletFalloff":0.4}（多目标递减：第 1 发是本体 100%，'
                          '额外弹 60% / 36%） + unit 域 attackSpeed')
    if new != param:
        want['P'] = new
    return want


def main() -> int:
    check_only = '--check' in sys.argv

    with zipfile.ZipFile(DESIGN) as archive:
        xml = archive.read(SHEET).decode('utf-8')
    shared = load_shared(DESIGN)

    stat = {'pierce': 0, 'splash': 0, 'execute': 0, 'bullet': 0, 'sweep': 0, 'status': 0, 'cells': 0}
    log = []
    for row_number in sorted(int(n) for n in re.findall(r'<row r="(\d+)"', xml)):
        if row_number < 2:
            continue
        cells = cells_of_row(xml, row_number, shared)
        chain = str(cells.get('G', '')).strip()
        if not chain:
            continue

        want = {}
        in_group = True
        if chain in PIERCE_CHAINS:
            want.update(plan_pierce(cells))
            stat['pierce'] += 1
        elif chain in SPLASH_CHAINS:
            want.update(plan_splash(cells))
            stat['splash'] += 1
        elif chain in EXECUTE_CHAINS:
            want.update(plan_execute(cells))
            stat['execute'] += 1
        elif chain in BULLET_CHAINS:
            want.update(plan_bullet(cells))
            stat['bullet'] += 1
        else:
            in_group = False

        #  全文「处决」句式清理（N 列，含上面刚改过的文本）
        desc = want.get('N', cells.get('N', ''))
        swept = desc
        for old, new in SWEEP:
            if old in swept:
                swept = swept.replace(old, new)
                stat['sweep'] += 1
        if swept != desc:
            want['N'] = swept

        if not want:
            continue
        for col, value in want.items():
            xml = put_cell(xml, '%s%d' % (col, row_number), value)
            stat['cells'] += 1
        #  【优化中】只标「本轮改过口径」的行；纯文案清理（模板句去掉「或处决」）不动状态
        if in_group:
            xml = put_cell(xml, 'S%d' % row_number, STATUS_TAG)
            stat['cells'] += 1
            stat['status'] += 1
            log.append('行%-4d %-8s %s' % (row_number, chain, cells.get('H', '')))

    if '优化中' not in cells_of_row(xml, 1, shared).get('S', ''):
        xml = put_cell(xml, 'S1', STATUS_HEADER)
        stat['cells'] += 1

    print('穿透 %d 链 / 溅射 %d 链 / 处决 %d 链 / 多弹 %d 链 / 句式清理 %d 处 / 标【优化中】%d 行 / 共写 %d 格'
          % (stat['pierce'], stat['splash'], stat['execute'], stat['bullet'], stat['sweep'],
             stat['status'], stat['cells']))
    for line in log:
        print('  ', line)

    if check_only:
        return 0

    backup = write_zip(DESIGN, SHEET, xml, BACKUP)
    print('已写回（备份 %s）' % backup)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
