# -*- coding: utf-8 -*-
"""把 `PVP-卡牌.xlsx / 卡牌配置` 的 `headIcon`（AK 列）从 `icons/head/*` 改回 `icons/cardHead/*`。

2026-11-25 反馈：「这几个都要用卡牌全身立绘的被改了用了小图」。

表说明行（第 4 行）写得很清楚：

    兵种卡填「兵种_头像_<兵种>」→ image/icon/cardHead
    近卫卡填「图标_头像_<名>」 → image/icon/head

也就是**兵种卡的头像位本该落 `icons/cardHead`（256×256 全身立绘）**。
实际 35 行全被填成了 `icons/head/<拼音>` 直路径 —— 那是只有上半身的大头像，
卡牌站台 / 卡库条目 / 卡池 / 详情全都读到小图，`boardHero` 的「缺图复用专属立绘」
也跟着落空（`tests/card-art-dedup.test.ts` 与 `tests/card-head-icon.test.ts` 因此常红）。

实现说明：这批单元格是**共享字符串**（`<c t="s"><v>127</v></c>`），文本不在 sheet xml 里。
35 个值互不相同、共享表里各出现一次 ⇒ 只可能被各自的格子引用，
所以直接改 `xl/sharedStrings.xml` 的文本，保留索引与样式，不碰 sheet。

改完必须重新导表：`npm run config:export`。

用法：
    python tools/config/patch_pvpcard_headicon_excel.py --dry-run
    python tools/config/patch_pvpcard_headicon_excel.py
"""
import argparse
import os
import shutil
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

XLSX = 'D:/Alan/Project/POW/doc/塔防数据配置/PVP-卡牌.xlsx'
SHARED = 'xl/sharedStrings.xml'
BACKUP = 'D:/Alan/Project/POW/Demo3.8/tmp/_bak_xlsx'
OLD = 'icons/head/'
NEW = 'icons/cardHead/'


def rewrite(src, member, text, backup_dir):
    os.makedirs(backup_dir, exist_ok=True)
    backup = os.path.join(backup_dir, os.path.basename(src))
    shutil.copy2(src, backup)
    tmp = src + '.tmp'
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == member:
                data = text.encode('utf-8')
            zout.writestr(info, data)
    os.replace(tmp, src)
    return backup


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    with zipfile.ZipFile(XLSX) as z:
        shared = z.read(SHARED).decode('utf-8')

    before = shared.count(OLD)
    print('共享字符串里的旧目录：%d 处' % before)

    # 只认「值整体是 icons/head/<名>」的条目，避免误伤注释/说明里出现的同样字样
    targets = [s for s in shared.split('</si>') if OLD in s]
    print('命中的 <si> 条目：%d' % len(targets))
    if before != 35 or len(targets) != 35:
        raise SystemExit('预期 35 条（pvpCard 的 35 张兵种卡），实际 %d 处 / %d 条 —— 先核对表再改'
                         % (before, len(targets)))
    for s in targets[:3]:
        start = s.find(OLD)
        print('   样例：', s[max(0, start - 12):start + 40].replace('\n', ' '))

    if args.dry_run:
        print('dry-run：不做写入')
        return

    written = shared.replace(OLD, NEW)
    remaining_old = written.count(OLD)
    print('写入后：旧目录 %d 处，新目录 %d 处' % (remaining_old, written.count(NEW)))
    if remaining_old != 0:
        raise SystemExit('还有 %d 处没换掉 —— 停止，别留半套' % remaining_old)
    backup = rewrite(XLSX, SHARED, written, BACKUP)
    print('已写入。备份：%s' % backup)


if __name__ == '__main__':
    main()
