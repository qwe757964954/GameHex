# -*- coding: utf-8 -*-
"""设计案同步（2026-11-19）：椰蛋战士「暴风」100504 —— 把「从本体出发」写进文案，并对齐数值口径。

用户原话：
> 原本椰蛋战士的暴风技能是从椰蛋战士的位置移动到目标位置，现在是直接生成在目标位置，
> 查看回退的原因，并修改

根因（代码侧）：施放与否由 `pvpSkill` 30707 的 `empoweredEvery: 5` + `empoweredSkillId: 30831`
决定，与等级无关；而「三道 / 50° / 100px / 3s / 名额 / 由小变大」写在 `pvpSkillPlan` 的
100504 上，三档解锁等级是 12 / 24 / 36。等级没到时整条链被 `selectZCSkillPlans` 过滤，
`moving = zoneMoveSpeed > 0` 退化成 false ⇒ 落回「原地生成」。修法见
`ZCCompiledModifierLoadout.skillParamFloor`。

本脚本只动设计案第 26 行（G 列 100504）三格文案，让「从本体出发」这条要求不再是隐含的，
并把两处没同步的数值改回来：

  · L26（L2 档）：持续4s → 持续3s（配表三档统一 `zoneDuration: 3`）
  · M26（L3 档）：持续4s → 持续3s
  · N26（判据）：风的移动速度 70px → 100px（配表 `zoneMoveSpeed: 100`，
    2026-11-07 需求原话也是「飓风以 100px 的速度移动 3s」），并把
    「三道都从椰蛋战士本体出发（不是落在目标点）」写进文案。

幂等：三格各自按「当前文本 == 目标文本」跳过。

用法：python tools/config/patch_yedan_storm_doc_20261119.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_treant_excel import cell_xml, read_zip_rows, write_zip  # noqa: E402

ROOT = 'D:/Alan/占城玩法/策划文档/战斗系统'
XLSX = os.path.join(ROOT, '技能设计案2.xlsx')
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/Project/POW/Demo3.8/tmp/config_backup'

ROW = 26
EXPECTED_CHAIN = '100504'

#  旧文本里的锚点 → 新文本。用锚点替换而不是整格重写：这三格是长文案，
#  整格重写会把别人后来加的字一起抹掉。
EDITS = [
    ('L', '持续4s，只对路径上的4个敌人', '持续3s，只对路径上的4个敌人'),
    ('M', '持续4s，只对路径上的5个敌人', '持续3s，只对路径上的5个敌人'),
    ('N', '风的移动速度 70px', '三道都从椰蛋战士本体出发（不是落在目标点），风的移动速度 100px'),
]


def cell_style(xml, ref):
    m = re.search(r'<c r="%s"[^>]*?s="(\d+)"' % ref, xml)
    return m.group(1) if m else None


def shared_texts(path):
    import html
    import zipfile

    with zipfile.ZipFile(path) as z:
        xml = z.read('xl/sharedStrings.xml').decode('utf-8')
    return [html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', body, re.S)))
            for body in re.findall(r'<si>(.*?)</si>', xml, re.S)]


def resolve_text(xml, ref, shared):
    """取单元格纯文本。三种形态都认：inlineStr / sharedString（`t="s"`）/ 数字。"""
    import html

    m = re.search(r'<c r="%s"([^>]*)(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if not m:
        return None
    attrs, content = m.group(1), m.group(2) or ''
    inline = re.findall(r'<t[^>]*>(.*?)</t>', content, re.S)
    if inline:
        return html.unescape(''.join(inline))
    value = re.search(r'<v>(.*?)</v>', content, re.S)
    if not value:
        return None
    if 't="s"' in attrs:
        try:
            return shared[int(value.group(1))]
        except (ValueError, IndexError):
            return None
    return html.unescape(value.group(1))


def main():
    xml = read_zip_rows(XLSX, MEMBER)
    g = re.search(r'<c r="G%d"[^>]*?(?:/>|>(.*?)</c>)' % ROW, xml, re.S)
    shared = shared_texts(XLSX)
    chain = resolve_text(xml, 'G%d' % ROW, shared)
    if not chain or str(chain).strip() != EXPECTED_CHAIN:
        raise SystemExit('✖ 第 %d 行 G 列不是 %s（拿到 %r），设计案结构可能变了'
                         % (ROW, EXPECTED_CHAIN, chain))

    changed = 0
    for column, old, new in EDITS:
        ref = '%s%d' % (column, ROW)
        text = resolve_text(xml, ref, shared)
        if text is None:
            raise SystemExit('✖ %s 读不到文本' % ref)
        if new in text:
            print('[skip] %s 已是新口径' % ref)
            continue
        if old not in text:
            raise SystemExit('✖ %s 里找不到锚点 %r，当前内容：%r' % (ref, old, text))
        xml = _replace_cell(xml, ref, text.replace(old, new))
        changed += 1
        print('[edit] %s：%r → %r' % (ref, old, new))

    if not changed:
        print('[ok] 设计案第 %d 行已是新口径，未改动' % ROW)
        return
    backup = write_zip(XLSX, MEMBER, xml, BACKUP_DIR)
    print('[ok] 写入 %d 格；备份 %s' % (changed, backup))


def _replace_cell(xml, ref, value):
    """整格替换但保留原样式（`set_cell` 需要自己传 style，这里直接沿用原 s=）。"""
    style = cell_style(xml, ref)
    pattern = r'<c r="%s"[^>]*?(?:/>|>.*?</c>)' % ref
    return re.sub(pattern, lambda _m: cell_xml(ref, style, value), xml, count=1, flags=re.S)


if __name__ == '__main__':
    main()
