# -*- coding: utf-8 -*-
"""把 `8-1`（收尾步）的遮罩从 `hole` 改成 `holeThrough` —— **挖孔高亮照旧，孔外点击穿透**。

用户口径（2026-11-25）：
  · 8-1 的遮罩不屏蔽点击，改成弱引导；
  · **挖孔高亮的形式不变**（压暗、孔、光圈、手指、气泡全留）；
  · **仅在 8-1** 允许点击穿透。

代码侧口径见 `GuideStepConfig.GuideMaskType` 与 `GuideDialogView.applyMaskStyle`：
`holeThrough` 的 alpha 与 `hole` 相同，只是把四块焦点遮罩的 `cc.Button` 停用
（`Sprite` 照渲染 ⇒ 压暗还在；`Button` 停用 ⇒ 不再注册触摸监听 ⇒ 事件漏给下层）。

三写（源表 + 两份导出 JSON）：
  · `doc/塔防数据配置/X-新手引导.xlsx` / `新手引导步骤`：8-1 的「遮罩类型」（E 列）hole → holeThrough，
    并把列头口径补上 `holeThrough`（已补过就跳过）；
  · `assets/remoteRef/guideStep.json`（`{k,v,c}` 列存，**CRLF、每个 token 独占一行**）；
  · `doc/塔防数据配置/json/client/guideStep.json`（每行一个对象的数组）。

⚠️ remoteRef 不能整份 `json.dumps` 重写（它的排版是「每 token 一行 + CRLF」，
序列化回来字节对不上，会把整份文件的 diff 洗成全文改动）⇒ 按**行**定位后只替换那一行。
定位条件四条同时成立（`1,` / `"8-1"` / `"收尾"` / `"prevDone"`），且命中数必须为 1，
不然整体放弃 —— `"8-1"` 还会作为 7-1 的 nextStep 出现，只看它一处会改错行。

Excel 写盘一律 zip 级手术（`sync_treant_excel.set_cell`）：openpyxl 另存会把整表按 16384 列重写。

幂等：已经是 `holeThrough` 的位置打印 `[skip]`，可反复重跑。
"""

import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from patch_guide_weak_steps import (  # noqa: E402
    BACKUP,
    CLIENT,
    REMOTE,
    SHEET,
    XLSX,
    cell_text,
    read_zip_rows,
    set_cell,
    shared_strings,
    write_zip,
)

STEP = '8-1'
MASK = 'holeThrough'
HINT_ADD = ' / holeThrough 挖孔穿透（压暗与挖孔同 hole，孔外点击不拦截）'


# ---------------------------------------------------------------- Excel

def patch_excel():
    xml = read_zip_rows(XLSX, SHEET)
    strings = shared_strings()
    # 行号不写死：按 B 列的 stepId 反查（表头/备注插一行就全错位）。
    row_no = None
    for m in re.finditer(r'<c r="B(\d+)"[^>]*>(.*?)</c>', xml, re.S):
        if cell_text(xml, 'B' + m.group(1), strings) == STEP:
            row_no = int(m.group(1))
            break
    if row_no is None:
        raise SystemExit('源表里找不到步骤行：%s' % STEP)

    changed = 0
    ref = 'E%d' % row_no
    current = cell_text(xml, ref, strings)
    if current == MASK:
        print('[skip] %s 已经是 %s' % (ref, MASK))
    elif current != 'hole':
        raise SystemExit('%s 当前是 %r，不是预期的 hole，先人工确认' % (ref, current))
    else:
        xml = set_cell(xml, ref, MASK)
        changed += 1
        print('[ok] %s（步骤 %s）遮罩 hole → %s' % (ref, STEP, MASK))

    # 列头那一行写的是可选值口径，补上 holeThrough 免得下一个人照着 hole 乱填。
    # ⚠️ 行号不能写死：按内容找（含「全屏黑」的 E 格才是口径行）。
    hint_ref = None
    for m in re.finditer(r'<c r="(E\d+)"[^>]*>(.*?)</c>', xml, re.S):
        if '全屏黑' in cell_text(xml, m.group(1), strings):
            hint_ref = m.group(1)
            break
    if hint_ref is None:
        print('[warn] 找不到遮罩类型列头（含「全屏黑」的格子），跳过提示更新')
    else:
        hint = cell_text(xml, hint_ref, strings)
        if MASK in hint:
            print('[skip] %s 提示已含 %s' % (hint_ref, MASK))
        else:
            xml = set_cell(xml, hint_ref, hint + HINT_ADD)
            changed += 1
            print('[ok] %s 提示补上 %s 说明' % (hint_ref, MASK))

    if not changed:
        print('[skip] Excel 无需改动')
        return
    backup = write_zip(XLSX, SHEET, xml, BACKUP)
    print('[ok] 已写盘 %s（备份 %s）' % (os.path.basename(XLSX), backup))


