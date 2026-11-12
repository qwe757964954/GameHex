"""
2026-11-11「第 2 章云层和地块没有固定间隔」接线补丁。

`TerritoryCloudView` 的挡云遮罩已改成按「所有已揭示格 × 全量 layout.points」描 15px 外扩轮廓
（见该文件的 setKeepOutPoints / forEachKeepOutCell）。这里只负责把格心喂进去，以及给三份
`TerritoryMapView` VM 夹具的空壳云类补上同名方法（否则沙箱里 `syncClouds` 会 TypeError）。

按 bytes 精确替换，CRLF / LF 各自保留。
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(rel: str, pairs: list[tuple[str, str]], already: str) -> None:
    target = ROOT / rel
    raw = target.read_bytes()
    crlf = raw.count(b'\r\n') == raw.count(b'\n') and b'\r\n' in raw
    text = raw.decode('utf-8')
    if already in text:
        print(f'skipped {rel} (already patched)')
        return
    for old, new in pairs:
        o = old.replace('\n', '\r\n') if crlf else old
        n = new.replace('\n', '\r\n') if crlf else new
        if o not in text:
            raise SystemExit(f'MISS in {rel}:\n{o[:240]}')
        if text.count(o) != 1:
            raise SystemExit(f'NOT UNIQUE in {rel} ({text.count(o)}):\n{o[:240]}')
        text = text.replace(o, n, 1)
    target.write_bytes(text.encode('utf-8'))
    print(f'patched {rel} ({len(pairs)} hunks, {"CRLF" if crlf else "LF"})')


INJECT_OLD = """        this.clouds.setChapterCleared(input.chapterCleared, input.chapterClearPending);
"""
INJECT_NEW = """        // 🔴 挡云区要按「所有已揭示格」描 15px 外扩轮廓（2026-11-11）：
        //    `chapter_02` 起预告披露的是整关 footprint，那些格会画成地块却不在 `cloudCells` 里，
        //    只按 `cloudCells` 描就会「云层贴着地块、没有固定间隔」。
        this.clouds.setKeepOutPoints(input.layout.points);
        this.clouds.setChapterCleared(input.chapterCleared, input.chapterClearPending);
"""

patch('assets/script/app/territory/view/TerritoryMapView.ts',
      [(INJECT_OLD, INJECT_NEW)],
      already='this.clouds.setKeepOutPoints(input.layout.points);')


def stub_patch(rel: str, indent: str) -> None:
    old = (
        f'{indent}attach(): void {{}}\n'
        f'{indent}setFrames(): void {{}}\n'
        f'{indent}sync(): void {{}}\n'
    )
    new = (
        f'{indent}attach(): void {{}}\n'
        f'{indent}setFrames(): void {{}}\n'
        f'{indent}setKeepOutPoints(): void {{}}\n'
        f'{indent}sync(): void {{}}\n'
    )
    patch(rel, [(old, new)], already='setKeepOutPoints(): void {}')


stub_patch('tests/helpers/territory-map-view-sandbox.ts', ' ' * 16)
stub_patch('tests/territory-building-shake.test.ts', ' ' * 20)
stub_patch('tests/territory-tile-frames.test.ts', ' ' * 20)
