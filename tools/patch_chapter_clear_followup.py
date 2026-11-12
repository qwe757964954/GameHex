"""
2026-11-11 SVN 合并后「章节首通动画丢失」修复（页面侧编排）。

用户口径：
  「章节首次通关需要播放章节通过动画后，再播放切换」

改法只动 MainTerritoryMap：
  · 首通那一拍记住边沿（电平 false→true 也认，防合并把 chapterClearPending 冲掉）；
  · 换章那一帧压住换图，等整章云散演完；
  · 演完起同一套「相机先行 → 云合拢 → 换图 → 揭幕」切换转场；
  · 新章已经加载完了，所以转场要等 cover 走完（云盖满）才允许画，否则 lead 段就露新图。

模型不发新的 chapterSwitch 命令（旧守卫「自动推进不发命令」继续成立）。
按 bytes 精确替换，CRLF / LF 各自保留。
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = 'assets/script/app/main/MainTerritoryMap.ts'


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


# ── ① 转场状态加一个「等云盖满再画新章」的标记 ──────────────────
INTERFACE_OLD = """    /** 新章落位的总距离（px，按视口高度算；0 = 只演云不演位移）。 */
    readonly rise: number;
}
"""
INTERFACE_NEW = """    /** 新章落位的总距离（px，按视口高度算；0 = 只演云不演位移）。 */
    readonly rise: number;
    /**
     * 「首通云散演完之后补的那一段切换」要等云盖满才允许换图（2026-11-11）。
     *
     * 自动推进时模型**早就**把新章加载完了；玩家点章节按钮那条路靠异步加载天然拖过
     * `lead` + `cover` 那 0.42s，而这条没有 ⇒ 不压住的话新图会在云还没盖住时直接露出来。
     */
    deferRender: boolean;
}
"""

# ── ② 三个编排字段 ────────────────────────────────────────────
FIELDS_OLD = """    private chapterSwapPending = false;
    /**
     * 章节切换转场（`null` = 没在演）。只有玩家点章节按钮才会起（模型发的 `chapterSwitch`）。
     */
    private chapterSwitch: IChapterSwitchState | null = null;
"""
FIELDS_NEW = """    private chapterSwapPending = false;
    /**
     * 「这一章刚刚首次通关」的一次性编排信号（2026-11-11）。
     *
     * 用户：「章节首次通关需要播放章节通过动画后，再播放切换」。模型通关那一拍立刻
     * `advanceCompletedChapter()`，页面只有先把换图压住、等整章云散演完，才接得上切换转场。
     * 这里记的是**意图**，不是动画状态：即使 SVN 合并把 `chapterClearPending` 那条边沿冲掉，
     * 只要 `chapterCleared` 在同一章里 false→true，也照样认首通。
     */
    private chapterClearFollowup = false;
    /** 首通自动推进的「旧章 → 新章」：云散演完那一刻拿它起切换转场。 */
    private chapterClearSwitch: { readonly from: number; readonly to: number } | null = null;
    /** 上一次真正画出来那一帧的通关电平（只用于同章内的 false→true 边沿）。 */
    private lastRenderedChapterCleared = false;
    /**
     * 章节切换转场（`null` = 没在演）。玩家点章节按钮由模型的 `chapterSwitch` 命令起；
     * 首通自动推进由 {@link chapterClearSwitch} 在云散演完之后补起同一段演出。
     */
    private chapterSwitch: IChapterSwitchState | null = null;
"""

# ── ③ beginChapterSwitch：第三参 + 作废旧标记 ──────────────────
BEGIN_OLD = """    private beginChapterSwitch(fromChapterId: number, toChapterId: number): void {
        if (!territoryChapterSwitchWanted(fromChapterId, toChapterId)) return;
        if (!this.mapView?.isValid) return;
        if (this.chapterSwitch) return;
        if (!this.mapView.beginChapterSwitch()) return;
"""
BEGIN_NEW = """    private beginChapterSwitch(fromChapterId: number, toChapterId: number, deferRender = false): void {
        if (!territoryChapterSwitchWanted(fromChapterId, toChapterId)) return;
        if (!this.mapView?.isValid) return;
        if (this.chapterSwitch) return;
        // 手动切章一到，旧的首通待播标记作废（去向由这次点击说了算）。
        this.chapterClearFollowup = false;
        if (!this.mapView.beginChapterSwitch()) return;
"""

RISE_OLD = """            rise: territoryChapterSwitchRise(height),
        };
"""
RISE_NEW = """            rise: territoryChapterSwitchRise(height),
            deferRender,
        };
"""

# ── ④ update：串起「云散 → 切换 → 云盖满再换图」 ───────────────
UPDATE_OLD = """        if (this.chapterSwapPending) {
            if (this.mapView?.chapterClearPlaying) return;
            this.chapterSwapPending = false;
            this.renderAll();
            if (!this.isValid) return;
        }
        // ② 切章转场（玩家点的）。它自己要靠新章画上来才能揭幕，所以排在①之后。
        if (this.chapterSwitch) {
            this.stepChapterSwitch(step);
            if (!this.isValid) return;
        }
