/**
 * 音频设置的**纯逻辑层**（零 `cc` 依赖，可被 Node 用例直接 import）。
 *
 * 口径全部对齐老端：
 *   · 老端 `utils/OnOff/OnOff.ts` —— `Value` 取值器把 `true` 读成 100、`false` 读成 0；
 *     `Load/Save` 走 `EngineMain.readLocalStorage/saveLocalStorage`（落到 `sys.localStorage`）。
 *   · 老端 `utils/OnOff/OnOffMusic.ts` / `OnOffSound.ts` —— 键名 = `setting_music<account>` /
 *     `setting_sound<account>`，`account` 取 `localStorage['account_num']`。
 *   · 老端 `ctrl/main/Xiulian/Setting/LayerSetting.ts` —— 开关点击与滑动条回调的换算。
 *
 * 本文件**不碰 `cc`**，理由见项目规则：判定逻辑一旦写在带 `cc` 的 import 链上，
 * Node 用例就 import 不进来，等于永久脱离回归网。
 */

/** 音量上限（老端 `Slider.max = 100`）。 */
export const AUDIO_VOLUME_MAX = 100;

/**
 * 首次（本地无存档）时的音量。
 *
 * 老端 `OnOffMusic` / `OnOffSound` 的 `_value = true`，而 `OnOff.Value` 把 `true`
 * 读成 100 ⇒ **老端第一次进设置面板，两条滑动条都在 100、两个开关都是「开」**。
 */
export const DEFAULT_VOLUME = 100;

/**
 * 「关掉再打开」时的恢复音量。
 *
 * 老端 `LayerSetting.ts` 里的 `DEFAULT_MUSIC_VOLUME` / `DEFAULT_SOUND_VOLUME` = 50。
 * 注意老端的语义**不是**「记住上次音量」：
 * 关 → 直接写 0（旧值丢掉）；再开 → 因为当前是 0，所以回到 50。
 */
export const RESTORE_VOLUME = 50;

/** 音乐开关的本地键前缀（老端 `OnOffMusic.GetKey()`）。 */
export const MUSIC_STORAGE_KEY_PREFIX = 'setting_music';

/** 音效开关的本地键前缀（老端 `OnOffSound.GetKey()`）。 */
export const SOUND_STORAGE_KEY_PREFIX = 'setting_sound';

/** 账号键名（老端 `OnOff.GetAccount()` 读的就是这个）。 */
export const ACCOUNT_STORAGE_KEY = 'account_num';

/** `audioConfig.json` 的一行。 */
export interface AudioConfigRow {
    key?: unknown;
    value?: unknown;
    m4a?: unknown;
}

/** 把任意输入收成 0..100 的整数（老端滑动条回调里是 `Math.floor(slider.value)`）。 */
export function clampVolume(raw: unknown): number {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num)) return 0;
    const floored = Math.floor(num);
    if (floored < 0) return 0;
    if (floored > AUDIO_VOLUME_MAX) return AUDIO_VOLUME_MAX;
    return floored;
}

/** 开关是否处于「开」。老端口径：`volume > 0` 即开（`btn.selected = onoff.GetValue()` 走真值判断）。 */
export function isVolumeOn(volume: unknown): boolean {
    return clampVolume(volume) > 0;
}

/**
 * 开关点击后的新音量。
 *
 * 老端 `LayerSetting.InitClick()` 里 `按钮_开关_*` 的 click：
 * ```
 * onoff.SetValue(selected ? (value == 0 ? DEFAULT_XXX_VOLUME : value) : 0)
 * ```
 * @param current 当前音量
 * @param on 用户点完之后的开关状态（`true` = 开）
 */
export function toggleVolume(current: unknown, on: boolean): number {
    if (!on) return 0;
    const value = clampVolume(current);
    return value === 0 ? RESTORE_VOLUME : value;
}

/** 0..100 → 0..1（`AudioSource.volume` / `playOneShot` 的 `volumeScale`）。 */
export function toVolumeScale(volume: unknown): number {
    return clampVolume(volume) / AUDIO_VOLUME_MAX;
}

/** 面板上「文本_音乐音量_数值」的文案。老端是 `setText(value)`，即纯数字。 */
export function formatVolume(volume: unknown): string {
    return String(clampVolume(volume));
}

/** 音乐存档键。 */
export function musicStorageKey(account: string): string {
    return MUSIC_STORAGE_KEY_PREFIX + (account ?? '');
}

/** 音效存档键。 */
export function soundStorageKey(account: string): string {
    return SOUND_STORAGE_KEY_PREFIX + (account ?? '');
}

/**
 * 解析本地存档里的音量。
 *
 * 兼容老端写进去的三种形态（`OnOff.Load()` 的分支）：
 * `'true'` → 100、`'false'` → 0、数字串 → 该数字。
 * 认不出来返回 `null`（调用方回落到 `DEFAULT_VOLUME`）。
 */
export function parseStoredVolume(raw: unknown): number | null {
    if (raw == null) return null;
    const text = typeof raw === 'string' ? raw.trim() : String(raw);
    if (text === '') return null;
    if (text === 'true') return AUDIO_VOLUME_MAX;
    if (text === 'false') return 0;
    const num = Number(text);
    if (!Number.isFinite(num)) return null;
    return clampVolume(num);
}

/**
 * 用 `audioConfig` 行建「键 → resources 相对路径」表。
 *
 * 老端 `CtrlAudio.data` 就是这个映射（`RefMgraudioConfig.getRefAll()` → `Map(key, value)`）。
 * `value` 形如 `resources://塔防/音效/点击音效` —— **`resources://` 前缀必须剥掉**：
 * 新工程 `ResourceMgr.handlePath()` 只做去扩展名，不认这个前缀，
 * 直接传进 `resources.get` 会报 `Bundle resources doesn't contain ...`。
 */
export function buildClipPathMap(rows?: readonly AudioConfigRow[] | null): Map<string, string> {
    const map = new Map<string, string>();
    for (const row of rows ?? []) {
        if (!row) continue;
        const key = typeof row.key === 'string' ? row.key : '';
        const path = clipPathOf(row.value);
        if (key && path) map.set(key, path);
    }
    return map;
}

/** `resources://a/b` → `a/b`。空/非字符串返回 `''`。 */
export function clipPathOf(value: unknown): string {
    if (typeof value !== 'string' || value === '') return '';
    return value.startsWith('resources://') ? value.slice('resources://'.length) : value;
}

/** 从映射里取路径，取不到返回 `''`（调用方据此静默跳过，不抛）。 */
export function resolveClipPath(map: Map<string, string> | null | undefined, key: string): string {
    if (!map || !key) return '';
    return map.get(key) ?? '';
}