# ---------------------------------------------------------------- remoteRef（列存、每 token 一行）

def patch_remote():
    raw = io.open(REMOTE, encoding='utf-8', newline='').read()
    lines = raw.split('\r\n')
    # 一行数据长这样（每条独占一行、**除最后一个元素外都带尾逗号**）：
    #   1, / "8-1", / "收尾", / "prevDone", / "hole", / "Main/TaskEntry", / ...
    hits = [i for i in range(1, len(lines) - 3)
            if lines[i - 1] == '1,' and lines[i] == '"%s",' % STEP
            and lines[i + 1] == '"收尾",' and lines[i + 2] == '"prevDone",']
    if len(hits) != 1:
        raise SystemExit('remoteRef 里 %s 行命中 %d 处（应为 1），先人工确认' % (STEP, len(hits)))
    at = hits[0] + 3
    if lines[at] == '"%s",' % MASK:
        print('[skip] remoteRef %s 已经是 %s' % (STEP, MASK))
        return
    if lines[at] != '"hole",':
        raise SystemExit('remoteRef %s 的 maskType 是 %r，不是预期的 "hole"' % (STEP, lines[at]))
    lines[at] = '"%s",' % MASK
    text = '\r\n'.join(lines)
    # 落盘前自检：**只有目标那一行**允许变，其余字节完全一致。
    after = text.split('\r\n')
    before = raw.split('\r\n')
    assert len(after) == len(before), '行数被改了，放弃'
    assert [i for i in range(len(before)) if before[i] != after[i]] == [at], '改动溢出目标行，放弃'
    io.open(REMOTE, 'w', encoding='utf-8', newline='').write(text)
    print('[ok] remoteRef %s：hole → %s' % (STEP, MASK))


# ---------------------------------------------------------------- client（每行一个对象）

def patch_client():
    raw = io.open(CLIENT, encoding='utf-8', newline='').read()
    rows = json.loads(raw)
    rebuilt = '[' + ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows) + ']'
    if rebuilt != raw:
        raise SystemExit('client json 排版与预期不一致，先人工确认再改')
    hits = [row for row in rows if row.get('stepId') == STEP]
    if len(hits) != 1:
        raise SystemExit('client json 里 %s 命中 %d 处（应为 1）' % (STEP, len(hits)))
    row = hits[0]
    if row.get('maskType') == MASK:
        print('[skip] client %s 已经是 %s' % (STEP, MASK))
        return
    print('[ok] client %s：%s → %s' % (STEP, row.get('maskType'), MASK))
    row['maskType'] = MASK
    io.open(CLIENT, 'w', encoding='utf-8', newline='').write(
        '[' + ',\n'.join(json.dumps(item, ensure_ascii=False, separators=(',', ':')) for item in rows) + ']')


if __name__ == '__main__':
    patch_excel()
    patch_remote()
    patch_client()
    print('完成：%s 已改为 %s（挖孔高亮照旧，孔外点击穿透）' % (STEP, MASK))