"""
UPDATE_NEW = """        if (this.chapterSwapPending) {
            // ①-a 整章云散（章节通过动画）还在演 ⇒ 一帧都不许动地图。
            if (this.mapView?.chapterClearPlaying) return;
            const followup = this.chapterClearSwitch;
            if (followup) {
                // ①-b 云散演完 ⇒ 接着起「相机上移、新章居中」的切换转场。
                this.chapterClearSwitch = null;
                this.beginChapterSwitch(followup.from, followup.to, true);
                if (!this.chapterSwitch) {
                    // 云美术没加载 / 整页过场占着 ⇒ 演不了就直接换章，绝不把玩家卡在旧图。
                    this.chapterSwapPending = false;
                    this.renderAll();
                    if (!this.isValid) return;
                }
                // 演得了 ⇒ 保持 chapterSwapPending，等 cover 走完由下面统一补画新章。
            } else if (!this.chapterSwitch?.deferRender) {
                // ①-c 普通换章（云散演完 / 没在演）：照旧补画。
                this.chapterSwapPending = false;
                this.renderAll();
                if (!this.isValid) return;
            }
        }
        // ② 切章转场（玩家点的 / 首通补起的）。它自己要靠新章画上来才能揭幕，所以排在①之后。
        if (this.chapterSwitch) {
            this.stepChapterSwitch(step);
            if (!this.isValid) return;
            const running = this.chapterSwitch;
            // 云已经盖满（cover 走完进 wait）⇒ 把压住的那一帧新章画上来，下一帧就能揭幕。
            if (running?.deferRender && this.chapterSwapPending
                && (running.phase === 'wait' || running.phase === 'reveal')) {
                running.deferRender = false;
                this.chapterSwapPending = false;
                this.renderAll();
                if (!this.isValid) return;
            }
        }
        // ③ 兜底：转场被超时 / 打断收掉了，压住的新章也必须补画，不能永远停在旧章。
        if (this.chapterSwapPending && !this.chapterSwitch) {
            this.chapterSwapPending = false;
            this.renderAll();
            if (!this.isValid) return;
        }
"""

# ── ⑤ renderAll：首通边沿 + 压画守卫 ──────────────────────────
GUARD_OLD = """        if (state.chapterId !== this.lastRenderedChapter && !this.chapterSwitch
            && this.mapView?.chapterClearPlaying) {
            this.chapterSwapPending = true;
            return;
        }
"""
GUARD_NEW = """        const chapterChanged = state.chapterId !== this.lastRenderedChapter;
        // 🔴 2026-11-11 首通编排：`chapterClearPending` 是模型给的一次性边沿，但 SVN 合并
        //    可能把它冲掉（症状「章节通关动画丢失，只剩切换」）⇒ 同一章里 `chapterCleared`
        //    false→true 也认首通。换章进来的那一帧不算（切回早已通过的章节不许演）。
        const firstClearEdge = state.chapterCleared && !this.lastRenderedChapterCleared
            && !chapterChanged;
        const clearSignal = state.chapterClearPending || firstClearEdge;
        if (clearSignal && state.chapterCleared) this.chapterClearFollowup = true;
        if (chapterChanged && !this.chapterSwitch) {
            if (this.chapterClearFollowup) {
                // 首通自动推进：把换图压住，update 里先演完云散、再起切换转场。
                this.chapterClearFollowup = false;
                this.chapterClearSwitch = { from: this.lastRenderedChapter, to: state.chapterId };
                this.chapterSwapPending = true;
                return;
            }
            // 非首通的换章也要让整章云散演完（旧口径，`syncGrid` 会 reset 掉云）。
            if (this.mapView?.chapterClearPlaying) {
                this.chapterSwapPending = true;
                return;
            }
        }
        // 切换转场正在合拢：新章早已加载完，云还没盖满时不许画（否则 lead 段露新图）。
        if (chapterChanged && this.chapterSwitch?.deferRender
            && (this.chapterSwitch.phase === 'lead' || this.chapterSwitch.phase === 'cover')) {
            this.chapterSwapPending = true;
            return;
        }
"""

STAMP_OLD = """        this.lastRenderedChapter = state.chapterId;
"""
STAMP_NEW = """        this.lastRenderedChapter = state.chapterId;
        this.lastRenderedChapterCleared = state.chapterCleared;
"""

PENDING_OLD = """            chapterClearPending: state.chapterClearPending,
"""
PENDING_NEW = """            // 合并后的电平边沿兜底与模型边沿一起喂给地图（二者都只认「首次通关」）。
            chapterClearPending: clearSignal,
"""


patch(PAGE, [
    (INTERFACE_OLD, INTERFACE_NEW),
    (FIELDS_OLD, FIELDS_NEW),
    (BEGIN_OLD, BEGIN_NEW),
    (RISE_OLD, RISE_NEW),
    (UPDATE_OLD, UPDATE_NEW),
    (GUARD_OLD, GUARD_NEW),
    (STAMP_OLD, STAMP_NEW),
    (PENDING_OLD, PENDING_NEW),
], already='private chapterClearFollowup = false;')
