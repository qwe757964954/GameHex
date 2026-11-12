"""MainPage.ts 的三处接线（2026-11-11）：详情主按钮加速态 / 解锁后同步刷新。

⚠️ `MainPage.ts` 是 **CRLF**。这里显式按 bytes 读写并只替换精确片段，
避免 Windows 上默认换行转换把整份文件刷成 LF 或混合行尾。

用法：python tools/patch_main_page_chest_speed_up.py
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'assets/script/app/main/MainPage.ts'

RAW = TARGET.read_bytes()
assert b'\r\n' in RAW and RAW.count(b'\r\n') == RAW.count(b'\n'), 'MainPage.ts 必须是纯 CRLF'
text = RAW.decode('utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    o = old.replace('\n', '\r\n')
    n = new.replace('\n', '\r\n')
    count = text.count(o)
    assert count == 1, f'片段命中 {count} 次（应为 1）：{old[:70]!r}'
    text = text.replace(o, n, 1)


# ① 详情内容带上「加速态」标记：只有 SpeedUp 才换绿底 + 播放 icon。
replace_once(
    """            openCaption: chestActionCaption(detail.action),
            openCountdown: detail.remainSeconds > 0 ? formatChestCountdown(detail.remainSeconds) : '',
""",
    """            openCaption: chestActionCaption(detail.action),
            // 加速态 = 绿色底 + 播放 icon（2026-11-11）；解锁 / 开启仍是黄色底。
            openSpeedUp: counting,
            openCountdown: detail.remainSeconds > 0 ? formatChestCountdown(detail.remainSeconds) : '',
""",
)

# ② 每秒 / 状态变化刷新：把当前文案与加速态一起交给弹窗，不能只刷倒计时。
replace_once(
    """        this.detailAction = detail.action;
        panel.updateCountdown(detail.remainSeconds, detail.action === ChestSlotAction.SpeedUp);
""",
    """        this.detailAction = detail.action;
        // 🔴 2026-11-11 用户：「点击解锁后，详情的按钮也要同步刷新」。
        //    旧实现只把倒计时塞给弹窗 ⇒ 槽位已变成绿色「加速」，弹窗还写着黄色「解锁」。
        //    现在文案、绿底、播放 icon 都随这份状态一起下发（弹窗内部是全量赋值）。
        const speedUp = detail.action === ChestSlotAction.SpeedUp;
        panel.updateCountdown(detail.remainSeconds, speedUp, {
            caption: chestActionCaption(detail.action),
            speedUp,
        });
""",
)

# ③ 服务端广播 / 激活回包一到就同步刷详情，不必等下一次每秒 tick。
replace_once(
    """        const result = await this.treasureRepository.load(this, (slots) => this.renderChests(slots));
""",
    """        // 队列变化的回调同时刷宝箱栏与详情弹窗（激活回包 / 广播一到就同步，
        // 不等下一次 1s tick；2026-11-11「点击解锁后详情按钮同步刷新」）。
        const result = await this.treasureRepository.load(this, () => this.refreshTreasureDisplay());
""",
)

TARGET.write_bytes(text.encode('utf-8'))
print(f'patched {TARGET.relative_to(ROOT)}')
